/* Chess-Publisher v1.06.00-beta.67 — Published Pairing Order Compliance */
(()=>{
'use strict';
const VERSION='1.06.00-beta.67';
const RULE='FIDE C.04.2 3.6';
function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function tpnOf(player){return Math.max(0,parseInt(player?.pairingNumber||player?.pairingNo)||0);}
function isBaku(t){return String(t?.settings?.accelerationMethod||'').toUpperCase()==='BAKU';}
function bakuGroupSet(t){
  const keys=t?.pairings?.engine?.bakuGroupKeys;
  return new Set(Array.isArray(keys)?keys.map(String):[]);
}
function actualPoints(round,key){
  try{return n(window.pairingPointsBeforeRound?.(round)?.get(key));}catch(_){return 0;}
}
function virtualPoints(t,round,key){
  if(!isBaku(t))return 0;
  const group=bakuGroupSet(t);
  if(!group.size)return null;
  if(!group.has(String(key)))return 0;
  try{return n(window.cpBeta44?.bakuVirtual?.(round));}catch(_){return null;}
}
function playerScore(t,round,key){
  const actual=actualPoints(round,key);
  const virtual=virtualPoints(t,round,key);
  if(virtual===null)return {actual,virtual:null,total:null};
  return {actual,virtual,total:actual+virtual};
}
function entry(board,index,round,t){
  const whiteKey=String(board?.whiteKey||''),blackKey=String(board?.blackKey||'');
  const real=!!whiteKey&&!!blackKey;
  if(!real)return {board,index,real:false,whiteKey,blackKey,signature:`BYE:${whiteKey||blackKey}:${String(board?.result||'')}`};
  const white=window.resolveRegisteredPlayer?.(whiteKey),black=window.resolveRegisteredPlayer?.(blackKey);
  const sw=playerScore(t,round,whiteKey),sb=playerScore(t,round,blackKey);
  const tw=tpnOf(white),tb=tpnOf(black);
  if(sw.total===null||sb.total===null)return {board,index,real:true,invalid:'baku-group-unavailable',whiteKey,blackKey,signature:[whiteKey,blackKey].sort().join('|')};
  let hrpTpn=0;
  if(sw.total>sb.total)hrpTpn=tw;
  else if(sb.total>sw.total)hrpTpn=tb;
  else hrpTpn=Math.min(tw||Number.MAX_SAFE_INTEGER,tb||Number.MAX_SAFE_INTEGER);
  return {
    board,index,real:true,whiteKey,blackKey,whiteTPN:tw,blackTPN:tb,
    whiteScore:sw.total,blackScore:sb.total,
    highestScore:Math.max(sw.total,sb.total),sumScore:sw.total+sb.total,hrpTpn,
    signature:[whiteKey,blackKey].sort().join('|')
  };
}
function compareEntries(a,b){
  if(a.real!==b.real)return a.real?-1:1;
  if(!a.real)return a.index-b.index;
  return (b.highestScore-a.highestScore)||(b.sumScore-a.sumScore)||(a.hrpTpn-b.hrpTpn)||(a.index-b.index);
}
function normalizedPublicationBoards(boards){
  const list=(Array.isArray(boards)?boards:[]).map((b,index)=>({board:b,index,real:!!b?.whiteKey&&!!b?.blackKey}));
  list.sort((a,b)=>a.real===b.real?a.index-b.index:(a.real?-1:1));
  return list.map((x,index)=>({...x.board,board:index+1}));
}
function auditBoards(boards,round,t=window.getCurrentTournament?.()){
  const normalized=normalizedPublicationBoards(boards);
  const actual=normalized.map((b,index)=>entry(b,index,round,t));
  const invalid=actual.find(x=>x.invalid);
  if(invalid)return {ok:false,reason:invalid.invalid,round,actual,expected:[]};
  const expected=actual.slice().sort(compareEntries);
  const actualOrder=actual.map(x=>x.signature),expectedOrder=expected.map(x=>x.signature);
  const ok=actualOrder.length===expectedOrder.length&&actualOrder.every((x,i)=>x===expectedOrder[i]);
  return {ok,reason:ok?'':'pair-order',round,actual,expected,actualOrder,expectedOrder};
}
function selectedRound(){try{return Number(window.getSelectedPairingRoundNumber?.())||1;}catch(_){return 1;}}
function currentBoards(t,round){
  const src=t?.pairings?.liveBoards?.[String(round)];
  return Array.isArray(src)?src:[];
}
function auditCurrentRound(){
  const t=window.getCurrentTournament?.();const round=selectedRound();
  if(!t)return {ok:false,reason:'no-tournament',round,actual:[],expected:[]};
  return auditBoards(currentBoards(t,round),round,t);
}
function explain(audit){
  if(audit?.reason==='baku-group-unavailable')return 'Baku acceleration is active but the acceleration group metadata is unavailable. Pairing publication is blocked to avoid using an unverified board order.';
  if(audit?.reason==='pair-order')return `The current board order does not satisfy ${RULE}: highest score of the higher-ranked player, then highest combined score, then lowest TPN of the higher-ranked player.`;
  return `Pairing publication order could not be verified (${audit?.reason||'unknown'}).`;
}
async function guardPublication(){
  const audit=auditCurrentRound();
  if(audit.ok)return true;
  try{await window.appAlert?.(`${explain(audit)}\n\nNothing was published or renumbered.`, 'Pairing Publication Order','error');}catch(_){ }
  return false;
}
function installGuards(){
  if(typeof window.runPairingsExport==='function'&&!window.__cpBeta67RunPairingsExport){
    window.__cpBeta67RunPairingsExport=window.runPairingsExport;
    window.runPairingsExport=async function(...args){if(!(await guardPublication()))return false;return window.__cpBeta67RunPairingsExport.apply(this,args);};
  }
  if(typeof window.publishProgramPairingsTelegram==='function'&&!window.__cpBeta67PublishProgramPairingsTelegram){
    window.__cpBeta67PublishProgramPairingsTelegram=window.publishProgramPairingsTelegram;
    window.publishProgramPairingsTelegram=async function(...args){if(!(await guardPublication()))return false;return window.__cpBeta67PublishProgramPairingsTelegram.apply(this,args);};
  }
}
function install(){
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){ }
  try{const ver=document.getElementById('appVersion');if(ver)ver.textContent=`v${VERSION}`;}catch(_){ }
  installGuards();
}
window.cpBeta67={VERSION,RULE,tpnOf,isBaku,bakuGroupSet,actualPoints,virtualPoints,playerScore,entry,compareEntries,normalizedPublicationBoards,auditBoards,auditCurrentRound,explain,guardPublication,installGuards,install};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
