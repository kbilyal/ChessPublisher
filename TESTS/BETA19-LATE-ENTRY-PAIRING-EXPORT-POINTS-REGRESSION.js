"use strict";
const fs=require("fs");
const path=require("path");
const vm=require("vm");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"ChessPublisher.html"),"utf8");
const assert=(v,m)=>{if(!v)throw new Error(`FAIL: ${m}`);console.log(`PASS: ${m}`);};

assert(/data-chesspublisher-version="1\.06\.00-beta\.(?:19|[2-9][0-9]|[1-9][0-9]{2,})(?:-r\d+)?"/.test(html),"visible desktop branding is beta.19 or newer cumulative");
assert(/CP-BETA19-EXPLICIT-LATE-ENTRY/.test(html),"explicit Late Entry patch marker exists");
assert(/id="setLateEntryBtn"/.test(html),"Registration has a Set Late Entry button");
assert(/function playerHasEverAppearedInGeneratedPairing\(/.test(html),"Late Entry has a generated-pairing history guard");
assert(/boards\.some\(board=>String\(board\?\.whiteKey\|\|""\)===key \|\| String\(board\?\.blackKey\|\|""\)===key\)/.test(html),"history guard checks both colours in every generated board");
assert(/isRoundRobinTournament\(tournament\)/.test(html),"Round Robin is excluded from Swiss Late Entry workflow");
assert(/const joinRound=latest\+1/.test(html),"Late Entry starts from the next generated round");
assert(/player\.joinedFromRound=joinRound/.test(html),"Late Entry persists joinedFromRound");
assert(/player\.attendance="present"/.test(html),"Late Entry reactivates the player as Present");
assert(/clearPlayerParticipationFromRound\(key,joinRound,declared\)/.test(html),"future Exclude/BYE overrides are cleared without touching history");
assert(/engine\.needsResort=true/.test(html),"Late Entry requires Starting List Resort before next pairing");
assert(/playerHasEverAppearedInGeneratedPairing\(originalIndex,tournament\)/.test(html),"mutation is re-guarded against pairing-history changes");

function extractFunction(src,name){
  const marker=`function ${name}(`;
  const i=src.indexOf(marker);if(i<0)return "";
  let brace=src.indexOf("{",i+marker.length), depth=0, quote=null, esc=false;
  for(let j=brace;j<src.length;j++){
    const c=src[j];
    if(quote){ if(esc)esc=false; else if(c==="\\\\")esc=true; else if(c===quote)quote=null; continue; }
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==="{")depth++;
    else if(c==="}"&&--depth===0)return src.slice(i,j+1);
  }
  return "";
}
const historyFn=extractFunction(html,"playerHasEverAppearedInGeneratedPairing");
const stateFn=extractFunction(html,"getSelectedLateEntryState");
assert(historyFn&&stateFn,"Late Entry guard/state functions can be isolated");

function lateState({paired=false,rr=false,latest=2,declared=7,join=1,attendance="absent"}={}){
  const player={name:"Late Player",joinedFromRound:join,attendance,_key:"p-late"};
  const other={name:"Other",_key:"p-other"};
  const tournament={players:[player,other],settings:{rounds:String(declared)},pairings:{liveBoards:{}}};
  if(paired)tournament.pairings.liveBoards["1"]=[{board:1,whiteKey:"p-late",blackKey:"p-other",result:"1 - 0"}];
  let selectedPlayerIndexes=new Set([0]);
  const ctx={
    selectedPlayerIndexes,
    getCurrentTournament:()=>tournament,
    isRoundRobinTournament:()=>rr,
    playerKey:(p)=>p._key,
    getLatestGeneratedRoundForTournament:()=>latest,
    getDeclaredTournamentRounds:()=>declared,
    getPlayerJoinRound:(p)=>Number(p.joinedFromRound)||1,
    getPlayerAttendance:(p)=>p.attendance==="absent"?"absent":"present",
    console
  };
  ctx.window=ctx;ctx.globalThis=ctx;
  vm.createContext(ctx);
  vm.runInContext(historyFn+"\n"+stateFn,ctx);
  return ctx.getSelectedLateEntryState();
}
assert(lateState({paired:false,latest:2,declared:7}).ok===true,"never-paired Swiss player becomes eligible for Late Entry after Round 2");
assert(lateState({paired:true,latest:2,declared:7}).ok===false,"player already used in a generated pairing is rejected");
assert(lateState({rr:true,latest:2,declared:7}).ok===false,"Round Robin player is rejected by Swiss Late Entry workflow");
assert(lateState({paired:false,latest:7,declared:7}).ok===false,"Late Entry is rejected after the final declared round");
assert(lateState({paired:false,latest:2,declared:7,join:3,attendance:"present"}).already===true,"already-correct Late Entry state is detected without duplicate mutation");

assert(/CP-BETA19-PAIRINGS-EXPORT-CURRENT-POINTS/.test(html),"pairing export points patch marker exists");
assert(/const displayedRound=getSelectedPairingRoundNumber\(\);[\s\S]{0,120}pairingPointsBeforeRound\(displayedRound\)/.test(html),"export rows calculate points before the selected round");
assert(/whitePoints:white\?formatPairingPoints\(pointsBeforeRound\.get\(b\.whiteKey\)\):""/.test(html),"white current points are exported");
assert(/blackPoints:black\?formatPairingPoints\(pointsBeforeRound\.get\(b\.blackKey\)\):""/.test(html),"black current points are exported");
assert(/options\.points&&pts/.test(html)&&/pairingsExportPlayerMeta/.test(html),"option-driven TXT/PDF export can include current points for both players");
assert(/whitePoints:white\?formatPairingPoints/.test(html)&&/blackPoints:black\?formatPairingPoints/.test(html),"pairing export data still carries both point values");
assert(/buildPairingsReadableHtml/.test(html)&&/buildPairingsReadableText/.test(html),"readable PDF/TXT export paths preserve point-aware pairing data");

const pointsFn=extractFunction(html,"pairingPointsBeforeRound");
const fmtFn=extractFunction(html,"formatPairingPoints");
assert(pointsFn&&fmtFn,"pairing score-before-round helpers remain present");
const rows=[
  {key:"A",rounds:[{points:1},{points:0.5},{points:1}]},
  {key:"B",rounds:[{points:0},{points:0.5},{points:0}]}
];
const ctx2={tournamentState:()=>({rows}),console};ctx2.window=ctx2;ctx2.globalThis=ctx2;vm.createContext(ctx2);vm.runInContext(pointsFn+"\n"+fmtFn,ctx2);
const before3=ctx2.pairingPointsBeforeRound(3);
assert(ctx2.formatPairingPoints(before3.get("A"))==="1.5","Round 3 export shows White score from Rounds 1-2 only");
assert(ctx2.formatPairingPoints(before3.get("B"))==="0.5","Round 3 export shows Black score from Rounds 1-2 only");

console.log("BETA19-LATE-ENTRY-PAIRING-EXPORT-POINTS-REGRESSION: PASS");
