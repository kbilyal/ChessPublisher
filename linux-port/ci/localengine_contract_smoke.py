#!/usr/bin/env python3
"""Ubuntu localhost HTTP contract smoke for the integrated Linux LocalEngine."""
from __future__ import annotations
import json, shutil, sys, tempfile, threading, urllib.error, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
import chess_publisher_linux as app
from build_info import APP_BUILD,ENGINE_VERSION
from build_identity_integration import apply as apply_build_identity
from fide_integration import apply as apply_fide
from fide_runtime import build_legacy_index
apply_build_identity();apply_fide()


def xml_fixture()->str:
    rows=['<playerslist>', '<player><fideid>1503014</fideid><name>Carlsen, Magnus</name><country>NOR</country><sex>M</sex><title>GM</title><w_title></w_title><o_title></o_title><foa_title></foa_title><rating>2823</rating><games>1</games><k>10</k><rapid_rating>2810</rapid_rating><rapid_games>1</rapid_games><rapid_k>10</rapid_k><blitz_rating>2880</blitz_rating><blitz_games>1</blitz_games><blitz_k>10</blitz_k><birthday>1990</birthday><flag></flag></player>']
    for i in range(1000):
        rows.append(f'<player><fideid>{700000000+i}</fideid><name>HTTP Fixture {i}</name><country>FID</country><sex>M</sex><title></title><w_title></w_title><o_title></o_title><foa_title></foa_title><rating>0</rating><games>0</games><k>0</k><rapid_rating>0</rapid_rating><rapid_games>0</rapid_games><rapid_k>0</rapid_k><blitz_rating>0</blitz_rating><blitz_games>0</blitz_games><blitz_k>0</blitz_k><birthday>2000</birthday><flag></flag></player>')
    rows.append('</playerslist>'); return ''.join(rows)


def post(url:str,obj:dict,origin:str|None=None)->tuple[int,dict]:
    headers={'Content-Type':'application/json'}
    if origin:headers['Origin']=origin
    req=urllib.request.Request(url,data=json.dumps(obj).encode(),method='POST',headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=3) as r:return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e:return e.code,json.loads(e.read())


def main()->int:
    with tempfile.TemporaryDirectory(prefix='cp-linux-http-') as td_raw:
        td=Path(td_raw);pkg=td/'package';data=td/'data';source=pkg/'source';linux=pkg/'linux'
        source.mkdir(parents=True);linux.mkdir(parents=True)
        (source/'ChessPublisher.html').write_text('<!doctype html><html><body><main id="app">Chess-Publisher</main></body></html>\n',encoding='utf-8')
        shutil.copy2(ROOT/'linux'/'LinuxWebViewShim.js',linux/'LinuxWebViewShim.js')
        engine=app.LinuxEngine(pkg,data)
        engine.fide.lists_dir.mkdir(parents=True,exist_ok=True)
        sample=('12345678       Player, Test                                                 BUL M 1500 0 40 2000\n')*20
        for key in ('std','rapid','blitz'):engine.fide.list_path(key).write_text(sample,encoding='utf-8')
        xml=td/'players.xml';xml.write_text(xml_fixture(),encoding='utf-8');build_legacy_index(xml,engine.fide.legacy_db)
        engine.fide.metadata_file.write_text(json.dumps({'updatedAt':'2026-09-07T00:00:00Z','lists':{k:{} for k in ('std','rapid','blitz')},'legacy':{'players':1001}}),encoding='utf-8')
        srv=app.make_server(engine,'127.0.0.1',0,True);th=threading.Thread(target=srv.serve_forever,daemon=True);th.start()
        try:
            host,port=srv.server_address;base=f'http://{host}:{port}'
            with urllib.request.urlopen(base+'/health',timeout=3) as r:health=json.loads(r.read())
            if not health.get('ok') or health.get('appBuild')!=APP_BUILD or health.get('engineVersion')!=ENGINE_VERSION:raise RuntimeError(f'health/build identity failed: {health}')
            with urllib.request.urlopen(base+'/',timeout=3) as r:served=r.read().decode('utf-8')
            marker=f"document.documentElement.dataset.chesspublisherLinuxBuild='{APP_BUILD}';"
            if served.count(marker)!=1:raise RuntimeError('served UI does not contain exactly one canonical Linux build marker')
            if 'linux-dev.2' in served:raise RuntimeError('served UI still contains stale linux-dev.2 marker')
            if '<script src="/linux/LinuxWebViewShim.js"></script>' not in served:raise RuntimeError('Linux WebView shim injection is missing')
            with urllib.request.urlopen(base+'/linux/LinuxWebViewShim.js',timeout=3) as r:shim=r.read().decode('utf-8')
            if '__cpLinuxWebViewShimLoaded' not in shim or 'chesspublisherPlatform="linux"' not in shim:raise RuntimeError('Linux WebView shim static route/identity failed')
            with urllib.request.urlopen(base+'/fide/status',timeout=3) as r:status=json.loads(r.read())
            if not status.get('ready'):raise RuntimeError('FIDE status not ready')
            for key in ('std','rapid','blitz'):
                with urllib.request.urlopen(base+'/fide/'+key,timeout=3) as r:
                    if len(r.read())<1000:raise RuntimeError(key+' list too short')
            code,payload=post(base+'/fide/players-lookup',{'fideIds':['1503014']})
            if code!=200 or payload['players'][0]['name']!='Carlsen, Magnus':raise RuntimeError('lookup contract failed')
            code,payload=post(base+'/fide/players-search',{'query':'Carlsen','limit':60})
            if code!=200 or payload['players'][0]['fideId']!='1503014':raise RuntimeError('search contract failed')
            code,payload=post(base+'/fide/players-search',{'query':'Carlsen'},origin='https://evil.example')
            if code!=403:raise RuntimeError('external Origin was not rejected')
            print(json.dumps({'health':True,'appBuild':APP_BUILD,'engineVersion':ENGINE_VERSION,'servedUiIdentity':True,'linuxShimRoute':True,'fideStatus':True,'monthlyLists':3,'lookup':True,'search':True,'externalOriginRejected':True},indent=2))
            print('LOCALENGINE_CONTRACT_SMOKE=PASS')
        finally:
            srv.shutdown();srv.server_close();th.join(timeout=2)
    return 0

if __name__=='__main__':raise SystemExit(main())
