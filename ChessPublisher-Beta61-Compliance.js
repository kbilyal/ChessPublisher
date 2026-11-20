/* Chess-Publisher v1.06.00-beta.61 — TRF26 Completeness */
(()=>{
'use strict';
const VERSION='1.06.00-beta.61';
let installed=false;
function tournament(){return typeof window.getCurrentTournament==='function'?window.getCurrentTournament():null;}
function int(v){const n=parseInt(v,10);return Number.isInteger(n)?n:0;}
function ratingFileName(name){return /_FIDE_Rating_TRF(?:16|26)_/i.test(String(name||''));}
function rangeFromName(name){const m=String(name||'').match(/_R(\d+)-R(\d+)/i);return m?{fromRound:Math.max(1,int(m[1])),toRound:Math.max(1,int(m[2]))}:{fromRound:1,toRound:999};}
function splitText(text){const raw=String(text||''),eol=raw.includes('\r\n')?'\r\n':'\n',hadEnd=/[\r\n]$/.test(raw);let lines=raw.replace(/\r/g,'').split('\n');if(lines.length&&lines[lines.length-1]==='')lines.pop();return {lines,eol,hadEnd};}
function joinText(lines,eol='\r\n',hadEnd=true){return lines.join(eol)+(hadEnd?eol:'');}
function ensureBaku(text){try{if(window.cpBeta44&&typeof window.cpBeta44.addBakuRecords==='function')return window.cpBeta44.addBakuRecords(text);}catch(_){}return String(text||'');}
function ensureUnusual299(text,{fromRound=1,toRound=999}={}){
  const api=window.cpBeta45;if(!api||typeof api.unusualAdjustments!=='function'||typeof api.blankAatLine!=='function')return String(text||'');
  const p=splitText(text),have=new Set(p.lines.filter(x=>/^299\s/.test(x)).map(x=>x.trimEnd()));
  for(const x of api.unusualAdjustments().filter(x=>x.round>=fromRound&&x.round<=toRound)){
    const line=api.blankAatLine(x.delta,x.round,x.pairNo).trimEnd();if(!have.has(line)){p.lines.push(line);have.add(line);}
  }
  return joinText(p.lines,p.eol,p.hadEnd);
}
function tieBreak212(){
  const api=window.cpBeta46;if(!api?.descriptors||typeof window.getSelectedTieBreaksInPriority!=='function')return '';
  try{const desc=window.getSelectedTieBreaksInPriority().map(t=>api.descriptors.get(String(t))).filter(Boolean);return desc.length?'212 '+['PTS',...desc].join(','):'';}catch(_){return '';}
}
function ensure212(text){const line=tieBreak212();if(!line)return String(text||'');const p=splitText(text),idx=p.lines.findIndex(x=>/^212\s/.test(x));if(idx>=0)p.lines[idx]=line;else{const first001=p.lines.findIndex(x=>/^001\s/.test(x));p.lines.splice(first001>=0?first001:p.lines.length,0,line);}return joinText(p.lines,p.eol,p.hadEnd);}
function generalComplianceComments({fromRound=1,toRound=999}={}){
  let c=null;try{c=typeof window.cpEnsureFideCompliance==='function'?window.cpEnsureFideCompliance():tournament()?.fideCompliance;}catch(_){c=tournament()?.fideCompliance;}
  if(!Array.isArray(c?.events))return [];
  return c.events.filter(e=>e?.trf!==false&&(!e.round||(Number(e.round)>=fromRound&&Number(e.round)<=toRound))).map(e=>{
    try{return typeof window.cpComplianceEventComment==='function'?window.cpComplianceEventComment(e):'';}catch(_){return '';}
  }).filter(Boolean);
}
function ensureComplianceComments(text,range={}){
  const comments=generalComplianceComments(range);if(!comments.length)return String(text||'');const p=splitText(text),have=new Set(p.lines.filter(x=>/^###\s/.test(x)));for(const line of comments){if(!have.has(line)){p.lines.push(line);have.add(line);}}return joinText(p.lines,p.eol,p.hadEnd);
}
function postProcessRatingTRF(text,{fromRound=1,toRound=999,includeLegacyPostProcessors=true}={}){
  let out=String(text||'');
  out=ensureBaku(out);
  if(includeLegacyPostProcessors){out=ensureUnusual299(out,{fromRound,toRound});
    // The current rating builder has already checked the exact 202/212 record.
    // Older reports without this full exchange header still use the legacy repair.
    if(!(/^182 Chess-Publisher Version /m.test(out)&&/^222 /m.test(out)&&/^(202|212) /m.test(out)))out=ensure212(out);}
  out=ensureComplianceComments(out,{fromRound,toRound});
  return out;
}
function wrapSaveText(){
  const original=window.cpSaveTextToTournamentTRF;if(typeof original!=='function'||original.__cpBeta61Wrapped)return false;
  const wrapped=async function(fileName,text){const range=rangeFromName(fileName);const out=ratingFileName(fileName)?postProcessRatingTRF(text,{...range,includeLegacyPostProcessors:true}):text;return original.call(this,fileName,out);};
  wrapped.__cpBeta61Wrapped=true;wrapped.__cpBeta61Original=original;window.cpSaveTextToTournamentTRF=wrapped;return true;
}
function wrapBuildTRF26(){
  const original=window.buildTRF26;if(typeof original!=='function'||original.__cpBeta61Wrapped)return false;
  const wrapped=function(...args){const result=original.apply(this,args);if(!result||typeof result.text!=='string')return result;const r=args?.[0]||{},fromRound=Math.max(1,int(r.fromRound)||1),toRound=Math.max(fromRound,int(result.toRound)||int(r.toRound)||999);return {...result,text:postProcessRatingTRF(result.text,{fromRound,toRound,includeLegacyPostProcessors:false}),trfCompletenessPostProcessed:true};};
  wrapped.__cpBeta61Wrapped=true;wrapped.__cpBeta61Original=original;window.buildTRF26=wrapped;return true;
}
function setVersion(){try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){}try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){}try{const v=document.getElementById('appVersion');if(v)v.textContent=`v${VERSION}`;}catch(_){} }
function install(){if(installed)return;installed=true;wrapSaveText();wrapBuildTRF26();setVersion();}
window.cpBeta61={VERSION,ratingFileName,rangeFromName,splitText,joinText,ensureBaku,ensureUnusual299,tieBreak212,ensure212,generalComplianceComments,ensureComplianceComments,postProcessRatingTRF,wrapSaveText,wrapBuildTRF26,install};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
