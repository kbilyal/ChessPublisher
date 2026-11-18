/* Chess-Publisher v1.06.00-beta.64 — PIBE Warning Coverage */
(()=>{
'use strict';
const VERSION='1.06.00-beta.64';
const ACTION='Game Adjournment';

function fideModeActive(){
  try{return typeof window.cpFideModeActive==='function' ? !!window.cpFideModeActive() : false;}catch(_){return false;}
}
async function level3Gate(){
  const message='Marking a game as Adjourned is a Pairing Integrity Breaching Event (PIBE).';
  const secondMessage='Confirm only if the game is genuinely adjourned. The event will be written to the compliance log and TRF comments.';
  try{
    if(typeof window.cpFidePibeGate==='function'){
      return !!(await window.cpFidePibeGate({action:ACTION,level:3,message,secondMessage}));
    }
    if(!fideModeActive())return true;
    if(typeof window.cpFideWarning==='function'){
      return !!(await window.cpFideWarning(3,message,{title:'FIDE Mode — Game Adjournment',category:'PIBE',secondMessage}));
    }
  }catch(_){return false;}
  return !fideModeActive();
}
async function withLevel3AdjournmentRecord(fn){
  const originalRecord=window.cpRecordPibe;
  if(typeof originalRecord!=='function')return await fn();
  window.cpRecordPibe=function(action,message,options={}){
    if(String(action||'')===ACTION){
      const opts={...(options||{})};
      opts.level=Math.max(3,Number(opts.level)||0);
      return originalRecord.call(this,action,message,opts);
    }
    return originalRecord.call(this,action,message,options);
  };
  try{return await fn();}
  finally{window.cpRecordPibe=originalRecord;}
}
function originalAdjournment(){
  if(typeof window.__cpBeta64OriginalMarkAdjourned==='function')return window.__cpBeta64OriginalMarkAdjourned;
  const fn=window.cpBeta44?.markSelectedAdjourned;
  if(typeof fn==='function'&&fn!==markSelectedAdjourned){
    window.__cpBeta64OriginalMarkAdjourned=fn;
    return fn;
  }
  return null;
}
async function markSelectedAdjourned(...args){
  const original=originalAdjournment();
  if(typeof original!=='function')return false;
  const proceed=await level3Gate();
  if(!proceed)return false;
  await withLevel3AdjournmentRecord(()=>original.apply(this,args));
  return true;
}
function patchAdjournmentEntryPoint(){
  const api=window.cpBeta44;
  if(api&&typeof api.markSelectedAdjourned==='function'&&api.markSelectedAdjourned!==markSelectedAdjourned){
    if(typeof window.__cpBeta64OriginalMarkAdjourned!=='function')window.__cpBeta64OriginalMarkAdjourned=api.markSelectedAdjourned;
    api.markSelectedAdjourned=markSelectedAdjourned;
  }
  const button=document.getElementById?.('cpAdjournedResultBtn');
  if(button)button.onclick=markSelectedAdjourned;
}
function install(){
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){ }
  try{const ver=document.getElementById('appVersion');if(ver)ver.textContent=`v${VERSION}`;}catch(_){ }
  patchAdjournmentEntryPoint();
}
window.cpBeta64={VERSION,ACTION,fideModeActive,level3Gate,withLevel3AdjournmentRecord,markSelectedAdjourned,patchAdjournmentEntryPoint,install};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
