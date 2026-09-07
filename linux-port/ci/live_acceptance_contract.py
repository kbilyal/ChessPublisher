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
    # network request is attempted.
    with tempfile.TemporaryDirectory(prefix='cp-live-negative-') as td_raw:
        td=Path(td_raw)
        cp=subprocess.run([sys.executable,str(ROOT/'linux'/'live_acceptance.py'),'--package-root',str(ROOT),'--data-home',str(td),'--json'],text=True,capture_output=True,timeout=15,check=False,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        if cp.returncode!=2:raise RuntimeError(f'live acceptance without token did not block safely rc={cp.returncode}: {cp.stdout} {cp.stderr}')
        data=json.loads(cp.stdout);row=data.get('tests',[{}])[0]
        if row.get('status')!='BLOCKED' or 'Organizer Token' not in str(row.get('error')):raise RuntimeError('missing-token result was not an explicit BLOCKED Organizer Token state')

    # Positive transport contract: token comes only from local secret storage,
    # operation is exactly test with {}, and diagnostics never echo the token.
    with tempfile.TemporaryDirectory(prefix='cp-live-positive-') as td_raw:
        td=Path(td_raw);engine=LinuxEngine(ROOT,td)
        token='ci-organizer-token-value-not-for-network'
        engine.secret_op('set','organizer-primary',token)
        if stat.S_IMODE(engine.secrets_file.stat().st_mode)!=0o600:raise RuntimeError('test Organizer Token store is not 0600')
        seen=[]
        def transport(operation,payload,received_token):
            seen.append((operation,dict(payload),received_token));return {'ok':True,'sidVerified':True}
        result=chess_results_live_test(ROOT,td,transport=transport)
        if seen!=[('test',{},token)]:raise RuntimeError(f'live test used unexpected Worker contract: {seen!r}')
        serialized=json.dumps(result,sort_keys=True)
        if token in serialized:raise RuntimeError('live diagnostics leaked Organizer Token')
        if result.get('workerReachable') is not True or result.get('sidVerified') is not True or result.get('localBridgeCrypto') is not False:raise RuntimeError(f'live test sanitized result mismatch: {result}')
    print('LINUX_LIVE_ACCEPTANCE_CONTRACT=PASS')
    return 0

if __name__=='__main__':raise SystemExit(main())
