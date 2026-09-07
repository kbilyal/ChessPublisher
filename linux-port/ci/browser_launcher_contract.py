#!/usr/bin/env python3
"""Regression contract for Linux Chromium app-mode fullscreen launcher."""
from __future__ import annotations
import sys
from pathlib import Path
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
import browser_integration as bi


def main()->int:
    calls=[]
    def fake_which(name:str):
        return '/usr/bin/chromium' if name=='chromium' else None
    class FakePopen:
        def __init__(self,args,**kwargs):calls.append((list(args),dict(kwargs)))
    with mock.patch.object(bi.shutil,'which',side_effect=fake_which), mock.patch.object(bi.subprocess,'Popen',FakePopen):
        ok=bi._open_linux_app('http://127.0.0.1:18765/')
    if ok is not True or len(calls)!=1:raise RuntimeError(f'launcher did not open Chromium exactly once: {calls}')
    args=calls[0][0]
    for required in ('--app=http://127.0.0.1:18765/','--start-maximized','--start-fullscreen','--no-first-run'):
        if required not in args:raise RuntimeError(f'missing Chromium launcher flag: {required}')
    if any(a.startswith('http://') and not a.startswith('--app=') for a in args):raise RuntimeError('URL was not launched in app mode')
    print('LINUX_FULLSCREEN_BROWSER_LAUNCHER=PASS')
    return 0

if __name__=='__main__':raise SystemExit(main())
