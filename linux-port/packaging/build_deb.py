#!/usr/bin/env python3
"""Build an amd64 Ubuntu/Debian development package from verified Chess-Publisher source."""
from __future__ import annotations
import argparse,hashlib,json,shutil,subprocess,tempfile
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
from source_guard import verify_source
from build_info import APP_BUILD,ENGINE_VERSION,DEB_VERSION,DISPLAY_VERSION

PACKAGE='chess-publisher'
DEFAULT_SOURCE_MANIFEST=ROOT/'source_manifest.json'
COPY_IGNORE=shutil.ignore_patterns('__pycache__','*.pyc','*.pyo')

def sha(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for c in iter(lambda:f.read(1024*1024),b''):h.update(c)
    return h.hexdigest()

def write(path:Path,text:str,mode:int=0o644)->None:
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text,encoding='utf-8');path.chmod(mode)

def runtime_manifest(linux_root:Path)->dict[str,dict[str,object]]:
    rows={}
    for p in sorted(linux_root.rglob('*')):
        if not p.is_file() or '__pycache__' in p.parts or p.suffix in {'.pyc','.pyo'}:continue
        rel=p.relative_to(linux_root).as_posix()
        rows[rel]={'size':p.stat().st_size,'sha256':sha(p)}
    return rows

def main()->int:
    ap=argparse.ArgumentParser()
    ap.add_argument('--source',type=Path,required=True)
    ap.add_argument('--output-dir',type=Path,required=True)
    ap.add_argument('--manifest',type=Path,default=DEFAULT_SOURCE_MANIFEST,help='Explicit source identity manifest. Official builds must use the default pinned manifest.')
    args=ap.parse_args()
    manifest_path=args.manifest.expanduser().resolve()
    verified=verify_source(args.source,manifest_path)
    args.output_dir.mkdir(parents=True,exist_ok=True)
    out=args.output_dir/f'{PACKAGE}_{DEB_VERSION}_amd64.deb'
    with tempfile.TemporaryDirectory(prefix='cp-deb-') as td:
        pkg=Path(td)/PACKAGE;opt=pkg/'opt/chess-publisher'
        shutil.copytree(ROOT/'linux',opt/'linux',ignore=COPY_IGNORE);shutil.copytree(args.source,opt/'source',ignore=COPY_IGNORE);shutil.copy2(manifest_path,opt/'source_manifest.json')
        write(opt/'requirements.txt','networkx>=2.6\n')
        write(pkg/'DEBIAN/control',f'''Package: {PACKAGE}\nVersion: {DEB_VERSION}\nSection: games\nPriority: optional\nArchitecture: amd64\nDepends: python3 (>= 3.10), python3-networkx (>= 2.6), xdg-utils\nMaintainer: Chess-Publisher Project\nDescription: Chess-Publisher tournament manager Linux development build\n Linux-native LocalEngine package with verified protected UI source and on-machine self-test.\n''')
        write(pkg/'usr/bin/chess-publisher','''#!/bin/sh\nset -eu\nexport PYTHONDONTWRITEBYTECODE=1\nexec /usr/bin/python3 /opt/chess-publisher/linux/chess_publisher_linux_entry.py "$@"\n''',0o755)
        write(pkg/'usr/bin/chess-publisher-self-test','''#!/bin/sh\nset -eu\nexport PYTHONDONTWRITEBYTECODE=1\nexec /usr/bin/python3 /opt/chess-publisher/linux/self_test.py --package-root /opt/chess-publisher "$@"\n''',0o755)
        write(pkg/'usr/bin/chess-publisher-live-test','''#!/bin/sh\nset -eu\nexport PYTHONDONTWRITEBYTECODE=1\nexec /usr/bin/python3 /opt/chess-publisher/linux/live_acceptance.py --package-root /opt/chess-publisher "$@"\n''',0o755)
        write(pkg/'usr/share/applications/chess-publisher.desktop','''[Desktop Entry]\nType=Application\nName=Chess-Publisher\nComment=Chess tournament manager and publisher\nExec=chess-publisher\nTerminal=false\nCategories=Game;Utility;\nStartupNotify=true\n''')
        runtime=runtime_manifest(opt/'linux')
        package_manifest={'schema':3,'package':PACKAGE,'version':DEB_VERSION,'displayVersion':DISPLAY_VERSION,'appBuild':APP_BUILD,'engineVersion':ENGINE_VERSION,'architecture':'amd64','source':verified,'runtimeFiles':runtime,'selfTestCommand':'chess-publisher-self-test','liveTestCommand':'chess-publisher-live-test','bytecodeIncluded':False,'minimumNetworkx':'2.6'}
        write(opt/'PACKAGE-MANIFEST.json',json.dumps(package_manifest,indent=2,sort_keys=True)+'\n')
        subprocess.run(['dpkg-deb','--root-owner-group','--build',str(pkg),str(out)],check=True)
    print(json.dumps({'ok':True,'deb':str(out),'sha256':sha(out),'bytes':out.stat().st_size,'sourceSnapshot':verified['snapshotId'],'sourceManifest':str(manifest_path),'appBuild':APP_BUILD,'engineVersion':ENGINE_VERSION,'minimumNetworkx':'2.6','runtimeFiles':len(runtime),'selfTestCommand':'chess-publisher-self-test','liveTestCommand':'chess-publisher-live-test','bytecodeIncluded':False},indent=2))
    return 0
if __name__=='__main__':raise SystemExit(main())
