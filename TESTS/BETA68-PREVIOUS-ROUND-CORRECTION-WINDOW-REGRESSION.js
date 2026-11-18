const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('ChessPublisher.html','utf8'),js=fs.readFileSync('ChessPublisher-Beta68-Compliance.js','utf8');let pass=0,fail=0;
function check(c,m){try{assert.ok(c);console.log(`PASS ${String(++pass).padStart(2,'0')} ${m}`);}catch(e){fail++;console.log(`FAIL ${m}`);}}
check(/data-chesspublisher-version="1\.06\.00-beta\.(?:6[89]|[7-9]\d|\d{3,})(?:-r\d+)?"/.test(html),'HTML self-identifies beta68 or newer cumulative version');
check(/ChessPublisher-Beta68-Compliance\.js/.test(html),'HTML loads beta68 module');
check(html.indexOf('ChessPublisher-Beta68-Compliance.js')>html.indexOf('ChessPublisher-Beta67-Compliance.js'),'beta68 loads after beta67');
check(/FIDE C\.04\.2 4\.3/.test(js),'module identifies the governing FIDE rule');
check(/has been paired but has not ended/.test(js),'correction window is tied to paired-but-unfinished next round');
check(/existing Round \$\{s\.latest\} pairing will not be changed/.test(js),'current published pairing is explicitly preserved');
check(/affect standings and the next pairing to be done/.test(js),'correction effect starts with the next pairing to be done');
check(/rating-report correction workflow/.test(js),'closed live window directs late corrections to rating-report workflow');
check(!/requestLocalGacruxPairs\s*=|buildPairingEngineTRF\s*=|buildTRF26\s*=|calculateTieBreaks\s*=/.test(js),'beta68 does not redefine protected pairing/TRF core');

