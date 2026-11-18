'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'ChessPublisher-Beta55-Compliance.js'),'utf8');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
let pass=0,fail=0;
function ok(v,n){if(v){pass++;console.log('PASS',n);}else{fail++;console.error('FAIL',n);}}
function eq(a,b,n){ok(a===b,`${n} (${JSON.stringify(a)} === ${JSON.stringify(b)})`);}
function makeCtx({ages=[1,1,1],periods=['2026-09','2026-09','2026-09'],update='success',visibility='visible'}={}){
  const NOW=Date.parse('2026-09-08T08:00:00.000Z');
  class FakeDate extends Date{static now(){return NOW;} constructor(v){super(v===undefined?NOW:v);}}
  const listeners={window:{},document:{}}; const timers=[]; const state={updates:0,status:[],auto:[],init:0};
  const mk=(h,p)=>({periodKey:p,updatedAt:new Date(NOW-h*3600000).toISOString(),source:'FIDE official',hash:'h'});
  const meta={lists:{std:mk(ages[0],periods[0]),rapid:mk(ages[1],periods[1]),blitz:mk(ages[2],periods[2])}};
  const ctx={console,Promise,Map,Set,Date:FakeDate,window:null,fideCacheMeta:meta,currentFidePeriodKey:()=> '2026-09',
    document:{readyState:'complete',visibilityState:visibility,documentElement:{dataset:{}},addEventListener:(n,f)=>{listeners.document[n]=f;},getElementById:()=>null},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{},
    updateFideAutoStatus:t=>state.auto.push(t),setStatus:t=>state.status.push(t),
    initializeFideDatabaseBackground:async()=>{state.init++;return true;},
    updateFideDatabaseNow:async opts=>{state.updates++;state.lastOptions=opts;if(update==='throw')throw new Error('offline');if(update==='fail')return false;for(const t of ['std','rapid','blitz']){meta.lists[t].periodKey='2026-09';meta.lists[t].updatedAt=new Date(NOW).toISOString();}return true;}
  };
  ctx.window=ctx;ctx.addEventListener=(n,f)=>{listeners.window[n]=f;};
  vm.createContext(ctx);vm.runInContext(src,ctx);
  return {ctx,api:ctx.cpBeta55,state,meta,listeners,timers,NOW};
}
(async()=>{
  let x=makeCtx();
  eq(x.api.VERSION,'1.06.00-beta.55','beta55 API version');
  eq(x.api.DAY_MS,86400000,'maximum freshness window is one day');
  eq(x.api.PROACTIVE_AGE_MS,23*3600000,'refresh starts before one-day boundary');
  let s=x.api.freshnessState(x.NOW);
  ok(s.compliant,'all three current lists within one day are compliant');
  ok(!s.due,'young current lists are not due');
  eq(Math.round(s.oldestAgeMs/3600000),1,'oldest verification age tracked');

  let r=await x.api.ensureFreshness({reason:'test',nowMs:x.NOW});
  ok(r.ok&&!r.refreshed,'fresh lists do not cause needless network update');
  eq(x.state.updates,0,'fresh state makes zero update calls');

  x=makeCtx({ages:[23,1,1]});
  s=x.api.freshnessState(x.NOW);
  ok(s.compliant&&s.due,'23-hour list is compliant but proactively due');
  r=await x.api.ensureFreshness({reason:'scheduled',nowMs:x.NOW});
  ok(r.ok&&r.refreshed,'proactively due state is refreshed');
  eq(x.state.updates,1,'proactive refresh calls server updater once');
  ok(x.state.lastOptions?.manual===false&&x.state.lastOptions?.reason==='q135-scheduled','automatic update is non-manual and reason-tagged');

  x=makeCtx({ages:[24,1,1]});
  s=x.api.freshnessState(x.NOW);ok(s.compliant&&s.due,'exactly 24 hours is accepted but requires refresh');
  x=makeCtx({ages:[24.01,1,1]});
  s=x.api.freshnessState(x.NOW);ok(!s.compliant,'older than 24 hours is non-compliant');
  x=makeCtx({ages:[1,25,1]});
  s=x.api.freshnessState(x.NOW);ok(!s.compliant&&s.lists.rapid.withinDay===false,'one stale list makes the maintained set non-compliant');
  x=makeCtx({periods:['2026-08','2026-09','2026-09']});
  s=x.api.freshnessState(x.NOW);ok(!s.compliant&&s.lists.std.periodCurrent===false,'wrong monthly period is non-compliant');
  x=makeCtx();x.meta.lists.blitz.updatedAt='';s=x.api.freshnessState(x.NOW);ok(!s.compliant&&s.lists.blitz.ageMs===Infinity,'missing verification timestamp is non-compliant');

  x=makeCtx({ages:[25,25,25],update:'success'});
  r=await x.api.ensureFreshness({reason:'resume',nowMs:x.NOW});ok(r.ok,'successful overdue refresh restores compliance');
  ok(x.api.freshnessState(x.NOW).compliant,'all three list timestamps are current after successful refresh');

  x=makeCtx({ages:[23.2,1,1],update:'fail'});
  r=await x.api.ensureFreshness({reason:'scheduled',nowMs:x.NOW});ok(r.ok,'failed proactive check remains compliant while still inside 24-hour window');
  x=makeCtx({ages:[25,1,1],update:'throw'});
  r=await x.api.ensureFreshness({reason:'focus',nowMs:x.NOW});ok(!r.ok&&/offline/.test(r.error),'offline failure beyond 24 hours is fail-closed for freshness status');
  ok(x.state.auto.some(t=>/not verified/.test(t)),'overdue state is visible in FIDE DB status');
  ok(x.state.status.some(t=>/freshness-dependent checks require/.test(t)),'offline policy keeps cache but warns that freshness-dependent checks require verification');

  x=makeCtx();
  ok(typeof x.ctx.initializeFideDatabaseBackground==='function'&&x.ctx.initializeFideDatabaseBackground.__cpBeta55Wrapped===true,'FIDE cache initializer is hooked without editing its core');
  await x.ctx.initializeFideDatabaseBackground();await Promise.resolve();
  eq(x.state.init,1,'wrapped initializer preserves original initialization');
  ok(x.api.started,'maintenance starts after FIDE cache initialization');

  x=makeCtx({ages:[25,25,25]});
  const p1=x.api.ensureFreshness({reason:'a',nowMs:x.NOW});
  const p2=x.api.ensureFreshness({reason:'b',nowMs:x.NOW});
  await Promise.all([p1,p2]);eq(x.state.updates,1,'concurrent freshness requests are single-flight');

  x=makeCtx();await x.api.start('test');eq(x.state.updates,0,'start does not refresh when cache is safely fresh');
  ok(x.timers.length>=1,'maintenance schedules a future check while running');
  x.listeners.window.focus();await Promise.resolve();eq(x.state.updates,0,'focus recheck avoids network when safely fresh');

  x=makeCtx({ages:[25,1,1]});await x.api.start('test');const before=x.state.updates;
  x.ctx.document.visibilityState='hidden';await x.listeners.document.visibilitychange();await Promise.resolve();eq(x.state.updates,before,'hidden visibility event does not perform update');
  x.ctx.document.visibilityState='visible';x.meta.lists.std.updatedAt=new Date(x.NOW-25*3600000).toISOString();await x.listeners.document.visibilitychange();await Promise.resolve();ok(x.state.updates>=before+1,'visible resume checks overdue freshness');

  x=makeCtx({ages:[25,1,1]});await x.api.start('test');const beforePage=x.state.updates;x.meta.lists.std.updatedAt=new Date(x.NOW-25*3600000).toISOString();x.listeners.window.pageshow();await Promise.resolve();ok(x.state.updates>=beforePage+1,'pageshow rechecks overdue freshness after suspended page');

  ok(html.includes('ChessPublisher-Beta55-Compliance.js'),'HTML loads beta55 maintenance layer');
  ok(html.indexOf('ChessPublisher-Beta55-Compliance.js')>html.indexOf('ChessPublisher-Beta54-Compliance.js'),'beta55 layer loads after beta54 verification layer');
  ok(/1\.06\.00-beta\.55/.test(src),'beta55 source carries exact version');
  ok(!/experimental|pending implementation|debug freshness/i.test(src),'no unfinished engineering wording in beta55 user-facing logic');

  console.log(`BETA55 RESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
