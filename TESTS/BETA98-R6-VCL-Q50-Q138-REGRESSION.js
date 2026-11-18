'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'ChessPublisher.html'),'utf8');
const js=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta98-R6-VCL-Q50-Q138.js'),'utf8');
const b56=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta56-Compliance.js'),'utf8');
let pass=0,fail=0,n=0;
function check(cond,msg){n++;try{assert.ok(cond);pass++;console.log(`PASS ${String(n).padStart(2,'0')} ${msg}`);}catch(e){fail++;console.error(`FAIL ${String(n).padStart(2,'0')} ${msg}`);}}

check(/data-chesspublisher-version="1[.]06[.]00-beta[.]98-r(?:[6-9]|[1-9][0-9]+)"/.test(html),'HTML self-identifies beta.98-r6 or later r-revision');
check(js.includes("const VERSION='1.06.00-beta.98-r6'"),'r6 additive source exposes exact version');
check(js.includes("const POLICY_KEY='ChessPublisherRatingConsistencyPolicy_v1'"),'Q138 uses persistent consistency policy key');
check(js.includes('Consistency checks: ${enabled?\'ON\':\'OFF\'}'),'Q138 exposes explicit ON/OFF UI');
check(js.includes('consistency-policy-disabled'),'manual Q138 guard reports policy-disabled reason');
check(b56.includes("const POLICY_KEY='ChessPublisherRatingConsistencyPolicy_v1'"),'beta56 automatic consistency shares the same Q138 policy');
check(b56.includes("reason:'policy-disabled'"),'beta56 automatic first-opportunity check defers while policy is OFF');
check(b56.includes("context.reason!=='policy-disabled'"),'policy-disabled state does not spin automatic retry timer');
check(js.includes('TRF16 → TRF26 COMPATIBILITY ADJUSTMENT REPORT'),'Q50 has explicit user-facing adjustment report');
check(js.includes("it is not silently relabelled as TRF26"),'Q50 keeps TRF16 provenance explicit');
check(js.includes('TRF26-only extension records'),'Q50 discloses unavailable TRF26-only metadata');
check(js.includes('missing TRF16 data is not fabricated'),'Q50 explicitly forbids fabricated compatibility data');
check(!/buildTRF26\s*=|buildPairingEngineTRF\s*=|calculateTieBreaks\s*=|requestLocalGacruxPairs\s*=/.test(js),'r6 does not redefine protected pairing/TRF/tie-break/Gacrux core');

