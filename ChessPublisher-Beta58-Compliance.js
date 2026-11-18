/* Chess-Publisher v1.06.00-beta.58 — Effective Rapid / Effective Blitz Rating Lists */
(()=>{
'use strict';
const VERSION='1.06.00-beta.58';
const TYPES=['std','rapid','blitz'];
const LABELS={std:'FIDE Standard',rapid:'FIDE Rapid',blitz:'FIDE Blitz'};
let installed=false;
function n(v){const x=Number(v);return Number.isFinite(x)?Math.max(0,Math.trunc(x)):0;}
function validType(type){type=String(type||'std').toLowerCase();return TYPES.includes(type)?type:'std';}
function effectiveRatingForPlayer(player,type){
  type=validType(type);
  const raw=n(player?.[type]);
  const standard=n(player?.std);
  if(type==='std') return {requestedType:'std',rating:raw,rawRating:raw,standardRating:standard,sourceType:'std',fallback:false,available:raw>0};
  if(raw>0) return {requestedType:type,rating:raw,rawRating:raw,standardRating:standard,sourceType:type,fallback:false,available:true};
  if(standard>0) return {requestedType:type,rating:standard,rawRating:0,standardRating:standard,sourceType:'std',fallback:true,available:true};
  return {requestedType:type,rating:0,rawRating:0,standardRating:0,sourceType:type,fallback:false,available:false};
}
function displayValue(player,type){
  const e=effectiveRatingForPlayer(player,type);
  if(!e.available) return '0';
  return e.fallback?`${e.rating} (Standard)`:String(e.rating);
}
function managedListEntry(player,type){
  const e=effectiveRatingForPlayer(player,type);
  return {
    fideId:String(player?.fideId||'').trim(),name:String(player?.name||'').trim(),requestedType:e.requestedType,
    rating:e.rating,rawRating:e.rawRating,standardRating:e.standardRating,sourceType:e.sourceType,
    sourceLabel:LABELS[e.sourceType]||e.sourceType,fallback:e.fallback,available:e.available
  };
}
function managedList(players,type){return (players||[]).map(p=>managedListEntry(p,type));}
function annotateReference(ref,type,standardRating){
  if(!ref||typeof ref!=='object') return ref;
  type=validType(type);
  const raw=n(ref[type]);
  if(type!=='std' && standardRating!==undefined) ref.std=n(standardRating);
  const e=effectiveRatingForPlayer(ref,type);
  ref[`${type}Raw`]=raw;
  ref[`${type}Effective`]=e.rating;
  ref[`${type}EffectiveSource`]=e.sourceType;
  ref[`${type}Fallback`]=e.fallback;
  ref[`${type}Available`]=e.available;
  // The lookup object is transient. Expose the managed effective value through
  // the selected rating field so existing consistency/reporting logic consumes
  // the effective list without mutating the maintained raw FIDE caches.
  ref[type]=e.rating;
  return ref;
}
async function applyEffectiveLookup(lookup,type,periodKey,ids){
  type=validType(type);
  if(!lookup?.byId || !(lookup.byId instanceof Map)) return lookup;
  if(type==='std'){
    for(const ref of lookup.byId.values()) annotateReference(ref,'std');
    lookup.effectiveRatingList={type:'std',periodKey:String(periodKey||''),fallbackList:null};
    return lookup;
  }
  if(!window.cpBeta53?.loadRatings) throw new Error('FIDE Standard list loader is unavailable for Effective Rapid/Blitz ratings.');
  const standard=await window.cpBeta53.loadRatings('std',String(periodKey||''),ids||[...lookup.byId.keys()]);
  for(const [id,ref] of lookup.byId.entries()) annotateReference(ref,type,standard.ratings.get(String(id))||0);
  lookup.effectiveRatingList={type,periodKey:String(periodKey||''),fallbackList:'std',standardSourceUrl:String(standard.sourceUrl||''),standardSourceKind:String(standard.from||'')};
  return lookup;
}
function annotateOfficialPlayer(player,effective,periodKey=''){
  if(!player||typeof player!=='object') return player;
  const e=effective&&typeof effective==='object'?effective:effectiveRatingForPlayer(player,player.ratingSource||'std');
  player.effectiveRatingRequestedType=e.requestedType;
  player.effectiveRatingSource=e.sourceType;
  player.effectiveRatingFallback=!!e.fallback;
  player.effectiveRatingPeriodKey=String(periodKey||'');
  player.officialRatingSource=e.sourceType;
  if(window.cpBeta57?.assignOfficialRating){
    window.cpBeta57.assignOfficialRating(player,e.rating,{sourceType:e.sourceType,reason:e.fallback?'effective-rating-standard-fallback':'effective-rating-selection'});
  }else player.officialRating=e.rating;
  const prov=player.ratingProvenance?.fide;
  if(prov&&typeof prov==='object'){
    prov.effectiveRequestedList=e.requestedType;
    prov.effectiveSourceList=e.sourceType;
    prov.effectiveFallback=!!e.fallback;
    prov.effectivePeriodKey=String(periodKey||'');
  }
  return player;
}
function wrapDateEffectiveRatings(){
  const api=window.cpBeta53;
  if(!api||typeof api.applyDateEffectiveRatings!=='function'||api.applyDateEffectiveRatings.__cpBeta58Wrapped) return false;
  const original=api.applyDateEffectiveRatings.bind(api);
  const wrapped=async function(t,lookup,options,ids,checkDate){
    const out=await original(t,lookup,options,ids,checkDate);
    if(!options?.rating) return out;
    const type=validType(options.type||'std');
    const periodKey=String(out?.ratingPeriodKey||api.lastContext?.periodKey||'');
    return applyEffectiveLookup(out,type,periodKey,ids);
  };
  wrapped.__cpBeta58Wrapped=true;wrapped.__cpBeta58Original=original;api.applyDateEffectiveRatings=wrapped;return true;
}
function wrapConsistencyEvaluator(){
  if(typeof window.evaluateRegisteredFideUpdate!=='function'||window.evaluateRegisteredFideUpdate.__cpBeta58Wrapped) return false;
  const original=window.evaluateRegisteredFideUpdate;
  const wrapped=function(t,lookup,options,applyChanges){
    const result=original.apply(this,arguments);
    if(applyChanges&&options?.rating){
      const type=validType(options.type||'std');
      const periodKey=String(lookup?.ratingPeriodKey||window.cpBeta53?.lastContext?.periodKey||'');
      for(const p of t?.players||[]){
        const id=String(p?.fideId||'').trim(),ref=lookup?.byId?.get?.(id);if(!ref)continue;
        const e={requestedType:type,rating:n(ref[type]),rawRating:n(ref[`${type}Raw`]??ref[type]),standardRating:n(ref.std),sourceType:String(ref[`${type}EffectiveSource`]||type),fallback:!!ref[`${type}Fallback`],available:!!ref[`${type}Available`]};
        if(e.available||options.setZero) annotateOfficialPlayer(p,e,periodKey);
      }
    }
    return result;
  };
  wrapped.__cpBeta58Wrapped=true;wrapped.__cpBeta58Original=original;window.evaluateRegisteredFideUpdate=wrapped;return true;
}
function install(){
  if(installed)return;installed=true;
  wrapDateEffectiveRatings();wrapConsistencyEvaluator();
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){}
  try{const ver=document.getElementById('appVersion');if(ver)ver.textContent=`v${VERSION}`;}catch(_){}
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){}
}
window.cpBeta58={VERSION,TYPES,LABELS,n,validType,effectiveRatingForPlayer,displayValue,managedListEntry,managedList,annotateReference,applyEffectiveLookup,annotateOfficialPlayer,wrapDateEffectiveRatings,wrapConsistencyEvaluator,install};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
