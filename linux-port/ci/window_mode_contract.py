#!/usr/bin/env python3
"""Regression contract for Linux fluid workspace and fixed Pairings Result Desk."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
from build_info import APP_BUILD,DISPLAY_VERSION
import window_integration as wi
import pairings_result_desk_integration as rd


def main()->int:
    src=b"""<!doctype html><html><head><title>Old</title></head><body>
    <div id="appWindow" class="window"><span id="windowDocumentTitle">Chess-Publisher</span>
      <div class="titlebar"><span>Title</span><span class="window-controls"><button title="Minimize">-</button><button title="Maximize / restore">x</button><button class="window-close">X</button></span></div>
      <div class="tabs">
        <div id="tabDgt">DGT</div><div id="tabMain">Tournament Setup</div><div id="tabRegistration">Lists & Players</div>
        <div id="tabPairings">Pairings</div><div id="tabStandings">Standings</div>
        <div id="tabExport">Other / Export</div><div id="tabSchedule">Tournament Schedule</div>
        <div id="tabChessResults">Chess-Results</div>
      </div>
      <div class="content"><section id="main" class="page active"></section><section id="registration" class="page"></section>
        <section id="pairings" class="page"><div class="swiss-workspace"><div class="live-pairing-table-wrap"></div><aside class="result-palette"></aside></div></section>
        <section id="standings" class="page"></section><section id="exportPage" class="page"></section><section id="schedule" class="page"></section><section id="chessresults" class="page"></section><section id="dgt" class="page"></section>
      </div>
    </div></body></html>"""
    out=wi.inject_window_mode(src).decode('utf-8')
    required=(
        'cpLinuxFluidWorkspaceStyle','cpLinuxFluidWorkspaceScript','cp-linux-fluid-ui',
        '#appWindow.window{','width:100%!important;height:100%!important','overflow:hidden!important',
        '#appWindow>.app-resize-handle{display:none!important','button[title="Minimize"]','button[title="Maximize / restore"]',
        'FAST_PAGE_IDS','installFastNavigation','normalizedTabButton','stateDirty','originalSaveAll','originalSaveData',
        "previousId!=='dgt'",'stats.fastSwitches','guardedMissingTargets','stopNestedWindowDragging',
        'backdrop-filter:none!important','transition:none!important',APP_BUILD,DISPLAY_VERSION,'document.title=titleText',
        '@media print','requestAnimationFrame(install)'
    )
    for marker in required:
        if marker not in out: raise RuntimeError(f'missing Linux fluid-workspace marker: {marker}')
    forbidden=(
        'cpLinuxTabPopupBackdrop','cp-linux-popup-page','cp-linux-popup-titlebar','cp-linux-popup-max',
        'MutationObserver','resize:both','clampCurrentPosition','body.cp-linux-tab-popup-open',
        'backdrop-filter:blur(1px)',"'--start-fullscreen'"
    )
    for marker in forbidden:
        if marker in out: raise RuntimeError(f'fragmented/legacy popup marker still present: {marker}')
    if out.count('id="cpLinuxFluidWorkspaceScript"')!=1: raise RuntimeError('fluid workspace integration injected more than once')
    again=wi.inject_window_mode(out.encode('utf-8')).decode('utf-8')
    if again!=out: raise RuntimeError('fluid workspace integration is not idempotent')

    desk=rd.inject_fixed_result_desk(out.encode('utf-8')).decode('utf-8')
    desk_required=(
        'cpLinuxFixedResultDeskStyle','#pairings .live-pairing-table-wrap','overflow:auto!important',
        '#pairings .result-palette','position:sticky!important','top:39px!important','max-height:none!important',
        'overflow:visible!important','scrollbar-width:none!important','#pairings .result-palette::-webkit-scrollbar{display:none!important',
    )
    for marker in desk_required:
        if marker not in desk: raise RuntimeError(f'missing fixed Result Desk marker: {marker}')
    if '#pairings .result-palette{\n  position:static!important' in desk:
        raise RuntimeError('desktop Result Desk is still static/scrollable')
    desk_again=rd.inject_fixed_result_desk(desk.encode('utf-8')).decode('utf-8')
    if desk_again!=desk: raise RuntimeError('Result Desk integration is not idempotent')

    print('LINUX_FLUID_WORKSPACE=PASS (single workspace, no routine-tab popups, native window chrome)')
    print('LINUX_CLEAN_NAVIGATION_FAST_PATH=PASS (clean tab switches skip full tournament persistence churn)')
    print('LINUX_PAIRINGS_RESULT_DESK=PASS (controls fixed; board table scroll only)')
    return 0

if __name__=='__main__': raise SystemExit(main())
