(function(){
'use strict';
const VERSION='1.06.00-beta.52';
const now=()=>new Date().toISOString();
const n=v=>Math.max(0,Number(v)||0);
const listName=type=>({std:'FIDE Standard',rapid:'FIDE Rapid',blitz:'FIDE Blitz'}[String(type||'').toLowerCase()]||'');
function copy(v){try{return JSON.parse(JSON.stringify(v));}catch(_){return v;}}
function historyPush(rec,entry){
  rec.history=Array.isArray(rec.history)?rec.history:[];
  rec.history.push({...entry,at:entry?.at||now()});
  if(rec.history.length>30)rec.history=rec.history.slice(-30);
}
function record(base,value,defaults={}){
  const hadBase=!!(base&&typeof base==='object');
  const rec=hadBase?copy(base):{};
  rec.sourceList=rec.sourceList===undefined?(defaults.sourceList??null):rec.sourceList;
  rec.sourceValue=rec.sourceValue===undefined?(defaults.sourceValue??null):rec.sourceValue;
  if(!hadBase || rec.currentValue===undefined) rec.currentValue=n(value);
  rec.entryMethod=String(rec.entryMethod||defaults.entryMethod||'unknown');
  rec.manualOverride=!!(rec.manualOverride||defaults.manualOverride);
  rec.sourceKnown=rec.sourceKnown===undefined?!!rec.sourceList:!!rec.sourceKnown;
  rec.history=Array.isArray(rec.history)?rec.history:[];
  return rec;
}
function inferFide(p){
  const type=String(p?.ratingSource||'').toLowerCase();
  const official=listName(type);
  if(official)return {sourceList:official,sourceValue:n(p.rating),entryMethod:'official-list',sourceKnown:true};
  const source=String(p?.source||p?.origin||'').toLowerCase();
  if(source.includes('manual')||String(p?.fideId||'-')==='-')return {sourceList:null,sourceValue:null,entryMethod:'manual',sourceKnown:false,manualOverride:true};
  if(n(p?.rating)>0)return {sourceList:null,sourceValue:null,entryMethod:'imported-unknown',sourceKnown:false};
  return {sourceList:null,sourceValue:null,entryMethod:'none',sourceKnown:false};
}
function ensure(p){
  if(!p||typeof p!=='object')return null;
  const existing=(p.ratingProvenance&&typeof p.ratingProvenance==='object')?p.ratingProvenance:{};
  const fi=inferFide(p);
  const nationalDefaults=n(p.nationalRating)>0
    ? {sourceList:null,sourceValue:null,entryMethod:'imported-unknown',sourceKnown:false}
    : {sourceList:null,sourceValue:null,entryMethod:'none',sourceKnown:false};
  const manualDefaults={sourceList:null,sourceValue:null,entryMethod:n(p.tournamentManualRating)>0?'manual':'none',sourceKnown:false,manualOverride:n(p.tournamentManualRating)>0};
  const prov={
    version:1,
    fide:record(existing.fide,p.rating,fi),
    national:record(existing.national,p.nationalRating,nationalDefaults),
    manualTournament:record(existing.manualTournament,p.tournamentManualRating,manualDefaults)
  };
  // Manual Tournament Rating never has an external source list by definition.
  prov.manualTournament.sourceList=null;
  prov.manualTournament.sourceValue=null;
  prov.manualTournament.sourceKnown=false;
  if(n(p.tournamentManualRating)>0)prov.manualTournament.entryMethod='manual';
  p.ratingProvenance=prov;
  return prov;
}
function initializeManualPlayer(p){
  const prov=ensure(p); if(!prov)return p;
  prov.fide=record(null,p.rating,{sourceList:null,sourceValue:null,entryMethod:n(p.rating)>0?'manual':'none',sourceKnown:false,manualOverride:n(p.rating)>0});
  prov.national=record(null,p.nationalRating,{sourceList:null,sourceValue:null,entryMethod:n(p.nationalRating)>0?'manual':'none',sourceKnown:false,manualOverride:n(p.nationalRating)>0});
  prov.manualTournament=record(null,p.tournamentManualRating,{sourceList:null,sourceValue:null,entryMethod:n(p.tournamentManualRating)>0?'manual':'none',sourceKnown:false,manualOverride:n(p.tournamentManualRating)>0});
  p.ratingProvenance=prov;
  return p;
}
function initializeOfficialPlayer(p,type){
  ensure(p); assignOfficialFideRating(p,type,p.rating,'add-player'); return p;
}
function assignOfficialFideRating(p,type,value,reason='official-update'){
  const prov=ensure(p); if(!prov)return;
  const rec=prov.fide; const source=listName(type)||String(type||'').trim()||null;
  if(rec.currentValue!==n(value)||rec.sourceList!==source){
    historyPush(rec,{action:reason,value:rec.currentValue,sourceList:rec.sourceList,sourceValue:rec.sourceValue,manualOverride:rec.manualOverride});
  }
  rec.sourceList=source; rec.sourceValue=n(value); rec.currentValue=n(value); rec.entryMethod='official-list'; rec.sourceKnown=!!source; rec.manualOverride=false; rec.assignedAt=now();
  p.ratingProvenance=prov;
}
function assignNationalImport(p,value,fed,reason='nrs-import'){
  const prov=ensure(p); if(!prov)return;
  const rec=prov.national; const source=`NRS:${String(fed||p?.fed||'XXX').trim().toUpperCase()}`;
  if(rec.currentValue!==n(value)||rec.sourceList!==source){historyPush(rec,{action:reason,value:rec.currentValue,sourceList:rec.sourceList,sourceValue:rec.sourceValue,manualOverride:rec.manualOverride});}
  rec.sourceList=source; rec.sourceValue=n(value); rec.currentValue=n(value); rec.entryMethod='rating-list'; rec.sourceKnown=true; rec.manualOverride=false; rec.assignedAt=now();
  p.ratingProvenance=prov;
}
function manualChange(rec,newValue,kind){
  const old=rec.currentValue;
  if(old===n(newValue))return;
  historyPush(rec,{action:'manual-edit',kind,value:old,sourceList:rec.sourceList,sourceValue:rec.sourceValue,manualOverride:rec.manualOverride});
  rec.currentValue=n(newValue);
  rec.manualOverride=true;
  // Preserve a known source list/source value forever. If there never was one,
  // the absence of a source is explicit and retained as a manual value.
  if(!rec.sourceKnown){rec.sourceList=null;rec.sourceValue=null;rec.entryMethod=n(newValue)>0?'manual':'none';}
  rec.modifiedAt=now();
}
function captureManualEdit(p,before={}){
  const prov=ensure(p); if(!prov)return;
  if(n(before.rating)!==n(p.rating))manualChange(prov.fide,p.rating,'fide');
  if(n(before.nationalRating)!==n(p.nationalRating))manualChange(prov.national,p.nationalRating,'national');
  if(n(before.tournamentManualRating)!==n(p.tournamentManualRating)){
    manualChange(prov.manualTournament,p.tournamentManualRating,'manual-tournament');
    prov.manualTournament.sourceList=null;prov.manualTournament.sourceValue=null;prov.manualTournament.sourceKnown=false;
    prov.manualTournament.entryMethod=n(p.tournamentManualRating)>0?'manual':'none';
  }
  p.ratingProvenance=prov;
}
function ensureImported(p){
  ensure(p);
  return p;
}
function sourceText(rec,label){
  if(!rec)return `${label}: —`;
  if(rec.sourceKnown&&rec.sourceList){
    const suffix=rec.manualOverride?' · edited manually':'';
    return `${label}: ${rec.sourceList}${rec.sourceValue!==null&&rec.sourceValue!==undefined?` (${rec.sourceValue})`:''}${suffix}`;
  }
  if(rec.entryMethod==='manual')return `${label}: Manual / no source`;
  if(rec.entryMethod==='none')return `${label}: —`;
  return `${label}: Source not available`;
}
function summary(p){
  const prov=ensure(p);
  return [sourceText(prov?.fide,'FIDE'),sourceText(prov?.national,'National'),sourceText(prov?.manualTournament,'Tournament')].join('  |  ');
}
function renderEditSourcesForPlayer(p){
  try{const el=document.getElementById('editPlayerRatingSources');if(el&&p)el.textContent=summary(p);}catch(_){ }
}
function migrateTournament(t){for(const p of t?.players||[])ensure(p);return t;}
function install(){
  try{for(const t of Object.values(window.data?.tournaments||{}))migrateTournament(t);}catch(_){ }
  document.documentElement.dataset.chesspublisherVersion=VERSION;
}
window.cpBeta52={VERSION,ensure,ensureImported,initializeManualPlayer,initializeOfficialPlayer,assignOfficialFideRating,assignNationalImport,captureManualEdit,summary,migrateTournament,renderEditSourcesForPlayer};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
