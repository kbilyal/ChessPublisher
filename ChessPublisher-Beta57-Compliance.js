/* Chess-Publisher v1.06.00-beta.57 — Official Rating / Tournament Rating Separation */
(()=>{
'use strict';
const VERSION='1.06.00-beta.57';
const MAX_RATING=4000;
let installed=false;

function n(value){
  const num=Number(value);
  if(!Number.isFinite(num)) return 0;
  return Math.max(0,Math.min(MAX_RATING,Math.trunc(num)));
}
function hasOwn(obj,key){return !!obj&&Object.prototype.hasOwnProperty.call(obj,key);}
function currentTournament(){try{return typeof getCurrentTournament==='function'?getCurrentTournament():null;}catch(_){return null;}}
function officialRatingForReporting(player){
  if(!player) return 0;
  return hasOwn(player,'officialRating')?n(player.officialRating):n(player.rating);
}
function provenance(player){
  try{return window.cpBeta52?.ensure?.(player)||player?.ratingProvenance||null;}catch(_){return player?.ratingProvenance||null;}
}
function syncTournamentProvenance(player){
  if(!player||typeof player!=='object') return null;
  const prov=provenance(player)||{};
  const current=n(player.rating);
  const existing=(prov.tournament&&typeof prov.tournament==='object')?prov.tournament:{};
  prov.version=Math.max(2,Number(prov.version)||0);
  prov.tournament={
    ...existing,
    currentValue:current,
    role:'tournament-operations',
    sourcePolicy:String(currentTournament()?.settings?.initialRatingSource||existing.sourcePolicy||'fide'),
    synchronizedWithOfficial:current===officialRatingForReporting(player)
  };
  player.ratingProvenance=prov;
  return prov.tournament;
}
function migratePlayer(player){
  if(!player||typeof player!=='object') return player;
  const prov=provenance(player)||{};
  const fide=prov.fide&&typeof prov.fide==='object'?prov.fide:null;
  let official;
  if(hasOwn(player,'officialRating')) official=n(player.officialRating);
  else if(fide?.sourceKnown && fide.sourceValue!==null && fide.sourceValue!==undefined) official=n(fide.sourceValue);
  else if(fide?.entryMethod==='official-list' && fide.currentValue!==undefined) official=n(fide.currentValue);
  else official=n(player.rating);
  player.officialRating=official;
  if(fide){
    fide.currentValue=official;
    if(fide.sourceKnown && fide.sourceValue!==null && fide.sourceValue!==undefined){
      fide.manualOverride=official!==n(fide.sourceValue);
    }
  }
  prov.version=Math.max(2,Number(prov.version)||0);
  player.ratingProvenance=prov;
  syncTournamentProvenance(player);
  return player;
}
function migrateTournament(tournament){
  for(const player of tournament?.players||[]) migratePlayer(player);
  return tournament;
}
function assignOfficialRating(player,value,{sourceType='',reason='official-update',manual=false}={}){
  if(!player||typeof player!=='object') return 0;
  migratePlayer(player);
  const next=n(value);
  player.officialRating=next;
  const prov=provenance(player)||{};
  const rec=prov.fide&&typeof prov.fide==='object'?prov.fide:(prov.fide={history:[]});
  if(manual){
    rec.currentValue=next;
    rec.manualOverride=true;
    rec.modifiedAt=new Date().toISOString();
    if(!rec.sourceKnown){
      rec.sourceList=null;
      rec.sourceValue=null;
      rec.entryMethod=next>0?'manual':'none';
    }
  }else{
    // Reuse beta.52 provenance bookkeeping without touching Tournament Rating.
    try{window.cpBeta57.__originalAssignOfficial?.(player,sourceType,next,reason);}catch(_){
      rec.currentValue=next;
      rec.sourceValue=next;
      rec.entryMethod='official-list';
      rec.sourceKnown=!!sourceType;
      rec.manualOverride=false;
    }
    player.officialRating=next;
    const refreshed=player.ratingProvenance?.fide;
    if(refreshed){refreshed.currentValue=next;refreshed.manualOverride=false;}
  }
  const finalProv=(player.ratingProvenance&&typeof player.ratingProvenance==='object')?player.ratingProvenance:prov;
  finalProv.version=Math.max(2,Number(finalProv.version)||0);
  player.ratingProvenance=finalProv;
  syncTournamentProvenance(player);
  return next;
}
function captureOfficialManualEdit(player,beforeValue,newValue){
  migratePlayer(player);
  const before=n(beforeValue),next=n(newValue);
  if(before===next){player.officialRating=next;return false;}
  const prov=provenance(player)||{};
  const rec=prov.fide&&typeof prov.fide==='object'?prov.fide:(prov.fide={history:[]});
  rec.history=Array.isArray(rec.history)?rec.history:[];
  rec.history.push({
    action:'manual-official-rating-edit',
    value:before,
    sourceList:rec.sourceList??null,
    sourceValue:rec.sourceValue??null,
    manualOverride:!!rec.manualOverride,
    at:new Date().toISOString()
  });
  if(rec.history.length>30) rec.history=rec.history.slice(-30);
  player.officialRating=next;
  rec.currentValue=next;
  rec.manualOverride=true;
  rec.modifiedAt=new Date().toISOString();
  if(!rec.sourceKnown){rec.sourceList=null;rec.sourceValue=null;rec.entryMethod=next>0?'manual':'none';}
  prov.version=Math.max(2,Number(prov.version)||0);
  player.ratingProvenance=prov;
  syncTournamentProvenance(player);
  return true;
}
function sourceSummary(player){
  migratePlayer(player);
  const prov=player?.ratingProvenance||{};
  const rec=prov.fide||{};
  const source=rec.sourceKnown&&rec.sourceList
    ? `${rec.sourceList}${rec.sourceValue!==null&&rec.sourceValue!==undefined?` (${n(rec.sourceValue)})`:''}${rec.manualOverride?' · edited manually':''}`
    : (rec.entryMethod==='manual'?'Manual / no source':'Source not available');
  return `Official: ${officialRatingForReporting(player)} · ${source}  |  Tournament: ${n(player?.rating)} · operations`;
}
function wrapBeta52(){
  const api=window.cpBeta52;
  if(!api||api.__cpBeta57Wrapped) return false;
  const originalEnsureImported=api.ensureImported;
  const originalInitializeManual=api.initializeManualPlayer;
  const originalInitializeOfficial=api.initializeOfficialPlayer;
  const originalAssignOfficial=api.assignOfficialFideRating;
  const originalCaptureManual=api.captureManualEdit;
  window.cpBeta57.__originalAssignOfficial=typeof originalAssignOfficial==='function'?originalAssignOfficial.bind(api):null;

  if(typeof originalEnsureImported==='function') api.ensureImported=function(player){const result=originalEnsureImported.apply(this,arguments);migratePlayer(player);return result;};
  if(typeof originalInitializeManual==='function') api.initializeManualPlayer=function(player){const result=originalInitializeManual.apply(this,arguments);migratePlayer(player);return result;};
  if(typeof originalInitializeOfficial==='function') api.initializeOfficialPlayer=function(player,type){const result=originalInitializeOfficial.apply(this,arguments);player.officialRating=n(player.rating);syncTournamentProvenance(player);return result;};
  if(typeof originalAssignOfficial==='function') api.assignOfficialFideRating=function(player,type,value,reason){return assignOfficialRating(player,value,{sourceType:type,reason:reason||'official-update',manual:false});};
  if(typeof originalCaptureManual==='function') api.captureManualEdit=function(player,before){const result=originalCaptureManual.apply(this,arguments);migratePlayer(player);syncTournamentProvenance(player);return result;};
  api.__cpBeta57Wrapped=true;
  return true;
}
function replaceLabelText(label,text){
  if(!label) return;
  const input=label.querySelector?.('input');
  if(input){
    for(const node of [...label.childNodes]) if(node.nodeType===3) node.remove();
    label.appendChild(document.createTextNode(` ${text}`));
  }else label.textContent=text;
}
function installEditUi(){
  if(typeof document==='undefined') return false;
  const tournamentInput=document.getElementById('editPlayerRating');
  if(!tournamentInput) return false;
  const tournamentLabel=tournamentInput.previousElementSibling;
  if(tournamentLabel?.tagName==='LABEL') tournamentLabel.textContent='Tournament Rating (operations)';
  if(!document.getElementById('editPlayerOfficialRating')){
    const label=document.createElement('label');
    label.textContent='Official Rating (FIDE report)';
    const input=document.createElement('input');
    input.id='editPlayerOfficialRating';input.type='number';input.min='0';input.max=String(MAX_RATING);input.step='1';
    tournamentLabel?.parentNode?.insertBefore(label,tournamentLabel);
    tournamentLabel?.parentNode?.insertBefore(input,tournamentLabel);
  }
  const updateRating=document.getElementById('registeredFideFieldRating');
  if(updateRating?.parentElement) replaceLabelText(updateRating.parentElement,'Official Rating (FIDE report)');
  return true;
}
function wrapPlayerEditor(){
  if(typeof window.openEditPlayerModal==='function'&&!window.openEditPlayerModal.__cpBeta57Wrapped){
    const original=window.openEditPlayerModal;
    const wrapped=function(index){
      const result=original.apply(this,arguments);
      const player=currentTournament()?.players?.[index];
      if(player){migratePlayer(player);try{if(typeof setVal==='function')setVal('editPlayerOfficialRating',officialRatingForReporting(player));}catch(_){}}
      try{const el=document.getElementById('editPlayerRatingSources');if(el&&player)el.textContent=sourceSummary(player);}catch(_){ }
      return result;
    };
    wrapped.__cpBeta57Wrapped=true;wrapped.__cpBeta57Original=original;window.openEditPlayerModal=wrapped;
  }
}
function customEvaluateRegisteredFideUpdate(t,lookup,options,applyChanges){
  const bg=typeof getLanguage==='function'&&getLanguage()==='bg';
  const type=String(options?.type||'std');
  const typeLabel=type==='std'?'Standard':type==='rapid'?'Rapid':'Blitz';
  const kField=type==='std'?'stdK':type==='rapid'?'rapidK':'blitzK';
  const availableField=type+'Available';
  const changes=[];
  let matched=0,unchanged=0,noFideId=0,notFound=0,birthUnavailable=0,ratingUnavailable=0,kUnavailable=0;

  for(const p of t?.players||[]){
    migratePlayer(p);
    const fideId=String(p?.fideId||'').trim();
    if(!/^\d{5,15}$/.test(fideId)){noFideId++;continue;}
    const ref=lookup?.byId?.get?.(fideId);
    if(!ref){notFound++;continue;}
    matched++;
    const playerChanges=[];const assignments=[];
    const addChange=(field,oldValue,newValue,assign)=>{if(String(oldValue)===String(newValue))return;playerChanges.push(`${field}: ${oldValue===''?'-':oldValue} → ${newValue===''?'-':newValue}`);assignments.push(assign);};

    if(options?.name){const oldValue=String(p.name||'').trim(),newValue=String(ref.name||'').trim();if(newValue)addChange(bg?'Име':'Name',oldValue,newValue,()=>{p.name=newValue;});}
    if(options?.rating){
      const oldValue=officialRatingForReporting(p),newValue=n(ref[type]);
      const available=hasOwn(ref,availableField)?!!ref[availableField]:newValue>0;
      if(available||options?.setZero){
        addChange(bg?'Официален рейтинг':'Official Rating',oldValue,newValue,()=>assignOfficialRating(p,newValue,{sourceType:window.cpBeta53?.provenanceSource?.(type)||type,reason:'consistency-update'}));
      }else ratingUnavailable++;
    }
    if(options?.k){const oldValue=n(p.fideK),newValue=n(ref[kField]);if(newValue>0)addChange('K-Factor',oldValue,newValue,()=>{p.fideK=newValue;});else kUnavailable++;}
    if(options?.title){const oldValue=String(p.title||'').trim().toUpperCase(),newValue=String(ref.title||ref.wTitle||'').trim().toUpperCase();if(newValue)addChange(bg?'Титла':'Title',oldValue||'-',newValue,()=>{p.title=newValue;});}
    if(options?.fed){const oldValue=String(p.fed||'').trim().toUpperCase(),newValue=String(ref.fed||'').trim().toUpperCase();if(newValue&&newValue!=='FIDE')addChange('FED',oldValue||'-',newValue,()=>{p.fed=newValue;});}
    if(options?.birth){const oldValue=String(p.birth||'-').trim()||'-',newValue=String(ref.birth||'-').trim()||'-';if(/^(?:19\d{2}|20[0-3]\d)$/.test(newValue))addChange(bg?'Рожд.':'Birth',oldValue,newValue,()=>{p.birth=newValue;});else birthUnavailable++;}
    if(options?.sex){const normalize=typeof normalizePlayerGender==='function'?normalizePlayerGender:(v=>String(v||'').toLowerCase());const oldValue=normalize(p.gender),newValue=normalize(ref.gender);if(newValue)addChange(bg?'Пол':'Gender',oldValue||'-',newValue,()=>{p.gender=newValue;});}

    if(playerChanges.length){if(applyChanges)assignments.forEach(fn=>fn());changes.push({name:p.name,fideId,details:playerChanges});}else unchanged++;
    if(applyChanges&&options?.rating){p.officialRatingSource=type;p.officialRatingUpdatedAt=new Date().toISOString();}
    if(applyChanges) syncTournamentProvenance(p);
  }
  return {type,typeLabel,changes,matched,unchanged,noFideId,notFound,birthUnavailable,ratingUnavailable,kUnavailable};
}
function wrapConsistencyEvaluator(){
  if(typeof window.evaluateRegisteredFideUpdate!=='function') return false;
  if(window.evaluateRegisteredFideUpdate.__cpBeta57Wrapped) return true;
  const wrapped=function(t,lookup,options,applyChanges){return customEvaluateRegisteredFideUpdate(t,lookup,options,!!applyChanges);};
  wrapped.__cpBeta57Wrapped=true;wrapped.__cpBeta57Original=window.evaluateRegisteredFideUpdate;
  window.evaluateRegisteredFideUpdate=wrapped;
  return true;
}
function install(){
  if(installed) return;
  installed=true;
  try{for(const t of Object.values(window.data?.tournaments||{}))migrateTournament(t);}catch(_){ }
  wrapBeta52();installEditUi();wrapPlayerEditor();wrapConsistencyEvaluator();
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){ }
  try{const ver=document.getElementById('appVersion');if(ver)ver.textContent=`v${VERSION}`;}catch(_){ }
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }
}
window.cpBeta57={VERSION,MAX_RATING,n,officialRatingForReporting,migratePlayer,migrateTournament,assignOfficialRating,captureOfficialManualEdit,sourceSummary,syncTournamentProvenance,customEvaluateRegisteredFideUpdate,wrapBeta52,installEditUi,wrapPlayerEditor,wrapConsistencyEvaluator,install,__originalAssignOfficial:null};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
