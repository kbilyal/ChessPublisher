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
  let rowName=name;
  const revisions=new Map();
  if(remote&&remoteRev>0)revisions.set(remoteRev,clone(remote));
  let puts=0,getRevisions=0,saves=0;
  let ctx=null;
  const row=()=>({id:'cloud-1',localKey:'internal-1',name:rowName,revision:remoteRev,checksum:remote?crypto.createHash('sha256').update(JSON.stringify(remote)).digest('hex'):'',updatedAt:`2026-09-09T18:${String(remoteRev).padStart(2,'0')}:00Z`});
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
      rowName=text(remote?.data?.currentTournament||remote?.currentTournament)||rowName;
      revisions.set(remoteRev,clone(remote));
      const fp=webFingerprint(snapshotTournament(remote));
      return {cloudTournamentId:'cloud-1',internalId:'internal-1',revision:remoteRev,contentFingerprint:fp,checksum:`checksum-${remoteRev}`,updatedAt:`2026-09-09T19:${String(remoteRev).padStart(2,'0')}:00Z`};
    },
    listRevisions:async()=>({revisions:[]}),restoreRevision:async()=>({revision:remoteRev})
  };
  const fakeEl={addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},style:{},classList:{toggle(){},add(){},remove(){}},appendChild(){},insertBefore(){},closest(){return null;},remove(){}};
  const document={documentElement:{dataset:{chesspublisherVersion:'1.06.00-beta.87'}},querySelector(){return null;},getElementById(){return null;},createElement(){return {...fakeEl,innerHTML:'',id:'',className:'',textContent:'',hidden:false};},head:fakeEl,body:fakeEl};
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
  return {ctx,data,revisions,api,get remote(){return remote;},get remoteRevision(){return remoteRev;},get puts(){return puts;},get getRevisions(){return getRevisions;},get saves(){return saves;},setRemoteTournament(t,rev,newName=''){remoteRev=rev;if(newName)rowName=newName;remote=snapshot(rowName,t);revisions.set(rev,clone(remote));}};
}

