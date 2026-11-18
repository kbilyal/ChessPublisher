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
  const document={documentElement:{dataset:{chesspublisherVersion:'1.06.00-beta.86'}},querySelector(){return null;},getElementById(){return null;},createElement(){return {...fakeEl,innerHTML:'',id:'',className:'',textContent:'',hidden:false};},head:fakeEl,body:fakeEl};
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
  return {ctx,data,revisions,get remote(){return remote;},get remoteRevision(){return remoteRev;},get puts(){return puts;},get getRevisions(){return getRevisions;},get saves(){return saves;},setRemoteTournament(t,rev,newName=''){remoteRev=rev;if(newName)rowName=newName;remote=snapshot(rowName,t);revisions.set(rev,clone(remote));}};
}

(async()=>{
  const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
  check(/const logicalTournamentName=String\(data\?\.currentTournament/.test(html)&&/t\.name=logicalTournamentName/.test(html),'META-01 saveAll canonicalizes portable tournament.name to Desktop currentTournament');
  check(/oldTournament\.name=newName/.test(html)&&/data\.tournaments\[newName\]\.name=newName/.test(html),'META-02 rename updates both persisted snapshot and live tournament.name');
  check(/saveScheduleRows\(\);saveData\(\)/.test(html),'META-03 saveAll persists schedule rows before unified SYNC fingerprints the tournament');

  function fullBase(name='Metadata Flow'){
    const t=baseTournament(name);
    t.settings={...t.settings,venue:'Hall A',city:'Sofia',country:'BUL',startDate:'2026-10-01',endDate:'2026-10-02',rounds:'7',timeControl:'10+5',website:'https://old.example',generalNotes:'base'};
    t.schedule={registrationOpens:'2026-09-25T10:00',registrationCloses:'2026-10-01T09:00',technicalMeeting:'',openingCeremony:'2026-10-01T09:30',closingCeremony:'',awardCeremony:'',notes:'base',rows:[{no:'1',dateTime:'2026-10-01T10:00',event:'Round 1',description:'First round'}]};
    t.regulations={eligibility:'Open',additional:'base',tieBreaks:[]};
    t.pairings.liveBoards={'1':[{round:1,board:1,whiteKey:'p1',blackKey:'p2',result:'-'}]};
    return t;
  }

  // A beta.85-style rename changed only the Desktop map key/currentTournament.
  let base=fullBase('Old Event Name'), baseHash=webFingerprint(base);
  let h=makeHarness({local:clone(base),remoteRevision:20,remoteTournament:clone(base),baseRevision:20,baseFingerprint:baseHash,fingerprintContentSchema:7});
  h.revisions.set(20,snapshot('Old Event Name',base));
  h.data.tournaments['New Event Name']=h.data.tournaments['Old Event Name'];delete h.data.tournaments['Old Event Name'];h.data.currentTournament='New Event Name';
  let r=await h.ctx.cpCloudSyncUnified();
  let uploaded=snapshotTournament(h.remote);
  check(r.ok===true&&r.direction==='push'&&h.puts===1,'META-04 Desktop rename is detected as a local change and performs one Cloud PUT');
  check(h.remote.data.currentTournament==='New Event Name'&&uploaded.name==='New Event Name','META-05 outbound snapshot carries one canonical renamed identity in wrapper and tournament object');
  check((await h.ctx.ChessPublisherCloudSyncInternals.tournamentContentHash('New Event Name',uploaded))===webFingerprint(uploaded),'META-06 renamed Desktop content remains Web schema-7 fingerprint compatible');

  // Desktop calendar/setup change -> Cloud.
  base=fullBase('Desktop Metadata Push');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:30,remoteTournament:clone(base),baseRevision:30,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(30,snapshot(base.name,base));
  const local=h.ctx.getCurrentTournament();local.settings.startDate='2026-11-01';local.settings.endDate='2026-11-03';local.settings.venue='New Hall';local.schedule.notes='Desktop calendar changed';local.schedule.rows[0].dateTime='2026-11-01T11:30';local.regulations.additional='Desktop regulation note';
  r=await h.ctx.cpCloudSyncUnified();uploaded=snapshotTournament(h.remote);
  check(r.ok===true&&r.direction==='push'&&h.remoteRevision===31,'META-07 Desktop tournament setup/calendar changes publish a new Cloud revision');
  check(uploaded.settings.startDate==='2026-11-01'&&uploaded.settings.endDate==='2026-11-03'&&uploaded.settings.venue==='New Hall','META-08 Desktop Setup fields are present in Cloud snapshot');
  check(uploaded.schedule.notes==='Desktop calendar changed'&&uploaded.schedule.rows[0].dateTime==='2026-11-01T11:30','META-09 Desktop Schedule rows/notes are present in Cloud snapshot');
  check(uploaded.regulations.additional==='Desktop regulation note','META-10 Desktop Regulations changes are present in Cloud snapshot');

  // Web calendar/setup change -> Desktop.
  base=fullBase('Web Metadata Pull');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:40,remoteTournament:clone(base),baseRevision:40,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(40,snapshot(base.name,base));
  const webChanged=clone(base);webChanged.settings.city='Plovdiv';webChanged.settings.startDate='2026-12-10';webChanged.schedule.notes='Web calendar';webChanged.schedule.rows[0].dateTime='2026-12-10T14:00';webChanged.regulations.eligibility='Invited';h.setRemoteTournament(webChanged,41);
  r=await h.ctx.cpCloudSyncUnified();const pulled=h.ctx.getCurrentTournament();
  check(r.ok===true&&r.direction==='pull'&&h.puts===0,'META-11 Web-only tournament metadata performs Pull with no Cloud PUT');
  check(pulled.settings.city==='Plovdiv'&&pulled.settings.startDate==='2026-12-10'&&pulled.schedule.rows[0].dateTime==='2026-12-10T14:00'&&pulled.regulations.eligibility==='Invited','META-12 Web setup/calendar/regulations are applied to Desktop');

  // Web-only rename -> Desktop key/file identity.
  base=fullBase('Before Web Rename');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:50,remoteTournament:clone(base),baseRevision:50,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(50,snapshot(base.name,base));
  const renamed=clone(base);renamed.name='Renamed on Web';h.setRemoteTournament(renamed,51,'Renamed on Web');
  r=await h.ctx.cpCloudSyncUnified();
  check(r.ok===true&&r.direction==='pull'&&h.data.currentTournament==='Renamed on Web'&&!!h.data.tournaments['Renamed on Web'],'META-13 Web rename becomes the Desktop logical tournament name');

  // Real mixed workflow: Web result + Desktop calendar edit.
  base=fullBase('Result Plus Calendar');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:60,remoteTournament:clone(base),baseRevision:60,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(60,snapshot(base.name,base));
  h.ctx.getCurrentTournament().schedule.rows[0].dateTime='2026-10-01T11:15';
  const webResult=clone(base);webResult.pairings.liveBoards['1'][0].result='1 - 0';h.setRemoteTournament(webResult,61);
  r=await h.ctx.cpCloudSyncUnified();uploaded=snapshotTournament(h.remote);
  check(r.ok===true&&r.direction==='merge-push'&&h.remoteRevision===62,'META-14 Web result + Desktop calendar edit auto-merge and publish one new revision');
  check(uploaded.pairings.liveBoards['1'][0].result==='1 - 0'&&uploaded.schedule.rows[0].dateTime==='2026-10-01T11:15','META-15 merged revision preserves both Web result and Desktop calendar change');

  // Opposite mixed workflow: Web schedule + Desktop Setup.
  base=fullBase('Setup Plus Schedule');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:70,remoteTournament:clone(base),baseRevision:70,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(70,snapshot(base.name,base));
  h.ctx.getCurrentTournament().settings.venue='Desktop Venue';
  const webSchedule=clone(base);webSchedule.schedule.notes='Changed on Web';webSchedule.schedule.rows[0].dateTime='2026-10-01T12:45';h.setRemoteTournament(webSchedule,71);
  r=await h.ctx.cpCloudSyncUnified();uploaded=snapshotTournament(h.remote);
  check(r.ok===true&&r.direction==='merge-push'&&uploaded.settings.venue==='Desktop Venue'&&uploaded.schedule.notes==='Changed on Web','META-16 independent Desktop Setup + Web Schedule changes merge safely');

  // Same schedule value changed differently remains a true conflict.
  base=fullBase('Calendar Conflict');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:80,remoteTournament:clone(base),baseRevision:80,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(80,snapshot(base.name,base));
  h.ctx.getCurrentTournament().schedule.rows[0].dateTime='2026-10-01T11:00';
  const conflicting=clone(base);conflicting.schedule.rows[0].dateTime='2026-10-01T12:00';h.setRemoteTournament(conflicting,81);
  const putsBefore=h.puts;r=await h.ctx.cpCloudSyncUnified();
  check(r.conflict===true&&r.direction==='conflict'&&h.puts===putsBefore,'META-17 different Desktop/Web calendar values fail closed with no PUT');

  // Immediate second sync after metadata push is stable.
  base=fullBase('No Churn Metadata');baseHash=webFingerprint(base);
  h=makeHarness({local:clone(base),remoteRevision:90,remoteTournament:clone(base),baseRevision:90,baseFingerprint:baseHash,fingerprintContentSchema:7});h.revisions.set(90,snapshot(base.name,base));
  h.ctx.getCurrentTournament().settings.generalNotes='one change';r=await h.ctx.cpCloudSyncUnified();const after=h.puts;r=await h.ctx.cpCloudSyncUnified();
  check(r.ok===true&&r.unchanged===true&&h.puts===after,'META-18 second metadata SYNC is NO-OP with no revision churn');

  console.log(`BETA86 TOURNAMENT METADATA SYNC: ${fail?'FAIL':'PASS'} (${pass} PASS / ${fail} FAIL)`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});