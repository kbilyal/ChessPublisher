from pathlib import Path
from bs4 import BeautifulSoup
from html import unescape
import re, json, subprocess, tempfile, hashlib, collections, sys
root=Path(__file__).resolve().parent.parent
html=(root/'ChessPublisher.html').read_text(encoding='utf-8')
hub=(root/'webview/HubAdapter.js').read_text(encoding='utf-8')
cloud=(root/'webview/CloudWorkspaceAdapter.js').read_text(encoding='utf-8')
engine=(root/'ChessPublisher-LocalEngine.ps1').read_text(encoding='utf-8-sig')
client=(root/'cloud/client/cloud-workspace-api.js').read_text(encoding='utf-8')
errors=[]
def ok(c,msg):
    if c: print('PASS -',msg)
    else: print('FAIL -',msg); errors.append(msg)

# HTML IDs and injected IDs.
soup=BeautifulSoup(html,'html.parser')
html_ids=[x.get('id') for x in soup.find_all(id=True)]
ok(len(html_ids)==len(set(html_ids)),f'HTML IDs unique: {len(html_ids)} / {len(set(html_ids))}')
# The Windows beta.98-r4 package inlines historical VCL continuation modules because
# protected LocalEngine serves only ChessPublisher.html.  Their source strings contain
# fallback/template IDs that are not simultaneous DOM nodes.  Keep this legacy core
# collision audit focused on actual HTML markup + the original core adapters; the
# dedicated BETA98-R4-WINDOWS-VCL-RUNTIME-INTEGRATION regression audits all bundled modules.
html_id_scan=re.sub(r'<script[^>]*data-cp-bundled-source=["\'][^"\']+["\'][^>]*>[\s\S]*?</script>','',html,flags=re.I)
combined=[]
for text in (html_id_scan,hub,cloud): combined += re.findall(r'id=["\']([^"\']+)["\']',text)
counts=collections.Counter(combined)
dups=[k for k,v in counts.items() if v>1 and '${' not in k]
# Some static HTML ids are mentioned in template strings only once each; literal duplicates are actual collision risks.
ok(not dups,f'combined literal UI IDs unique: {len(counts)} unique' + (f'; duplicates={dups[:8]}' if dups else ''))

# Direct event binding target audit (core markup/scripts; bundled modules have a dedicated runtime gate).
all_ids=set(combined)
refs=re.findall(r'getElementById\(["\']([^"\']+)["\']\)\.addEventListener',html_id_scan+hub+cloud)
missing=sorted(set(refs)-all_ids)
ok(not missing,f'direct getElementById(...).addEventListener targets all exist ({len(refs)} bindings)'+(f': missing={missing}' if missing else ''))

# Inline JS syntax, one block at a time.
syntax_fail=[]; checked=0
for i,tag in enumerate(soup.find_all('script')):
    if tag.get('src'): continue
    code=tag.string if tag.string is not None else tag.get_text()
    if not code.strip(): continue
    checked+=1
    f=Path(tempfile.gettempdir())/f'cp-beta17-inline-{i}.js'; f.write_text(code,encoding='utf-8')
    p=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
    if p.returncode: syntax_fail.append((i,p.stderr[-500:]))
ok(not syntax_fail,f'inline JavaScript syntax: {checked} blocks, {len(syntax_fail)} failures')
for name in ['webview/HubAdapter.js','webview/CloudWorkspaceAdapter.js','cloud/client/cloud-workspace-api.js']:
    p=subprocess.run(['node','--check',str(root/name)],capture_output=True,text=True)
    ok(p.returncode==0,f'{name} syntax')

# Legacy cumulative regression marker gate, applicable files only.
manifest=json.loads((root/'BASE-CUMULATIVE-REGRESSION-MANIFEST.json').read_text(encoding='utf-8'))
contents={'ChessPublisher.html':unescape(html),'webview/HubAdapter.js':hub,'ChessPublisher-LocalEngine.ps1':engine}

# Enforce startup contract checks declared in the base manifest.
launcher=(root/'ChessPublisher-WebView.ps1').read_text(encoding='utf-8-sig')
def ps_service_version(src):
    m=re.search(r"^\$serviceVersion\s*=\s*'([^']+)'",src,re.M)
    return m.group(1) if m else ''
for contract in manifest.get('startup_contract_checks',[]):
    if contract.get('id')=='LOCALENGINE-SERVICE-VERSION-MATCH' and contract.get('required'):
        launcher_v=ps_service_version(launcher)
        engine_v=ps_service_version(engine)
        ok(bool(launcher_v) and launcher_v==engine_v,f'LocalEngine serviceVersion matches launcher: {launcher_v or "<missing>"} == {engine_v or "<missing>"}')

