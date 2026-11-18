"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto");
const root=path.resolve(__dirname,"..");
const src=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
const apiSrc=fs.readFileSync(path.join(root,"cloud","client","cloud-workspace-api.js"),"utf8");
let pass=0,fail=0;
function check(cond,label){if(cond){console.log(`PASS ${String(++pass).padStart(2,"0")} ${label}`);}else{console.error(`FAIL ${label}`);fail++;}}
function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(!v||typeof v!=="object")return v;const o={};for(const k of Object.keys(v).sort())o[k]=canonical(v[k]);return o;}
function hash(v){return crypto.createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");}
function notFound(){const e=new Error("not found");e.status=404;e.code="not_found";return e;}

check(/listArchivedTournaments\(token\)/.test(apiSrc),"Desktop Cloud API exposes Trash listing");
check(/restoreArchivedTournament\(token,tournamentId\)/.test(apiSrc),"Desktop Cloud API exposes Trash restore");
check(/RESTORED_FROM_TRASH/.test(src),"Desktop identity reconciliation has explicit Trash recovery state");
check(/Preserve baseRevision\/baseFingerprint/.test(src),"Trash restore explicitly preserves the immutable common base");
check(/Active list \+ Trash are authoritative/.test(src),"Direct orphan snapshot resurrection remains forbidden after active+Trash miss");

function contentForFingerprint(t){const x=clone(t||{});for(const k of ["cloud","online","hub","publication","savedAt","dgt","uiState","runtimeState"])delete x[k];return x;}
function ensureCloudMeta(t){
  if(!t.cloud)t.cloud={};
  if(!t.cloud.localKey)t.cloud.localKey="local-install";
  if(!t.cloud.internalId)t.cloud.internalId="internal-A";
  t.cloud.baseRevision=Number(t.cloud.baseRevision||t.cloud.revision||0);
  t.cloud.revision=Number(t.cloud.revision||t.cloud.baseRevision||0);
  t.cloud.baseFingerprint=t.cloud.baseFingerprint||t.cloud.lastSyncedContentHash||"";
  t.cloud.lastSyncedContentHash=t.cloud.lastSyncedContentHash||t.cloud.baseFingerprint||"";
  return t.cloud;
}
function updateSyncBase(m,{revision,contentHash,checksum,updatedAt,cloudTournamentId,internalId}={}){
  m.revision=m.baseRevision=Number(revision||0);
  m.lastSyncedContentHash=m.baseFingerprint=String(contentHash||"");
  m.fingerprintContentSchema=7;
  m.lastSyncedHash=String(checksum||"");
  m.lastSyncedAt=m.lastSyncAt=updatedAt||new Date().toISOString();
  if(cloudTournamentId)m.cloudTournamentId=cloudTournamentId;
  if(internalId)m.internalId=internalId;
  return m;
}
function makeSnapshot(name,t){const one=clone(t);one.cloud={schemaVersion:4,internalId:ensureCloudMeta(t).internalId};return {version:"V99",data:{currentTournament:name,tournaments:{[name]:one},preferences:{}},currentTournament:name,preferences:{},telegramGlobal:{}};}
function snapshotTournament(s){const n=s.data.currentTournament;return s.data.tournaments[n];}

function makeHarness({localChanged=false,permanent=false,ambiguousTrash=false,trashEndpoint404=false}={}){
  const name="RC beta test1";
  const base={name,settings:{city:"Sofia",organizer:"Club",startDate:"2026-10-01"},schedule:{rows:[{no:1,date:"2026-10-01",time:"10:00",notes:""}]},players:[{id:"p1",name:"A"}],pairings:{liveBoards:{}},cloud:{schemaVersion:4,localKey:"local-install",internalId:"internal-A",cloudTournamentId:"cloud-old",revision:4,baseRevision:4,baseFingerprint:"",lastSyncedContentHash:"",fingerprintContentSchema:7}};
  const snap4=makeSnapshot(name,base);
  const baseHash=hash(contentForFingerprint(snapshotTournament(snap4)));
  base.cloud.baseFingerprint=base.cloud.lastSyncedContentHash=baseHash;
  let local=clone(base);
  if(localChanged){local.settings.city="Kardzhali";local.schedule.rows[0].time="11:30";}
  const data={currentTournament:name,tournaments:{[name]:local},preferences:{}};

  let active=null;
  let archived=permanent?[]:[{id:"cloud-old",localKey:"internal-A",name,revision:4,checksum:"c4",updatedAt:"2026-09-10T09:00:00Z",archivedAt:"2026-09-10T09:05:00Z"}];
  if(ambiguousTrash)archived.push({id:"cloud-dup",localKey:"internal-A",name,revision:4,checksum:"c4b",updatedAt:"2026-09-10T09:01:00Z",archivedAt:"2026-09-10T09:05:01Z"});
  let remote={revision:4,snapshot:clone(snap4),checksum:"c4",updatedAt:"2026-09-10T09:00:00Z"};
  let creates=0,restores=0,puts=0,currentReads=0,archivedLists=0;
  const revisions=new Map([[4,clone(remote)]]);
  const api={
    listTournaments:async()=>({tournaments:active?[clone(active)]:[]}),
    listArchivedTournaments:async()=>{archivedLists++;if(trashEndpoint404)throw notFound();return {tournaments:clone(archived)};},
    restoreArchivedTournament:async(_token,id)=>{restores++;const row=archived.find(x=>x.id===id);if(!row)throw notFound();archived=archived.filter(x=>x.id!==id);active={...clone(row),archivedAt:null};return {tournament:clone(active)};},
    createTournament:async(_token,input)=>{creates++;active={id:"cloud-new",localKey:input.localKey,name:input.name,revision:0,checksum:"",updatedAt:"2026-09-10T10:00:00Z"};remote=null;return {tournament:clone(active)};},
    getCurrentSnapshot:async(_token,id)=>{currentReads++;if(!active||active.id!==id||!remote)throw notFound();return {tournament:{...clone(active),revision:remote.revision,checksum:remote.checksum,updatedAt:remote.updatedAt},snapshot:clone(remote.snapshot)};},
    putSnapshot:async(_token,args)=>{puts++;if(!active||args.tournamentId!==active.id)throw new Error("wrong cloud id");const expected=remote?.revision||0;if(Number(args.baseRevision)!==expected)throw new Error(`wrong base ${args.baseRevision} != ${expected}`);const revision=expected+1;const snapshot=clone(args.snapshot),updatedAt="2026-09-10T10:01:00Z";remote={revision,snapshot,checksum:`c${revision}`,updatedAt};active={...active,revision,checksum:remote.checksum,updatedAt,name:snapshot.data.currentTournament};revisions.set(revision,clone(remote));return {revision,checksum:remote.checksum,updatedAt,cloudTournamentId:active.id,internalId:active.localKey};},
    getRevision:async(_token,id,rev)=>{const r=revisions.get(Number(rev));if(!r||id!=="cloud-old")throw notFound();return {tournament:{id:"cloud-old",localKey:"internal-A",name,revision:r.revision,checksum:r.checksum,updatedAt:r.updatedAt},snapshot:clone(r.snapshot)};}
  };
  const fakeEl={addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},style:{},classList:{toggle(){},add(){}},appendChild(){},insertBefore(){},closest(){return null;},remove(){}};
  const document={getElementById(){return null;},querySelector(){return null;},createElement(){return {...fakeEl,innerHTML:"",id:"",className:""};},head:fakeEl,body:fakeEl};
  const core={ensureCloudMeta,tournamentContentForFingerprint:contentForFingerprint,tournamentContentHash:async(_n,obj)=>hash(contentForFingerprint(obj)),sanitizeDownloadedTournament:o=>{const x=clone(o);delete x.cloud;return x;},cloudScopedSnapshot:makeSnapshot,updateSyncBase,FINGERPRINT_CONTENT_SCHEMA:7};
  const context={console:{log(){},warn(){},error(){}},crypto:crypto.webcrypto,TextEncoder,Headers,URL,document,localStorage:{getItem(){return null;},setItem(){}},data,stateDirty:false,
    getCurrentTournament:()=>data.tournaments[data.currentTournament],saveAll(){},fileSaveTournament:async()=>true,saveData(){},normalizeData(){},refreshEverything(){},cpResetTournamentDocumentBinding(){},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},location:{href:""},alert(){},confirm:()=>true,
    getPersistentSnapshot:()=>({version:"V99",data:clone(data),currentTournament:data.currentTournament,preferences:{},telegramGlobal:{}}),cpSnapshotForExternalFile:v=>clone(v),cpValidateSnapshotStructure:()=>true
  };
  context.window=context;context.globalThis=context;context.ChessPublisherCloudWorkspaceApi={createClient:()=>api};context.ChessPublisherCloudSyncInternals=core;context.cpNativeHubSecretGet=async()=>"token";context.cpOnlineOrganizerSecretKey=()=>"organizer-primary:test";
  vm.createContext(context);vm.runInContext(src,context,{filename:"CloudWorkspaceRedesign.js"});
  return {context,get active(){return active;},get archived(){return archived;},get remote(){return remote;},get creates(){return creates;},get restores(){return restores;},get puts(){return puts;},get currentReads(){return currentReads;},get archivedLists(){return archivedLists;}};
}

