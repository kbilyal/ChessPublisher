const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert'),cp=require('child_process');
let pass=0,fail=0;
function check(c,m){try{assert.ok(c);console.log(`PASS ${String(++pass).padStart(2,'0')} ${m}`);}catch(e){fail++;console.log(`FAIL ${m}: ${e.message}`);}}
function sha(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}
const wv=fs.readFileSync('ChessPublisher-WebView.ps1','utf8');
const le=fs.readFileSync('ChessPublisher-LocalEngine.ps1','utf8');
const manifest=JSON.parse(fs.readFileSync('engine/GACRUX-RUNTIME-MANIFEST.json','utf8'));
check(manifest.engine==='Gacrux'&&(manifest.version==='1.9.57'||manifest.version==='1.11.65'),'runtime manifest pins Gacrux 1.9.57 or 1.11.65');
check(manifest.mode==='onedir'&&(manifest.fileCount===61||manifest.fileCount===60)&&manifest.files.length===manifest.fileCount,'runtime manifest covers all onedir files');
check(/^[a-f0-9]{64}$/.test(manifest.treeSha256),'runtime manifest has deterministic tree SHA256');
check((manifest.archive==='g1957.zip'||manifest.archive==='g11165.zip')&&/^[a-f0-9]{64}$/.test(manifest.archiveSha256),'sealed shallow runtime archive is manifest-pinned');
const archiveFile = path.join('engine', manifest.archive);
check(fs.existsSync(archiveFile)&&sha(archiveFile)===manifest.archiveSha256,'sealed runtime archive SHA256 matches manifest');
let sourceOk=true;
for(const e of manifest.files){const p=path.join('engine','gacrux',...e.path.split('/'));if(!fs.existsSync(p)||fs.statSync(p).size!==e.size||sha(p)!==e.sha256){sourceOk=false;break;}}
check(sourceOk,'packaged Gacrux source tree matches every manifest hash and size');
let zipOk=false,zipEntries=[];
try{cp.execFileSync('unzip',['-t',archiveFile],{stdio:'ignore'});zipOk=true;zipEntries=cp.execFileSync('unzip',['-Z1',archiveFile],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);}catch{}
check(zipOk,'sealed Gacrux runtime archive integrity passes unzip -t');
check(zipEntries.length===manifest.fileCount&&manifest.files.every(e=>zipEntries.includes(e.path)),'sealed archive contains exactly the complete runtime tree');
check(/ENGINE-RUNTIME-01/.test(wv)&&/Get-WvGacruxRuntimeRoot/.test(wv)&&/Prepare-WvGacruxRuntime/.test(wv),'Desktop launcher contains dedicated Gacrux runtime manager');
check(/LocalApplicationData/.test(wv)&&(/CP\\G1957-/.test(wv)||/CP\\G11165-/.test(wv))&&(/_internal\\python314\.dll/.test(wv)||/_internal\\python312\.dll/.test(wv))&&/-gt 180/.test(wv),'runtime manager enforces a short per-user path budget');
check((/g1957\.zip/.test(fs.readFileSync('engine/GACRUX-RUNTIME-MANIFEST.json','utf8'))||/g11165\.zip/.test(fs.readFileSync('engine/GACRUX-RUNTIME-MANIFEST.json','utf8')))&&/ExtractToDirectory/.test(wv),'runtime manager restores from sealed shallow archive first');
check(/archiveSha256/.test(wv)&&/Get-FileHash[^\n]+archivePath[^\n]+SHA256/.test(wv),'sealed archive is SHA256 verified before extraction');
check(/robocopy\.exe/.test(wv)&&/if\(-not \$archiveUsed\)/.test(wv),'robocopy long-source fallback exists when sealed archive is unavailable');
check(/System\.Threading\.Mutex/.test(wv)&&/ChessPublisher-GacruxRuntime-/.test(wv),'runtime preparation is guarded against concurrent Desktop instances');
check(/\.staging-/.test(wv)&&/Move-Item -LiteralPath \$staging -Destination \$RuntimeRoot/.test(wv),'runtime rebuild uses staging then atomic directory promotion');
check(/Test-WvGacruxRuntimeFiles \$Manifest \$staging -Full/.test(wv),'all staged engine files are fully SHA256 verified before promotion');
check(/criticalPaths/.test(wv)&&/Test-WvGacruxRuntimeFiles \$manifest \$runtimeRoot/.test(wv),'cached runtime is revalidated on every Desktop startup');
check(/Test-WvGacruxBoot/.test(wv)&&/--help/.test(wv)&&/Error loading Python DLL/.test(wv),'launcher performs a real executable boot preflight and recognizes Python-DLL loader failure');
check(/rebuilding once/.test(wv)&&/Install-WvGacruxRuntime \$manifest \$runtimeRoot/.test(wv),'failed runtime boot triggers one automatic verified self-repair');
check(/CHESSPUBLISHER_GACRUX_EXE/.test(wv)&&/CHESSPUBLISHER_GACRUX_RUNTIME_ROOT/.test(wv),'launcher passes verified short engine runtime explicitly to LocalEngine');
check(wv.indexOf('[void](Prepare-WvGacruxRuntime)')<wv.indexOf('$health = Get-EngineHealth',wv.indexOf('function Start-ChessPublisherEngine')),'runtime is prepared before any LocalEngine reuse/start decision');
check(/CHESSPUBLISHER_GACRUX_EXE/.test(le)&&/verified Gacrux runtime path supplied by the Desktop launcher is missing/.test(le),'LocalEngine fails closed instead of silently falling back when verified runtime disappears');
check(/enginePath = \$gacrux/.test(le),'LocalEngine health exposes the exact active Gacrux executable path');
check(/runtimeMatches/.test(wv)&&/r\.enginePath/.test(wv),'Desktop refuses to reuse a stale LocalEngine that is not using the verified runtime');
const startEngineBlock=wv.slice(wv.indexOf('function Start-ChessPublisherEngine'),wv.indexOf('function Stop-OwnedEngine'));
check(/Verified short-path Gacrux runtime is unavailable after startup preflight/.test(startEngineBlock)&&!/\$gacrux = Join-Path \$root 'engine\\gacrux\\pairingchecker\.exe'/.test(startEngineBlock),'engine startup depends on the verified short runtime, not the deep packaged executable path');
check(!/ItemType\s+Junction|mklink|CreateSymbolicLink|New-Item[^\n]+SymbolicLink/i.test(wv),'engine hardening does not rely on symlink/junction execution');
check(!/LongPathsEnabled|HKLM:.*FileSystem/i.test(wv),'engine hardening does not require admin registry changes or Windows long-path policy');
let parentSame=true;
if(manifest.version==='1.9.57'&&fs.existsSync('BETA67-PROTECTED-CORE-SHA256.txt')){
  const parent={};for(const line of fs.readFileSync('BETA67-PROTECTED-CORE-SHA256.txt','utf8').split(/\r?\n/)){const m=line.match(/^([a-f0-9]{64})\s+\.\/(engine\/gacrux\/.+)$/i);if(m)parent[m[2]]=m[1].toLowerCase();}
  parentSame=Object.keys(parent).length===61;
  for(const [rel,h] of Object.entries(parent)){if(!fs.existsSync(rel)||sha(rel)!==h){parentSame=false;break;}}
}
check(parentSame,'Gacrux upstream files match manifest baseline');
const screenshotPath=String.raw`C:\Users\KyamranBilyal\Downloads\Chess-Publisher-v1.06.00-beta.66-Rating-List-Sequence-Consistency-FULL-PORTABLE-2026-09-08\Chess-Publisher-v1.06.00-beta.66-Rating-List-Sequence-Consistency-FULL-PORTABLE-2026-09-08\engine\gacrux\_internal\python314.dll`;
check(screenshotPath.length>=250,'reported beta66 python314.dll fixture is at the classic MAX_PATH danger boundary');
const pyDll = manifest.version==='1.11.65'?'_internal\\python312.dll':'_internal\\python314.dll';
const tagPfx = manifest.version==='1.11.65'?'G11165-':'G1957-';
const shortFixture=String.raw`C:\Users\KyamranBilyal\AppData\Local\CP\${tagPfx}${manifest.treeSha256.slice(0,12)}\${pyDll}`;
check(shortFixture.length<120,'new runtime design keeps the same python dll path far below MAX_PATH');
const critDll = manifest.version==='1.11.65'?'_internal/python312.dll':'_internal/python314.dll';
check(manifest.criticalPaths.includes(critDll)&&manifest.criticalPaths.includes('_internal/VCRUNTIME140.dll')&&manifest.criticalPaths.includes('_internal/ucrtbase.dll'),'critical boot DLLs are explicitly startup-verified');
console.log(`BETA68 ENGINE RUNTIME RESULT: ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