function makeEl(id){return {id,children:[],style:{},dataset:{},className:'',textContent:'',title:'',disabled:false,attributes:{},appendChild(x){this.children.push(x);if(x.id)elements[x.id]=x;return x;},replaceWith(x){if(x.id)elements[x.id]=x;},querySelector(sel){if(sel==='.cp-rating-sequence-summary')return this;return null;},querySelectorAll(){return[];},addEventListener(type,fn){this._listeners=this._listeners||{};this._listeners[type]=fn;},setAttribute(k,v){this.attributes[k]=String(v);},cloneNode(){const x=makeEl(this.id);x.textContent=this.textContent;x.title=this.title;x.disabled=this.disabled;return x;}};}
const elements={};elements.ratingListSequenceControl=makeEl('ratingListSequenceControl');elements.ratingListSequenceCheck=makeEl('ratingListSequenceCheck');elements.ratingListSequenceControl.appendChild(elements.ratingListSequenceCheck);
const doc={readyState:'complete',documentElement:{dataset:{}},title:'',getElementById:id=>elements[id]||null,createElement:tag=>makeEl(''),addEventListener(){},querySelector(){return null},querySelectorAll(){return[]}};
const store=new Map();
let manualCalls=0,autoCalls=0,alerts=[];
let tournament={name:'T',players:[],settings:{},regulations:{pabPoints:1},pairings:{trfImportMeta:{trfVersion:16}}};
const ctx={console,JSON,Number,String,Math,Date,Array,Object,Promise,Set,Map,RegExp,Error,Uint8Array,document:doc,window:null,setTimeout,clearTimeout,
 localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
 data:{currentTournament:'T',tournaments:{T:tournament}},getCurrentTournament(){return tournament},
 cpBeta66:{async runCurrent(){manualCalls++;return {ok:true};}},
 cpBeta56:{async tryAutomaticConsistency(){autoCalls++;return {ok:true};}},
 setStatus(){},
 async appAlert(msg,title,type){alerts.push({msg,title,type});},
 cpLogComplianceEvent(){},
 async importTournamentMenuFile(){tournament.pairings.trfImportMeta={trfVersion:16};return true;},
 async importPlayersMenuFile(){tournament.players.push({name:'Imported'});return true;}
};ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(js,ctx);
const api=ctx.cpBeta98R6;
check(api&&api.VERSION==='1.06.00-beta.98-r6','r6 runtime API installs');
check(api.policyEnabled()===true,'Q138 defaults to ON when no policy is stored');
api.writePolicy(false);
check(api.policyEnabled()===false,'Q138 persists OFF state');
api.renderPolicyUi();
check(elements.ratingConsistencyPolicyToggle&&elements.ratingConsistencyPolicyToggle.textContent==='Consistency checks: OFF','Q138 UI renders OFF state');
check(elements.ratingListSequenceCheck.disabled===true,'Q138 disables manual consistency action while OFF');
(async()=>{
 const out=await ctx.cpBeta66.runCurrent();
 check(out&&out.skipped===true&&out.reason==='consistency-policy-disabled'&&manualCalls===0,'Q138 blocks manual consistency execution while OFF');
 api.writePolicy(true);api.renderPolicyUi();
 check(elements.ratingListSequenceCheck.disabled===false&&api.policyEnabled()===true,'Q138 re-enables manual consistency action');
 await ctx.cpBeta66.runCurrent();
 check(manualCalls===1,'manual consistency runs again after policy is ON');
 const trf16='012 Test\n001    1 Player, One                         2000 BUL 1234567\n';
 const trf26='012 Test\n162 1.0 0.5 0.0\n';
 check(api.detectTrfVersion(trf16)===16&&api.detectTrfVersion(trf26)===26,'Q50 distinguishes TRF16 from TRF26 extension records');
 const report=api.reportText(tournament,{mode:'tournament',fileName:'legacy.trf'});
 check(/Source file: legacy\.trf/.test(report)&&/Import mode: complete tournament/.test(report),'Q50 report identifies source file and import mode');
 check(/Record 162 scoring\/PAB metadata/.test(report)&&/PAB 1\.0 point/.test(report),'Q50 report discloses Record 162/PAB compatibility assumption');
 check(/152, 172, 192, 202, 212, 222, 240/.test(report),'Q50 report lists TRF26-only extension records not invented');
 // Reinstall wrappers against fresh public import functions and simulate successful TRF16 import.
 ctx.importTournamentMenuFile=async function(){tournament.pairings.trfImportMeta={trfVersion:16};ctx.data.currentTournament='T2';ctx.data.tournaments.T2=tournament;return true;};
 api.wrapTournamentImport();
 const fakeFile={name:'legacy.trf',async text(){return trf16;}};
 alerts=[];
 await ctx.importTournamentMenuFile({target:{files:[fakeFile]}});
 check(alerts.some(a=>a.title==='TRF16 Import Adjustments'&&/not silently relabelled as TRF26/.test(a.msg)),'successful TRF16 tournament import shows Q50 adjustment report');
 ctx.data.currentTournament='T';ctx.data.tournaments.T=tournament;tournament.players=[];
 ctx.importPlayersMenuFile=async function(){tournament.players.push({name:'P'});return true;};
 api.wrapPlayersImport();alerts=[];
 await ctx.importPlayersMenuFile({target:{files:[fakeFile]}});
 check(alerts.some(a=>/players only/.test(a.msg)&&/tournament metadata, pairings and round history are not imported/.test(a.msg)),'TRF16 players-only import reports its limited merge scope');
 check(ctx.document.documentElement.dataset.chesspublisherVersion==='1.06.00-beta.98-r6','r6 install publishes final page version');
 console.log(`BETA98-R6 Q50/Q138 RESULT: ${pass} PASS / ${fail} FAIL`);
 process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exit(1);});
