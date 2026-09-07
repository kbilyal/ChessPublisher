#!/usr/bin/env python3
"""Ubuntu localhost HTTP contract smoke for the integrated Linux LocalEngine."""
from __future__ import annotations
import json, sys, tempfile, threading, urllib.error, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
import chess_publisher_linux as app
from fide_integration import apply
from fide_runtime import build_legacy_index
apply()


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
        data=Path(td_raw)/'data'; engine=app.LinuxEngine(ROOT,data)
        engine.fide.lists_dir.mkdir(parents=True,exist_ok=True)
        sample=('12345678       Player, Test                                                 BUL M 1500 0 40 2000\n')*20
        for key in ('std','rapid','blitz'):engine.fide.list_path(key).write_text(sample,encoding='utf-8')
        xml=Path(td_raw)/'players.xml';xml.write_text(xml_fixture(),encoding='utf-8');build_legacy_index(xml,engine.fide.legacy_db)
        engine.fide.metadata_file.write_text(json.dumps({'updatedAt':'2026-09-07T00:00:00Z','lists':{k:{} for k in ('std','rapid','blitz')},'legacy':{'players':1001}}),encoding='utf-8')
        srv=app.make_server(engine,'127.0.0.1',0,True);th=threading.Thread(target=srv.serve_forever,daemon=True);th.start()
        try:
            host,port=srv.server_address;base=f'http://{host}:{port}'
            with urllib.request.urlopen(base+'/health',timeout=3) as r:health=json.loads(r.read())
            if not health.get('ok'):raise RuntimeError('health failed')
            with urllib.request.urlopen(base+'/fide/status',timeout=3) as r:status=json.loads(r.read())
            if not status.get('ready'):raise RuntimeError('FIDE status not ready')
            for key in ('std','rapid','blitz'):
                with urllib.request.urlopen(base+'/fide/'+key,timeout=3) as r:
                    if len(r.read())<1000:raise RuntimeError(key+' list too short')
            code,payload=post(base+'/fide/players-lookup',{'fideIds':['1503014']})
            if code!=200 or payload['players'][0]['name']!='Carlsen, Magnus':raise RuntimeError('lookup contract failed')
            code,payload=post(base+'/fide/players-search',{'query':'Carlsen','limit':60})
            if code!=200 or payload['players'][0]['fideId']!='1503014':raise RuntimeError('search contract failed')
            # Write-capable localhost operations reject non-local browser origins.
            code,payload=post(base+'/fide/players-search',{'query':'Carlsen'},origin='https://evil.example')
            if code!=403:raise RuntimeError('external Origin was not rejected')
            print(json.dumps({'health':True,'fideStatus':True,'monthlyLists':3,'lookup':True,'search':True,'externalOriginRejected':True},indent=2))
            print('LOCALENGINE_CONTRACT_SMOKE=PASS')
        finally:
            srv.shutdown();srv.server_close();th.join(timeout=2)
    return 0

if __name__=='__main__':raise SystemExit(main())