(async()=>{
  function fullBase(name='Stress Flow'){
    const t=baseTournament(name);
    t.settings={...t.settings,venue:'Hall A',city:'Sofia',country:'BUL',startDate:'2026-10-01',endDate:'2026-10-02',rounds:'7',timeControl:'10+5',website:'https://old.example',generalNotes:'base'};
    t.schedule={registrationOpens:'2026-09-25T10:00',registrationCloses:'2026-10-01T09:00',technicalMeeting:'',openingCeremony:'2026-10-01T09:30',closingCeremony:'',awardCeremony:'',notes:'base',rows:[{no:'1',dateTime:'2026-10-01T10:00',event:'Round 1',description:'First round'}]};
    t.regulations={eligibility:'Open',additional:'base',tieBreaks:[]};
    t.pairings.liveBoards={'1':[{round:1,board:1,whiteKey:'p1',blackKey:'p2',result:'-'}]};
    return t;
  }
  let base,baseHash,h,r,uploaded;

  // Two different schedule rows changed on opposite sides should be a safe merge.
  base=fullBase('Stress Schedule Rows');
  base.schedule.rows.push({no:'2',dateTime:'2026-10-01T15:00',event:'Round 2',description:'Second round'});
  baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:100,remoteTournament:clone(base),baseRevision:100,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(100,snapshot(base.name,base));
  h.ctx.getCurrentTournament().schedule.rows[0].dateTime='2026-10-01T10:30';
  const webRow2=clone(base);webRow2.schedule.rows[1].description='Second round — Web note';h.setRemoteTournament(webRow2,101);
  r=await h.ctx.cpCloudSyncUnified();uploaded=snapshotTournament(h.remote);
  check(r.ok===true&&r.direction==='merge-push'&&uploaded.schedule.rows[0].dateTime==='2026-10-01T10:30'&&uploaded.schedule.rows[1].description==='Second round — Web note','STRESS-01 independent edits to different Schedule rows auto-merge');

  // Same schedule row but different fields should merge by stable row identity.
  base=fullBase('Stress Same Schedule Row');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:110,remoteTournament:clone(base),baseRevision:110,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(110,snapshot(base.name,base));
  h.ctx.getCurrentTournament().schedule.rows[0].dateTime='2026-10-01T10:45';
  const webSameRow=clone(base);webSameRow.schedule.rows[0].description='Description edited on Web';h.setRemoteTournament(webSameRow,111);
  r=await h.ctx.cpCloudSyncUnified();uploaded=snapshotTournament(h.remote);
  check(r.ok===true&&r.direction==='merge-push'&&uploaded.schedule.rows[0].dateTime==='2026-10-01T10:45'&&uploaded.schedule.rows[0].description==='Description edited on Web','STRESS-02 different fields of same Schedule row auto-merge');

  // Local rename + independent Web calendar change.
  base=fullBase('Stress Rename Base');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:120,remoteTournament:clone(base),baseRevision:120,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(120,snapshot(base.name,base));
  h.data.tournaments['Stress Renamed Desktop']=h.data.tournaments['Stress Rename Base'];delete h.data.tournaments['Stress Rename Base'];h.data.currentTournament='Stress Renamed Desktop';
  const webCalendar=clone(base);webCalendar.schedule.notes='Calendar edited on Web';h.setRemoteTournament(webCalendar,121);
  r=await h.ctx.cpCloudSyncUnified();uploaded=snapshotTournament(h.remote);
  check(r.ok===true&&r.direction==='merge-push'&&h.remote.data.currentTournament==='Stress Renamed Desktop'&&uploaded.name==='Stress Renamed Desktop'&&uploaded.schedule.notes==='Calendar edited on Web','STRESS-03 Desktop rename + Web calendar edit preserve both changes');

  // Unicode rename must round-trip exactly while API-level Cloud identity remains stable.
  base=fullBase('ASCII Name');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:130,remoteTournament:clone(base),baseRevision:130,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(130,snapshot(base.name,base));
  const unicodeName='Шахматен турнир – Кърджали / İstanbul 2026 ♟';
  h.data.tournaments[unicodeName]=h.data.tournaments['ASCII Name'];delete h.data.tournaments['ASCII Name'];h.data.currentTournament=unicodeName;
  r=await h.ctx.cpCloudSyncUnified();uploaded=snapshotTournament(h.remote);
  check(r.ok===true&&r.direction==='push'&&r.cloudTournamentId==='cloud-1'&&h.remote.data.currentTournament===unicodeName&&uploaded.name===unicodeName,'STRESS-04 Unicode rename round-trips exactly and preserves API Cloud identity');

  // Same setup field changed differently is a true conflict and must never PUT.
  base=fullBase('Stress Setup Conflict');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:140,remoteTournament:clone(base),baseRevision:140,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(140,snapshot(base.name,base));
  h.ctx.getCurrentTournament().settings.venue='Desktop Hall';
  const webVenue=clone(base);webVenue.settings.venue='Web Hall';h.setRemoteTournament(webVenue,141);
  const pb=h.puts;r=await h.ctx.cpCloudSyncUnified();
  check(r.conflict===true&&h.puts===pb,'STRESS-05 same Setup field changed differently fails closed with zero PUT');

  // Excluded local paths/secrets must not manufacture Cloud revisions.
  base=fullBase('Stress Local Secret');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:150,remoteTournament:clone(base),baseRevision:150,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(150,snapshot(base.name,base));
  h.ctx.getCurrentTournament().runtimeState={filePath:'C:\\Users\\Organizer\\event.json'};
  h.ctx.getCurrentTournament().settings.organizerToken='LOCAL-SECRET';
  r=await h.ctx.cpCloudSyncUnified();
  check(r.ok===true&&r.unchanged===true&&h.puts===0,'STRESS-06 local path/token-only changes do not create Cloud revision');

  // Remote excluded metadata at newer revision should repair base without PUT.
  base=fullBase('Stress Metadata Noise');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:160,remoteTournament:clone(base),baseRevision:160,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(160,snapshot(base.name,base));
  const noise=clone(base);noise.cloud={...(noise.cloud||{}),lastSyncAt:'2099-01-01T00:00:00Z',revision:999};h.setRemoteTournament(noise,161);
  r=await h.ctx.cpCloudSyncUnified();
  check(r.ok===true&&r.unchanged===true&&h.puts===0&&h.ctx.getCurrentTournament().cloud.baseRevision===161,'STRESS-07 remote excluded metadata advances common base without revision churn');

  // Sequential real edits must create exactly two revisions, then settle to NO-OP.
  base=fullBase('Stress Sequential');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:170,remoteTournament:clone(base),baseRevision:170,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(170,snapshot(base.name,base));
  h.ctx.getCurrentTournament().settings.city='Varna';await h.ctx.cpCloudSyncUnified();const p1=h.puts;
  h.ctx.getCurrentTournament().schedule.notes='Second edit';await h.ctx.cpCloudSyncUnified();const p2=h.puts;
  r=await h.ctx.cpCloudSyncUnified();
  check(p1===1&&p2===2&&r.ok===true&&r.unchanged===true&&h.puts===2&&h.remoteRevision===172,'STRESS-08 sequential edits create one revision each, then stable NO-OP');

  // Independent edits to different players should merge through stable player IDs.
  base=fullBase('Stress Players');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:180,remoteTournament:clone(base),baseRevision:180,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(180,snapshot(base.name,base));
  h.ctx.getCurrentTournament().players[0].rating=2010;
  const webPlayer=clone(base);webPlayer.players[1].name='B Edited';h.setRemoteTournament(webPlayer,181);
  r=await h.ctx.cpCloudSyncUnified();uploaded=snapshotTournament(h.remote);
  check(r.ok===true&&r.direction==='merge-push'&&uploaded.players[0].rating===2010&&uploaded.players[1].name==='B Edited','STRESS-09 independent player edits merge by stable identity');

  // A stale optimistic PUT must be blocked; local edit must remain present after failure.
  base=fullBase('Stress Revision Race');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:190,remoteTournament:clone(base),baseRevision:190,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(190,snapshot(base.name,base));
  h.ctx.getCurrentTournament().settings.generalNotes='local survives race';
  const originalPut=h.api.putSnapshot;let raced=false;
  h.api.putSnapshot=async(token,args)=>{if(!raced){raced=true;const remoteNow=clone(base);remoteNow.settings.website='https://race.example';h.setRemoteTournament(remoteNow,191);}return originalPut(token,args);};
  let raceError=null;try{await h.ctx.cpCloudSyncUnified();}catch(e){raceError=e;}
  check(!!raceError&&raceError.code==='cloud_revision_conflict'&&h.ctx.getCurrentTournament().settings.generalNotes==='local survives race','STRESS-10 revision race blocks stale PUT and preserves Desktop edit');

  // Remote deletion of one optional field + independent local edit should merge deterministically.
  base=fullBase('Stress Delete Plus Edit');base.settings.website='https://keep.example';baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:200,remoteTournament:clone(base),baseRevision:200,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(200,snapshot(base.name,base));
  h.ctx.getCurrentTournament().settings.city='Burgas';
  const webDelete=clone(base);delete webDelete.settings.website;h.setRemoteTournament(webDelete,201);
  r=await h.ctx.cpCloudSyncUnified();uploaded=snapshotTournament(h.remote);
  check(r.ok===true&&r.direction==='merge-push'&&uploaded.settings.city==='Burgas'&&!Object.prototype.hasOwnProperty.call(uploaded.settings,'website'),'STRESS-11 remote optional-field deletion + independent local edit merge safely');

  console.log(`BETA87 SYNC STRESS EDGE: ${fail?'FAIL':'PASS'} (${pass} PASS / ${fail} FAIL)`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
