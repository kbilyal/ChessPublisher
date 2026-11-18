/* Chess-Publisher v1.06.00-beta.62 — Rating List Sequence Editor */
(()=>{
'use strict';
const VERSION='1.06.00-beta.62';
const ALL=['fide-standard','fide-rapid','fide-blitz','effective-rapid','effective-blitz'];
const FALLBACK_LABELS={
  'fide-standard':'FIDE Standard','fide-rapid':'FIDE Rapid','fide-blitz':'FIDE Blitz',
  'effective-rapid':'Effective Rapid','effective-blitz':'Effective Blitz'
};
let installed=false,draft=[],draftMode='custom';
function api59(){return window.cpBeta59||null;}
function clean(value){const a=api59();return a?.cleanSequence?a.cleanSequence(value):Array.from(new Set((Array.isArray(value)?value:[]).map(x=>String(x||'').trim().toLowerCase()).filter(x=>ALL.includes(x))));}
function label(id){return api59()?.LABELS?.[id]||FALLBACK_LABELS[id]||String(id||'');}
function currentTournament(){return window.getCurrentTournament?.()||null;}
function currentType(t=currentTournament()){return api59()?.normalizedRatingType?.(t?.settings?.tournamentRatingType)||String(t?.settings?.tournamentRatingType||'Unrated');}
function defaultFor(t=currentTournament()){return clean(api59()?.defaultSequenceFor?.(currentType(t))||[]);}
function isRatedSequenceRequired(t=currentTournament()){return currentType(t)!=='Unrated';}
function availableIds(sequence=draft){const used=new Set(clean(sequence));return ALL.filter(id=>!used.has(id));}
function add(sequence,id){const out=clean(sequence);id=String(id||'').trim().toLowerCase();if(ALL.includes(id)&&!out.includes(id))out.push(id);return out;}
function remove(sequence,index){const out=clean(sequence);index=Number(index);if(Number.isInteger(index)&&index>=0&&index<out.length)out.splice(index,1);return out;}
function move(sequence,index,delta){const out=clean(sequence);index=Number(index);delta=Number(delta);const target=index+delta;if(!Number.isInteger(index)||!Number.isInteger(delta)||index<0||index>=out.length||target<0||target>=out.length)return out;[out[index],out[target]]=[out[target],out[index]];return out;}
function validate(sequence,t=currentTournament()){
  const out=clean(sequence);
  if(isRatedSequenceRequired(t)&&out.length===0)return {ok:false,message:'A rated tournament must keep at least one rating list in the sequence.',sequence:out};
  return {ok:true,message:'',sequence:out};
}
function same(a,b){a=clean(a);b=clean(b);return a.length===b.length&&a.every((x,i)=>x===b[i]);}
function sequenceText(sequence){const out=clean(sequence);return out.length?out.map(label).join(' → '):'No rating list';}
function ensureCurrent(){const t=currentTournament();if(t?.settings&&api59()?.syncTournament)api59().syncTournament(t,{persist:false});return t;}
function refreshSummary(){
  const t=ensureCurrent(),summary=document.getElementById('ratingListSequenceSummary'),mode=document.getElementById('ratingListSequenceMode');
  const seq=clean(t?.settings?.ratingListSequence),m=t?.settings?.ratingListSequenceMode==='custom'?'custom':'default';
  if(summary)summary.textContent=sequenceText(seq);
  if(mode){mode.textContent=m==='custom'?'Custom':'Default';mode.className='badge '+(m==='custom'?'warning':'');}
  const btn=document.getElementById('ratingListSequenceManage');if(btn)btn.disabled=!t;
  return {sequence:seq,mode:m};
}
function setDraft(sequence,mode='custom'){draft=clean(sequence);draftMode=mode==='default'?'default':'custom';renderEditor();return draft.slice();}
function draftSnapshot(){return {sequence:draft.slice(),mode:draftMode};}
function openEditor(){const t=ensureCurrent();if(!t)return false;draft=clean(t.settings.ratingListSequence);draftMode=t.settings.ratingListSequenceMode==='custom'?'custom':'default';renderEditor();const modal=document.getElementById('ratingListSequenceModal');if(modal){modal.style.display='flex';modal.setAttribute('aria-hidden','false');}return true;}
function closeEditor(){const modal=document.getElementById('ratingListSequenceModal');if(modal){modal.style.display='none';modal.setAttribute('aria-hidden','true');}return true;}
function useDefaultDraft(){draft=defaultFor();draftMode='default';renderEditor();return draft.slice();}
async function saveDraft(){
  const t=currentTournament();if(!t?.settings)return false;
  const checked=validate(draft,t);if(!checked.ok){if(typeof window.appAlert==='function')await window.appAlert(checked.message,'Rating List Sequence','warning');else if(typeof window.alert==='function')window.alert(checked.message);return false;}
  const canonical=defaultFor(t);
  if(draftMode==='default'||same(checked.sequence,canonical))api59()?.restoreDefault?.(t,{persist:true});
  else api59()?.markCustom?.(t,checked.sequence,{persist:true});
  refreshSummary();closeEditor();return true;
}
function renderEditor(){
  const active=document.getElementById('ratingListSequenceActive'),available=document.getElementById('ratingListSequenceAvailable'),hint=document.getElementById('ratingListSequenceEditorMode');
  if(hint)hint.textContent=draftMode==='default'?'Default sequence':'Custom sequence';
  if(active){
    active.innerHTML='';
    if(!draft.length){const e=document.createElement('div');e.className='help';e.textContent='No rating list selected.';active.appendChild(e);}
    draft.forEach((id,index)=>{const row=document.createElement('div');row.className='cp-rating-sequence-row';row.innerHTML=`<span><b>${index+1}.</b> ${label(id)}</span><span class="cp-rating-sequence-actions"><button type="button" data-action="up" data-index="${index}" ${index===0?'disabled':''}>↑</button><button type="button" data-action="down" data-index="${index}" ${index===draft.length-1?'disabled':''}>↓</button><button type="button" data-action="remove" data-index="${index}">Remove</button></span>`;active.appendChild(row);});
  }
  if(available){
    available.innerHTML='';
    const ids=availableIds(draft);
    if(!ids.length){const e=document.createElement('div');e.className='help';e.textContent='All rating lists are in the sequence.';available.appendChild(e);}
    ids.forEach(id=>{const row=document.createElement('div');row.className='cp-rating-sequence-row';row.innerHTML=`<span>${label(id)}</span><button type="button" data-action="add" data-id="${id}">Add</button>`;available.appendChild(row);});
  }
}
function handleEditorClick(event){
  const b=event.target?.closest?.('button[data-action]');if(!b)return;
  const action=b.dataset.action;
  if(action==='add')draft=add(draft,b.dataset.id);
  else if(action==='remove')draft=remove(draft,Number(b.dataset.index));
  else if(action==='up')draft=move(draft,Number(b.dataset.index),-1);
  else if(action==='down')draft=move(draft,Number(b.dataset.index),1);
  draftMode='custom';renderEditor();
}
function createUi(){
  if(!document.getElementById('ratingListSequenceControl')){
    const anchor=document.querySelector('.pairing-essentials-box');
    if(anchor){
      const box=document.createElement('div');box.id='ratingListSequenceControl';box.className='groupbox';
      box.innerHTML='<div class="group-title">Rating List Sequence</div><div class="cp-rating-sequence-summary"><span id="ratingListSequenceSummary">—</span><span id="ratingListSequenceMode" class="badge">Default</span><button id="ratingListSequenceManage" type="button">Manage…</button></div>';
      anchor.insertAdjacentElement('afterend',box);
    }
  }
  if(!document.getElementById('ratingListSequenceModal')){
    const modal=document.createElement('div');modal.id='ratingListSequenceModal';modal.className='modal-overlay';modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="modal-window" style="width:780px;max-width:95vw"><div class="modal-titlebar">Rating List Sequence</div><div class="modal-body"><div class="cp-rating-sequence-head"><span>Ratings are resolved from top to bottom.</span><span id="ratingListSequenceEditorMode" class="badge">Custom sequence</span></div><div class="cp-rating-sequence-columns"><div class="groupbox"><div class="group-title">Sequence</div><div id="ratingListSequenceActive"></div></div><div class="groupbox"><div class="group-title">Available rating lists</div><div id="ratingListSequenceAvailable"></div></div></div></div><div class="modal-bottom"><button id="ratingListSequenceDefault" type="button">Use Default</button><span style="flex:1"></span><button id="ratingListSequenceCancel" type="button">Cancel</button><button id="ratingListSequenceSave" type="button" class="primary">Save</button></div></div>';
    document.body.appendChild(modal);
  }
  if(!document.getElementById('cpBeta62RatingListSequenceStyle')){
    const style=document.createElement('style');style.id='cpBeta62RatingListSequenceStyle';style.textContent='.cp-rating-sequence-summary{display:flex;align-items:center;gap:9px;min-height:28px}.cp-rating-sequence-summary>span:first-child{flex:1;font-weight:600}.cp-rating-sequence-columns{display:grid;grid-template-columns:1fr 1fr;gap:12px}.cp-rating-sequence-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.cp-rating-sequence-row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:34px;padding:4px 0;border-bottom:1px solid #e2e7ec}.cp-rating-sequence-row:last-child{border-bottom:0}.cp-rating-sequence-actions{display:flex;gap:4px}.cp-rating-sequence-actions button{min-width:34px}@media(max-width:700px){.cp-rating-sequence-columns{grid-template-columns:1fr}.cp-rating-sequence-summary{align-items:flex-start;flex-wrap:wrap}}';document.head.appendChild(style);
  }
  document.getElementById('ratingListSequenceManage')?.addEventListener('click',openEditor);
  document.getElementById('ratingListSequenceCancel')?.addEventListener('click',closeEditor);
  document.getElementById('ratingListSequenceDefault')?.addEventListener('click',useDefaultDraft);
  document.getElementById('ratingListSequenceSave')?.addEventListener('click',saveDraft);
  document.getElementById('ratingListSequenceActive')?.addEventListener('click',handleEditorClick);
  document.getElementById('ratingListSequenceAvailable')?.addEventListener('click',handleEditorClick);
}
function wrapRefresh(name){
  const original=window[name];if(typeof original!=='function'||original.__cpBeta62Wrapped)return false;
  const wrapped=function(){const r=original.apply(this,arguments);if(r&&typeof r.then==='function')return r.finally(()=>{refreshSummary();closeEditor();});refreshSummary();return r;};
  wrapped.__cpBeta62Wrapped=true;wrapped.__cpBeta62Original=original;window[name]=wrapped;return true;
}
function install(){
  if(installed)return;installed=true;createUi();wrapRefresh('loadAllFields');wrapRefresh('changeTournament');wrapRefresh('tournamentRatingTypeChanged');
  refreshSummary();
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){ }
  try{const ver=document.getElementById('appVersion');if(ver)ver.textContent=`v${VERSION}`;}catch(_){ }
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }
}
window.cpBeta62={VERSION,ALL,clean,label,currentType,defaultFor,availableIds,add,remove,move,validate,same,sequenceText,refreshSummary,setDraft,draftSnapshot,useDefaultDraft,saveDraft,openEditor,closeEditor,renderEditor,createUi,install};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
