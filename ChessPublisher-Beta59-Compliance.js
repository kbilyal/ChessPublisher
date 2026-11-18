/* Chess-Publisher v1.06.00-beta.59 — Default Rating List Sequence */
(()=>{
'use strict';
const VERSION='1.06.00-beta.59';
const IDS={
  STANDARD:'fide-standard', RAPID:'fide-rapid', BLITZ:'fide-blitz',
  EFFECTIVE_RAPID:'effective-rapid', EFFECTIVE_BLITZ:'effective-blitz'
};
const LABELS={
  [IDS.STANDARD]:'FIDE Standard', [IDS.RAPID]:'FIDE Rapid', [IDS.BLITZ]:'FIDE Blitz',
  [IDS.EFFECTIVE_RAPID]:'Effective Rapid', [IDS.EFFECTIVE_BLITZ]:'Effective Blitz'
};
let installed=false;
function normalizedRatingType(value){
  const s=String(value||'').trim().toLowerCase();
  if(s==='standard')return 'Standard'; if(s==='rapid')return 'Rapid'; if(s==='blitz')return 'Blitz'; return 'Unrated';
}
function defaultSequenceFor(value){
  const type=normalizedRatingType(value);
  if(type==='Standard')return [IDS.STANDARD,IDS.RAPID,IDS.BLITZ];
  if(type==='Rapid')return [IDS.EFFECTIVE_RAPID,IDS.BLITZ];
  if(type==='Blitz')return [IDS.EFFECTIVE_BLITZ,IDS.RAPID];
  return [];
}
function cleanSequence(value){
  const allowed=new Set(Object.values(IDS)),seen=new Set(),out=[];
  for(const raw of Array.isArray(value)?value:[]){const id=String(raw||'').trim().toLowerCase();if(allowed.has(id)&&!seen.has(id)){seen.add(id);out.push(id);}}
  return out;
}
function isKnownDefaultSequence(sequence){
  const key=cleanSequence(sequence).join('|');
  return ['Standard','Rapid','Blitz','Unrated'].some(type=>defaultSequenceFor(type).join('|')===key);
}
function ensureSettings(settings,{migrate=false}={}){
  if(!settings||typeof settings!=='object')return {changed:false,sequence:[],mode:'default'};
  const expected=defaultSequenceFor(settings.tournamentRatingType);
  const hasMode=settings.ratingListSequenceMode==='default'||settings.ratingListSequenceMode==='custom';
  const current=cleanSequence(settings.ratingListSequence);
  let mode=hasMode?settings.ratingListSequenceMode:'';
  if(!mode){
    // Legacy tournaments did not have a sequence. A pre-existing valid array is
    // treated as user-owned unless it exactly matches one of our canonical defaults.
    mode=current.length?(isKnownDefaultSequence(current)?'default':'custom'):'default';
  }
  let next=current;
  if(mode==='default')next=expected;
  const changed=JSON.stringify(current)!==JSON.stringify(next)||settings.ratingListSequenceMode!==mode||!Array.isArray(settings.ratingListSequence);
  settings.ratingListSequence=next.slice();
  settings.ratingListSequenceMode=mode;
  settings.ratingListSequenceRatingType=normalizedRatingType(settings.tournamentRatingType);
  if(migrate&&!settings.ratingListSequenceEstablishedBy)settings.ratingListSequenceEstablishedBy='beta59-migration';
  return {changed,sequence:next.slice(),mode};
}
function syncTournament(t,{persist=false,migrate=false}={}){
  if(!t?.settings)return {changed:false,sequence:[],mode:'default'};
  const out=ensureSettings(t.settings,{migrate});
  if(out.changed&&persist&&typeof window.saveData==='function')window.saveData();
  return out;
}
function markCustom(t,sequence,{persist=true}={}){
  if(!t?.settings)return [];
  const clean=cleanSequence(sequence);
  t.settings.ratingListSequence=clean;
  t.settings.ratingListSequenceMode='custom';
  t.settings.ratingListSequenceRatingType=normalizedRatingType(t.settings.tournamentRatingType);
  t.settings.ratingListSequenceEstablishedBy='user';
  if(persist&&typeof window.saveData==='function')window.saveData();
  return clean.slice();
}
function restoreDefault(t,{persist=true}={}){
  if(!t?.settings)return [];
  t.settings.ratingListSequenceMode='default';
  t.settings.ratingListSequenceEstablishedBy='default';
  const out=syncTournament(t,{persist:false});
  if(persist&&typeof window.saveData==='function')window.saveData();
  return out.sequence;
}
function sequenceLabels(sequence){return cleanSequence(sequence).map(id=>LABELS[id]);}
function wrapCreateEmptyTournament(){
  const original=window.createEmptyTournament;
  if(typeof original!=='function'||original.__cpBeta59Wrapped)return false;
  const wrapped=function(){const t=original.apply(this,arguments);syncTournament(t,{migrate:false});if(t?.settings)t.settings.ratingListSequenceEstablishedBy='default';return t;};
  wrapped.__cpBeta59Wrapped=true;wrapped.__cpBeta59Original=original;window.createEmptyTournament=wrapped;return true;
}
function wrapSaveAll(){
  const original=window.saveAll;
  if(typeof original!=='function'||original.__cpBeta59Wrapped)return false;
  const wrapped=function(){const before=window.getCurrentTournament?.()?.settings?.tournamentRatingType;const result=original.apply(this,arguments);const t=window.getCurrentTournament?.();if(t?.settings){const out=syncTournament(t,{persist:false});if(out.changed&&before!==t.settings.tournamentRatingType&&typeof window.saveData==='function')window.saveData();}return result;};
  wrapped.__cpBeta59Wrapped=true;wrapped.__cpBeta59Original=original;window.saveAll=wrapped;return true;
}
function wrapTypeChange(){
  const original=window.tournamentRatingTypeChanged;
  if(typeof original!=='function'||original.__cpBeta59Wrapped)return false;
  const wrapped=function(){const r=original.apply(this,arguments);const t=window.getCurrentTournament?.();if(t?.settings)syncTournament(t,{persist:true});return r;};
  wrapped.__cpBeta59Wrapped=true;wrapped.__cpBeta59Original=original;window.tournamentRatingTypeChanged=wrapped;return true;
}
function migrateLoadedTournaments(){
  const tournaments=window.data?.tournaments||{};let changed=false;
  for(const t of Object.values(tournaments)){const r=syncTournament(t,{migrate:true});changed=changed||r.changed;}
  if(changed&&typeof window.saveData==='function')window.saveData();
  return changed;
}
function currentSequence(){const t=window.getCurrentTournament?.();return cleanSequence(t?.settings?.ratingListSequence);}
function install(){
  if(installed)return;installed=true;
  wrapCreateEmptyTournament();wrapSaveAll();wrapTypeChange();migrateLoadedTournaments();
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){}
  try{const ver=document.getElementById('appVersion');if(ver)ver.textContent=`v${VERSION}`;}catch(_){}
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){}
}
window.cpBeta59={VERSION,IDS,LABELS,normalizedRatingType,defaultSequenceFor,cleanSequence,isKnownDefaultSequence,ensureSettings,syncTournament,markCustom,restoreDefault,sequenceLabels,currentSequence,wrapCreateEmptyTournament,wrapSaveAll,wrapTypeChange,migrateLoadedTournaments,install};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
