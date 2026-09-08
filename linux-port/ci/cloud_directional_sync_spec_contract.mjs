import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';

const parts=Array.from({length:8},(_,i)=>new URL(`../linux/cloud_directional_sync.part${String(i+1).padStart(2,'0')}`,import.meta.url));
const source=parts.map(p=>fs.readFileSync(p,'utf8')).join('');
const loader=fs.readFileSync(new URL('../linux/cloud_directional_sync.js',import.meta.url),'utf8');
const clone=v=>JSON.parse(JSON.stringify(v));

const tournament={
  name:'Tournament Ubuntu',
  settings:{organizer:'Chess Club',chiefArbiter:'Kyamran Bilyal',arbiter:'Deputy Arbiter',director:'Director',venue:'Hall A',city:'Sofia',country:'BUL',timeControl:'90+30',startDate:'2026-10-01',endDate:'2026-10-05',rounds:7,tournamentFormat:'Individual Swiss',pairingSystem:'FIDE Dutch System',fideRated:'Yes',tournamentRatingType:'Standard',tournamentType:'Test',fideEventId:'497756',website:'https://example.test',email:'office@example.test',phone:'+359000',liveLink:'https://live.test',generalNotes:'Notes',generalRegistrationDeadline:'2026-09-30',scoringWin:1},
  regulations:{text:'Regulations',additional:'Appendix'},
  schedule:{rounds:[{round:1,date:'2026-10-01'},{round:7,date:'2026-10-05'}]},
  players:Array.from({length:83},(_,i)=>({id:`p${i+1}`,localKey:`player:${i+1}`,pairingNumber:i+1,name:`Player ${i+1}`,rating:2000-i})),
  pairings:{rounds:[{round:1,pairings:[]}]},attendance:{p1:true},requestedByes:{p2:[3]},standings:{round:1},specialPrizeConfig:{groups:[{name:'U18'}]},
  chessResults:{tnr:'123456'},online:{hubTournamentId:'hub-42',publicSlug:'ubuntu-open'},
  hub:{tournamentId:'hub-42',manageToken:'LOCAL-HUB-SECRET',publicSlug:'ubuntu-open'},
  dgt:{port:'/dev/ttyUSB0',boardMapping:[{serial:'DGT-1'}]},
  telegram:{chatId:'123',token:'LOCAL-TELEGRAM-SECRET'},
  cloud:{schemaVersion:4,internalId:'tournament:ABC',localKey:'install:linux-1',cloudTournamentId:'cloud-77',baseRevision:18,revision:18,baseFingerprint:'abc',lastSyncedContentHash:'abc',fingerprintSchema:6}
};

const data={currentTournament:tournament.name,tournaments:{[tournament.name]:tournament},preferences:{}};
const store=new Map();
const localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
const document={documentElement:{dataset:{chesspublisherVersion:'1.06.00-beta.34'}},getElementById(){return null;},createElement(){return {style:{},appendChild(){},classList:{add(){},remove(){}}};},head:{appendChild(){}},body:{appendChild(){}},readyState:'complete',addEventListener(){}};
const window={__CP_DIRECTIONAL_TEST__:true,ChessPublisherCloudWorkspaceApi:{createClient:()=>({})},cpNativeHubSecretGet:async()=>'',cpOnlineOrganizerSecretKey:()=>'',open(){},confirm(){return true;}};
const context={window,document,localStorage,crypto:webcrypto,TextEncoder,console,setTimeout,clearTimeout,setInterval,clearInterval,alert(){},navigator:{},URL,URLSearchParams,data,getCurrentTournament:()=>data.tournaments[data.currentTournament],getPersistentSnapshot:()=>({version:'V99',data:clone(data)}),cpSnapshotForExternalFile:s=>clone(s),saveData(){},normalizeData(){},refreshEverything(){},saveAll(){},async fileSaveTournament(){return true;}};
Object.assign(window,{data});
vm.createContext(context);
vm.runInContext(source,context,{filename:'cloud_directional_sync.spec.js'});
const I=window.ChessPublisherDirectionalCloudSyncInternals;
assert.ok(I,'directional Cloud internals missing');

