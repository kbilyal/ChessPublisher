"use strict";
const fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"ChessPublisher.html"),"utf8");
const hubAdapter=fs.readFileSync(path.join(root,"webview","HubAdapter.js"),"utf8");
const cloudAdapter=fs.readFileSync(path.join(root,"webview","CloudWorkspaceAdapter.js"),"utf8");
const ps=fs.readFileSync(path.join(root,"ChessPublisher-WebView.ps1"),"utf8");
const hubLib=require(path.join(root,"hub","client","hub-api-client.js"));
const cloudLib=require(path.join(root,"cloud","client","cloud-workspace-api.js"));
const snapshotLib=require(path.join(root,"hub","client","hub-snapshot.js"));
const checks=[];
function assert(v,label){checks.push([label,!!v]);console.log(`${v?"PASS":"FAIL"}: ${label}`);if(!v)throw new Error(`FAIL: ${label}`);}
function response(status,payload,headers={}){return {ok:status>=200&&status<300,status,headers:new Headers(headers),async text(){return payload==null?"":JSON.stringify(payload)}};}
(async()=>{
 assert(/data-chesspublisher-version="1\.06\.00-beta\.30"/.test(html),"beta.30 branding is present");
 assert(/WIRE_CLIENT_VERSION=String\(document\.documentElement\?\.dataset\?\.chesspublisherVersion\|\|CLIENT_VERSION\)/.test(hubAdapter),"Hub wire client version follows current application build");
 assert(/WIRE_CLIENT_VERSION=String\(document\.documentElement\?\.dataset\?\.chesspublisherVersion\|\|CLIENT_VERSION\)/.test(cloudAdapter),"Cloud wire client version follows current application build");
 assert(/DEFAULT_REQUEST_TIMEOUT_MS=30000/.test(fs.readFileSync(path.join(root,"hub","client","hub-api-client.js"),"utf8")),"Hub API has bounded default request timeout");
 assert(/UPLOAD_REQUEST_TIMEOUT_MS=120000/.test(fs.readFileSync(path.join(root,"hub","client","hub-api-client.js"),"utf8")),"Regulations upload has bounded extended timeout");
 assert(/DEFAULT_REQUEST_TIMEOUT_MS=45000/.test(fs.readFileSync(path.join(root,"cloud","client","cloud-workspace-api.js"),"utf8")),"Cloud API has bounded request timeout");
 assert(/Promise\.race/.test(fs.readFileSync(path.join(root,"hub","client","hub-api-client.js"),"utf8"))&&/AbortController/.test(fs.readFileSync(path.join(root,"hub","client","hub-api-client.js"),"utf8")),"Hub timeout covers fetch/body via Promise.race + AbortController");
 assert(/Promise\.race/.test(fs.readFileSync(path.join(root,"cloud","client","cloud-workspace-api.js"),"utf8"))&&/AbortController/.test(fs.readFileSync(path.join(root,"cloud","client","cloud-workspace-api.js"),"utf8")),"Cloud timeout covers fetch/body via Promise.race + AbortController");

 // Hub hanging fetch must time out even when the injected fetch ignores AbortSignal.
 const hubHang=hubLib.createClient({baseUrl:"https://example.test",timeoutMs:35,fetchImpl:()=>new Promise(()=>{})});
 let e1=null;try{await hubHang.health();}catch(e){e1=e;}
 assert(e1?.code==="timeout","Hub hanging fetch exits with timeout error");
 // Hub body stall must also be bounded.
 const hubBodyHang=hubLib.createClient({baseUrl:"https://example.test",timeoutMs:35,fetchImpl:async()=>({ok:true,status:200,headers:new Headers(),text:()=>new Promise(()=>{})})});
 let e2=null;try{await hubBodyHang.health();}catch(e){e2=e;}
 assert(e2?.code==="timeout","Hub stalled response body exits with timeout error");
 const cloudHang=cloudLib.createClient({baseUrl:"https://example.test",timeoutMs:35,fetchImpl:()=>new Promise(()=>{})});
 let e3=null;try{await cloudHang.workspace("ORG");}catch(e){e3=e;}
 assert(e3?.code==="timeout","Cloud hanging fetch exits with timeout error");

 // Endpoint/auth contract.
 const calls=[];
 const fetchImpl=async(url,init={})=>{
   const u=new URL(url), headers={};new Headers(init.headers||{}).forEach((v,k)=>headers[k]=v);
   calls.push({path:u.pathname,method:init.method||"GET",headers,body:init.body});
   if(u.pathname==="/api/v1/organizer/me")return response(200,{organizer:{id:"org1",displayName:"Organizer"}});
   if(u.pathname==="/api/v1/organizer/tournaments"&&init.method==="POST")return response(200,{tournament:{id:"hub_X1",publicSlug:"x",revision:0,manageToken:"MAN",ownerId:"org1",ownerBound:true}});
   if(u.pathname.endsWith("/snapshot"))return response(200,{revision:1,checksum:"sum"});
   if(u.pathname.endsWith("/regulations-file")&&init.method==="PUT")return response(200,{regulationsFile:{name:"rules.pdf",size:4,contentType:"application/pdf"}});
   if(init.method==="DELETE")return response(200,{deletedAt:"x",recoveryDays:30});
   if(u.pathname.endsWith("/restore"))return response(200,{ok:true});
   if(u.pathname==="/api/v1/organizer/tournaments")return response(200,{organizer:{id:"org1"},tournaments:[]});
   if(u.pathname==="/api/v1/public/tournaments")return response(200,{tournaments:[]});
   if(u.pathname.startsWith("/api/v1/public/tournaments/"))return response(200,{tournament:{id:"hub_X1"}});
   return response(200,{ok:true,d1:true,b2:true,organizerAuth:true});
 };
 const hub=hubLib.createClient({baseUrl:"https://example.test",clientVersion:"1.06.00-beta.30",fetchImpl});
 await hub.organizerMe("ORG");
 const created=await hub.createOrganizerTournament("ORG",{localKey:"cp:1",name:"T",federation:"BUL",roundsDeclared:7});
 const link=hubLib.publicLinkRecord(created);
 await hub.publishSnapshot({organizerToken:"ORG",manageToken:"MAN",tournamentId:link.hubTournamentId,expectedRevision:0,snapshot:{hello:"world"}});
 const uploadFile=new File([new Uint8Array([1,2,3,4])],"rules.pdf",{type:"application/pdf"});
 await hub.uploadRegulationsFile({organizerToken:"ORG",manageToken:"MAN",tournamentId:link.hubTournamentId,file:uploadFile});
 await hub.listOrganizerTournaments("ORG");
 await hub.deleteTournament({organizerToken:"ORG",manageToken:"MAN",tournamentId:link.hubTournamentId,publicSlug:"x"});
 await hub.restoreTournament({organizerToken:"ORG",manageToken:"MAN",tournamentId:link.hubTournamentId});
 await hub.listPublicTournaments();
 await hub.getPublicTournament("x");
 const pub=calls.find(x=>x.path.endsWith("/snapshot"));
 assert(pub?.headers?.authorization==="Bearer MAN"&&pub?.headers?.["x-organizer-token"]==="ORG","Hub publish uses manage token + organizer token separately");
 assert(calls.every(x=>x.headers["x-client-version"]==="1.06.00-beta.30"),"Hub sends current X-Client-Version on every request");
 const uploadCall=calls.find(x=>x.path.endsWith("/regulations-file"));
 assert(uploadCall?.body instanceof FormData,"Regulations upload uses multipart FormData");
 const delCall=calls.find(x=>x.method==="DELETE");
 assert(delCall?.headers?.["x-confirm-delete"]==="x","Soft delete carries explicit public-slug confirmation");
 assert(calls.some(x=>x.path.endsWith("/restore")),"Restore endpoint is wired");
 assert(calls.some(x=>x.path==="/api/v1/public/tournaments")&&calls.some(x=>x.path==="/api/v1/public/tournaments/x"),"Public list and public tournament reads are wired");
 let tooLarge=null;try{await hub.uploadRegulationsFile({organizerToken:"ORG",manageToken:"MAN",tournamentId:link.hubTournamentId,file:{name:"too-big.bin",size:20*1024*1024+1}});}catch(e){tooLarge=e;}
 assert(/20 MiB/.test(String(tooLarge?.message||"")),"Regulations file over 20 MiB is rejected locally");

 // Snapshot secrets must never be serialized.
 const tournament={settings:{rounds:7,tournamentFormat:"Swiss",pairingSystem:"Dutch",timeControl:"15+5",tournamentRatingType:"Rapid",country:"BUL",organizer:"Organizer"},players:[{localKey:"p1",name:"A",fed:"BUL",rating:1800}],pairings:{liveBoards:{}},regulations:{},schedule:{rows:[]},organizerToken:"ORG",hub:{localKey:"cp:1",manageToken:"MAN"}};
 const snap=snapshotLib.buildSnapshot({tournament,tournamentName:"T",localTournamentId:"cp:1",clientVersion:"1.06.00-beta.30",revision:1,standings:{completed:0,tieList:[],players:[{key:"p1",score:0}]}});
 const snapText=JSON.stringify(snap);
 assert(!snapText.includes("ORG")&&!snapText.includes("MAN"),"Hub public snapshot excludes organizer/manage credentials");

 // Native installation scoping must not depend only on persistent WebView localStorage.
 assert(/function Get-WvInstallationScopeId\(\)/.test(ps),"Native installation-scope function exists");
 assert(/CreationTimeUtc\.Ticks/.test(ps)&&/GetFullPath\(\$root\)/.test(ps),"Native installation fingerprint uses app root + root creation time");
 assert(/organizer-install:' \+ \(Get-WvInstallationScopeId\)/.test(ps),"Organizer secret path is rebound to native installation fingerprint");
 assert(/\$key = \(\[string\]\$msg\.key\)\.Trim\(\)/.test(ps),"Native bridge preserves logical organizer key until installation scoping");
 assert(/Get-WvSafeHubSecretKey/.test(ps)&&/ProtectedData\]::Protect/.test(ps),"DPAPI and safe filename mapping remain intact");

 assert(/const degraded=!result\?\.ok\|\|result\?\.d1===false\|\|result\?\.b2===false\|\|result\?\.organizerAuth===false/.test(hubAdapter),"Hub health treats D1/B2/auth failures as degraded");
 assert(/Save & Sync Web is private Desktop ↔ Web sync/.test(hubAdapter)&&/Public Tournament Hub/.test(hubAdapter),"Private Cloud and public Hub remain explicitly separated");
 assert(!/searchParams\.set\([^\n]*(?:token|organizer)/i.test(cloudAdapter),"Organizer Token is not placed in Web URLs");

 console.log(`BETA30 ONLINE HUB RELIABILITY REGRESSION: ${checks.length}/${checks.length} PASS`);
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
