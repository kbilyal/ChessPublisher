/* Chess-Publisher v1.06.00-beta.66 — Rating List Sequence Consistency */
(()=>{
'use strict';
const VERSION='1.06.00-beta.66';
const IDS={STANDARD:'fide-standard',RAPID:'fide-rapid',BLITZ:'fide-blitz',EFFECTIVE_RAPID:'effective-rapid',EFFECTIVE_BLITZ:'effective-blitz'};
const LABELS={
  [IDS.STANDARD]:'FIDE Standard',[IDS.RAPID]:'FIDE Rapid',[IDS.BLITZ]:'FIDE Blitz',
  [IDS.EFFECTIVE_RAPID]:'Effective Rapid',[IDS.EFFECTIVE_BLITZ]:'Effective Blitz'
};
let installed=false,running=false;
const n=v=>{const x=Number(v);return Number.isFinite(x)?Math.max(0,Math.trunc(x)):0;};
function cleanSequence(sequence){return window.cpBeta59?.cleanSequence?window.cpBeta59.cleanSequence(sequence):(Array.isArray(sequence)?sequence.map(x=>String(x||'').trim().toLowerCase()).filter(Boolean):[]);}
function sequenceFor(t){
  try{window.cpBeta59?.syncTournament?.(t,{persist:false});}catch(_){ }
  return cleanSequence(t?.settings?.ratingListSequence);
}
function requiredRawTypes(sequence){
  const out=[];const add=x=>{if(!out.includes(x))out.push(x);};
  for(const id of cleanSequence(sequence)){
    if(id===IDS.STANDARD)add('std');
    else if(id===IDS.RAPID)add('rapid');
    else if(id===IDS.BLITZ)add('blitz');
    else if(id===IDS.EFFECTIVE_RAPID){add('rapid');add('std');}
    else if(id===IDS.EFFECTIVE_BLITZ){add('blitz');add('std');}
  }
  return out;
}
function mapRating(maps,type,id){return n(maps?.[type]?.get?.(String(id))||0);}
function resolveFromMaps(id,sequence,maps){
  id=String(id||'').trim();
  for(const listId of cleanSequence(sequence)){
    if(listId===IDS.STANDARD){const rating=mapRating(maps,'std',id);if(rating>0)return {rating,listId,sourceType:'std',fallback:false};}
    else if(listId===IDS.RAPID){const rating=mapRating(maps,'rapid',id);if(rating>0)return {rating,listId,sourceType:'rapid',fallback:false};}
    else if(listId===IDS.BLITZ){const rating=mapRating(maps,'blitz',id);if(rating>0)return {rating,listId,sourceType:'blitz',fallback:false};}
    else if(listId===IDS.EFFECTIVE_RAPID){
      const rapid=mapRating(maps,'rapid',id);if(rapid>0)return {rating:rapid,listId,sourceType:'rapid',fallback:false};
      const std=mapRating(maps,'std',id);if(std>0)return {rating:std,listId,sourceType:'std',fallback:true};
    }else if(listId===IDS.EFFECTIVE_BLITZ){
      const blitz=mapRating(maps,'blitz',id);if(blitz>0)return {rating:blitz,listId,sourceType:'blitz',fallback:false};
      const std=mapRating(maps,'std',id);if(std>0)return {rating:std,listId,sourceType:'std',fallback:true};
    }
  }
  return {rating:0,listId:null,sourceType:null,fallback:false};
}
function validFideIds(t){return [...new Set((t?.players||[]).map(p=>String(p?.fideId||'').trim()).filter(id=>/^\d{5,15}$/.test(id)))];}
async function verifyTypes(t,types,ids,checkDate){
  if(!window.cpBeta54?.verifyBeforeRequestedConsistency)throw new Error('FIDE rating-list verification is unavailable.');
  for(const type of types)await window.cpBeta54.verifyBeforeRequestedConsistency(t,{type,rating:true,name:false,k:false,title:false,birth:false,sex:false,fed:false,setZero:false},ids,checkDate);
}
async function loadMaps(types,periodKey,ids){
  if(!window.cpBeta53?.loadRatings)throw new Error('Date-effective FIDE rating-list loader is unavailable.');
  const maps={};const sources={};
  for(const type of types){const loaded=await window.cpBeta53.loadRatings(type,periodKey,ids);maps[type]=loaded.ratings;sources[type]={sourceUrl:String(loaded.sourceUrl||''),sourceKind:String(loaded.from||'')};}
  return {maps,sources};
}
async function checkTournament(t,checkDate=new Date()){
  if(!t)throw new Error('No tournament is open.');
  const sequence=sequenceFor(t);if(!sequence.length)throw new Error('The tournament has no Rating List Sequence.');
  const ids=validFideIds(t);if(!ids.length)throw new Error('There are no registered players with a valid FIDE ID.');
  if(!window.cpBeta53?.consistencyTarget)throw new Error('Date-effective rating period logic is unavailable.');
  const target=window.cpBeta53.consistencyTarget(t,checkDate);
  const types=requiredRawTypes(sequence);if(!types.length)throw new Error('The Rating List Sequence contains no supported rating list.');
  await verifyTypes(t,types,ids,checkDate);
  const loaded=await loadMaps(types,target.periodKey,ids);
  const differences=[],matches=[],unresolved=[],noFideId=[];
  for(const p of t.players||[]){
    const fideId=String(p?.fideId||'').trim();
    if(!/^\d{5,15}$/.test(fideId)){noFideId.push({name:String(p?.name||''),fideId});continue;}
    const expected=resolveFromMaps(fideId,sequence,loaded.maps);
    const current=n(p?.rating); // Tournament Rating — operations/seeding, intentionally separate from Official Rating.
    const row={name:String(p?.name||''),fideId,currentRating:current,expectedRating:expected.rating,listId:expected.listId,sourceType:expected.sourceType,fallback:expected.fallback,sourceLabel:expected.listId?LABELS[expected.listId]:'No rating found'};
    if(expected.rating<=0)unresolved.push(row);
    else if(current!==expected.rating)differences.push(row);
    else matches.push(row);
  }
  return {ok:true,checkedAt:new Date().toISOString(),periodKey:String(target.periodKey||''),periodReason:String(target.reason||''),sequence:sequence.slice(),sequenceLabels:sequence.map(id=>LABELS[id]||id),rawTypes:types.slice(),sources:loaded.sources,differences,matches,unresolved,noFideId,total:(t.players||[]).length};
}
function reportText(t,result){
  const name=String(t?.name||t?.settings?.name||window.data?.currentTournament||'Tournament');
  const lines=[
    'RATING LIST SEQUENCE CONSISTENCY CHECK',`Tournament: ${name}`,`Rating period: ${result.periodKey} · ${result.periodReason}`,
    `Sequence: ${result.sequenceLabels.join(' → ')}`,'',`Players: ${result.total}`,`Consistent: ${result.matches.length}`,`Differences: ${result.differences.length}`,`No rating found in sequence: ${result.unresolved.length}`,`No valid FIDE ID: ${result.noFideId.length}`
  ];
  if(result.differences.length){lines.push('','DIFFERENCES');for(const r of result.differences)lines.push(`${r.name} | FIDE ${r.fideId} | Tournament Rating ${r.currentRating} → ${r.expectedRating} | ${r.sourceLabel}${r.fallback?' (Standard fallback)':''}`);}
  if(result.unresolved.length){lines.push('','NO RATING FOUND IN SEQUENCE');for(const r of result.unresolved)lines.push(`${r.name} | FIDE ${r.fideId} | current Tournament Rating ${r.currentRating}`);}
  return lines.join('\n')+'\n';
}
async function runCurrent(){
  if(running)return null;const t=window.getCurrentTournament?.();running=true;setButtonBusy(true);
  try{
    const result=await checkTournament(t,new Date());const report=reportText(t,result);let saved=null;
    if(typeof window.saveRegisteredFideUpdateReport==='function')saved=await window.saveRegisteredFideUpdateReport(report,'ChessPublisher-Rating-Sequence-Consistency');
    const message=`Rating List Sequence consistency: ${result.differences.length} difference${result.differences.length===1?'':'s'} • ${result.matches.length} consistent • ${result.unresolved.length} without a sequence rating. No player data was changed.`;
    try{window.setStatus?.(message);}catch(_){ }
    try{const el=document.getElementById('ratingListSequenceConsistencyStatus');if(el)el.textContent=message;}catch(_){ }
    if(result.differences.length)try{window.appAlert?.(`${message}\n\nA detailed TXT report was ${saved?.opened?'opened':'saved'}.`,'Rating List Sequence','warning');}catch(_){ }
    return {result,report,saved};
  }catch(err){const message=String(err?.message||err);try{window.appAlert?.(message,'Rating List Sequence','warning');}catch(_){ }try{const el=document.getElementById('ratingListSequenceConsistencyStatus');if(el)el.textContent=message;}catch(_){ }return {error:message};}
  finally{running=false;setButtonBusy(false);}
}
function setButtonBusy(busy){try{const b=document.getElementById('ratingListSequenceCheck');if(b){b.disabled=!!busy;b.textContent=busy?'Checking…':'Check consistency';}}catch(_){ }}
function createUi(){
  if(typeof document==='undefined')return false;
  const box=document.getElementById('ratingListSequenceControl');if(!box)return false;
  const summary=box.querySelector?.('.cp-rating-sequence-summary')||box;
  if(!document.getElementById('ratingListSequenceCheck')){const b=document.createElement('button');b.id='ratingListSequenceCheck';b.type='button';b.textContent='Check consistency';b.addEventListener('click',runCurrent);summary.appendChild(b);}
  if(!document.getElementById('ratingListSequenceConsistencyStatus')){const s=document.createElement('div');s.id='ratingListSequenceConsistencyStatus';s.className='help';s.textContent='Checks Tournament Ratings against the active sequence without changing player data.';box.appendChild(s);}
  return true;
}
function install(){
  if(installed)return;installed=true;createUi();
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){ }
  try{const ver=document.getElementById('appVersion');if(ver)ver.textContent=`v${VERSION}`;}catch(_){ }
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }
}
window.cpBeta66={VERSION,IDS,LABELS,n,cleanSequence,sequenceFor,requiredRawTypes,resolveFromMaps,validFideIds,verifyTypes,loadMaps,checkTournament,reportText,runCurrent,createUi,install,get running(){return running;}};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
