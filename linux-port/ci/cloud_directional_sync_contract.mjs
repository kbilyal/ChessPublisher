import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';

const SCRIPT_PARTS=Array.from({length:8},(_,i)=>new URL(`../linux/cloud_directional_sync.part${String(i+1).padStart(2,'0')}`,import.meta.url));
const SCRIPT_SOURCE=SCRIPT_PARTS.map(p=>fs.readFileSync(p,'utf8')).join('');
const clone=v=>JSON.parse(JSON.stringify(v));
const makePlayers=n=>Array.from({length:n},(_,i)=>({id:`p${i+1}`,localKey:`player:${i+1}`,pairingNumber:i+1,name:`Player ${String(i+1).padStart(2,'0')}`,fideId:String(1000000+i),fed:i%2?'BUL':'TUR',rating:2400-i}));
function baseTournament(){
  return {
    name:'Tournament Ubuntu',
    settings:{organizer:'Chess Club',chiefArbiter:'Kyamran Bilyal',arbiter:'Deputy',director:'Director',venue:'Hall A',city:'Sofia',country:'BUL',timeControl:'90+30',startDate:'2026-10-01',endDate:'2026-10-05',rounds:7,tournamentFormat:'Individual Swiss',pairingSystem:'FIDE Dutch System',fideRated:'Yes',tournamentRatingType:'Standard',tournamentType:'Test',fideEventId:'497756',website:'https://example.test',email:'arbiter@example.test',phone:'+359000',liveLink:'https://live.test',generalNotes:'Notes',generalRegistrationDeadline:'2026-09-30',scoringWin:1},
    regulations:{text:'Regulations',additional:'X'},schedule:{rounds:[{round:1,date:'2026-10-01'}]},players:makePlayers(83),pairings:{rounds:[]},standings:{},specialPrizeConfig:{groups:[{name:'U18'}]},chessResults:{tnr:'123456'},online:{hubTournamentId:'hub-42',publicSlug:'ubuntu-open',revision:7},hub:{tournamentId:'hub-42',manageToken:'SECRET-MANAGE',publicSlug:'ubuntu-open'},dgt:{port:'/dev/ttyUSB0',boardMapping:[{serial:'DGT-1'}]},telegram:{chatId:'123',token:'SECRET-TG'},cloud:{schemaVersion:4,internalId:'tournament:ABC',localKey:'install:linux-1',cloudTournamentId:'cloud-77',baseRevision:1,revision:1,baseFingerprint:'',lastSyncedContentHash:'',fingerprintSchema:6}
  };
}
function wrapSnapshot(t,name=t.name){return {version:'V99',data:{currentTournament:name,tournaments:{[name]:clone(t)},preferences:{}},currentTournament:name,preferences:{},telegramGlobal:{}};}
async function sha(raw){const d=await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}

function createHarness(local,remote,base,{remoteRevision=2,baseRevision=1,remoteExists=true,cloudId='cloud-77'}={}){
  let currentName=local.name;
  const data={currentTournament:currentName,tournaments:{[currentName]:local},preferences:{}};
  const calls={create:0,put:0,getTournament:0,getSnapshot:0,getRevision:0,saveAll:0,fileSave:0};
  const remoteMeta={id:cloudId,localKey:'tournament:ABC',name:remote?.name||local.name,revision:remoteExists?remoteRevision:0,checksum:'x'};
  const api={
    async listTournaments(){return {tournaments:[remoteMeta]};},
    async getTournament(){calls.getTournament++;return {tournament:remoteMeta};},
    async getCurrentSnapshot(){calls.getSnapshot++;if(!remoteExists)throw new Error('no snapshot');return {tournament:remoteMeta,snapshot:wrapSnapshot(remote)};},
    async getRevision(_t,_id,rev){calls.getRevision++;assert.equal(rev,baseRevision);return {tournament:{...remoteMeta,revision:baseRevision},snapshot:wrapSnapshot(base)};},
    async createTournament(_token,input){calls.create++;return {tournament:{id:cloudId,localKey:input.localKey,name:input.name,revision:0}};},
    async putSnapshot(_token,args){calls.put++;calls.lastPut=clone(args);const nr=(args.baseRevision||0)+1;remoteMeta.revision=nr;return {revision:nr,checksum:'new',updatedAt:new Date().toISOString()};}
  };
  const store=new Map();
  const localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  const document={documentElement:{dataset:{chesspublisherVersion:'1.06.00-beta.34'}},getElementById(){return null;},createElement(){return {style:{},appendChild(){},classList:{add(){},remove(){}}};},head:{appendChild(){}},body:{appendChild(){}},readyState:'complete',addEventListener(){}};
  const window={__CP_DIRECTIONAL_TEST__:true,ChessPublisherCloudWorkspaceApi:{createClient:()=>api},cpNativeHubSecretGet:async()=> 'organizer-token',cpOnlineOrganizerSecretKey:()=> 'organizer-primary:test',open(){},confirm(){return true;},__cpOnlineCloudBusy:false};
  const context={window,document,localStorage,crypto:webcrypto,TextEncoder,console,setTimeout,clearTimeout,setInterval,clearInterval,alert(){},navigator:{},URL,URLSearchParams};
  Object.assign(context,{
    data,
    getCurrentTournament:()=>data.tournaments[data.currentTournament],
    getPersistentSnapshot:()=>wrapSnapshot(data.tournaments[data.currentTournament],data.currentTournament),
    cpSnapshotForExternalFile:s=>clone(s),
    saveData(){},normalizeData(){},refreshEverything(){},
    saveAll(){calls.saveAll++;},
    async fileSaveTournament(){calls.fileSave++;return true;}
  });
  Object.assign(window,{data,cpNativeHubSecretGet:window.cpNativeHubSecretGet,cpOnlineOrganizerSecretKey:window.cpOnlineOrganizerSecretKey});
  vm.createContext(context);
  vm.runInContext(SCRIPT_SOURCE,context,{filename:'cloud_directional_sync.js'});
  return {context,window,data,calls,api};
}

