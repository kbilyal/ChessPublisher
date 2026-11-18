const fs=require('fs'), vm=require('vm'), assert=require('assert'), path=require('path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
const beta59=fs.readFileSync(path.join(root,'ChessPublisher-Beta59-Compliance.js'),'utf8');
const beta62=fs.readFileSync(path.join(root,'ChessPublisher-Beta62-Compliance.js'),'utf8');
const beta74=fs.readFileSync(path.join(root,'TESTS','BETA74-TEC-UI-FINAL-GAPS-REGRESSION.js'),'utf8');
let pass=0;
function check(name,fn){try{fn();pass++;console.log('PASS',name);}catch(e){console.error('FAIL',name,e.message||e);process.exitCode=1;}}
async function checkA(name,fn){try{await fn();pass++;console.log('PASS',name);}catch(e){console.error('FAIL',name,e.message||e);process.exitCode=1;}}

// Q98 / Q99 branch evidence: the product does not expose a user choice, but the
// implemented even-field double-Berger path deterministically applies the FIDE
// last-two-round reversal, so the follow-up VCL branch is satisfied.
check('Q98 no reverse/non-reverse selector is exposed',()=>{
  assert(!/reverse\s+last\s+two\s+rounds[^\n<]*(checkbox|select|option)/i.test(html));
});
check('Q99 beta74 regression contains deterministic even-field reversal fixture',()=>{
  assert(/Q99 first cycle source order reverses final two rounds/.test(beta74));
  assert(/\[1,2,3,5,4\]/.test(beta74));
  assert(/Q99 second cycle returns normal Berger order/.test(beta74));
  assert(/\[1,2,3,4,5\]/.test(beta74));
});

// Q125: Rating List Sequence means a tournament is no longer limited to one
// list at a time. Verify both canonical multi-list defaults and the editor.
check('Q125 Standard default sequence contains three ordered rating lists',()=>{
  assert(/if\(type==='Standard'\)return \[IDS\.STANDARD,IDS\.RAPID,IDS\.BLITZ\]/.test(beta59));
});
check('Q125 Rapid default sequence contains multiple ordered lists',()=>{
  assert(/if\(type==='Rapid'\)return \[IDS\.EFFECTIVE_RAPID,IDS\.BLITZ\]/.test(beta59));
});
check('Q125 Blitz default sequence contains multiple ordered lists',()=>{
  assert(/if\(type==='Blitz'\)return \[IDS\.EFFECTIVE_BLITZ,IDS\.RAPID\]/.test(beta59));
});
check('Q125 sequence editor supports add remove and reorder',()=>{
  assert(/function add\(/.test(beta62));
  assert(/function remove\(/.test(beta62));
  assert(/function move\(/.test(beta62));
  assert(/Ratings are resolved from top to bottom/.test(beta62));
});
check('Q125 sequence persists as an ordered array in tournament settings',()=>{
  assert(/settings\.ratingListSequence=next\.slice\(\)/.test(beta59));
  assert(/settings\.ratingListSequenceMode=mode/.test(beta59));
});

// Extract only the real cpFideWarning implementation for dynamic checks. This
// avoids evaluating the full HTML application and tests the production code.
const start=html.indexOf('async function cpFideWarning(');
const end=html.indexOf('async function cpFidePibeGate(',start);
assert(start>=0&&end>start,'cpFideWarning production function not found');
const warningFnSource=html.slice(start,end);
check('structured FIDE warning levels 1-5 are present',()=>{
  assert(/Math\.max\(1,Math\.min\(5/.test(warningFnSource));
  for(const n of [1,2,3,4])assert(new RegExp(`level===${n}`).test(warningFnSource));
  assert(/prohibited while FIDE Mode is active/.test(warningFnSource));
});
check('warning implementation has no disable or downgrade preference hook',()=>{
  assert(!/(disableWarnings|warningDisabled|disableLevel|relaxLevel|downgradeLevel|warningPreference|warningSettings)/i.test(warningFnSource));
});

function warningContext(confirmQueue=[]){
  const alerts=[],confirms=[],events=[];
  const ctx={
    console,
    appAlert:async(...args)=>{alerts.push(args);return true;},
    appConfirm:async(...args)=>{confirms.push(args);return confirmQueue.length?!!confirmQueue.shift():true;},
    cpLogComplianceEvent:(e)=>{events.push(e);return e;}
  };
  vm.createContext(ctx);vm.runInContext(warningFnSource,ctx);
  return {ctx,alerts,confirms,events};
}

(async()=>{
  await checkA('Q218 Level-2 warning always displays and cannot be disabled',async()=>{
    const x=warningContext();
    const ok=await x.ctx.cpFideWarning(2,'L2 test');
    assert.equal(ok,true);assert.equal(x.alerts.length,1);assert.equal(x.events.length,1);assert.equal(x.events[0].level,2);
  });
  await checkA('Q219 Level-3 warning always requires confirmation',async()=>{
    const x=warningContext([false]);
    const ok=await x.ctx.cpFideWarning(3,'L3 test');
    assert.equal(ok,false);assert.equal(x.confirms.length,1);assert.equal(x.events.length,0);
  });
  await checkA('Q219 accepted Level-3 confirmation logs the real Level-3 event',async()=>{
    const x=warningContext([true]);
    const ok=await x.ctx.cpFideWarning(3,'L3 test');
    assert.equal(ok,true);assert.equal(x.confirms.length,1);assert.equal(x.events.length,1);assert.equal(x.events[0].level,3);
  });
  await checkA('Q220 Level-4 cannot be disabled: first confirmation is mandatory',async()=>{
    const x=warningContext([false]);
    const ok=await x.ctx.cpFideWarning(4,'L4 test');
    assert.equal(ok,false);assert.equal(x.confirms.length,1);assert.equal(x.events.length,0);
  });
  await checkA('Q221 Level-4 cannot be relaxed to Level-3: second confirmation is mandatory',async()=>{
    const x=warningContext([true,false]);
    const ok=await x.ctx.cpFideWarning(4,'L4 test');
    assert.equal(ok,false);assert.equal(x.confirms.length,2);assert.equal(x.events.length,0);
  });
  await checkA('Q220/Q221 accepted Level-4 remains Level-4 after two confirmations',async()=>{
    const x=warningContext([true,true]);
    const ok=await x.ctx.cpFideWarning(4,'L4 test');
    assert.equal(ok,true);assert.equal(x.confirms.length,2);assert.equal(x.events.length,1);assert.equal(x.events[0].level,4);
  });
  if(process.exitCode)process.exit(1);
  console.log(`RESULT ${pass} PASS / 0 FAIL`);
})();
