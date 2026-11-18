"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto");
const root=path.resolve(__dirname,"..");
const adapterSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceAdapter.js"),"utf8");
const dirSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
const html=fs.readFileSync(path.join(root,"ChessPublisher.html"),"utf8");
let pass=0,fail=0;
function check(c,l){if(c){console.log(`PASS: ${l}`);pass++;}else{console.error(`FAIL: ${l}`);fail++;}}
function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}
const installKeys=new Set(['organizertoken','managetoken','managekey','admintoken','authtoken','accesstoken','refreshtoken','devicetoken','password','secret','devicesecret','aeskey','aes','iv','filepath','folderpath','installationpath','windowspath','linuxpath','executablepath','workingdirectory','serialport','usbpath','dgtport']);
const volatileKeys=new Set(['updatedat','lastviewedat','lastaccess','requesttimestamp','requesttimestamps','cachetimestamp','cachetimestamps','generatedat','serverprocessingmetadata','processingmetadata','browserstate','browserdata','sessionstate','sessiondata']);
function sanitize(v){if(Array.isArray(v))return v.map(sanitize);if(!v||typeof v!=="object")return v;const o={};for(const [k,x] of Object.entries(v)){if(installKeys.has(k.toLowerCase())||volatileKeys.has(k.toLowerCase()))continue;o[k]=sanitize(x);}return o;}
function projection(t){const o=sanitize(clone(t||{}));for(const k of ['cloud','online','hub','publication','savedAt','dgt','uiState','runtimeState'])delete o[k];if(o.telegram&&typeof o.telegram==='object'){delete o.telegram.token;delete o.telegram.botToken;}return o;}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())if(v[k]!==undefined)o[k]=canonical(v[k]);return o;}return v;}
function fp(t){return crypto.createHash('sha256').update(JSON.stringify(canonical(projection(t)))).digest('hex');}
function snap(name,t){return {version:'V99',data:{currentTournament:name,tournaments:{[name]:clone(t)},preferences:{}},telegramGlobal:{},currentTournament:name,preferences:{},cloudWorkspace:{schemaVersion:5,fingerprintContentSchema:7}};}
function rawChecksum(s){return crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');}
function base(name='Recovery Event'){return {name,settings:{city:'Sofia',organizer:'Club'},players:[{id:'p1',name:'A'},{id:'p2',name:'B'}],pairings:{liveBoards:{'1':[{round:1,board:1,whiteKey:'p1',blackKey:'p2',result:'-'}]}},cloud:{schemaVersion:4,localKey:'lk',internalId:'iid'}};}
function nf(){const e=new Error('not found');e.status=404;e.code='not_found';return e;}

function harness({local,remote,remoteRevision,baseRevision=0,baseFingerprint='',schema=7,lastSyncedHash='',history=[]}={}){
 const name=local.name; local.cloud={...(local.cloud||{}),schemaVersion:4,localKey:'lk',internalId:'iid',cloudTournamentId:'cid',revision:baseRevision,baseRevision,baseFingerprint,lastSyncedContentHash:baseFingerprint,lastSyncedHash,fingerprintContentSchema:schema};
 const data={currentTournament:name,tournaments:{[name]:local},preferences:{}};
 let rr=remoteRevision,rs=snap(name,remote),puts=0,saves=0,historyReads=0,listReads=0;
 const hist=new Map(); for(const h of history){const ss=snap(name,h.tournament);hist.set(h.revision,{revision:h.revision,snapshot:ss,checksum:h.checksum||rawChecksum(ss)});}
 const row=()=>({id:'cid',localKey:'iid',name,revision:rr,checksum:rawChecksum(rs),updatedAt:'2026-09-10T11:00:00Z'});
 const api={
  workspace:async()=>({organizer:{id:'org',displayName:'Org'}}),getSettings:async()=>({revision:0,settings:{}}),putSettings:async()=>({revision:0}),
  listTournaments:async()=>({tournaments:[row()]}),listArchivedTournaments:async()=>({tournaments:[]}),createTournament:async()=>({tournament:row()}),restoreArchivedTournament:async()=>({tournament:row()}),
  getCurrentSnapshot:async(_t,id)=>{if(id!=='cid')throw nf();return {tournament:row(),snapshot:clone(rs)};},
  listRevisions:async()=>{listReads++;return {tournament:row(),revisions:[...hist.values()].map(h=>({revision:h.revision,checksum:h.checksum,createdAt:'2026-09-10T10:00:00Z'}))};},
  getRevision:async(_t,id,rev)=>{historyReads++;const h=hist.get(Number(rev));if(id!=='cid'||!h)throw nf();return {tournament:{...row(),revision:h.revision,checksum:h.checksum},snapshot:clone(h.snapshot)};},
  putSnapshot:async(_t,args)=>{puts++;if(Number(args.baseRevision)!==rr){const e=new Error('revision conflict');e.code='cloud_revision_conflict';e.currentRevision=rr;throw e;}rr++;rs=clone(args.snapshot);return {revision:rr,cloudTournamentId:'cid',internalId:'iid',checksum:rawChecksum(rs),contentFingerprint:fp(rs.data.tournaments[rs.data.currentTournament]),updatedAt:'2026-09-10T11:01:00Z'};},
  restoreRevision:async()=>({revision:rr})
 };
 const fakeEl={addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},style:{},classList:{toggle(){},add(){},remove(){}},appendChild(){},insertBefore(){},insertAdjacentElement(){},closest(){return null;},remove(){},children:[]};
 const overlays=[];
 const document={documentElement:{dataset:{chesspublisherVersion:'1.06.00-beta.94'}},querySelector(){return null;},getElementById(id){return overlays.find(x=>x.id===id)||null;},createElement(){const el={...fakeEl,innerHTML:'',id:'',className:'',textContent:'',hidden:false,dataset:{}};el.querySelectorAll=()=>[];return el;},head:fakeEl,body:{...fakeEl,appendChild(el){overlays.push(el);}}};
 const store=new Map();
 const ctx={console:{log(){},warn(){},error(){}},crypto:crypto.webcrypto,TextEncoder,Headers,URL,navigator:{platform:'Win32'},document,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))},data,stateDirty:false,
  getCurrentTournament:()=>data.tournaments[data.currentTournament],getPersistentSnapshot:()=>({version:'V99',data:clone(data),telegramGlobal:{},currentTournament:data.currentTournament,preferences:{}}),cpSnapshotForExternalFile:v=>clone(v),saveAll(){},fileSaveTournament:async()=>{saves++;return true;},saveData(){},normalizeData(){},refreshEverything(){},cpResetTournamentDocumentBinding(){},cpValidateSnapshotStructure:()=>true,showTab(){},prepareCurrentTournamentForTransition:async()=>true,
  setTimeout:(fn,ms)=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},location:{href:''},alert(){},confirm:()=>true,appConfirm:async()=>true
 };
 ctx.window=ctx;ctx.globalThis=ctx;ctx.ChessPublisherCloudWorkspaceApi={createClient:()=>api,CloudWorkspaceApiError:class extends Error{constructor(m,d={}){super(m);Object.assign(this,d);}}};ctx.cpNativeHubSecretGet=async()=> 'token';ctx.cpOnlineOrganizerSecretKey=()=> 'organizer-primary:test';
 vm.createContext(ctx);vm.runInContext(adapterSrc,ctx,{filename:'CloudWorkspaceAdapter.js'});vm.runInContext(dirSrc,ctx,{filename:'CloudWorkspaceRedesign.js'});
 return {ctx,data,hist,get puts(){return puts;},get rr(){return rr;},get rs(){return rs;},get historyReads(){return historyReads;},get listReads(){return listReads;},get overlays(){return overlays;},setRemote(t,rev){rr=Number(rev);rs=snap(name,t);}};
}