(async()=>{
  {
    const h=makeHarness({localChanged:true});
    const r=await h.context.cpCloudSyncUnified();
    const t=h.context.getCurrentTournament();
    check(r.ok===true&&r.direction==="push","Web-deleted + Desktop-changed tournament completes SYNC as a push after restore");
    check(h.restores===1&&h.creates===0,"Trash recovery restores the same Cloud tournament and creates no duplicate");
    check(h.puts===1&&h.active.id==="cloud-old"&&h.remote.revision===5,"latest Desktop state is uploaded to the restored Cloud ID as the next revision");
    const uploaded=snapshotTournament(h.remote.snapshot);
    check(uploaded.settings.city==="Kardzhali"&&uploaded.schedule.rows[0].time==="11:30","restored upload contains the latest Desktop metadata/calendar state");
    check(t.cloud.cloudTournamentId==="cloud-old"&&t.cloud.baseRevision===5,"Desktop keeps the original Cloud identity and advances the common base");
  }

  {
    const h=makeHarness({localChanged:false});
    const r=await h.context.cpCloudSyncUnified();
    check(r.ok===true&&r.unchanged===true,"unchanged Desktop tournament reappears from Trash without artificial content revision");
    check(h.restores===1&&h.creates===0&&h.puts===0,"unchanged Trash recovery performs one restore and zero create/PUT operations");
    check(h.active.id==="cloud-old"&&h.context.getCurrentTournament().cloud.baseRevision===4,"unchanged restore preserves Cloud ID and base revision r4");
  }

  {
    const h=makeHarness({localChanged:true,permanent:true});
    const r=await h.context.cpCloudSyncUnified();
    check(r.ok===true&&h.restores===0&&h.creates===1&&h.puts===1,"permanently deleted tournament is recreated once and uploaded once");
    check(h.active.id==="cloud-new"&&h.remote.revision===1,"permanent-delete recovery establishes a fresh Cloud object at revision r1");
    const uploaded=snapshotTournament(h.remote.snapshot);
    check(uploaded.settings.city==="Kardzhali"&&uploaded.schedule.rows[0].time==="11:30","fresh recreation uploads the latest Desktop state, not the old base");
  }

  {
    const h=makeHarness({localChanged:true,ambiguousTrash:true});let err=null;
    try{await h.context.cpCloudSyncUnified();}catch(e){err=e;}
    check(/More than one tournament in Trash/.test(String(err?.message||"")),"ambiguous Trash identity fails closed with an explicit error");
    check(h.restores===0&&h.creates===0&&h.puts===0,"ambiguous Trash identity performs no restore/create/write");
  }

  {
    const h=makeHarness({localChanged:true,permanent:true,trashEndpoint404:true});
    const r=await h.context.cpCloudSyncUnified();
    check(r.ok===true&&h.creates===1&&h.puts===1,"legacy Worker without Trash endpoint falls back to safe recreate behavior");
  }

  console.log(`BETA90 SYNC RESTORE DELETED WEB TOURNAMENT: ${fail?"FAIL":"PASS"} (${pass} PASS / ${fail} FAIL)`);
  process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
