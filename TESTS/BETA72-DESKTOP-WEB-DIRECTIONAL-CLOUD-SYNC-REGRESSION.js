"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto");
const root=path.resolve(__dirname,"..");
const src=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
const webview=fs.readFileSync(path.join(root,"ChessPublisher-WebView.ps1"),"utf8");
let pass=0,fail=0;
function assert(cond,label){if(cond){console.log(`PASS: ${label}`);pass++;}else{console.error(`FAIL: ${label}`);fail++;}}
function canon(v){if(Array.isArray(v))return v.map(canon);if(!v||typeof v!=="object")return v;const o={};for(const k of Object.keys(v).sort())o[k]=canon(v[k]);return o;}
function hash(v){return crypto.createHash("sha256").update(JSON.stringify(canon(v))).digest("hex");}
function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}

assert(/CloudWorkspaceRedesign\.js/.test(webview),"Windows WebView loads directional Cloud redesign after legacy adapter");
assert(/↓ Pull Cloud → Desktop/.test(src),"Explicit Pull Cloud → Desktop label exists");
assert(/↑ Push Desktop → Cloud/.test(src),"Explicit Push Desktop → Cloud label exists");
assert(/Check Cloud Status/.test(src),"Check Cloud Status action exists");
assert(/Resolve Conflict/.test(src),"Resolve Conflict action exists");
assert(/Open in Web/.test(src),"Open in Web action exists");
assert(/localStorage\.setItem\(AUTO_SYNC_KEY,"0"\)/.test(src),"Legacy Cloud autosync is forcibly disabled");
assert(/Autosave is local only/.test(src),"UI explicitly states Autosave is local only");
assert(!/Last Write Wins/.test(src),"Directional module contains no Last Write Wins policy");

