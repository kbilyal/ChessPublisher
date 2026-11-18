const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('ChessPublisher.html','utf8');
const ps=fs.readFileSync('ChessPublisher-WebView.ps1','utf8');
let pass=0,fail=0;
function check(c,m){try{assert.ok(c);console.log(`PASS ${String(++pass).padStart(2,'0')} ${m}`);}catch(e){fail++;console.log(`FAIL ${m}`);}}

check(/data-chesspublisher-version="1\.06\.00-beta\.(?:71|7[2-9]|[89]\d|\d{3,})(?:-r\d+)?"/.test(html),'HTML self-identifies beta71 or newer');
check(/<title>Chess-Publisher v1\.06\.00-beta\.(?:71|7[2-9]|[89]\d|\d{3,})(?:-r\d+)?<\/title>/.test(html),'document title identifies beta71 or newer');
check(/class="window cp-native-workspace"/.test(html),'native single-workspace class is active');
check(!/class="app-resize-handle/.test(html),'fake HTML resize handles are removed');
check(!/class="titlebar"/.test(html),'fake HTML titlebar is removed');
check(/class="desktop-header-strip"/.test(html),'save/autosave status retained as non-window status strip');
check(!/onclick="minimizeAppWindow\(|onclick="toggleMaximizeAppWindow\(|onclick="closeAppWindow\(/.test(html),'fake browser window controls are not exposed');
check(/FormBorderStyle\]::Sizable/.test(ps),'native Windows Form remains sizable');
check(/\$form\.MinimizeBox = \$true/.test(ps)&&/\$form\.MaximizeBox = \$true/.test(ps),'native Windows minimize/maximize controls remain enabled');
check(/\^cp:title:\(\.\*\)\$/.test(ps),'native host accepts document-title updates');
check(/webViewRelease = '1\.06\.00-beta\.(?:71|7[2-9]|[89]\d|\d{3,})'/.test(ps),'native host release marker is beta71 or newer');

for(const id of ['tabDgt','tabMain','tabRegistration','tabPairings','tabStandings','tabExport','tabSchedule','tabChessResults'])
  check(new RegExp(`id="${id}"`).test(html),`${id} remains present`);
check(/\.tabs\{overflow:hidden!important;overflow-x:hidden!important;flex-wrap:nowrap!important/.test(html),'tab row does not use horizontal scrolling');
check(/\.tab\{flex:1 1 auto!important;min-width:0!important;justify-content:center!important/.test(html),'tabs flex responsively to stay visible');
check(/@media\(max-width:1180px\)\{\.tab\{padding-left:5px!important/.test(html),'narrow desktop tab density rule exists');

check(/#pairings \.swiss-workspace\{[\s\S]*grid-template-columns:minmax\(0,1fr\) 198px!important/.test(html),'Pairings keeps board table and Result Desk side-by-side');
check(/#pairings \.live-pairing-table-wrap\{[\s\S]*overflow:auto!important/.test(html),'board table is the scrolling Pairings surface');
check(/#pairings \.result-palette\{[\s\S]*overflow:visible!important/.test(html),'Result Desk has no own vertical scrollbar');
check(/#pairings \.live-pairing-table th\{position:sticky!important/.test(html),'board-table header remains sticky');
check(/@media\(max-width:900px\)\{[\s\S]*grid-template-columns:minmax\(0,1fr\) 184px!important/.test(html),'Result Desk does not fall below the board table at 900px');
for(const marker of ['Current','1 : 0','½ : ½','0 : 1','Administrative','Swap Colors','All boards','Missing','Clear all results','Generate Pairings'])
  check(html.includes(marker),`Result Desk keeps ${marker}`);
check(/id="pairingsChessResultsPublishBtn"/.test(html),'Pairings Chess-Results action remains visible in markup');
check(/#pairings \.live-pairing-toolbar\{position:sticky!important/.test(html),'Pairings action toolbar is sticky');

check(/CP_ACTIVE_TAB_PREF_KEY="chessPublisher\.activeTab\.ui\.v2"/.test(html),'active tab is persisted as UI-only preference');
check(/if\(stateDirty\)\{[\s\S]*saveAll\(\)/.test(html),'dirty tab navigation keeps protected saveAll path');
check(/cpFluidityV2Diagnostics\.cleanSwitches\+\+/.test(html),'clean navigation fast path is instrumented');
check(/cpViewRenderEpoch\+\+/.test(html),'tab change invalidates obsolete VIEW work');
check(/discardedViewTasks\+\+/.test(html),'stale VIEW tasks are explicitly discarded');
check(/cpScheduleActivePageView\("pairings"/.test(html),'Pairings delayed rendering uses active-page guard');
check(/cpScheduleActivePageView\("standings"/.test(html),'Standings delayed rendering uses active-page guard');
check(/cpScheduleActivePageView\("chessresults"/.test(html),'Chess-Results delayed rendering uses active-page guard');
check(!/F8 Fluidity|fluidity.*F8/i.test(html),'production UI contains no F8 Fluidity A/B harness');
check(/backdrop-filter:none!important/.test(html),'expensive blur/backdrop is disabled in workspace overlays');
check(/transition:none!important;animation:none!important;scroll-behavior:auto!important/.test(html),'working UI transitions/smooth scrolling are disabled');

// Runtime navigation simulation from the exact beta71 navigation block.
const a=html.indexOf('const CP_ACTIVE_TAB_PREF_KEY=');
const b=html.indexOf('function showFideLocalUpdaterHelp(){',a);
const nav=html.slice(a,b);
class CL{constructor(...x){this.s=new Set(x)}contains(x){return this.s.has(x)}add(x){this.s.add(x)}remove(x){this.s.delete(x)}toggle(x,v){v?this.s.add(x):this.s.delete(x)}}
const ids=['main','registration','pairings','standings','exportPage','schedule','chessresults','dgt'];
const tabs={main:'tabMain',registration:'tabRegistration',pairings:'tabPairings',standings:'tabStandings',exportPage:'tabExport',schedule:'tabSchedule',chessresults:'tabChessResults',dgt:'tabDgt'};
const elements={};
for(const id of ids)elements[id]={id,classList:new CL()};
for(const id of Object.values(tabs))elements[id]={id,classList:new CL()};
let timers=[];let saveCalls=0,dgtEnter=0,dgtLeave=0,pairRender=0,standingRender=0,crRender=0;
const store={};
const document={
  getElementById:id=>elements[id]||null,
  querySelector:q=>q==='.page.active'?ids.map(id=>elements[id]).find(x=>x.classList.contains('active'))||null:null,
  querySelectorAll:q=>q==='.page'?ids.map(id=>elements[id]):q==='.tab'?Object.values(tabs).map(id=>elements[id]):[]
};
const context={
  console,document,window:{},localStorage:{setItem:(k,v)=>store[k]=String(v),getItem:k=>store[k]||null},
  setTimeout:fn=>{timers.push(fn);return timers.length},
  data:{preferences:{}},stateDirty:false,
  updateWorkflowTabs:()=>{},setStatus:()=>{},saveAll:()=>{saveCalls++},dgtOnTabLeave:()=>{dgtLeave++},dgtOnTabEnter:()=>{dgtEnter++},
  getPairingEngineConfig:()=>({playerStatusCollapsed:false}),populatePairingsRoundMenu:()=>{pairRender++},renderLivePairings:()=>{pairRender++},loadPairingEngineSettings:()=>{pairRender++},renderNextRoundPlayerManager:()=>{pairRender++},updateGacruxPanel:()=>{pairRender++},gacruxRuntime:{state:'ready'},
  refreshChessResultsXmlUi:()=>{crRender++},renderSpecialPrizeSettings:()=>{standingRender++},refreshFinalStandings:()=>{standingRender++},renderSpecialPrizeResults:()=>{standingRender++},getCurrentTournament:()=>({}),
};
context.window=context;vm.createContext(context);
vm.runInContext(nav+'\nwindow.__nav={showTab,openSavedTab,diag:cpFluidityV2Diagnostics,setDirty:v=>stateDirty=v};',context);
const api=context.__nav;
function runTimers(){const q=timers;timers=[];for(const fn of q)fn();}
// initialize main without counting a save
api.showTab('main',elements.tabMain);runTimers();saveCalls=0;api.diag.cleanSwitches=0;api.diag.dirtySwitches=0;
const sequence=['registration','pairings','standings','exportPage','schedule','chessresults','main'];
for(let i=0;i<100;i++){const id=sequence[i%sequence.length];api.showTab(id,elements[tabs[id]]);runTimers();}
check(saveCalls===0,'100 clean tab switches do not call full saveAll');
check(api.diag.cleanSwitches===100,'100 clean tab switches use fast path');
check(ids.filter(id=>elements[id].classList.contains('active')).length===1,'exactly one page remains active after stress navigation');
api.setDirty(true);api.showTab('registration',elements.tabRegistration);runTimers();
check(saveCalls===1&&api.diag.dirtySwitches===1,'dirty navigation calls protected saveAll exactly once');
// stale task: Pairings schedules work, then Standings replaces page before timers run.
api.setDirty(false);pairRender=standingRender=0;api.showTab('pairings',elements.tabPairings);api.showTab('standings',elements.tabStandings);runTimers();
check(pairRender===0,'obsolete Pairings VIEW render is discarded after rapid switch');
check(standingRender>0,'active Standings VIEW render executes');
check(api.diag.discardedViewTasks>0,'stale-render diagnostic records discarded work');
api.showTab('dgt',elements.tabDgt);runTimers();api.showTab('main',elements.tabMain);runTimers();
check(dgtEnter===1&&dgtLeave===1,'DGT enter/leave lifecycle remains intact');
check(store['chessPublisher.activeTab.ui.v2']==='main','active page preference is persisted without saveData');

// Protected boundaries in the Fluidity change itself.
const fluidityStart=html.indexOf('<style id="cp-windows-fluidity-v2">');const fluidityEnd=html.indexOf('</style>',fluidityStart);const fluidityCss=html.slice(fluidityStart,fluidityEnd>=0?fluidityEnd+8:html.length);
check(!/generatePairingWithGacrux\s*=|calculateTieBreaks\s*=|buildTRF|exportTRF/.test(fluidityCss),'Fluidity CSS does not touch pairing/TRF/tie-break logic');
console.log(`BETA71 WINDOWS FLUIDITY V2 RESULT: ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
