#!/usr/bin/env python3
"""Regression contract for Linux fullscreen/version/Pairing popup delivery."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
from build_info import APP_BUILD,DISPLAY_VERSION
import window_integration as wi


def main()->int:
    src=b'<!doctype html><html><head><title>Old</title></head><body><div id="appWindow" class="window"><span id="windowDocumentTitle">Chess-Publisher</span></div><section id="pairings" class="page"><select id="pairingsTournamentSelect"><option>Test tournament</option></select><h2 id="livePairingRoundTitle">Round 7</h2></section></body></html>'
    out=wi.inject_window_mode(src).decode('utf-8')
    required=(
        'cpLinuxWindowModeStyle','cpLinuxWindowModeScript','100vw','100vh',
        'cpLinuxPairingsWindowBar','Pairing Manager','cp-linux-pairings-max',
        APP_BUILD,DISPLAY_VERSION,'document.title=titleText','forceMainFullscreen',
        'toggleMaximizeAppWindow','minimizeAppWindow','closePairings',
    )
    for marker in required:
        if marker not in out:raise RuntimeError(f'missing Linux window marker: {marker}')
    if out.count('id="cpLinuxWindowModeScript"')!=1:raise RuntimeError('window integration injected more than once')
    again=wi.inject_window_mode(out.encode('utf-8')).decode('utf-8')
    if again!=out:raise RuntimeError('window integration is not idempotent')
    print('LINUX_FULLSCREEN_VERSION_PAIRING_POPUP=PASS')
    return 0

if __name__=='__main__':raise SystemExit(main())
