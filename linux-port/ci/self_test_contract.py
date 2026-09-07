#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,shutil,subprocess,sys,tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def sha(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for c in iter(lambda:f.read(1024*1024),b''):h.update(c)
    return h.hexdigest()

def main()->int:
    with tempfile.TemporaryDirectory(prefix='cp-selftest-contract-') as td_raw:
        pkg=Path(td_raw)/'package';linux=pkg/'linux';source=pkg/'source'
        shutil.copytree(ROOT/'linux',linux,ignore=shutil.ignore_patterns('__pycache__','*.pyc','*.pyo'))
        source.mkdir(parents=True)
        app=source/'ChessPublisher.html';app.write_text('<!doctype html><html><body>self-test</body></html>\n',encoding='utf-8')
        source_manifest={'schema':1,'snapshotId':'ci-synthetic-self-test','baseRelease':'ci','files':{'ChessPublisher.html':{'size':app.stat().st_size,'sha256':sha(app)}}}
        (pkg/'source_manifest.json').write_text(json.dumps(source_manifest,indent=2)+'\n',encoding='utf-8')
        runtime={}
        for p in sorted(linux.rglob('*')):
            if p.is_file() and '__pycache__' not in p.parts and p.suffix not in {'.pyc','.pyo'}:
                runtime[p.relative_to(linux).as_posix()]={'size':p.stat().st_size,'sha256':sha(p)}
        (pkg/'PACKAGE-MANIFEST.json').write_text(json.dumps({'schema':2,'runtimeFiles':runtime,'source':source_manifest},indent=2)+'\n',encoding='utf-8')
        cp=subprocess.run([sys.executable,str(linux/'self_test.py'),'--package-root',str(pkg),'--json'],text=True,capture_output=True,timeout=45,check=False)
        if cp.stdout:print(cp.stdout)
        if cp.stderr:print(cp.stderr,file=sys.stderr)
        if cp.returncode!=0:raise RuntimeError(f'offline self-test failed rc={cp.returncode}')
        result=json.loads(cp.stdout)
        if result.get('ok') is not True or result.get('failed')!=0:raise RuntimeError('self-test JSON did not report clean PASS')
        names={row.get('name'):row for row in result.get('tests',[])}
        for required in ('platform','protected-source','runtime-integrity','localengine-filesystem','platform-services'):
            if names.get(required,{}).get('status')!='PASS':raise RuntimeError(f'missing self-test PASS: {required}')
        if names['runtime-integrity'].get('detail',{}).get('verified') is not True:raise RuntimeError('runtime integrity was not verified')
        print('LINUX_ON_MACHINE_SELF_TEST_CONTRACT=PASS')
    return 0

if __name__=='__main__':raise SystemExit(main())
