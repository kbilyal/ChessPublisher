/* Chess-Publisher v1.06.00-beta.56 — Automatic Rating Consistency Check */
(()=>{
'use strict';
const VERSION='1.06.00-beta.56';
const STATE_KEY='ChessPublisherBeta56AutoConsistency_v1';
const POLICY_KEY='ChessPublisherRatingConsistencyPolicy_v1';
const RETRY_MS=30000;
const FIRST_RETRY_MS=1500;
const TYPES=['std','rapid','blitz'];
let autoCheckRunning=false;
let retryTimer=null;
let installed=false;
let lastRun=null;

function nowIso(){return new Date().toISOString();}
function policyEnabled(){try{const raw=localStorage.getItem(POLICY_KEY);if(raw===null||raw==='')return true;try{const obj=JSON.parse(raw);if(obj&&typeof obj.enabled==='boolean')return obj.enabled!==false;}catch(_){ }return !['0','false','off','disabled','no'].includes(String(raw).trim().toLowerCase());}catch(_){return true;}}
function listMeta(type){return (typeof fideCacheMeta!=='undefined'?fideCacheMeta:null)?.lists?.[type]||{};}
function hashFingerprint(){
  return TYPES.map(type=>`${type}:${String(listMeta(type).hash||'')}`).join('|');
}
function revisionKey(){
  return TYPES.map(type=>{
    const m=listMeta(type);
    const period=String(m.periodKey||'');
    const hash=String(m.hash||'');
    // Server-verified lists carry a content hash, so a timestamp-only verification
    // does not create a new revision. The legacy local updater has no hash and is
    // therefore identified by the completed local update timestamp.
    return hash?`${type}:${period}:${hash}`:`${type}:${period}:local:${String(m.updatedAt||'')}`;
  }).join('|');
}
function readState(){
  try{
    const parsed=JSON.parse(localStorage.getItem(STATE_KEY)||'{}');
    return {
      pending:parsed&&parsed.pending&&parsed.pending.revisionKey?parsed.pending:null,
      checked:parsed&&parsed.checked&&typeof parsed.checked==='object'?parsed.checked:{}
    };
  }catch(_){return {pending:null,checked:{}};}
}
function writeState(state){
  try{localStorage.setItem(STATE_KEY,JSON.stringify(state));}catch(_){ }
  return state;
}
function tournamentKey(t){
  if(!t) return '';
  const name=String((typeof data!=='undefined'&&data?.currentTournament)||t?.name||t?.tournamentName||'').trim();
  const start=String(t?.startDate||t?.date||'').trim();
  return `${name||'tournament'}|${start}`;
}
function validFideIds(t){
  return [...new Set((t?.players||[]).map(p=>String(p?.fideId||'').trim()).filter(id=>/^\d{5,15}$/.test(id)))];
}
function currentTournament(){
  try{return typeof getCurrentTournament==='function'?getCurrentTournament():null;}catch(_){return null;}
}
function busy(){
  try{if(typeof registeredFideUpdateBusy!=='undefined'&&registeredFideUpdateBusy)return true;}catch(_){ }
  try{if(typeof fideImportInProgress!=='undefined'&&fideImportInProgress)return true;}catch(_){ }
  try{if(typeof fideBackgroundUpdateRunning!=='undefined'&&fideBackgroundUpdateRunning)return true;}catch(_){ }
  return autoCheckRunning;
}
function scheduleRetry(delay=RETRY_MS){
  if(typeof setTimeout!=='function') return;
  if(retryTimer!==null){try{clearTimeout(retryTimer);}catch(_){ }}
  retryTimer=setTimeout(()=>{retryTimer=null;tryAutomaticConsistency('retry').catch(()=>{});},Math.max(250,Number(delay)||RETRY_MS));
}
function queueRevision(reason='rating-list-update',key=revisionKey()){
  if(!key) return null;
  const state=readState();
  if(state.pending?.revisionKey===key){scheduleRetry(FIRST_RETRY_MS);return state.pending;}
  const pending={revisionKey:key,reason:String(reason||'rating-list-update'),queuedAt:nowIso()};
  state.pending=pending;
  writeState(state);
  scheduleRetry(FIRST_RETRY_MS);
  Promise.resolve().then(()=>tryAutomaticConsistency('first-opportunity')).catch(()=>{});
  return pending;
}
function markChecked(t,key=revisionKey(),source='automatic'){
  const tk=tournamentKey(t);
  if(!tk||!key) return false;
  const state=readState();
  state.checked[tk]={revisionKey:key,checkedAt:nowIso(),source:String(source||'automatic')};
  if(state.pending?.revisionKey===key) state.pending=null;
  writeState(state);
  return true;
}
function pendingState(){return readState().pending;}
function automaticOptions(){
  let type='std';
  try{if(typeof getRegisteredPlayerUpdateRatingType==='function') type=String(getRegisteredPlayerUpdateRatingType()||'std').toLowerCase();}catch(_){ }
  if(!TYPES.includes(type)) type='std';
  return {type,name:false,rating:true,k:false,title:false,birth:false,sex:false,fed:false,setZero:false};
}
function safeContext(){
  const pending=pendingState();
  if(!pending) return {ok:false,reason:'no-pending'};
  if(!policyEnabled()) return {ok:false,reason:'policy-disabled',pending};
  if(busy()) return {ok:false,reason:'busy',pending};
  const t=currentTournament();
  if(!t) return {ok:false,reason:'no-tournament',pending};
  const ids=validFideIds(t);
  if(!ids.length) return {ok:false,reason:'no-fide-ids',pending,t};
  const tk=tournamentKey(t);
  const checked=readState().checked?.[tk];
  if(checked?.revisionKey===pending.revisionKey){
    const state=readState();state.pending=null;writeState(state);
    return {ok:false,reason:'already-checked',pending,t,ids};
  }
  return {ok:true,pending,t,ids,tournamentKey:tk};
}
function operationalMessage(result,saved){
  const count=Number(result?.changes?.length)||0;
  if(count){
    return `Automatic FIDE rating consistency check: ${count} rating difference${count===1?'':'s'} found${saved?` • TXT ${saved.opened?'opened':'saved'}`:''}. No player data was changed.`;
  }
  return 'Automatic FIDE rating consistency check: no rating differences found. No player data was changed.';
}
async function performAutomaticConsistency(context){
  const {t,ids,pending}=context;
  const options=automaticOptions();
  const operationContext=typeof cpCaptureTournamentContext==='function'?cpCaptureTournamentContext():null;
  if(!window.cpBeta54||typeof window.cpBeta54.verifyBeforeRequestedConsistency!=='function') throw new Error('FIDE rating-list verification is unavailable.');
  if(typeof lookupRegisteredPlayersInFideDirectory!=='function'||typeof evaluateRegisteredFideUpdate!=='function') throw new Error('FIDE consistency comparison is unavailable.');

  await window.cpBeta54.verifyBeforeRequestedConsistency(t,options,ids,new Date());
  const lookup=await lookupRegisteredPlayersInFideDirectory(ids);
  if(window.cpBeta53&&typeof window.cpBeta53.applyDateEffectiveRatings==='function'){
    await window.cpBeta53.applyDateEffectiveRatings(t,lookup,options,ids,new Date());
  }
  if(operationContext&&typeof cpIsTournamentContextCurrent==='function'&&!cpIsTournamentContextCurrent(operationContext)){
    throw new Error('Tournament changed while the automatic consistency check was running.');
  }

  // Q139 is a comparison only. evaluateRegisteredFideUpdate(..., false) is the
  // existing non-mutating path and cannot apply player changes.
  const result=evaluateRegisteredFideUpdate(t,lookup,options,false);
  let saved=null;
  if(result?.changes?.length&&typeof buildRegisteredFideUpdateReport==='function'&&typeof saveRegisteredFideUpdateReport==='function'){
    const report=buildRegisteredFideUpdateReport(result,options,false,lookup.source);
    saved=await saveRegisteredFideUpdateReport(report,'ChessPublisherLmsg-Auto-Consistency');
  }
  const effectiveRevision=revisionKey()||pending.revisionKey;
  markChecked(t,effectiveRevision,'automatic');
  // If the update that triggered this run used an unhashed local revision and
  // the mandatory beta54 pre-check populated hashes, the same completed check
  // covers the now-verified content revision as well.
  if(effectiveRevision!==pending.revisionKey){
    const state=readState();
    state.checked[tournamentKey(t)]={revisionKey:effectiveRevision,checkedAt:nowIso(),source:'automatic'};
    state.pending=null;
    writeState(state);
  }
  const message=operationalMessage(result,saved);
  try{if(typeof setRegisteredFideUpdateResult==='function')setRegisteredFideUpdateResult(message,false);}catch(_){ }
  try{if(typeof setStatus==='function')setStatus(message);}catch(_){ }
  lastRun={ok:true,checkedAt:nowIso(),revisionKey:effectiveRevision,tournamentKey:tournamentKey(t),changes:Number(result?.changes?.length)||0,matched:Number(result?.matched)||0,source:String(lookup?.source||''),reportSaved:!!saved};
  return {ok:true,result,saved,revisionKey:effectiveRevision};
}
async function tryAutomaticConsistency(reason='first-opportunity'){
  if(autoCheckRunning) return {ok:false,deferred:true,reason:'busy'};
  const context=safeContext();
  if(!context.ok){
    if(context.reason!=='no-pending'&&context.reason!=='already-checked'&&context.reason!=='policy-disabled') scheduleRetry();
    return {ok:false,deferred:true,reason:context.reason};
  }
  autoCheckRunning=true;
  try{
    return await performAutomaticConsistency(context);
  }catch(err){
    const message=String(err?.message||err||'Automatic FIDE rating consistency check failed.');
    lastRun={ok:false,checkedAt:nowIso(),reason:String(reason||''),error:message};
    try{if(typeof setStatus==='function')setStatus(`Automatic FIDE rating consistency check could not complete: ${message} It will retry at the next opportunity.`);}catch(_){ }
    scheduleRetry();
    return {ok:false,deferred:true,reason:'error',error:message};
  }finally{
    autoCheckRunning=false;
  }
}
function wrapServerUpdater(){
  if(typeof window.updateFideDatabaseNow!=='function') return false;
  const original=window.updateFideDatabaseNow;
  if(original.__cpBeta56Wrapped) return true;
  const wrapped=async function(){
    const before=hashFingerprint();
    const result=await original.apply(this,arguments);
    const after=hashFingerprint();
    if(!autoCheckRunning&&before!==after) queueRevision('official-rating-list-content-update',revisionKey());
    return result;
  };
  wrapped.__cpBeta56Wrapped=true;wrapped.__cpBeta56Original=original;
  window.updateFideDatabaseNow=wrapped;
  return true;
}
function localTimestampFingerprint(){
  return TYPES.map(type=>`${type}:${String(listMeta(type).periodKey||'')}:${String(listMeta(type).updatedAt||'')}:${String(listMeta(type).source||'')}`).join('|');
}
function wrapLocalUpdater(){
  if(typeof window.downloadAndUpdateFideDatabases!=='function') return false;
  const original=window.downloadAndUpdateFideDatabases;
  if(original.__cpBeta56Wrapped) return true;
  const wrapped=async function(){
    const before=localTimestampFingerprint();
    const result=await original.apply(this,arguments);
    const after=localTimestampFingerprint();
    if(!autoCheckRunning&&before!==after&&TYPES.every(type=>String(listMeta(type).source||'').toLowerCase().includes('local fide updater'))){
      queueRevision('local-rating-list-update',revisionKey());
    }
    return result;
  };
  wrapped.__cpBeta56Wrapped=true;wrapped.__cpBeta56Original=original;
  window.downloadAndUpdateFideDatabases=wrapped;
  return true;
}
function wrapReportSaver(){
  if(typeof window.saveRegisteredFideUpdateReport!=='function') return false;
  const original=window.saveRegisteredFideUpdateReport;
  if(original.__cpBeta56Wrapped) return true;
  const wrapped=async function(report,prefix){
    const result=await original.apply(this,arguments);
    const p=String(prefix||'');
    if(!autoCheckRunning&&(p==='ChessPublisherLmsg-Test'||p==='ChessPublisherLmsg')){
      const t=currentTournament();
      const pending=pendingState();
      if(t&&pending) markChecked(t,revisionKey()||pending.revisionKey,'manual-consistency');
    }
    return result;
  };
  wrapped.__cpBeta56Wrapped=true;wrapped.__cpBeta56Original=original;
  window.saveRegisteredFideUpdateReport=wrapped;
  return true;
}
function handleOpportunity(reason){
  if(reason==='visibility'&&typeof document!=='undefined'&&document.visibilityState==='hidden') return;
  tryAutomaticConsistency(reason).catch(()=>{});
}
function install(){
  if(installed) return;
  installed=true;
  wrapServerUpdater();wrapLocalUpdater();wrapReportSaver();
  try{window.addEventListener('focus',()=>handleOpportunity('focus'));}catch(_){ }
  try{window.addEventListener('pageshow',()=>handleOpportunity('pageshow'));}catch(_){ }
  try{document.addEventListener('visibilitychange',()=>handleOpportunity('visibility'));}catch(_){ }
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }
  if(pendingState()) scheduleRetry(FIRST_RETRY_MS);
}
window.cpBeta56={VERSION,STATE_KEY,POLICY_KEY,policyEnabled,RETRY_MS,FIRST_RETRY_MS,TYPES,listMeta,hashFingerprint,revisionKey,readState,writeState,tournamentKey,validFideIds,automaticOptions,safeContext,queueRevision,markChecked,pendingState,tryAutomaticConsistency,wrapServerUpdater,wrapLocalUpdater,wrapReportSaver,install,get running(){return autoCheckRunning;},get lastRun(){return lastRun;}};
install();
})();
