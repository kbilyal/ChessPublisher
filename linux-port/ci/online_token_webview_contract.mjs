import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../linux/LinuxWebViewShim.js',import.meta.url),'utf8');
const calls=[];const secrets={};const scoped='organizer-primary:install:12345678-abcd';
const document={documentElement:{dataset:{}},body:{appendChild(){}},createElement(){return {style:{}};},querySelector(){return null;},getElementById(){return null;}};
const location={href:'http://127.0.0.1:18765/',origin:'http://127.0.0.1:18765'};
const window={
  fetch:async(url,init={})=>{
    calls.push({url:String(url),init});
    if(String(url)==='/native/secret'){
      const p=JSON.parse(init.body||'{}');
      if(p.operation==='set')secrets[p.key]=p.value;
      if(p.operation==='get')return {ok:true,status:200,json:async()=>({ok:true,found:Object.hasOwn(secrets,p.key),value:secrets[p.key]||''})};
      return {ok:true,status:200,json:async()=>({ok:true})};
    }
    if(String(url).startsWith('/proxy/hub-api/'))return {ok:true,status:200,text:async()=>'{"ok":true}',json:async()=>({ok:true})};
    if(String(url).startsWith('/chessresults/'))return {ok:true,status:200,json:async()=>({ok:true,key:'1'})};
    throw new Error('unexpected '+url);
  },
  open(){return {closed:false,opener:{},location:{href:'about:blank',replace(){}},close(){this.closed=true;}}},
  addEventListener(){},console:{error(){}}
};
window.cpOnlineOrganizerSecretKey=()=>scoped;
const context={window,document,location,URL,console:window.console,setTimeout,clearTimeout,encodeURIComponent,JSON,Number,String,Error,Set,Promise};
vm.createContext(context);vm.runInContext(source,context,{filename:'LinuxWebViewShim.js'});

let secretResult=null;window.chrome.webview.addEventListener('message',e=>{secretResult=e.data;});
window.chrome.webview.postMessage({type:'cp:hub-secret',requestId:'s1',operation:'set',key:scoped,value:'TOKEN-SECRET'});
await new Promise(r=>setTimeout(r,5));
assert.equal(secrets[scoped],'TOKEN-SECRET');assert.equal(secretResult?.ok,true);

await window.fetch('https://chess-publisher-hub-api-beta.kyamranbilyal.workers.dev/api/v1/cloud/workspace',{method:'GET',headers:{Authorization:'Bearer TOKEN-SECRET'}});
assert.equal(calls.at(-1).url,'/proxy/hub-api/api/v1/cloud/workspace');
assert.equal(calls.at(-1).init.headers.Authorization,'Bearer TOKEN-SECRET');

await window.fetch('/chessresults/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tournament:'T',federation:'XXX',mode:'test'})});
const crBody=JSON.parse(calls.at(-1).init.body);
assert.equal(crBody._cpOrganizerSecretKey,scoped);
assert.equal(JSON.stringify(crBody).includes('TOKEN-SECRET'),false);

console.log('LINUX_ORGANIZER_TOKEN_WEBVIEW_CONTRACT=PASS');
await import('./cloud_directional_sync_contract.mjs');
await import('./cloud_directional_sync_spec_contract.mjs');
