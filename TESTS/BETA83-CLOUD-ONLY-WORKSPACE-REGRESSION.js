const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
let pass=0,fail=0;
function check(ok,msg){if(ok){console.log('PASS:',msg);pass++;}else{console.error('FAIL:',msg);fail++;}}
const cloud=fs.readFileSync(path.join(root,'webview','CloudWorkspaceRedesign.js'),'utf8');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
const hub=fs.readFileSync(path.join(root,'webview','HubAdapter.js'),'utf8');
check(/\.hub-online-list-compact\{display:none!important\}/.test(cloud),'My Online Tournaments section is hidden completely');
check(/\.cp-new-tournament-online,#cpNewTournamentOnlinePanel\{display:none!important\}/.test(cloud),'New Tournament online chooser/panel are hidden');
check(/title\.textContent="My Cloud Tournaments"/.test(cloud),'My Cloud Tournaments remains the visible private workspace');
check(/sync\.textContent="↕ SYNC"/.test(cloud),'My Cloud Tournaments unified SYNC remains present');
check(/const result=await downloadWebResults\(\);/.test(cloud),'result-aware SYNC pipeline remains present');
check(/<div class="hub-section-eyebrow">Public list<\/div><div class="group-title">My Online Tournaments<\/div>/.test(hub),'protected HubAdapter markup remains unchanged internally');
{ const m=html.match(/data-chesspublisher-version="1\.06\.00-beta\.(\d+)(?:-r\d+)?"/); check(Boolean(m)&&Number(m[1])>=83,'beta.83+ version marker is set'); }
console.log(`BETA83 CLOUD ONLY WORKSPACE: ${fail?'FAIL':'PASS'} (${pass} PASS / ${fail} FAIL)`);process.exitCode=fail?1:0;
