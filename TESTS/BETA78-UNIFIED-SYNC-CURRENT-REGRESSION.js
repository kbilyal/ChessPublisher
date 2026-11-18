"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto");
const root=path.resolve(__dirname,"..");
const src=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
let pass=0,fail=0;
function check(cond,label){if(cond){console.log(`PASS: ${label}`);pass++;}else{console.error(`FAIL: ${label}`);fail++;}}
function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(!v||typeof v!=="object")return v;const o={};for(const k of Object.keys(v).sort())o[k]=canonical(v[k]);return o;}
function hash(v){return crypto.createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");}
function notFound(){const e=new Error("not found");e.status=404;e.code="not_found";return e;}

check(/id="cloudSyncCurrentBtn"/.test(src),"single SYNC button exists");
check(/sync\.textContent="↕ SYNC"/.test(src),"single SYNC button has clear bidirectional label");
check(!/const upload=document\.createElement\("button"\)/.test(src),"no user-facing Upload Current button is created");
check(!/const pull=document\.createElement\("button"\)/.test(src),"no user-facing Pull Current button is created");
check(/window\.cpCloudSyncCurrent=syncCurrent/.test(src),"legacy current-sync entry point now routes through unified SYNC");
check(/window\.cpCloudSyncUnified=syncCurrent/.test(src),"explicit unified SYNC API is exported");
check((src.match(/const synced=await syncCurrent\(\)/g)||[]).length>=2,"Download Results also completes unified SYNC");
check(/hub-online-list-compact \.hub-section-eyebrow\{display:none!important\}/.test(src),"PUBLIC LIST eyebrow is hidden from My Online Tournaments without editing protected HubAdapter");
check(/byCurrentName/.test(src)&&/RELINKED_CURRENT/.test(src),"current-name cloud row is reused during foreign-link repair");
check(/Subsequent SYNC calls always reuse it/.test(src),"single-current no-duplicate identity contract is documented in code");

function contentForFingerprint(t){const x=clone(t||{});delete x.cloud;delete x.online;delete x.hub;delete x.publication;delete x.savedAt;delete x.dgt;return x;}
function ensureCloudMeta(t){
  if(!t.cloud)t.cloud={};
  if(!t.cloud.localKey)t.cloud.localKey="local-key";
  if(!t.cloud.internalId)t.cloud.internalId="internal-current";
  t.cloud.baseRevision=Number(t.cloud.baseRevision||t.cloud.revision||0);
  t.cloud.revision=Number(t.cloud.revision||t.cloud.baseRevision||0);
  t.cloud.baseFingerprint=t.cloud.baseFingerprint||t.cloud.lastSyncedContentHash||"";
  t.cloud.lastSyncedContentHash=t.cloud.lastSyncedContentHash||t.cloud.baseFingerprint||"";
  return t.cloud;
}
function updateSyncBase(m,{revision,contentHash,checksum,updatedAt}={}){
  m.revision=m.baseRevision=Number(revision||0);
  m.lastSyncedContentHash=m.baseFingerprint=String(contentHash||"");
  m.lastSyncedHash=String(checksum||"");
  m.lastSyncedAt=m.lastSyncAt=updatedAt||new Date().toISOString();
  return m;
}
function makeSnapshot(name,t){const one=clone(t);one.cloud={schemaVersion:4,internalId:ensureCloudMeta(t).internalId};return {data:{currentTournament:name,tournaments:{[name]:one},preferences:{}},currentTournament:name,preferences:{},telegramGlobal:{}};}
function snapshotTournament(s){const n=s.data.currentTournament;return s.data.tournaments[n];}

function makeHarness({name="Current Event",tournament,initialRow=null,initialRemote=null}={}){
  let row=initialRow?clone(initialRow):null;
  let remote=initialRemote?clone(initialRemote):null;
  let creates=0,puts=0;
  const revisions=new Map();
  if(remote)revisions.set(remote.revision,clone(remote));
  const api={
    listTournaments:async()=>({tournaments:row?[clone(row)]:[]}),
    createTournament:async(_token,input)=>{creates++;row={id:"cloud-current",localKey:input.localKey,name:input.name,revision:0,checksum:"",updatedAt:new Date().toISOString()};return {tournament:clone(row)};},
    getCurrentSnapshot:async(_token,id)=>{if(!row||id!==row.id||!remote)throw notFound();return {tournament:{...clone(row),revision:remote.revision,checksum:remote.checksum,updatedAt:remote.updatedAt},snapshot:clone(remote.snapshot)};},
    putSnapshot:async(_token,args)=>{puts++;if(!row||args.tournamentId!==row.id)throw new Error("wrong cloud id");const revision=(remote?.revision||0)+1;const snapshot=clone(args.snapshot),checksum=hash(snapshot),updatedAt=new Date().toISOString();remote={revision,snapshot,checksum,updatedAt};row={...row,revision,checksum,updatedAt,name:snapshot?.data?.currentTournament||row.name};revisions.set(revision,clone(remote));return {revision,checksum,updatedAt};},
    getRevision:async(_token,id,rev)=>{if(!row||id!==row.id)throw notFound();const r=revisions.get(Number(rev));if(!r)throw notFound();return {tournament:{...clone(row),revision:r.revision,checksum:r.checksum,updatedAt:r.updatedAt},snapshot:clone(r.snapshot)};}
  };
  const t=tournament||{name,settings:{city:"Sofia",organizer:"Club"},players:[{id:"p1",name:"A"}],pairings:{liveBoards:{}},cloud:{localKey:"local-key",internalId:"internal-current",cloudTournamentId:row?.id||"",revision:row?.revision||0,baseRevision:row?.revision||0,baseFingerprint:"",lastSyncedContentHash:""}};
  const data={currentTournament:name,tournaments:{[name]:t},preferences:{}};
  if(remote&&row){const rh=hash(contentForFingerprint(snapshotTournament(remote.snapshot)));const m=ensureCloudMeta(t);m.cloudTournamentId=row.id;m.baseFingerprint=m.lastSyncedContentHash=rh;m.baseRevision=m.revision=remote.revision;m.remoteRevision=remote.revision;}
  const fakeEl={addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},style:{},classList:{toggle(){}},appendChild(){},insertBefore(){},closest(){return null;},remove(){}};
  const document={getElementById(){return null;},querySelector(){return null;},createElement(){return {...fakeEl,innerHTML:"",id:"",className:""};},head:fakeEl,body:fakeEl};
  const core={ensureCloudMeta,tournamentContentForFingerprint:contentForFingerprint,tournamentContentHash:async(_n,obj)=>hash(contentForFingerprint(obj)),sanitizeDownloadedTournament:o=>{const x=clone(o);delete x.cloud;return x;},cloudScopedSnapshot:makeSnapshot,updateSyncBase};
  const context={console:{log(){},warn(){},error(){}},crypto:crypto.webcrypto,TextEncoder,Headers,URL,document,localStorage:{getItem(){return null;},setItem(){}},data,stateDirty:false,
    getCurrentTournament:()=>data.tournaments[data.currentTournament],saveAll(){},fileSaveTournament:async()=>true,saveData(){},normalizeData(){},refreshEverything(){},cpResetTournamentDocumentBinding(){},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},location:{href:""},alert(){},confirm:()=>true,
    getPersistentSnapshot:()=>({version:"V99",data:clone(data),currentTournament:data.currentTournament,preferences:{},telegramGlobal:{}}),cpSnapshotForExternalFile:v=>clone(v),cpValidateSnapshotStructure:()=>true
  };
  context.window=context;context.globalThis=context;context.ChessPublisherCloudWorkspaceApi={createClient:()=>api};context.ChessPublisherCloudSyncInternals=core;context.cpNativeHubSecretGet=async()=>"token";context.cpOnlineOrganizerSecretKey=()=>"organizer-primary:test";
  vm.createContext(context);vm.runInContext(src,context,{filename:"CloudWorkspaceRedesign.js"});
  return {context,get row(){return row;},get remote(){return remote;},get creates(){return creates;},get puts(){return puts;},revisions};
}

