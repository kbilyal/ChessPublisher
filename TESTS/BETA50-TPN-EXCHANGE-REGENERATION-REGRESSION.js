'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta50-Compliance.js'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'ChessPublisher.html'),'utf8');
let pass=0,fail=0;function check(v,m){if(v){console.log('PASS - '+m);pass++;}else{console.error('FAIL - '+m);fail++;}}
check(/data-chesspublisher-version="1\.06\.00-beta\.(?:5[0-9]|[6-9][0-9]|[1-9][0-9]{2,})(?:-r\d+)?"/.test(html),'visible beta.50-or-newer branding present');
check(/ChessPublisher-Beta50-Compliance\.js/.test(html),'beta.50 layer loaded');
check(/TPN Exchange/.test(src),'TPN Exchange workflow present');
check(/Round 4 has been paired/.test(src),'TPN Exchange blocks after Round 4');
check(/same Tournament Rating/.test(src),'TPN Exchange restricts unequal Tournament Ratings');
check(/cpFideWarning\(3/.test(src),'TPN Exchange/regeneration uses Level-3 warning');
check(/cpRecordPibe\('TPN Exchange'/.test(src),'TPN Exchange is a TRF-visible PIBE');
check(/cpRecordPibe\('TPN Regeneration'/.test(src),'TPN Regeneration is a TRF-visible PIBE');
check(/changes\.length>=2/.test(src),'regeneration warning activates when at least two TPNs change');
check(/workflow\?\.needsLateResort/.test(src),'post-start regeneration distinguishes Late Entry reason');
check(/latest>=4/.test(src),'Round-4 exchange lock is explicit');
check(/validateStableHistoryReferences/.test(src),'TPN Exchange preserves historical stable-key references');
check(/cpBeginCriticalMutationCheckpoint\('TPN Exchange'\)/.test(src),'TPN Exchange uses critical mutation checkpoint');

function makeCtx({latest=0,sameRating=true,fide=true,needsResort=false,warningAccept=true}={}){
  const p1={name:'Alpha',rating:2200,title:'IM',pairingNumber:1,localKey:'a'};
  const p2={name:'Beta',rating:sameRating?2200:2100,title:'GM',pairingNumber:2,localKey:'b'};
  const p3={name:'Gamma',rating:2000,title:'',pairingNumber:3,localKey:'c'};
  const tournament={settings:{initialRatingSource:'fide'},players:[p1,p2,p3],pairings:{engine:{},liveBoards:{}}};
  if(latest>0)tournament.pairings.liveBoards[String(latest)]=[{board:1,whiteKey:'a',blackKey:'c',result:'1 - 0'}];
  const warnings=[],pibes=[],alerts=[],confirms=[],commits=[];
  const ctx={console,JSON,Number,String,Math,Date,Set,Map,Promise,window:null,
    getCurrentTournament:()=>tournament,getPairingEngineConfig:()=>tournament.pairings.engine,
    getLatestGeneratedRoundForTournament:()=>latest,getLatestGeneratedRound:()=>latest,
    playerKey:p=>p.localKey,isPlayerRegistrationDeleted:()=>false,isRoundRobinTournament:()=>false,
    initialRankStrength:(p)=>Number(p.rating)||0,FIDE_INITIAL_TITLE_ORDER:{GM:1,IM:2,WGM:3,FM:4,WIM:5,CM:6,WFM:7,WCM:8},
    getRegistrationWorkflowState:()=>({needsResort,needsLateResort:false,needsRankCorrectionResort:needsResort}),
    hasCompleteTournamentPairingNumbers:(players)=>{const nums=players.map(p=>p.pairingNumber);return new Set(nums).size===players.length&&nums.every(n=>n>=1&&n<=players.length);},
    validateStableHistoryReferences:()=>true,cpFideModeActive:()=>fide,
    cpFideWarning:async(level,message,opts)=>{warnings.push({level,message,opts});return warningAccept;},
    appConfirm:async(message,title)=>{confirms.push({message,title});return warningAccept;},
    appAlert:async(message,title)=>{alerts.push({message,title});return true;},
    cpRecordPibe:(action,message,opts)=>pibes.push({action,message,opts}),
    cpBeginCriticalMutationCheckpoint:async()=>({ok:true}),cpCommitCriticalMutationCheckpoint:async()=>{commits.push(1);return true;},cpRestoreCriticalMutationCheckpoint:async()=>true,
    saveData:()=>{},writePersistentState:async()=>true,renderRegistered:()=>{},updateRegistrationWorkflowUI:()=>{},updateGacruxPanel:()=>{},setStatus:()=>{},
    assignFideInitialPairingNumbers:(t)=>{t.players.sort((a,b)=>b.rating-a.rating||((ctx.FIDE_INITIAL_TITLE_ORDER[a.title]||99)-(ctx.FIDE_INITIAL_TITLE_ORDER[b.title]||99))||a.name.localeCompare(b.name));t.players.forEach((p,i)=>p.pairingNumber=i+1);},
    resortStartingList:async()=>{ctx.assignFideInitialPairingNumbers(tournament);return true;}
  };
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(src,ctx);
  return {ctx,tournament,p1,p2,p3,warnings,pibes,alerts,confirms,commits};
}
(async()=>{
  let x=makeCtx({latest:0,sameRating:true});
  let rows=[{player:x.p1,index:0,key:'a'},{player:x.p2,index:1,key:'b'}];
  let e=x.ctx.cpBeta50.exchangeEligibility(rows,x.tournament);
  check(e.ok===true,'two equal-Tournament-Rating Swiss players are exchange-eligible before Round 4');
  check(x.ctx.cpBeta50.validateAssignments(rows,[2,1]).ok===true,'TPN Exchange accepts a pure selected-TPN permutation');
  check(x.ctx.cpBeta50.validateAssignments(rows,[3,1]).ok===false,'TPN Exchange rejects importing an unselected TPN');
  check(x.ctx.cpBeta50.seedingViolation(rows,[2,1],x.tournament).violates===false,'exchange that restores GM ahead of IM does not violate title seeding');
  check(x.ctx.cpBeta50.seedingViolation(rows,[1,2],x.tournament).violates===true,'standard-title violation is detected within equal Tournament Rating');

  const ratingsBefore=[x.p1.rating,x.p2.rating];
  let ok=await x.ctx.cpBeta50.performExchange(rows,[2,1]);
  check(ok===true && x.p1.pairingNumber===2 && x.p2.pairingNumber===1,'accepted exchange swaps only TPN values');
  check(x.p1.rating===ratingsBefore[0]&&x.p2.rating===ratingsBefore[1],'TPN Exchange never modifies player ratings');
  check(x.warnings.length===1&&x.warnings[0].level===3,'every FIDE-mode TPN Exchange receives Level-3 warning');
  check(x.pibes.length===1&&x.pibes[0].action==='TPN Exchange','accepted exchange records one TPN Exchange PIBE');
  check(x.commits.length===1,'accepted exchange receives one critical mutation commit');

  x=makeCtx({latest:0,sameRating:true,warningAccept:false});rows=[{player:x.p1,index:0,key:'a'},{player:x.p2,index:1,key:'b'}];
  ok=await x.ctx.cpBeta50.performExchange(rows,[2,1]);
  check(ok===false&&x.p1.pairingNumber===1&&x.p2.pairingNumber===2,'declined Level-3 warning leaves TPNs unchanged');
  check(x.pibes.length===0,'declined exchange creates no PIBE');

  x=makeCtx({latest:4,sameRating:true});rows=[{player:x.p1,index:0,key:'a'},{player:x.p2,index:1,key:'b'}];
  check(x.ctx.cpBeta50.exchangeEligibility(rows,x.tournament).ok===false,'TPN Exchange is unavailable after Round 4 is paired');
  x=makeCtx({latest:2,sameRating:false});rows=[{player:x.p1,index:0,key:'a'},{player:x.p2,index:1,key:'b'}];
  check(x.ctx.cpBeta50.exchangeEligibility(rows,x.tournament).ok===false,'players with different Tournament Ratings cannot be exchanged');
  x=makeCtx({latest:2,sameRating:true,needsResort:true});rows=[{player:x.p1,index:0,key:'a'},{player:x.p2,index:1,key:'b'}];
  check(x.ctx.cpBeta50.exchangeEligibility(rows,x.tournament).ok===false,'pending rule-based Resort must be completed before TPN Exchange');

  x=makeCtx({latest:2,sameRating:true,needsResort:true,warningAccept:true});
  await x.ctx.resortStartingList();
  check(x.warnings.length===1&&x.warnings[0].level===3,'TPN Regeneration changing multiple TPNs requires Level-3 warning');
  check(x.pibes.some(p=>p.action==='TPN Regeneration'),'accepted multi-player TPN Regeneration records a PIBE');
  check(x.tournament.players.find(p=>p.localKey==='b').pairingNumber===1,'accepted TPN Regeneration applies the rule-based recalculated order');

  // Source-level late-entry safeguards and actual FIDE-order assignment after Round 4.
  check(/latest>0 && !workflow\.needsLateResort && !workflow\.needsRankCorrectionResort/.test(html),'Resort gate explicitly permits rule-based Late Entry resort after tournament start');
  check(/latest>=4[\s\S]{0,180}Admit a true Late Entry through the Late Entry workflow instead/.test(html),'free TPN regeneration remains blocked after Round 4');
  check(/const oldKeys=\(t\.players\|\|\[\]\)\.map/.test(html)&&/Immutable localKey changed during Resort/.test(html),'Resort asserts immutable player identities around TPN reassignment');
  check(/player\.joinedFromRound=joinRound/.test(html)&&/engine\.needsResort=true/.test(html),'Late Entry starts next round and requires rule-based TPN Resort');

  function extractFunction(source,name){
    const marker=`function ${name}(`,i=source.indexOf(marker);if(i<0)return'';let b=source.indexOf('{',i+marker.length),d=0,q=null,esc=false;
    for(let j=b;j<source.length;j++){const c=source[j];if(q){if(esc)esc=false;else if(c==='\\\\')esc=true;else if(c===q)q=null;continue;}if(c==='"'||c==="'"||c==='`'){q=c;continue;}if(c==='{')d++;else if(c==='}'&&--d===0)return source.slice(i,j+1);}return'';
  }
  const constLine=(html.match(/const FIDE_INITIAL_TITLE_ORDER=\{[^;]+;/)||[''])[0];
  const f1=extractFunction(html,'initialRankStrength'),f2=extractFunction(html,'initialRankAlphabeticalNameKey'),f3=extractFunction(html,'assignFideInitialPairingNumbers');
  check(!!(constLine&&f1&&f2&&f3),'FIDE TPN assignment functions can be isolated for late-entry fixture');
  const oldBoards={'1':[{board:1,whiteKey:'a',blackKey:'b',result:'1 - 0'}],'5':[{board:1,whiteKey:'b',blackKey:'c',result:'½ - ½'}]};
  const tt={settings:{initialRatingSource:'fide'},players:[
    {name:'A',rating:2200,title:'IM',localKey:'a',pairingNumber:1},
    {name:'B',rating:2100,title:'FM',localKey:'b',pairingNumber:2},
    {name:'C',rating:2000,title:'',localKey:'c',pairingNumber:3},
    {name:'Late GM',rating:2400,title:'GM',localKey:'late',pairingNumber:4,joinedFromRound:6}
  ],pairings:{liveBoards:JSON.parse(JSON.stringify(oldBoards))}};
  const lc={console,Number,String,Math};vm.createContext(lc);vm.runInContext(constLine+'\n'+f1+'\n'+f2+'\n'+f3,lc);
  const historyBefore=JSON.stringify(tt.pairings.liveBoards),keysBefore=tt.players.map(p=>p.localKey).join('|');
  lc.assignFideInitialPairingNumbers(tt);
  check(tt.players.find(p=>p.localKey==='late').pairingNumber===1,'post-R4 late entry receives the appropriate TPN from current FIDE initial-order criteria');
  check(new Set(tt.players.map(p=>p.pairingNumber)).size===4&&Math.max(...tt.players.map(p=>p.pairingNumber))===4,'late-entry Resort yields complete consecutive TPNs');
  check(JSON.stringify(tt.pairings.liveBoards)===historyBefore,'late-entry TPN assignment does not rewrite historical boards/results');
  check(tt.players.map(p=>p.localKey).join('|')===keysBefore,'late-entry TPN assignment preserves stable player identity/order');

  console.log(`SUMMARY PASS=${pass} FAIL=${fail}`);process.exit(fail?1:0);
})().catch(err=>{console.error(err&&err.stack||err);process.exit(1);});
