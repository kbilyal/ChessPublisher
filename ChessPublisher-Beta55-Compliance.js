/* Chess-Publisher v1.06.00-beta.55 — Maintained FIDE Rating-List Freshness */
(()=>{
'use strict';
const VERSION='1.06.00-beta.55';
const DAY_MS=24*60*60*1000;
const PROACTIVE_AGE_MS=23*60*60*1000;
const CHECK_INTERVAL_MS=15*60*1000;
const RETRY_MS=5*60*1000;
const TYPES=['std','rapid','blitz'];
let timer=null;
let started=false;
let inFlight=null;
let lastAttempt=null;
let lastState=null;
let initializerHooked=false;

function nowIso(ms=Date.now()){return new Date(ms).toISOString();}
function currentPeriod(){
  if(typeof currentFidePeriodKey==='function') return String(currentFidePeriodKey()||'');
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function metaFor(type){
  type=String(type||'').toLowerCase();
  if(!TYPES.includes(type)) throw new Error(`Unsupported FIDE rating list type: ${type||'-'}.`);
  return (typeof fideCacheMeta!=='undefined'?fideCacheMeta:null)?.lists?.[type]||null;
}
function ageMs(meta,nowMs=Date.now()){
  const stamp=Date.parse(String(meta?.updatedAt||''));
  if(!Number.isFinite(stamp)) return Infinity;
  const age=Number(nowMs)-stamp;
  return age>=0?age:Infinity;
}
function freshnessState(nowMs=Date.now()){
  const period=currentPeriod();
  const lists={};
  let oldestAgeMs=0;
  let compliant=true;
  let due=false;
  for(const type of TYPES){
    const meta=metaFor(type);
    const age=ageMs(meta,nowMs);
    const periodCurrent=String(meta?.periodKey||'')===period;
    const withinDay=Number.isFinite(age)&&age<=DAY_MS;
    const proactive=Number.isFinite(age)&&age>=PROACTIVE_AGE_MS;
    lists[type]={periodKey:String(meta?.periodKey||''),updatedAt:String(meta?.updatedAt||''),source:String(meta?.source||''),ageMs:age,periodCurrent,withinDay,due:!periodCurrent||!withinDay||proactive};
    if(Number.isFinite(age)) oldestAgeMs=Math.max(oldestAgeMs,age); else oldestAgeMs=Infinity;
    compliant=compliant&&periodCurrent&&withinDay;
    due=due||!periodCurrent||!withinDay||proactive;
  }
  return {period,checkedAt:nowIso(nowMs),lists,oldestAgeMs,compliant,due,maxAgeMs:DAY_MS,proactiveAgeMs:PROACTIVE_AGE_MS};
}
function setOperationalStatus(state,reason=''){
  if(state?.compliant) return;
  const text='current FIDE lists not verified';
  try{ if(typeof updateFideAutoStatus==='function') updateFideAutoStatus(text); }catch(_){ }
  try{ if(typeof setStatus==='function') setStatus(`FIDE rating-list verification is overdue${reason?` (${reason})`:''}. Cached data remains available, but freshness-dependent checks require a successful server verification.`); }catch(_){ }
}
function clearTimer(){
  if(timer!==null && typeof clearTimeout==='function') clearTimeout(timer);
  timer=null;
}
function schedule(delayMs){
  clearTimer();
  if(!started || typeof setTimeout!=='function') return;
  const delay=Math.max(1000,Number(delayMs)||CHECK_INTERVAL_MS);
  timer=setTimeout(()=>{ ensureFreshness({reason:'scheduled'}).catch(()=>{}); },delay);
}
async function ensureFreshness(options={}){
  const reason=String(options.reason||'scheduled');
  const force=!!options.force;
  const nowMs=Number.isFinite(Number(options.nowMs))?Number(options.nowMs):Date.now();
  const before=freshnessState(nowMs);
  lastState=before;
  if(before.compliant&&!before.due&&!force){
    if(started) schedule(CHECK_INTERVAL_MS);
    return {ok:true,refreshed:false,reason,state:before};
  }
  if(inFlight) return inFlight;
  if(typeof updateFideDatabaseNow!=='function'){
    setOperationalStatus(before,'server update unavailable');
    if(started) schedule(RETRY_MS);
    return {ok:false,refreshed:false,reason,error:'FIDE rating-list refresh is unavailable.',state:before};
  }
  inFlight=(async()=>{
    lastAttempt={reason,startedAt:nowIso(nowMs)};
    let refreshResult=false;
    let refreshError='';
    try{
      refreshResult=await updateFideDatabaseNow({manual:false,reason:`q135-${reason}`});
    }catch(err){
      refreshError=err?.message||String(err);
    }
    const after=freshnessState(Date.now());
    lastState=after;
    lastAttempt={...lastAttempt,finishedAt:nowIso(),refreshResult:!!refreshResult,ok:after.compliant,error:refreshError};
    if(!after.compliant) setOperationalStatus(after,refreshError||'server verification failed');
    if(started) schedule(after.compliant&&!after.due?CHECK_INTERVAL_MS:RETRY_MS);
    return {ok:after.compliant,refreshed:true,refreshResult:!!refreshResult,reason,error:refreshError,state:after};
  })();
  try{return await inFlight;}finally{inFlight=null;}
}
function handleWake(reason='resume'){
  if(!started) return Promise.resolve({ok:false,skipped:true,reason:'not-started'});
  if(reason==='visibility' && typeof document!=='undefined' && document.visibilityState==='hidden') return Promise.resolve({ok:true,skipped:true,reason:'hidden'});
  return ensureFreshness({reason});
}
function start(reason='startup'){
  if(!started) started=true;
  clearTimer();
  return ensureFreshness({reason});
}
function stop(){started=false;clearTimer();}
function hookInitializer(){
  if(initializerHooked || typeof window.initializeFideDatabaseBackground!=='function') return false;
  const original=window.initializeFideDatabaseBackground;
  if(original.__cpBeta55Wrapped){initializerHooked=true;return true;}
  const wrapped=async function(){
    try{return await original.apply(this,arguments);}
    finally{Promise.resolve().then(()=>start('startup')).catch(()=>{});}
  };
  wrapped.__cpBeta55Wrapped=true;
  wrapped.__cpBeta55Original=original;
  window.initializeFideDatabaseBackground=wrapped;
  initializerHooked=true;
  return true;
}
function install(){
  hookInitializer();
  try{window.addEventListener('focus',()=>{handleWake('focus').catch(()=>{});});}catch(_){ }
  try{window.addEventListener('pageshow',()=>{handleWake('pageshow').catch(()=>{});});}catch(_){ }
  try{document.addEventListener('visibilitychange',()=>{handleWake('visibility').catch(()=>{});});}catch(_){ }
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }
}
window.cpBeta55={VERSION,DAY_MS,PROACTIVE_AGE_MS,CHECK_INTERVAL_MS,RETRY_MS,metaFor,ageMs,freshnessState,ensureFreshness,handleWake,start,stop,hookInitializer,get started(){return started;},get lastAttempt(){return lastAttempt;},get lastState(){return lastState;}};
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();
