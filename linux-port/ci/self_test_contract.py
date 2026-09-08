#!/usr/bin/env python3
from __future__ import annotations
import argparse,hashlib,json,shutil,subprocess,sys,tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
from build_info import APP_BUILD,ENGINE_VERSION

def sha(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for c in iter(lambda:f.read(1024*1024),b''):h.update(c)
    return h.hexdigest()

def main()->int:
    ap=argparse.ArgumentParser();ap.add_argument('--online-engines',action='store_true');args=ap.parse_args()
    with tempfile.TemporaryDirectory(prefix='cp-selftest-contract-') as td_raw:
        pkg=Path(td_raw)/'package';linux=pkg/'linux';source=pkg/'source'
        shutil.copytree(ROOT/'linux',linux,ignore=shutil.ignore_patterns('__pycache__','*.pyc','*.pyo'))
        source.mkdir(parents=True)
        app=source/'ChessPublisher.html'
        app.write_text('<!doctype html><html><body>Chess-Publisher Tournament Setup Pairings Chess-Results Registration DGT</body></html>\n',encoding='utf-8')
        source_manifest={'schema':1,'snapshotId':'ci-synthetic-self-test','baseRelease':'ci','files':{'ChessPublisher.html':{'size':app.stat().st_size,'sha256':sha(app)}}}
        (pkg/'source_manifest.json').write_text(json.dumps(source_manifest,indent=2)+'\n',encoding='utf-8')
        runtime={}
        for p in sorted(linux.rglob('*')):
            if p.is_file() and '__pycache__' not in p.parts and p.suffix not in {'.pyc','.pyo'}:
                runtime[p.relative_to(linux).as_posix()]={'size':p.stat().st_size,'sha256':sha(p)}
        (pkg/'PACKAGE-MANIFEST.json').write_text(json.dumps({'schema':3,'runtimeFiles':runtime,'source':source_manifest},indent=2)+'\n',encoding='utf-8')
        cmd=[sys.executable,str(linux/'self_test.py'),'--package-root',str(pkg),'--json']
        if args.online_engines:cmd.append('--online-engines')
        cp=subprocess.run(cmd,text=True,capture_output=True,timeout=150 if args.online_engines else 45,check=False,env={**__import__('os').environ,'PYTHONDONTWRITEBYTECODE':'1'})
        if cp.stdout:print(cp.stdout)
        if cp.stderr:print(cp.stderr,file=sys.stderr)
        if cp.returncode!=0:raise RuntimeError(f'self-test failed rc={cp.returncode}')
        result=json.loads(cp.stdout)
        if result.get('ok') is not True or result.get('failed')!=0:raise RuntimeError('self-test JSON did not report clean PASS')
        names={row.get('name'):row for row in result.get('tests',[])}
        for required in ('platform','protected-source','runtime-integrity','localengine-filesystem','http-delivery','platform-services'):
            if names.get(required,{}).get('status')!='PASS':raise RuntimeError(f'missing self-test PASS: {required}')
        if names['runtime-integrity'].get('detail',{}).get('verified') is not True:raise RuntimeError('runtime integrity was not verified')
        delivery=names['http-delivery'].get('detail',{})
        if delivery.get('appBuild')!=APP_BUILD or delivery.get('engineVersion')!=ENGINE_VERSION:raise RuntimeError('HTTP self-test build identity mismatch')
        if args.online_engines:
            row=names.get('online-engines',{})
            if row.get('status')!='PASS':raise RuntimeError('online engine self-test did not pass')
            detail=row.get('detail',{})
            if detail.get('gacrux')!='1.9.57' or detail.get('bbp')!='6.0.0':raise RuntimeError('online engine versions were not pinned as expected')
            print('LINUX_ON_MACHINE_SELF_TEST_ONLINE_ENGINES=PASS')
        else:print('LINUX_ON_MACHINE_SELF_TEST_CONTRACT=PASS')
    return 0

if __name__=='__main__':raise SystemExit(main())
