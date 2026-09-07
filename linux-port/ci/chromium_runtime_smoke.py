#!/usr/bin/env python3
from __future__ import annotations
import argparse,hashlib,shutil,subprocess,sys,tempfile,threading,urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
import chess_publisher_linux as app
from build_info import APP_BUILD
from build_identity_integration import apply as apply_build_identity
apply_build_identity()

EXACT_HTML_DRIVE_ID='1IaTP11vp1IK_flqHaZCE9AQA52hlz3H-'
EXACT_HTML_BYTES=1526307
EXACT_HTML_SHA256='f51355b1a449870be6ed69d1bb941c19a9d8d2bdf3c8f91da845b4bc1275f310'
EXACT_MARKERS=('Tournament Setup','Pairings','Chess-Results','Registration','Participants','DGT')

class SourceAccessBlocked(RuntimeError):pass


def _looks_like_google_wrapper(data:bytes,content_type:str)->bool:
    head=data[:8192].decode('utf-8','ignore').lower()
    ct=(content_type or '').lower()
    return ('text/html' in ct or head.lstrip().startswith(('<!doctype html','<html'))) and any(x in head for x in ('google','drive','accounts.google','docs.google'))


def _download_exact_html()->bytes:
    urls=(
        f'https://drive.usercontent.google.com/download?id={EXACT_HTML_DRIVE_ID}&export=download&confirm=t',
        f'https://drive.google.com/uc?export=download&id={EXACT_HTML_DRIVE_ID}&confirm=t',
    )
    last=None
    blocked=[]
    for url in urls:
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Chess-Publisher-Linux-CI/1'})
            with urllib.request.urlopen(req,timeout=30) as r:
                data=r.read(EXACT_HTML_BYTES+1024);ct=str(r.headers.get('content-type') or '');final=str(r.geturl())
            digest=hashlib.sha256(data).hexdigest()
            if len(data)==EXACT_HTML_BYTES and digest==EXACT_HTML_SHA256:return data
            if _looks_like_google_wrapper(data,ct):
                blocked.append(f'wrapper bytes={len(data)} sha256={digest} contentType={ct} final={final}')
                continue
            last=RuntimeError(f'Drive returned non-wrapper bytes with wrong pinned identity: bytes={len(data)} sha256={digest} contentType={ct} final={final}')
        except Exception as exc:last=exc
    if blocked and last is None:
        raise SourceAccessBlocked('Exact pinned source is accessible through the authenticated Drive connector but raw public download is blocked: '+'; '.join(blocked))
    if blocked and last is not None:
        raise SourceAccessBlocked('Exact pinned source raw download is unavailable: '+'; '.join(blocked)+f'; fallback={last}')
    raise RuntimeError(f'Could not retrieve exact pinned ChessPublisher.html from Drive: {last}')


def _browser()->str:
    browser=(shutil.which('google-chrome') or shutil.which('google-chrome-stable') or shutil.which('chromium') or shutil.which('chromium-browser'))
    if not browser:raise RuntimeError('No Chromium/Chrome executable is available on the Ubuntu runner.')
    return browser


def _prepare_common(pkg:Path)->tuple[Path,Path]:
    src=pkg/'source';linux=pkg/'linux';src.mkdir(parents=True);linux.mkdir(parents=True)
    shutil.copy2(ROOT/'linux'/'LinuxWebViewShim.js',linux/'LinuxWebViewShim.js')
    for rel in ('cloud/client/cloud-workspace-api.js','hub/client/hub-snapshot.js','hub/client/hub-api-client.js','webview/HubAdapter.js','webview/CloudWorkspaceAdapter.js'):
        p=src/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('/* chromium smoke placeholder; adapter contracts run separately */\n',encoding='utf-8')
    return src,linux


def _run_browser(browser:str,url:str,budget:int=1600)->subprocess.CompletedProcess[str]:
    return subprocess.run([
        browser,'--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
        '--proxy-server=direct://','--proxy-bypass-list=*',f'--virtual-time-budget={budget}','--dump-dom',url,
    ],text=True,capture_output=True,timeout=40,check=False)


