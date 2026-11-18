'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'ChessPublisher.html'),'utf8');
const src=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta98-Custom-Rating-Lists.js'),'utf8');
const cloudSrc=fs.readFileSync(path.join(ROOT,'webview','CloudWorkspaceAdapter.js'),'utf8');
let pass=0,fail=0,n=0;
function ok(name,v){n++;if(v){pass++;console.log(`PASS ${String(n).padStart(2,'0')} ${name}`);}else{fail++;console.error(`FAIL ${String(n).padStart(2,'0')} ${name}`);}}
function eq(name,a,b){ok(`${name} (${JSON.stringify(a)} === ${JSON.stringify(b)})`,JSON.stringify(a)===JSON.stringify(b));}
function sleep(ms=0){return new Promise(r=>setTimeout(r,ms));}

ok('HTML self-identifies beta.98-r5 or newer r-revision',/data-chesspublisher-version="1[.]06[.]00-beta[.]98-r(?:[5-9]|[1-9][0-9]+)"/.test(html));
ok('HTML loads additive Q117 module',/ChessPublisher-Beta98-Custom-Rating-Lists\.js/.test(html));
ok('Q117 loads after beta.89',html.indexOf('ChessPublisher-Beta98-Custom-Rating-Lists.js')>html.indexOf('ChessPublisher-Beta89-Compliance.js'));
ok('module is explicitly Q117 Custom Rating Lists',/FIDE TEC Q117 Custom Rating Lists operational model/.test(src));
ok('custom category catalogue is present',/national.*regional.*club.*historical.*other/.test(src));
ok('custom lists use Type-B provenance by default',/const CLASS='Type-B'/.test(src)&&/originalSourceKnown:false/.test(src));
ok('application library keys exist',/rating-lists:custom:catalog:v2/.test(src)&&/rating-lists:custom:data:v2:/.test(src));
ok('legacy tournament-scoped keys are migration-only',/LEGACY_LISTS_KEY='customRatingListsV1'/.test(src)&&/delete t\.settings\[LEGACY_LISTS_KEY\]/.test(src));
ok('normal tournament serialization uses compact references',/REFS_KEY='ratingListLibraryRefsV2'/.test(src));
ok('import UI explicitly says zero participants were added',/0 tournament participants were added/.test(src));
ok('main Add Player search is integrated',/Search player \(FIDE \+ imported rating lists\)/.test(src)&&/searchExternalPlayers/.test(src));
ok('Type-B previous feature is integrated into external library search/sequence',/TYPE_B_KIND='type-b-rating-list'/.test(src)&&/refreshTypeBCatalog/.test(src));
ok('automatic official consistency is skipped for external lists',/external-rating-list-consistency-not-required/.test(src));
ok('cloud snapshot preserves tournament object and compact refs',/const one=sanitizeDownloadedTournament\(tournament\)/.test(cloudSrc)&&/tournaments:\{\[name\]:one\}/.test(cloudSrc));
ok('protected pairing/TRF/checker core is not redefined',!/(buildPairingEngineTRF\s*=|cpBuildCanonicalTRF\s*=|pairingchecker\.exe|function\s+calculateTieBreak|ChessResults.*XML)/i.test(src));

