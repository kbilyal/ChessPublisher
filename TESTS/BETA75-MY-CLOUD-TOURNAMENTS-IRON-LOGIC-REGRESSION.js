"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto");
const root=path.resolve(__dirname,"..");
const adapterSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceAdapter.js"),"utf8");
const dirSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
let pass=0,fail=0;
function check(cond,label){if(cond){console.log(`PASS: ${label}`);pass++;}else{console.error(`FAIL: ${label}`);fail++;}}
function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}
function notFound(){const e=new Error("not found");e.status=404;e.code="not_found";return e;}

check(/title\.textContent="My Cloud Tournaments"/.test(dirSrc),"Cloud workspace is renamed My Cloud Tournaments at runtime");
check(/cloudUploadCurrentBtn/.test(dirSrc)&&/↑ Upload Current/.test(dirSrc),"single-list UI exposes Upload Current");
check(/cloudPullCurrentBtn/.test(dirSrc)&&/↓ Pull Current/.test(dirSrc),"single-list UI exposes Pull Current");
check(/for\(const child of Array\.from\(page\.children\)\)if\(child!==listSection\)child\.style\.display="none"/.test(dirSrc),"all legacy Cloud dashboard sections are hidden except My Cloud Tournaments");
check(/while\(row\.children\.length>4\)row\.lastElementChild\.remove\(\)/.test(dirSrc)&&/MutationObserver/.test(dirSrc),"legacy History column is removed from the visible My Cloud Tournaments table and kept removed after refresh");
check(/stale metadata, not a Cloud conflict/.test(dirSrc),"stale provider metadata is explicitly not treated as a Cloud conflict");
check(/Multiple entries in My Cloud Tournaments share this tournament's internal ID/.test(dirSrc),"ambiguous duplicate internal IDs fail closed");

function makeContext(api,tournament){
  const data={currentTournament:tournament.name,tournaments:{[tournament.name]:tournament},preferences:{}};
  const fakeEl={addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},style:{},classList:{toggle(){}},appendChild(){},insertBefore(){},closest(){return null;}};
  const document={querySelector(){return null;},getElementById(){return null;},createElement(){return {...fakeEl,innerHTML:"",id:"",className:"",remove(){}};},head:fakeEl,body:fakeEl};
  const context={console:{log(){},warn(){},error(){}},crypto:crypto.webcrypto,TextEncoder,Headers,URL,navigator:{platform:"Win32"},document,localStorage:{getItem(){return null;},setItem(){}},data,stateDirty:false,
    getCurrentTournament:()=>data.tournaments[data.currentTournament],
    getPersistentSnapshot:()=>({version:"V99",data:clone(data),telegramGlobal:{},currentTournament:data.currentTournament,preferences:{}}),
    cpSnapshotForExternalFile:v=>clone(v),saveAll(){},fileSaveTournament:async()=>true,saveData(){},normalizeData(){},refreshEverything(){},cpResetTournamentDocumentBinding(){},
    cpValidateSnapshotStructure:()=>true,showTab(){},prepareCurrentTournamentForTransition:async()=>true,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},location:{href:""},alert(){},confirm:()=>true
  };
  context.window=context;context.globalThis=context;
  context.ChessPublisherCloudWorkspaceApi={createClient:()=>api,CloudWorkspaceApiError:class extends Error{constructor(m,d={}){super(m);Object.assign(this,d);}}};
  context.cpNativeHubSecretGet=async()=>"token";context.cpOnlineOrganizerSecretKey=()=>"organizer-primary:test";
  vm.createContext(context);vm.runInContext(adapterSrc,context,{filename:"CloudWorkspaceAdapter.js"});
  vm.runInContext(dirSrc,context,{filename:"CloudWorkspaceRedesign.js"});
  return context;
}
function baseTournament(){return {name:"Iron Open",settings:{city:"Sofia",rounds:7},players:[{id:"p1",name:"A"}],pairings:{liveBoards:{}},cloud:{schemaVersion:4,localKey:"local-install",internalId:"internal-A",cloudTournamentId:"ghost-old",revision:5,baseRevision:5,baseFingerprint:"old-base",lastSyncedContentHash:"old-base",lastSyncedHash:"old-check"}};}

