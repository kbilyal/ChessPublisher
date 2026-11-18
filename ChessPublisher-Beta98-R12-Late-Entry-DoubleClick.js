/* Chess-Publisher v1.06.00-beta.98-r12 — Late Entry double-click workflow point-fix
   UX/add orchestration only. Existing player lifecycle and pairing semantics remain authoritative.
   No pairing, TRF, BBP, tie-break, Chess-Results, SYNC or rating calculation core changes. */
(()=>{
'use strict';
const VERSION='1.06.00-beta.98-r12';
let installed=false,directAddBusy=false;
function currentTournament(){try{return window.getCurrentTournament?.()||null;}catch(_){return null;}}
function isRoundRobin(t=currentTournament()){try{return !!window.isRoundRobinTournament?.(t);}catch(_){return false;}}
function latestRound(t=currentTournament()){try{return Number(window.getLatestGeneratedRoundForTournament?.(t)??window.getLatestGeneratedRound?.()??0)||0;}catch(_){return 0;}}
function lateContext(){const t=currentTournament(),latest=latestRound(t);return {t,latest,active:!!t&&!isRoundRobin(t)&&latest>0,joinRound:latest+1};}
function isBg(){try{return window.getLanguage?.()==='bg';}catch(_){return false;}}
function text(v){return String(v??'').trim();}
function n(v){const x=Number(v);return Number.isFinite(x)?Math.max(0,Math.trunc(x)):0;}
function validFideId(v){return /^\d{5,15}$/.test(text(v));}
function hideLegacyLateBar(){
  const bar=document.getElementById('cpR11LateEntryBar');if(bar){bar.style.setProperty('display','none','important');bar.setAttribute('aria-hidden','true');}
  const btn=document.getElementById('setLateEntryBtn');if(btn){btn.style.setProperty('display','none','important');btn.setAttribute('aria-hidden','true');}
}
async function confirmLateEntry(playerName){
  const c=lateContext();if(!c.active)return true;
  const name=text(playerName)||'Player';
  const msg=isBg()
    ? `Турнирът вече е започнал.\n\n${name} ще бъде добавен като Late Entry от Round ${c.joinRound}.\n\n• Кръгове 1–${c.latest} остават непроменени и играчът не се добавя със задна дата в жребия.\n• За пропуснатите кръгове по подразбиране се отчита 0 точки, освен ако регламентът на турнира изрично не предвижда друго.\n• Играчът ще бъде Present за следващия допустим жребий.\n• Преди Round ${c.joinRound} трябва да се изпълни Resort Starting List.\n\nДобави играча?`
    : `The tournament has already started.\n\n${name} will be added as a Late Entry from Round ${c.joinRound}.\n\n• Rounds 1–${c.latest} remain unchanged and the player is not paired retroactively.\n• Missed rounds count as 0 points by default unless the tournament regulations explicitly provide otherwise.\n• The player will be Present for the next eligible pairing.\n• Resort Starting List is required before Round ${c.joinRound}.\n\nAdd this player?`;
  return !!(await window.appConfirm?.(msg,isBg()?'Late Entry — потвърждение':'Late Entry — confirmation','question'));
}
function preferredType(){try{return window.getTournamentPreferredRatingListType?.()||document.getElementById('defaultRating')?.value||'std';}catch(_){return 'std';}}
function parseFallbackPlayer(item){
  const name=text(item.querySelector('.fide-name')?.textContent),line=text(item.querySelector('.fide-info')?.textContent);
  const m=line.match(/^([^|]*)\|\s*Gender:\s*([^|]*)\|\s*Birth:\s*([^|]*)\|\s*Std:\s*(\d+)\s*\|\s*Rapid:\s*(\d+)\s*\|\s*Blitz:\s*(\d+)\s*\|\s*ID:\s*(.*)$/i);
  if(!m)return {name,fed:'',fideId:'-',birth:'-',gender:'',std:0,rapid:0,blitz:0,title:''};
  return {name,fed:text(m[1]),gender:text(m[2]),birth:text(m[3]),std:n(m[4]),rapid:n(m[5]),blitz:n(m[6]),fideId:text(m[7])||'-',title:''};
}
async function resolveItemPlayer(item){
  const fallback=parseFallbackPlayer(item),q=text(document.getElementById('fideSearch')?.value),items=[...document.querySelectorAll('#fideResults .fide-item')],index=Math.max(0,items.indexOf(item));
  try{
    if(q&&window.cpBeta98R7?.unifiedSearch){
      const rows=await window.cpBeta98R7.unifiedSearch(q,60);const byIndex=rows[index];
      if(byIndex&&text(byIndex.name).toLowerCase()===text(fallback.name).toLowerCase())return byIndex;
      if(validFideId(fallback.fideId)){const byId=rows.find(p=>text(p.fideId)===text(fallback.fideId));if(byId)return byId;}
      const same=rows.filter(p=>text(p.name).toLowerCase()===text(fallback.name).toLowerCase());if(same.length===1)return same[0];
    }
  }catch(err){console.warn('Double-click player resolve fallback:',err);}
  return fallback;
}
function externalResolutions(source){
  const hits=Array.isArray(source?.__cpRatingListHits)?source.__cpRatingListHits:[],out=[];
  for(const hit of hits){const id=text(hit?.listId);if(!id)continue;try{const r=window.cpBeta98?.resolutionFromExternalHit?.(source,id,currentTournament());if(r&&n(r.rating)>0)out.push(r);}catch(_){}}
  return out;
}
function sourceChoiceModal(){
  let m=document.getElementById('cpR12RatingSourceChoice');if(m)return m;
  m=document.createElement('div');m.id='cpR12RatingSourceChoice';m.className='modal-overlay';m.style.display='none';m.innerHTML=`<div class="modal-window" style="width:min(560px,94vw)"><div class="modal-titlebar">Choose Rating Source</div><div class="modal-body"><div id="cpR12SourceHelp" class="help" style="margin-bottom:8px"></div><div id="cpR12SourceRows"></div></div><div class="modal-bottom"><button id="cpR12SourceCancel" type="button">Cancel</button><button id="cpR12SourceOk" type="button" class="primary">Continue</button></div></div>`;document.body.appendChild(m);return m;
}
function chooseExternalResolution(source,resolutions){
  if(resolutions.length<=1)return Promise.resolve(resolutions[0]||null);
  const pref=preferredType(),matching=resolutions.filter(r=>r.sourceType===pref);if(matching.length===1)return Promise.resolve(matching[0]);
  return new Promise(resolve=>{
    const m=sourceChoiceModal(),rows=m.querySelector('#cpR12SourceRows'),help=m.querySelector('#cpR12SourceHelp');
    help.textContent=`${source.name||'Player'} has more than one imported rating. Choose the rating source for this tournament.`;
    rows.innerHTML=resolutions.map((r,i)=>`<label class="rating-row" style="cursor:pointer"><input type="radio" name="cpR12Source" value="${i}" ${i===0?'checked':''}><span>${String(r.label||r.listId).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</span><b>${n(r.rating)}</b></label>`).join('');
    const finish=v=>{m.style.display='none';m.querySelector('#cpR12SourceOk').onclick=null;m.querySelector('#cpR12SourceCancel').onclick=null;resolve(v);};
    m.querySelector('#cpR12SourceCancel').onclick=()=>finish(null);m.querySelector('#cpR12SourceOk').onclick=()=>{const i=Number(m.querySelector('input[name="cpR12Source"]:checked')?.value||0);finish(resolutions[i]||null);};m.style.display='flex';
  });
}
async function chooseRatingResolution(source){
  const type=preferredType();
  let effective={requestedType:type,rating:n(source?.[type]),rawRating:n(source?.[type]),standardRating:n(source?.std),sourceType:type,fallback:false,available:n(source?.[type])>0};
  try{if(window.cpBeta58?.effectiveRatingForPlayer)effective=window.cpBeta58.effectiveRatingForPlayer(source,type)||effective;}catch(_){ }
  if(n(effective.rating)>0)return {kind:'official',type,effective};
  const ext=externalResolutions(source);if(ext.length){const chosen=await chooseExternalResolution(source,ext);if(!chosen)return null;return {kind:'external',type,resolution:chosen};}
  return {kind:'official',type,effective};
}
function duplicateExists(source){
  const t=currentTournament();if(!t)return false;const fid=text(source?.fideId);if(validFideId(fid)&&t.players?.some(p=>text(p.fideId)===fid))return true;
  const localId=!validFideId(fid)?text(source?.playerId||source?.customPlayerId):'';if(localId&&t.players?.some(p=>text(p.playerId||p.customPlayerId)===localId))return true;return false;
}
async function buildPlayer(source,choice){
  try{if(!text(source?.gender)&&validFideId(source?.fideId)&&window.ensureFideSearchPlayerGender)await Promise.race([window.ensureFideSearchPlayerGender(source),new Promise(r=>setTimeout(r,180))]);}catch(_){ }
  const fideId=validFideId(source?.fideId)?text(source.fideId):'-',base={name:text(source?.name),title:window.normalizePlayerTitle?.(source?.title)||text(source?.title).toUpperCase(),fed:text(source?.fed||'BUL').toUpperCase()||'BUL',fideId,birth:text(source?.birth||'-')||'-',gender:window.normalizePlayerGender?.(source?.gender)||text(source?.gender),attendance:'present',playerId:text(source?.playerId||source?.customPlayerId)};
  if(choice.kind==='official'){
    const eff=choice.effective||{},p={...base,rating:n(eff.rating),ratingSource:choice.type,effectiveRatingSource:eff.sourceType||choice.type,effectiveRatingFallback:!!eff.fallback,ratingListSnapshot:window.cpBeta72RatingLists?.snapshotPlayer?.(source)};
    window.cpBeta52?.initializeOfficialPlayer?.(p,choice.type);window.cpBeta58?.annotateOfficialPlayer?.(p,eff,window.cpBeta53?.lastContext?.periodKey||'');return p;
  }
  const r=choice.resolution,eventType=choice.type,baseType=['std','rapid','blitz'].includes(r.sourceType)?r.sourceType:eventType,p={...base,rating:n(r.rating),ratingSource:baseType,effectiveRatingSource:r.sourceType||'custom',effectiveRatingFallback:false,ratingListSnapshot:window.cpBeta72RatingLists?.snapshotPlayer?.(source)};
  window.cpBeta52?.initializeOfficialPlayer?.(p,baseType);p.ratingSource=r.kind==='type-b-rating-list'?'type-b':'custom';p.effectiveRatingSource=r.sourceType||'custom';p.effectiveRatingFallback=false;
  const trueOfficial=n(source?.[eventType]);try{window.cpBeta57?.assignOfficialRating?.(p,trueOfficial,{sourceType:eventType,reason:'explicit-rating-list-selection'});}catch(_){p.officialRating=trueOfficial;}
  window.cpBeta98?.attachTournamentProvenance?.(p,r,{manualOverride:false,selectedBy:'explicit-rating-list-selection'});try{window.cpBeta57?.syncTournamentProvenance?.(p);}catch(_){ }window.cpBeta98?.attachTournamentProvenance?.(p,r,{manualOverride:false,selectedBy:'explicit-rating-list-selection'});return p;
}
async function commitPlayer(source,choice){
  const t=currentTournament();if(!t)throw new Error('Create or select a tournament first.');if(duplicateExists(source)){await window.appAlert?.('Player already registered.','Add Player','warning');return false;}
  const player=await buildPlayer(source,choice);if(!player.name)throw new Error('Player name is missing.');
  const rr=await window.tryRoundRobinAdditionalEntry?.(player);if(rr?.handled)return !!rr.added;
  const joinInfo=window.prepareNewPlayerForTournament(player);t.players.push(player);window.playerKey?.(player,t.players.length-1);window.saveData?.();if(window.cpPersistCriticalMutation&&!(await window.cpPersistCriticalMutation('Add Player — double click')))return false;
  window.renderRegistered?.();window.updatePlayerCount?.();window.renderNextRoundPlayerManager?.();
  try{selectedPlayerIndexes.clear();selectedPlayerIndexes.add(t.players.length-1);lastClickedSortedIndex=null;window.renderRegistered?.();}catch(_){ }
  const join=Number(window.getPlayerJoinRound?.(player)||player.joinedFromRound||1)||1;if(joinInfo?.late||join>1)window.setStatus?.(`${player.name}: Late Entry from Round ${join}. Previous rounds unchanged; Resort Starting List required before the next pairing.`);return true;
}
async function handleResultDoubleClick(item){
  if(directAddBusy||!item)return false;directAddBusy=true;
  try{const source=await resolveItemPlayer(item);if(!source?.name)throw new Error('Could not resolve the selected player.');if(!(await confirmLateEntry(source.name)))return false;const choice=await chooseRatingResolution(source);if(!choice)return false;return await commitPlayer(source,choice);}finally{directAddBusy=false;hideLegacyLateBar();applyVersion();}
}
function installCapture(){if(document.documentElement.dataset.cpR12DblCapture==='1')return;document.documentElement.dataset.cpR12DblCapture='1';document.addEventListener('dblclick',e=>{const item=e.target?.closest?.('#fideResults .fide-item');if(!item)return;e.preventDefault();e.stopImmediatePropagation();handleResultDoubleClick(item).catch(err=>window.appAlert?.(String(err?.message||err),'Add Player','warning'));},true);}
function installStyles(){if(document.getElementById('cp-r12-late-entry-style'))return;const s=document.createElement('style');s.id='cp-r12-late-entry-style';s.textContent=`#cpR11LateEntryBar{display:none!important}#setLateEntryBtn{display:none!important}#fideResults .fide-item{cursor:pointer}#fideResults .fide-item:hover{background:#f5f9fd}`;document.head.appendChild(s);}
function applyVersion(){try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){}try{document.title=`Chess-Publisher v${VERSION}`;}catch(_){}try{const w=document.getElementById('windowDocumentTitle');if(w)w.textContent=`Chess-Publisher v${VERSION} — Tournament Manager & Publisher`;}catch(_){}try{const v=document.getElementById('appVersion');if(v)v.textContent=`v${VERSION}`;}catch(_){} }
function install(){if(installed)return true;installed=true;installStyles();installCapture();hideLegacyLateBar();applyVersion();setTimeout(()=>{hideLegacyLateBar();applyVersion();},0);setTimeout(()=>{hideLegacyLateBar();applyVersion();},350);setTimeout(()=>{hideLegacyLateBar();applyVersion();},5500);return true;}
window.cpBeta98R12={VERSION,lateContext,confirmLateEntry,resolveItemPlayer,chooseRatingResolution,commitPlayer,handleResultDoubleClick,hideLegacyLateBar,install};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
