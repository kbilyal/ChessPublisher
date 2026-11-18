'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const launcher=fs.readFileSync(path.join(root,'ChessPublisher-WebView.ps1'),'utf8');
const engine=fs.readFileSync(path.join(root,'ChessPublisher-LocalEngine.ps1'),'utf8');
let pass=0, fail=0;
function assert(cond,msg){
  if(cond){console.log('PASS - '+msg);pass++;}
  else{console.error('FAIL - '+msg);fail++;}
}
function serviceVersion(text){
  const m=text.match(/^\$serviceVersion\s*=\s*'([^']+)'/m);
  return m&&m[1];
}
const lv=serviceVersion(launcher);
const ev=serviceVersion(engine);
assert(!!lv,'launcher declares serviceVersion');
assert(!!ev,'LocalEngine declares serviceVersion');
assert(lv===ev,`launcher and LocalEngine serviceVersion match (${lv} === ${ev})`);
assert(lv==='V140','r3 Windows LocalEngine transport contract is V140');
assert(/\$r\.serviceVersion\s*-eq\s*\$serviceVersion/.test(launcher),'launcher health gate validates exact serviceVersion');
assert(/Send-JsonResponse\s+\$context\s+200\s+@\{[^\n]*serviceVersion\s*=\s*\$serviceVersion/.test(engine),'LocalEngine /health publishes serviceVersion');
assert(/LocalEngine PowerShell parser error\(s\)/.test(launcher),'launcher keeps explicit LocalEngine parser diagnostics');
assert(/Start-EngineInProcess/.test(launcher) && /Start-EngineDirectProcess/.test(launcher),'launcher retains runspace and process startup fallbacks');
assert(/\/cloud-proxy\//.test(engine),'LocalEngine retains same-origin Cloud proxy route');
assert(/chess-publisher-hub-api-beta\.kyamranbilyal\.workers\.dev/.test(engine),'LocalEngine proxy remains pinned to Hub Worker');
console.log(`BETA96_R3_STARTUP_CONTRACT: ${pass} PASS / ${fail} FAIL`);
if(fail) process.exit(1);