(async()=>{
  const els={
    pairingsRound:{value:'-1'},
    roundEditState:{textContent:'Round status',style:{},parentNode:{},insertAdjacentElement(pos,el){els[el.id]=el;el.parentNode=this;}}
  };
  const document={readyState:'complete',documentElement:{dataset:{}},title:'Chess-Publisher v1.06.00-beta.67',getElementById:id=>els[id]||null,createElement:tag=>({tagName:String(tag).toUpperCase(),style:{},hidden:false,textContent:'',title:'',className:'',onclick:null}),addEventListener:()=>{}};
  const tournament={internalId:'T-1',settings:{tournamentFormat:'Individual Swiss'},pairings:{round:'-1',engine:{},liveBoards:{
    '1':[{board:1,whiteKey:'A',blackKey:'B',result:'1 - 0'}],
    '2':[{board:1,whiteKey:'C',blackKey:'D',result:'1 - 0'}],
    '3':[{board:1,whiteKey:'A',blackKey:'C',result:'-'}]
  }}};
  let warningLevel=0,warnings=0,alerts=0,saves=0,events=0;
  const latest=()=>Math.max(...Object.keys(tournament.pairings.liveBoards).map(Number));
  const selected=()=>{const x=els.pairingsRound.value;return x==='-1'?latest():Number(x)||latest();};
  const complete=r=>(tournament.pairings.liveBoards[String(r)]||[]).every(b=>b.result&&b.result!=='-');
  const window={document,data:{currentTournament:'Test'},getCurrentTournament:()=>tournament,getLatestGeneratedRound:latest,getSelectedPairingRoundNumber:selected,isPairingRoundComplete:complete,isRoundRobinFormat:()=>false,
    setVal:(id,v)=>{if(els[id])els[id].value=String(v);},saveData:()=>{saves++;},renderLivePairings:()=>{},
    isSelectedRoundEditable:()=>selected()===latest(),ensureSelectedRoundEditable:()=>selected()===latest(),
    updateRoundHistoryEditState:()=>{els.roundEditState.textContent=(selected()===latest())?'EDITABLE':'HISTORY';},pairingsRoundChanged:()=>{tournament.pairings.round=els.pairingsRound.value;},
    getLivePairingBoards:()=>tournament.pairings.liveBoards[String(selected())]||[],
    applyResultToSelectedBoard:(result)=>{if(!window.ensureSelectedRoundEditable())return false;const b=window.getLivePairingBoards()[0];if(!b)return false;b.result=result;return true;},
    swapSelectedBoardColors:async()=>{if(!window.ensureSelectedRoundEditable())return false;const b=window.getLivePairingBoards()[0];if(!b)return false;[b.whiteKey,b.blackKey]=[b.blackKey,b.whiteKey];return true;},
    cpFideWarning:async(level)=>{warnings++;warningLevel=level;return true;},appAlert:async()=>{alerts++;},appConfirm:async()=>true,
    cpLogComplianceEvent:()=>{events++;}
  };
  const ctx={window,document,console,Date,Map,Set,Number,String,Math};Object.assign(ctx,window);vm.createContext(ctx);vm.runInContext(js,ctx);Object.assign(ctx,window);
  const api=window.cpBeta68;
  check(api.VERSION==='1.06.00-beta.68','runtime API version is beta68');
  check(document.documentElement.dataset.chesspublisherVersion==='1.06.00-beta.68','install publishes beta68 version');
  let s=api.windowState();
  check(s.eligible&&s.latest===3&&s.previous===2,'Round 2 is eligible while paired Round 3 is unfinished');
  check(window.isSelectedRoundEditable(),'latest Round 3 remains editable under the original rule');
  els.pairingsRound.value='2';
  check(!window.isSelectedRoundEditable(),'previous Round 2 remains locked before explicit correction mode');
  const currentPairingBefore=JSON.stringify(tournament.pairings.liveBoards['3']);
  let opened=await api.startPreviousRoundCorrection();
  check(opened&&warnings===1&&warningLevel===3,'opening previous-round correction requires Level-3 confirmation');
  check(els.pairingsRound.value==='2'&&api.activeForSelected(),'correction mode selects and activates only Round 2');
  check(window.isSelectedRoundEditable()&&window.ensureSelectedRoundEditable('change a result'),'patched edit gate permits the immediately preceding round only in active mode');
  check(els.cpBeta68PreviousRoundCorrectionBtn&&!els.cpBeta68PreviousRoundCorrectionBtn.hidden,'correction control is visible during the rule window');
  check(/CORRECTION WINDOW/.test(els.roundEditState.textContent),'round badge clearly identifies correction-window state');
  els.pairingsRound.value='1';
  check(!window.isSelectedRoundEditable(),'Round 1 remains locked; correction mode does not unlock arbitrary history');
  els.pairingsRound.value='2';
  const beforeResult=tournament.pairings.liveBoards['2'][0].result;
  let changed=window.applyResultToSelectedBoard('½ - ½');
  check(changed===true&&beforeResult!==tournament.pairings.liveBoards['2'][0].result,'previous-round result can be corrected inside the live window');
  check(tournament.pairings.engine.lastC042Correction?.round===2&&tournament.pairings.engine.lastC042Correction?.affectsPairingFromRound===4,'correction metadata records Round 2 and effect from Round 4');
  check(events>=1&&saves>=1,'actual correction is persisted and audit-recorded');
  check(JSON.stringify(tournament.pairings.liveBoards['3'])===currentPairingBefore,'correction does not rewrite the already paired Round 3');
  const beforeColors=JSON.stringify(tournament.pairings.liveBoards['2'][0]);
  await window.swapSelectedBoardColors();
  check(JSON.stringify(tournament.pairings.liveBoards['2'][0])!==beforeColors,'previous-round colour assignment can be corrected inside the window');
  check(tournament.pairings.engine.lastC042Correction?.kind==='colour assignment','colour correction records its correction kind');
  check(window.isSelectedRoundEditable(),'manual-pairing entry gate can use the same active previous-round edit permission');
  els.pairingsRound.value='3';
  window.applyResultToSelectedBoard('1 - 0');
  check(complete(3),'Round 3 fixture is now complete');
  check(!api.sessionActive(),'correction session closes automatically when the next round ends');
  s=api.windowState();
  check(!s.eligible&&s.reason==='next-round-ended','after end of Round 3 the Round-2 live correction window is closed');
  els.pairingsRound.value='2';
  check(!window.isSelectedRoundEditable(),'Round 2 returns to historical read-only after Round 3 ends');
  opened=await api.startPreviousRoundCorrection();
  check(opened===false&&alerts===1,'attempting to reopen after next-round end is blocked with guidance');
  els.pairingsRound.value='3';
  check(window.isSelectedRoundEditable(),'latest completed round remains the normal editable correction surface before another pairing is generated');
  window.isRoundRobinFormat=()=>true;ctx.isRoundRobinFormat=window.isRoundRobinFormat;
  s=api.windowState();
  check(!s.eligible&&s.reason==='round-robin','C.04.2 Swiss correction window is not injected into Round Robin schedule semantics');
  console.log(`BETA68 RESULT: ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
