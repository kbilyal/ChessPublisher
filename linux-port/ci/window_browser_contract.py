#!/usr/bin/env python3
"""Exercise fluid single-workspace navigation in real Chromium."""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'linux'))
from window_integration import inject_window_mode
from chromium_runtime_smoke import _browser


def main() -> int:
    fixture = '''<!doctype html><html><head><style>
html,body{margin:0;width:100%;height:100%}.window{width:1000px;height:700px;margin:20px auto}.content{height:620px}.page{display:none}.page.active{display:block}
</style></head><body>
<div id="appWindow" class="window"><div class="app-resize-handle"></div><div class="titlebar"><span id="windowDocumentTitle">Old</span><span class="window-controls"><button title="Minimize">-</button><button title="Maximize / restore">[]</button><button class="window-close">X</button></span></div>
<div class="tabs"><button id="tabDgt" onclick="showTab('dgt',this)">DGT</button><button id="tabMain" onclick="showTab('main',this)">Setup</button>
<button id="tabRegistration" onclick="showTab('registration',this)">Players</button><button id="tabPairings" onclick="showTab('pairings',this)">Pairings</button>
<button id="tabStandings" onclick="showTab('standings',this)">Standings</button><button id="tabExport" onclick="showTab('exportPage',this)">Export</button>
<button id="tabSchedule" onclick="showTab('schedule',this)">Schedule</button><button id="tabChessResults" onclick="showTab('chessresults',this)">Chess-Results</button></div>
<div class="content"><section id="main" class="page active"></section><section id="pairings" class="page"></section><section id="registration" class="page"></section>
<section id="standings" class="page"></section><section id="exportPage" class="page"></section><section id="schedule" class="page"></section><section id="chessresults" class="page"></section><section id="dgt" class="page"></section></div></div>
<script>
let stateDirty=false;let saveAllCalls=0;let saveDataCalls=0;const data={preferences:{}};
function saveAll(){saveAllCalls++;}
function saveData(){saveDataCalls++;stateDirty=true;}
function updateWorkflowTabs(){}
function dgtOnTabLeave(){}
function dgtOnTabEnter(){}
function refreshChessResultsXmlUi(){}
window.showTab=function(id,button){
  updateWorkflowTabs();if(button?.classList?.contains('disabled'))return;
  const previousId=document.querySelector('.page.active')?.id||'';
  if(previousId===id&&button?.classList?.contains('active'))return;
  if(previousId==='dgt'&&id!=='dgt')dgtOnTabLeave();
  saveAll();document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.tabs button').forEach(t=>t.classList.remove('active'));
  document.getElementById(id).classList.add('active');button.classList.add('active');data.preferences.activeTab=id;saveData();
  if(id==='dgt')dgtOnTabEnter();if(id==='chessresults')setTimeout(refreshChessResultsXmlUi,0);
};
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
function check(value,message){if(!value)throw new Error(message);}
window.addEventListener('load',()=>setTimeout(async()=>{
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

    showTab('pairings',document.getElementById('tabPairings'));await pause();
    check(document.getElementById('pairings').classList.contains('active'),'Pairings did not activate');
    check(saveAllCalls===0&&saveDataCalls===0,'clean navigation still performs persistence churn');
    check(stateDirty===false,'clean navigation incorrectly marked tournament dirty');

    showTab('standings');await pause();
    check(document.getElementById('standings').classList.contains('active'),'missing tab-button fallback failed');
    check(saveAllCalls===0&&saveDataCalls===0,'button fallback lost clean fast path');

    const ids=['main','registration','pairings','standings','exportPage','schedule','chessresults'];
    for(let i=0;i<70;i++)showTab(ids[i%ids.length]);
    await pause();
    check(saveAllCalls===0&&saveDataCalls===0,'repeated clean navigation serialized tournament state');
    check(document.querySelectorAll('.page.active').length===1,'navigation left multiple active pages');

    stateDirty=true;
    showTab('registration',document.getElementById('tabRegistration'));await pause();
    check(saveAllCalls===1,'dirty navigation skipped protected saveAll');
    check(saveDataCalls===1,'dirty navigation skipped protected saveData');
    check(window.__cpLinuxFluidUiStats.fastSwitches>=3,'fluid navigation stats missing');
    check(window.__cpLinuxFluidUiStats.dirtySwitches>=1,'dirty-path stats missing');
    check(document.title.includes('Chess-Publisher'),'build title was not synchronized');
    document.body.setAttribute('data-window-test','PASS');
  }catch(error){document.body.setAttribute('data-window-test','FAIL: '+error.message);}
},50));
</script></body></html>'''
    with tempfile.TemporaryDirectory(prefix='cp-fluid-browser-') as raw:
        temp = Path(raw);html = temp / 'fluid.html';html.write_bytes(inject_window_mode(fixture.encode()))
        proc = subprocess.Popen([_browser(), '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--window-size=1440,1000',f'--user-data-dir={temp / "profile"}','--virtual-time-budget=4000','--dump-dom',html.as_uri()],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
        try: out, err = proc.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL);proc.communicate();raise RuntimeError('Fluid navigation blocked the browser event loop') from None
        if proc.returncode or 'data-window-test="PASS"' not in out: raise RuntimeError(f'Fluid workspace browser test failed: {out}\n{err[-2000:]}')
    print('LINUX_FLUID_WINDOW_BROWSER=PASS (single workspace, 70 clean switches without persistence churn, dirty path preserved)')
    return 0

if __name__ == '__main__': raise SystemExit(main())
