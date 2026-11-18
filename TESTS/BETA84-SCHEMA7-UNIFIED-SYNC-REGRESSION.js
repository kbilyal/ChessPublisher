"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto");
const root=path.resolve(__dirname,"..");
const adapterSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceAdapter.js"),"utf8");
const dirSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
let pass=0,fail=0;
function check(cond,label){if(cond){console.log(`PASS: ${label}`);pass++;}else{console.error(`FAIL: ${label}`);fail++;}}
function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}
function text(v){return v==null?"":String(v).trim();}
const installKeys=new Set(['organizertoken','managetoken','managekey','admintoken','authtoken','accesstoken','refreshtoken','devicetoken','password','secret','devicesecret','aeskey','aes','iv','filepath','folderpath','installationpath','windowspath','linuxpath','executablepath','workingdirectory','serialport','usbpath','dgtport']);
const volatileKeys=new Set(['updatedat','lastviewedat','lastaccess','requesttimestamp','requesttimestamps','cachetimestamp','cachetimestamps','generatedat','serverprocessingmetadata','processingmetadata','browserstate','browserdata','sessionstate','sessiondata']);
function sanitize(v){if(Array.isArray(v))return v.map(sanitize);if(!v||typeof v!=="object")return v;const o={};for(const [k,x] of Object.entries(v)){if(installKeys.has(k.toLowerCase())||volatileKeys.has(k.toLowerCase()))continue;o[k]=sanitize(x);}return o;}
function projection(t){const o=sanitize(clone(t||{}));for(const k of ['cloud','online','hub','publication','savedAt','dgt','uiState','runtimeState'])delete o[k];if(o.telegram&&typeof o.telegram==='object'){delete o.telegram.token;delete o.telegram.botToken;}return o;}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())if(v[k]!==undefined)o[k]=canonical(v[k]);return o;}return v;}
function webFingerprint(t){return crypto.createHash('sha256').update(JSON.stringify(canonical(projection(t)))).digest('hex');}
function snapshot(name,t){const one=clone(t);return {version:'V99',data:{currentTournament:name,tournaments:{[name]:one},preferences:{}},telegramGlobal:{},currentTournament:name,preferences:{},cloudWorkspace:{schemaVersion:5,fingerprintContentSchema:7}};}
function snapshotTournament(s){const n=s.data.currentTournament;return s.data.tournaments[n];}
function notFound(){const e=new Error('not found');e.status=404;e.code='not_found';return e;}

function baseTournament(name='Event'){
  return {name,settings:{city:'Sofia',organizer:'Club'},players:[{id:'p1',name:'A',rating:2000},{id:'p2',name:'B',rating:1900}],pairings:{liveBoards:{'1':{round:1,board:1,whiteKey:'p1',blackKey:'p2',result:'-'}}},telegram:{language:'en'},cloud:{schemaVersion:4,localKey:'local-key',internalId:'internal-1'}};
}

