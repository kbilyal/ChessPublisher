/* Chess-Publisher v1.06.00-beta.98-r11 — Late Entry UX visibility point-fix
   UX only. Frozen r9/r10 player lifecycle and pairing semantics remain authoritative.
   No pairing, TRF, BBP, tie-break, Chess-Results, SYNC or rating calculation core changes. */
(()=>{
'use strict';
const VERSION='1.06.00-beta.98-r11';
let installed=false,managerObserver=null;
const originals={};
function currentTournament(){try{return window.getCurrentTournament?.()||null;}catch(_){return null;}}
function isRoundRobin(t=currentTournament()){try{return !!window.isRoundRobinTournament?.(t);}catch(_){return false;}}
function latestRound(t=currentTournament()){try{return Number(window.getLatestGeneratedRoundForTournament?.(t)??window.getLatestGeneratedRound?.()??0)||0;}catch(_){return 0;}}
function lateContext(){const t=currentTournament(),latest=latestRound(t);return {t,latest,active:!!t&&!isRoundRobin(t)&&latest>0,joinRound:latest+1};}
function manualAddButton(){return document.getElementById('manualAddPlayerBtn')||document.querySelector('#registration .groupbox button[onclick="addManualPlayer()"]');}
function ensureBar(){
  const btn=document.getElementById('setLateEntryBtn');if(!btn)return null;
  let bar=document.getElementById('cpR11LateEntryBar');
  if(!bar){
    bar=document.createElement('div');bar.id='cpR11LateEntryBar';bar.className='cp-r11-late-entry-bar';
    bar.innerHTML='<div class="cp-r11-late-entry-copy"><b>Late Entry</b><span id="cpR11LateEntryHint">Available after the first Swiss round is generated.</span></div><div id="cpR11LateEntryAction"></div>';
    const row=btn.closest('.player-action-row');
    if(row)row.insertAdjacentElement('afterend',bar);else document.getElementById('registration')?.appendChild(bar);
  }
  const action=bar.querySelector('#cpR11LateEntryAction');if(action&&btn.parentElement!==action)action.appendChild(btn);
  btn.classList.add('cp-r11-late-entry-btn');
  return bar;
}
function selectedLateState(){try{return window.getSelectedLateEntryState?.()||{ok:false,reason:'Select exactly one player.'};}catch(err){return {ok:false,reason:String(err?.message||err)};}}
function updateModalButton(){
  const btn=document.getElementById('ratingModalAddButton');if(!btn)return;
  const c=lateContext();
  btn.textContent=c.active?'Add Late Entry':'Add Player';
  btn.title=c.active?`Add this player as Late Entry from Round ${c.joinRound}. Existing rounds remain unchanged.`:'Add this player to the tournament.';
}
function updateManagerButtons(){
  const c=lateContext();
  document.querySelectorAll('#cpR10RatingListManager button[data-r10-add]').forEach(btn=>{
    btn.textContent=c.active?'Add Late Entry':'Add Player';
    btn.title=c.active?`Add as Late Entry from Round ${c.joinRound}.`:'Add player to tournament.';
  });
}
function refreshLateEntryUi(){
  const bar=ensureBar(),c=lateContext(),manual=manualAddButton();
  if(manual){manual.textContent=c.active?'Add Late Entry':'Add Player';manual.title=c.active?`Tournament already started. This player will join from Round ${c.joinRound} as Late Entry.`:'Add player to the starting roster.';}
  if(bar){bar.style.display=c.active?'flex':'none';}
  const btn=document.getElementById('setLateEntryBtn'),hint=document.getElementById('cpR11LateEntryHint');
  if(c.active&&btn){
    const s=selectedLateState();
    if(s.already){btn.disabled=true;btn.textContent=`Late Entry R${s.joinRound} ✓`;if(hint)hint.textContent=`${s.player?.name||'Selected player'} already joins from Round ${s.joinRound}.`;}
    else if(s.ok){btn.disabled=false;btn.textContent=`Mark selected · Round ${s.joinRound}`;if(hint)hint.textContent=`${s.player?.name||'Selected player'} has never appeared in a generated pairing and can join from Round ${s.joinRound}.`;}
    else{btn.disabled=true;btn.textContent='Mark selected as Late Entry';if(hint)hint.textContent=s.reason||`Select one never-paired player to admit from Round ${c.joinRound}.`;}
  }
  updateModalButton();updateManagerButtons();
  return c;
}
function selectNewLatePlayer(before){
  const t=currentTournament();if(!t||t.players?.length<=before)return;
  const idx=t.players.length-1,p=t.players[idx];
  let join=1;try{join=Number(window.getPlayerJoinRound?.(p)||p?.joinedFromRound||1)||1;}catch(_){join=Number(p?.joinedFromRound||1)||1;}
  if(join<=1)return;
  try{selectedPlayerIndexes.clear();selectedPlayerIndexes.add(idx);lastClickedSortedIndex=null;window.renderRegistered?.();}catch(_){}
}
function wrapAsyncAdd(name){
  const fn=window[name];if(typeof fn!=='function'||fn.__cpR11LateWrapped)return false;
  originals[name]=fn;
  const wrapped=async function(){const before=currentTournament()?.players?.length||0;const r=await fn.apply(this,arguments);selectNewLatePlayer(before);refreshLateEntryUi();return r;};
  wrapped.__cpR11LateWrapped=true;wrapped.__cpR11Original=fn;window[name]=wrapped;return true;
}
function wrapOpenRating(){
  const fn=window.openRatingModal;if(typeof fn!=='function'||fn.__cpR11LateWrapped)return false;
  originals.openRatingModal=fn;
  const wrapped=function(){const r=fn.apply(this,arguments);updateModalButton();return r;};
  wrapped.__cpR11LateWrapped=true;wrapped.__cpR11Original=fn;window.openRatingModal=wrapped;return true;
}
function wrapRefresh(name){
  const fn=window[name];if(typeof fn!=='function'||fn.__cpR11UiWrapped)return;
  const wrapped=function(){const r=fn.apply(this,arguments);setTimeout(refreshLateEntryUi,0);return r;};
  wrapped.__cpR11UiWrapped=true;wrapped.__cpR11Original=fn;window[name]=wrapped;
}
function observeManager(){
  if(managerObserver)return;
  managerObserver=new MutationObserver(()=>updateManagerButtons());
  managerObserver.observe(document.body,{childList:true,subtree:true});
}
function installStyles(){if(document.getElementById('cp-r11-late-entry-style'))return;const s=document.createElement('style');s.id='cp-r11-late-entry-style';s.textContent=`
#registration .cp-r11-late-entry-bar{display:none;align-items:center;justify-content:space-between;gap:12px;margin:0 0 7px;padding:7px 9px;border:1px solid #d8c27b;border-radius:6px;background:#fff9e8;min-width:0}
#registration .cp-r11-late-entry-copy{display:flex;align-items:center;gap:9px;min-width:0;color:#5f4b14}
#registration .cp-r11-late-entry-copy b{white-space:nowrap;color:#604600}
#registration #cpR11LateEntryHint{font-size:11px;line-height:1.25;overflow:hidden;text-overflow:ellipsis}
#registration #cpR11LateEntryAction{flex:0 0 auto}
#registration .cp-r11-late-entry-btn{min-width:178px!important;height:30px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;font-weight:650!important;white-space:nowrap!important}
#registration .cp-r11-late-entry-btn:not(:disabled){background:#fff!important;border-color:#bc941f!important;color:#654d00!important}
#registration .cp-r11-late-entry-btn:disabled{opacity:.72!important}
#manualAddPlayerBtn.cp-r11-auto-late{font-weight:650!important}
@media(max-width:820px){#registration .cp-r11-late-entry-bar{align-items:stretch;flex-direction:column}#registration #cpR11LateEntryAction{width:100%}#registration .cp-r11-late-entry-btn{width:100%!important}}
`;document.head.appendChild(s);}
function applyVersion(){try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){}try{document.title=`Chess-Publisher v${VERSION}`;}catch(_){}try{const w=document.getElementById('windowDocumentTitle');if(w)w.textContent=`Chess-Publisher v${VERSION} — Tournament Manager & Publisher`;}catch(_){}try{const v=document.getElementById('appVersion');if(v)v.textContent=`v${VERSION}`;}catch(_){} }
function install(){
  if(installed)return true;installed=true;installStyles();ensureBar();wrapAsyncAdd('addManualPlayer');wrapAsyncAdd('confirmRatingSelection');wrapOpenRating();
  ['renderRegistered','updateRegistrationWorkflowUI','loadAllFields','changeTournament','renderLivePairings','populatePairingsRoundMenu'].forEach(wrapRefresh);
  observeManager();refreshLateEntryUi();applyVersion();
  setTimeout(()=>{ensureBar();wrapAsyncAdd('addManualPlayer');wrapAsyncAdd('confirmRatingSelection');wrapOpenRating();refreshLateEntryUi();applyVersion();},0);
  setTimeout(()=>{refreshLateEntryUi();applyVersion();},250);
  return true;
}
window.cpBeta98R11={VERSION,lateContext,ensureBar,refreshLateEntryUi,updateModalButton,install};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
