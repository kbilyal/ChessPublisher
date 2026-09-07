#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
from source_guard import verify_source,SourceIdentityError,load_manifest

def digest(data:bytes)->str:return hashlib.sha256(data).hexdigest()

def main()->int:
    manifest=load_manifest(ROOT/'source_manifest.json')
    expected=manifest['files']['ChessPublisher.html']
    if expected['size']!=1526307 or expected['sha256']!='f51355b1a449870be6ed69d1bb941c19a9d8d2bdf3c8f91da845b4bc1275f310':
        raise RuntimeError('Pinned beta.34 Linux source identity changed unexpectedly.')
    # The older repository-root HTML must never silently satisfy the Linux package guard.
    old=ROOT.parent/'ChessPublisher.html'
    if old.is_file() and old.stat().st_size==expected['size'] and digest(old.read_bytes())==expected['sha256']:
        raise RuntimeError('Expected old root HTML to differ from pinned current source; review source lineage before changing this gate.')
    with tempfile.TemporaryDirectory(prefix='cp-source-guard-') as td:
        td=Path(td);src=td/'source';src.mkdir();data=b'protected-current-source';(src/'app.html').write_bytes(data)
        mf=td/'manifest.json';mf.write_text(json.dumps({'files':{'app.html':{'size':len(data),'sha256':digest(data)}}}),encoding='utf-8')
        if not verify_source(src,mf)['ok']:raise RuntimeError('exact source was rejected')
        (src/'app.html').write_bytes(data+b'!')
        try:verify_source(src,mf)
        except SourceIdentityError:pass
        else:raise RuntimeError('modified source was accepted')
    print('SOURCE_GUARD_CONTRACT=PASS')
    return 0
if __name__=='__main__':raise SystemExit(main())
