'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'ChessPublisher.html'),'utf8');
const b72=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta72-RatingLists.js'),'utf8');
const b98=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta98-Custom-Rating-Lists.js'),'utf8');
const r7=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta98-R7-Rating-List-Engine.js'),'utf8');
let pass=0,fail=0,n=0;function ok(name,v){n++;try{assert.ok(v);pass++;console.log(`PASS ${String(n).padStart(2,'0')} ${name}`)}catch(e){fail++;console.error(`FAIL ${String(n).padStart(2,'0')} ${name}`)}}
ok('HTML self-identifies beta.98-r7',/data-chesspublisher-version="1[.]06[.]00-beta[.]98-r(?:[7-9]|[1-9][0-9]+)"/.test(html));
ok('r7 unified manager source is bundled into Windows HTML',html.includes('ChessPublisher-Beta98-R7-Rating-List-Engine.js'));
ok('r7 manager explicitly includes official FIDE sources',r7.includes('Official FIDE sources')&&r7.includes("id:'fide-standard'")&&r7.includes("id:'fide-rapid'")&&r7.includes("id:'fide-blitz'"));
ok('r7 manager provides per-list Search selection',r7.includes('data-r7-search')&&r7.includes('setSearchEnabled'));
ok('r7 manager exposes Main and Add to Sequence operations',r7.includes("data-r7-action=\"main\"")&&r7.includes("data-r7-action=\"add\""));
ok('r7 manager has its own player search',r7.includes('Search players in selected lists')&&r7.includes('cpR7ManagerSearch'));
ok('main Add Player search is overridden by one unified queue',r7.includes('window.queueFideSearch=queueUnifiedSearch'));
ok('focusing search field has no focus handler or database scan',!r7.includes("addEventListener('focus'")&&!r7.includes('onfocus='));
ok('official FIDE search no longer clones entire database to a Worker',!b72.includes("rows:[...fideMainDb.values()]")&&!b72.includes('new Worker('));
ok('official FIDE search uses LocalEngine directory asynchronously',b72.includes("fetchLocalEngine('/fide/players-search'")&&b72.includes('async function searchDirectory'));
ok('browser fallback yields cooperatively instead of blocking one huge scan',b72.includes('async function searchLocalAsync')&&b72.includes("scanned%4000===0")&&b72.includes('await new Promise(resolve=>setTimeout(resolve,0))'));
ok('official manager status avoids repeated full-map counts',b72.includes('parsedCount')&&b72.includes('fideMainDb.size')&&!/function listStatus\([^)]*\)\{[^}]*countsForMap\(fideMainDb\)/.test(b72));
ok('imported-list search can restrict work to selected list IDs',b98.includes('allowedListIds')&&b98.includes('descriptors.has(entry.listId)'));
ok('r7 caches bounded unified search results',r7.includes('unifiedCache')&&r7.includes('while(unifiedCache.size>32)'));
ok('r7 uses slower two-character debounce and faster longer-query debounce',r7.includes('normalized.length===2?360:220'));
ok('r7 does not redefine protected pairing/TRF/BBP/Tie-Break/Chess-Results/SYNC core',!/(buildPairingEngineTRF\s*=|cpBuildCanonicalTRF\s*=|calculateTieBreaks\s*=|requestLocalGacruxPairs\s*=|ChessResults.*XML|function\s+syncTournament)/i.test(r7));

const store=new Map();
const doc={readyState:'loading',documentElement:{dataset:{}},title:'',addEventListener(){},getElementById(){return null},createElement(){return {appendChild(){},addEventListener(){},querySelector(){return null},querySelectorAll(){return[]},style:{}}},head:{appendChild(){}},body:{appendChild(){}}};
const official=[
 {fideId:'1001',name:'Alpha Player',fed:'BUL',std:2100,rapid:2000,blitz:0,birth:'1990'},
 {fideId:'1002',name:'Beta Player',fed:'BUL',std:0,rapid:1900,blitz:1850,birth:'1992'},
 {fideId:'1003',name:'Gamma Unrated',fed:'BUL',std:0,rapid:0,blitz:0,birth:'1995'}
];
const external=[{fideId:'1001',name:'Alpha Player',fed:'BUL',std:2100,rapid:2000,blitz:0,__cpRatingListHits:[{listId:'custom-national',label:'National',rating:2250}]}];
const tournament={settings:{ratingListSequence:['fide-standard'],ratingListSequenceMode:'custom'},players:[]};
const cpBeta98={
 async fullCatalogue(){return [{id:'fide-standard'},{id:'fide-rapid'},{id:'fide-blitz'},{id:'custom-national',label:'National',kind:'custom-rating-list',ratingTypeLabel:'General',recordCount:1}]},
 async searchExternalPlayers(q,l,o){return o?.allowedListIds?.includes('custom-national')?external:[]},
 mergeSearchPlayers(a,b){const out=a.map(x=>({...x}));for(const p of b){const x=out.find(q=>q.fideId===p.fideId);if(x)x.__cpRatingListHits=p.__cpRatingListHits;else out.push({...p});}return out},
 restoreSequenceFromShadow(){return tournament.settings.ratingListSequence.slice()},setSequence(t,s){t.settings.ratingListSequence=s.slice()},async preloadSequenceData(){},
 async updateCustomList(){},async deleteCustomList(){},invalidateExternalSearchIndex(){},refreshTypeBCatalog(){},openCustomManager(){}
};
const cpBeta72RatingLists={async searchDirectory(){return official.map(x=>({...x}))},managerSnapshot(){return {totalPlayers:3,lists:{std:{status:'READY',period:'2026-09',count:1},rapid:{status:'READY',period:'2026-09',count:2},blitz:{status:'READY',period:'2026-09',count:1}}}},clearDirectorySearchCache(){},async updateRatingLists(){}};
const ctx={console,JSON,Number,String,Math,Date,Array,Object,Promise,Set,Map,RegExp,Error,document:doc,window:null,setTimeout,clearTimeout,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},cpBeta98,cpBeta72RatingLists,cpBeta81:{},getCurrentTournament(){return tournament},renderFideResults(){},openRatingModal(){}};ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(r7,ctx);const api=ctx.cpBeta98R7;
ok('r7 VM API loads',api&&api.VERSION==='1.06.00-beta.98-r7');
(async()=>{
 let rows=await api.unifiedSearch('Alpha',20);
 ok('unified search merges official identity and custom rating hit',rows.length===1&&rows[0].fideId==='1001'&&rows[0].__cpRatingListHits?.[0]?.rating===2250&&rows[0].__cpOfficialRatingHits?.some(x=>x.id==='fide-standard'));
 api.setSearchEnabled('fide-standard',false);api.setSearchEnabled('fide-rapid',false);api.setSearchEnabled('fide-blitz',false);let c=api.readConfig();c.directory=false;api.saveConfig(c);
 rows=await api.unifiedSearch('Alpha',20);
 ok('disabling all official and directory sources leaves only selected imported source',rows.length===1&&rows[0].__cpOfficialRatingHits.length===0&&rows[0].__cpRatingListHits.length===1);
 api.setSearchEnabled('custom-national',false);
 rows=await api.unifiedSearch('Alpha',20);
 ok('disabling imported source too produces no results',rows.length===0);
 c=api.readConfig();c.directory=true;api.saveConfig(c);
 rows=await api.unifiedSearch('Gamma',20);
 ok('FIDE Player Directory can still find an unrated identity when enabled',rows.length===1&&rows[0].name==='Gamma Unrated');
 console.log(`BETA98-R7 RATING LIST ENGINE RESULT: ${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
})();
