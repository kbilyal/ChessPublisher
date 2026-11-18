"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto"),assert=require("assert");
const root=path.resolve(__dirname,"..");
const adapterSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceAdapter.js"),"utf8");
const redesignSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
let pass=0,fail=0;
function ok(v,msg){try{assert.ok(v);console.log(`PASS ${String(++pass).padStart(2,"0")} ${msg}`);}catch(e){fail++;console.error(`FAIL ${msg}`);}}
function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}
function makeContext(api,tournament){
  const data={currentTournament:tournament.name,tournaments:{[tournament.name]:tournament},preferences:{}};
  const fakeEl={addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},style:{},classList:{toggle(){}},appendChild(){},insertBefore(){},closest(){return null;}};
  const document={documentElement:{dataset:{chesspublisherVersion:"1.06.00-beta.96"}},querySelector(){return null;},getElementById(){return null;},createElement(){return {...fakeEl,innerHTML:"",id:"",className:"",remove(){}};},head:fakeEl,body:fakeEl};
  const context={console:{log(){},info(){},warn(){},error(){}},crypto:crypto.webcrypto,TextEncoder,Headers,URL,navigator:{platform:"Win32"},document,localStorage:{getItem(){return null;},setItem(){}},data,stateDirty:false,
    location:{href:"http://127.0.0.1:18765/ChessPublisher.html",protocol:"http:",hostname:"127.0.0.1",origin:"http://127.0.0.1:18765"},
    getCurrentTournament:()=>data.tournaments[data.currentTournament],
    getPersistentSnapshot:()=>({version:"V99",data:clone(data),telegramGlobal:{},currentTournament:data.currentTournament,preferences:{}}),
    cpSnapshotForExternalFile:v=>clone(v),saveAll(){},fileSaveTournament:async()=>true,saveData(){},normalizeData(){},refreshEverything(){},cpResetTournamentDocumentBinding(){},
    cpValidateSnapshotStructure:()=>true,showTab(){},prepareCurrentTournamentForTransition:async()=>true,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},alert(){},confirm:()=>true
  };
  context.window=context;context.globalThis=context;
  context.ChessPublisherCloudWorkspaceApi={createClient:()=>api,CloudWorkspaceApiError:class extends Error{constructor(m,d={}){super(m);Object.assign(this,d);}}};
  context.cpNativeHubSecretGet=async()=>"token";context.cpOnlineOrganizerSecretKey=()=>"organizer-primary:test";
  vm.createContext(context);vm.runInContext(adapterSrc,context,{filename:"CloudWorkspaceAdapter.js"});vm.runInContext(redesignSrc,context,{filename:"CloudWorkspaceRedesign.js"});
  return context;
}
(async()=>{
  let createCount=0,putCount=0,listCount=0,getCount=0;
  const local={name:"Shared Event",settings:{city:"Sofia",rounds:7},players:[{id:"p1",name:"Alpha"}],pairings:{liveBoards:{}},cloud:{schemaVersion:4,localKey:"cp-cloud:desktop-install-key",internalId:"cp-tournament:desktop-generated-legacy",cloudTournamentId:"cloud-web-1",revision:5,baseRevision:5,fingerprintContentSchema:7,baseFingerprint:"",lastSyncedContentHash:""}};
  const remotePortable={name:"Shared Event",settings:{city:"Sofia",rounds:7},players:[{id:"p1",name:"Alpha"}],pairings:{liveBoards:{}},cloud:{schemaVersion:4,internalId:"hub-shared-42",cloudTournamentId:"cloud-web-1"}};
  const api={
    listTournaments:async()=>{listCount++;return {tournaments:[{id:"cloud-web-1",localKey:"hub-shared-42",name:"Shared Event",revision:5,checksum:"c5",updatedAt:"2026-09-10T17:00:00Z"}]};},
    listArchivedTournaments:async()=>({tournaments:[]}),
    restoreArchivedTournament:async()=>{throw new Error("unexpected restore");},
    createTournament:async()=>{createCount++;return {tournament:{id:"duplicate-cloud",localKey:"cp-tournament:desktop-generated-legacy",name:"Shared Event",revision:0}};},
    getCurrentSnapshot:async(_token,id)=>{getCount++;if(id!=="cloud-web-1"){const e=new Error("not found");e.status=404;e.code="not_found";throw e;}return {tournament:{id:"cloud-web-1",localKey:"hub-shared-42",name:"Shared Event",revision:5,checksum:"c5",updatedAt:"2026-09-10T17:00:00Z"},snapshot:{version:"V99",data:{currentTournament:"Shared Event",tournaments:{"Shared Event":clone(remotePortable)},preferences:{}},currentTournament:"Shared Event",preferences:{},telegramGlobal:{},cloudWorkspace:{schemaVersion:5,scope:"single-tournament",private:true,internalId:"hub-shared-42",cloudTournamentId:"cloud-web-1",fingerprintContentSchema:7}}};},
    putSnapshot:async()=>{putCount++;throw new Error("equal tournament must not PUT");},
    listRevisions:async()=>({revisions:[]}),getRevision:async()=>{throw new Error("history not needed");}
  };
  const ctx=makeContext(api,clone(local));
  const result=await ctx.cpCloudSyncCurrent();
  const meta=ctx.getCurrentTournament().cloud;
  ok(result?.ok===true&&result?.unchanged===true,"SYNC converges against the saved Web-created Cloud row");
  ok(meta.cloudTournamentId==="cloud-web-1","saved organizer-scoped cloudTournamentId is preserved");
  ok(meta.internalId==="hub-shared-42","generated/legacy Desktop internalId is repaired from the exact saved Cloud row localKey");
  ok(createCount===0,"identity repair creates zero duplicate Cloud tournaments");
  ok(putCount===0,"equal repaired state causes zero revision churn");
  ok(listCount>=1&&getCount>=1,"SYNC performs authoritative organizer list + current snapshot reads");
  console.log(`BETA96 R4 SAVED CLOUD IDENTITY REPAIR: ${fail?"FAIL":"PASS"} (${pass} PASS / ${fail} FAIL)`);
  process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
