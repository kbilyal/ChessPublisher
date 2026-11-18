/* Chess-Publisher v1.06.00-beta.68 — C.04.2:4.3 Previous-Round Correction Window */
(()=>{
'use strict';
const VERSION='1.06.00-beta.68';
const RULE='FIDE C.04.2 4.3';
let session=null;

function tournament(){try{return window.getCurrentTournament?.()||null;}catch(_){return null;}}
function identity(t=tournament()){
  if(!t)return '';
  return String(t.internalId||t.cloudTournamentId||window.data?.currentTournament||t.name||'');
}
function latestRound(){try{return Math.max(0,Number(window.getLatestGeneratedRound?.())||0);}catch(_){return 0;}}
function selectedRound(){try{return Math.max(1,Number(window.getSelectedPairingRoundNumber?.())||1);}catch(_){return 1;}}
function roundComplete(round){try{return !!window.isPairingRoundComplete?.(round);}catch(_){return false;}}
function isRoundRobin(){try{return !!window.isRoundRobinFormat?.();}catch(_){return false;}}
function windowState(){
  const t=tournament(),latest=latestRound();
  if(!t)return {eligible:false,reason:'no-tournament',latest:0,previous:0};
  if(isRoundRobin())return {eligible:false,reason:'round-robin',latest,previous:Math.max(0,latest-1)};
  if(latest<2)return {eligible:false,reason:'no-preceding-round',latest,previous:Math.max(0,latest-1)};
  const previous=latest-1,complete=roundComplete(latest);
  if(complete)return {eligible:false,reason:'next-round-ended',latest,previous};
  return {eligible:true,reason:'before-end-of-next-round',latest,previous};
}
function sessionActive(){
  if(!session)return false;
  const s=windowState();
  if(!s.eligible||session.tournamentId!==identity()||session.previous!==s.previous||session.latest!==s.latest){session=null;return false;}
  return true;
}
function activeForSelected(){return sessionActive()&&selectedRound()===session.previous;}
function level3WarningMessage(s){
  return `${RULE} correction window: Round ${s.previous} may be corrected because Round ${s.latest} has been paired but has not ended. The existing Round ${s.latest} pairing will not be changed. Corrected data will affect standings and the next pairing to be done.`;
}
async function correctionGate(s){
  const message=level3WarningMessage(s);
  try{
    if(typeof window.cpFideWarning==='function')return !!(await window.cpFideWarning(3,message,{title:'Previous Round Correction',category:'ROUND CORRECTION'}));
    if(typeof window.appConfirm==='function')return !!(await window.appConfirm(`${message}\n\nContinue?`,'Previous Round Correction'));
  }catch(_){return false;}
  return false;
}
function setDisplayedRound(round){
  const t=tournament();if(!t)return false;
  try{
    if(typeof window.setVal==='function')window.setVal('pairingsRound',String(round));
    else{const el=document.getElementById?.('pairingsRound');if(el)el.value=String(round);}
  }catch(_){ }
  t.pairings=t.pairings||{};t.pairings.round=String(round);
  try{window.saveData?.();}catch(_){ }
  try{window.pairingsRoundChanged?.();}catch(_){
    try{window.renderLivePairings?.(true);window.updateRoundHistoryEditState?.();}catch(__){ }
  }
  return true;
}
async function startPreviousRoundCorrection(){
  const s=windowState();
  if(!s.eligible){
    const msg=s.reason==='next-round-ended'
      ? `The C.04.2:4.3 live correction window has closed because Round ${s.latest} has ended. Do not rewrite tournament history; use the rating-report correction workflow when the rule requires rating-submission-only data.`
      : 'The immediately preceding round is not currently eligible for the C.04.2:4.3 correction window.';
    try{await window.appAlert?.(msg,'Previous Round Correction','info');}catch(_){ }
    return false;
  }
  if(!(await correctionGate(s)))return false;
  session={tournamentId:identity(),previous:s.previous,latest:s.latest,openedAt:new Date().toISOString()};
  setDisplayedRound(s.previous);
  refreshUi();
  return true;
}
function endPreviousRoundCorrection({returnLatest=false}={}){
  const latest=session?.latest||latestRound();session=null;
  if(returnLatest&&latest>0)setDisplayedRound(latest);else refreshUi();
  return true;
}
function mutationMeta(kind,before,after){
  if(!activeForSelected()||before===after)return false;
  const t=tournament(),s=windowState();if(!t||!s.eligible)return false;
  const engine=t.pairings?.engine||(t.pairings.engine={});
  engine.lastC042Correction={
    rule:RULE,round:s.previous,nextRoundAlreadyPaired:s.latest,
    affectsPairingFromRound:s.latest+1,kind:String(kind||'correction'),
    correctedAt:new Date().toISOString()
  };
  try{window.cpLogComplianceEvent?.({type:'C04.2-4.3-CORRECTION',category:'ROUND CORRECTION',level:3,round:s.previous,message:`${RULE}: ${kind} corrected in Round ${s.previous} while Round ${s.latest} was paired but unfinished. Round ${s.latest} pairing was retained; correction affects the next pairing to be done.`,trf:false});}catch(_){ }
  try{window.saveData?.();}catch(_){ }
  return true;
}
function selectedBoardSnapshot(){
  try{
    const boards=window.getLivePairingBoards?.()||[];
    return JSON.stringify((Array.isArray(boards)?boards:[]).map((b,i)=>({whiteKey:b?.whiteKey||'',blackKey:b?.blackKey||'',result:b?.result||'-',board:b?.board||i+1})));
  }catch(_){return '';}
}
function installEditWindow(){
  if(typeof window.isSelectedRoundEditable==='function'&&!window.__cpBeta68OriginalIsSelectedRoundEditable){
    window.__cpBeta68OriginalIsSelectedRoundEditable=window.isSelectedRoundEditable;
    window.isSelectedRoundEditable=function(){return !!window.__cpBeta68OriginalIsSelectedRoundEditable.apply(this,arguments)||activeForSelected();};
  }
  if(typeof window.ensureSelectedRoundEditable==='function'&&!window.__cpBeta68OriginalEnsureSelectedRoundEditable){
    window.__cpBeta68OriginalEnsureSelectedRoundEditable=window.ensureSelectedRoundEditable;
    window.ensureSelectedRoundEditable=function(...args){if(activeForSelected())return true;return window.__cpBeta68OriginalEnsureSelectedRoundEditable.apply(this,args);};
  }
  if(typeof window.applyResultToSelectedBoard==='function'&&!window.__cpBeta68OriginalApplyResult){
    window.__cpBeta68OriginalApplyResult=window.applyResultToSelectedBoard;
    window.applyResultToSelectedBoard=function(...args){const active=activeForSelected(),before=active?selectedBoardSnapshot():'';const out=window.__cpBeta68OriginalApplyResult.apply(this,args);const after=active?selectedBoardSnapshot():'';if(active)mutationMeta('result',before,after);refreshUi();return out;};
  }
  if(typeof window.swapSelectedBoardColors==='function'&&!window.__cpBeta68OriginalSwapColors){
    window.__cpBeta68OriginalSwapColors=window.swapSelectedBoardColors;
    window.swapSelectedBoardColors=async function(...args){const active=activeForSelected(),before=active?selectedBoardSnapshot():'';const out=await window.__cpBeta68OriginalSwapColors.apply(this,args);const after=active?selectedBoardSnapshot():'';if(active)mutationMeta('colour assignment',before,after);refreshUi();return out;};
  }
  if(typeof window.updateRoundHistoryEditState==='function'&&!window.__cpBeta68OriginalUpdateRoundHistoryEditState){
    window.__cpBeta68OriginalUpdateRoundHistoryEditState=window.updateRoundHistoryEditState;
    window.updateRoundHistoryEditState=function(...args){const out=window.__cpBeta68OriginalUpdateRoundHistoryEditState.apply(this,args);refreshUi({skipOriginal:true});return out;};
  }
  if(typeof window.pairingsRoundChanged==='function'&&!window.__cpBeta68OriginalPairingsRoundChanged){
    window.__cpBeta68OriginalPairingsRoundChanged=window.pairingsRoundChanged;
    window.pairingsRoundChanged=function(...args){const out=window.__cpBeta68OriginalPairingsRoundChanged.apply(this,args);refreshUi();return out;};
  }
}
function ensureButton(){
  if(typeof document==='undefined')return null;
  let b=document.getElementById?.('cpBeta68PreviousRoundCorrectionBtn');
  if(b)return b;
  const badge=document.getElementById?.('roundEditState');if(!badge||!badge.parentNode)return null;
  b=document.createElement('button');b.id='cpBeta68PreviousRoundCorrectionBtn';b.type='button';b.className='';b.hidden=true;b.textContent='Correct Previous Round';b.title=`Open the limited ${RULE} correction window for the immediately preceding round.`;
  b.onclick=()=>{if(sessionActive())endPreviousRoundCorrection({returnLatest:true});else startPreviousRoundCorrection();};
  badge.insertAdjacentElement?.('afterend',b);
  return b;
}
function refreshUi({skipOriginal=false}={}){
  const s=windowState();sessionActive();
  const b=ensureButton();
  if(b){
    b.hidden=!s.eligible&&!session;
    b.textContent=sessionActive()?'Exit Previous-Round Correction':'Correct Previous Round';
    b.title=sessionActive()?`Exit ${RULE} correction mode and return to the latest round.`:`Open the limited ${RULE} correction window for Round ${s.previous}.`;
  }
  const badge=document.getElementById?.('roundEditState');
  if(badge&&activeForSelected()){
    badge.textContent=`Round ${s.previous} • CORRECTION WINDOW`;
    badge.style.color='#8a4b00';
  }
  if(!skipOriginal&&typeof window.__cpBeta68OriginalUpdateRoundHistoryEditState==='function'){
    try{window.__cpBeta68OriginalUpdateRoundHistoryEditState();}catch(_){ }
    if(badge&&activeForSelected()){badge.textContent=`Round ${s.previous} • CORRECTION WINDOW`;badge.style.color='#8a4b00';}
  }
  return s;
}
function install(){
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){ }
  try{const ver=document.getElementById('appVersion');if(ver)ver.textContent=`v${VERSION}`;}catch(_){ }
  installEditWindow();ensureButton();refreshUi();
}
window.cpBeta68={VERSION,RULE,identity,latestRound,selectedRound,roundComplete,isRoundRobin,windowState,sessionActive,activeForSelected,level3WarningMessage,correctionGate,setDisplayedRound,startPreviousRoundCorrection,endPreviousRoundCorrection,mutationMeta,selectedBoardSnapshot,installEditWindow,ensureButton,refreshUi,install};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