function makeHarness({local,remoteRevision=0,remoteTournament=null,baseRevision=0,baseFingerprint='',fingerprintContentSchema=7,oldFingerprint=''}={}){
  const name=local.name||'Event';
  local.cloud={...(local.cloud||{}),schemaVersion:4,localKey:local.cloud?.localKey||'local-key',internalId:local.cloud?.internalId||'internal-1',cloudTournamentId:'cloud-1',revision:baseRevision,baseRevision,baseFingerprint:baseFingerprint||oldFingerprint,lastSyncedContentHash:baseFingerprint||oldFingerprint,lastSyncedHash:'',...(fingerprintContentSchema==null?{}:{fingerprintContentSchema})};
  const data={currentTournament:name,tournaments:{[name]:local},preferences:{}};
  let remote=remoteTournament?snapshot(name,remoteTournament):null;
  let remoteRev=remoteRevision;
  const revisions=new Map();
  if(remote&&remoteRev>0)revisions.set(remoteRev,clone(remote));
  let puts=0,getRevisions=0,saves=0;
  let ctx=null;
  const row=()=>({id:'cloud-1',localKey:'internal-1',name,revision:remoteRev,checksum:remote?crypto.createHash('sha256').update(JSON.stringify(remote)).digest('hex'):'',updatedAt:`2026-09-09T18:${String(remoteRev).padStart(2,'0')}:00Z`});
  const api={
    workspace:async()=>({organizer:{id:'org-1',displayName:'Org'}}),
    getSettings:async()=>({revision:0,settings:{}}),putSettings:async()=>({revision:0}),
    listTournaments:async()=>({tournaments:[row()]}),
    createTournament:async()=>({tournament:row()}),
    getCurrentSnapshot:async(_token,id)=>{if(id!=='cloud-1'||!remote)throw notFound();return {tournament:row(),snapshot:clone(remote)};},
    getRevision:async(_token,id,rev)=>{getRevisions++;const s=revisions.get(Number(rev));if(id!=='cloud-1'||!s)throw notFound();return {tournament:{...row(),revision:Number(rev)},snapshot:clone(s)};},
    putSnapshot:async(_token,args)=>{
      puts++;
      if(Number(args.baseRevision)!==remoteRev){const e=new Error('revision conflict');e.code='cloud_revision_conflict';e.currentRevision=remoteRev;throw e;}
      remoteRev++;
      remote=clone(args.snapshot);
      revisions.set(remoteRev,clone(remote));
      const fp=webFingerprint(snapshotTournament(remote));
      return {cloudTournamentId:'cloud-1',internalId:'internal-1',revision:remoteRev,contentFingerprint:fp,checksum:`checksum-${remoteRev}`,updatedAt:`2026-09-09T19:${String(remoteRev).padStart(2,'0')}:00Z`};
    },
    listRevisions:async()=>({revisions:[]}),restoreRevision:async()=>({revision:remoteRev})
  };
  const fakeEl={addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},style:{},classList:{toggle(){},add(){},remove(){}},appendChild(){},insertBefore(){},closest(){return null;},remove(){}};
  const document={documentElement:{dataset:{chesspublisherVersion:'1.06.00-beta.85'}},querySelector(){return null;},getElementById(){return null;},createElement(){return {...fakeEl,innerHTML:'',id:'',className:'',textContent:'',hidden:false};},head:fakeEl,body:fakeEl};
  const store=new Map();
  const context={console:{log(){},warn(){},error(){}},crypto:crypto.webcrypto,TextEncoder,Headers,URL,navigator:{platform:'Win32'},document,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))},data,stateDirty:false,
    getCurrentTournament:()=>data.tournaments[data.currentTournament],
    getPersistentSnapshot:()=>({version:'V99',data:clone(data),telegramGlobal:{},currentTournament:data.currentTournament,preferences:{}}),
    cpSnapshotForExternalFile:v=>clone(v),saveAll(){},fileSaveTournament:async()=>{saves++;return true;},saveData(){},normalizeData(){},refreshEverything(){},cpResetTournamentDocumentBinding(){},cpValidateSnapshotStructure:()=>true,showTab(){},prepareCurrentTournamentForTransition:async()=>true,
    setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},location:{href:''},alert(){},confirm:()=>true,appConfirm:async()=>true
  };
  context.window=context;context.globalThis=context;
  context.ChessPublisherCloudWorkspaceApi={createClient:()=>api,CloudWorkspaceApiError:class extends Error{constructor(m,d={}){super(m);Object.assign(this,d);}}};
  context.cpNativeHubSecretGet=async()=> 'token';context.cpOnlineOrganizerSecretKey=()=> 'organizer-primary:test';
  vm.createContext(context);vm.runInContext(adapterSrc,context,{filename:'CloudWorkspaceAdapter.js'});vm.runInContext(dirSrc,context,{filename:'CloudWorkspaceRedesign.js'});ctx=context;
  return {ctx,data,revisions,get remote(){return remote;},get remoteRevision(){return remoteRev;},get puts(){return puts;},get getRevisions(){return getRevisions;},get saves(){return saves;},setRemoteTournament(t,rev){remoteRev=rev;remote=snapshot(name,t);revisions.set(rev,clone(remote));}};
}

