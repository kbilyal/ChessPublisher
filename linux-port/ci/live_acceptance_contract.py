#!/usr/bin/env python3
from __future__ import annotations
import json,os,stat,subprocess,sys,tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
from chess_publisher_linux import LinuxEngine
from live_acceptance import chess_results_live_test


def main()->int:
    # Negative contract: with no Organizer Token the CLI must block before any
    # network request is attempted. Explicitly remove inherited env credentials.
    with tempfile.TemporaryDirectory(prefix='cp-live-negative-') as td_raw:
        td=Path(td_raw);env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'};env.pop('CP_ORGANIZER_TOKEN',None)
        cp=subprocess.run([sys.executable,str(ROOT/'linux'/'live_acceptance.py'),'--package-root',str(ROOT),'--data-home',str(td),'--json'],text=True,capture_output=True,timeout=15,check=False,env=env)
        if cp.returncode!=2:raise RuntimeError(f'live acceptance without token did not block safely rc={cp.returncode}: {cp.stdout} {cp.stderr}')
        data=json.loads(cp.stdout);row=data.get('tests',[{}])[0]
        if row.get('status')!='BLOCKED' or 'Organizer Token' not in str(row.get('error')):raise RuntimeError('missing-token result was not an explicit BLOCKED Organizer Token state')

    # Positive stored-secret transport contract: operation is exactly test with
    # {}, storage stays 0600, and diagnostics never echo the token.
    with tempfile.TemporaryDirectory(prefix='cp-live-stored-') as td_raw:
        td=Path(td_raw);engine=LinuxEngine(ROOT,td)
        token='ci-organizer-token-value-not-for-network'
        engine.secret_op('set','organizer-primary',token)
        if stat.S_IMODE(engine.secrets_file.stat().st_mode)!=0o600:raise RuntimeError('test Organizer Token store is not 0600')
        seen=[]
        def transport(operation,payload,received_token):
            seen.append((operation,dict(payload),received_token));return {'ok':True,'sidVerified':True}
        old=os.environ.pop('CP_ORGANIZER_TOKEN',None)
        try:result=chess_results_live_test(ROOT,td,transport=transport)
        finally:
            if old is not None:os.environ['CP_ORGANIZER_TOKEN']=old
        if seen!=[('test',{},token)]:raise RuntimeError(f'live test used unexpected Worker contract: {seen!r}')
        serialized=json.dumps(result,sort_keys=True)
        if token in serialized:raise RuntimeError('live diagnostics leaked Organizer Token')
        if result.get('tokenSource')!='installation-secret-store' or result.get('tokenPersistedByTest') is not False:raise RuntimeError(f'stored token source diagnostics mismatch: {result}')

    # Positive ephemeral contract: CP_ORGANIZER_TOKEN must be usable without
    # creating secrets.json or any credential-bearing persistent file.
    with tempfile.TemporaryDirectory(prefix='cp-live-ephemeral-') as td_raw:
        td=Path(td_raw);engine=LinuxEngine(ROOT,td);token='ci-ephemeral-organizer-token-not-for-network';seen=[]
        def transport_env(operation,payload,received_token):
            seen.append((operation,dict(payload),received_token));return {'ok':True,'sidVerified':True}
        old=os.environ.get('CP_ORGANIZER_TOKEN');os.environ['CP_ORGANIZER_TOKEN']=token
        try:result=chess_results_live_test(ROOT,td,transport=transport_env)
        finally:
            if old is None:os.environ.pop('CP_ORGANIZER_TOKEN',None)
            else:os.environ['CP_ORGANIZER_TOKEN']=old
        if seen!=[('test',{},token)]:raise RuntimeError(f'ephemeral live test used unexpected Worker contract: {seen!r}')
        if engine.secrets_file.exists():raise RuntimeError('ephemeral live acceptance persisted secrets.json')
        serialized=json.dumps(result,sort_keys=True)
        if token in serialized:raise RuntimeError('ephemeral diagnostics leaked Organizer Token')
        if result.get('tokenSource')!='environment' or result.get('tokenPersistedByTest') is not False:raise RuntimeError(f'ephemeral token source diagnostics mismatch: {result}')
        if result.get('workerReachable') is not True or result.get('sidVerified') is not True or result.get('localBridgeCrypto') is not False:raise RuntimeError(f'live test sanitized result mismatch: {result}')
    print('LINUX_LIVE_ACCEPTANCE_CONTRACT=PASS')
    return 0

if __name__=='__main__':raise SystemExit(main())
