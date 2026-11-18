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
  const base=baseTournament('Pairing Flow');
  base.pairings.liveBoards={'1':[{round:1,board:1,whiteKey:'p1',blackKey:'p2',result:'-'}]};
  const baseHash=webFingerprint(base);
  const h=makeHarness({local:clone(base),remoteRevision:12,remoteTournament:clone(base),baseRevision:12,baseFingerprint:baseHash,fingerprintContentSchema:7});
  h.revisions.set(12,snapshot('Pairing Flow',base));

  // Real arbiter workflow: Desktop already generated the next round while Web
  // has a newly entered result from the preceding round.
  h.ctx.getCurrentTournament().pairings.liveBoards['2']=[{round:2,board:1,whiteKey:'p2',blackKey:'p1',result:'-'}];
  const webR13=clone(base);webR13.pairings.liveBoards['1'][0].result='1 - 0';h.setRemoteTournament(webR13,13);
  const putsBefore=h.puts;
  let r=await h.ctx.cpCloudDownloadWebResults();
  const uploaded=snapshotTournament(h.remote);
  check(r.ok===true&&r.synced===true&&h.remoteRevision===14,"PAIRING-01 Pairings SYNC imports the Web result and publishes one merged revision");
  check(h.puts===putsBefore+1&&uploaded.pairings.liveBoards['1'][0].result==='1 - 0',"PAIRING-02 merged Cloud revision preserves the Web result");
  check(Array.isArray(uploaded.pairings.liveBoards['2'])&&uploaded.pairings.liveBoards['2'].length===1&&uploaded.pairings.liveBoards['2'][0].whiteKey==='p2',"PAIRING-03 newly generated Desktop round is included in the Cloud PUT snapshot");
  check(h.ctx.getCurrentTournament().cloud.baseRevision===14&&h.ctx.getCurrentTournament().cloud.fingerprintContentSchema===7,"PAIRING-04 merged upload establishes schema-7 common base r14");

  const afterMergePuts=h.puts;
  r=await h.ctx.cpCloudSyncUnified();
  check(r.ok===true&&r.unchanged===true&&h.puts===afterMergePuts,"PAIRING-05 immediate second SYNC is NO-OP");

  // True collision on the same board/result still fails closed.
  h.ctx.getCurrentTournament().pairings.liveBoards['2'][0].result='1 - 0';
  const webR15=clone(snapshotTournament(h.remote));webR15.pairings.liveBoards['2'][0].result='0 - 1';h.setRemoteTournament(webR15,15);
  const putsBeforeConflict=h.puts;
  r=await h.ctx.cpCloudSyncUnified();
  check(r.conflict===true&&r.direction==='conflict',"PAIRING-06 different Desktop/Web results on the same board remain a real conflict");
  check(h.puts===putsBeforeConflict,"PAIRING-07 true same-board conflict performs no Cloud PUT");

  const core=h.ctx.ChessPublisherCloudSyncInternals;
  const noRound2=clone(base),withRound2=clone(base);withRound2.pairings.liveBoards['2']=[{round:2,board:1,whiteKey:'p2',blackKey:'p1',result:'-'}];
  check(await core.tournamentContentHash('Pairing Flow',noRound2)!==await core.tournamentContentHash('Pairing Flow',withRound2),"PAIRING-08 new round changes the schema-7 Desktop fingerprint");

  console.log(`BETA85 NEXT ROUND SYNC: ${fail?"FAIL":"PASS"} (${pass} PASS / ${fail} FAIL)`);
  process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
