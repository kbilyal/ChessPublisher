const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
const cloud=fs.readFileSync(path.join(root,'webview','CloudWorkspaceRedesign.js'),'utf8');
let pass=0,fail=0;
function check(c,m){if(c){console.log('PASS',m);pass++;}else{console.error('FAIL',m);fail++;}}
check(/id="pairingsDownloadWebResultsBtn"[^>]*class="primary"[^>]*onclick="downloadWebEnteredResults\(\)"[^>]*>↕ SYNC<\/button>/.test(html),'Pairings exposes blue SYNC');
check(/async function downloadWebEnteredResults\(\)/.test(html),'Pairings SYNC keeps result-aware wrapper');
check(/window\.cpCloudDownloadWebResults=downloadWebResults/.test(cloud),'result-aware Cloud API remains exported');
check(/async function syncCurrentFromList\(\)\{[\s\S]*?const result=await downloadWebResults\(\);[\s\S]*?await refreshSimpleCloudList\(\);/.test(cloud),'My Cloud Tournaments SYNC uses same result-aware pipeline');
check(/async function downloadWebResults\(\)[\s\S]*?const plan=planWebResultDownload\(t,rt\.tournament\);/.test(cloud),'result-aware pipeline plans validated Web/arbiter result download');
check(/for\(const op of plan\.operations\)applyRemoteResultState\(op\.target,op\.remoteState\);/.test(cloud),'validated Web/arbiter results are applied to matched local boards');
check((cloud.match(/const synced=await syncCurrent\(\)/g)||[]).length>=2,'result-aware pipeline still ends in the existing unified SYNC');
console.log(`BETA82 ALL SYNC WEB RESULTS: ${fail?'FAIL':'PASS'} (${pass} PASS / ${fail} FAIL)`);
process.exit(fail?1:0);