{
  const t=baseTournament();
  const h=createHarness(t,t,t,{remoteRevision:1});
  const I=h.window.ChessPublisherDirectionalCloudSyncInternals;
  const snapshot=I.buildPortableSnapshot(t.name,t);
  const p=snapshot.data.tournaments['Tournament Ubuntu'];
  assert.equal(p.name,'Tournament Ubuntu');
  assert.equal(p.players.length,83);
  assert.equal(p.settings.chiefArbiter,'Kyamran Bilyal');
  assert.equal(p.settings.city,'Sofia');
  assert.equal(p.settings.country,'BUL');
  assert.equal(p.settings.timeControl,'90+30');
  assert.equal(p.settings.rounds,7);
  assert.equal(p.settings.tournamentType,'Test');
  assert.equal(JSON.stringify(p.regulations),JSON.stringify(t.regulations));
  assert.equal(JSON.stringify(p.schedule),JSON.stringify(t.schedule));
  assert.equal(p.cloud.internalId,'tournament:ABC');
  assert.equal(p.cloud.cloudTournamentId,'cloud-77');
  assert.equal(p.hub.tournamentId,'hub-42');
  assert.equal('manageToken' in p.hub,false);
  assert.equal('dgt' in p,false);
  assert.equal(p.telegram.token,undefined);
  assert.equal(JSON.stringify(p.players.map(x=>[x.id,x.localKey,x.pairingNumber])),JSON.stringify(t.players.map(x=>[x.id,x.localKey,x.pairingNumber])));
  assert.equal(snapshot.data.currentTournament,p.name);
}

{
  const t=baseTournament();
  const h=createHarness(t,t,t);const I=h.window.ChessPublisherDirectionalCloudSyncInternals;
  const base=I.contentObject(t,t.name);
  const local=clone(base);local.settings.organizer='New Chess Club';
  const remote=clone(base);remote.settings.venue='Hall B';
  const merged=I.threeWayMerge(base,local,remote);
  assert.equal(merged.conflicts.length,0);assert.equal(merged.merged.settings.organizer,'New Chess Club');assert.equal(merged.merged.settings.venue,'Hall B');
  const r2=clone(base);r2.settings.city='Plovdiv';const l2=clone(base);l2.settings.city='Varna';
  const c=I.threeWayMerge(base,l2,r2);assert.equal(c.conflicts.length,1);assert.equal(c.conflicts[0].path,'settings.city');
}

{
  const base=baseTournament();const remote=clone(base);remote.settings.venue='Hall B';const local=clone(base);
  const h=createHarness(local,remote,base);const I=h.window.ChessPublisherDirectionalCloudSyncInternals;
  const baseHash=await sha(I.fingerprintPayload(base,base.name));local.cloud.baseFingerprint=baseHash;local.cloud.lastSyncedContentHash=baseHash;
  const result=await h.window.cpCloudPullToDesktop();
  assert.equal(result.status,'IN_SYNC');assert.equal(h.calls.put,0);assert.equal(h.calls.create,0);assert.equal(h.data.tournaments[h.data.currentTournament].settings.venue,'Hall B');
}

