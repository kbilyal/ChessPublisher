"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"ChessPublisher.html"),"utf8");
const assert=(v,m)=>{if(!v)throw new Error(`FAIL: ${m}`);console.log(`PASS: ${m}`);};

assert(/<title>Chess-Publisher v1\.06\.00-beta\.(?:25|2[7-9]|[3-9]\d)(?:-r\d+)?<\/title>/.test(html),"visible branding is beta.25 or newer cumulative");
assert(/CP-BETA25-DELETE-ANYTIME/.test(html),"delete-anytime marker exists");
assert(/function isPlayerDeletionLocked\(\)[\s\S]{0,180}return false;/.test(html),"Delete is no longer locked after tournament start");
assert(/registrationDeleted=true/.test(html)&&/registrationDeletedFromRound=start/.test(html),"post-start Delete uses a historical tombstone with a future eligibility boundary");
assert(/Existing Rounds 1–\$\{latest\} and all results will remain unchanged/.test(html),"Swiss delete confirmation explicitly preserves old rounds/results");
assert(/Berger schedule has already been generated/.test(html)&&/will NOT be rewritten or renumbered/.test(html),"Round Robin delete preserves the generated Berger schedule");
assert(/filter\(p=>!isPlayerRegistrationDeleted\(p\)\)/.test(html),"active Registration/next-round UI filters historical tombstones");
assert(/isPlayerEligibleForRound\(row\.key,round\)/.test(html),"expected pairing coverage uses authoritative eligibility");
assert(/!isPlayerEligibleForRound\(row\.key,next\)/.test(html),"Gacrux unpaired list uses authoritative eligibility");
assert(/if\(!isPlayerEligibleForRound\(row\.key,round\)\) return false;/.test(html),"local Swiss fallback uses authoritative eligibility");
assert(/validateStableHistoryReferences\(t\)/.test(html),"Delete mutation validates historical player references");
assert(/Starting Rank \/ TPN will NOT be renumbered/.test(html),"post-start Delete preserves TPNs");

function extractFunction(name){
  const re=new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m=re.exec(html); if(!m)throw new Error(`missing function ${name}`);
  const start=m.index,brace=html.indexOf("{",m.index+m[0].length);
  let depth=0,quote="",esc=false,line=false,block=false;
  for(let i=brace;i<html.length;i++){
    const c=html[i],n=html[i+1]||"";
    if(line){if(c==="\n")line=false;continue;}
    if(block){if(c==="*"&&n==="/"){block=false;i++;}continue;}
    if(quote){if(esc){esc=false;continue;}if(c==="\\"){esc=true;continue;}if(c===quote)quote="";continue;}
    if(c==="/"&&n==="/"){line=true;i++;continue;}
    if(c==="/"&&n==="*"){block=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==="{")depth++;
    else if(c==="}"&&--depth===0)return html.slice(start,i+1);
  }
  throw new Error(`unterminated ${name}`);
}

const fnNames=[
  "getLatestGeneratedRoundForTournament","isPlayerRegistrationDeleted","getPlayerRegistrationDeletedFromRound",
  "isPlayerEligibleForRound","validateStableHistoryReferences","markPlayerDeletedFromRegistration","deleteSelectedPlayers",
  "getVisibleRegisteredPlayers","getExpectedPairingKeys","generateLocalSwissFallback","requestLocalGacruxPairs"
];
const src=fnNames.map(extractFunction).join("\n");

function makeTournament(started=true){
  const players=[
    {localKey:"A",name:"Alpha",pairingNumber:1,rating:2200,attendance:"present",joinedFromRound:1},
    {localKey:"B",name:"Bravo",pairingNumber:2,rating:2100,attendance:"present",joinedFromRound:1},
    {localKey:"C",name:"Charlie",pairingNumber:3,rating:2000,attendance:"present",joinedFromRound:1},
    {localKey:"D",name:"Delta",pairingNumber:4,rating:1900,attendance:"present",joinedFromRound:1}
  ];
  return {
    players,settings:{rounds:"5"},pairings:{engine:{excludeRemaining:{},excludeRounds:{},manualByes:{},fixedBoards:{},firstRoundRegistrationLocked:started},liveBoards:started?{
      "1":[{board:1,whiteKey:"A",blackKey:"B",result:"1-0"},{board:2,whiteKey:"C",blackKey:"D",result:"½-½"}]
    }:{} }
  };
}

