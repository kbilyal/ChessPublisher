'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta98-Custom-Rating-Lists.js'),'utf8');
let pass=0,fail=0,n=0;function ok(name,v){n++;if(v){pass++;console.log(`PASS ${String(n).padStart(2,'0')} ${name}`);}else{fail++;console.error(`FAIL ${String(n).padStart(2,'0')} ${name}`);}}
const tournament={settings:{tournamentRatingType:'Standard',ratingListSequence:['fide-standard'],ratingListSequenceMode:'default'},players:[]};
const data={currentTournament:'T',tournaments:{T:tournament},preferences:{}};const store=new Map();
const ctx={console,JSON,Number,String,Math,Date,Array,Object,Promise,Set,Map,RegExp,Error,data,window:null,setTimeout,clearTimeout,
 localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
 getCurrentTournament(){return tournament;},saveData(){},
 cpBeta59:{defaultSequenceFor(){return ['fide-standard'];},normalizedRatingType(){return 'Standard';}},
 cpBeta81:{async listCatalog(){return []},async getData(){return []}}
};ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(src,ctx);const api=ctx.cpBeta98;
(async()=>{
  const a=await api.importCustomList({label:'National A',category:'national',ratingType:'general',text:'ID;Name;Rating;FED;DOB\nNAT-A-1;Ivan Petrov;1825;BUL;11.06.1990\nNAT-A-2;Same Name;1700;BUL;01.01.1991\n9001001;FIDE Conflict;2000;BUL;03.03.1993\n'});
  const b=await api.importCustomList({label:'Regional B',category:'regional',ratingType:'general',text:'ID;Name;Rating;FED;DOB\nREG-B-9;Ivan Petrov;1790;BUL;1990-06-11\nREG-B-2;Same Name;1750;BUL;02.02.1992\n9001002;FIDE Conflict;2100;BUL;03.03.1993\n'});
  api.setSequence(tournament,[a.id,b.id,'fide-standard'],{mode:'custom',persist:false});

  const ivan=await api.searchExternalPlayers('Ivan Petrov',20);
  ok('Name + Federation + full DOB merges the same player into one search result',ivan.length===1);
  ok('merged identity records the strong fallback match reason',ivan[0]?.__cpIdentityMerged===true&&ivan[0]?.__cpIdentityMatch==='name-fed-dob');
  ok('merged player exposes both rating-list sources',ivan[0]?.__cpRatingListHits?.length===2);
  ok('full DOB normalizes across DD.MM.YYYY and YYYY-MM-DD',ivan[0]?.birth==='1990-06-11');
  const seq=api.resolveSequenceForPlayer(ivan[0],tournament);
  ok('Rating List Sequence recommends first configured source',seq.listId===a.id&&seq.rating===1825);
  const explicit=api.resolutionFromExternalHit(ivan[0],b.id,tournament);
  ok('explicit alternate list resolves its own rating',explicit?.listId===b.id&&explicit?.rating===1790);
  const added={rating:1790,ratingProvenance:{}};api.attachTournamentProvenance(added,explicit,{selectedBy:'explicit-rating-list-selection'});
  ok('explicit choice preserves selected list provenance',added.ratingProvenance.tournament.sourceListId===b.id&&added.ratingProvenance.tournament.selectedBy==='explicit-rating-list-selection');

  const sameName=await api.searchExternalPlayers('Same Name',20);
  ok('same name/federation but different DOB stays as separate people',sameName.length===2);
  const conflict=await api.searchExternalPlayers('FIDE Conflict',20);
  ok('different valid FIDE IDs are never merged even when bio fields match',conflict.length===2);

  const base=[{fideId:'12345678',name:'Ivan Petrov',fed:'BUL',birth:'1990-06-11',std:1900,rapid:0,blitz:0}];
  const merged=api.mergeSearchPlayers(base,ivan);
  ok('official FIDE row and imported no-FIDE row merge by exact Name+FED+DOB',merged.length===1&&merged[0].fideId==='12345678'&&merged[0].__cpRatingListHits?.length===2);
  ok('modal source-choice UI is present for individual imported lists',src.includes('external:${esc(d.id)}')&&src.includes('Same player exists in multiple rating lists'));
  ok('explicit source selection has a distinct provenance mode',src.includes("explicit-rating-list-selection"));

  console.log(`BETA98-R2 IDENTITY + RATING SOURCE RESULT: ${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
