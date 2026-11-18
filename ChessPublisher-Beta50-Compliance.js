/* Chess-Publisher v1.06.00-beta.50 — TPN Exchange / Regeneration compliance */
(function(){
'use strict';
const VERSION='v1.06.00-beta.50';
function tournament(){ try{return getCurrentTournament();}catch(_){return null;} }
function engine(){ try{return getPairingEngineConfig();}catch(_){return tournament()?.pairings?.engine||{};} }
function latestRound(){ try{return Number(getLatestGeneratedRoundForTournament(tournament()))||0;}catch(_){try{return Number(getLatestGeneratedRound())||0;}catch(__){return 0;}} }
function deep(v){ try{return structuredClone(v);}catch(_){return JSON.parse(JSON.stringify(v));} }
function stableKey(player,index){ try{return playerKey(player,index);}catch(_){return String(player?.localKey||player?.fideId||player?.id||index);} }
function tournamentRating(player,t=tournament()){
  const source=t?.settings?.initialRatingSource||'fide';
  try{return Number(initialRankStrength(player,source))||0;}catch(_){
    const fide=Math.max(0,Number(player?.rating)||0), nat=Math.max(0,Number(player?.nationalRating)||0);
    if(source==='national')return nat;
    if(source==='national-fide')return nat||fide;
    if(source==='fide-national')return fide||nat;
    return fide;
  }
}
function titleOrder(player){
  const code=String(player?.title||'').toUpperCase();
  try{return Number(FIDE_INITIAL_TITLE_ORDER?.[code])||99;}catch(_){
    return ({GM:1,IM:2,WGM:3,FM:4,WIM:5,CM:6,WFM:7,WCM:8})[code]||99;
  }
}
function activePlayers(t=tournament()){
  const list=t?.players||[];
  return list.map((player,index)=>({player,index,key:stableKey(player,index)})).filter(row=>{
    try{return !isPlayerRegistrationDeleted(row.player);}catch(_){return !row.player?.registrationDeleted;}
  });
}
function selectedRows(){
  const t=tournament(); if(!t)return [];
  let indexes=[];
  try{indexes=[...selectedPlayerIndexes];}catch(_){indexes=[];}
  return indexes.map(index=>({player:t.players?.[index],index,key:stableKey(t.players?.[index],index)})).filter(r=>r.player&&!r.player.registrationDeleted);
}
function exchangeEligibility(rows=selectedRows(),t=tournament()){
  if(!t)return {ok:false,reason:'No tournament is open.'};
  try{if(isRoundRobinTournament(t))return {ok:false,reason:'TPN Exchange is available for Swiss tournaments.'};}catch(_){}
  const latest=latestRound();
  if(latest>=4)return {ok:false,reason:'TPN Exchange is not available after Round 4 has been paired.'};
  if(rows.length<2)return {ok:false,reason:'Select at least two players for TPN Exchange.'};
  let workflow=null;try{workflow=getRegistrationWorkflowState(t);}catch(_){}
  if(workflow?.needsResort)return {ok:false,reason:'Complete Resort Starting List before TPN Exchange.'};
  if(typeof hasCompleteTournamentPairingNumbers==='function'&&!hasCompleteTournamentPairingNumbers(t.players||[]))return {ok:false,reason:'Starting Rank / TPN must be complete before TPN Exchange.'};
  const ratings=rows.map(r=>tournamentRating(r.player,t));
  if(!ratings.every(v=>v===ratings[0]))return {ok:false,reason:'TPN Exchange is allowed only among players with the same Tournament Rating (including all-unrated groups).'};
  return {ok:true,rows,latest,rating:ratings[0]};
}
function proposedMap(rows,assignments){
  const map=new Map();
  rows.forEach((row,i)=>map.set(row.key,Number(assignments[i])));
  return map;
}
function validateAssignments(rows,assignments){
  const current=rows.map(r=>Number(r.player?.pairingNumber));
  const next=assignments.map(Number);
  if(next.some(n=>!Number.isInteger(n)||n<1))return {ok:false,reason:'Every TPN must be a positive integer.'};
  if(new Set(next).size!==next.length)return {ok:false,reason:'Each selected TPN must be used exactly once.'};
  const a=[...current].sort((x,y)=>x-y),b=[...next].sort((x,y)=>x-y);
  if(a.length!==b.length||a.some((n,i)=>n!==b[i]))return {ok:false,reason:'TPN Exchange may only permute the TPNs currently held by the selected players.'};
  return {ok:true,current,next,changed:rows.filter((r,i)=>current[i]!==next[i])};
}
function proposedNumber(row,map){return map.has(row.key)?map.get(row.key):Number(row.player?.pairingNumber)||0;}
function seedingViolation(rows,assignments,t=tournament()){
  const selected=proposedMap(rows,assignments);
  const all=activePlayers(t).map(row=>({...row,no:proposedNumber(row,selected),rating:tournamentRating(row.player,t),title:titleOrder(row.player)})).sort((a,b)=>a.no-b.no);
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
    const a=all[i],b=all[j];
    if(a.rating<b.rating)return {violates:true,reason:'Tournament Rating order'};
    if(a.rating===b.rating && a.title>b.title)return {violates:true,reason:'FIDE-title order'};
  }
  return {violates:false,reason:''};
}
async function persist(){
  try{saveData();}catch(_){}
  try{return await writePersistentState(false,true);}catch(_){return true;}
}
async function performExchange(rows,assignments){
  const t=tournament();
  const elig=exchangeEligibility(rows,t);if(!elig.ok){try{await appAlert(elig.reason,'TPN Exchange','warning');}catch(_){}return false;}
  const checked=validateAssignments(rows,assignments);if(!checked.ok){try{await appAlert(checked.reason,'TPN Exchange','warning');}catch(_){}return false;}
  if(!checked.changed.length)return true;
  const violation=seedingViolation(rows,assignments,t);
  const changes=rows.filter((r,i)=>Number(r.player.pairingNumber)!==Number(assignments[i])).map((r,i)=>`${r.player.name}: ${r.player.pairingNumber}→${assignments[i]}`);
  let message=`TPN Exchange will change ${checked.changed.length} player(s):\n${changes.join('\n')}`;
  if(violation.violates)message+=`\n\nThe proposed exchange also changes the standard ${violation.reason} required by FIDE C.04.2 Articles 2.2.1–2.2.2.`;
  let ok=true;
  try{
    if(typeof cpFideModeActive==='function'&&cpFideModeActive())ok=await cpFideWarning(3,message,{title:'FIDE Mode — TPN Exchange',category:'PIBE'});
    else ok=await appConfirm(`${message}\n\nContinue?`,'TPN Exchange','warning');
  }catch(_){ok=false;}
  if(!ok)return false;
  let tx=null;try{if(typeof cpBeginCriticalMutationCheckpoint==='function')tx=await cpBeginCriticalMutationCheckpoint('TPN Exchange');}catch(_){return false;}
  if(typeof cpBeginCriticalMutationCheckpoint==='function'&&!tx)return false;
  try{
    rows.forEach((r,i)=>{r.player.pairingNumber=Number(assignments[i]);});
    if(typeof hasCompleteTournamentPairingNumbers==='function'&&!hasCompleteTournamentPairingNumbers(t.players||[]))throw new Error('TPN Exchange did not preserve a complete consecutive TPN list.');
    if(typeof validateStableHistoryReferences==='function')validateStableHistoryReferences(t);
    const round=latestRound();
    if(typeof cpRecordPibe==='function')cpRecordPibe('TPN Exchange',`Round ${round||0}: ${changes.join('; ')}${violation.violates?`; seeding warning: ${violation.reason}.`:'.'}`,{level:3,round});
    const e=engine();e.lastTpnExchangeAt=new Date().toISOString();e.lastTpnExchangeRound=round;
    saveData();
    if(tx&&typeof cpCommitCriticalMutationCheckpoint==='function'){if(!await cpCommitCriticalMutationCheckpoint(tx))return false;}else if(!await persist())throw new Error('TPN Exchange could not be saved.');
  }catch(err){
    try{if(tx&&typeof cpRestoreCriticalMutationCheckpoint==='function')await cpRestoreCriticalMutationCheckpoint(tx,{showAlert:false,reason:'tpn-exchange'});}catch(_){}
    try{await appAlert(`TPN Exchange was cancelled and the previous tournament state was restored.\n\n${err?.message||String(err)}`,'TPN Exchange','error');}catch(_){}
    return false;
  }
  try{renderRegistered();updateRegistrationWorkflowUI();updateGacruxPanel();}catch(_){}
  try{setStatus(`TPN Exchange completed for ${checked.changed.length} player(s).`);}catch(_){}
  return true;
}
function closeModal(){const m=document.getElementById('cpTpnExchangeModal');if(m)m.remove();}
async function saveModal(){
  const rows=selectedRows();
  const selects=[...document.querySelectorAll('#cpTpnExchangeModal select[data-key]')];
  const byKey=new Map(selects.map(s=>[s.dataset.key,Number(s.value)]));
  const assignments=rows.map(r=>byKey.get(r.key));
  if(await performExchange(rows,assignments))closeModal();
}
async function openExchange(){
  const rows=selectedRows();const elig=exchangeEligibility(rows);if(!elig.ok){await appAlert(elig.reason,'TPN Exchange','warning');return;}
  closeModal();
  rows.sort((a,b)=>Number(a.player.pairingNumber)-Number(b.player.pairingNumber));
  const values=rows.map(r=>Number(r.player.pairingNumber)).sort((a,b)=>a-b);
  const modal=document.createElement('div');modal.id='cpTpnExchangeModal';modal.className='modal';modal.style.display='flex';
  modal.innerHTML=`<div class="modal-card" style="max-width:620px"><div class="modal-head"><strong>TPN Exchange</strong><button type="button" id="cpTpnExchangeClose">×</button></div><div class="modal-body"><table style="width:100%"><thead><tr><th>Player</th><th>Rating</th><th>TPN</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${typeof escapeHtml==='function'?escapeHtml(r.player.name):String(r.player.name||'')}</td><td>${tournamentRating(r.player)}</td><td><select data-key="${r.key}">${values.map(n=>`<option value="${n}" ${n===Number(r.player.pairingNumber)?'selected':''}>${n}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div><div class="modal-actions"><button type="button" id="cpTpnExchangeCancel">Cancel</button><button type="button" class="primary" id="cpTpnExchangeSave">Apply Exchange</button></div></div>`;
  document.body.appendChild(modal);
  document.getElementById('cpTpnExchangeClose').onclick=closeModal;
  document.getElementById('cpTpnExchangeCancel').onclick=closeModal;
  document.getElementById('cpTpnExchangeSave').onclick=saveModal;
}
function tpnSnapshot(t=tournament()){
  return new Map(activePlayers(t).map(r=>[r.key,Number(r.player.pairingNumber)||0]));
}
function previewRegeneration(t=tournament()){
  if(!t||typeof assignFideInitialPairingNumbers!=='function')return [];
  const before=tpnSnapshot(t), clone=deep(t);
  assignFideInitialPairingNumbers(clone);
  const after=new Map(activePlayers(clone).map(r=>[r.key,Number(r.player.pairingNumber)||0]));
  const changes=[];for(const [key,oldNo] of before){const newNo=after.get(key);if(Number(newNo)!==Number(oldNo))changes.push({key,oldNo,newNo});}
  for(const [key,newNo] of after){if(!before.has(key))changes.push({key,oldNo:0,newNo});}
  return changes;
}
const originalResort=typeof resortStartingList==='function'?resortStartingList:null;
if(originalResort){
  window.resortStartingList=async function(...args){
    const t=tournament(),e=engine(),latest=latestRound();
    let workflow=null;try{workflow=getRegistrationWorkflowState(t);}catch(_){}
    const allowed=latest===0 || !!workflow?.needsLateResort || !!workflow?.needsRankCorrectionResort;
    const changes=allowed?previewRegeneration(t):[];
    const priorGeneration=latest>0 || !!e.tpnGenerationRecorded || !!e.firstRoundRegistrationSyncedSignature;
    let warned=false;
    if(priorGeneration&&changes.length>=2){
      const summary=changes.slice(0,12).map(c=>`${c.oldNo||'—'}→${c.newNo}`).join(', ')+(changes.length>12?' …':'');
      let ok=true;try{if(typeof cpFideModeActive==='function'&&cpFideModeActive())ok=await cpFideWarning(3,`TPN Regeneration will change ${changes.length} Tournament Pairing Numbers (${summary}).`,{title:'FIDE Mode — TPN Regeneration',category:'PIBE'});else ok=await appConfirm(`TPN Regeneration will change ${changes.length} Tournament Pairing Numbers (${summary}).\n\nContinue?`,'TPN Regeneration','warning');}catch(_){ok=false;}
      if(!ok)return false;warned=true;
    }
    const before=tpnSnapshot(t);
    const result=await originalResort.apply(this,args);
    const after=tpnSnapshot(t);
    const actual=[];for(const [key,oldNo] of before){const newNo=after.get(key);if(Number(newNo)!==Number(oldNo))actual.push({key,oldNo,newNo});}for(const [key,newNo] of after){if(!before.has(key))actual.push({key,oldNo:0,newNo});}
    if(actual.length){
      e.tpnGenerationRecorded=true;e.lastTpnRegenerationAt=new Date().toISOString();e.lastTpnRegenerationRound=latest;
      if(actual.length>=2&&typeof cpRecordPibe==='function')cpRecordPibe('TPN Regeneration',`Round ${latest||0}: TPN regeneration changed ${actual.length} player numbers${warned?' after Level-3 confirmation':''}.`,{level:3,round:latest});
      await persist();
    }
    return result;
  };
}
function installUi(){
  const resort=document.getElementById('resortStartingListBtn');
  if(resort&&!document.getElementById('cpTpnExchangeBtn')){
    const btn=document.createElement('button');btn.id='cpTpnExchangeBtn';btn.type='button';btn.textContent='TPN Exchange';btn.title='Exchange TPNs among selected Swiss players with the same Tournament Rating.';btn.onclick=openExchange;resort.insertAdjacentElement('afterend',btn);
  }
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,VERSION);}catch(_){}
  const ver=document.getElementById('appVersion');if(ver)ver.textContent=VERSION;
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installUi,{once:true});else installUi();
  setTimeout(installUi,0);
}
window.cpBeta50={VERSION,tournamentRating,exchangeEligibility,validateAssignments,seedingViolation,performExchange,previewRegeneration};
})();
