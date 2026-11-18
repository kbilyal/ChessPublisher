/* Chess-Publisher v1.06.00-beta.54 — Requested Consistency Freshness Verification */
(()=>{
'use strict';
const VERSION='1.06.00-beta.54';
let lastVerification=null;
function validType(type){
  type=String(type||'').toLowerCase();
  if(!['std','rapid','blitz'].includes(type)) throw new Error(`Unsupported FIDE rating list type: ${type||'-'}.`);
  return type;
}
function nowIso(){return new Date().toISOString();}
function metaFor(type){
  type=validType(type);
  return (typeof fideCacheMeta!=='undefined'?fideCacheMeta:null)?.lists?.[type]||null;
}
function currentPeriod(){
  if(typeof currentFidePeriodKey==='function') return String(currentFidePeriodKey()||'');
  const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function recentlyVerified(meta,maxAgeMs=15*60*1000){
  const ms=Date.parse(String(meta?.updatedAt||''));
  return Number.isFinite(ms) && (Date.now()-ms)>=0 && (Date.now()-ms)<=maxAgeMs;
}
function setVerificationUi(text){
  const el=document.getElementById('registeredFideEffectivePeriod');
  if(el&&text) el.textContent=String(text);
}
async function verifyBeforeRequestedConsistency(t,options,ids,checkDate=new Date()){
  if(!options?.rating){
    lastVerification={required:false,verifiedAt:nowIso(),reason:'rating field not selected'};
    return lastVerification;
  }
  if(!window.cpBeta53) throw new Error('Date-effective rating-list verification is unavailable.');
  const type=validType(options.type||'std');
  const target=window.cpBeta53.consistencyTarget(t,checkDate);
  const label=window.cpBeta53.periodLabel(target.periodKey);

  if(target.periodKey===currentPeriod()){
    setVerificationUi(`Consistency list: ${label} · verifying current FIDE lists…`);
    if(typeof updateFideDatabaseNow!=='function') throw new Error('FIDE rating-list refresh is unavailable.');
    const ok=await updateFideDatabaseNow({manual:false,reason:'consistency-check'});
    if(!ok) throw new Error(`The current FIDE rating lists could not be verified before the consistency check.`);
    const meta=metaFor(type);
    if(String(meta?.periodKey||'')!==target.periodKey){
      throw new Error(`The verified FIDE ${type} list does not match the required ${label} period.`);
    }
    if(!recentlyVerified(meta)){
      throw new Error(`The FIDE ${type} list freshness timestamp could not be verified.`);
    }
    lastVerification={required:true,type,periodKey:target.periodKey,reason:target.reason,mode:'current-server-check',verifiedAt:nowIso(),source:String(meta?.source||'')};
  }else{
    setVerificationUi(`Consistency list: ${label} · verifying historical FIDE list…`);
    const loaded=await window.cpBeta53.loadRatings(type,target.periodKey,ids);
    if(!(loaded?.ratings instanceof Map)) throw new Error(`The required historical FIDE ${type} list could not be verified.`);
    lastVerification={required:true,type,periodKey:target.periodKey,reason:target.reason,mode:loaded.from||'historical-list',verifiedAt:nowIso(),source:String(loaded.sourceUrl||'')};
  }

  setVerificationUi(`Consistency list: ${label} · ${target.reason} · verified`);
  return lastVerification;
}
function install(){
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }
}
window.cpBeta54={VERSION,metaFor,currentPeriod,recentlyVerified,verifyBeforeRequestedConsistency,get lastVerification(){return lastVerification;}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
