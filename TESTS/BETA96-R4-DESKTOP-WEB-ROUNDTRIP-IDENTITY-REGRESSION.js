"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto"),assert=require("assert");
const root=path.resolve(__dirname,"..");
const adapterSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceAdapter.js"),"utf8");
const redesignSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
let pass=0,fail=0;
function ok(v,msg){try{assert.ok(v);console.log(`PASS ${String(++pass).padStart(2,"0")} ${msg}`);}catch(e){fail++;console.error(`FAIL ${msg}`);}}
function eq(a,b,msg){try{assert.deepStrictEqual(a,b);console.log(`PASS ${String(++pass).padStart(2,"0")} ${msg}`);}catch(e){fail++;console.error(`FAIL ${msg}: ${e.message}`);}}
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
function snapshotOf(tournament,internalId="hub-shared-42",cloudId="cloud-web-1"){
  const t=clone(tournament);t.cloud={schemaVersion:4,internalId,cloudTournamentId:cloudId};
  return {version:"V99",data:{currentTournament:t.name,tournaments:{[t.name]:t},preferences:{}},currentTournament:t.name,preferences:{},telegramGlobal:{},cloudWorkspace:{schemaVersion:5,scope:"single-tournament",private:true,internalId,cloudTournamentId:cloudId,fingerprintContentSchema:7}};
}
(async()=>{
  let revision=5,createCount=0,putCount=0,getCount=0,listCount=0;
  const base={name:"Shared Event",settings:{city:"Sofia",rounds:7},schedule:[{round:1,date:"2026-10-01",time:"10:00"}],players:[{id:"p1",name:"Alpha"}],pairings:{liveBoards:{}}};
  let remoteSnapshot=snapshotOf(base);
  const remoteMeta=()=>({id:"cloud-web-1",localKey:"hub-shared-42",name:"Shared Event",revision,checksum:`c${revision}`,updatedAt:`2026-09-10T17:${String(revision).padStart(2,"0")}:00Z`});
  const api={
    listTournaments:async()=>{listCount++;return {tournaments:[remoteMeta()]};},
    listArchivedTournaments:async()=>({tournaments:[]}),restoreArchivedTournament:async()=>{throw new Error("unexpected restore");},
    createTournament:async()=>{createCount++;throw new Error("duplicate CREATE must never occur");},
    getCurrentSnapshot:async(_token,id)=>{getCount++;if(id!=="cloud-web-1"){const e=new Error("not found");e.status=404;e.code="not_found";throw e;}return {tournament:remoteMeta(),snapshot:clone(remoteSnapshot)};},
    putSnapshot:async(_token,args)=>{
      if(args.tournamentId!=="cloud-web-1")throw new Error("wrong Cloud row");
      if(args.baseRevision!==revision){const e=new Error("revision conflict");e.status=409;e.code="cloud_revision_conflict";e.currentRevision=revision;throw e;}
      putCount++;revision++;remoteSnapshot=clone(args.snapshot);
      return {revision,cloudTournamentId:"cloud-web-1",internalId:"hub-shared-42",checksum:`c${revision}`,updatedAt:`2026-09-10T17:${String(revision).padStart(2,"0")}:00Z`};
    },
    listRevisions:async()=>({revisions:[]}),getRevision:async()=>{throw new Error("history not required in this linear round-trip");}
  };
  const desktop={...clone(base),cloud:{schemaVersion:4,localKey:"cp-cloud:desktop-install-key",internalId:"cp-tournament:desktop-generated-legacy",cloudTournamentId:"cloud-web-1",revision:5,baseRevision:5,fingerprintContentSchema:7,baseFingerprint:"",lastSyncedContentHash:""}};
  const ctx=makeContext(api,desktop);

  const repair=await ctx.cpCloudSyncCurrent();
  ok(repair?.ok===true&&repair?.unchanged===true,"phase 1: Desktop adopts the exact saved Web Cloud identity and converges without a write");
  eq(ctx.getCurrentTournament().cloud.cloudTournamentId,"cloud-web-1","phase 1: Cloud provider ID remains the original Web-created row");
  eq(ctx.getCurrentTournament().cloud.internalId,"hub-shared-42","phase 1: generated Desktop internal ID is repaired to the row's stable identity");
  eq([createCount,putCount],[0,0],"phase 1: identity repair creates no duplicate and no revision churn");

  ctx.getCurrentTournament().settings.city="Plovdiv";
  const pushed=await ctx.cpCloudSyncCurrent();
  ok(pushed?.ok===true&&pushed?.revision===6,"phase 2: Desktop-only edit pushes to revision 6");
  eq([createCount,putCount],[0,1],"phase 2: Desktop uses the same row and performs exactly one PUT");
  const pushedRemote=remoteSnapshot.data.tournaments[remoteSnapshot.data.currentTournament];
  eq(pushedRemote.settings.city,"Plovdiv","phase 2: authoritative Cloud snapshot contains the Desktop edit");
  eq(remoteSnapshot.cloudWorkspace.cloudTournamentId,"cloud-web-1","phase 2: outbound snapshot keeps original Cloud identity");

  // Simulate a real Web-only edit on the same Cloud row after it reads r6.
  const webName=remoteSnapshot.data.currentTournament;
  remoteSnapshot.data.tournaments[webName].schedule[0].time="14:30";
  revision=7;
  const beforePullPutCount=putCount;
  const pulled=await ctx.cpCloudSyncCurrent();
  ok(pulled?.ok===true&&(pulled?.pulled===true||pulled?.state==="IN_SYNC"),"phase 3: Web-only r7 edit is pulled back to Desktop by the same SYNC authority");
  eq(ctx.getCurrentTournament().schedule[0].time,"14:30","phase 3: Desktop contains the Web-only schedule edit");
  eq(ctx.getCurrentTournament().settings.city,"Plovdiv","phase 3: Web pull preserves the prior Desktop edit already accepted at r6");
  eq(ctx.getCurrentTournament().cloud.cloudTournamentId,"cloud-web-1","phase 3: Desktop remains on the same Cloud row after Web → Desktop pull");
  eq(ctx.getCurrentTournament().cloud.baseRevision,7,"phase 3: durable common base advances to Web revision 7");
  eq(putCount,beforePullPutCount,"phase 3: Cloud-only pull performs zero PUTs and no revision churn");
  ok(listCount>=3&&getCount>=4,"all phases use authoritative organizer list/current snapshot reads rather than cached name matching");

  console.log(`BETA96 R4 DESKTOP-WEB ROUNDTRIP IDENTITY: ${fail?"FAIL":"PASS"} (${pass} PASS / ${fail} FAIL)`);
  process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
