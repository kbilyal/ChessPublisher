const fs=require('fs');
const crypto=require('crypto');
let pass=0, fail=0;
function ok(cond,msg){ if(cond){pass++;console.log('PASS '+String(pass).padStart(2,'0')+' '+msg);}else{fail++;console.error('FAIL '+msg);} }
function sha(buf){return crypto.createHash('sha256').update(buf).digest('hex');}
function read(path){return fs.readFileSync(path);}
function text(path){return fs.readFileSync(path,'utf8');}
const manifest=JSON.parse(text('SYNC-FREEZE-v1.06.00-beta.96.json'));
const adapter=text('webview/CloudWorkspaceAdapter.js');
const redesign=text('webview/CloudWorkspaceRedesign.js');
const api=text('cloud/client/cloud-workspace-api.js');
const html=text('ChessPublisher.html');
const localEngine=text('ChessPublisher-LocalEngine.ps1');
const launcher=text('ChessPublisher-WebView.ps1');
const hub=text('webview/HubAdapter.js');
const exactAdapter=sha(read('webview/CloudWorkspaceAdapter.js'));
const exactApi=sha(read('cloud/client/cloud-workspace-api.js'));
const normalizedRedesign=sha(Buffer.from(redesign.replace(/const VERSION="[^"]+";/,'const VERSION="<VERSION>";')));
const exactLocalEngine=sha(read('ChessPublisher-LocalEngine.ps1'));
const exactLauncher=sha(read('ChessPublisher-WebView.ps1'));

ok(manifest.fingerprintContentSchema===7,'protected SYNC contract locks schema-7');
ok(/^ACTIVE\b/.test(manifest.status),'SYNC freeze is ACTIVE after real user runtime confirmation');
ok(manifest.testedRuntime?.sha256==='5e18d6f9e02dc68e7af0df25ed0a1da17a1f11692fafedbdf8120f1869f8c803','freeze anchors the exact user-tested FULL PORTABLE ZIP');
ok(exactAdapter===manifest.windowsProtectedFiles['webview/CloudWorkspaceAdapter.js'].sha256,'CloudWorkspaceAdapter exact protected hash matches');
ok(exactApi===manifest.windowsProtectedFiles['cloud/client/cloud-workspace-api.js'].sha256,'Cloud API client exact protected hash matches');
ok(normalizedRedesign===manifest.windowsProtectedFiles['webview/CloudWorkspaceRedesign.js'].sha256,'CloudWorkspaceRedesign protected logic hash matches apart from release VERSION literal');
ok(exactLocalEngine===manifest.windowsProtectedFiles['ChessPublisher-LocalEngine.ps1'].sha256,'LocalEngine exact protected SYNC transport hash matches');
ok(exactLauncher===manifest.windowsProtectedFiles['ChessPublisher-WebView.ps1'].sha256,'Windows launcher exact protected SYNC startup hash matches');
ok(/const FINGERPRINT_CONTENT_SCHEMA=7;/.test(adapter),'Desktop fingerprint schema remains 7');
ok(adapter.includes('"lastcheckeruisource","lastcheckeruibuildversion","lastcheckeruicheckedat"'),'checker provenance stays runtime-only in Desktop projection');
ok(html.includes('const SESSION_PROVENANCE = window.__cpCheckerUiSessionProvenance'),'checker provenance remains session-only in UI runtime');
ok(!/engine\[SOURCE_KEY\]\s*=/.test(html) && !/engine\[BUILD_KEY\]\s*=/.test(html) && !/engine\[CHECKED_AT_KEY\]\s*=/.test(html),'checker provenance is not persisted back into tournament engine state');
ok(redesign.includes('window.cpCloudSyncCurrent=syncCurrent;'),'unified SYNC authority remains exported');
ok(redesign.includes('window.cpCloudSyncUnified=syncCurrent;'),'unified compatibility SYNC export remains bound to same authority');
ok(redesign.includes('window.cpCloudDownloadWebResults=downloadWebResults;'),'Pairings SYNC download hook remains exported');
ok(redesign.includes('/cloud-proxy'),'Windows redesign keeps same-origin Cloud proxy transport');
ok(localEngine.includes("$cloudProxyRemoteBase = 'https://chess-publisher-hub-api-beta.kyamranbilyal.workers.dev'"),'LocalEngine proxy keeps fixed Hub Worker target');
ok(localEngine.includes('X-Expected-Revision'),'LocalEngine proxy preserves revision guard header');
const lv=(launcher.match(/^\$serviceVersion\s*=\s*'([^']+)'/m)||[])[1];
const ev=(localEngine.match(/^\$serviceVersion\s*=\s*'([^']+)'/m)||[])[1];
ok(lv==='V140' && ev==='V140' && lv===ev,'Windows launcher and LocalEngine remain locked together at V140');
ok(adapter.includes('window.cpCloudSyncCurrent=syncCurrent;'),'legacy compatibility adapter still exposes canonical SYNC primitive');
ok(redesign.includes('AUTO_SYNC_KEY') && redesign.includes('localStorage.setItem(AUTO_SYNC_KEY,"0")'),'legacy automatic Cloud sync remains disabled');
ok(api.includes('X-Expected-Revision'),'Cloud API keeps guarded write support');
ok(html.includes('onclick="downloadWebEnteredResults()"') && html.includes('window.cpCloudDownloadWebResults'),'visible Pairings ↕ SYNC stays wired to the protected cloud download/sync path');
ok(hub.includes('const ORGANIZER_SECRET_BASE_KEY="organizer-primary";') && hub.includes('function organizerSecretKey()') && hub.includes('window.cpNativeHubSecretGet=') && hub.includes('window.cpNativeHubSecretSet=') && hub.includes('window.cpNativeHubSecretRemove='),'single Organizer Token credential bridge remains present');
ok(manifest.liveWorker?.sha256==='13773e265867f802631d03bcecd8bd259a74f5fdff87fd3fa52a663a5264fa22','freeze records exact user-tested live Worker SHA256');
ok(manifest.releaseGate?.unexpectedFailuresRequired===0,'future release gate requires zero unexpected SYNC failures');
ok(manifest.releaseGate?.realRuntimeConfirmationRequiredAfterAnyApprovedSyncChange===true,'any approved SYNC change requires a new real runtime confirmation');
console.log(`BETA96 ACTIVE SYNC PROTECTED CORE: ${fail?'FAIL':'PASS'} (${pass} PASS / ${fail} FAIL)`);
process.exit(fail?1:0);
