#!/usr/bin/env python3
"""Launch Chess-Publisher as a normal Linux desktop browser app window."""
from __future__ import annotations
import os
import shutil
import subprocess
from typing import Any

import chess_publisher_linux as cp

_APPLIED=False


def _open_linux_app(url: str, *_args: Any, **_kwargs: Any) -> bool:
    env=os.environ.copy()
    for name in ('google-chrome','google-chrome-stable','chromium','chromium-browser'):
        exe=shutil.which(name)
        if not exe:
            continue
        try:
            subprocess.Popen(
                [exe, f'--app={url}', '--no-first-run'],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True, env=env,
            )
            return True
        except OSError:
            continue
    opener=shutil.which('xdg-open')
    if opener:
        try:
            subprocess.Popen(
                [opener,url],
                stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                start_new_session=True,env=env,
            )
            return True
        except OSError:
            pass
    return False


def apply()->None:
    global _APPLIED
    if _APPLIED:
        return
    _APPLIED=True
    cp.webbrowser.open=_open_linux_app  # type: ignore[assignment]
