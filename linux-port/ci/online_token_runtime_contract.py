#!/usr/bin/env python3
"""Regression contract for Linux Organizer Token scope and Hub/Cloud proxy policy."""
from __future__ import annotations
import io,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'linux'))
import chess_publisher_linux as cp
from hub_proxy_integration import apply as apply_hub_proxy
from chess_results_runtime import ChessResultsRuntime,ChessResultsRuntimeError
apply_hub_proxy()


def scoped_token_contract()->None:
    with tempfile.TemporaryDirectory(prefix='cp-token-scope-') as td_raw:
        td=Path(td_raw);calls=[]
        scoped='organizer-primary:install:12345678-abcd';other='organizer-primary:install:87654321-other'
        def transport(op,payload,token):
            calls.append((op,dict(payload),token))
            if op=='create':return {'ok':True,'key':'12345','ownershipProof':'proof'}
            return {'ok':True}
        rt=ChessResultsRuntime(lambda:{scoped:'right-token',other:'wrong-token'},td/'proofs.json',transport=transport)
        rt.request('create',{'_cpOrganizerSecretKey':scoped,'tournament':'T','federation':'XXX','mode':'test','clientId':'c'})
        if calls[-1][2]!='right-token':raise RuntimeError('Chess-Results did not use the requested installation-scoped Organizer Token')
        if '_cpOrganizerSecretKey' in calls[-1][1]:raise RuntimeError('internal Organizer Token scope marker leaked to Worker payload')
        try:rt.request('test',{})
        except ChessResultsRuntimeError:pass
        else:raise RuntimeError('runtime scanned another installation scope without an explicit current-scope key')
        try:rt.request('test',{'_cpOrganizerSecretKey':'organizer-primary:bad'})
        except ChessResultsRuntimeError:pass
        else:raise RuntimeError('invalid Organizer Token installation scope was accepted')


def hub_proxy_origin_contract()->None:
    captured={}
    class Response:
        status=200;headers={'Content-Type':'application/json'}
        def read(self):return b'{"ok":true}'
        def __enter__(self):return self
        def __exit__(self,*_args):return None
    original=cp.urllib.request.urlopen
    def fake(req,timeout=0):
        captured['url']=req.full_url;captured['headers']={k.lower():v for k,v in req.header_items()};captured['method']=req.method
        return Response()
    cp.urllib.request.urlopen=fake
    class Dummy:
        command='GET';headers={'Accept':'application/json','Authorization':'Bearer tok','Origin':'http://127.0.0.1:18765','Content-Length':'0'};rfile=io.BytesIO(b'')
        def _text(self,status,data,ctype):captured['response']=(status,data,ctype)
        def _json(self,status,obj):raise RuntimeError(f'unexpected proxy JSON error {status}: {obj}')
    try:cp.Handler._proxy_worker(Dummy(),'/proxy/hub-api/api/v1/cloud/workspace','')
    finally:cp.urllib.request.urlopen=original
    if captured.get('url')!='https://chess-publisher-hub-api-beta.kyamranbilyal.workers.dev/api/v1/cloud/workspace':raise RuntimeError('Hub/Cloud proxy target mismatch')
    headers=captured.get('headers',{})
    if headers.get('authorization')!='Bearer tok':raise RuntimeError('Organizer Authorization header was not forwarded')
    if headers.get('origin')!='https://web.chess-publisher.org':raise RuntimeError('Hub/Cloud upstream Origin is not normalized to WEB_ORIGIN')
    if headers.get('user-agent')!='Chess-Publisher-Linux-HubProxy/1':raise RuntimeError('Linux Hub proxy user-agent marker missing')
    if 'x-client-version' in headers:raise RuntimeError('forbidden X-Client-Version header was reintroduced')


def main()->int:
    scoped_token_contract();hub_proxy_origin_contract()
    print('LINUX_ORGANIZER_TOKEN_RUNTIME_CONTRACT=PASS')
    return 0
if __name__=='__main__':raise SystemExit(main())