async function runDeleteCase(started,seedPendingResort=false){
  const t=makeTournament(started);
  if(seedPendingResort){t.pairings.engine.needsResort=true;t.pairings.engine.rankCorrectionNeedsResort=true;}
  const statuses=[];
  const context={
    console,Date,Math,Number,String,Set,
    selectedPlayerIndexes:new Set([1]),lastClickedSortedIndex:null,
    getCurrentTournament:()=>t,
    getPairingEngineConfig:()=>t.pairings.engine,
    isRoundRobinTournament:()=>false,
    getDeclaredTournamentRounds:()=>5,
    getDeclaredTournamentRounds_:()=>5,
    playerKey:(p)=>p.localKey,
    getPlayerJoinRound:(p)=>Number(p.joinedFromRound)||1,
    getPlayerByStableKey:(key)=>t.players.find(p=>p.localKey===key)||null,
    clearPlayerParticipationFromRound:(key,start,end)=>{
      for(let r=start;r<=end;r++){
        const row=t.pairings.engine.manualByes[String(r)];if(row)delete row[key];
      }
      delete t.pairings.engine.excludeRounds[key];
      delete t.pairings.engine.excludeRemaining[key];
    },
    cleanupRemovedRegistrationKeys:(tour,keys)=>{
      for(const key of keys){delete tour.pairings.engine.excludeRemaining[key];delete tour.pairings.engine.excludeRounds[key];}
    },
    appConfirm:async()=>true,appAlert:async()=>{},
    cpBeginCriticalMutationCheckpoint:async()=>({ok:true}),cpCommitCriticalMutationCheckpoint:async()=>true,cpRestoreCriticalMutationCheckpoint:async()=>true,
    saveData(){},renderRegistered(){},updatePlayerCount(){},renderNextRoundPlayerManager(){},updateRegistrationWorkflowUI(){},updateGacruxPanel(){},
    setStatus:(s)=>statuses.push(s),clearSelection(){context.selectedPlayerIndexes.clear();},
    getLatestGeneratedRound:()=>started?1:0,
    document:{getElementById:(id)=>id==="startingRankSearch"?{value:""}:null},
    getSortedPlayers:()=>t.players.map((p,i)=>({...p,originalIndex:i})),
    tournamentState:()=>({rows:t.players.map((p,i)=>({key:p.localKey,joinedFromRound:p.joinedFromRound||1,id:p.pairingNumber}))}),
    getManualByesForRound:()=>({}),isPlayerSyncedAbsent:(key)=>t.players.find(p=>p.localKey===key)?.attendance==="absent",
    isPlayerExcludedForRound:(key,round)=>Number(t.pairings.engine.excludeRemaining[key]||0)>0&&Number(round)>=Number(t.pairings.engine.excludeRemaining[key])
  };
  context.window=context;context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(src,context,{filename:"beta25-delete-functions.js"});
  await context.deleteSelectedPlayers();
  return {t,context,statuses};
}

