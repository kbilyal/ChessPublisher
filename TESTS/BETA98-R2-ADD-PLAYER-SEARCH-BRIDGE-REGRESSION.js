'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta98-Custom-Rating-Lists.js'),'utf8');
let pass=0,fail=0,n=0;function ok(name,v){n++;if(v){pass++;console.log(`PASS ${String(n).padStart(2,'0')} ${name}`);}else{fail++;console.error(`FAIL ${String(n).padStart(2,'0')} ${name}`);}}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
const tournament={settings:{tournamentRatingType:'Standard',ratingListSequence:['fide-standard'],ratingListSequenceMode:'default'},players:[]};
const data={currentTournament:'T',tournaments:{T:tournament},preferences:{}};const store=new Map();
const ctx={console,JSON,Number,String,Math,Date,Array,Object,Promise,Set,Map,RegExp,Error,data,window:null,setTimeout,clearTimeout,
 localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
 getCurrentTournament(){return tournament;},saveData(){},
 cpBeta59:{defaultSequenceFor(){return ['fide-standard'];},normalizedRatingType(){return 'Standard';}},
 cpBeta81:{async listCatalog(){return []},async getData(){return []}}
};ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(src,ctx);const api=ctx.cpBeta98;
(async()=>{
  const input={value:''};let rendered=[];let originalQueueCalls=0;
  ctx.document={
    getElementById(id){if(id==='fideSearch')return input;return null;},
    querySelector(){return null;},head:{appendChild(){}},createElement(){return {style:{},appendChild(){},addEventListener(){},querySelector(){return null;},querySelectorAll(){return []}};}
  };
  ctx.renderFideResults=function(players){rendered=(players||[]).map(x=>JSON.parse(JSON.stringify(x)));};
  ctx.queueFideSearch=function(){originalQueueCalls++;const q=input.value.toLowerCase();setTimeout(()=>{
    const base=q.includes('common')?[{fideId:'7654321',name:'FIDE Common Player',fed:'BUL',std:2000,rapid:0,blitz:0,searchKey:'fide common player 7654321 bul'}]:[];
    ctx.renderFideResults(base);
  },25);};
  ok('UI bridge installs on the real queueFideSearch command',api.installSearchIntegration()===true&&!!ctx.queueFideSearch.__cpQ117R2Wrapped);
  ok('renderFideResults is wrapped for merged search state',!!ctx.renderFideResults.__cpQ117R2Wrapped);

  const csv='FIDE ID;Name;Rating;FED\n9000001;Imported Search Alpha;2150;BUL\n9000002;Imported Common Player;2050;BUL\n9000003;Imported Search Beta;1950;BUL\n';
  const d=await api.importCustomList({label:'UI Search Federation',category:'national',ratingType:'general',text:csv,fileName:'ui-search.csv'});
  ok('test list imported without participants',d.recordCount===3&&tournament.players.length===0);

  input.value='Imported Search Alpha';ctx.queueFideSearch();await sleep(180);
  ok('normal Add Player search shows imported-only player',rendered.some(x=>x.fideId==='9000001'&&x.name==='Imported Search Alpha'));
  ok('normal Add Player search carries imported list provenance hits',rendered.some(x=>x.fideId==='9000001'&&x.__cpRatingListHits?.some(h=>h.listId===d.id&&h.rating===2150)));
  ok('original FIDE queue is still called',originalQueueCalls===1);

  input.value='common';ctx.queueFideSearch();await sleep(180);
  ok('merged Add Player search keeps FIDE result',rendered.some(x=>x.fideId==='7654321'&&x.name==='FIDE Common Player'));
  ok('merged Add Player search also shows imported result',rendered.some(x=>x.fideId==='9000002'&&x.name==='Imported Common Player'));

  input.value='Imported Search Alpha';ctx.queueFideSearch();
  await sleep(20);input.value='Imported Search Beta';ctx.queueFideSearch();await sleep(200);
  ok('fast typing does not leak stale imported results',rendered.some(x=>x.fideId==='9000003')&&!rendered.some(x=>x.fideId==='9000001'));

  input.value='9';ctx.queueFideSearch();await sleep(140);
  ok('queries shorter than two characters do not inject imported rows',!rendered.some(x=>x.__cpRatingListHits?.length));

  console.log(`BETA98-R2 ADD PLAYER SEARCH BRIDGE RESULT: ${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
