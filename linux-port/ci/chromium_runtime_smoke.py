#!/usr/bin/env python3
from __future__ import annotations
import shutil,subprocess,sys,tempfile,threading
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
import chess_publisher_linux as app
from build_info import APP_BUILD
from build_identity_integration import apply as apply_build_identity
apply_build_identity()


def main()->int:
    browser=(shutil.which('google-chrome') or shutil.which('google-chrome-stable') or shutil.which('chromium') or shutil.which('chromium-browser'))
    if not browser:raise RuntimeError('No Chromium/Chrome executable is available on the Ubuntu runner.')
    with tempfile.TemporaryDirectory(prefix='cp-chromium-smoke-') as td_raw:
        td=Path(td_raw);pkg=td/'package';src=pkg/'source';linux=pkg/'linux';data=td/'data'
        src.mkdir(parents=True);linux.mkdir(parents=True)
        shutil.copy2(ROOT/'linux'/'LinuxWebViewShim.js',linux/'LinuxWebViewShim.js')
        for rel in ('cloud/client/cloud-workspace-api.js','hub/client/hub-snapshot.js','hub/client/hub-api-client.js','webview/HubAdapter.js','webview/CloudWorkspaceAdapter.js'):
            p=src/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('/* chromium smoke placeholder */\n',encoding='utf-8')
        (src/'ChessPublisher.html').write_text('''<!doctype html><html><body>
<div id="probe">pending</div>
<script>
window.addEventListener('load',()=>setTimeout(()=>{
  const webview=!!(window.chrome&&window.chrome.webview&&typeof window.chrome.webview.postMessage==='function');
  const pgn=typeof window.cpNativeSaveTournamentPGN==='function';
  document.getElementById('probe').textContent=[document.documentElement.dataset.chesspublisherPlatform||'',document.documentElement.dataset.chesspublisherLinuxBuild||'',webview,pgn].join('|');
},50));
</script>
</body></html>\n''',encoding='utf-8')
        engine=app.LinuxEngine(pkg,data);srv=app.make_server(engine,'127.0.0.1',0,True);th=threading.Thread(target=srv.serve_forever,daemon=True);th.start()
        try:
            host,port=srv.server_address;url=f'http://{host}:{port}/'
            cp=subprocess.run([browser,'--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--proxy-server=direct://','--proxy-bypass-list=*','--virtual-time-budget=1200','--dump-dom',url],text=True,capture_output=True,timeout=30,check=False)
            if cp.returncode!=0:raise RuntimeError(f'Chromium failed rc={cp.returncode}: {cp.stderr[-2000:]}')
            expected=f'linux|{APP_BUILD}|true|true'
            if expected not in cp.stdout:raise RuntimeError(f'Chromium page probe did not reach expected Linux bridge state {expected!r}. DOM tail={cp.stdout[-2000:]} stderr={cp.stderr[-1000:]}')
            if 'linux-dev.2' in cp.stdout:raise RuntimeError('Chromium DOM contains stale linux-dev.2 build identity.')
            print('Browser:',browser)
            print('Probe:',expected)
            print('LINUX_CHROMIUM_RUNTIME_SMOKE=PASS')
        finally:
            srv.shutdown();srv.server_close();th.join(timeout=2)
    return 0

if __name__=='__main__':raise SystemExit(main())