# ACTIVE beta.96 r4 SYNC protected-core gate. This is intentionally separate
# from feature/UI markers: future TEC/UI work may evolve, but an unauthorized
# change to the proven Desktop-Web/Cloud SYNC contract must fail the release gate.
sync_contract=manifest.get('sync_freeze_contract',{})
if sync_contract.get('required'):
    freeze_name = sys.argv[sys.argv.index('--freeze-manifest')+1] if '--freeze-manifest' in sys.argv else sync_contract.get('manifest','SYNC-FREEZE-v1.06.00-beta.96.json')
    freeze_path=root/freeze_name
    ok(freeze_path.exists(),'active SYNC freeze manifest exists')
    if freeze_path.exists():
        freeze=json.loads(freeze_path.read_text(encoding='utf-8'))
        ok(str(freeze.get('status','')).startswith('ACTIVE'),'SYNC freeze status is ACTIVE')
        ok(freeze.get('fingerprintContentSchema')==7,'SYNC freeze fingerprint schema is 7')
        def frozen_sha(path,mode):
            raw=(root/path).read_bytes()
            if mode=='normalize-version':
                txt=raw.decode('utf-8')
                txt=re.sub(r'const VERSION="[^"]+";','const VERSION="<VERSION>";',txt)
                raw=txt.encode('utf-8')
            return hashlib.sha256(raw).hexdigest()
        for path,spec in freeze.get('windowsProtectedFiles',{}).items():
            target=root/path
            ok(target.exists(),f'SYNC protected file exists: {path}')
            if target.exists():
                actual=frozen_sha(path,spec.get('mode','exact'))
                ok(actual==spec.get('sha256'),f'SYNC protected hash matches: {path}')
        for path,markerset in freeze.get('windowsSemanticGuards',{}).items():
            target=root/path
            ok(target.exists(),f'SYNC semantic guard file exists: {path}')
            if target.exists():
                txt=target.read_text(encoding='utf-8-sig')
                for marker in markerset:
                    ok(marker in txt,f'SYNC semantic marker preserved: {path} :: {marker}')
        required_regressions=freeze.get('mandatoryRegressionFamilies',[])
        for name in required_regressions:
            ok((root/'TESTS'/name).exists(),f'mandatory SYNC regression remains packaged: {name}')
features=markers=0; missing_markers=[]
for feat in manifest.get('features',[]):
    file=feat.get('file')
    if file not in contents: continue
    features+=1
    for marker in feat.get('markers',[]):
        markers+=1
        if marker not in contents[file]: missing_markers.append((feat.get('id'),file,marker))
# Obsolete RC26 branding marker only: report separately and accept beta17 branding.
filtered=[]
for item in missing_markers:
    if item[0] in {'product-branding','runtime-version-branding'} and ('RC26' in item[2] or '1.05.00' in item[2]): continue
    filtered.append(item)
ok(not filtered,f'cumulative applicable feature markers: {features} features / {markers-len(missing_markers)+sum(1 for x in missing_markers if x not in filtered)} accepted markers; non-obsolete missing={len(filtered)}')
if filtered:
    for x in filtered[:15]: print('  MISSING',x)

# Critical family spot checks.
critical={
'TRF16 export':'window.exportTRF16=function()',
'TRF26 export':'window.exportTRF26=function()',
'TRF26 Starting List':'CP-TRF26-STARTING-LIST-EXPORT-START',
'TRF stable revision guard':'Tournament data changed while the FIDE TRF export was being prepared',
'TRF backup':'TRF_Backup/Round_XX.trf',
'Chess-Results':'Chess-Results Publishing',
'Smart Schedule':'CP-BETA12-SMART-SCHEDULE-REPAIR-START',
'Special Prizes Select all':'Select all',
'DGT board mapping':'DGT Board Mapping',
'Pairing engine':'pairingchecker.exe',
}
for label,marker in critical.items(): ok(marker in html or marker in engine,label+' marker present')
ok('Every Hub snapshot publish must pass through the stable saveAll() sync' in hub,'Hub saveAll-before-publish guard present')
ok('ChessPublisherOnline_InstallScope_v1' in hub and 'ChessPublisherOnline_InstallScope_v1' in cloud,'single installation-scoped Organizer Token contract present')

# LocalEngine only targeted install self-test changed; core checker function hash locked.
def extract_function(src,name):
    m=re.search(r'^function\s+'+re.escape(name)+r'\b.*$',src,re.M)
    if not m:return ''
    n=re.search(r'^function\s+\S+.*$',src[m.end():],re.M)
    end=m.end()+n.start() if n else len(src)
    return src[m.start():end]
invoke=extract_function(engine,'Invoke-TieBreakValidation')
ok(hashlib.sha256(invoke.encode()).hexdigest()=='eb19ecbddf388449186649677131ab043a7b73bd9299b3b87295e887e899b800','Tie-Break validation function remains beta16-identical')

print('AUDIT_RESULT:', 'PASS' if not errors else 'FAIL')
if errors: sys.exit(1)