let saves=0,current='A';
const tournamentA={settings:{tournamentRatingType:'Standard',ratingListSequence:['fide-standard','fide-rapid','fide-blitz'],ratingListSequenceMode:'default'},players:[]};
const tournamentB={settings:{tournamentRatingType:'Rapid',ratingListSequence:['effective-rapid','fide-blitz'],ratingListSequenceMode:'default'},players:[]};
const data={currentTournament:'A',tournaments:{A:tournamentA,B:tournamentB},preferences:{}};
const ls=new Map();
const localStorage={getItem:k=>ls.has(k)?ls.get(k):null,setItem:(k,v)=>ls.set(k,String(v)),removeItem:k=>ls.delete(k)};
const typeBRows=[{fideId:'7777777',name:'Type B Player',fed:'BUL',title:'',rating:1888}];
const cpBeta81={
  async listCatalog(){return [{id:'legacy-type-b',label:'Imported National Standard',listClass:'Type-B',ratingType:'std',originalSourceKnown:false,recordCount:1}]},
  async getData(id){return id==='legacy-type-b'?typeBRows:[]}
};
const cpBeta59={
  normalizedRatingType(v){v=String(v||'').toLowerCase();return v==='standard'?'Standard':v==='rapid'?'Rapid':v==='blitz'?'Blitz':'Unrated';},
  defaultSequenceFor(v){v=String(v||'').toLowerCase();return v==='standard'?['fide-standard','fide-rapid','fide-blitz']:v==='rapid'?['effective-rapid','fide-blitz']:v==='blitz'?['effective-blitz','fide-rapid']:[];}
};
const ctx={console,JSON,Number,String,Math,Date,Array,Object,Promise,Set,Map,RegExp,Error,data,localStorage,window:null,cpBeta59,cpBeta81,
  getCurrentTournament(){return data.tournaments[data.currentTournament]||null;},saveData(){saves++;},
  cpBeta65:{officialLists(){return [{id:'fide-standard',listClass:'Type-A'},{id:'fide-rapid',listClass:'Type-A'},{id:'fide-blitz',listClass:'Type-A'}];}},
  cpBeta52:{ensure(p){p.ratingProvenance=p.ratingProvenance||{};return p.ratingProvenance;}},
  cpBeta57:{syncTournamentProvenance(p){p.ratingProvenance=p.ratingProvenance||{};p.ratingProvenance.tournament=p.ratingProvenance.tournament||{};p.ratingProvenance.tournament.currentValue=Number(p.rating)||0;return p.ratingProvenance.tournament;}}
};ctx.window=ctx;ctx.globalThis=ctx;
vm.createContext(ctx);vm.runInContext(src,ctx);const api=ctx.cpBeta98;

