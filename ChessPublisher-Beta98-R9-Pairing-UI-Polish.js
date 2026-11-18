/* Chess-Publisher v1.06.00-beta.98-r9 — Pairing UI polish + visible Baku acceleration
   UI/runtime orchestration only. Protected Swiss Dutch/Gacrux/TRF/BBP/Tie-Break/
   Chess-Results/SYNC algorithms are not modified. */
(()=>{
'use strict';
const VERSION='1.06.00-beta.98-r9';
let installed=false,pairingBusy=false,busyTimer=0,busyStarted=0;
const disabledSnapshot=new Map();

function currentTournament(){try{return window.getCurrentTournament?.()||null;}catch(_){return null;}}
function latestRound(){try{return Number(window.getLatestGeneratedRound?.()||0)||0;}catch(_){return 0;}}
function isRoundRobin(){try{return !!window.isRoundRobinFormat?.();}catch(_){const t=currentTournament();return /round robin|berger/i.test(String(t?.settings?.pairingSystem||''));}}
function accelerationValue(){const t=currentTournament();return String(t?.settings?.accelerationMethod||'NONE').toUpperCase()==='BAKU'?'BAKU':'NONE';}
function persistUiSetting(){try{window.saveData?.();}catch(_){}try{const p=window.writePersistentState?.(false,true);if(p&&typeof p.catch==='function')p.catch(()=>{});}catch(_){} }

function ensureAccelerationControl(){
  const pairing=document.getElementById('pairingSystem');
  if(!pairing)return false;
  let wrapper=document.getElementById('cpR9PairingSystemWrap');
  if(!wrapper){
    wrapper=document.createElement('div');wrapper.id='cpR9PairingSystemWrap';wrapper.className='cp-r9-pairing-system-wrap';
    pairing.parentNode.insertBefore(wrapper,pairing);wrapper.appendChild(pairing);
  }else if(pairing.parentNode!==wrapper){wrapper.insertBefore(pairing,wrapper.firstChild||null);}

  const oldLabel=document.getElementById('cpAccelerationLabel');
  if(oldLabel)oldLabel.remove();
  let select=document.getElementById('cpAccelerationMethod');
  if(!select){
    select=document.createElement('select');select.id='cpAccelerationMethod';
    select.innerHTML='<option value="NONE">None</option><option value="BAKU">Baku</option>';
  }
  let mini=document.getElementById('cpR9AccelerationInline');
  if(!mini){
    mini=document.createElement('div');mini.id='cpR9AccelerationInline';mini.className='cp-r9-acceleration-inline';
    mini.innerHTML='<span class="cp-r9-accel-label">Acceleration</span><span id="cpR9AccelerationSelectSlot"></span><span id="cpR9AccelerationBadge" class="badge cp-r9-accel-badge">No acceleration</span>';
    wrapper.appendChild(mini);
  }
  const slot=document.getElementById('cpR9AccelerationSelectSlot');
  if(slot&&select.parentNode!==slot)slot.appendChild(select);
  select.title='Swiss acceleration method. Baku is available before Round 1 is generated.';
  select.onchange=async()=>{
    const t=currentTournament();if(!t)return;
    if(isRoundRobin()){
      t.settings=t.settings||{};t.settings.accelerationMethod='NONE';select.value='NONE';syncAccelerationUi();persistUiSetting();return;
    }
    if(latestRound()>0){
      select.value=accelerationValue();syncAccelerationUi();
      try{await window.appAlert?.('Acceleration is locked after Round 1 has been paired.','Acceleration','info');}catch(_){}
      return;
    }
    t.settings=t.settings||{};
    t.settings.accelerationMethod=select.value==='BAKU'?'BAKU':'NONE';
    t.pairings=t.pairings||{};t.pairings.engine=t.pairings.engine||{};t.pairings.engine.bakuGroupKeys=[];
    persistUiSetting();syncAccelerationUi();
    try{window.setStatus?.(t.settings.accelerationMethod==='BAKU'?'Baku acceleration enabled for this Swiss tournament.':'Swiss acceleration disabled.');}catch(_){}
  };
  syncAccelerationUi();
  return true;
}

function syncAccelerationUi(){
  const t=currentTournament(),pairing=document.getElementById('pairingSystem'),select=document.getElementById('cpAccelerationMethod'),badge=document.getElementById('cpR9AccelerationBadge');
  if(!select||!badge)return false;
  const rr=isRoundRobin();
  if(rr&&t){t.settings=t.settings||{};if(String(t.settings.accelerationMethod||'NONE').toUpperCase()!=='NONE')t.settings.accelerationMethod='NONE';}
  const value=rr?'NONE':accelerationValue();select.value=value;
  const locked=latestRound()>0;
  select.disabled=rr||locked;
  if(rr){badge.textContent='Not applicable';badge.className='badge cp-r9-accel-badge cp-r9-accel-na';}
  else if(value==='BAKU'){badge.textContent=locked?'BAKU · LOCKED':'BAKU ACTIVE';badge.className='badge cp-r9-accel-badge cp-r9-accel-on';}
  else{badge.textContent=locked?'None · locked':'No acceleration';badge.className='badge cp-r9-accel-badge';}
  if(pairing){pairing.title=value==='BAKU'?'FIDE Dutch System with Baku acceleration':'Pairing system';}
  return true;
}

function wrapUiRefresh(name){
  const original=window[name];if(typeof original!=='function'||original.__cpR9UiWrapped)return;
  const wrapped=function(){const r=original.apply(this,arguments);setTimeout(()=>{ensureAccelerationControl();syncAccelerationUi();},0);return r;};
  wrapped.__cpR9UiWrapped=true;wrapped.__cpR9Original=original;window[name]=wrapped;
}

function ensurePairingPalettePolish(){
  const actions=document.querySelector('#pairings .pairing-generate-actions');if(!actions)return false;
  if(!document.getElementById('cpR9PairingActionsHeading')){
    const h=document.createElement('div');h.id='cpR9PairingActionsHeading';h.className='result-palette-section result-palette-wide cp-r9-pairing-actions-title';h.textContent='Pairing actions';actions.insertAdjacentElement('beforebegin',h);
  }
  const resort=document.getElementById('pairingsResortStartingListBtn');
  if(resort){resort.classList.add('cp-r9-resort-button');resort.textContent='↕ Resort Starting List';resort.title='Recalculate Starting Rank No./TPN before generating the next pairing';}
  const generate=document.getElementById('btnGenerateGacrux');
  if(generate){generate.classList.add('cp-r9-generate-button');if(!pairingBusy)generate.textContent='Generate Pairings';}
  return true;
}

function pairingActionButtons(){return [...document.querySelectorAll('#pairings .result-palette button')];}
function setPairingBusyState(on,round=0){
  const button=document.getElementById('btnGenerateGacrux');if(!button)return;
  pairingBusy=!!on;
  if(on){
    busyStarted=performance.now();document.body.classList.add('cp-pairing-generating');
    button.classList.add('cp-pairing-busy');button.setAttribute('aria-busy','true');button.disabled=true;
    for(const b of pairingActionButtons()){if(!disabledSnapshot.has(b))disabledSnapshot.set(b,!!b.disabled);if(b!==button)b.disabled=true;}
    const update=()=>{const elapsed=Math.max(0,(performance.now()-busyStarted)/1000);button.textContent=`Generating${round?` Round ${round}`:''}… ${elapsed.toFixed(1)}s`;};
    update();clearInterval(busyTimer);busyTimer=setInterval(update,250);
  }else{
    clearInterval(busyTimer);busyTimer=0;document.body.classList.remove('cp-pairing-generating');
    button.classList.remove('cp-pairing-busy');button.removeAttribute('aria-busy');button.textContent='Generate Pairings';
    for(const [b,wasDisabled] of disabledSnapshot.entries()){try{b.disabled=wasDisabled;}catch(_){}}disabledSnapshot.clear();
    setTimeout(()=>{try{window.cpEnforceGenerateLock?.();}catch(_){}try{window.updateGacruxPanel?.();}catch(_){}},0);
  }
}
function nextRoundNumber(){try{const s=window.getPairingGenerationState?.();return Number(s?.next||0)||0;}catch(_){return 0;}}
function yieldForPaint(){return new Promise(resolve=>{requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,0)));});}

