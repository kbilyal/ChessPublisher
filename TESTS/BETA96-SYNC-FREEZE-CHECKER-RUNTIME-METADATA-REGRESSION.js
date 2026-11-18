"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto"),assert=require("assert");
const root=path.resolve(__dirname,"..");
const adapterSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceAdapter.js"),"utf8");
const dirSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
const html=fs.readFileSync(path.join(root,"ChessPublisher.html"),"utf8");
let pass=0,fail=0;
function ok(v,msg){try{assert.ok(v);console.log(`PASS ${String(++pass).padStart(2,"0")} ${msg}`);}catch(e){fail++;console.error(`FAIL ${msg}`);}}
function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}
function webProjectionReference(t){
  const installation=new Set(['organizertoken','managetoken','managekey','admintoken','authtoken','accesstoken','refreshtoken','devicetoken','password','secret','devicesecret','aeskey','aes','iv','filepath','folderpath','installationpath','windowspath','linuxpath','executablepath','workingdirectory','serialport','usbpath','dgtport','lastcheckeruisource','lastcheckeruibuildversion','lastcheckeruicheckedat']);
  const volatile=new Set(['updatedat','lastviewedat','lastaccess','requesttimestamp','requesttimestamps','cachetimestamp','cachetimestamps','generatedat','serverprocessingmetadata','processingmetadata','browserstate','browserdata','sessionstate','sessiondata']);
  function clean(v){if(Array.isArray(v))return v.map(clean);if(!v||typeof v!=="object")return v;const o={};for(const [k,x] of Object.entries(v)){const l=k.toLowerCase();if(installation.has(l)||volatile.has(l))continue;o[k]=clean(x);}return o;}
  const o=clean(clone(t));for(const k of ['cloud','online','hub','publication','savedAt','dgt','uiState','runtimeState'])delete o[k];if(o.telegram){delete o.telegram.token;delete o.telegram.botToken;}return o;
}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())if(v[k]!==undefined)o[k]=canonical(v[k]);return o;}return v;}
function webHash(t){return crypto.createHash('sha256').update(JSON.stringify(canonical(webProjectionReference(t)))).digest('hex');}
function baseTournament(){return {name:'Freeze Event',settings:{city:'Sofia'},players:[{id:'p1',name:'A'},{id:'p2',name:'B'}],pairings:{engine:{lastCheckerUiState:'accepted',lastCheckerUiMessage:'OK',lastCheckerUiRound:1},liveBoards:{'1':[ {round:1,board:1,whiteKey:'p1',blackKey:'p2',result:'-'} ]}},cloud:{schemaVersion:4,localKey:'local',internalId:'internal-1'}};}
function harness(local,remote){
  const name=local.name;let remoteRev=7,puts=0;const baseHash=webHash(remote);
  local.cloud={...(local.cloud||{}),cloudTournamentId:'cloud-1',revision:7,baseRevision:7,baseFingerprint:baseHash,lastSyncedContentHash:baseHash,fingerprintContentSchema:7};
  function snap(t){return {version:'V99',data:{currentTournament:name,tournaments:{[name]:clone(t)},preferences:{}},telegramGlobal:{},currentTournament:name,preferences:{},cloudWorkspace:{schemaVersion:5,internalId:'internal-1',fingerprintContentSchema:7}};}
  let remoteSnap=snap(remote);
  const data={currentTournament:name,tournaments:{[name]:local},preferences:{}};
  const fake={addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},style:{},classList:{toggle(){},add(){},remove(){}},appendChild(){},insertBefore(){},closest(){return null;},remove(){}};
  const doc={documentElement:{dataset:{chesspublisherVersion:'1.06.00-beta.96'}},querySelector(){return null;},getElementById(){return null;},createElement(){return {...fake,innerHTML:'',id:'',className:'',textContent:'',hidden:false};},head:fake,body:fake};
  const api={workspace:async()=>({organizer:{id:'org',displayName:'Org'}}),getSettings:async()=>({revision:0,settings:{}}),putSettings:async()=>({revision:0}),listTournaments:async()=>({tournaments:[{id:'cloud-1',localKey:'internal-1',name,revision:remoteRev,checksum:'raw'}]}),getCurrentSnapshot:async()=>({tournament:{id:'cloud-1',localKey:'internal-1',name,revision:remoteRev,checksum:'raw'},snapshot:clone(remoteSnap)}),getRevision:async()=>({tournament:{revision:7},snapshot:clone(remoteSnap)}),listRevisions:async()=>({revisions:[]}),putSnapshot:async(_t,a)=>{puts++;remoteRev++;remoteSnap=clone(a.snapshot);return {cloudTournamentId:'cloud-1',internalId:'internal-1',revision:remoteRev,contentFingerprint:webHash(remoteSnap.data.tournaments[name]),checksum:'new'};},createTournament:async()=>({tournament:{id:'cloud-1',revision:0}}),listArchivedTournaments:async()=>({tournaments:[]})};
  const c={console:{log(){},warn(){},error(){}},crypto:crypto.webcrypto,TextEncoder,Headers,URL,navigator:{platform:'Win32'},document:doc,localStorage:{getItem(){return null;},setItem(){}},data,stateDirty:false,getCurrentTournament:()=>data.tournaments[data.currentTournament],getPersistentSnapshot:()=>({version:'V99',data:clone(data),telegramGlobal:{},currentTournament:name,preferences:{}}),cpSnapshotForExternalFile:v=>clone(v),saveAll(){},fileSaveTournament:async()=>true,saveData(){},normalizeData(){},refreshEverything(){},cpResetTournamentDocumentBinding(){},cpValidateSnapshotStructure:()=>true,showTab(){},prepareCurrentTournamentForTransition:async()=>true,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},location:{href:''},alert(){},confirm:()=>true,appConfirm:async()=>true};c.window=c;c.globalThis=c;c.ChessPublisherCloudWorkspaceApi={createClient:()=>api,CloudWorkspaceApiError:class extends Error{constructor(m,d={}){super(m);Object.assign(this,d);}}};c.cpNativeHubSecretGet=async()=> 'token';c.cpOnlineOrganizerSecretKey=()=> 'key';vm.createContext(c);vm.runInContext(adapterSrc,c);vm.runInContext(dirSrc,c);return {c,get puts(){return puts;},get remoteRev(){return remoteRev;}};
}
(async()=>{
  const base=baseTournament();const withProv=clone(base);Object.assign(withProv.pairings.engine,{lastCheckerUiSource:'desktop-gacrux-native',lastCheckerUiBuildVersion:'1.06.00-beta.95',lastCheckerUiCheckedAt:'2026-09-10T12:00:00Z'});
  const withProv2=clone(withProv);withProv2.pairings.engine.lastCheckerUiCheckedAt='2026-09-10T12:01:00Z';
  const h=harness(clone(base),clone(base));const core=h.c.ChessPublisherCloudSyncInternals;
  ok(/lastcheckeruisource/.test(adapterSrc)&&/lastcheckeruibuildversion/.test(adapterSrc)&&/lastcheckeruicheckedat/.test(adapterSrc),'Desktop schema-7 explicitly classifies checker provenance as runtime-only');
  const hb=await core.tournamentContentHash('Freeze Event',base),h1=await core.tournamentContentHash('Freeze Event',withProv),h2=await core.tournamentContentHash('Freeze Event',withProv2);
  ok(hb===h1,'checker source/build/checkedAt do not change Desktop schema-7 fingerprint');
  ok(h1===h2,'changing only checker timestamp does not change Desktop schema-7 fingerprint');
  ok(hb===webHash(withProv),'Desktop fingerprint matches beta.96 Web schema-7 reference projection');
  const scoped=core.cloudScopedSnapshot('Freeze Event',withProv);const txt=JSON.stringify(scoped);
  ok(!txt.includes('lastCheckerUiSource')&&!txt.includes('lastCheckerUiBuildVersion')&&!txt.includes('lastCheckerUiCheckedAt'),'private Cloud upload strips checker provenance recursively');
  const real=clone(base);real.settings.city='Plovdiv';ok(await core.tournamentContentHash('Freeze Event',real)!==hb,'real tournament content still changes fingerprint');
  const syncLocal=clone(withProv2);const hs=harness(syncLocal,clone(base));const r=await hs.c.cpCloudSyncUnified();
  ok(r?.ok===true&&r?.unchanged===true,'Gacrux-check-only local state is classified as already current');
  ok(hs.puts===0&&hs.remoteRev===7,'Gacrux-check-only SYNC causes zero Cloud writes and zero revision churn');
  ok(/SESSION_PROVENANCE/.test(html),'checker provenance is held in session-only storage');
  ok(!/engine\[SOURCE_KEY\]\s*=|engine\[BUILD_KEY\]\s*=|engine\[CHECKED_AT_KEY\]\s*=/.test(html),'checker source/build/timestamp are no longer persisted into tournament engine state');
  ok(/scrubPersistedProvenance/.test(html),'beta.95 persisted provenance is scrubbed on beta.96 load');
  console.log(`BETA96 SYNC FREEZE CHECKER RUNTIME METADATA: ${fail?'FAIL':'PASS'} (${pass} PASS / ${fail} FAIL)`);
  process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