(async()=>{
  const hard=await runDeleteCase(false);
  assert(hard.t.players.length===3,"pre-Round-1 Delete physically removes the selected player");
  assert(!hard.t.players.some(p=>p.localKey==="B"),"pre-Round-1 deleted player is absent from the roster object");
  assert(hard.t.pairings.engine.firstRoundRegistrationNeedsResort===true,"pre-Round-1 Delete requires Resort");

  const soft=await runDeleteCase(true,true);
  const b=soft.t.players.find(p=>p.localKey==="B");
  assert(soft.t.players.length===4&&!!b,"post-start Delete preserves the historical player object");
  assert(b.registrationDeleted===true&&b.registrationDeletedFromRound===2,"post-start Delete starts withdrawal at the next round");
  assert(b.attendance==="absent","post-start Delete makes the player non-pairable by presence semantics");
  assert(soft.t.pairings.engine.excludeRemaining.B===2,"post-start Delete creates a future exclusion boundary");
  assert(soft.t.pairings.engine.needsResort===true&&soft.t.pairings.engine.rankCorrectionNeedsResort===true,"post-start Delete preserves unrelated pending Resort/rank-correction gates");
  assert(JSON.stringify(soft.t.pairings.liveBoards["1"])===JSON.stringify([
    {board:1,whiteKey:"A",blackKey:"B",result:"1-0"},{board:2,whiteKey:"C",blackKey:"D",result:"½-½"}
  ]),"existing generated pairing/results remain byte-logically unchanged");
  assert(soft.context.validateStableHistoryReferences(soft.t)===true,"historical board references still resolve after Delete");
  assert(soft.context.isPlayerEligibleForRound("B",1)===true,"deleted player remains historically eligible before the deletion boundary");
  assert(soft.context.isPlayerEligibleForRound("B",2)===false,"deleted player is ineligible from the next round onward");
  const visible=soft.context.getVisibleRegisteredPlayers();
  assert(visible.length===3&&!visible.some(p=>p.localKey==="B"),"deleted player disappears from active Registration UI");
  const expected=soft.context.getExpectedPairingKeys(2);
  assert(expected.length===3&&!expected.includes("B"),"next-round pairing coverage excludes the deleted player");
  assert(["A","C","D"].every(k=>expected.includes(k)),"all remaining active players stay in pairing coverage");

  // Pairing-path integration: the real Gacrux request builder must send the
  // soft-deleted player as unpaired while leaving every other active player pairable.
  let capturedRequest=null;
  soft.context.location={protocol:"http:",hostname:"127.0.0.1"};
  soft.context.getInitialTopColorForEngine=()=>"w";
  soft.context.buildPairingEngineTRF=()=>"TRF-DUMMY";
  soft.context.fetchLocalEngine=async(path,opts)=>{
    capturedRequest={path,body:JSON.parse(opts.body)};
    return {ok:false,status:599,json:async()=>({ok:false,error:"capture-only"})};
  };
  soft.context.saveIndependentPairingCheckerResult=()=>{};
  try{await soft.context.requestLocalGacruxPairs(2,"w");}catch(err){assert(/capture-only/.test(String(err)),"Gacrux request capture stops after request construction");}
  assert(capturedRequest&&capturedRequest.path==="/pair","Gacrux pairing request is constructed");
  assert(capturedRequest.body.unpaired.includes(2),"Gacrux unpaired ID list contains deleted player TPN 2");
  assert(!capturedRequest.body.unpaired.includes(1)&&!capturedRequest.body.unpaired.includes(3)&&!capturedRequest.body.unpaired.includes(4),"Gacrux unpaired ID list does not exclude remaining active players");

  // Local fallback integration: verify the same eligibility boundary is used
  // when Gacrux is unavailable, so the safety rule cannot diverge by engine path.
  let fallbackActive=[];
  soft.context.localSwissChooseBye=(active)=>{fallbackActive=active.map(x=>x.key);return active[active.length-1]||null;};
  soft.context.localSwissPairRows=(active)=>active.length>=2?[{white:active[0],black:active[1]}]:[];
  soft.context.injectScheduledByesForRound=(round,boards)=>boards;
  soft.context.applyFixedBoardAssignments=(boards)=>boards;
  soft.context.validateRoundCoverage=()=>true;
  const fallbackBoards=soft.context.generateLocalSwissFallback(2);
  assert(!fallbackActive.includes("B"),"local Swiss fallback active set excludes deleted player");
  assert(!fallbackBoards.some(board=>board.whiteKey==="B"||board.blackKey==="B"),"local Swiss fallback never pairs deleted player");
  assert(fallbackBoards.filter(board=>board.result==="PAB").length===1,"odd remaining Swiss field produces exactly one PAB after Delete");
  assert(["A","C","D"].includes(fallbackBoards.find(board=>board.result==="PAB")?.whiteKey),"PAB is assigned only among remaining active players");

  // Save/reopen contract: post-start deletion metadata is JSON-persistent and
  // historical R1 boards still reference the retained tombstone key.
  const reopened=JSON.parse(JSON.stringify(soft.t));
  const reopenedB=reopened.players.find(p=>p.localKey==="B");
  assert(reopenedB?.registrationDeleted===true&&reopenedB?.registrationDeletedFromRound===2,"Delete tombstone survives JSON save/reopen");
  assert(reopened.pairings.liveBoards["1"][0].blackKey==="B","saved historical pairing still references retained deleted-player key");
  console.log("BETA25 DELETE-ANYTIME + PAIRING SAFETY REGRESSION: PASS");
})().catch(err=>{console.error(err);process.exit(1);});
