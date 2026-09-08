#!/usr/bin/env python3
"""Regression contract for a windowed main UI and per-tab popup workspaces."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
from build_info import APP_BUILD,DISPLAY_VERSION
import window_integration as wi


def main()->int:
    src=b"""<!doctype html><html><head><title>Old</title></head><body>
    <div id="appWindow" class="window"><span id="windowDocumentTitle">Chess-Publisher</span>
      <div class="tabs">
        <div id="tabMain">Tournament Setup</div><div id="tabRegistration">Lists & Players</div>
        <div id="tabPairings">Pairings</div><div id="tabStandings">Standings</div>
        <div id="tabExport">Other / Export</div><div id="tabSchedule">Tournament Schedule</div>
        <div id="tabChessResults">Chess-Results</div>
      </div>
      <div class="content"><section id="main" class="page active"></section><section id="registration" class="page"></section>
        <section id="pairings" class="page"></section><section id="standings" class="page"></section>
        <section id="exportPage" class="page"></section><section id="schedule" class="page"></section><section id="chessresults" class="page"></section>
      </div>
    </div></body></html>"""
    out=wi.inject_window_mode(src).decode('utf-8')
    required=('cpLinuxWindowModeStyle','cpLinuxWindowModeScript','cpLinuxTabPopupBackdrop','cp-linux-popup-page','cp-linux-popup-titlebar','cp-linux-popup-max','registration','pairings','standings','exportPage','schedule','chessresults','dgt','closePopup','syncPopupState','cp-linux-base-visible','clampPosition','clampCurrentPosition','window.innerHeight-page.offsetHeight',APP_BUILD,DISPLAY_VERSION,'document.title=titleText','body.cp-linux-tab-popup-open #cpLinuxTabPopupBackdrop{display:none!important}','@media print{#cpLinuxTabPopupBackdrop,#cpLinuxDevBadge{display:none!important}}')
    for marker in required:
        if marker not in out: raise RuntimeError(f'missing Linux windowed/popup marker: {marker}')
    forbidden=('forceMainFullscreen','#appWindow.window{','width:100vw!important;height:100vh!important','body{padding:0!important;overflow:hidden!important}',"'--start-fullscreen'",'window.toggleMaximizeAppWindow=function','window.minimizeAppWindow=function','body.cp-linux-tab-popup-open #cpLinuxTabPopupBackdrop{display:block}','backdrop-filter:blur(1px)')
    for marker in forbidden:
        if marker in out: raise RuntimeError(f'legacy forced-fullscreen/dimming marker still present: {marker}')
    if out.count('id="cpLinuxWindowModeScript"')!=1: raise RuntimeError('window integration injected more than once')
    again=wi.inject_window_mode(out.encode('utf-8')).decode('utf-8')
    if again!=out: raise RuntimeError('window integration is not idempotent')
    print('LINUX_WINDOWED_MAIN_TAB_POPUPS=PASS (no dimming backdrop + print overlays hidden)')
    return 0

if __name__=='__main__': raise SystemExit(main())
