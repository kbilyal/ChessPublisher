/* Chess-Publisher v1.06.00-beta.63 — Round Robin Manual Pairing Coverage Validation */
(()=>{
'use strict';
const VERSION='1.06.00-beta.63';
function currentTournament(){return window.getCurrentTournament?.()||null;}
function cleanCycles(value){const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=4?n:1;}
function playerKeys(t=currentTournament()){
  if(!t)return [];
  try{
    const rows=window.tournamentState?.().rows;
    if(Array.isArray(rows)&&rows.length)return rows.map(r=>String(r?.key||'')).filter(Boolean);
  }catch(_){ }
  return (t.players||[]).map((p,i)=>{
    try{return String(window.playerKey?.(p,i)||'');}catch(_){return '';}
  }).filter(Boolean);
}
function validateCoverage(schedule,keys,cycles,validator=window.validateRoundRobinSchedule){
  const unique=[...new Set((Array.isArray(keys)?keys:[]).map(x=>String(x||'')).filter(Boolean))];
  cycles=cleanCycles(cycles);
  if(unique.length<2)return {ok:false,message:'Round Robin coverage verification requires at least two players.',players:unique.length,cycles};
  if(typeof validator!=='function')return {ok:false,message:'Round Robin coverage validator is not available.',players:unique.length,cycles};
  try{
    validator(schedule&&typeof schedule==='object'?schedule:{},unique,cycles);
    return {ok:true,message:'',players:unique.length,cycles};
  }catch(err){
    return {ok:false,message:err?.message||String(err),players:unique.length,cycles};
  }
}
function validateManualRoundRobinCoverage(t=currentTournament()){
  if(!t)return {ok:false,message:'No tournament is selected.',players:0,cycles:1};
  const cycles=cleanCycles(t.settings?.roundRobinCycles);
  return validateCoverage(t.pairings?.liveBoards||{},playerKeys(t),cycles,window.validateRoundRobinSchedule);
}
function install(){
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){ }
  try{const ver=document.getElementById('appVersion');if(ver)ver.textContent=`v${VERSION}`;}catch(_){ }
}
window.cpBeta63={VERSION,cleanCycles,playerKeys,validateCoverage,validateManualRoundRobinCoverage,install};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
