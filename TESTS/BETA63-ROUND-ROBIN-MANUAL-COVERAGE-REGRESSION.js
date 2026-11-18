const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('ChessPublisher.html','utf8');
const js=fs.readFileSync('ChessPublisher-Beta63-Compliance.js','utf8');
let pass=0,fail=0;
function check(cond,msg){try{assert.ok(cond);console.log(`PASS ${String(++pass).padStart(2,'0')} ${msg}`);}catch(e){fail++;console.log(`FAIL ${msg}`);}}
check((()=>{const m=html.match(/data-chesspublisher-version="1\.06\.00-beta\.(\d+)(?:-r\d+)?"/);return m&&Number(m[1])>=63;})(),'HTML self-identifies beta63 or newer');
check(/ChessPublisher-Beta63-Compliance\.js/.test(html),'HTML loads beta63 module');
check(html.indexOf('ChessPublisher-Beta63-Compliance.js')>html.indexOf('ChessPublisher-Beta62-Compliance.js'),'beta63 loads after beta62');
check(/validateManualRoundRobinCoverage/.test(html),'Manual Pairing exit invokes full RR coverage validator');
check(/Manual Pairing remains open; Round Robin opponent coverage is not complete/.test(html),'failed coverage keeps Manual Pairing open');
check(/Each player must meet every other player exactly once per cycle/.test(html),'user-facing full-coverage rule is explicit');
const document={readyState:'complete',documentElement:{dataset:{}},title:'Chess-Publisher v1.06.00-beta.62',getElementById:()=>null,addEventListener:()=>{}};
const window={document};const ctx={window,document,console};vm.createContext(ctx);vm.runInContext(js,ctx);const api=window.cpBeta63;
check(api.VERSION==='1.06.00-beta.63','runtime API version is beta63');
check(document.documentElement.dataset.chesspublisherVersion==='1.06.00-beta.63','install publishes beta63 version');
check(api.cleanCycles(2)===2&&api.cleanCycles(9)===1,'cycle count is bounded');
// Pure coverage model equivalent to the production validator contract.
function validator(schedule,keys,cycles){
 const expected=new Set(keys),meet=new Map(),byes=new Map(keys.map(k=>[k,0]));
 for(const rk of Object.keys(schedule).map(Number).sort((a,b)=>a-b)){
  const seen=new Set();
  for(const b of schedule[String(rk)]||[]){
   const w=b.whiteKey,bl=b.blackKey;
   if(!expected.has(w)||(bl&&!expected.has(bl)))throw Error(`unknown player`);
   if(seen.has(w)||(bl&&seen.has(bl)))throw Error(`duplicate player in round`);
   seen.add(w);
   if(bl){seen.add(bl);const m=[w,bl].sort().join('|');meet.set(m,(meet.get(m)||0)+1);}
   else {if(b.result!=='0 BYE')throw Error('invalid free-day row');byes.set(w,(byes.get(w)||0)+1);}
  }
  if(seen.size!==expected.size)throw Error(`incomplete round`);
 }
 const need=keys.length*(keys.length-1)/2;
 if(meet.size!==need)throw Error('missing opponent pair');
 for(const [m,c] of meet)if(c!==cycles)throw Error(`wrong meeting count ${m}`);
 if(keys.length%2)for(const [k,c] of byes)if(c!==cycles)throw Error(`wrong bye count ${k}`);
 return true;
}
const K=['A','B','C','D'];
const single={
 '1':[{whiteKey:'A',blackKey:'D',result:'-'},{whiteKey:'B',blackKey:'C',result:'-'}],
 '2':[{whiteKey:'D',blackKey:'C',result:'-'},{whiteKey:'A',blackKey:'B',result:'-'}],
 '3':[{whiteKey:'B',blackKey:'D',result:'-'},{whiteKey:'C',blackKey:'A',result:'-'}]
};
check(api.validateCoverage(single,K,1,validator).ok,'valid single RR has every opponent pair once');
const missing=JSON.parse(JSON.stringify(single));missing['3']=[{whiteKey:'B',blackKey:'C',result:'-'},{whiteKey:'D',blackKey:'A',result:'-'}];
check(!api.validateCoverage(missing,K,1,validator).ok,'repeated opponents causing missing pair are rejected');
const duplicateRound=JSON.parse(JSON.stringify(single));duplicateRound['1']=[{whiteKey:'A',blackKey:'D',result:'-'},{whiteKey:'A',blackKey:'C',result:'-'}];
check(!api.validateCoverage(duplicateRound,K,1,validator).ok,'player used twice in one round is rejected');
const unknown=JSON.parse(JSON.stringify(single));unknown['1'][0].whiteKey='X';
check(!api.validateCoverage(unknown,K,1,validator).ok,'unknown player is rejected');
const partial=JSON.parse(JSON.stringify(single));partial['2'].pop();
check(!api.validateCoverage(partial,K,1,validator).ok,'incomplete round coverage is rejected');
const dbl={};for(const [r,boards] of Object.entries(single)){dbl[r]=boards;dbl[String(Number(r)+3)]=boards.map(b=>({whiteKey:b.blackKey,blackKey:b.whiteKey,result:'-'}));}
check(api.validateCoverage(dbl,K,2,validator).ok,'valid double RR has every opponent pair twice');
check(!api.validateCoverage(single,K,2,validator).ok,'single-cycle schedule is rejected when two cycles are required');
const triple=JSON.parse(JSON.stringify(dbl));triple['7']=single['1'];
check(!api.validateCoverage(triple,K,2,validator).ok,'extra third meetings are rejected');
const O=['A','B','C'];
const odd={
 '1':[{whiteKey:'A',blackKey:'B',result:'-'},{whiteKey:'C',blackKey:'',result:'0 BYE'}],
 '2':[{whiteKey:'B',blackKey:'C',result:'-'},{whiteKey:'A',blackKey:'',result:'0 BYE'}],
 '3':[{whiteKey:'C',blackKey:'A',result:'-'},{whiteKey:'B',blackKey:'',result:'0 BYE'}]
};
check(api.validateCoverage(odd,O,1,validator).ok,'odd-player RR requires one free day per player per cycle');
const badBye=JSON.parse(JSON.stringify(odd));badBye['1'][1].result='1 BYE';
check(!api.validateCoverage(badBye,O,1,validator).ok,'non-0-BYE free-day row is rejected');
const missingBye=JSON.parse(JSON.stringify(odd));missingBye['1'].pop();
check(!api.validateCoverage(missingBye,O,1,validator).ok,'missing odd-player free-day coverage is rejected');
check(!api.validateCoverage({},['A'],1,validator).ok,'coverage requires at least two players');
check(!api.validateCoverage(single,K,1,null).ok,'missing validator fails closed');
// Integration helper uses current tournament, current player map and full liveBoards.
window.validateRoundRobinSchedule=validator;window.getCurrentTournament=()=>({settings:{roundRobinCycles:'1'},players:K.map((x,i)=>({id:i+1,name:x})),pairings:{liveBoards:single}});window.tournamentState=()=>({rows:K.map(k=>({key:k}))});
check(api.validateManualRoundRobinCoverage().ok,'integration helper validates full current liveBoards schedule');
window.getCurrentTournament=()=>({settings:{roundRobinCycles:'1'},players:K.map((x,i)=>({id:i+1,name:x})),pairings:{liveBoards:missing}});
check(!api.validateManualRoundRobinCoverage().ok,'integration helper rejects incomplete current schedule');
check(/if\(changed&&isRoundRobinTournament\(getCurrentTournament\(\)\)\)/.test(html),'coverage preflight runs only after a Manual Pairing change in RR');
check(html.indexOf('validateManualRoundRobinCoverage')<html.indexOf('cpVerifyPairingIntegrityForRound(round,boards,{source:"Manual Pairing"})'),'global coverage preflight runs before per-round pairing verification');
check(/return;\s*}\s*}\s*if\(changed\)/.test(html),'coverage failure blocks Manual Pairing finalization path');
check(!/experimental|pending implementation|debug only/i.test(js),'user-facing module has no unfinished engineering wording');
check(!/buildPairingEngineTRF\s*=|buildTRF26\s*=|calculateTieBreaks\s*=|requestLocalGacruxPairs\s*=/.test(js),'beta63 does not redefine protected pairing/TRF core');
console.log(`BETA63 RESULT: ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
