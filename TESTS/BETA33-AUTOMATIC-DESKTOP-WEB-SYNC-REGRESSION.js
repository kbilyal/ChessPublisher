const fs=require('fs'); const path=require('path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
const cloud=fs.readFileSync(path.join(root,'webview','CloudWorkspaceAdapter.js'),'utf8');
function ok(c,m){if(!c)throw new Error(m);}
ok(cloud.includes('localStorage.getItem(AUTO_SYNC_KEY)!=="0"'),'auto sync is not default-on');
ok(html.includes('New tournament automatic Cloud sync:'),'new tournament immediate cloud sync missing');
ok(html.includes('window.cpCloudSyncCurrent({force:true,quiet:true,allowPull:false})'),'new tournament safe sync call missing');
ok(html.includes('Tournament-open automatic Cloud sync:'),'open/switch auto cloud sync missing');
ok(html.includes('window.cpCloudSyncCurrent({quiet:true,allowPull:false})'),'open/switch no-pull sync missing');
ok(!html.includes('window.cpCloudSyncCurrent({quiet:true,allowPull:true})'),'unsafe automatic pull introduced');
console.log('BETA33 automatic desktop/web sync regression: PASS');
