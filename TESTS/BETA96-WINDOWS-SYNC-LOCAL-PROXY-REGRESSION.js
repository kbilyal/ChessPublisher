"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),assert=require("assert");
const root=path.resolve(__dirname,"..");
const redesign=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
const adapter=fs.readFileSync(path.join(root,"webview","CloudWorkspaceAdapter.js"),"utf8");
const apiSrc=fs.readFileSync(path.join(root,"cloud","client","cloud-workspace-api.js"),"utf8");
const engine=fs.readFileSync(path.join(root,"ChessPublisher-LocalEngine.ps1"),"utf8");
let pass=0,fail=0;
function ok(v,msg){try{assert.ok(v);console.log(`PASS ${String(++pass).padStart(2,"0")} ${msg}`);}catch(e){fail++;console.error(`FAIL ${msg}`);}}
function loadRedesign(href){
  let options=null;
  const fake={addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},style:{},classList:{toggle(){},add(){},remove(){}},appendChild(){},insertBefore(){},closest(){return null;},remove(){}};
  const doc={querySelector(){return null;},getElementById(){return null;},createElement(){return {...fake,innerHTML:"",textContent:"",className:"",id:""};},head:fake,body:fake};
  const c={console:{log(){},warn(){},error(){}},URL,location:{href},document:doc,localStorage:{getItem(){return null;},setItem(){}},navigator:{platform:"Win32"},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},Headers,TextEncoder,crypto:require("crypto").webcrypto,data:{currentTournament:"",tournaments:{},preferences:{}},ChessPublisherCloudSyncInternals:{},ChessPublisherCloudWorkspaceApi:{createClient:o=>{options=o;return {};}}};
  c.window=c;c.globalThis=c;
  vm.createContext(c);vm.runInContext(redesign,c);
  return options||{};
}
(async()=>{
  const local=loadRedesign("http://127.0.0.1:18765/ChessPublisher.html");
  ok(local.baseUrl==="http://127.0.0.1:18765/cloud-proxy","Windows 127.0.0.1 WebView selects same-origin LocalEngine Cloud proxy");
  const localhost=loadRedesign("http://localhost:18765/ChessPublisher.html");
  ok(localhost.baseUrl==="http://localhost:18765/cloud-proxy","Windows localhost fallback selects same-origin LocalEngine Cloud proxy");
  const web=loadRedesign("https://web.chess-publisher.org/");
  ok(!Object.prototype.hasOwnProperty.call(web,"baseUrl"),"Web build keeps normal remote Cloud API base and WEB_ORIGIN policy");
  ok(adapter.includes("desktopCloudProxyBase")&&adapter.includes("/cloud-proxy")&&adapter.includes("baseUrl:desktopCloudProxyBase"),"legacy CloudWorkspaceAdapter also selects the LocalEngine proxy for Desktop Cloud calls");

  ok(engine.includes("$cloudProxyRemoteBase = 'https://chess-publisher-hub-api-beta.kyamranbilyal.workers.dev'"),"LocalEngine proxy target is fixed; browser cannot choose an arbitrary remote host");
  ok(engine.includes("function Test-CloudProxyPath")&&engine.includes("cloud_proxy_route_not_allowed"),"LocalEngine has an explicit Cloud route allowlist");
  ok(engine.includes("$method -ne 'GET' -and $method -ne 'POST' -and $method -ne 'PUT'"),"LocalEngine Cloud proxy allows only required GET/POST/PUT methods");
  ok(engine.includes("$Context.Request.Headers['Authorization']")&&engine.includes("StartsWith('Bearer '"),"LocalEngine requires Organizer bearer authorization before proxying");
  ok(engine.includes("$Context.Request.Headers['X-Expected-Revision']")&&engine.includes("invalid_expected_revision"),"revision guard header is validated and forwarded");
  ok(!/Cloud proxy network failure[^\n]*authorization/i.test(engine),"proxy diagnostics never log the bearer authorization value");
  ok(engine.includes("if ($context.Request.Url.AbsolutePath.StartsWith('/cloud-proxy/'"),"LocalEngine request loop dispatches Cloud proxy routes before ordinary service routes");

  const c={module:{exports:{}},exports:{},globalThis:{},Headers,AbortController,setTimeout,clearTimeout};
  c.globalThis=c;vm.createContext(c);vm.runInContext(apiSrc,c);
  const lib=c.module.exports;
  const seen=[];
  const fetchImpl=async(url,init)=>{seen.push({url,init});return {ok:true,status:200,text:async()=>JSON.stringify({ok:true,tournament:{revision:8}})};};
  const api=lib.createClient({baseUrl:"http://127.0.0.1:18765/cloud-proxy",fetchImpl,clientVersion:"1.06.00-beta.96"});
  await api.getCurrentSnapshot("tok","cloud-1");
  await api.putSnapshot("tok",{tournamentId:"cloud-1",baseRevision:7,snapshot:{data:{}},deviceId:"",deviceLabel:"Windows Desktop"});
  ok(seen[0].url==="http://127.0.0.1:18765/cloud-proxy/api/v1/cloud/tournaments/cloud-1/snapshot"&&seen[0].init.method==="GET","Cloud GET is sent to the LocalEngine same-origin proxy");
  ok(seen[1].url==="http://127.0.0.1:18765/cloud-proxy/api/v1/cloud/tournaments/cloud-1"&&seen[1].init.method==="GET","identity-safe PUT performs a same-origin metadata preflight before writing");
  ok(seen[2].url===seen[0].url&&seen[2].init.method==="PUT","Cloud PUT is sent through the same LocalEngine proxy endpoint after identity preflight");
  ok(seen[2].init.headers.get("Authorization")==="Bearer tok","Organizer bearer token is preserved through client-to-LocalEngine request");
  ok(seen[2].init.headers.get("X-Expected-Revision")==="7","expected revision guard is preserved on the proxied PUT");

  console.log(`BETA96 WINDOWS SYNC LOCAL PROXY: ${fail?"FAIL":"PASS"} (${pass} PASS / ${fail} FAIL)`);
  process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