def synthetic_bridge(browser:str)->None:
    with tempfile.TemporaryDirectory(prefix='cp-chromium-smoke-') as td_raw:
        td=Path(td_raw);pkg=td/'package';src,_=_prepare_common(pkg);data=td/'data'
        (src/'ChessPublisher.html').write_text('''<!doctype html><html><body>
<div id="probe">pending</div>
<script>
window.addEventListener('load',()=>setTimeout(()=>{
  const webview=!!(window.chrome&&window.chrome.webview&&typeof window.chrome.webview.postMessage==='function');
  const pgn=typeof window.cpNativeSaveTournamentPGN==='function';
  document.getElementById('probe').textContent=[document.documentElement.dataset.chesspublisherPlatform||'',document.documentElement.dataset.chesspublisherLinuxBuild||'',webview,pgn].join('|');
},50));
</script>
</body></html>\n''',encoding='utf-8')
        engine=app.LinuxEngine(pkg,data);srv=app.make_server(engine,'127.0.0.1',0,True);th=threading.Thread(target=srv.serve_forever,daemon=True);th.start()
        try:
            host,port=srv.server_address;cp=_run_browser(browser,f'http://{host}:{port}/',1200)
            if cp.returncode!=0:raise RuntimeError(f'Chromium failed rc={cp.returncode}: {cp.stderr[-2000:]}')
            expected=f'linux|{APP_BUILD}|true|true'
            if expected not in cp.stdout:raise RuntimeError(f'Chromium bridge probe did not reach {expected!r}. DOM tail={cp.stdout[-2000:]} stderr={cp.stderr[-1000:]}')
            if 'linux-dev.2' in cp.stdout:raise RuntimeError('Chromium DOM contains stale linux-dev.2 build identity.')
            print('Synthetic probe:',expected)
        finally:
            srv.shutdown();srv.server_close();th.join(timeout=2)


def exact_ui(browser:str)->None:
    html=_download_exact_html()
    text=html.decode('utf-8-sig','replace')
    for marker in EXACT_MARKERS:
        if marker not in text:raise RuntimeError(f'Pinned exact UI is missing expected source marker: {marker}')
    with tempfile.TemporaryDirectory(prefix='cp-exact-ui-chromium-') as td_raw:
        td=Path(td_raw);pkg=td/'package';src,_=_prepare_common(pkg);data=td/'data'
        (src/'ChessPublisher.html').write_bytes(html)
        engine=app.LinuxEngine(pkg,data);srv=app.make_server(engine,'127.0.0.1',0,True);th=threading.Thread(target=srv.serve_forever,daemon=True);th.start()
        try:
            host,port=srv.server_address;cp=_run_browser(browser,f'http://{host}:{port}/',2500)
            if cp.returncode!=0:raise RuntimeError(f'Exact-UI Chromium failed rc={cp.returncode}: {cp.stderr[-2500:]}')
            dom=cp.stdout;lower=dom.lower()
            if 'data-chesspublisher-platform="linux"' not in lower:raise RuntimeError('Exact UI Chromium DOM has no Linux platform dataset marker.')
            if f'data-chesspublisher-linux-build="{APP_BUILD}"'.lower() not in lower:raise RuntimeError('Exact UI Chromium DOM has no canonical Linux build marker.')
            if 'linux-dev.2' in dom:raise RuntimeError('Exact UI Chromium DOM contains stale linux-dev.2 identity.')
            for marker in EXACT_MARKERS:
                if marker not in dom:raise RuntimeError(f'Exact UI Chromium DOM is missing UI marker: {marker}')
            if 'Chess-Publisher' not in dom:raise RuntimeError('Exact UI Chromium DOM does not identify Chess-Publisher.')
            print('Exact UI bytes:',len(html));print('Exact UI SHA256:',hashlib.sha256(html).hexdigest())
            print('Exact UI Chromium markers:',','.join(EXACT_MARKERS));print('LINUX_EXACT_UI_CHROMIUM_SMOKE=PASS')
        finally:
            srv.shutdown();srv.server_close();th.join(timeout=2)


def main()->int:
    ap=argparse.ArgumentParser();ap.add_argument('--exact-drive-ui',action='store_true');args=ap.parse_args()
    browser=_browser();print('Browser:',browser)
    try:
        if args.exact_drive_ui:exact_ui(browser)
        else:synthetic_bridge(browser);print('LINUX_CHROMIUM_RUNTIME_SMOKE=PASS')
    except SourceAccessBlocked as exc:
        print('LINUX_EXACT_UI_CHROMIUM=BLOCKED_BY_SOURCE_ACCESS')
        print(str(exc))
        return 77
    return 0

if __name__=='__main__':raise SystemExit(main())
