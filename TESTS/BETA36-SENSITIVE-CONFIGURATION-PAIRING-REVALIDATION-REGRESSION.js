const fs=require('fs');
const path=require('path');
const vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'ChessPublisher.html'),'utf8');
let pass=0,fail=0;
function check(ok,msg){if(ok){console.log('PASS - '+msg);pass++;}else{console.error('FAIL - '+msg);fail++;}}
function has(re,msg){check(re.test(html),msg);}

has(/data-chesspublisher-version="1\.06\.00-beta\.(?:3[6-9]|4[0-9]|[5-9][0-9])(?:-r\d+)?"/,'beta.36-or-newer build marker');
has(/SENSITIVE CONFIGURATION PAIRING REVALIDATION — beta\.36/,'beta.36 revalidation framework marker');
has(/async function cpRevalidateLatestPairingAfterConfiguration\(/,'configuration revalidation helper present');
has(/onlyIfFinalityChanged && beforeFinal===afterFinal/,'revalidation can be restricted to finality transitions');
has(/beforeFinal=latestBefore>0 && latestBefore===before/,'round-count flow records pre-change latest-round finality');
has(/afterFinal=latestAfter>0 && latestAfter===applied/,'round-count flow records post-change latest-round finality');
has(/cpRevalidateLatestPairingAfterConfiguration\(\{action:"Number of Rounds change",onlyIfFinalityChanged:true,beforeFinal,afterFinal\}\)/,'round-count finality transition invokes pairing verifier');
has(/action:"Configuration Pairing Violation",level:3/,'invalid pairing after round-count change uses at least Level-3 warning');
has(/cpRecordPibe\("Configuration Pairing Violation"/,'invalid pairing after round-count change is logged as PIBE');
has(/Number-of-rounds change rolled back because it invalidated the latest pairing/,'rejected round-count mismatch rolls back');
has(/could not be revalidated in FIDE Mode/,'configuration checker failure is fail-closed in FIDE Mode');
has(/cpPersistCriticalMutation\("Number of Rounds"\)/,'round-count mutation uses forced durable checkpoint');
has(/cpRecordPibe\("Number of Rounds change"[^]*cpPersistCriticalMutation\("Number of Rounds"\)/,'round-count PIBE is recorded before durable checkpoint');
has(/cpRevalidateLatestPairingAfterConfiguration\(\{action:"PAB configuration change"\}\)/,'post-start PAB change invokes pairing revalidation');
has(/action:"PAB Configuration Pairing Violation",level:3/,'PAB pairing mismatch uses Level-3 gate');
has(/PAB change rolled back because it invalidated the latest pairing/,'rejected PAB mismatch rolls back');
has(/cpRecordPibe\("PAB configuration change"[^]*cpPersistCriticalMutation\("PAB Points"\)/,'PAB PIBE is recorded before durable checkpoint');
has(/localStorage\.setItem\(STORAGE_KEY,JSON\.stringify\(data\)\)/,'rollback helper restores localStorage recovery state');
has(/idbWriteSnapshot\(restoredSnapshot\)/,'rollback helper restores IndexedDB recovery state');
has(/window\.__cpPairingIntegrity=\{[^}]*revalidateConfig:cpRevalidateLatestPairingAfterConfiguration[^}]*restoreSnapshot:cpRestoreTournamentSnapshot/,'beta.36 test hooks expose revalidation and rollback helpers');

// Runtime-check the reusable configuration verifier and rollback helper.
const helperStart=html.indexOf('function cpRestoreTournamentSnapshot(');
const helperEnd=html.indexOf('function registeredPlayerOptions(',helperStart);
if(helperStart<0||helperEnd<0){console.error('FAIL - could not isolate beta.36 helper block');process.exit(1);}
const helperCode=html.slice(helperStart,helperEnd);
let verifyCalls=0,logCalls=0,backupCalls=0,idbCalls=0,refreshCalls=0;
const tournament={settings:{rounds:'7'},pairings:{liveBoards:{'3':[{whiteKey:'A',blackKey:'B'}]}}};
const data={currentTournament:'T',tournaments:{T:tournament}};
const localWrites=[];
const ctx={console,JSON,Promise,data,STORAGE_KEY:'cp',autosaveTimer:7,stateDirty:true,
  getCurrentTournament:()=>ctx.data.tournaments.T,
  getLatestGeneratedRound:()=>3,
  cpVerifyPairingIntegrityForRound:async(round,boards,{source}={})=>{verifyCalls++;return {round,ok:true,comparison:{},correctBoards:boards,source};},
  cpLogComplianceEvent:()=>{logCalls++;},
  normalizeData:()=>{},refreshEverything:()=>{refreshCalls++;},populatePairingsRoundMenu:()=>{},renderLivePairings:()=>{},refreshFinalStandings:()=>{},updateGacruxPanel:()=>{},updateFideComplianceUI:()=>{},setStatus:()=>{},
  localStorage:{setItem:(k,v)=>localWrites.push([k,v])},getPersistentSnapshot:()=>({data:ctx.data}),writeLocalBackup:()=>{backupCalls++;},idbWriteSnapshot:async()=>{idbCalls++;},clearTimeout:()=>{}
};
vm.createContext(ctx);vm.runInContext(helperCode,ctx);

(async()=>{
  let r=await ctx.cpRevalidateLatestPairingAfterConfiguration({action:'Rounds',onlyIfFinalityChanged:true,beforeFinal:false,afterFinal:false});
  check(r.checked===false && verifyCalls===0,'same finality skips unnecessary pairing regeneration');
  r=await ctx.cpRevalidateLatestPairingAfterConfiguration({action:'Rounds',onlyIfFinalityChanged:true,beforeFinal:true,afterFinal:false});
  check(r.checked===true && r.ok===true && verifyCalls===1,'final/non-final transition revalidates latest pairing');
  check(logCalls===1,'successful configuration pairing check is recorded as non-TRF evidence');

  const snap={settings:{rounds:'7'},pairings:{liveBoards:{'3':[{whiteKey:'A',blackKey:'B'}]}}};
  ctx.data.tournaments.T={settings:{rounds:'8'},pairings:{liveBoards:{}}};
  const restored=ctx.cpRestoreTournamentSnapshot(snap,{status:'rollback'});
  check(restored===true && ctx.data.tournaments.T.settings.rounds==='7','rollback restores the pre-change tournament snapshot');
  check(localWrites.length===1 && backupCalls===1 && idbCalls===1,'rollback aligns browser recovery stores with restored state');
  check(refreshCalls===1,'rollback refreshes the application state');

  // Runtime-check the round-count transaction in the mismatch/reject path.
  const rStart=html.indexOf('async function tournamentRoundsChanged(){');
  const rEnd=html.indexOf('function regulationsRoundsChanged()',rStart);
  if(rStart<0||rEnd<0)throw new Error('could not isolate tournamentRoundsChanged');
  const roundCode=html.slice(rStart,rEnd);
  let current={settings:{rounds:'3',lastSwissRounds:'3'},pairings:{liveBoards:{'3':[{}]}}};
  let latest=3,restoredSnapshot=null,persistCalls=0,pibeActions=[],setRound='4';
  const rc={console,JSON,Number,String,parseInt,Math,
    getCurrentTournament:()=>current,val:()=>setRound,isRoundRobinFormat:()=>false,setVal:(id,v)=>{if(id==='rounds')setRound=String(v);},appAlert:async()=>{},
    getLatestGeneratedRound:()=>latest,cpComplianceRound:()=>3,cpFidePibeGate:async()=>true,
    synchronizeTournamentRoundsEverywhere:async({rounds})=>{current.settings.rounds=String(rounds);return rounds;},
    cpRevalidateLatestPairingAfterConfiguration:async()=>({checked:true,ok:false,round:3,verification:{round:3,comparison:{},correctBoards:[]}}),
    cpFidePairingMismatchGate:async()=>false,
    cpRestoreTournamentSnapshot:(snap)=>{restoredSnapshot=JSON.parse(JSON.stringify(snap));current=restoredSnapshot;return true;},
    cpRecordPibe:(a)=>pibeActions.push(a),cpPairingIntegrityDiffText:()=>'',cpFideModeActive:()=>true,
    saveAll:()=>{},cpPersistCriticalMutation:async()=>{persistCalls++;return true;},getPairingGenerationState:()=>({canGenerate:false}),setStatus:()=>{},getLanguage:()=> 'en'
  };
  vm.createContext(rc);vm.runInContext(roundCode,rc);
  await rc.tournamentRoundsChanged();
  check(current.settings.rounds==='3' && setRound==='3','declined Level-3 mismatch restores old round count');
  check(persistCalls===0,'rejected invalid configuration is not durably committed');
  check(!pibeActions.includes('Number of Rounds change'),'rejected round-count mutation is not logged as completed PIBE');

  // Accepting the mismatch must log both the violation and the applied change, then persist.
  current={settings:{rounds:'3',lastSwissRounds:'3'},pairings:{liveBoards:{'3':[{}]}}};latest=3;setRound='4';persistCalls=0;pibeActions=[];
  rc.getCurrentTournament=()=>current;
  rc.cpFidePairingMismatchGate=async()=>true;
  rc.cpRestoreTournamentSnapshot=(snap)=>{current=JSON.parse(JSON.stringify(snap));return true;};
  await rc.tournamentRoundsChanged();
  check(current.settings.rounds==='4','accepted configuration override keeps new round count');
  check(pibeActions.includes('Configuration Pairing Violation') && pibeActions.includes('Number of Rounds change'),'accepted invalid configuration logs violation and applied change');
  check(persistCalls===1,'accepted configuration change receives one forced durable checkpoint');

  console.log(`SUMMARY PASS=${pass} FAIL=${fail}`);
  process.exit(fail?1:0);
})().catch(err=>{console.error('FAIL - runtime exception: '+(err&&err.stack||err));process.exit(1);});
