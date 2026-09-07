#!/usr/bin/env python3
"""Verify the installed-style LocalEngine actually routes /fide-update to FideRuntime."""
from __future__ import annotations
import json, shutil, sys, tempfile, threading, urllib.error, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
import chess_publisher_linux as app
from build_identity_integration import apply as apply_build_identity
from fide_integration import apply as apply_fide

apply_build_identity(); apply_fide()

def post(url:str, obj:dict, origin:str|None=None):
    headers={'Content-Type':'application/json'}
    if origin: headers['Origin']=origin
    req=urllib.request.Request(url,data=json.dumps(obj).encode(),method='POST',headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=3) as r:return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e:return e.code,json.loads(e.read())

def main()->int:
    with tempfile.TemporaryDirectory(prefix='cp-fide-endpoint-') as td_raw:
        td=Path(td_raw); pkg=td/'package'; source=pkg/'source'; linux=pkg/'linux'
        source.mkdir(parents=True); linux.mkdir(parents=True)
        (source/'ChessPublisher.html').write_text("<html><body><script>document.documentElement.dataset.chesspublisherLinuxBuild='old';</script></body></html>\n",encoding='utf-8')
        shutil.copy2(ROOT/'linux'/'LinuxWebViewShim.js',linux/'LinuxWebViewShim.js')
        engine=app.LinuxEngine(pkg,td/'data')
        calls=[]
        def fake_update():
            calls.append('update')
            return {'ok':True,'updated':True,'lists':{'std':1,'rapid':1,'blitz':1}}
        engine.fide.update=fake_update
        srv=app.make_server(engine,'127.0.0.1',0,True); th=threading.Thread(target=srv.serve_forever,daemon=True); th.start()
        try:
            host,port=srv.server_address; base=f'http://{host}:{port}'
            code,payload=post(base+'/fide-update',{})
            if code!=200 or payload.get('updated') is not True or calls!=['update']:
                raise RuntimeError(f'FIDE update route did not reach runtime: code={code} payload={payload} calls={calls}')
            code,payload=post(base+'/fide-update',{},origin='https://evil.example')
            if code!=403 or calls!=['update']:
                raise RuntimeError('FIDE update external-Origin guard failed')
            print('FIDE_LOCALENGINE_UPDATE_ENDPOINT=PASS')
        finally:
            srv.shutdown(); srv.server_close(); th.join(timeout=2)
    return 0

if __name__=='__main__': raise SystemExit(main())