(async()=>{
  // FP-01 recursive volatile filtering and excluded metadata.
  {
    const t1=baseTournament('FP');
    t1.updatedAt='one';t1.settings.generatedAt='a';t1.settings.deep={cacheTimestamp:'x',sessionData:{foo:1},browserState:{zoom:2},keep:'yes'};t1.uiState={tab:'A'};t1.runtimeState={busy:true};t1.telegram.token='secret-a';t1.cloud={baseRevision:1};
    const t2=clone(t1);t2.updatedAt='two';t2.settings.generatedAt='b';t2.settings.deep.cacheTimestamp='y';t2.settings.deep.sessionData={foo:999};t2.settings.deep.browserState={zoom:9};t2.uiState={tab:'B'};t2.runtimeState={busy:false};t2.telegram.token='secret-b';t2.cloud={baseRevision:999};
    const h=makeHarness({local:baseTournament('FP')});
    const core=h.ctx.ChessPublisherCloudSyncInternals;
    const a=await core.tournamentContentHash('FP',t1),b=await core.tournamentContentHash('FP',t2);
    check(a===b,"FP-01 volatile updated/generated/cache/session/browser fields and excluded metadata do not change schema-7 fingerprint");
    check(a===webFingerprint(t1),"FP-01 Desktop fingerprint exactly matches Web schema-7 reference projection");
  }

  // FP-02 canonical object key order, arrays remain ordered.
  {
    const a={name:'Order',settings:{z:1,a:2,nested:{b:3,a:4}},players:[{id:'p1',name:'A'},{id:'p2',name:'B'}]};
    const b={players:[{name:'A',id:'p1'},{name:'B',id:'p2'}],settings:{nested:{a:4,b:3},a:2,z:1},name:'Order'};
    const h=makeHarness({local:baseTournament('Order')});const core=h.ctx.ChessPublisherCloudSyncInternals;
    check(await core.tournamentContentHash('Order',a)===await core.tournamentContentHash('Order',b),"FP-02 different object insertion order yields identical fingerprint");
    const c=clone(b);c.players.reverse();
    check(await core.tournamentContentHash('Order',a)!==await core.tournamentContentHash('Order',c),"FP-02 semantic array order is preserved");
  }

  // SCHEMA-01 old/missing fingerprint schema reconstructs immutable baseRevision.
  {
    const base=baseTournament('Schema Event');const web=clone(base);web.settings.city='Plovdiv';
    const h=makeHarness({local:clone(base),remoteRevision:6,remoteTournament:web,baseRevision:5,oldFingerprint:'legacy-hash',fingerprintContentSchema:null});
    h.revisions.set(5,snapshot('Schema Event',base));
    const r=await h.ctx.cpCloudSyncUnified();
    check(r.ok===true&&r.direction==='pull'&&h.ctx.getCurrentTournament().settings.city==='Plovdiv',"SCHEMA-01 old hash is ignored and baseRevision is reconstructed for CLOUD_ONLY pull");
    check(h.getRevisions>=1,"SCHEMA-01 immutable Cloud base revision is downloaded for schema-7 reconstruction");
    check(h.ctx.getCurrentTournament().cloud.fingerprintContentSchema===7&&h.ctx.getCurrentTournament().cloud.baseRevision===6,"SCHEMA-01 pulled common base is persisted with fingerprintContentSchema 7");
  }

  // SYNC-A through SYNC-D sequential state machine.
  {
    const base=baseTournament('Sequence Event');const baseHash=webFingerprint(base);
    const h=makeHarness({local:clone(base),remoteRevision:5,remoteTournament:clone(base),baseRevision:5,baseFingerprint:baseHash,fingerprintContentSchema:7});
    h.revisions.set(5,snapshot('Sequence Event',base));

    // SYNC-A local-only r5 -> r6, then immediate NO-OP.
    h.ctx.getCurrentTournament().players[0].rating=2050;
    let r=await h.ctx.cpCloudSyncUnified();
    check(r.ok===true&&r.direction==='push'&&h.remoteRevision===6,"SYNC-A Desktop-only edit pushes r5 → r6");
    const putsAfterA=h.puts;
    r=await h.ctx.cpCloudSyncUnified();
    check(r.ok===true&&r.unchanged===true&&h.remoteRevision===6&&h.puts===putsAfterA,"SYNC-A immediate second SYNC is NO-OP");
    check(h.ctx.getCurrentTournament().cloud.baseRevision===6&&h.ctx.getCurrentTournament().cloud.fingerprintContentSchema===7,"SYNC-A server response establishes durable schema-7 r6 common base");

    // SYNC-B Web result only r6 -> r7, pull/apply, then NO-OP.
    const webR7=clone(snapshotTournament(h.remote));webR7.pairings.liveBoards['1'].result='1 - 0';
    h.setRemoteTournament(webR7,7);
    r=await h.ctx.cpCloudSyncUnified();
    check(r.ok===true&&r.direction==='pull'&&h.ctx.getCurrentTournament().pairings.liveBoards['1'].result==='1 - 0',"SYNC-B Web-only result r6 → r7 is CLOUD_ONLY and pulled");
    const putsAfterB=h.puts;
    r=await h.ctx.cpCloudSyncUnified();
    check(r.ok===true&&r.unchanged===true&&h.ctx.getCurrentTournament().cloud.baseRevision===7&&h.puts===putsAfterB,"SYNC-B next SYNC is NO-OP at base r7");

    // SYNC-C Desktop player edit only -> r8.
    h.ctx.getCurrentTournament().players[0].name='A Desktop';
    r=await h.ctx.cpCloudSyncUnified();
    check(r.ok===true&&r.direction==='push'&&h.remoteRevision===8,"SYNC-C Desktop-only player edit pushes r7 → r8");

    // SYNC-D independent two-sided edits => deterministic merge + one PUT.
    h.ctx.getCurrentTournament().players[0].rating=2100;
    const webR9=clone(snapshotTournament(h.remote));webR9.players[1].rating=1950;h.setRemoteTournament(webR9,9);
    const putsBeforeD=h.puts;
    r=await h.ctx.cpCloudSyncUnified();
    check(r.ok===true&&r.direction==='merge-push'&&r.autoMerged===true,"SYNC-D independent Desktop player A + Web player B edits auto-merge safely");
    check(h.puts===putsBeforeD+1&&h.remoteRevision===10,"SYNC-D independent merge publishes exactly one new Cloud revision");
    check(snapshotTournament(h.remote).players[0].rating===2100&&snapshotTournament(h.remote).players[1].rating===1950,"SYNC-D merged Cloud snapshot preserves both Desktop and Web edits");
  }

  // RECOVERY-01 remote upload succeeded previously but local base metadata remained at r10.
  {
    const equal=baseTournament('Recovery Event');equal.players[0].rating=2222;
    const oldBase=baseTournament('Recovery Event');const oldHash=webFingerprint(oldBase);
    const h=makeHarness({local:clone(equal),remoteRevision:11,remoteTournament:clone(equal),baseRevision:10,baseFingerprint:oldHash,fingerprintContentSchema:7});
    h.revisions.set(10,snapshot('Recovery Event',oldBase));
    const putsBefore=h.puts;
    const r=await h.ctx.cpCloudSyncUnified();
    check(r.ok===true&&r.unchanged===true&&!r.conflict&&h.puts===putsBefore,"RECOVERY-01 equal Desktop/Cloud content repairs stale base without conflict or re-upload");
    check(h.ctx.getCurrentTournament().cloud.baseRevision===11&&h.ctx.getCurrentTournament().cloud.fingerprintContentSchema===7,"RECOVERY-01 adopts remote r11 as the durable common base");
  }

  console.log(`BETA84 SCHEMA7 UNIFIED SYNC: ${fail?"FAIL":"PASS"} (${pass} PASS / ${fail} FAIL)`);
  process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
