'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta98-Custom-Rating-Lists.js'),'utf8');
let pass=0,fail=0,n=0;function ok(name,v){n++;if(v){pass++;console.log(`PASS ${String(n).padStart(2,'0')} ${name}`);}else{fail++;console.error(`FAIL ${String(n).padStart(2,'0')} ${name}`);}}
const tournament={settings:{tournamentRatingType:'Standard',ratingListSequence:['fide-standard'],ratingListSequenceMode:'default'},players:[]};
const data={currentTournament:'T',tournaments:{T:tournament},preferences:{}};const store=new Map();
const ctx={console,JSON,Number,String,Math,Date,Array,Object,Promise,Set,Map,RegExp,Error,data,window:null,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))},getCurrentTournament(){return tournament;},saveData(){},cpBeta59:{defaultSequenceFor(){return ['fide-standard'];},normalizedRatingType(){return 'Standard';}},cpBeta81:{async listCatalog(){return []},async getData(){return []}}};ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(src,ctx);const api=ctx.cpBeta98;
(async()=>{
 const rows=50000;let csv='FIDE ID;Name;Rating;FED\n';for(let i=0;i<rows;i++){const id=1000000+i;csv+=`${id};Federation Player ${i};${1400+(i%1000)};BUL\n`;}
 const before=tournament.players.length,start=Date.now();const d=await api.importCustomList({label:'Federation 50K',category:'national',ratingType:'general',text:csv,fileName:'fed.csv'});const elapsed=Date.now()-start;
 ok('imports 50,000 records',d.recordCount===rows);
 ok('large import creates zero tournament participants',tournament.players.length===before);
 ok('large list stays outside tournament snapshot',!JSON.stringify(tournament).includes('Federation Player 49999'));
 api.setSequence(tournament,[d.id,'fide-standard'],{mode:'custom',persist:false});
 ok('large list can be Main without copying rows into tournament',tournament.settings.ratingListSequence[0]===d.id&&!JSON.stringify(tournament).includes('Federation Player 25000'));
 const q=await api.searchExternalPlayers('Federation Player 49999',10);ok('search finds a player near end of 50K list',q.some(x=>x.fideId==='1049999'));
 const resolved=api.resolveSequenceForPlayer({fideId:'1049999',std:1600},tournament);ok('sequence resolves rating from 50K list',resolved.listId===d.id&&resolved.rating===2399);
 ok(`50K import completes in practical test time (${elapsed} ms)`,elapsed<10000);
 console.log(`BETA98-R2 LARGE LIBRARY RESULT: ${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
