const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
const cloud=fs.readFileSync(path.join(root,'webview','CloudWorkspaceRedesign.js'),'utf8');
let pass=0, fail=0;
function check(cond,msg){ if(cond){console.log('PASS',msg);pass++;} else {console.error('FAIL',msg);fail++;} }
check(/id="pairingsDownloadWebResultsBtn"[^>]*class="primary"[^>]*onclick="downloadWebEnteredResults\(\)"[^>]*>↕ SYNC<\/button>/.test(html),'Pairings results button is the blue SYNC button');
check(!/>↓ Download Results<\/button>/.test(html),'old Download Results label is removed from Pairings UI');
check(/async function downloadWebEnteredResults\(\)/.test(html),'existing validated Web-results wrapper is preserved');
check(/window\.cpCloudDownloadWebResults=downloadWebResults/.test(cloud),'existing results-only Cloud API is preserved');
check(/window\.cpCloudSyncUnified=syncCurrent/.test(cloud),'existing unified SYNC API is preserved');
check((cloud.match(/const synced=await syncCurrent\(\)/g)||[]).length>=2,'results download still completes the same unified SYNC workflow');
const vm=html.match(/data-chesspublisher-version="1\.06\.00-beta\.(\d+)(?:-r\d+)?"/);
check(html.includes('data-chesspublisher-version="1.06.00"')||(!!vm&&Number(vm[1])>=79),'HTML version is beta.79 or later, or stable 1.06.00');
console.log(`BETA79 PAIRINGS SYNC BUTTON: ${fail?'FAIL':'PASS'} (${pass} PASS / ${fail} FAIL)`);
process.exit(fail?1:0);