(async()=>{
  // Pure identity plan from the actual adapter export.
  {
    const api={listTournaments:async()=>({tournaments:[]})};
    const ctx=makeContext(api,baseTournament());const core=ctx.ChessPublisherCloudSyncInternals,dir=ctx.ChessPublisherCloudDirectionalInternals;
    const meta=core.ensureCloudMeta(ctx.getCurrentTournament());
    check(dir.resolveIdentity(meta,[]).state==="STALE","saved ID absent from Cloud list is classified STALE");
    check(dir.resolveIdentity(meta,[{id:"correct",localKey:"internal-A",revision:2}]).state==="RELINK","unique internalId match repairs stale provider ID");
    check(dir.resolveIdentity(meta,[{id:"a",localKey:"internal-A"},{id:"b",localKey:"internal-A"}]).state==="AMBIGUOUS","duplicate internalId is ambiguous and never guessed");
  }

  // User-reported case: local stale r5 metadata, but tournament does not exist remotely.
  {
    let created=0,puts=0,remote=null;
    const api={
      listTournaments:async()=>({tournaments:remote?[{id:"cloud-new",localKey:"internal-A",revision:remote.revision,checksum:remote.checksum,updatedAt:remote.updatedAt}]:[]}),
      getTournament:async(_t,id)=>{if(id==="ghost-old")throw notFound();return {tournament:{id:"cloud-new",localKey:"internal-A",revision:remote?.revision||0}};},
      createTournament:async()=>{created++;return {tournament:{id:"cloud-new",localKey:"internal-A",revision:0}};},
      getCurrentSnapshot:async(_t,id)=>{if(id==="ghost-old"||!remote)throw notFound();return {tournament:{id:"cloud-new",localKey:"internal-A",revision:remote.revision,checksum:remote.checksum,updatedAt:remote.updatedAt},snapshot:clone(remote.snapshot)};},
      putSnapshot:async(_t,args)=>{puts++;check(args.tournamentId==="cloud-new","stale saved ID is never used for upload");check(args.baseRevision===0,"new Cloud tournament uploads from revision 0 after stale metadata reset");remote={revision:1,snapshot:clone(args.snapshot),checksum:"c1",updatedAt:"2026-09-09T10:00:00Z"};return {revision:1,checksum:"c1",updatedAt:remote.updatedAt};}
    };
    const ctx=makeContext(api,baseTournament());const result=await ctx.cpCloudPushDesktopToCloud();const meta=ctx.getCurrentTournament().cloud;
    check(result.ok===true&&result.revision===1,"missing remote is uploaded successfully instead of producing a false conflict");
    check(created===1&&puts===1,"missing remote creates exactly one Cloud tournament and one snapshot");
    check(meta.cloudTournamentId==="cloud-new"&&meta.baseRevision===1,"Desktop relinks to the newly created Cloud tournament and establishes a fresh base");
    check(meta.baseFingerprint!=="old-base"&&meta.lastSyncedContentHash!=="old-base","obsolete r5 fingerprint/base metadata is discarded");
  }


  // Orphan backend snapshot must NOT resurrect a Cloud tournament that is absent from My Cloud Tournaments.
  {
    let created=0,puts=0,directReads=0,remote=null;
    const api={
      listTournaments:async()=>({tournaments:remote?[{id:"cloud-new",localKey:"internal-A",revision:remote.revision,checksum:remote.checksum,updatedAt:remote.updatedAt}]:[]}),
      getTournament:async(_t,id)=>{directReads++;if(id==="ghost-old")return {tournament:{id:"ghost-old",localKey:"internal-A",revision:5}};throw notFound();},
      createTournament:async()=>{created++;return {tournament:{id:"cloud-new",localKey:"internal-A",revision:0}};},
      getCurrentSnapshot:async(_t,id)=>{if(id==="ghost-old"){directReads++;return {tournament:{id:"ghost-old",localKey:"internal-A",revision:5,checksum:"old"},snapshot:{version:"V99",data:{currentTournament:"Old",tournaments:{Old:{name:"Old"}}}}};}if(!remote)throw notFound();return {tournament:{id:"cloud-new",localKey:"internal-A",revision:remote.revision,checksum:remote.checksum,updatedAt:remote.updatedAt},snapshot:clone(remote.snapshot)};},
      putSnapshot:async(_t,args)=>{puts++;check(args.tournamentId==="cloud-new","orphan direct snapshot ID is not reused");check(args.baseRevision===0,"orphan direct snapshot cannot carry old revision into new upload");remote={revision:1,snapshot:clone(args.snapshot),checksum:"c76",updatedAt:"2026-09-09T13:30:00Z"};return {revision:1,checksum:"c76",updatedAt:remote.updatedAt};}
    };
    const ctx=makeContext(api,baseTournament());const result=await ctx.cpCloudPushDesktopToCloud();
    check(result.ok===true&&result.revision===1,"orphan backend snapshot is ignored when row is absent from My Cloud Tournaments");
    check(created===1&&puts===1,"absent organizer-list row is recreated exactly once");
    check(directReads===0,"stale saved provider ID is never direct-read after authoritative list miss");
  }

  // Same logical tournament exists under a different provider ID: relink, never duplicate.
  {
    let created=0,puts=0;let remoteSnapshot=null;
    const local=baseTournament();
    const api={
      listTournaments:async()=>({tournaments:[{id:"cloud-correct",localKey:"internal-A",revision:2,checksum:"c2",updatedAt:"2026-09-09T10:10:00Z"}]}),
      getTournament:async()=>{throw notFound();},
      createTournament:async()=>{created++;throw new Error("must not create duplicate");},
      getCurrentSnapshot:async(_t,id)=>{if(id!=="cloud-correct")throw notFound();if(!remoteSnapshot){const temp=clone(local);temp.cloud={schemaVersion:4,internalId:"internal-A"};remoteSnapshot={version:"V99",data:{currentTournament:"Iron Open",tournaments:{"Iron Open":temp},preferences:{}},currentTournament:"Iron Open",preferences:{},telegramGlobal:{}};}return {tournament:{id:"cloud-correct",localKey:"internal-A",revision:2,checksum:"c2",updatedAt:"2026-09-09T10:10:00Z"},snapshot:clone(remoteSnapshot)};},
      putSnapshot:async()=>{puts++;throw new Error("identical relink should not upload");}
    };
    const ctx=makeContext(api,local);const result=await ctx.cpCloudPushDesktopToCloud();
    check(result.ok===true&&result.unchanged===true,"unique internalId remote is safely relinked when content already matches");
    check(ctx.getCurrentTournament().cloud.cloudTournamentId==="cloud-correct","provider ID is repaired from internalId");
    check(created===0&&puts===0,"relink does not create or overwrite Cloud content");
  }

  // Ambiguous duplicate logical identity must stop before any create/write.
  {
    let created=0,puts=0;
    const api={listTournaments:async()=>({tournaments:[{id:"a",localKey:"internal-A",revision:1},{id:"b",localKey:"internal-A",revision:1}]}),getTournament:async()=>{throw notFound();},createTournament:async()=>{created++;},putSnapshot:async()=>{puts++;}};
    const ctx=makeContext(api,baseTournament());let err=null;try{await ctx.cpCloudPushDesktopToCloud();}catch(e){err=e;}
    check(/Multiple entries in My Cloud Tournaments/.test(String(err?.message||"")),"ambiguous duplicate identity blocks upload with explicit error");
    check(created===0&&puts===0,"ambiguous identity performs no create and no write");
  }

  console.log(`BETA75 MY CLOUD TOURNAMENTS IRON LOGIC: ${fail?"FAIL":"PASS"} (${pass} PASS / ${fail} FAIL)`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
