#!/usr/bin/env python3
"""Create a reproducible Linux development bundle from the pinned source snapshot."""
from __future__ import annotations
import argparse, hashlib, json, shutil, tarfile, tempfile
from pathlib import Path
import sys

HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE/'linux'))
from source_guard import verify_source
from build_info import APP_BUILD,ENGINE_VERSION,DISPLAY_VERSION

COPY_IGNORE=shutil.ignore_patterns('__pycache__','*.pyc','*.pyo')
FIDE_SEED_NAMES=('standard_rating_list.zip','rapid_rating_list.zip','blitz_rating_list.zip')

def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def runtime_manifest(linux_root:Path)->dict[str,dict[str,object]]:
    rows={}
    for p in sorted(linux_root.rglob('*')):
        if not p.is_file() or '__pycache__' in p.parts or p.suffix in {'.pyc','.pyo'}:continue
        rel=p.relative_to(linux_root).as_posix()
        rows[rel]={'size':p.stat().st_size,'sha256':sha256(p)}
    return rows

def copy_fide_seed(target:Path)->dict[str,dict[str,object]]:
    source=HERE.parent/'fide';rows={}
    for name in FIDE_SEED_NAMES:
        src=source/name
        if not src.is_file():continue
        target.mkdir(parents=True,exist_ok=True);dst=target/name;shutil.copy2(src,dst)
        rows[name]={'size':dst.stat().st_size,'sha256':sha256(dst)}
    return rows

def main()->int:
    ap=argparse.ArgumentParser()
    ap.add_argument('--source',type=Path,required=True,help='Exact current Chess-Publisher source directory')
    ap.add_argument('--output',type=Path,required=True,help='Output .tar.gz path')
    args=ap.parse_args()
    manifest=HERE/'source_manifest.json'
    verified=verify_source(args.source,manifest)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='cp-linux-bundle-') as td:
        root=Path(td)/'Chess-Publisher-Linux'
        shutil.copytree(HERE/'linux',root/'linux',ignore=COPY_IGNORE)
        shutil.copytree(args.source,root/'source',ignore=COPY_IGNORE)
        shutil.copy2(manifest,root/'source_manifest.json')
        fide_seed=copy_fide_seed(root/'fide-cache')
        for name in ('run-chess-publisher.sh','run-self-test.sh'):
            p=root/'linux'/name
            if p.is_file():p.chmod(0o755)
        (root/'requirements.txt').write_text('networkx==3.6.1\n',encoding='utf-8')
        (root/'README-LINUX.txt').write_text(
            f'Chess-Publisher Linux development bundle {DISPLAY_VERSION}\n'
            f'App build: {APP_BUILD}\n'
            f'LocalEngine: {ENGINE_VERSION}\n'
            f"Source snapshot: {verified['snapshotId']}\n"
            f"Base release: {verified['baseRelease']}\n\n"
            'Install dependency: python3 -m pip install -r requirements.txt\n'
            'Run: ./linux/run-chess-publisher.sh\n'
            'Offline self-test: ./linux/run-self-test.sh\n'
            'Pinned engine download test: ./linux/run-self-test.sh --online-engines\n'
            'Real DGT BOARD_DUMP test: ./linux/run-self-test.sh --dgt-connect\n'
            'FIDE Standard/Rapid/Blitz seed cache is included for offline startup.\n'
            'DGT USB users may need membership in the dialout group.\n',encoding='utf-8')
        runtime=runtime_manifest(root/'linux')
        build={'schema':3,'displayVersion':DISPLAY_VERSION,'appBuild':APP_BUILD,'engineVersion':ENGINE_VERSION,'source':verified,'runtimeFiles':runtime,'fideSeedFiles':fide_seed,'selfTestCommand':'./linux/run-self-test.sh','bytecodeIncluded':False}
        (root/'BUILD-MANIFEST.json').write_text(json.dumps(build,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        with tarfile.open(args.output,'w:gz',format=tarfile.PAX_FORMAT) as tf:
            tf.add(root,arcname=root.name,recursive=True)
    print(json.dumps({'ok':True,'output':str(args.output),'sha256':sha256(args.output),'sourceSnapshot':verified['snapshotId'],'appBuild':APP_BUILD,'engineVersion':ENGINE_VERSION,'runtimeFiles':len(runtime),'fideSeedFiles':len(fide_seed),'selfTestCommand':'./linux/run-self-test.sh','bytecodeIncluded':False},indent=2))
    return 0
if __name__=='__main__':raise SystemExit(main())
