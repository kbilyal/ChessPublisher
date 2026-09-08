#!/usr/bin/env python3
"""Exercise Linux fluid v2 navigation and fixed Result Desk in real Chromium."""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'linux'))
from window_integration import inject_window_mode
from pairings_result_desk_integration import inject_fixed_result_desk
from chromium_runtime_smoke import _browser, _run_browser


def main() -> int:
    fixture = '''<!doctype html><html><head><style>
html,body{margin:0;width:100%;height:100%}.window{width:1000px;height:700px;margin:20px auto}.content{height:620px}.page{display:none}.page.active{display:block}
.swiss-workspace{display:grid;grid-template-columns:1fr 220px}.live-pairing-table-wrap{height:300px;overflow:auto}.result-palette{max-height:180px;overflow:auto}
</style></head><body>
<div id="appWindow" class="window"><div class="app-resize-handle"></div><div class="titlebar"><span id="windowDocumentTitle">Old</span><span class="window-controls"><button title="Minimize">-</button><button title="Maximize / restore">[]</button><button class="window-close">X</button></span></div>
<div class="tabs"><button class="tab" id="tabDgt" onclick="showTab('dgt',this)">DGT</button><button class="tab" id="tabMain" onclick="showTab('main',this)">Setup</button>
<button class="tab" id="tabRegistration" onclick="showTab('registration',this)">Players</button><button class="tab" id="tabPairings" onclick="showTab('pairings',this)">Pairings</button>
<button class="tab" id="tabStandings" onclick="showTab('standings',this)">Standings</button><button class="tab" id="tabExport" onclick="showTab('exportPage',this)">Export</button>
<button class="tab" id="tabSchedule" onclick="showTab('schedule',this)">Schedule</button><button class="tab" id="tabChessResults" onclick="showTab('chessresults',this)">Chess-Results</button></div>
<div class="content"><section id="main" class="page active"></section>
<section id="pairings" class="page"><div class="live-pairing-toolbar"><button id="pairingsChessResultsPublishBtn">Publish Chess-Results</button></div><div class="swiss-workspace"><div class="live-pairing-table-wrap"><table class="live-pairing-table"><thead><tr><th>Board</th></tr></thead><tbody>''' + ''.join(f'<tr><td>{i}</td></tr>' for i in range(1,80)) + '''</tbody></table></div><aside class="result-palette"><button>1-0</button><button>1/2</button><button>0-1</button><button id="btnGenerateGacrux">Generate Pairings</button></aside></div></section>
<section id="registration" class="page"></section><section id="standings" class="page"></section><section id="exportPage" class="page"></section><section id="schedule" class="page"></section><section id="chessresults" class="page"></section><section id="dgt" class="page"></section></div></div>
<script>
let stateDirty=false;let saveAllCalls=0;let saveDataCalls=0;let liveRenderCalls=0;let standingRenderCalls=0;let chessRefreshCalls=0;const data={preferences:{}};
function saveAll(){saveAllCalls++;}
function saveData(){saveDataCalls++;stateDirty=true;}
function updateWorkflowTabs(){}
function dgtOnTabLeave(){}
function dgtOnTabEnter(){}
function populatePairingsRoundMenu(){}
function renderLivePairings(){liveRenderCalls++;}
function loadPairingEngineSettings(){}
function renderNextRoundPlayerManager(){}
function updateGacruxPanel(){}
function renderSpecialPrizeSettings(){}
function refreshFinalStandings(){standingRenderCalls++;}
function renderSpecialPrizeResults(){}
function refreshChessResultsXmlUi(){chessRefreshCalls++;}
window.showTab=function(id,button){
  updateWorkflowTabs();if(button?.classList?.contains('disabled'))return;
  const previousId=document.querySelector('.page.active')?.id||'';
  if(previousId===id&&button?.classList?.contains('active'))return;
  if(previousId==='dgt'&&id!=='dgt')dgtOnTabLeave();
  saveAll();document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.tabs .tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(id).classList.add('active');button.classList.add('active');data.preferences.activeTab=id;saveData();
  if(id==='dgt')dgtOnTabEnter();if(id==='chessresults')queueMicrotask(refreshChessResultsXmlUi);
};
function check(value,message){if(!value)throw new Error(message);}
window.addEventListener('load',()=>{
  try{
    const shell=document.getElementById('appWindow');const r=shell.getBoundingClientRect();
    check(Math.abs(r.width-innerWidth)<2,'workspace does not fill browser width');
    check(Math.abs(r.height-innerHeight)<2,'workspace does not fill browser height');
    check(getComputedStyle(document.body).overflow==='hidden','body still creates a second scroll surface');
    check(getComputedStyle(document.querySelector('.app-resize-handle')).display==='none','nested resize handle remains active');
    check(getComputedStyle(document.querySelector('button[title="Minimize"]')).display==='none','nested minimize control remains visible');
    check(getComputedStyle(document.querySelector('button[title="Maximize / restore"]')).display==='none','nested maximize control remains visible');
    check(getComputedStyle(document.querySelector('.window-close')).display==='none','nested close control remains visible');
    check(!document.querySelector('.cp-linux-popup-titlebar'),'routine tab popup chrome was injected');
    check(window.__cpLinuxFluidShowTabWrapped===true,'fluid navigation wrapper was not ready before load');

    const tabs=document.querySelector('#appWindow .tabs');const chessTab=document.getElementById('tabChessResults');
    const tabsRect=tabs.getBoundingClientRect();const chessRect=chessTab.getBoundingClientRect();
    check(getComputedStyle(tabs).display==='grid','main navigation is not fixed eight-column grid');
    check(getComputedStyle(chessTab).display!=='none'&&getComputedStyle(chessTab).visibility!=='hidden','Chess-Results tab is hidden');
    check(chessRect.left>=tabsRect.left-2&&chessRect.right<=tabsRect.right+2,'Chess-Results tab is outside navigation viewport');

    showTab('pairings',document.getElementById('tabPairings'));
    check(document.getElementById('pairings').classList.contains('active'),'Pairings did not activate');
    check(saveAllCalls===0&&saveDataCalls===0,'clean navigation still performs persistence churn');
    check(stateDirty===false,'clean navigation incorrectly marked tournament dirty');

    const desk=document.querySelector('#pairings .result-palette');const boardWrap=document.querySelector('#pairings .live-pairing-table-wrap');const workspace=document.querySelector('#pairings .swiss-workspace');
    check(getComputedStyle(desk).position==='sticky','Result Desk is not sticky/fixed');
    check(getComputedStyle(desk).overflowY==='visible','Result Desk still has its own scrollbar');
    check(getComputedStyle(boardWrap).overflowY==='auto','board table is not the scroll surface');
    check(getComputedStyle(workspace).overflowY==='hidden','Pairings workspace leaks a second vertical scroll surface');
    check(getComputedStyle(document.getElementById('btnGenerateGacrux')).display!=='none','Generate Pairings is not visible');
    check(getComputedStyle(document.getElementById('pairingsChessResultsPublishBtn')).display!=='none','Pairings Chess-Results action is hidden');

    // Guarded render work must execute on its own page, but not after leaving it.
    renderLivePairings();check(liveRenderCalls===1,'Pairings renderer blocked while Pairings is active');
    showTab('standings');
    renderLivePairings();check(liveRenderCalls===1,'stale Pairings renderer ran after page leave');
    refreshFinalStandings();check(standingRenderCalls===1,'Standings renderer blocked while Standings is active');

    showTab('standings');
    check(document.getElementById('standings').classList.contains('active'),'missing tab-button fallback failed');
    check(saveAllCalls===0&&saveDataCalls===0,'button fallback lost clean fast path');

    const ids=['main','registration','pairings','standings','exportPage','schedule','chessresults'];
    for(let i=0;i<70;i++)showTab(ids[i%ids.length]);
    check(saveAllCalls===0&&saveDataCalls===0,'repeated clean navigation serialized tournament state');
    check(document.querySelectorAll('.page.active').length===1,'navigation left multiple active pages');
    check(window.__cpLinuxFluidUiStats.skippedStaleWork>=1,'stale-view guard stats missing');

    stateDirty=true;
    showTab('registration',document.getElementById('tabRegistration'));
    check(saveAllCalls===1,'dirty navigation skipped protected saveAll');
    check(saveDataCalls===1,'dirty navigation skipped protected saveData');
    check(window.__cpLinuxFluidUiStats.fastSwitches>=3,'fluid navigation stats missing');
    check(window.__cpLinuxFluidUiStats.dirtySwitches>=1,'dirty-path stats missing');
    check(document.title.includes('Chess-Publisher'),'build title was not synchronized');
    document.body.setAttribute('data-window-test','PASS');
  }catch(error){document.body.setAttribute('data-window-test','FAIL: '+error.message);}
});
</script></body></html>'''
    with tempfile.TemporaryDirectory(prefix='cp-fluid-browser-') as raw:
        temp = Path(raw)
        html = temp / 'fluid.html'
        rendered = inject_window_mode(fixture.encode())
        rendered = inject_fixed_result_desk(rendered)
        html.write_bytes(rendered)
        cp = _run_browser(_browser(), html.as_uri(), 1000)
        if cp.returncode != 0:
            raise RuntimeError(f'Fluid v2 Chromium failed rc={cp.returncode}: {cp.stderr[-2000:]}')
        if 'data-window-test="PASS"' not in cp.stdout:
            raise RuntimeError(f'Fluid v2 browser test failed: {cp.stdout[-5000:]}\n{cp.stderr[-2000:]}')
    print('LINUX_FLUID_WINDOW_BROWSER_V2=PASS (eight visible tabs, fixed Result Desk, 70 clean switches, stale render guard, dirty path preserved)')
    return 0

if __name__ == '__main__': raise SystemExit(main())
