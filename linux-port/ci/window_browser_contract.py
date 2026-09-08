#!/usr/bin/env python3
"""Exercise popup navigation and geometry in a real Chromium event loop."""
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
.page{display:none}.page.active{display:block}
</style></head><body>
<button id="tabMain" onclick="showTab('main')">Setup</button>
<button id="tabPairings" onclick="showTab('pairings')">Pairings</button>
<div class="content"><section id="main" class="page active"></section>
<section id="pairings" class="page"></section>
<section id="registration" class="page"></section>
<section id="standings" class="page"></section>
<section id="exportPage" class="page"></section>
<section id="schedule" class="page"></section>
<section id="chessresults" class="page"></section>
<section id="dgt" class="page"></section></div>
<script>
window.showTab=function(id){
  for(const p of document.querySelectorAll('.page'))p.classList.toggle('active',p.id===id);
};
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
function check(value,message){if(!value)throw new Error(message);}
window.addEventListener('load',()=>setTimeout(async()=>{
  try{
    for(const id of ['pairings','registration','standings','exportPage','schedule','chessresults','dgt']){
      showTab(id);await pause();
      const page=document.getElementById(id);
      check(document.body.classList.contains('cp-linux-tab-popup-open'),'popup missing: '+id);
      check(getComputedStyle(page).display==='block','hidden popup: '+id);
      page.querySelector('.cp-linux-popup-close-btn').click();await pause();
      check(!document.body.classList.contains('cp-linux-tab-popup-open'),'close failed: '+id);
    }
    showTab('pairings');await pause();
    const page=document.getElementById('pairings');
    const label=page.querySelector('.cp-linux-popup-title');
    document.getElementById('tabPairings').textContent='Updated pairings';
    page.classList.add('probe');await pause();
    check(label.textContent==='Updated pairings','title did not update');
    page.style.setProperty('left','123px','important');
    page.style.setProperty('top','111px','important');
    page.style.setProperty('transform','none','important');
    page.style.width='980px';page.style.height='550px';
    check(getComputedStyle(page).width==='980px','resize width overridden');
    check(getComputedStyle(page).height==='550px','resize height overridden');
    const max=page.querySelector('.cp-linux-popup-max-btn');
    max.click();await pause();
    check(page.getBoundingClientRect().left===8,'maximize left overridden by drag');
    check(page.getBoundingClientRect().top===68,'maximize top overridden by drag');
    max.click();await pause();
    check(page.getBoundingClientRect().left===123,'restore left lost');
    check(page.getBoundingClientRect().top===111,'restore top lost');
    check(getComputedStyle(page).width==='980px','restore width lost');
    check(page.querySelectorAll('.cp-linux-popup-titlebar').length===1,'duplicate titlebar');
    document.body.setAttribute('data-window-test','PASS');
  }catch(error){document.body.setAttribute('data-window-test','FAIL: '+error.message);}
},50));
</script></body></html>'''
    with tempfile.TemporaryDirectory(prefix='cp-window-browser-') as raw:
        temp = Path(raw)
        html = temp / 'window.html'
        html.write_bytes(inject_window_mode(fixture.encode()))
        proc = subprocess.Popen([
            _browser(), '--headless=new', '--no-sandbox', '--disable-gpu',
            '--disable-dev-shm-usage', '--window-size=1440,1000',
            f'--user-data-dir={temp / "profile"}', '--virtual-time-budget=3000',
            '--dump-dom', html.as_uri(),
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            out, err = proc.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate()
            raise RuntimeError('Popup navigation blocked the browser event loop') from None
        if proc.returncode or 'data-window-test="PASS"' not in out:
            raise RuntimeError(f'Popup browser test failed: {out}\n{err[-2000:]}')
    print('LINUX_WINDOW_BROWSER=PASS (7 tabs, close, title, resize, maximize, restore)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
