#!/usr/bin/env python3
"""Create a reproducible Linux development bundle from the pinned source snapshot."""
from __future__ import annotations
import argparse, hashlib, json, shutil, tarfile, tempfile
from pathlib import Path
import sys

HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE/'linux'))
from source_guard import verify_source

COPY_IGNORE=shutil.ignore_patterns('__pycache__','*.pyc','*.pyo')

def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

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
        (root/'requirements.txt').write_text('networkx==3.6.1\n',encoding='utf-8')
        (root/'README-LINUX.txt').write_text(
            'Chess-Publisher Linux development bundle\n'
            f"Source snapshot: {verified['snapshotId']}\n"
            f"Base release: {verified['baseRelease']}\n\n"
            'Install dependency: python3 -m pip install -r requirements.txt\n'
            'Run: ./linux/run-chess-publisher.sh\n'
            'DGT USB users may need membership in the dialout group.\n',encoding='utf-8')
        build={'schema':1,'source':verified,'runtimeFiles':{},'bytecodeIncluded':False}
        for p in sorted((root/'linux').glob('*')):
            if p.is_file():build['runtimeFiles'][p.name]={'size':p.stat().st_size,'sha256':sha256(p)}
        (root/'BUILD-MANIFEST.json').write_text(json.dumps(build,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        with tarfile.open(args.output,'w:gz',format=tarfile.PAX_FORMAT) as tf:
            tf.add(root,arcname=root.name,recursive=True)
    print(json.dumps({'ok':True,'output':str(args.output),'sha256':sha256(args.output),'sourceSnapshot':verified['snapshotId'],'bytecodeIncluded':False},indent=2))
    return 0
if __name__=='__main__':raise SystemExit(main())