const localStore=new Map();
const revisions=new Map();
let remote=null,remoteId="cloud-1";
function contentForFingerprint(t){const x=clone(t||{});delete x.cloud;delete x.online;delete x.hub;delete x.publication;delete x.savedAt;delete x.dgt;return x;}
function ensureCloudMeta(t){if(!t.cloud)t.cloud={};if(!t.cloud.localKey)t.cloud.localKey="local-key";if(!t.cloud.internalId)t.cloud.internalId="internal-1";t.cloud.baseRevision=Number(t.cloud.baseRevision||t.cloud.revision||0);t.cloud.revision=Number(t.cloud.revision||t.cloud.baseRevision||0);t.cloud.baseFingerprint=t.cloud.baseFingerprint||t.cloud.lastSyncedContentHash||"";t.cloud.lastSyncedContentHash=t.cloud.lastSyncedContentHash||t.cloud.baseFingerprint||"";return t.cloud;}
function updateSyncBase(m,{revision,contentHash,checksum,updatedAt}={}){m.revision=m.baseRevision=Number(revision||0);m.lastSyncedContentHash=m.baseFingerprint=String(contentHash||"");m.lastSyncedHash=String(checksum||"");m.lastSyncedAt=m.lastSyncAt=updatedAt||new Date().toISOString();return m;}
function makeSnapshot(name,t){const one=clone(t);one.cloud={schemaVersion:4,internalId:ensureCloudMeta(t).internalId};return {data:{currentTournament:name,tournaments:{[name]:one},preferences:{}},currentTournament:name,preferences:{},telegramGlobal:{}};}
function snapshotTournament(s){const n=s.data.currentTournament;return s.data.tournaments[n];}
function snapshotHash(s){return hash(contentForFingerprint(snapshotTournament(s)));}
function remoteResponse(){return {tournament:{id:remoteId,localKey:"internal-1",revision:remote?.revision||0,checksum:remote?.checksum||"",updatedAt:remote?.updatedAt||""},snapshot:remote?.snapshot?clone(remote.snapshot):null};}
const api={
  listTournaments:async()=>({tournaments:remote?[{id:remoteId,localKey:"internal-1",revision:remote.revision,checksum:remote.checksum,updatedAt:remote.updatedAt}]:[]}),
  createTournament:async(_token,input)=>({tournament:{id:remoteId,localKey:input.localKey,revision:0,checksum:"",updatedAt:new Date().toISOString()}}),
  getCurrentSnapshot:async()=>{if(!remote){const e=new Error("not found");e.status=404;e.code="not_found";throw e;}return remoteResponse();},
  putSnapshot:async(_token,args)=>{if(remote&&Number(args.baseRevision)!==remote.revision){const e=new Error("revision conflict");e.code="cloud_revision_conflict";e.currentRevision=remote.revision;throw e;}const revision=(remote?.revision||0)+1;const snapshot=clone(args.snapshot),checksum=hash(snapshot);const updatedAt=new Date().toISOString();remote={revision,snapshot,checksum,updatedAt};revisions.set(revision,clone(remote));return {revision,checksum,updatedAt};},
  getRevision:async(_token,_id,rev)=>{const r=revisions.get(Number(rev));if(!r)throw new Error("missing revision");return {tournament:{id:remoteId,revision:r.revision,checksum:r.checksum,updatedAt:r.updatedAt},snapshot:clone(r.snapshot)};}
};
const players=Array.from({length:83},(_,i)=>({id:`p${i+1}`,pairingNumber:i+1,name:`Player ${i+1}`,rating:1800+i}));
const tournament={name:"Tournament Ubuntu",settings:{chiefArbiter:"Kyamran Bilyal",organizer:"Original Club",venue:"Hall A",city:"Sofia",country:"BUL",timeControl:"90+30",rounds:7,startDate:"2026-10-01",endDate:"2026-10-07",mode:"Test"},regulations:{text:"Rules"},schedule:{rounds:7},players,pairings:[],cloud:{localKey:"local-key",internalId:"internal-1",cloudTournamentId:"",baseRevision:0,revision:0,baseFingerprint:"",lastSyncedContentHash:""},dgt:{port:"COM9"}};
const data={currentTournament:"Tournament Ubuntu",tournaments:{"Tournament Ubuntu":tournament},preferences:{}};
const fakeEl={addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},style:{},classList:{toggle(){}},appendChild(){},insertBefore(){}};
const document={getElementById(){return null;},querySelector(){return null;},createElement(){return {...fakeEl,innerHTML:"",id:"",className:"",remove(){}};},head:fakeEl,body:fakeEl};
const core={
  ensureCloudMeta,
  tournamentContentForFingerprint:contentForFingerprint,
  tournamentContentHash:async(_n,t)=>hash(contentForFingerprint(t)),
  sanitizeDownloadedTournament:t=>{const x=clone(t);delete x.cloud;return x;},
  cloudScopedSnapshot:makeSnapshot,
  updateSyncBase
};
const context={console,crypto:crypto.webcrypto,TextEncoder,Headers,URL,window:null,globalThis:null,document,localStorage:{getItem:k=>localStore.get(k)||null,setItem:(k,v)=>localStore.set(k,String(v))},data,
  getCurrentTournament:()=>data.tournaments[data.currentTournament],
  saveAll:()=>{context.saveAllCalls++;},saveAllCalls:0,
  fileSaveTournament:async()=>true,saveData:()=>{},normalizeData:()=>{},refreshEverything:()=>{},stateDirty:false,
  cpResetTournamentDocumentBinding:()=>{},setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},alert:()=>{},location:{href:""}
};
context.window=context;context.globalThis=context;
context.ChessPublisherCloudWorkspaceApi={createClient:()=>api};
context.ChessPublisherCloudSyncInternals=core;
context.cpNativeHubSecretGet=async()=>"token";
context.cpOnlineOrganizerSecretKey=()=>"organizer-primary:test";
vm.createContext(context);vm.runInContext(src,context,{filename:"CloudWorkspaceRedesign.js"});
const dir=context.ChessPublisherCloudDirectionalInternals;
assert(!!dir,"Directional Cloud pure internals exported");

