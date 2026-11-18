'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'ChessPublisher-Beta54-Compliance.js'),'utf8');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
let pass=0,fail=0;
function ok(v,n){if(v){pass++;console.log('PASS',n);}else{fail++;console.error('FAIL',n);}}
function eq(a,b,n){ok(a===b,`${n} (${JSON.stringify(a)} === ${JSON.stringify(b)})`);}
async function rejects(fn,re,n){try{await fn();ok(false,n);}catch(e){ok(re.test(String(e?.message||e)),n);}}
function makeCtx({target='2026-09',updateResult=true,period='2026-09',updatedAt=new Date().toISOString(),historicalFrom='historical-cache'}={}){
  const el={textContent:''};
  const state={updateCalls:0,loadCalls:0};
  const ctx={console,Map,Set,Date,Promise,document:{readyState:'complete',documentElement:{dataset:{}},getElementById:id=>id==='registeredFideEffectivePeriod'?el:null},window:null,
    fideCacheMeta:{lists:{std:{periodKey:period,updatedAt,source:'FIDE official'},rapid:{periodKey:period,updatedAt,source:'FIDE official'},blitz:{periodKey:period,updatedAt,source:'FIDE official'}}},
    currentFidePeriodKey:()=> '2026-09',
    updateFideDatabaseNow:async()=>{state.updateCalls++;return updateResult;},
  };
  ctx.window=ctx;
  ctx.cpBeta53={
    consistencyTarget:()=>({periodKey:target,reason:target==='2026-09'?'date of check':'tournament start date'}),
    periodLabel:p=>p==='2026-09'?'Sep 2026':'Jul 2026',
    loadRatings:async(type,p,ids)=>{state.loadCalls++;return {ratings:new Map((ids||[]).map(id=>[id,2100])),sourceUrl:'https://ratings.fide.com/archive.zip',from:historicalFrom};}
  };
  vm.createContext(ctx);vm.runInContext(src,ctx);
  return {ctx,api:ctx.cpBeta54,el,state};
}
(async()=>{
  let x=makeCtx();
  eq(x.api.VERSION,'1.06.00-beta.54','beta54 API version');
  ok(x.api.recentlyVerified({updatedAt:new Date().toISOString()}),'fresh timestamp recognized');
  ok(!x.api.recentlyVerified({updatedAt:'2020-01-01T00:00:00Z'}),'stale timestamp rejected');

  let r=await x.api.verifyBeforeRequestedConsistency({}, {rating:false,type:'std'}, ['12345678'], new Date());
  ok(r.required===false,'non-rating request needs no rating-list freshness check');
  eq(x.state.updateCalls,0,'non-rating request does not refresh current lists');

  x=makeCtx({target:'2026-09'});
  r=await x.api.verifyBeforeRequestedConsistency({}, {rating:true,type:'std'}, ['12345678'], new Date());
  eq(x.state.updateCalls,1,'current-period request verifies server before check');
  eq(x.state.loadCalls,0,'current-period verification does not use historical loader');
  eq(r.mode,'current-server-check','current verification mode recorded');
  eq(r.periodKey,'2026-09','current verified period recorded');
  ok(/verified$/.test(x.el.textContent),'current verification status is concise and verified');

  x=makeCtx({target:'2026-09',updateResult:false});
  await rejects(()=>x.api.verifyBeforeRequestedConsistency({}, {rating:true,type:'std'}, ['12345678']),/could not be verified/,'network/current refresh failure is fail-closed');

  x=makeCtx({target:'2026-09',period:'2026-08'});
  await rejects(()=>x.api.verifyBeforeRequestedConsistency({}, {rating:true,type:'std'}, ['12345678']),/does not match/,'wrong current period is rejected after verification');

  x=makeCtx({target:'2026-09',updatedAt:'2020-01-01T00:00:00Z'});
  await rejects(()=>x.api.verifyBeforeRequestedConsistency({}, {rating:true,type:'std'}, ['12345678']),/freshness timestamp/,'unverified stale timestamp is rejected');

  x=makeCtx({target:'2026-07'});
  r=await x.api.verifyBeforeRequestedConsistency({}, {rating:true,type:'rapid'}, ['12345678','87654321']);
  eq(x.state.updateCalls,0,'historical-period request does not replace current cache');
  eq(x.state.loadCalls,1,'historical-period request verifies exact archive snapshot');
  eq(r.periodKey,'2026-07','historical verified period recorded');
  eq(r.mode,'historical-cache','historical verification mode recorded');
  ok(/Jul 2026.*verified/.test(x.el.textContent),'historical verification status names exact month');

  x=makeCtx({target:'2026-07'});
  x.ctx.cpBeta53.loadRatings=async()=>{throw new Error('required archive unavailable');};
  await rejects(()=>x.api.verifyBeforeRequestedConsistency({}, {rating:true,type:'std'}, ['12345678']),/archive unavailable/,'historical verification failure is fail-closed');

  // Integration order: freshness must run before directory lookup and beta53 date overlay/evaluation.
  const freshIdx=html.indexOf('cpBeta54.verifyBeforeRequestedConsistency');
  const lookupIdx=html.indexOf('const lookup=await lookupRegisteredPlayersInFideDirectory(registeredIds);');
  const overlayIdx=html.indexOf('cpBeta53.applyDateEffectiveRatings',lookupIdx);
  const evalIdx=html.indexOf('evaluateRegisteredFideUpdate(t,lookup,options,applyChanges)',lookupIdx);
  ok(freshIdx>=0&&lookupIdx>freshIdx&&overlayIdx>lookupIdx&&evalIdx>overlayIdx,'freshness verification precedes lookup, date overlay and evaluation');
  ok(html.includes('ChessPublisher-Beta54-Compliance.js'),'HTML loads beta54 layer');
  const packageVersion=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
  const packageBeta=Number((packageVersion.match(/1\.06\.00-beta\.(\d+)/)||[])[1]||0);
  ok(packageBeta>=54,'package version does not regress below beta54');
  ok(!/freshness experimental|pending freshness/i.test(html),'no unfinished beta54 wording');

  console.log(`BETA54 RESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
