"use strict";
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'ChessPublisher-Beta89-Compliance.js'),'utf8');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
let pass=0,fail=0;
function check(c,m){try{assert.ok(c);console.log(`PASS ${String(++pass).padStart(2,'0')} ${m}`);}catch(e){fail++;console.log(`FAIL ${m} :: ${e.message}`);}}
const players=[
 {name:'Alpha',fideId:'11111',rating:1800},
 {name:'Beta',fideId:'22222',rating:1900},
 {name:'NoId',fideId:'',rating:1700}
];
const lookup={byId:new Map([
 ['11111',{fideId:'11111',std:1850,stdAvailable:true}],
 ['22222',{fideId:'22222',std:1950,stdAvailable:true}]
]),source:'fixture'};
let options={type:'std',rating:true,name:false,k:false,title:false,birth:false,sex:false,fed:false,setZero:false};
let checkboxes=[];let alerts=[];let lastReport='';let evalCalls=[];
const elements={
 cpBeta89SubsetBox:{style:{}},cpBeta89SubsetHelp:{textContent:''},cpBeta89SubsetCount:{textContent:''},
 cpBeta89SubsetRows:{_html:'',set innerHTML(v){this._html=v;},get innerHTML(){return this._html;}},
 cpBeta89SelectAll:{addEventListener(){}},cpBeta89SelectNone:{addEventListener(){}}
};
const document={
 readyState:'complete',documentElement:{dataset:{}},
 getElementById(id){return elements[id]||null;},
 querySelectorAll(sel){return sel.includes('cp-beta89-player')?checkboxes:[];},
 createElement(){return {style:{},addEventListener(){},insertAdjacentElement(){},innerHTML:''};}
};
const ctx={console,document,Map,Set,JSON,String,Number,Promise,
 data:{currentTournament:'Q144 Fixture'},
 getRegisteredFideUpdateOptions:()=>({...options}),
 appAlert:(m)=>alerts.push(String(m)),
 evaluateRegisteredFideUpdate:(t,lk,o,apply)=>{
   evalCalls.push({apply:!!apply,ids:(t.players||[]).map(p=>p.fideId)});
   const changes=[];let matched=0,unchanged=0,noFideId=0,notFound=0;
   for(const p of t.players||[]){
     const id=String(p.fideId||'');if(!/^\d{5,15}$/.test(id)){noFideId++;continue;}
     const ref=lk.byId.get(id);if(!ref){notFound++;continue;}matched++;
     const nv=Number(ref[o.type])||0;
     if(o.rating&&p.rating!==nv){const old=p.rating;if(apply)p.rating=nv;changes.push({name:p.name,fideId:id,details:[`Rating: ${old} → ${nv}`]});}else unchanged++;
   }
   return {type:o.type,typeLabel:'Standard',changes,matched,unchanged,noFideId,notFound,birthUnavailable:0,ratingUnavailable:0,kUnavailable:0};
 },
 buildRegisteredFideUpdateReport:(result)=>`BASE REPORT changed=${result.changes.length}\n`,
 runRegisteredPlayersFideUpdate:async function(apply=true){
   const result=ctx.evaluateRegisteredFideUpdate({players},lookup,{...options},!!apply);
   lastReport=ctx.buildRegisteredFideUpdateReport(result,{...options},!!apply,lookup.source);
   return result;
 }
};ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'ChessPublisher-Beta89-Compliance.js'});
(async()=>{
 check(ctx.cpBeta89?.VERSION==='1.06.00-beta.89','beta.89 compliance layer self-identifies exact version');
 check(/ChessPublisher-Beta89-Compliance\.js/.test(html),'beta.89 compliance layer is loaded by ChessPublisher.html');
 check(ctx.evaluateRegisteredFideUpdate.__cpBeta89Wrapped===true,'rating consistency evaluator is wrapped additively');
 check(ctx.runRegisteredPlayersFideUpdate.__cpBeta89Wrapped===true,'manual Start test / Start update runner is wrapped additively');
 check(ctx.buildRegisteredFideUpdateReport.__cpBeta89Wrapped===true,'TXT report builder is wrapped additively');

 // Direct evaluator call represents automatic/non-manual consistency path: must not create a subset session.
 ctx.evaluateRegisteredFideUpdate({players},lookup,{...options},false);
 check(ctx.cpBeta89.session===null,'automatic/direct non-manual consistency evaluation does not create manual subset state');

 await ctx.runRegisteredPlayersFideUpdate(false);
 check(ctx.cpBeta89.session?.detectedIds?.length===2,'Start test captures exactly the two detected changed players');
 check(ctx.cpBeta89.session.detectedIds[0]==='11111'&&ctx.cpBeta89.session.detectedIds[1]==='22222','detected subset identity is keyed by FIDE ID');
 check(players[0].rating===1800&&players[1].rating===1900,'Start test remains non-mutating');

 checkboxes=[{checked:true,dataset:{fideId:'11111'},addEventListener(){}},{checked:false,dataset:{fideId:'22222'},addEventListener(){}}];
 await ctx.runRegisteredPlayersFideUpdate(true);
 check(players[0].rating===1850,'selected changed player is updated');
 check(players[1].rating===1900,'unchecked detected player remains unchanged');
 check(evalCalls.at(-1).apply===true&&evalCalls.at(-1).ids.length===1&&evalCalls.at(-1).ids[0]==='11111','apply evaluator receives only selected player references');
 check(/Selected subset: 1 of 2 detected player\(s\)/.test(lastReport),'detailed TXT report records selected subset count');
 check(/Unchecked detected players were not modified/.test(lastReport),'detailed TXT report explicitly records unchecked-player preservation');
 check(ctx.cpBeta89.session===null,'selected-subset session is consumed after update attempt');

 // Options changed after test => fail closed before mutation.
 players[0].rating=1800;players[1].rating=1900;options={...options,type:'std'};
 await ctx.runRegisteredPlayersFideUpdate(false);
 checkboxes=[{checked:true,dataset:{fideId:'11111'},addEventListener(){}},{checked:false,dataset:{fideId:'22222'},addEventListener(){}}];
 options={...options,k:true};
 const beforeCalls=evalCalls.length;await ctx.runRegisteredPlayersFideUpdate(true);
 check(evalCalls.length===beforeCalls,'changing selected fields after Start test blocks update before evaluator execution');
 check(players[0].rating===1800&&players[1].rating===1900,'options-mismatch block leaves all player ratings untouched');
 check(alerts.some(x=>x.includes('changed since Start test')),'options-mismatch block explains that Start test must be repeated');

 // Empty selection => fail closed.
 options={...options,k:false};await ctx.runRegisteredPlayersFideUpdate(false);
 checkboxes=[{checked:false,dataset:{fideId:'11111'},addEventListener(){}},{checked:false,dataset:{fideId:'22222'},addEventListener(){}}];
 const beforeEmpty=evalCalls.length;await ctx.runRegisteredPlayersFideUpdate(true);
 check(evalCalls.length===beforeEmpty,'empty detected-player selection performs no update evaluation');
 check(alerts.some(x=>x.includes('Select at least one detected player')),'empty selection gives explicit user guidance');

 // Old behaviour remains available if user chooses Start update without a preview session.
 ctx.cpBeta89.invalidateSelection('fixture reset');checkboxes=[];players[0].rating=1800;players[1].rating=1900;
 await ctx.runRegisteredPlayersFideUpdate(true);
 check(players[0].rating===1850&&players[1].rating===1950,'legacy all-player Start update remains available without a preview subset session');
 check(evalCalls.at(-1).ids.includes('11111')&&evalCalls.at(-1).ids.includes('22222'),'legacy all-player path is not silently filtered');

 check(!/requestLocalGacruxPairs\s*=|buildPairingEngineTRF\s*=|buildTRF26\s*=|standingTieBreakValue\s*=|calculateNumberedTieBreakData\s*=/.test(src),'beta.89 layer does not redefine protected pairing/TRF/tie-break functions');
 console.log(`BETA89 TEC Q144 RESULT: ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