(async()=>{
  const push1=await context.cpCloudPushDesktopToCloud();
  assert(push1.ok&&remote.revision===1,"Initial Push creates exactly one Cloud snapshot revision");
  const rs1=remote.snapshot,rt1=snapshotTournament(rs1);
  assert(rt1.name==="Tournament Ubuntu","Cloud portable tournament contains exact tournament.name");
  assert(rt1.players.length===83,"83-player roster parity after Push");
  assert(rt1.settings.chiefArbiter==="Kyamran Bilyal"&&rt1.settings.city==="Sofia"&&rt1.settings.country==="BUL"&&rt1.settings.timeControl==="90+30"&&rt1.settings.rounds===7,"Officials/settings parity after Push");
  assert(rt1.regulations.text==="Rules"&&rt1.schedule.rounds===7&&rt1.settings.mode==="Test","Regulations/schedule/mode parity after Push");
  assert(rt1.cloud.internalId==="internal-1"&&data.tournaments[data.currentTournament].cloud.cloudTournamentId===remoteId,"internalId and cloudTournamentId identity preserved");
  assert(context.saveAllCalls===1,"Push invokes saveAll before Cloud upload");

  // Web-only venue change and Desktop-only organizer change from same base.
  const web=clone(snapshotTournament(remote.snapshot));web.settings.venue="Hall B";const webSnap=makeSnapshot(web.name,web);remote={revision:2,snapshot:webSnap,checksum:hash(webSnap),updatedAt:new Date().toISOString()};revisions.set(2,clone(remote));
  data.tournaments[data.currentTournament].settings.organizer="Chess Club";
  const pullMerge=await context.cpCloudPullCloudToDesktop();
  const merged=data.tournaments[data.currentTournament];
  assert(pullMerge.conflict===true&&pullMerge.bothChanged===true,"Two-sided non-overlapping edits stop as BOTH_CHANGED instead of auto-publishing a merge");
  assert(merged.settings.venue==="Hall A"&&merged.settings.organizer==="Chess Club","BOTH_CHANGED leaves Desktop content untouched");
  assert(snapshotTournament(remote.snapshot).settings.venue==="Hall B"&&snapshotTournament(remote.snapshot).settings.organizer==="Original Club","BOTH_CHANGED leaves Cloud content untouched");
  assert(remote.revision===2,"Conflict detection does not upload or create a Cloud revision");
  assert(merged.dgt.port==="COM9","Installation-local DGT data survives conflict detection");

  // Simulate explicit resolver confirmation of the deterministic non-overlap merge.
  merged.settings.venue="Hall B";
  core.updateSyncBase(merged.cloud,{revision:2,contentHash:snapshotHash(remote.snapshot),checksum:remote.checksum,updatedAt:remote.updatedAt});
  const push2=await context.cpCloudPushDesktopToCloud();
  assert(push2.ok&&remote.revision===3,"Explicitly resolved merged local version can then be pushed as a separate step");

  // Rename must keep identity/cloud ID.
  const current=data.tournaments[data.currentTournament];delete data.tournaments[data.currentTournament];current.name="Sofia Open 2026";data.currentTournament="Sofia Open 2026";data.tournaments[data.currentTournament]=current;
  const cloudIdBefore=current.cloud.cloudTournamentId,internalBefore=current.cloud.internalId;
  await context.cpCloudPushDesktopToCloud();
  assert(current.cloud.cloudTournamentId===cloudIdBefore&&current.cloud.internalId===internalBefore,"Rename does not create a new cloudTournamentId/internalId");
  assert(snapshotTournament(remote.snapshot).name==="Sofia Open 2026","Renamed tournament name travels inside portable tournament object");

  // Establish a neutral common base, then create a true same-field conflict:
  // Desktop = Sofia, Web = Plovdiv, BASE = Kardzhali.
  const neutral=data.tournaments[data.currentTournament];neutral.settings.city="Kardzhali";
  await context.cpCloudPushDesktopToCloud();
  const baseRev=remote.revision;
  const local=data.tournaments[data.currentTournament];local.settings.city="Sofia";
  const web2=clone(snapshotTournament(remote.snapshot));web2.settings.city="Plovdiv";const webSnap2=makeSnapshot(web2.name,web2);remote={revision:baseRev+1,snapshot:webSnap2,checksum:hash(webSnap2),updatedAt:new Date().toISOString()};revisions.set(remote.revision,clone(remote));
  const pullConflict=await context.cpCloudPullCloudToDesktop();
  assert(pullConflict.conflict===true,"Same-field Desktop/Web edit produces CONFLICT");
  assert(data.tournaments[data.currentTournament].settings.city==="Sofia","Conflict Pull does not overwrite Desktop field");
  assert(snapshotTournament(remote.snapshot).settings.city==="Plovdiv","Conflict Pull does not overwrite Cloud field");

  const baseObj=snapshotTournament(revisions.get(baseRev).snapshot),localObj=data.tournaments[data.currentTournament],remoteObj=snapshotTournament(remote.snapshot);
  const three=dir.mergeThreeWay(contentForFingerprint(baseObj),contentForFingerprint(localObj),contentForFingerprint(remoteObj));
  assert(three.conflicts.some(c=>/settings\.city$/.test(c.path)),"Three-way resolver exposes City as a field conflict");

  // Direction safety and local autosave safety.
  assert(localStore.get("ChessPublisherCloudWorkspace_AutoSync_v1")==="0","Cloud autosync remains disabled after module initialization");
  assert(!/scheduleAutoSync\(/.test(src),"Directional layer does not schedule automatic Push/Pull");
  assert(/Pull never creates a cloud tournament/.test(src),"Pull-only path explicitly refuses implicit Cloud creation");
  assert(/Cloud contains newer changes\. Pull Cloud → Desktop first/.test(src),"Push-only path stops when Cloud is newer");
  assert(/saveResolvedConflict/.test(src)&&/Use Push Desktop → Cloud to publish/.test(src),"Resolve Conflict saves locally and requires separate Push");

  console.log(`BETA72 DESKTOP-WEB DIRECTIONAL CLOUD SYNC REGRESSION: ${fail?"FAIL":"PASS"} (${pass} PASS / ${fail} FAIL)`);
  process.exitCode=fail?1:0;
})().catch(err=>{console.error(err);process.exitCode=1;});
