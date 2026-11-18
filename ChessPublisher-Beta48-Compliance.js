/* Chess-Publisher v1.06.00-beta.48 — HPB / bye compliance.
   Additive UI/compliance layer; protected pairing/TRF/tie-break core is unchanged. */
(function(){
'use strict';
const BETA='1.06.00-beta.48';
const current=()=>{try{return getCurrentTournament();}catch(_){return null;}};
const playerByKey=key=>{try{return getPlayerByStableKey(key);}catch(_){return null;}};
function eligible(player){return !player || player.hpbEligible!==false;}
function ensureDefaults(t=current()){
  let changed=false;
  for(const p of (t?.players||[])) if(typeof p.hpbEligible!=='boolean'){p.hpbEligible=true;changed=true;}
  return changed;
}
const originalNormalize=window.normalizeData;
if(typeof originalNormalize==='function') window.normalizeData=function(...args){const r=originalNormalize.apply(this,args);ensureDefaults();return r;};
function injectEditor(){
  const modal=document.getElementById('editPlayerModal'); if(!modal||document.getElementById('editPlayerHpbEligible'))return;
  const grid=modal.querySelector('.form-grid')||modal.querySelector('.modal-grid'); if(!grid)return;
  const pairingLabel=[...grid.querySelectorAll('label')].find(x=>String(x.textContent||'').trim()==='Pairing Status');
  const label=document.createElement('label');label.id='editPlayerHpbEligibleLabel';label.textContent='Half-point bye';
  const box=document.createElement('label');box.id='editPlayerHpbEligibleBox';box.style.cssText='display:flex;align-items:center;gap:7px;min-height:30px';
  box.innerHTML='<input id="editPlayerHpbEligible" type="checkbox" checked> Eligible';
  grid.insertBefore(label,pairingLabel||null);grid.insertBefore(box,pairingLabel||null);
}
const originalOpen=window.openEditPlayerModal;
if(typeof originalOpen==='function')window.openEditPlayerModal=function(index){injectEditor();const r=originalOpen.apply(this,arguments);try{const p=current()?.players?.[index];const cb=document.getElementById('editPlayerHpbEligible');if(cb)cb.checked=eligible(p);}catch(_){}return r;};
function clearFutureHalfByes(key,fromRound){
  const e=typeof getPairingEngineConfig==='function'?getPairingEngineConfig():null;if(!e)return [];
  const cleared=[];
  for(const [rs,row] of Object.entries(e.manualByes||{})){const r=Number(rs);if(r>=fromRound&&row?.[key]==='H'){delete row[key];cleared.push(r);}}
  return cleared.sort((a,b)=>a-b);
}
const originalSaveEdited=window.saveEditedPlayer;
if(typeof originalSaveEdited==='function')window.saveEditedPlayer=async function(){
  const idx=typeof editingPlayerIndex==='number'?editingPlayerIndex:null;
  const p=idx!==null?current()?.players?.[idx]:null;
  const key=p&&typeof playerKey==='function'?playerKey(p,idx):'';
  const desired=document.getElementById('editPlayerHpbEligible')?.checked!==false;
  const before=eligible(p);
  const r=await originalSaveEdited.apply(this,arguments);
  if(p && editingPlayerIndex===null){
    p.hpbEligible=desired;
    let cleared=[];
    if(before && !desired && key){const next=typeof getNextPairingRound==='function'?getNextPairingRound():1;cleared=clearFutureHalfByes(key,next);}
    try{saveData();await Promise.resolve(writePersistentState(false));}catch(_){}
    if(cleared.length) setStatus(`Player saved. Future ½ BYE schedule cleared: R${cleared.join(', R')}.`);
  }
  return r;
};
const originalConfigure=window.configurePlayerBye;
if(typeof originalConfigure==='function')window.configurePlayerBye=function(key,type){
  if(type==='H'&&!eligible(playerByKey(key))){try{appAlert('This player is marked as ineligible for a half-point bye.','Half-point bye','warning');}catch(_){}return false;}
  return originalConfigure.apply(this,arguments);
};
function selectedModalRounds(){return new Set([...document.querySelectorAll('#byeRoundChecks .bye-round-checkbox:checked')].map(x=>Number(x.value)).filter(Number.isInteger));}
function existingByeRounds(key,type){try{return new Set(getPlayerByeRounds(key,type).map(x=>Number(x.round)));}catch(_){return new Set();}}
const originalSaveBye=window.saveByeRoundsModal;
if(typeof originalSaveBye==='function')window.saveByeRoundsModal=async function(){
  const key=String(byeModalPlayerKey||''),type=String(byeModalType||'');
  if(type==='H'&&!eligible(playerByKey(key))){await appAlert('This player is marked as ineligible for a half-point bye.','Half-point bye','warning');return false;}
  const selected=selectedModalRounds(),old=existingByeRounds(key,type);
  const added=[...selected].filter(r=>!old.has(r)).sort((a,b)=>a-b);
  if(type==='F'&&added.length){
    let ok=false;try{ok=await cpFideWarning(2,`A full-point bye is exceptional/deprecated for FIDE tournament administration. You are assigning 1 BYE in ${added.map(r=>'Round '+r).join(', ')}. Verify that this is intentional.`,{title:'Full-point bye',category:'BYE'});}catch(_){ok=false;}
    if(!ok)return false;
  }
  const r=await originalSaveBye.apply(this,arguments);
  if(type==='F'&&added.length){
    const player=playerByKey(key);const name=String(player?.name||key);
    const now=existingByeRounds(key,'F');
    for(const round of added){if(!now.has(round))continue;try{cpLogComplianceEvent({type:'FULL_POINT_BYE',category:'BYE',level:2,round,message:`Full-point bye assigned to ${name} in Round ${round}.`,trf:true});}catch(_){}}
    try{saveData();await Promise.resolve(writePersistentState(false));}catch(_){}
  }
  return r;
};
function setVersion(){document.documentElement.dataset.chesspublisherVersion=BETA;document.title=`Chess-Publisher v${BETA}`;const w=document.getElementById('windowDocumentTitle');if(w)w.textContent=`Chess-Publisher v${BETA} — Tournament Manager & Publisher`;}
function install(){ensureDefaults();injectEditor();setVersion();window.cpBeta48={version:BETA,eligible,ensureDefaults,clearFutureHalfByes,selectedModalRounds,existingByeRounds};}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
