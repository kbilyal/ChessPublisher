import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../linux/LinuxWebViewShim.js', import.meta.url),'utf8');
const calls=[];
const document={documentElement:{dataset:{}},body:{appendChild(){}},createElement(){return {style:{}};},querySelector(){return null;},getElementById(){return null;}};
const window={
  __cpLinuxWebViewShimLoaded:false,
  fetch:async(url,init={})=>{calls.push({url:String(url),init}); return {ok:true,status:200,json:async()=>({ok:true,result:{message_id:1}})};},
  open(){return null;},addEventListener(){},console:{error(){}}
};
const context={window,document,URL,console:window.console,setTimeout,clearTimeout,encodeURIComponent,JSON,Number,String,Error,Set,Promise};
vm.createContext(context);vm.runInContext(source,context,{filename:'LinuxWebViewShim.js'});
const token='123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghi';
const response=await window.fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:'@channel',text:'hello'})
});
assert.equal(response.ok,true);
assert.equal(calls.length,1);
assert.equal(calls[0].url,'/telegram/send-message');
const body=JSON.parse(calls[0].init.body);
assert.equal(body.token,token);
assert.deepEqual(body.payload,{chat_id:'@channel',text:'hello'});
assert(!source.includes('bot123456789:'),'shim must not contain a concrete Telegram token');
console.log('TELEGRAM_WEBVIEW_PROXY_CONTRACT=PASS');
