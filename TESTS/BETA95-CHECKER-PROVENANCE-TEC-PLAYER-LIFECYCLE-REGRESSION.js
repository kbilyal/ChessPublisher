"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"ChessPublisher.html"),"utf8");
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,"fixtures","BETA95-reset-tombstone-user-case.json"),"utf8"));
let pass=0,fail=0;
function check(v,m){if(v){pass++;console.log(`PASS ${String(pass+fail).padStart(2,"0")} ${m}`);}else{fail++;console.error(`FAIL ${String(pass+fail).padStart(2,"0")} ${m}`);}}
function extractFunction(name){
  const re=new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`),m=re.exec(html); if(!m)throw new Error(`missing ${name}`);
  const start=m.index,brace=html.indexOf("{",m.index+m[0].length); let depth=0,quote="",esc=false,line=false,block=false;
  for(let i=brace;i<html.length;i++){const c=html[i],n=html[i+1]||"";
    if(line){if(c==="\n")line=false;continue;} if(block){if(c==="*"&&n==="/"){block=false;i++;}continue;}
    if(quote){if(esc){esc=false;continue;} if(c==="\\"){esc=true;continue;} if(c===quote)quote="";continue;}
    if(c==="/"&&n==="/"){line=true;i++;continue;} if(c==="/"&&n==="*"){block=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;} if(c==="{")depth++; else if(c==="}"&&--depth===0)return html.slice(start,i+1);
  } throw new Error(`unterminated ${name}`);
}
const clone=x=>JSON.parse(JSON.stringify(x));

check(/data-chesspublisher-version="1\.06\.00-beta\.(?:95|96|97|98)(?:-r\d+)?"/.test(html),"beta.95+ build marker present");
check(/function getPreRoundOneAbsentPlayers\(/.test(html)&&/needsAbsentRemoval/.test(html),"pre-Round-1 Absent hard gate exists");
check(/Round 1 pairing is blocked while/.test(html)&&/Mark the player Present/.test(html),"Generate Pairings explains Present-or-Remove resolution");
check(/Reset destroys all generated round\/result history/.test(html)&&/resetPurgedKeys/.test(html),"Reset explicitly purges obsolete registration tombstones");
check(/getActiveRegistrationPlayers\(t\)[\s\S]{0,220}post-start withdrawn\/deleted tombstone/.test(html)||/post-start withdrawn\/deleted tombstone[\s\S]{0,260}getActiveRegistrationPlayers\(t\)/.test(html),"TRF Starting List is restricted to active registrations");
check(/lastCheckerUiSource/.test(html)&&/lastCheckerUiBuildVersion/.test(html)&&/lastCheckerUiCheckedAt/.test(html),"Gacrux checker UI records runtime/build provenance");
check(/previous result ignored/.test(html)&&/historical and is not current/.test(html),"stale Gacrux checker result is rendered historical, not FAIL");

// Actual workflow state/gate behavior.
{
  const t={settings:{tournamentFormat:"Individual Swiss"},players:[
    {localKey:"A",name:"Alpha",attendance:"present",joinedFromRound:1},
    {localKey:"B",name:"Bravo",attendance:"absent",joinedFromRound:1}
  ],pairings:{liveBoards:{},engine:{firstRoundRegistrationLocked:false,firstRoundRegistrationSyncedSignature:"",firstRoundRegistrationNeedsResort:false}}};
  const names=["getPlayerJoinRound","isPlayerRegistrationDeleted","getLatestGeneratedRoundForTournament","getRegistrationSignature","getFirstRoundRegistrationSignature","hasPendingLateRegistrationForTournament","getPreRoundOneAbsentPlayers","getRegistrationWorkflowState","applyRegistrationPairingGate"];
  const ctx={console,Number,String,Set,getCurrentTournament:()=>t,playerKey:p=>p.localKey,getPlayerAttendance:p=>p.attendance||"present",isRoundRobinTournament:()=>false};
  ctx.window=ctx;ctx.globalThis=ctx; vm.createContext(ctx);vm.runInContext(names.map(extractFunction).join("\n"),ctx);
  let w=ctx.getRegistrationWorkflowState(t),g=ctx.applyRegistrationPairingGate({canGenerate:true,next:1});
  check(w.needsAbsentRemoval===true&&w.preRoundOneAbsentCount===1,"active Absent registration is detected before Round 1");
  check(g.canGenerate===false&&g.pairingBlockReason==="pre-r1-absent","pre-Round-1 Absent hard-blocks pairing generation");
  t.players[1].attendance="present";
  w=ctx.getRegistrationWorkflowState(t);g=ctx.applyRegistrationPairingGate({canGenerate:true,next:1});
  check(w.needsAbsentRemoval===false,"marking the player Present clears the Absent gate");
  check(g.canGenerate===false&&g.needsResort===true,"after Absent is resolved, normal Round-1 Resort gate still applies");
  t.pairings.liveBoards={"1":[{board:1,whiteKey:"A",blackKey:"B",result:"1-0"}]};t.pairings.engine.firstRoundRegistrationLocked=true;t.players[1].attendance="absent";
  w=ctx.getRegistrationWorkflowState(t);
  check(w.needsAbsentRemoval===false,"Absent after tournament start remains a round-participation state, not a forced deletion gate");
}

// Real beta.95 Reset function against a minimized fixture derived from the user's saved tournament.
(async()=>{
  {
    const t=clone(fixture);
    t.players.push({localKey:"ACTIVE-ABSENT",name:"Registered but absent",pairingNumber:20,attendance:"absent",joinedFromRound:1,registrationDeleted:false});
    const status=[];
    const ctx={console,Date,Math,Number,String,Set,manualPairingMode:false,selectedLiveBoardIndex:0,
      getCurrentTournament:()=>t,getExistingPairingRounds:()=>Object.keys(t.pairings.liveBoards).map(Number),getLanguage:()=>"en",appConfirm:async()=>true,appAlert:async()=>{},
      cpBeginCriticalMutationCheckpoint:async()=>({ok:true}),cpCommitCriticalMutationCheckpoint:async()=>true,cpRestoreCriticalMutationCheckpoint:async()=>true,
      updateManualPairingUI(){},playerKey:p=>p.localKey,isPlayerRegistrationDeleted:p=>!!p.registrationDeleted,
      cleanupRemovedRegistrationKeys:(tour,keys)=>{const e=tour.pairings.engine||{};for(const mapName of ["excludeRemaining","excludeRounds","fixedBoards"]){const map=e[mapName]||{};for(const k of keys)delete map[k];}},
      resetChessResultsPublicationAfterTournamentReset:(tour)=>{const old=String(tour.chessResults?.key||"");tour.chessResults={...(tour.chessResults||{}),key:"",mode:""};if(tour.settings)tour.settings.tnr="";return old;},
      markCloudStructuralSyncIntent(){},recalculateRoundHistoryState(){return {latest:0};},saveData(){},chessResultsState:tour=>tour.chessResults||{},
      populatePairingsRoundMenu(){},setVal(){},renderLivePairings(){},renderNextRoundPlayerManager(){},updatePlayerDeletionAvailability(){},updateRoundHistoryEditState(){},updateGacruxPanel(){},refreshFinalStandings(){},refreshPairingStandingsPanel(){},
      isRoundRobinTournament:()=>false,getPreRoundOneAbsentPlayers:tour=>(tour.players||[]).filter(p=>!p.registrationDeleted&&p.attendance==="absent"),setStatus:s=>status.push(s)
    };
    ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(extractFunction("resetTournamentRounds"),ctx);
    const deletedBefore=t.players.filter(p=>p.registrationDeleted).length;
    check(deletedBefore===2,"user-derived fixture contains the two hidden historical tombstones before Reset");
    await ctx.resetTournamentRounds();
    check(t.players.every(p=>!p.registrationDeleted),"Reset physically removes all historical Deleted/Withdrawn tombstones");
    check(!t.players.some(p=>p.localKey==="local:player-mtobui1u-zj2887f"||p.localKey==="local:arif-mert-mto8630u-s12bt1o"),"the exact '.' / '.....' ghost keys cannot survive the fresh Round-1 roster");
    check(Object.keys(t.pairings.liveBoards).length===0,"Reset still deletes all generated round history");
    check(t.players.some(p=>p.localKey==="ACTIVE-ABSENT"&&p.attendance==="absent"),"Reset preserves an active Absent registration for explicit arbiter resolution");
    check(status.some(s=>/Resolve\/Remove Absent/.test(s)),"post-Reset workflow tells the arbiter to resolve Absent before Resort");
    check(!Object.prototype.hasOwnProperty.call(t.standingsLots||{},"local:player-mtobui1u-zj2887f"),"Reset also removes obsolete tombstone drawing-of-lots state");
  }

  // Required Remove Absent physically deletes active pre-R1 absentees and marks Resort pending.
  {
    const t={players:[{localKey:"A",name:"Alpha",attendance:"present"},{localKey:"B",name:"Bravo",attendance:"absent"}],settings:{tournamentFormat:"Individual Swiss"},pairings:{liveBoards:{},engine:{firstRoundRegistrationLocked:false,excludeRemaining:{},excludeRounds:{},manualByes:{},fixedBoards:{}}}};
    const notices=[];const selected=new Set();
    const ctx={console,Date,Number,String,Set,selectedPlayerIndexes:selected,lastClickedSortedIndex:null,
      getCurrentTournament:()=>t,getPairingEngineConfig:()=>t.pairings.engine,getLatestGeneratedRound:()=>0,getRegistrationWorkflowState:()=>({firstRoundLocked:false}),isRoundRobinTournament:()=>false,
      playerKey:p=>p.localKey,getPlayerAttendance:p=>p.attendance||"present",isPlayerRegistrationDeleted:p=>!!p.registrationDeleted,getFirstRoundRegistrationSignature:tour=>(tour.players||[]).map(p=>p.localKey).join("|"),
      cleanupRemovedRegistrationKeys(){},appAlert:async(m)=>notices.push(m),appConfirm:async()=>true,saveData(){},cpPersistCriticalMutation:async()=>true,
      renderRegistered(){},updatePlayerCount(){},renderNextRoundPlayerManager(){},updatePlayerDeletionAvailability(){},updateGacruxPanel(){},updateRegistrationWorkflowUI(){},setStatus:s=>notices.push(s)
    };ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(extractFunction("syncRegistrations"),ctx);await ctx.syncRegistrations();
    check(t.players.length===1&&t.players[0].localKey==="A","Remove Absent physically deletes the active pre-R1 absent registration");
    check(t.pairings.engine.firstRoundRegistrationNeedsResort===true,"Remove Absent requires a fresh Starting List Resort");
    check(notices.some(s=>/Round-1 roster cleaned/.test(String(s))),"Swiss Remove Absent is communicated as required Round-1 roster cleanup");
  }

  // Existing Late Entry semantics remain intact.
  {
    const t={players:[],settings:{tournamentFormat:"Individual Swiss"},pairings:{liveBoards:{"1":[{board:1,whiteKey:"A",blackKey:"B",result:"1-0"}]},engine:{needsResort:false}}};
    const ctx={getCurrentTournament:()=>t,getLatestGeneratedRound:()=>1,isRoundRobinTournament:()=>false,getPairingEngineConfig:()=>t.pairings.engine};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(extractFunction("prepareNewPlayerForTournament"),ctx);
    const p={name:"Late"};const result=ctx.prepareNewPlayerForTournament(p);
    check(result.late===true&&p.joinedFromRound===2&&p.attendance==="present","new player after Round 1 is admitted as Late Entry from the next round");
    check(t.pairings.engine.needsResort===true,"Late Entry still requires rule-based TPN Resort");
  }

  // Actual checker UI patch: stale state is neutral; fresh current state remains authoritative.
  function checkerHarness(initialEngine,mode){
    const t={name:"Checker Harness",cloud:{internalId:"checker-harness"},pairings:{engine:clone(initialEngine)}};
    const button={textContent:"Generate Pairings",title:"",classList:{s:new Set(),add(...x){x.forEach(v=>this.s.add(v));},remove(...x){x.forEach(v=>this.s.delete(v));}}};
    const doc={readyState:"complete",documentElement:{dataset:{chesspublisherVersion:"1.06.00-beta.96"}},getElementById:id=>id==="btnGenerateGacrux"?button:null,addEventListener(){}};
    const ctx={console,Date,Number,String,document:doc,isLocalEnginePage:()=>true,getCurrentTournament:()=>t,saveData(){},updateGacruxPanel(){},resetTournamentRounds:async()=>{},
      requestLocalGacruxPairs:async()=>{if(mode==="fail")throw new Error("fresh native failure");return [{board:1}];},setTimeout:fn=>{fn();return 1;}};
    ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
    const m=html.match(/<script id="cpCheckerUiPatchScript">([\s\S]*?)<\/script>/);if(!m)throw new Error("checker script missing");vm.runInContext(m[1],ctx);
    return {ctx,t,button};
  }
  {
    const h=checkerHarness({lastCheckerUiState:"rejected",lastCheckerUiRound:7,lastCheckerUiMessage:"Engine backend not connected. Gacrux and checker operations are Desktop only until a verified native server is connected."},"ok");
    h.ctx.cpApplyCheckerButtonState();
    check(!h.button.classList.s.has("cp-check-rejected")&&/historical/.test(h.button.title),"legacy no-provenance Web backend FAIL is ignored on beta.95 Desktop");
  }
  {
    const h=checkerHarness({},"fail");let err=null;try{await h.ctx.requestLocalGacruxPairs(2,"w");}catch(e){err=e;}
    check(!!err&&h.t.pairings.engine.lastCheckerUiState==="rejected","fresh current Desktop Gacrux failure remains a real rejected state");
    check(h.ctx.cpReadCheckerUiState().source==="desktop-local-engine"&&h.ctx.cpReadCheckerUiState().build==="1.06.00-beta.96"&&!Object.prototype.hasOwnProperty.call(h.t.pairings.engine,"lastCheckerUiSource"),"fresh checker provenance is current but session-only in beta.96");
    check(h.button.classList.s.has("cp-check-rejected"),"fresh current checker failure still marks Generate as rejected/red");
  }
  {
    const h=checkerHarness({},"ok");await h.ctx.requestLocalGacruxPairs(1,"w");
    check(h.t.pairings.engine.lastCheckerUiState==="approved"&&h.ctx.cpReadCheckerUiState().source==="desktop-local-engine"&&!Object.prototype.hasOwnProperty.call(h.t.pairings.engine,"lastCheckerUiSource"),"fresh successful checker result keeps PASS state with session-only provenance");
  }

  console.log(`BETA95 CHECKER PROVENANCE + TEC PLAYER LIFECYCLE: ${fail?"FAIL":"PASS"} (${pass} PASS / ${fail} FAIL)`);
  process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
