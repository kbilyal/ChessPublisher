/* Chess-Publisher v1.06.00-beta.51 — Tournament Rating Methods */
(function(){
'use strict';
const VERSION='v1.06.00-beta.51';
function tournament(){try{return getCurrentTournament();}catch(_){return null;}}
function players(t=tournament()){return Array.isArray(t?.players)?t.players:[];}
function fide(p){return Math.max(0,Number(p?.rating)||0);}
function national(p){return Math.max(0,Number(p?.nationalRating)||0);}
function manual(p){return Math.max(0,Number(p?.tournamentManualRating)||0);}
function methodValue(player,source){
  const f=fide(player),n=national(player),m=manual(player);
  switch(String(source||'fide')){
    case 'national': return n;
    case 'fide-national': return f||n;
    case 'national-fide': return n||f;
    case 'hbfn': return Math.max(f,n,m);
    case 'other': return m;
    default: return f;
  }
}
const originalStrength=typeof initialRankStrength==='function'?initialRankStrength:null;
window.initialRankStrength=function(player,source='fide'){
  if(['fide','national','fide-national','national-fide','hbfn','other'].includes(String(source)))return methodValue(player,source);
  return originalStrength?originalStrength(player,source):fide(player);
};
function methodCode(t=tournament()){
  const source=String(t?.settings?.initialRatingSource||'fide');
  if(source==='national')return 'NRO';
  if(source==='fide-national')return 'FIDON';
  if(source==='national-fide')return 'NIDOF';
  if(source==='other')return 'OTHER';
  if(source==='hbfn'){
    const manualChanges=players(t).some(p=>manual(p)>Math.max(fide(p),national(p)));
    return manualChanges?'OTHER':'HBFN';
  }
  return 'FIDE';
}
function usesNational(t=tournament()){
  const s=String(t?.settings?.initialRatingSource||'fide');
  return ['national','fide-national','national-fide','hbfn'].includes(s) && players(t).some(p=>national(p)>0);
}
function ratingFederations(t=tournament()){
  const set=new Set();
  for(const p of players(t)) if(national(p)>0){const fed=String(p?.nationalRatingFed||p?.fed||t?.settings?.country||'XXX').trim().toUpperCase();if(/^[A-Z]{3}$/.test(fed))set.add(fed);}
  return [...set].sort();
}
function trf172Records(t=tournament()){
  if(!usesNational(t))return [];
  const code=methodCode(t);
  return ratingFederations(t).map(fed=>`172 ${fed} ${code}`);
}
function setField(line,start,length,value){
  const need=start-1+length;let out=String(line||'').padEnd(need,' ');const v=String(value??'').slice(0,length).padEnd(length,' ');return out.slice(0,start-1)+v+out.slice(start-1+length);
}
function nrsRecords(rows,t=tournament()){
  if(!usesNational(t))return [];
  const result=[];
  for(const row of rows||[]){
    const id=Number(row?.id||row?.pairingNumber);const p=players(t).find(x=>Number(x?.pairingNumber)===id);if(!p||national(p)<=0)continue;
    const fed=String(p?.nationalRatingFed||p?.fed||t?.settings?.country||'XXX').trim().toUpperCase();if(!/^[A-Z]{3}$/.test(fed))continue;
    let line=' '.repeat(79);line=setField(line,1,3,fed);line=setField(line,5,4,String(id));line=setField(line,49,4,String(national(p)));result.push(line.replace(/\s+$/,''));
  }
  return result;
}
function parse172AndNrs(source,parsed){
  const lines=String(source||'').replace(/\r/g,'').split('\n');
  const methods=[];const nationalByNo=new Map();
  for(const line of lines){
    if(/^172\s/.test(line)){const fed=String(line.slice(4,7)).trim().toUpperCase(),code=String(line.slice(8,13)).trim().toUpperCase();if(fed&&code)methods.push({fed,code});continue;}
    if(/^[A-Z]{3}\s/.test(line)&&!/^\d{3}/.test(line)){const no=parseInt(line.slice(4,8).trim())||0,rtg=parseInt(line.slice(48,52).trim())||0;if(no&&rtg)nationalByNo.set(no,{rating:rtg,fed:line.slice(0,3).trim().toUpperCase()});}
  }
  for(const p of parsed?.players||[]){const n=nationalByNo.get(Number(p.pairingNumber));if(n){p.nationalRating=n.rating;p.nationalRatingFed=n.fed;if(window.cpBeta52)window.cpBeta52.assignNationalImport(p,n.rating,n.fed);}}
  const codes=[...new Set(methods.map(x=>x.code))];
  if(codes.length===1){const map={FIDE:'fide',NRO:'national',FIDON:'fide-national',NIDOF:'national-fide',HBFN:'hbfn',OTHER:'other'};parsed.meta=parsed.meta||{};parsed.meta.initialRatingSource=map[codes[0]]||parsed.meta.initialRatingSource;}
  return parsed;
}
const originalParser=typeof parseTRF26Tournament==='function'?parseTRF26Tournament:null;
if(originalParser){window.parseTRF26Tournament=function(text){return parse172AndNrs(text,originalParser(text));};}
function install(){
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,VERSION);}catch(_){}
  const ver=document.getElementById('appVersion');if(ver)ver.textContent=VERSION;
}
if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();setTimeout(install,0);}
window.cpBeta51={VERSION,methodValue,methodCode,usesNational,ratingFederations,trf172Records,nrsRecords,parse172AndNrs};
})();
