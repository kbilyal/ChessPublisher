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
    setTimeout:(fn,ms)=>Number(ms)===120?global.setTimeout(fn,0):0,clearTimeout(){},setInterval:()=>0,clearInterval(){},location:{href:''},alert(){},confirm:()=>true,appConfirm:async()=>true
  };
  context.window=context;context.globalThis=context;
  context.ChessPublisherCloudWorkspaceApi={createClient:()=>api,CloudWorkspaceApiError:class extends Error{constructor(m,d={}){super(m);Object.assign(this,d);}}};
  context.cpNativeHubSecretGet=async()=> 'token';context.cpOnlineOrganizerSecretKey=()=> 'organizer-primary:test';
  vm.createContext(context);vm.runInContext(adapterSrc,context,{filename:'CloudWorkspaceAdapter.js'});vm.runInContext(dirSrc,context,{filename:'CloudWorkspaceRedesign.js'});ctx=context;
  return {ctx,data,revisions,get remote(){return remote;},get remoteRevision(){return remoteRev;},get puts(){return puts;},get getRevisions(){return getRevisions;},get saves(){return saves;},setRemoteTournament(t,rev){remoteRev=rev;remote=snapshot(name,t);revisions.set(rev,clone(remote));}};
}

(async()=>{
  check(adapterSrc.includes('__cpUnifiedSyncAuthorityV2'),"AUTH-01 legacy adapter contains explicit unified-authority delegation gate");
  check(dirSrc.includes('syncCurrent.__cpUnifiedSyncAuthorityV2=true'),"AUTH-02 redesign marks unified schema-7 SYNC as current-tournament authority");

  {
    const base=baseTournament('Reset Authority');
    base.pairings.liveBoards={'1':[{round:1,board:1,whiteKey:'p1',blackKey:'p2',result:'1 - 0'}]};
    const baseHash=webFingerprint(base);
    const h=makeHarness({local:clone(base),remoteRevision:27,remoteTournament:clone(base),baseRevision:27,baseFingerprint:baseHash,fingerprintContentSchema:7});
    h.revisions.set(27,snapshot('Reset Authority',base));
    h.ctx.getCurrentTournament().pairings.liveBoards={};
    h.ctx.getCurrentTournament().pairings.round='-1';
    const before=h.puts;
    let err=null,r=null;
    try{r=await h.ctx.cpCloudSyncAllLocal({quiet:false});}catch(e){err=e;}
    const uploaded=snapshotTournament(h.remote);
    check(!err,"AUTH-03 legacy startup/backup entry point no longer throws old current-tournament conflict");
    check(r?.ok===true&&h.puts===before+1,"AUTH-04 legacy current-tournament sync delegates to unified engine and performs one safe push");
    check(Object.keys(uploaded.pairings?.liveBoards||{}).length===0,"AUTH-05 Reset Tournament empty pairing structure reaches Cloud through delegated unified SYNC");
    check(h.ctx.getCurrentTournament().cloud.baseRevision===28,"AUTH-06 delegated current SYNC advances the same schema-7 common base");
  }

  {
    const base=baseTournament('Open Authority');
    base.pairings.liveBoards={'1':[{round:1,board:1,whiteKey:'p1',blackKey:'p2',result:'-'}]};
    const baseHash=webFingerprint(base);
    const h=makeHarness({local:clone(base),remoteRevision:11,remoteTournament:clone(base),baseRevision:11,baseFingerprint:baseHash,fingerprintContentSchema:7});
    h.revisions.set(11,snapshot('Open Authority',base));
    h.ctx.getCurrentTournament().settings.city='Kardzhali';
    const before=h.puts;
    let err=null,opened=null;
    try{opened=await h.ctx.cpCloudOpenTournament('cloud-1');}catch(e){err=e;}
    check(!err,"AUTH-07 Cloud-open pre-sync of the current identity no longer uses the legacy conflict classifier");
    check(h.puts===before+1,"AUTH-08 Cloud-open pre-sync delegates current local change through unified SYNC before opening");
    check(opened==='Open Authority'&&h.ctx.getCurrentTournament().settings.city==='Kardzhali',"AUTH-09 Cloud-open returns the same logical tournament with delegated local change preserved");
  }

  {
    const base=baseTournament('True Conflict');
    base.pairings.liveBoards={'1':[{round:1,board:1,whiteKey:'p1',blackKey:'p2',result:'-'}]};
    const baseHash=webFingerprint(base);
    const local=clone(base);local.settings.city='Local City';
    const remote=clone(base);remote.settings.city='Remote City';
    const h=makeHarness({local,remoteRevision:6,remoteTournament:remote,baseRevision:5,baseFingerprint:baseHash,fingerprintContentSchema:7});
    h.revisions.set(5,snapshot('True Conflict',base));
    const before=h.puts;
    let err=null,r=null;
    try{r=await h.ctx.cpCloudSyncAllLocal({quiet:false});}catch(e){err=e;}
    check(!err,"AUTH-10 legacy entry point delegates true two-sided change without throwing the old adapter dialog");
    check(h.puts===before,"AUTH-11 true same-field conflict remains fail-closed with zero Cloud writes");
  }

  console.log(`BETA93 SINGLE SYNC AUTHORITY: ${fail?"FAIL":"PASS"} (${pass} PASS / ${fail} FAIL)`);
  process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
