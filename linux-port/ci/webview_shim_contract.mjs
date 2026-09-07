import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../linux/LinuxWebViewShim.js', import.meta.url),'utf8');
assert(!/CHESS_RESULTS_AES_KEY|CHESS_RESULTS_AES_IV|sidEncrypt/i.test(source),'browser shim must not contain Chess-Results crypto');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function makeEnv(handler){
  const calls=[]; const opened=[];
  const popupFactory=()=>{
    const p={closed:false,opener:{},url:'about:blank',location:{href:'about:blank',replace(url){p.url=url;this.href=url;}},close(){this.closed=true;}};
    opened.push(p); return p;
  };
  const document={documentElement:{dataset:{}},body:{appendChild(){}},createElement(){return {style:{}};}};
  const window={
    __cpLinuxWebViewShimLoaded:false,
    fetch:async (url,init={})=>{calls.push({url:String(url),init}); return handler(String(url),init,calls);},
    open:popupFactory,
    addEventListener(){},
    console:{error(){}},
  };
  const context={window,document,URL,console:window.console,setTimeout,clearTimeout,encodeURIComponent,JSON,Number,String,Error,Set,Promise};
  vm.createContext(context); vm.runInContext(source,context,{filename:'LinuxWebViewShim.js'});
  return {window,calls,opened};
}

{
  const env=makeEnv(async()=>({ok:true,status:200,json:async()=>({ok:true,url:'https://chess-results.example/UploadData.aspx?sid=fresh'})}));
  env.window.chrome.webview.postMessage('cp:cr-upload:12345:1');
  await sleep(5);
  assert.equal(env.calls[0].url,'/chessresults/admin-link');
  assert.deepEqual(JSON.parse(env.calls[0].init.body),{key:'12345',language:1,section:'upload'});
  assert.match(env.opened[0].url,/UploadData\.aspx/);
  assert.equal(env.opened[0].opener,null);
}

{
  const env=makeEnv(async(url)=>{
    if(url.endsWith('/delete-authorize'))return {ok:true,status:200,json:async()=>({ok:true,canDelete:true,alreadyDeleted:true})};
    if(url.endsWith('/unlink'))return {ok:true,status:200,json:async()=>({ok:true,canUnlink:true})};
    throw new Error('unexpected '+url);
  });
  let message=null; env.window.chrome.webview.addEventListener('message',e=>{message=e.data;});
  env.window.chrome.webview.postMessage({type:'cp:cr-delete',requestId:'r1',key:'99',clientId:'cid',language:1});
  await sleep(5);
  assert.equal(env.calls.length,2);
  assert.equal(message?.ok,true); assert.equal(message?.deleted,true); assert.equal(message?.alreadyDeleted,true);
  assert.equal(env.opened[0].closed,true);
}

{
  const env=makeEnv(async()=>({ok:true,status:200,json:async()=>({ok:true,canDelete:true,alreadyDeleted:false,adminUrl:'https://chess-results.example/Admin.aspx?sid=fresh'})}));
  let message=null; env.window.chrome.webview.addEventListener('message',e=>{message=e.data;});
  env.window.chrome.webview.postMessage({type:'cp:cr-delete',requestId:'r2',key:'77',clientId:'cid',language:1});
  await sleep(5);
  assert.equal(env.calls.length,1);
  assert.equal(message?.ok,false); assert.equal(message?.manual,true); assert.equal(message?.deleted,false);
  assert.match(message?.error||'',/local TNR was kept/i);
  assert.match(env.opened[0].url,/Admin\.aspx/);
}

console.log('LINUX_WEBVIEW_SHIM_CONTRACT=PASS');
