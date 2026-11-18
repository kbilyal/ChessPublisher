/* Chess-Publisher v1.06.00-beta.60 — Post-Tournament Rating Report Corrections */
(()=>{
'use strict';
const VERSION='1.06.00-beta.60';
let installed=false;
function int(v){const n=parseInt(v,10);return Number.isInteger(n)?n:0;}
function t(){return typeof window.getCurrentTournament==='function'?window.getCurrentTournament():null;}
function ensure(tournament=t()){
  if(!tournament)return [];
  tournament.fideCompliance=tournament.fideCompliance||{};
  if(!Array.isArray(tournament.fideCompliance.ratingReportCorrections))tournament.fideCompliance.ratingReportCorrections=[];
  tournament.fideCompliance.ratingReportCorrections=tournament.fideCompliance.ratingReportCorrections.map((c,i)=>({
    id:String(c?.id||`rrc-${i+1}`),round:Math.max(1,int(c?.round)),whiteNo:Math.max(1,int(c?.whiteNo)),blackNo:Math.max(1,int(c?.blackNo)),
    result:['1','=','0'].includes(String(c?.result||''))?String(c.result):'=',note:String(c?.note||'').replace(/[\r\n]+/g,' ').trim().slice(0,120),
    at:String(c?.at||''),createdBy:String(c?.createdBy||'arbiter')
  })).filter(c=>c.whiteNo!==c.blackNo);
  return tournament.fideCompliance.ratingReportCorrections;
}
function pairingNo(player){
  if(!player)return 0;
  if(typeof window.pNo==='function'){const n=int(window.pNo(player));if(n>0)return n;}
  return Math.max(0,int(player.pairingNo||player.startNo||player.tpn||player.id));
}
function playerNos(tournament=t()){return new Set((tournament?.players||[]).map(pairingNo).filter(n=>n>0));}
function tournamentFinished(tournament=t()){
  if(!tournament)return false;
  const announced=Math.max(1,int(tournament?.settings?.rounds)||1);
  let completed=0,latest=0;
  try{completed=Math.max(0,int(window.getCompletedRounds?.()));}catch(_){}
  try{latest=Math.max(0,int(window.getLatestGeneratedRound?.()));}catch(_){}
  if(Math.max(completed,latest)>=announced)return true;
  const end=String(tournament?.settings?.endDate||'').trim();
  if(end){const ms=Date.parse(end);if(Number.isFinite(ms)&&ms<=Date.now())return true;}
  return false;
}
function validateCorrection(c,tournament=t()){
  const round=int(c?.round),whiteNo=int(c?.whiteNo),blackNo=int(c?.blackNo),result=String(c?.result||'');
  const announced=Math.max(1,int(tournament?.settings?.rounds)||1),nos=playerNos(tournament);
  const errors=[];
  if(!tournament)errors.push('Open a tournament first.');
  if(round<1||round>announced)errors.push(`Round must be between 1 and ${announced}.`);
  if(whiteNo<1||blackNo<1||whiteNo===blackNo)errors.push('White and Black must be two different pairing numbers.');
  if(nos.size&&(!nos.has(whiteNo)||!nos.has(blackNo)))errors.push('Both pairing numbers must belong to registered players.');
  if(!['1','=','0'].includes(result))errors.push('Result must be 1, =, or 0 from White’s perspective.');
  if(!tournamentFinished(tournament))errors.push('Rating-report corrections are available only after the tournament has finished.');
  return {ok:errors.length===0,errors,round,whiteNo,blackNo,result};
}
function addCorrection(c,{persist=true}={}){
  const tournament=t(),v=validateCorrection(c,tournament);if(!v.ok){const e=new Error(v.errors.join(' '));e.validationErrors=v.errors;throw e;}
  const list=ensure(tournament);
  // One rating-report game per player per round. Replacing a correction is safer
  // than allowing contradictory duplicate 001 alternatives.
  for(let i=list.length-1;i>=0;i--){const x=list[i];if(x.round===v.round&&(x.whiteNo===v.whiteNo||x.blackNo===v.whiteNo||x.whiteNo===v.blackNo||x.blackNo===v.blackNo))list.splice(i,1);}
  const item={id:`rrc-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,round:v.round,whiteNo:v.whiteNo,blackNo:v.blackNo,result:v.result,note:String(c?.note||'').replace(/[\r\n]+/g,' ').trim().slice(0,120),at:new Date().toISOString(),createdBy:'arbiter'};
  list.push(item);list.sort((a,b)=>a.round-b.round||a.whiteNo-b.whiteNo||a.blackNo-b.blackNo);
  if(typeof window.cpLogComplianceEvent==='function')window.cpLogComplianceEvent({type:'rating-report-correction',category:'RATING REPORT CORRECTION',level:2,round:item.round,message:`Post-tournament rating report correction recorded for pairing numbers ${item.whiteNo}-${item.blackNo}. Tournament pairings and standings remain unchanged.`,trf:false});
  if(persist&&typeof window.saveData==='function')window.saveData();return item;
}
function removeCorrection(id,{persist=true}={}){
  const tournament=t(),list=ensure(tournament),before=list.length,needle=String(id||'');
  tournament.fideCompliance.ratingReportCorrections=list.filter(x=>x.id!==needle);
  const changed=tournament.fideCompliance.ratingReportCorrections.length!==before;
  if(changed&&persist&&typeof window.saveData==='function')window.saveData();return changed;
}
function reciprocal(result){return result==='1'?'0':result==='0'?'1':'=';}
function parse001(line){
  const s=String(line||'');if(!s.startsWith('001'))return null;
  return {no:int(s.slice(4,8)),line:s};
}
function roundSlot(line,round){
  const start=91+(Math.max(1,int(round))-1)*10;
  if(String(line||'').length<start+10)return null;
  const s=String(line);return {opp:int(s.slice(start,start+4)),color:s.slice(start+5,start+6),result:s.slice(start+7,start+8),start};
}
function setField(line,start0,len,value,right=false){
  let s=String(line||''),v=String(value??'');if(s.length<start0+len)s=s.padEnd(start0+len,' ');v=(right?v.padStart(len,' '):v.padEnd(len,' ')).slice(0,len);return s.slice(0,start0)+v+s.slice(start0+len);
}
function setRoundSlot(line,round,opp,color,result){
  const start=91+(Math.max(1,int(round))-1)*10;
  let s=String(line||'');if(s.length<start+10)throw new Error(`TRF 001 record does not contain Round ${round}.`);
  s=setField(s,start,4,Math.max(0,int(opp)),true);s=setField(s,start+5,1,color);s=setField(s,start+7,1,result);return s;
}
function slotText(slot){if(!slot)return 'not recorded';return `${String(slot.opp||0).padStart(4,'0')} ${slot.color||'-'} ${slot.result||'-'}`;}
function correctionComment(c,oldW,oldB){
  const corrected=`${c.whiteNo} w-${c.blackNo} ${c.result} / ${c.blackNo} b-${c.whiteNo} ${reciprocal(c.result)}`;
  const original=`${c.whiteNo} ${slotText(oldW)} / ${c.blackNo} ${slotText(oldB)}`;
  const note=c.note?`; ${c.note}`:'';
  return `### R${c.round} RATING REPORT CORRECTION: rating submission uses ${corrected}; event standings/pairings retained original 001 data ${original}${note}`.slice(0,240);
}
function applyCorrectionsToTrf(text,tournament=t()){
  const corrections=ensure(tournament);if(!corrections.length)return {text:String(text||''),applied:0,comments:[]};
  const raw=String(text||''),eol=raw.includes('\r\n')?'\r\n':'\n',hadEnd=/[\r\n]$/.test(raw);
  const lines=raw.replace(/\r/g,'').split('\n');if(lines.length&&lines[lines.length-1]==='')lines.pop();
  const index=new Map();for(let i=0;i<lines.length;i++){const p=parse001(lines[i]);if(p&&p.no>0)index.set(p.no,i);}
  const comments=[];let applied=0;
  for(const c of corrections){
    const wi=index.get(c.whiteNo),bi=index.get(c.blackNo);if(wi===undefined||bi===undefined)throw new Error(`Rating-report correction R${c.round}: pairing number ${wi===undefined?c.whiteNo:c.blackNo} is missing from TRF 001 records.`);
    const oldW=roundSlot(lines[wi],c.round),oldB=roundSlot(lines[bi],c.round);if(!oldW||!oldB)throw new Error(`Rating-report correction R${c.round}: exported TRF does not include that round.`);
    lines[wi]=setRoundSlot(lines[wi],c.round,c.blackNo,'w',c.result);
    lines[bi]=setRoundSlot(lines[bi],c.round,c.whiteNo,'b',reciprocal(c.result));
    comments.push(correctionComment(c,oldW,oldB));applied++;
  }
  // Remove stale generated correction comments before adding the authoritative set.
  const filtered=lines.filter(line=>!/^### R\d+ RATING REPORT CORRECTION:/.test(line));filtered.push(...comments);
  return {text:filtered.join(eol)+(hadEnd?eol:''),applied,comments};
}
function ratingFileName(name){return /_FIDE_Rating_TRF(?:16|26)_/i.test(String(name||''));}
function wrapSaveText(){
  const original=window.cpSaveTextToTournamentTRF;if(typeof original!=='function'||original.__cpBeta60Wrapped)return false;
  const wrapped=async function(fileName,text){let out=text;if(ratingFileName(fileName)&&ensure().length){const x=applyCorrectionsToTrf(text);out=x.text;}return original.call(this,fileName,out);};
  wrapped.__cpBeta60Wrapped=true;wrapped.__cpBeta60Original=original;window.cpSaveTextToTournamentTRF=wrapped;return true;
}
function wrapBuildTRF26(){
  const original=window.buildTRF26;if(typeof original!=='function'||original.__cpBeta60Wrapped)return false;
  const wrapped=function(){const result=original.apply(this,arguments);if(result&&typeof result.text==='string'&&ensure().length){const x=applyCorrectionsToTrf(result.text);return {...result,text:x.text,ratingReportCorrections:x.applied};}return result;};
  wrapped.__cpBeta60Wrapped=true;wrapped.__cpBeta60Original=original;window.buildTRF26=wrapped;return true;
}
function listText(){const list=ensure();if(!list.length)return 'No post-tournament rating-report corrections are recorded.';return list.map((c,i)=>`${i+1}. Round ${c.round}: ${c.whiteNo} (White) – ${c.blackNo} (Black), ${c.result}${c.note?` — ${c.note}`:''}`).join('\n');}
async function manageCorrections(){
  const tournament=t();if(!tournament){await window.appAlert?.('Open a tournament first.','Rating Report Corrections','warning');return;}
  if(!tournamentFinished(tournament)){await window.appAlert?.('Rating Report Corrections become available after the tournament has finished. They are used only for FIDE rating submission and never change tournament standings or pairing history.','Rating Report Corrections','info');return;}
  const current=ensure(tournament);
  if(current.length){const command=await window.appPrompt?.(`${listText()}\n\nEnter A to add another correction, D followed by its number to delete one (for example D2), or leave blank to close.`,'','Rating Report Corrections');if(command===null||!String(command).trim())return;const cmd=String(command).trim();if(/^d\s*\d+$/i.test(cmd)){const n=int(cmd.replace(/\D/g,''));const target=current[n-1];if(target){removeCorrection(target.id);await window.appAlert?.('Correction removed.','Rating Report Corrections','success');}return;}if(!/^a$/i.test(cmd)){await window.appAlert?.('Use A to add or D followed by the correction number to delete.','Rating Report Corrections','warning');return;}}
  const announced=Math.max(1,int(tournament.settings?.rounds)||1);
  const round=await window.appPrompt?.(`Round number (1-${announced}):`,'','Add Rating Report Correction');if(round===null)return;
  const white=await window.appPrompt?.('Correct White pairing number:','','Add Rating Report Correction');if(white===null)return;
  const black=await window.appPrompt?.('Correct Black pairing number:','','Add Rating Report Correction');if(black===null)return;
  const result=await window.appPrompt?.('Correct result from White’s perspective: 1, =, or 0','','Add Rating Report Correction');if(result===null)return;
  const note=await window.appPrompt?.('Optional short note:','','Add Rating Report Correction');if(note===null)return;
  try{const item=addCorrection({round,whiteNo:white,blackNo:black,result:String(result).trim(),note});await window.appAlert?.(`Recorded for Round ${item.round}. This correction will be written only to FIDE Rating TRF exports; tournament pairings and standings remain unchanged.`,'Rating Report Corrections','success');}
  catch(err){await window.appAlert?.(err?.message||String(err),'Rating Report Corrections','error');}
}
function installButton(){
  if(typeof document==='undefined'||document.getElementById?.('cpRatingReportCorrectionsBtn'))return false;
  const buttons=[...document.querySelectorAll?.('button')||[]];const anchor=buttons.find(b=>/FIDE Rating TRF26/i.test(String(b.textContent||'')));if(!anchor)return false;
  const b=document.createElement('button');b.id='cpRatingReportCorrectionsBtn';b.type='button';b.textContent='Rating Report Corrections';b.title='Record post-tournament corrections used only for FIDE rating submission.';b.onclick=manageCorrections;anchor.insertAdjacentElement('afterend',b);return true;
}
function migrate(){const tournament=t();if(tournament)ensure(tournament);}
function install(){if(installed)return;installed=true;migrate();wrapSaveText();wrapBuildTRF26();installButton();try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){}try{const ver=document.getElementById('appVersion');if(ver)ver.textContent=`v${VERSION}`;}catch(_){}try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){} }
window.cpBeta60={VERSION,ensure,pairingNo,playerNos,tournamentFinished,validateCorrection,addCorrection,removeCorrection,reciprocal,parse001,roundSlot,setRoundSlot,correctionComment,applyCorrectionsToTrf,ratingFileName,wrapSaveText,wrapBuildTRF26,listText,manageCorrections,installButton,migrate,install};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
