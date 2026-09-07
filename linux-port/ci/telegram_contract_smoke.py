#!/usr/bin/env python3
from __future__ import annotations
import json
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
import chess_publisher_linux as app
from telegram_runtime import TelegramRuntime
from telegram_integration import apply as apply_telegram

class FakeResponse:
    status=200
    def __enter__(self): return self
    def __exit__(self,*args): return False
    def read(self,n=-1): return json.dumps({'ok':True,'result':{'message_id':123}}).encode()

TOKEN='123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghi'
rt=TelegramRuntime()
with patch('telegram_runtime.urllib.request.urlopen',return_value=FakeResponse()) as call:
    result=rt.send_message(TOKEN,{'chat_id':'@test','text':'hello'})
    assert result.status==200 and result.payload.get('ok') is True
    req=call.call_args.args[0]
    assert req.full_url.startswith('https://api.telegram.org/bot')
    assert json.loads(req.data.decode())=={'chat_id':'@test','text':'hello'}

try: rt.send_message('bad-token',{'chat_id':'@x','text':'hello'})
except ValueError: pass
else: raise AssertionError('invalid token must fail closed')

apply_telegram()
with tempfile.TemporaryDirectory(prefix='cp-telegram-contract-') as td:
    engine=app.LinuxEngine(ROOT,Path(td)/'data')
    engine.telegram.send_message=lambda token,payload: type('R',(),{'status':200,'payload':{'ok':True,'result':{'message_id':7}}})()
    srv=app.make_server(engine,'127.0.0.1',0,True)
    th=threading.Thread(target=srv.serve_forever,daemon=True);th.start()
    try:
        host,port=srv.server_address;base=f'http://{host}:{port}'
        body=json.dumps({'token':TOKEN,'payload':{'chat_id':'@test','text':'hello'}}).encode()
        req=urllib.request.Request(base+'/telegram/send-message',data=body,method='POST',headers={'Content-Type':'application/json','Origin':base})
        with urllib.request.urlopen(req,timeout=3) as resp:
            payload=json.loads(resp.read().decode())
        assert payload.get('ok') is True
        bad=urllib.request.Request(base+'/telegram/send-message',data=body,method='POST',headers={'Content-Type':'application/json','Origin':'https://evil.example'})
        try: urllib.request.urlopen(bad,timeout=3)
        except urllib.error.HTTPError as exc: assert exc.code==403
        else: raise AssertionError('external origin must be rejected')
    finally:
        srv.shutdown();srv.server_close();th.join(timeout=2)

print('TELEGRAM_LINUX_CONTRACT=PASS')
