const fs=require('fs');
const path=require('path');
const vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'ChessPublisher.html'),'utf8');
let pass=0,fail=0;
function check(ok,msg){if(ok){console.log('PASS - '+msg);pass++;}else{console.error('FAIL - '+msg);fail++;}}
function has(re,msg){check(re.test(html),msg);}

const buildMatch=html.match(/data-chesspublisher-version=\"1\.06\.00-beta\.(\d+)(?:-r\d+)?\"/);
check(!!buildMatch && Number(buildMatch[1])>=35,'beta.35-or-newer build marker');
has(/FIDE \/ TEC PAIRING INTEGRITY VERIFICATION — beta\.35/,'beta.35 Pairing Integrity framework marker');
has(/async function cpVerifyPairingIntegrityForRound\(/,'round verification function present');
has(/async function cpGenerateCorrectSwissPairingForRound\(/,'historical Swiss correct-pairing generator wrapper present');
has(/requestLocalGacruxPairs\(round,engine\.initialTopColor\|\|"w"\)/,'verification reuses existing Gacrux /pair workflow');
has(/cpFidePairingMismatchGate\(verification,\{action:"Manual Pairing Alteration",level:4\}\)/,'Manual Pairing discrepancy uses Level-4 gate');
has(/Correct Pairing[^]*Confirm only if the arbiter intentionally overrides the correct pairing/,'Level-4 final warning displays Correct Pairing');
has(/cpRecordPibe\("Manual Pairing Alteration"/,'Manual Pairing mismatch is logged as PIBE');
has(/cpVerifyImportedPairingRounds\(parsed\.populatedRounds,\{source:"TRF import"\}\)/,'TRF results import verifies all populated imported rounds');
has(/action:"TRF Import Pairing Violation",level:3/,'TRF pairing violation issues at least Level-3 warning');
has(/cpRecordPibe\("TRF Import Pairing Violation"/,'TRF pairing violation is logged for TRF ### serialization');
has(/if\(!preservePermanentFideExit\)\{[^]*compliance\.mode="fide"/,'TRF import automatically enters FIDE Mode when no permanent exit exists');
has(/preservePermanentFideExit/,'TRF results import preserves permanent FIDE-mode exit history');
has(/TRF tournament pairing verification failed/,'complete TRF tournament import is fail-closed on verification failure');
has(/window\.__cpPairingIntegrity=/,'pairing integrity test hook exported');

// Evaluate the actual beta.35 helper block with a controlled runtime.
const start=html.indexOf('function cpPairingIntegrityCanonicalRows(');
const end=html.indexOf('function registeredPlayerOptions(',start);
if(start<0||end<0){console.error('FAIL - could not isolate pairing integrity helper block');process.exit(1);}
const helperCode=html.slice(start,end);
const tournament={
  players:[
    {name:'Alpha',pairingNumber:1,_stableKey:'A'},
    {name:'Bravo',pairingNumber:2,_stableKey:'B'},
    {name:'Charlie',pairingNumber:3,_stableKey:'C'},
    {name:'Delta',pairingNumber:4,_stableKey:'D'}
  ],
  settings:{tournamentFormat:'Individual Swiss',rounds:'7'},
  pairings:{round:'2',liveBoards:{'1':[{board:1,whiteKey:'A',blackKey:'D',result:'1-0'}],'2':[{board:1,whiteKey:'B',blackKey:'C',result:'-'}]},engine:{lastGeneratedRound:2,manualByes:{},excludeRounds:{},excludeRemaining:{},initialTopColor:'w'}}
};
const ctx={console,JSON,Map,Set,Number,String,Math,Array,Date,
  getCurrentTournament:()=>tournament,
  playerKey:(p)=>p._stableKey,
  resolveRegisteredPlayer:(k)=>tournament.players.find(p=>p._stableKey===k)||null,
  isRoundRobinTournament:()=>false,
  calculateRoundRobinRounds:()=>0,
  requestLocalBergerCycle:async()=>{throw new Error('not used');},
  requestLocalGacruxPairs:async(round)=>{
    // Historical verifier must hide target/current round while regenerating it.
    if(Object.prototype.hasOwnProperty.call(tournament.pairings.liveBoards,String(round)))throw new Error('target round was not hidden');
    tournament.pairings.engine.lastIndependentChecker={check:true,state:'pass',round};
    if(round===2)return [{board:9,whiteKey:'B',blackKey:'C',result:'-'}];
    return [];
  }
};
vm.createContext(ctx);vm.runInContext(helperCode,ctx);

let cmp=ctx.cpPairingIntegrityCompare(
  [{board:1,whiteKey:'A',blackKey:'B',result:'1-0'},{board:2,whiteKey:'C',blackKey:'D',result:'-'}],
  [{board:8,whiteKey:'C',blackKey:'D',result:'-'},{board:3,whiteKey:'A',blackKey:'B',result:'-'}]
);
check(cmp.ok,'board-order differences do not create a pairing mismatch');
cmp=ctx.cpPairingIntegrityCompare([{whiteKey:'A',blackKey:'B',result:'-'}],[{whiteKey:'B',blackKey:'A',result:'-'}]);
check(!cmp.ok,'colour reversal is detected as a pairing mismatch');
cmp=ctx.cpPairingIntegrityCompare([{whiteKey:'A',blackKey:'C',result:'-'}],[{whiteKey:'A',blackKey:'B',result:'-'}]);
check(!cmp.ok,'opponent change is detected as a pairing mismatch');
cmp=ctx.cpPairingIntegrityCompare([{whiteKey:'A',blackKey:'',result:'PAB'}],[{whiteKey:'A',blackKey:'',result:'0 BYE'}]);
check(!cmp.ok,'PAB is distinguished from an administrative bye');
cmp=ctx.cpPairingIntegrityCompare([{whiteKey:'A',blackKey:'',result:'1 BYE'}],[{whiteKey:'A',blackKey:'',result:'0 BYE'}]);
check(cmp.ok,'administrative bye score does not falsely change pairing identity');

(async()=>{
  const before=JSON.stringify(tournament.pairings.liveBoards);
  const beforeGenerated=tournament.pairings.engine.lastGeneratedRound;
  const verification=await ctx.cpVerifyPairingIntegrityForRound(2,[{board:77,whiteKey:'B',blackKey:'C',result:'0-1'}],{source:'runtime test'});
  check(verification.ok,'historical Swiss round regenerates and verifies against correct pairing');
  check(verification.checker&&verification.checker.check===true,'independent checker result is retained as verification evidence');
  check(JSON.stringify(tournament.pairings.liveBoards)===before,'verification restores tournament pairing history after temporary regeneration');
  check(tournament.pairings.engine.lastGeneratedRound===beforeGenerated,'verification restores engine lastGeneratedRound');
  const bad=await ctx.cpVerifyPairingIntegrityForRound(2,[{board:1,whiteKey:'C',blackKey:'B',result:'-'}],{source:'runtime mismatch'});
  check(!bad.ok,'runtime verifier detects incorrect colours/opponent orientation');
  console.log(`SUMMARY PASS=${pass} FAIL=${fail}`);
  process.exit(fail?1:0);
})().catch(err=>{console.error('FAIL - runtime exception: '+(err&&err.stack||err));process.exit(1);});