{
  const base=baseTournament();const remote=clone(base);const local=clone(base);local.settings.organizer='Desktop Club';
  const h=createHarness(local,remote,base);const I=h.window.ChessPublisherDirectionalCloudSyncInternals;
  const baseHash=await sha(I.fingerprintPayload(base,base.name));local.cloud.baseFingerprint=baseHash;local.cloud.lastSyncedContentHash=baseHash;
  const result=await h.window.cpCloudPullToDesktop();
  assert.equal(result.status,'LOCAL_CHANGES');assert.equal(h.calls.put,0);assert.equal(h.data.tournaments[h.data.currentTournament].settings.organizer,'Desktop Club');
}

{
  const base=baseTournament();const remote=clone(base);remote.settings.venue='Hall B';const local=clone(base);local.settings.organizer='Desktop Club';
  const h=createHarness(local,remote,base);const I=h.window.ChessPublisherDirectionalCloudSyncInternals;
  const baseHash=await sha(I.fingerprintPayload(base,base.name));local.cloud.baseFingerprint=baseHash;local.cloud.lastSyncedContentHash=baseHash;
  const result=await h.window.cpCloudPullToDesktop();const out=h.data.tournaments[h.data.currentTournament];
  assert.equal(result.status,'LOCAL_CHANGES');assert.equal(result.merged,true);assert.equal(h.calls.put,0);assert.equal(out.settings.venue,'Hall B');assert.equal(out.settings.organizer,'Desktop Club');
}

{
  const base=baseTournament();const remote=clone(base);remote.settings.city='Plovdiv';const local=clone(base);local.settings.city='Sofia Desktop';
  const h=createHarness(local,remote,base);const I=h.window.ChessPublisherDirectionalCloudSyncInternals;
  const baseHash=await sha(I.fingerprintPayload(base,base.name));local.cloud.baseFingerprint=baseHash;local.cloud.lastSyncedContentHash=baseHash;
  const result=await h.window.cpCloudPullToDesktop();
  assert.equal(result.status,'CONFLICT');assert.equal(h.calls.put,0);assert.equal(h.data.tournaments[h.data.currentTournament].settings.city,'Sofia Desktop');assert.equal(result.conflicts[0].path,'settings.city');
}

{
  const base=baseTournament();const remote=clone(base);const local=clone(base);local.name='Sofia Open 2026';local.settings.organizer='Desktop Club';
  const h=createHarness(local,remote,base);h.data.currentTournament='Sofia Open 2026';h.data.tournaments={'Sofia Open 2026':local};
  const I=h.window.ChessPublisherDirectionalCloudSyncInternals;const baseHash=await sha(I.fingerprintPayload(base,base.name));local.cloud.baseFingerprint=baseHash;local.cloud.lastSyncedContentHash=baseHash;
  const result=await h.window.cpCloudPushToCloud();
  assert.equal(result.status,'IN_SYNC');assert.equal(h.calls.put,1);assert.equal(h.calls.create,0);assert.equal(h.calls.lastPut.snapshot.data.currentTournament,'Sofia Open 2026');assert.equal(h.calls.lastPut.snapshot.data.tournaments['Sofia Open 2026'].cloud.cloudTournamentId,'cloud-77');
}

{
  const base=baseTournament();const remote=clone(base);remote.settings.venue='Cloud Hall';const local=clone(base);local.settings.organizer='Desktop Club';
  const h=createHarness(local,remote,base);const I=h.window.ChessPublisherDirectionalCloudSyncInternals;const baseHash=await sha(I.fingerprintPayload(base,base.name));local.cloud.baseFingerprint=baseHash;local.cloud.lastSyncedContentHash=baseHash;
  const result=await h.window.cpCloudPushToCloud();
  assert.equal(result.status,'CONFLICT');assert.equal(result.blocked,true);assert.equal(h.calls.put,0);
}

console.log('DESKTOP_CLOUD_DIRECTIONAL_SYNC=PASS');
console.log('DESKTOP_WEB_FULL_SNAPSHOT_PARITY=PASS');
console.log('ROSTER_83_PARITY=PASS');
console.log('PULL_ONLY_REGRESSION=PASS');
console.log('PUSH_ONLY_REGRESSION=PASS');
console.log('CONFLICT_REGRESSION=PASS');
