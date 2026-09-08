#!/usr/bin/env python3
"""Exercise windowed shell and popup navigation/geometry in real Chromium."""
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
body{margin:0;padding:12px;overflow:auto}.window{width:1000px;height:700px;margin:0 auto}.page{display:none}.page.active{display:block}
</style></head><body>
<div id="appWindow" class="window"><button id="tabMain" onclick="showTab('main')">Setup</button>
<button id="tabPairings" onclick="showTab('pairings')">Pairings</button>
<div class="content"><section id="main" class="page active"></section>
<section id="pairings" class="page"></section><section id="registration" class="page"></section>
<section id="standings" class="page"></section><section id="exportPage" class="page"></section>
<section id="schedule" class="page"></section><section id="chessresults" class="page"></section>
<section id="dgt" class="page"></section></div></div>
<script>
window.showTab=function(id){for(const p of document.querySelectorAll('.page'))p.classList.toggle('active',p.id===id);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,40));
function check(value,message){if(!value)throw new Error(message);}
function pointer(target,type,x,y){target.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,pointerId:7,pointerType:'mouse'}));}
window.addEventListener('load',()=>setTimeout(async()=>{
  try{
    const shell=document.getElementById('appWindow');
    check(Math.abs(shell.getBoundingClientRect().width-1000)<2,'main shell width was forced to viewport');
    check(getComputedStyle(document.body).overflow!=='hidden','body overflow was forced hidden');
    for(const id of ['pairings','registration','standings','exportPage','schedule','chessresults','dgt']){
      showTab(id);await pause();const page=document.getElementById(id);
      check(document.body.classList.contains('cp-linux-tab-popup-open'),'popup missing: '+id);
      check(getComputedStyle(page).display==='block','hidden popup: '+id);
      page.querySelector('.cp-linux-popup-close-btn').click();await pause();
      check(!document.body.classList.contains('cp-linux-tab-popup-open'),'close failed: '+id);
    }
    showTab('pairings');await pause();const page=document.getElementById('pairings');
    const label=page.querySelector('.cp-linux-popup-title');
    document.getElementById('tabPairings').textContent='Updated pairings';page.classList.add('probe');await pause();
    check(label.textContent==='Updated pairings','title did not update');
    page.style.setProperty('left','123px','important');page.style.setProperty('top','111px','important');page.style.setProperty('transform','none','important');
    page.style.width='980px';page.style.height='550px';
    check(getComputedStyle(page).width==='980px','resize width overridden');check(getComputedStyle(page).height==='550px','resize height overridden');
    const max=page.querySelector('.cp-linux-popup-max-btn');max.click();await pause();
    check(Math.abs(page.getBoundingClientRect().left-8)<1,'maximize left overridden by drag');check(Math.abs(page.getBoundingClientRect().top-68)<1,'maximize top overridden by drag');
    max.click();await pause();
    check(Math.abs(page.getBoundingClientRect().left-123)<1,'restore left lost');check(Math.abs(page.getBoundingClientRect().top-111)<1,'restore top lost');check(getComputedStyle(page).width==='980px','restore width lost');
    const bar=page.querySelector('.cp-linux-popup-titlebar');bar.setPointerCapture=()=>{};
    let r=page.getBoundingClientRect();pointer(bar,'pointerdown',r.left+30,r.top+15);pointer(bar,'pointermove',10000,10000);pointer(bar,'pointerup',10000,10000);await pause();
    r=page.getBoundingClientRect();check(r.right<=innerWidth+1,'drag escaped right viewport');check(r.bottom<=innerHeight+1,'drag escaped bottom viewport');
    pointer(bar,'pointerdown',r.left+30,r.top+15);pointer(bar,'pointermove',-10000,-10000);pointer(bar,'pointerup',-10000,-10000);await pause();
    r=page.getBoundingClientRect();check(r.left>=-1,'drag escaped left viewport');check(r.top>=31,'drag escaped above usable viewport');
    check(page.querySelectorAll('.cp-linux-popup-titlebar').length===1,'duplicate titlebar');
    document.body.setAttribute('data-window-test','PASS');
  }catch(error){document.body.setAttribute('data-window-test','FAIL: '+error.message);}
},50));
</script></body></html>'''
    with tempfile.TemporaryDirectory(prefix='cp-window-browser-') as raw:
        temp = Path(raw);html = temp / 'window.html';html.write_bytes(inject_window_mode(fixture.encode()))
        proc = subprocess.Popen([_browser(), '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--window-size=1440,1000',f'--user-data-dir={temp / "profile"}','--virtual-time-budget=4000','--dump-dom',html.as_uri()],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
        try: out, err = proc.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL);proc.communicate();raise RuntimeError('Popup navigation blocked the browser event loop') from None
        if proc.returncode or 'data-window-test="PASS"' not in out: raise RuntimeError(f'Popup browser test failed: {out}\n{err[-2000:]}')
    print('LINUX_WINDOW_BROWSER=PASS (windowed shell, 7 tabs, close, resize, maximize, restore, drag clamp)')
    return 0

if __name__ == '__main__': raise SystemExit(main())