(async()=>{
 check(adapterSrc.includes('saved-checksum-immutable-revision'), 'BASE94-01 adapter supports exact saved-checksum historical lineage recovery');
 check(adapterSrc.includes('saved-checksum-current-remote'), 'BASE94-02 current remote checksum can prove common base when revision metadata is missing');
 check(dirSrc.includes('Keep Desktop entire tournament')&&dirSrc.includes('Keep Cloud entire tournament'),'BASE94-03 missing-base UI offers whole-tournament safe choices instead of OK-only alert');
 check(dirSrc.includes('Cloud changed to revision r${latestRevision} while the conflict dialog was open'),'BASE94-04 Keep Desktop has a refetch/race gate');
 check(html.includes('markCloudStructuralSyncIntent(t,"reset-tournament")'),'BASE94-05 Reset Tournament records explicit structural sync intent');
 check(html.includes('markCloudStructuralSyncIntent(t,"delete-round")'),'BASE94-06 Delete Round records explicit structural sync intent');

 { // missing baseRevision, but exact historical checksum proves r5; independent edits merge+push
  const b=base('Checksum History'); const l=clone(b);l.settings.city='Kardzhali'; const r=clone(b);r.settings.organizer='Web Club';
  const bs=snap(b.name,b), c5=rawChecksum(bs);
  const h=harness({local:l,remote:r,remoteRevision:6,baseRevision:0,baseFingerprint:'',schema:6,lastSyncedHash:c5,history:[{revision:5,tournament:b,checksum:c5}]});
  const x=await h.ctx.cpCloudSyncUnified();
  check(x?.ok===true&&x?.autoMerged===true&&h.puts===1,'BASE94-07 missing revision/fingerprint recovers immutable base by exact saved checksum and safely merge-pushes');
  check(h.listReads>=1&&h.historyReads>=1,'BASE94-08 checksum recovery actually consults revision history and downloads the matched immutable revision');
  const up=h.rs.data.tournaments[h.rs.data.currentTournament];
  check(up.settings.city==='Kardzhali'&&up.settings.organizer==='Web Club','BASE94-09 recovered three-way merge preserves independent Desktop + Cloud changes');
 }

 { // stale baseRevision points nowhere; checksum finds actual r8
  const b=base('Stale Revision');const l=clone(b);l.settings.city='Plovdiv';const r=clone(b);r.settings.organizer='Remote';const bs=snap(b.name,b),c8=rawChecksum(bs);
  const h=harness({local:l,remote:r,remoteRevision:9,baseRevision:3,baseFingerprint:'',schema:6,lastSyncedHash:c8,history:[{revision:8,tournament:b,checksum:c8}]});
  const x=await h.ctx.cpCloudSyncUnified();
  check(x?.ok===true&&h.puts===1,'BASE94-10 stale/missing baseRevision is repaired by exact checksum match to another immutable revision');
  check(h.ctx.getCurrentTournament().cloud.baseRevision===10,'BASE94-11 repaired lineage advances to the newly published revision');
 }

 { // current remote checksum is last acknowledged; local-only change can push without history
  const b=base('Current Checksum');const l=clone(b);l.settings.city='Varna';const remote=clone(b);const currentChecksum=rawChecksum(snap(b.name,remote));
  const h=harness({local:l,remote,remoteRevision:12,baseRevision:0,baseFingerprint:'',schema:6,lastSyncedHash:currentChecksum,history:[]});
  const x=await h.ctx.cpCloudSyncUnified();
  check(x?.ok===true&&h.puts===1,'BASE94-12 exact current Cloud checksum proves base and permits local-only push without historical lookup');
  check(h.listReads===0,'BASE94-13 current-checksum proof does not need history scan');
 }

 { // Reset intent with no base: allowed only if cloud is still at recorded revision
  const b=base('Reset Intent');const l=clone(b);l.pairings.liveBoards={};l.cloud={...(l.cloud||{}),pendingStructuralSync:{kind:'reset-tournament',cloudTournamentId:'cid',baseRevision:20,createdAt:'2026-09-10T12:00:00Z'}};
  const r=clone(b);const h=harness({local:l,remote:r,remoteRevision:20,baseRevision:20,baseFingerprint:'',schema:6,lastSyncedHash:'',history:[]});
  // harness replaces cloud, re-add intent after construction
  h.ctx.getCurrentTournament().cloud.pendingStructuralSync={kind:'reset-tournament',cloudTournamentId:'cid',baseRevision:20,createdAt:'2026-09-10T12:00:00Z'};
  const x=await h.ctx.cpCloudSyncUnified();
  check(x?.ok===true&&h.puts===1,'BASE94-14 confirmed Reset publishes when current Cloud revision itself proves the missing base');
  check(!h.ctx.getCurrentTournament().cloud.pendingStructuralSync,'BASE94-15 successful structural push consumes the intent marker');
 }

 { // no proof and both sides differ => no write, whole-tournament resolver available
  const b=base('No Base');const l=clone(b);l.settings.city='Local';const r=clone(b);r.settings.city='Remote';
  const h=harness({local:l,remote:r,remoteRevision:4,baseRevision:0,baseFingerprint:'',schema:6,lastSyncedHash:'',history:[]});
  const before=h.puts;const x=await h.ctx.cpCloudSyncUnified();
  check(x?.conflict===true&&h.puts===before,'BASE94-16 genuinely unprovable common base remains fail-closed with zero writes');
  check(typeof h.ctx.cpCloudResolveWholeTournament==='function','BASE94-17 whole-tournament resolver is exposed for explicit recovery');
  const y=await h.ctx.cpCloudResolveWholeTournament('cloud');
  check(y?.ok===true&&y?.kept==='cloud'&&h.puts===before,'BASE94-18 explicit Keep Cloud replaces Desktop only and performs zero Cloud writes');
  check(h.ctx.getCurrentTournament().settings.city==='Remote','BASE94-19 Keep Cloud establishes a fresh valid local common base');
 }

 { // explicit Keep Desktop safely overwrites whole remote using current revision
  const b=base('Keep Desktop');const l=clone(b);l.settings.city='Desktop';const r=clone(b);r.settings.city='Cloud';
  const h=harness({local:l,remote:r,remoteRevision:7,baseRevision:0,baseFingerprint:'',schema:6,lastSyncedHash:'',history:[]});
  const x=await h.ctx.cpCloudSyncUnified();check(x?.conflict===true,'BASE94-20 missing-base conflict is pending before explicit whole-tournament choice');
  const y=await h.ctx.cpCloudResolveWholeTournament('desktop');
  check(y?.ok===true&&y?.kept==='desktop'&&h.puts===1,'BASE94-21 explicit Keep Desktop publishes exactly one whole-tournament replacement');
  const up=h.rs.data.tournaments[h.rs.data.currentTournament];check(up.settings.city==='Desktop','BASE94-22 Keep Desktop publishes the selected complete Desktop snapshot');
 }

 { // stale reset marker must not bypass remote advancement
  const b=base('Stale Reset');const l=clone(b);l.pairings.liveBoards={};const r=clone(b);r.settings.city='Web changed';
  const h=harness({local:l,remote:r,remoteRevision:22,baseRevision:20,baseFingerprint:'',schema:6,lastSyncedHash:'',history:[]});
  h.ctx.getCurrentTournament().cloud.pendingStructuralSync={kind:'reset-tournament',cloudTournamentId:'cid',baseRevision:20,createdAt:'2026-09-10T12:00:00Z'};
  const x=await h.ctx.cpCloudSyncUnified();
  check(x?.conflict===true&&h.puts===0,'BASE94-23 stale Reset intent cannot overwrite a Cloud revision that advanced after the recorded base');
 }

 { // Keep Desktop race gate: Cloud advances while resolver is open
  const b=base('Race Gate');const l=clone(b);l.settings.city='Desktop';const r=clone(b);r.settings.city='Cloud';
  const h=harness({local:l,remote:r,remoteRevision:7,baseRevision:0,baseFingerprint:'',schema:6,lastSyncedHash:'',history:[]});
  const x=await h.ctx.cpCloudSyncUnified();check(x?.conflict===true,'BASE94-24 race test starts from a genuine missing-base conflict');
  const newer=clone(r);newer.settings.organizer='Changed while dialog open';h.setRemote(newer,8);
  let err=null;try{await h.ctx.cpCloudResolveWholeTournament('desktop');}catch(e){err=e;}
  check(!!err&&/Cloud changed to revision r8/.test(err.message)&&h.puts===0,'BASE94-25 Keep Desktop fails closed with zero writes if Cloud advances while resolver is open');
 }

 { // Open a different Cloud tournament: never legacy-pre-sync the non-current linked local copy
  const cloudBase=base('Cloud Open Different');const localLinked=clone(cloudBase);localLinked.settings.city='Unsynced local';
  const h=harness({local:localLinked,remote:cloudBase,remoteRevision:3,baseRevision:3,baseFingerprint:fp(cloudBase),schema:7,lastSyncedHash:'',history:[{revision:3,tournament:cloudBase}]});
  const other=base('Other Current');other.cloud={schemaVersion:4,localKey:'other-lk',internalId:'other-iid',cloudTournamentId:'',revision:0,baseRevision:0,baseFingerprint:'',lastSyncedContentHash:'',fingerprintContentSchema:7};
  h.data.tournaments['Other Current']=other;h.data.currentTournament='Other Current';
  const before=h.puts;let opened=null,err=null;try{opened=await h.ctx.cpCloudOpenTournament('cid');}catch(e){err=e;}
  check(!err&&opened==='Cloud Open Different','BASE94-26 explicit Open of a different Cloud identity succeeds without legacy non-current reconciliation');
  check(h.puts===before&&h.data.currentTournament==='Cloud Open Different','BASE94-27 Cloud Open does not write Cloud merely to open a different tournament');
  check(h.ctx.getCurrentTournament().settings.city==='Sofia','BASE94-28 confirmed Cloud Open imports the exact Cloud copy, not the dirty non-current local copy');
 }

 console.log(`BETA94 COMMON BASE RECOVERY: ${fail?'FAIL':'PASS'} (${pass} PASS / ${fail} FAIL)`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