(async()=>{
  ok('runtime API exposes beta.98-r5',api.VERSION==='1.06.00-beta.98-r5');
  const beforeParticipants=tournamentA.players.length;
  const csv='FIDE ID;Name;Rating;FED;Birth;Gender\n1234567;Alpha Player;2150;BUL;1990;M\n2345678;Beta Player;1980;TUR;1985;F\n';
  const a=await api.importCustomList({label:'Bulgarian National 2026',category:'national',ratingType:'general',text:csv,fileName:'national.csv',sourceDescription:'National federation list'});
  ok('create/import returns stable custom ID',/^custom-bulgarian-national-2026-/.test(a.id));
  eq('import adds zero tournament participants',tournamentA.players.length,beforeParticipants);
  eq('custom category retained',a.category,'national');
  eq('custom rating context retained',a.ratingType,'general');
  ok('imported custom provenance is Type-B source-unknown',a.listClass==='Type-B'&&a.originalSourceKnown===false);
  eq('record count retained',a.recordCount,2);
  eq('player lookup returns custom value',api.playerLookup(a.id,'1234567').rating,2150);
  ok('birth/gender metadata survive custom parse',api.playerLookup(a.id,'1234567').birth==='1990'&&api.playerLookup(a.id,'1234567').gender==='m');

  const b=await api.importCustomList({label:'Bulgarian National 2026',category:'national',ratingType:'general',text:'FIDE ID;Name;Rating\n3456789;Gamma Player;1900\n'});
  ok('duplicate display names have independent stable identities',a.id!==b.id&&api.customCatalog().filter(x=>x.label==='Bulgarian National 2026').length===2);
  let dup=false;try{await api.importCustomList({id:a.id,label:'Other',text:csv});}catch(e){dup=/already exists/.test(String(e.message));}
  ok('explicit duplicate stable ID is rejected',dup);
  const beforeB=api.playerLookup(b.id,'3456789').rating;
  await api.updateCustomList(a.id,{text:'FIDE ID;Name;Rating;FED\n1234567;Alpha Player;2200;BUL\n2345678;Beta Player;1990;TUR\n',fileName:'national-new.csv'});
  eq('updating one list preserves stable ID',api.descriptor(a.id).id,a.id);
  eq('updated list gets new rating',api.playerLookup(a.id,'1234567').rating,2200);
  eq('same-name different list is not overwritten',api.playerLookup(b.id,'3456789').rating,beforeB);

  api.setSequence(tournamentA,[a.id,'fide-standard'],{mode:'custom',persist:false});
  eq('custom list can become Main Rating List',tournamentA.settings.ratingListSequence[0],a.id);
  ok('tournament keeps only compact library reference',tournamentA.settings.ratingListLibraryRefsV2.some(x=>x.id===a.id));
  const serializedA=JSON.stringify(tournamentA);
  ok('tournament snapshot does not embed federation player rows',!serializedA.includes('Alpha Player')&&!serializedA.includes('Beta Player'));
  ok('tournament snapshot does not retain legacy raw-data key',!Object.prototype.hasOwnProperty.call(tournamentA.settings,'customRatingListDataV1'));
  const hit=api.resolveSequenceForPlayer({fideId:'1234567',std:2000,rapid:0,blitz:0},tournamentA);
  ok('sequence selects custom rating first',hit.listId===a.id&&hit.rating===2200&&hit.kind==='custom-rating-list');
  const fallback=api.resolveSequenceForPlayer({fideId:'9999999',std:2050,rapid:0,blitz:0},tournamentA);
  ok('missing custom player falls through to official list',fallback.listId==='fide-standard'&&fallback.rating===2050);

  api.setSequence(tournamentB,[a.id,'effective-rapid','fide-blitz'],{mode:'custom',persist:false});
  ok('same application-library list is reusable by another tournament',tournamentB.settings.ratingListSequence[0]===a.id&&tournamentB.settings.ratingListLibraryRefsV2.some(x=>x.id===a.id));
  eq('reusing list in another tournament adds zero participants',tournamentB.players.length,0);

  const searchByName=await api.searchExternalPlayers('alpha player',20);
  ok('search finds imported player by name',searchByName.some(x=>x.fideId==='1234567'&&x.__cpRatingListHits?.some(h=>h.listId===a.id&&h.rating===2200)));
  const searchById=await api.searchExternalPlayers('1234567',20);
  ok('search finds imported player by FIDE ID',searchById.some(x=>x.fideId==='1234567'));
  const typeSearch=await api.searchExternalPlayers('type b player',20);
  ok('search also exposes previous Type-B lists',typeSearch.some(x=>x.fideId==='7777777'&&x.__cpRatingListHits?.some(h=>h.listId==='legacy-type-b')));
  await api.refreshTypeBCatalog({hydrate:true});
  api.setSequence(tournamentA,['legacy-type-b','fide-standard'],{mode:'custom',persist:false});
  const typeBHit=api.resolveSequenceForPlayer({fideId:'7777777',std:1700},tournamentA);
  ok('previous Type-B list can now participate in Rating List Sequence',typeBHit.listId==='legacy-type-b'&&typeBHit.rating===1888&&typeBHit.kind==='type-b-rating-list');

  const player={fideId:'1234567',rating:2200,ratingProvenance:{}};tournamentA.players.push(player);
  api.setSequence(tournamentA,[a.id,'fide-standard'],{mode:'custom',persist:false});
  api.attachTournamentProvenance(player,api.resolveSequenceForPlayer({fideId:'1234567',std:2000},tournamentA));
  ok('Tournament Rating provenance stores external list ID/value',player.ratingProvenance.tournament.sourceListId===a.id&&player.ratingProvenance.tournament.sourceValue===2200);
  player.rating=2250;api.markExternalManualOverride(player,2200);
  ok('manual override keeps original external provenance',player.ratingProvenance.tournament.sourceListId===a.id&&player.ratingProvenance.tournament.sourceValue===2200&&player.ratingProvenance.tournament.manualOverride===true);

  const missing={settings:{tournamentRatingType:'Standard',ratingListSequence:['custom-missing-abc','fide-standard'],ratingListSequenceMode:'custom',q117RatingListSequenceV1:['custom-missing-abc','fide-standard'],ratingListLibraryRefsV2:[{id:'custom-missing-abc',kind:'custom-rating-list',label:'National List on another PC',ratingType:'general',category:'national'}]},players:[]};
  data.tournaments.Missing=missing;
  eq('missing cross-device library reference is preserved',api.cleanSequence(missing.settings.ratingListSequence,missing),['custom-missing-abc','fide-standard']);
  const missingFallback=api.resolveSequenceForPlayer({fideId:'1234567',std:2010},missing);
  ok('missing local list data fails safe to later sequence source',missingFallback.listId==='fide-standard'&&missingFallback.rating===2010);

  const legacy={settings:{tournamentRatingType:'Standard',ratingListSequence:['custom-legacy-fixed','fide-standard'],ratingListSequenceMode:'custom',q117RatingListSequenceV1:['custom-legacy-fixed','fide-standard'],customRatingListsV1:[{id:'custom-legacy-fixed',label:'Old Tournament List',category:'club',ratingType:'general'}],customRatingListDataV1:{'custom-legacy-fixed':[{fideId:'8888888',name:'Legacy Player',fed:'BUL',rating:1777}]}},players:[]};
  data.tournaments.Legacy=legacy;
  await api.migrateLegacyTournamentStores();
  ok('beta.98 tournament-scoped list migrates into global library',api.customCatalog().some(x=>x.id==='custom-legacy-fixed'));
  ok('legacy raw tournament data is removed after migration',!Object.prototype.hasOwnProperty.call(legacy.settings,'customRatingListDataV1')&&!Object.prototype.hasOwnProperty.call(legacy.settings,'customRatingListsV1'));
  ok('legacy sequence identity survives migration',legacy.settings.ratingListSequence.includes('custom-legacy-fixed'));
  eq('legacy player data remains available from library',api.playerLookup('custom-legacy-fixed','8888888').rating,1777);

  api.setSequence(tournamentA,[a.id,'fide-standard'],{mode:'custom',persist:false});
  api.setSequence(tournamentB,[a.id,'effective-rapid'],{mode:'custom',persist:false});
  await api.deleteCustomList(a.id);
  ok('global delete removes list from application catalogue',!api.customCatalog().some(x=>x.id===a.id));
  ok('global delete removes dangling sequence refs in every local tournament',!tournamentA.settings.ratingListSequence.includes(a.id)&&!tournamentB.settings.ratingListSequence.includes(a.id));
  ok('delete preserves stored player provenance and marks local source deleted',player.ratingProvenance.tournament.sourceListId===a.id&&player.ratingProvenance.tournament.sourceValue===2200&&player.ratingProvenance.tournament.sourceListDeleted===true);
  ok('persistence path was exercised',saves>0);

  const cat=await api.fullCatalogue();
  ok('general catalogue includes Type-A, Type-B and Custom entries',cat.some(x=>x.id==='fide-standard')&&cat.some(x=>x.id==='legacy-type-b')&&cat.some(x=>x.id===b.id));
  ok('manager exposes library import/manage/main/replace/delete workflows',/Import to Library/.test(src)&&/Manage Rating Lists/.test(src)&&/Set Main/.test(src)&&/Replace Data/.test(src)&&/Delete/.test(src));
  ok('selected player insertion uses Rating List Sequence with rating before original add path',/pending\[base\]=n\(res\.rating\)/.test(src)&&/finally\{pending\[base\]=oldBase;\}/.test(src));
  ok('official/tournament separation is repaired after external source insertion',/assignOfficialRating\(added,trueOfficial/.test(src)&&/attachTournamentProvenance\(added,res/.test(src));
  ok('existing Type-A/Type-B modules are wrapped, not redefined',!/cpBeta65\s*=\s*\{/.test(src)&&!/cpBeta81\s*=\s*\{/.test(src));

  console.log(`BETA98-R4 Q117 OPERATIONAL RESULT: ${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
