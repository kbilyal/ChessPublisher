/* Chess-Publisher v1.06.00-beta.89 — TEC Q144 Selected Rating Consistency Updates */
(()=>{
'use strict';
const VERSION='1.06.00-beta.89';
let installed=false;
let manualRunMode=null;
let selectionSession=null;
let activeApplySelection=null;

function text(v){return String(v??'');}
function esc(v){
  const s=text(v);
  try{if(typeof window.escapeHtml==='function')return window.escapeHtml(s);}catch(_){ }
  return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function tournamentKey(){return text(window.data?.currentTournament||'').trim();}
function optionsSnapshot(){
  try{return typeof window.getRegisteredFideUpdateOptions==='function'?window.getRegisteredFideUpdateOptions():null;}catch(_){return null;}
}
function optionsSignature(o){
  if(!o)return '';
  return JSON.stringify({
    type:text(o.type||'std'),name:!!o.name,rating:!!o.rating,k:!!o.k,title:!!o.title,
    birth:!!o.birth,sex:!!o.sex,fed:!!o.fed,setZero:!!o.setZero
  });
}
function ensureUi(){
  if(typeof document==='undefined')return null;
  let box=document.getElementById('cpBeta89SubsetBox');
  if(box)return box;
  const result=document.getElementById('registeredFideUpdateResult');
  if(!result)return null;
  box=document.createElement('div');
  box.id='cpBeta89SubsetBox';
  box.className='groupbox';
  box.style.display='none';
  box.innerHTML=`
    <div class="group-title">Detected rating changes — player selection</div>
    <div class="help" id="cpBeta89SubsetHelp">Run Start test to detect changes, then choose which players may be updated.</div>
    <div class="toolbar" style="gap:6px;margin:7px 0">
      <button type="button" id="cpBeta89SelectAll">Select all</button>
      <button type="button" id="cpBeta89SelectNone">Select none</button>
      <span id="cpBeta89SubsetCount" class="help" style="margin-left:auto"></span>
    </div>
    <div id="cpBeta89SubsetRows" style="max-height:170px;overflow:auto;border:1px solid #c7c7c7;background:#fff;padding:5px"></div>`;
  result.insertAdjacentElement('afterend',box);
  document.getElementById('cpBeta89SelectAll')?.addEventListener('click',()=>setAll(true));
  document.getElementById('cpBeta89SelectNone')?.addEventListener('click',()=>setAll(false));
  return box;
}
function visibleCheckboxes(){
  if(typeof document==='undefined')return [];
  return [...document.querySelectorAll('#cpBeta89SubsetRows input.cp-beta89-player[type="checkbox"]')];
}
function selectedIds(){return visibleCheckboxes().filter(x=>x.checked).map(x=>text(x.dataset.fideId));}
function updateCount(){
  const el=typeof document!=='undefined'?document.getElementById('cpBeta89SubsetCount'):null;
  if(!el)return;
  const all=visibleCheckboxes();
  el.textContent=all.length?`${all.filter(x=>x.checked).length} / ${all.length} selected`:'';
}
function setAll(checked){for(const cb of visibleCheckboxes())cb.checked=!!checked;updateCount();}
function renderMessage(message,show=true){
  const box=ensureUi();if(!box)return;
  box.style.display=show?'block':'none';
  const rows=document.getElementById('cpBeta89SubsetRows');
  const help=document.getElementById('cpBeta89SubsetHelp');
  if(help)help.textContent=text(message);
  if(rows)rows.innerHTML='';
  updateCount();
}
function capturePreview(result,options){
  const changes=Array.isArray(result?.changes)?result.changes:[];
  const ratingSelected=!!options?.rating;
  if(!ratingSelected){
    selectionSession=null;
    renderMessage('Player subset selection is available when Rating international is included in Start test.',true);
    return;
  }
  const detected=[];
  const seen=new Set();
  for(const item of changes){
    const fideId=text(item?.fideId).trim();
    if(!/^\d{5,15}$/.test(fideId)||seen.has(fideId))continue;
    seen.add(fideId);
    detected.push({fideId,name:text(item?.name),details:Array.isArray(item?.details)?item.details.map(text):[]});
  }
  selectionSession={
    tournamentKey:tournamentKey(),
    optionsSignature:optionsSignature(options),
    detectedIds:detected.map(x=>x.fideId),
    detected
  };
  const box=ensureUi();if(!box)return;
  box.style.display='block';
  const help=document.getElementById('cpBeta89SubsetHelp');
  const rows=document.getElementById('cpBeta89SubsetRows');
  if(help)help.textContent=detected.length
    ?'Choose the detected players that Start update may modify. Unchecked players remain unchanged.'
    :'No player changes were detected by the latest test.';
  if(rows){
    rows.innerHTML=detected.length?detected.map((item,index)=>`<label style="display:block;padding:5px 4px;border-bottom:${index===detected.length-1?'0':'1px solid #eee'}"><input class="cp-beta89-player" type="checkbox" data-fide-id="${esc(item.fideId)}" checked> <b>${esc(item.name||'Player')}</b> [${esc(item.fideId)}]<br><span class="help" style="margin-left:22px">${esc(item.details.join(' • '))}</span></label>`).join(''):'<div class="help" style="padding:5px">Nothing to select.</div>';
    for(const cb of visibleCheckboxes())cb.addEventListener('change',updateCount);
  }
  updateCount();
}
function invalidateSelection(message){selectionSession=null;activeApplySelection=null;renderMessage(message,true);}
function validateApplySelection(){
  if(!selectionSession)return null; // Existing all-player update remains available without a preview.
  const currentOptions=optionsSnapshot();
  if(tournamentKey()!==selectionSession.tournamentKey){
    invalidateSelection('Tournament changed since Start test. Run Start test again before using a selected subset.');
    return {error:'Tournament changed since Start test. Run Start test again.'};
  }
  if(optionsSignature(currentOptions)!==selectionSession.optionsSignature){
    invalidateSelection('Rating list or fields changed since Start test. Run Start test again before applying a selected subset.');
    return {error:'Rating list or fields changed since Start test. Run Start test again.'};
  }
  const allowed=new Set(selectionSession.detectedIds);
  const ids=selectedIds().filter(id=>allowed.has(id));
  if(!ids.length)return {error:'Select at least one detected player, or run Start test again.'};
  return {ids:new Set(ids),detectedCount:selectionSession.detectedIds.length};
}
function alertWarning(message){
  try{if(typeof window.appAlert==='function')return window.appAlert(message,'Update Registered Players','warning');}catch(_){ }
  try{window.alert?.(message);}catch(_){ }
}
function wrapEvaluator(){
  const original=window.evaluateRegisteredFideUpdate;
  if(typeof original!=='function'||original.__cpBeta89Wrapped)return false;
  const wrapped=function(t,lookup,options,applyChanges){
    if(manualRunMode==='apply'&&applyChanges&&activeApplySelection?.ids instanceof Set){
      const filteredPlayers=(t?.players||[]).filter(p=>activeApplySelection.ids.has(text(p?.fideId).trim()));
      const filteredTournament={...t,players:filteredPlayers};
      const result=original.call(this,filteredTournament,lookup,options,applyChanges);
      if(result&&typeof result==='object')result.cpBeta89Subset={selectedCount:filteredPlayers.length,detectedCount:activeApplySelection.detectedCount};
      return result;
    }
    const result=original.apply(this,arguments);
    if(manualRunMode==='test'&&!applyChanges)capturePreview(result,options);
    return result;
  };
  wrapped.__cpBeta89Wrapped=true;wrapped.__cpBeta89Original=original;
  window.evaluateRegisteredFideUpdate=wrapped;
  return true;
}
function wrapReport(){
  const original=window.buildRegisteredFideUpdateReport;
  if(typeof original!=='function'||original.__cpBeta89Wrapped)return false;
  const wrapped=function(result,options,applyChanges,source){
    let report=original.apply(this,arguments);
    const meta=result?.cpBeta89Subset;
    if(applyChanges&&meta){
      report+=`\nSelected subset: ${Number(meta.selectedCount)||0} of ${Number(meta.detectedCount)||0} detected player(s) from the latest Start test were eligible for this update.\nUnchecked detected players were not modified.\n`;
    }
    return report;
  };
  wrapped.__cpBeta89Wrapped=true;wrapped.__cpBeta89Original=original;
  window.buildRegisteredFideUpdateReport=wrapped;
  return true;
}
function wrapRunner(){
  const original=window.runRegisteredPlayersFideUpdate;
  if(typeof original!=='function'||original.__cpBeta89Wrapped)return false;
  const wrapped=async function(applyChanges=true){
    const apply=!!applyChanges;
    if(!apply){
      selectionSession=null;activeApplySelection=null;
      renderMessage('Running Start test… detected players will appear here.',true);
    }else{
      const selection=validateApplySelection();
      if(selection?.error){alertWarning(selection.error);return;}
      activeApplySelection=selection;
    }
    manualRunMode=apply?'apply':'test';
    try{return await original.apply(this,arguments);}
    finally{
      manualRunMode=null;
      activeApplySelection=null;
      if(apply&&selectionSession){
        selectionSession=null;
        renderMessage('Selection consumed. Run Start test again before another selected-subset update.',true);
      }
    }
  };
  wrapped.__cpBeta89Wrapped=true;wrapped.__cpBeta89Original=original;
  window.runRegisteredPlayersFideUpdate=wrapped;
  return true;
}
function install(){
  if(installed)return;installed=true;
  ensureUi();wrapEvaluator();wrapReport();wrapRunner();
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){ }
}
window.cpBeta89={VERSION,optionsSignature,ensureUi,capturePreview,selectedIds,setAll,validateApplySelection,invalidateSelection,wrapEvaluator,wrapReport,wrapRunner,install,get session(){return selectionSession;}};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