function installGenerateResponsiveness(){
  const original=window.generatePairingWithGacrux;if(typeof original!=='function'||original.__cpR9ResponsiveWrapped)return false;
  const wrapped=async function(){
    if(pairingBusy)return;
    const round=nextRoundNumber();
    setPairingBusyState(true,round);
    // Critical UX point: yield twice so the busy button/spinner is painted before
    // any synchronous pre-flight/TRF preparation begins. The pairing engine and
    // checker execution remain on the existing protected LocalEngine path.
    await yieldForPaint();
    try{return await original.apply(this,arguments);}finally{setPairingBusyState(false,round);}
  };
  wrapped.__cpR9ResponsiveWrapped=true;wrapped.__cpR9Original=original;window.generatePairingWithGacrux=wrapped;return true;
}

function installStyles(){
  if(document.getElementById('cp-r9-pairing-ui-style'))return;
  const s=document.createElement('style');s.id='cp-r9-pairing-ui-style';s.textContent=`
  .cp-r9-pairing-system-wrap{display:grid;grid-template-columns:minmax(220px,1fr) auto auto auto;gap:6px;align-items:center;width:100%;min-width:0}
  .cp-r9-pairing-system-wrap>#pairingSystem{width:100%!important;min-width:0!important}
  .cp-r9-acceleration-inline{display:contents}
  .cp-r9-accel-label{font-size:10px;color:#5f6368;font-weight:700;white-space:nowrap}
  #cpAccelerationMethod{width:92px!important;min-width:92px!important;height:27px!important}
  .cp-r9-accel-badge{white-space:nowrap;min-width:94px;text-align:center}
  .cp-r9-accel-on{background:#fff2cc!important;border-color:#d6a84d!important;color:#7a4a00!important;font-weight:800!important}
  .cp-r9-accel-na{color:#777!important;background:#f3f3f3!important}
  #pairings .swiss-workspace{grid-template-columns:minmax(0,1fr) 202px!important}
  #pairings .pairing-generate-actions{grid-template-columns:1fr!important;gap:6px!important}
  #pairings .pairing-generate-actions button{width:100%!important;min-width:0!important;white-space:normal!important;line-height:1.15!important}
  #pairings .cp-r9-resort-button{min-height:31px!important;background:#fff!important;border-color:#aeb8c2!important;color:#2c3e50!important;font-weight:600!important}
  #pairings .cp-r9-generate-button{position:relative;min-height:36px!important;font-weight:800!important;letter-spacing:.01em!important}
  #pairings .cp-r9-generate-button.cp-pairing-busy{padding-left:31px!important;cursor:progress!important;opacity:1!important;background:#e8f2fb!important;color:#174f78!important;border-color:#78a9cf!important}
  #pairings .cp-r9-generate-button.cp-pairing-busy::before{content:"";position:absolute;left:10px;top:50%;width:13px;height:13px;margin-top:-7px;border:2px solid rgba(23,79,120,.25);border-top-color:#174f78;border-radius:50%;animation:cpR9Spin .72s linear infinite}
  #pairings .cp-r9-pairing-actions-title{margin-top:1px!important}
  @keyframes cpR9Spin{to{transform:rotate(360deg)}}
  @media(max-width:1080px){.cp-r9-pairing-system-wrap{grid-template-columns:minmax(180px,1fr) auto 88px}.cp-r9-accel-badge{grid-column:1/-1;justify-self:end}.cp-r9-accel-label{font-size:9px}}
  `;document.head.appendChild(s);
}

function applyVersion(){
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){}
  try{document.title=`Chess-Publisher v${VERSION}`;}catch(_){}
  try{const w=document.getElementById('windowDocumentTitle');if(w)w.textContent=`Chess-Publisher v${VERSION} — Tournament Manager & Publisher`;}catch(_){}
  try{const v=document.getElementById('appVersion');if(v)v.textContent=`v${VERSION}`;}catch(_){}
}
function install(){
  if(installed)return true;installed=true;installStyles();ensureAccelerationControl();ensurePairingPalettePolish();installGenerateResponsiveness();
  ['loadAllFields','changeTournament','tournamentFormatChanged','pairingSystemChanged','updateTournamentFormatUI','refreshEverything','renderLivePairings'].forEach(wrapUiRefresh);
  syncAccelerationUi();applyVersion();setTimeout(()=>{ensureAccelerationControl();ensurePairingPalettePolish();syncAccelerationUi();applyVersion();},0);
  return true;
}
window.cpBeta98R9={VERSION,ensureAccelerationControl,syncAccelerationUi,ensurePairingPalettePolish,setPairingBusyState,yieldForPaint,install};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