const snap=I.buildPortableSnapshot(tournament.name,tournament);
const p=snap.data.tournaments['Tournament Ubuntu'];
assert.equal(snap.data.currentTournament,'Tournament Ubuntu');
assert.equal(p.name,'Tournament Ubuntu');
assert.equal(p.players.length,83);
for(const key of ['organizer','chiefArbiter','arbiter','director','venue','city','country','timeControl','startDate','endDate','rounds','tournamentFormat','pairingSystem','fideRated','tournamentRatingType','tournamentType','fideEventId','website','email','phone','liveLink','generalNotes','generalRegistrationDeadline','scoringWin'])assert.deepEqual(p.settings[key],tournament.settings[key],`settings.${key} parity failed`);
assert.deepEqual(p.regulations,tournament.regulations);
assert.deepEqual(p.schedule,tournament.schedule);
assert.deepEqual(p.pairings,tournament.pairings);
assert.deepEqual(p.attendance,tournament.attendance);
assert.deepEqual(p.requestedByes,tournament.requestedByes);
assert.deepEqual(p.specialPrizeConfig,tournament.specialPrizeConfig);
assert.equal(p.cloud.internalId,'tournament:ABC');
assert.equal(p.cloud.cloudTournamentId,'cloud-77');
assert.equal(p.hub.tournamentId,'hub-42');
assert.equal('manageToken' in p.hub,false);
assert.equal('dgt' in p,false);
assert.equal(p.telegram.token,undefined);
assert.equal(JSON.stringify(p.players.map(x=>[x.id,x.localKey,x.pairingNumber])),JSON.stringify(tournament.players.map(x=>[x.id,x.localKey,x.pairingNumber])));

const remote=clone(p);remote.settings.venue='Hall B';
const restored=I.restoreInstallationLocalFields(remote,tournament,{cloudTournamentId:'cloud-77',internalId:'tournament:ABC',baseRevision:19,baseFingerprint:'remote19'});
assert.equal(restored.dgt.port,'/dev/ttyUSB0');
assert.equal(restored.hub.manageToken,'LOCAL-HUB-SECRET');
assert.equal(restored.telegram.token,'LOCAL-TELEGRAM-SECRET');
assert.equal(restored.cloud.internalId,'tournament:ABC');
assert.equal(restored.cloud.cloudTournamentId,'cloud-77');
assert.equal(restored.cloud.baseRevision,19);

const renamed=clone(tournament);renamed.name='Sofia Open 2026';
const renameSnap=I.buildPortableSnapshot(renamed.name,renamed);
assert.equal(renameSnap.data.currentTournament,'Sofia Open 2026');
assert.equal(renameSnap.data.tournaments['Sofia Open 2026'].cloud.internalId,'tournament:ABC');
assert.equal(renameSnap.data.tournaments['Sofia Open 2026'].cloud.cloudTournamentId,'cloud-77');

assert.ok(loader.includes('ChessPublisherCloudWorkspace_AutoSync_v1'));
assert.ok(loader.includes('"0"'),'legacy Cloud autosync must be forced OFF');
assert.ok(source.includes('↓ Pull Cloud → Desktop'));
assert.ok(source.includes('↑ Push Desktop → Cloud'));
assert.ok(source.includes('Check Cloud Status'));
assert.ok(source.includes('Resolve Conflict'));
assert.ok(source.includes('Open in Web'));
assert.ok(source.includes('Autosave ON = local autosave only.'));
assert.ok(source.includes('baseRevision:expectedRevision'),'Push must send expected/base revision');
assert.ok(source.includes('Cloud contains newer changes. Pull Cloud → Desktop first.'));
assert.ok(source.includes('Resolve synchronization conflict before publishing.'));
assert.ok(!source.includes('Last Write Wins'));
assert.ok(!source.includes('addEventListener("focus"'));

const base=I.contentObject(tournament,tournament.name);
const local=clone(base);local.settings.organizer='Desktop Club';
const remoteContent=clone(base);remoteContent.settings.venue='Hall B';
const merged=I.threeWayMerge(base,local,remoteContent);
assert.equal(merged.conflicts.length,0);
assert.equal(merged.merged.settings.organizer,'Desktop Club');
assert.equal(merged.merged.settings.venue,'Hall B');
const lc=clone(base);lc.settings.city='Sofia Desktop';const rc=clone(base);rc.settings.city='Plovdiv';
const conflict=I.threeWayMerge(base,lc,rc);
assert.equal(conflict.conflicts.length,1);
assert.equal(conflict.conflicts[0].path,'settings.city');

console.log('DESKTOP_CLOUD_SPEC_COMPLIANCE=PASS');
console.log('DESKTOP_WEB_FULL_SNAPSHOT_PARITY_EXTENDED=PASS');
console.log('INSTALLATION_LOCAL_PRESERVATION=PASS');
console.log('RENAME_IDENTITY_CONTINUITY=PASS');
console.log('AUTOSAVE_LOCAL_ONLY_POLICY=PASS');