(async()=>{
  // Desktop-created current tournament: first SYNC creates one counterpart, second SYNC reuses it.
  {
    const h=makeHarness();
    let r=await h.context.cpCloudSyncUnified();
    check(r.ok===true&&h.creates===1&&h.puts===1,"first SYNC creates exactly one Cloud counterpart for a Desktop-created current tournament");
    const id=h.context.getCurrentTournament().cloud.cloudTournamentId;
    r=await h.context.cpCloudSyncUnified();
    check(r.ok===true&&h.creates===1&&h.context.getCurrentTournament().cloud.cloudTournamentId===id,"second SYNC reuses the same Cloud object and creates no duplicate");
  }

  // Cloud-only change: SYNC chooses Pull automatically.
  {
    const base={name:"Current Event",settings:{city:"Sofia",organizer:"Club"},players:[{id:"p1",name:"A"}],pairings:{liveBoards:{}},cloud:{internalId:"internal-current"}};
    const snap1=makeSnapshot("Current Event",base),c1=hash(snap1);
    const remote1={revision:1,snapshot:snap1,checksum:c1,updatedAt:new Date().toISOString()};
    const h=makeHarness({tournament:clone(base),initialRow:{id:"cloud-current",localKey:"internal-current",name:"Current Event",revision:1,checksum:c1,updatedAt:remote1.updatedAt},initialRemote:remote1});
    const web=clone(snapshotTournament(h.remote.snapshot));web.settings.city="Plovdiv";const snap2=makeSnapshot("Current Event",web),c2=hash(snap2),u2=new Date().toISOString();
    h.remote.revision=2;h.remote.snapshot=snap2;h.remote.checksum=c2;h.remote.updatedAt=u2;h.row.revision=2;h.row.checksum=c2;h.row.updatedAt=u2;h.revisions.set(2,clone(h.remote));
    const r=await h.context.cpCloudSyncUnified();
    check(r.ok===true&&h.context.getCurrentTournament().settings.city==="Plovdiv"&&h.puts===0,"SYNC automatically pulls Cloud-only changes without creating a revision");
  }

  // Desktop-only change: SYNC chooses Push automatically.
  {
    const base={name:"Current Event",settings:{city:"Sofia",organizer:"Club"},players:[{id:"p1",name:"A"}],pairings:{liveBoards:{}},cloud:{internalId:"internal-current"}};
    const snap1=makeSnapshot("Current Event",base),c1=hash(snap1),u1=new Date().toISOString();
    const h=makeHarness({tournament:clone(base),initialRow:{id:"cloud-current",localKey:"internal-current",name:"Current Event",revision:1,checksum:c1,updatedAt:u1},initialRemote:{revision:1,snapshot:snap1,checksum:c1,updatedAt:u1}});
    h.context.getCurrentTournament().settings.organizer="New Club";
    const r=await h.context.cpCloudSyncUnified();
    check(r.ok===true&&h.puts===1&&snapshotTournament(h.remote.snapshot).settings.organizer==="New Club","SYNC automatically pushes Desktop-only changes");
  }

  // Existing current-name row wins over a stale foreign imported-copy link; no duplicate is created.
  {
    const local={name:"RC beta test (Imported)2",settings:{city:"Sofia"},players:[],pairings:{liveBoards:{}},cloud:{localKey:"copied-local",internalId:"golden-internal",cloudTournamentId:"golden",revision:15,baseRevision:15,baseFingerprint:"golden",lastSyncedContentHash:"golden"}};
    let rows=[{id:"golden",localKey:"golden-internal",name:"GOLDEN RHODOPES",revision:15},{id:"rc",localKey:"rc-internal",name:"RC beta test (Imported)2",revision:3}];
    let creates=0;
    const api={listTournaments:async()=>({tournaments:clone(rows)}),createTournament:async()=>{creates++;throw new Error("must not create");},getCurrentSnapshot:async(_t,id)=>{if(id!=="rc")throw notFound();const rt={name:"RC beta test (Imported)2",settings:{city:"Sofia"},players:[],pairings:{liveBoards:{}},cloud:{internalId:"rc-internal"}};return {tournament:{id:"rc",localKey:"rc-internal",name:rt.name,revision:3,checksum:"c3",updatedAt:new Date().toISOString()},snapshot:makeSnapshot(rt.name,rt)};}};
    const data={currentTournament:local.name,tournaments:{[local.name]:local},preferences:{}};
    const fakeEl={addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},style:{},classList:{toggle(){}},appendChild(){},insertBefore(){},closest(){return null;},remove(){}};const document={getElementById(){return null;},querySelector(){return null;},createElement(){return {...fakeEl};},head:fakeEl,body:fakeEl};
    const core={ensureCloudMeta,tournamentContentForFingerprint:contentForFingerprint,tournamentContentHash:async(_n,o)=>hash(contentForFingerprint(o)),sanitizeDownloadedTournament:o=>{const x=clone(o);delete x.cloud;return x;},cloudScopedSnapshot:makeSnapshot,updateSyncBase};
    const c={console:{log(){},warn(){},error(){}},crypto:crypto.webcrypto,TextEncoder,Headers,URL,document,localStorage:{getItem(){return null;},setItem(){}},data,stateDirty:false,getCurrentTournament:()=>data.tournaments[data.currentTournament],saveAll(){},fileSaveTournament:async()=>true,saveData(){},normalizeData(){},refreshEverything(){},cpResetTournamentDocumentBinding(){},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},location:{href:""}};c.window=c;c.globalThis=c;c.ChessPublisherCloudWorkspaceApi={createClient:()=>api};c.ChessPublisherCloudSyncInternals=core;c.cpNativeHubSecretGet=async()=>"token";c.cpOnlineOrganizerSecretKey=()=>"organizer-primary:test";vm.createContext(c);vm.runInContext(src,c);
    const r=await c.cpCloudSyncUnified();
    check(r.ok===true&&creates===0&&c.getCurrentTournament().cloud.cloudTournamentId==="rc"&&c.getCurrentTournament().cloud.internalId==="rc-internal","SYNC repairs stale foreign identity by reusing the existing current tournament row, never creating a duplicate");
  }

  console.log(`BETA78 UNIFIED SYNC CURRENT: ${fail?"FAIL":"PASS"} (${pass} PASS / ${fail} FAIL)`);
  process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
