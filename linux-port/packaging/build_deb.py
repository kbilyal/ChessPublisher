#!/usr/bin/env python3
"""Build an amd64 Ubuntu/Debian development package from verified Chess-Publisher source."""
from __future__ import annotations
import argparse,hashlib,json,shutil,subprocess,tempfile
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
from source_guard import verify_source

PACKAGE='chess-publisher'
DEB_VERSION='1.06.00~beta34+linuxdev1'

def sha(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for c in iter(lambda:f.read(1024*1024),b''):h.update(c)
    return h.hexdigest()

def write(path:Path,text:str,mode:int=0o644)->None:
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text,encoding='utf-8');path.chmod(mode)

def main()->int:
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);ap.add_argument('--output-dir',type=Path,required=True);args=ap.parse_args()
    verified=verify_source(args.source,ROOT/'source_manifest.json')
    args.output_dir.mkdir(parents=True,exist_ok=True)
    out=args.output_dir/f'{PACKAGE}_{DEB_VERSION}_amd64.deb'
    with tempfile.TemporaryDirectory(prefix='cp-deb-') as td:
        pkg=Path(td)/PACKAGE;opt=pkg/'opt/chess-publisher'
        shutil.copytree(ROOT/'linux',opt/'linux');shutil.copytree(args.source,opt/'source');shutil.copy2(ROOT/'source_manifest.json',opt/'source_manifest.json')
        write(opt/'requirements.txt','networkx>=2.6\n')
        write(pkg/'DEBIAN/control',f'''Package: {PACKAGE}\nVersion: {DEB_VERSION}\nSection: games\nPriority: optional\nArchitecture: amd64\nDepends: python3 (>= 3.10), python3-networkx, xdg-utils\nMaintainer: Chess-Publisher Project\nDescription: Chess-Publisher tournament manager Linux development build\n Linux-native LocalEngine package with verified protected UI source.\n''')
        # Use Debian's system Python explicitly: package dependencies are installed
        # for /usr/bin/python3 and must not be bypassed by Conda/pyenv/PATH shims.
        write(pkg/'usr/bin/chess-publisher','''#!/bin/sh\nset -eu\nexec /usr/bin/python3 /opt/chess-publisher/linux/chess_publisher_linux_entry.py "$@"\n''',0o755)
        write(pkg/'usr/share/applications/chess-publisher.desktop','''[Desktop Entry]\nType=Application\nName=Chess-Publisher\nComment=Chess tournament manager and publisher\nExec=chess-publisher\nTerminal=false\nCategories=Game;Utility;\nStartupNotify=true\n''')
        write(opt/'PACKAGE-MANIFEST.json',json.dumps({'schema':1,'package':PACKAGE,'version':DEB_VERSION,'architecture':'amd64','source':verified},indent=2,sort_keys=True)+'\n')
        subprocess.run(['dpkg-deb','--root-owner-group','--build',str(pkg),str(out)],check=True)
    print(json.dumps({'ok':True,'deb':str(out),'sha256':sha(out),'bytes':out.stat().st_size,'sourceSnapshot':verified['snapshotId']},indent=2))
    return 0
if __name__=='__main__':raise SystemExit(main())
