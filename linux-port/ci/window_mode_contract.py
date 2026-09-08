#!/usr/bin/env python3
"""Regression contract for Linux fluid v2 workspace and fixed Pairings Result Desk."""
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
        <div id="tabDgt" class="tab">DGT</div><div id="tabMain" class="tab">Tournament Setup</div><div id="tabRegistration" class="tab">Lists & Players</div>
        <div id="tabPairings" class="tab">Pairings</div><div id="tabStandings" class="tab">Standings</div>
        <div id="tabExport" class="tab">Other / Export</div><div id="tabSchedule" class="tab">Tournament Schedule</div>
        <div id="tabChessResults" class="tab">Chess-Results</div>
      </div>
      <div class="content"><section id="main" class="page active"></section><section id="registration" class="page"></section>
        <section id="pairings" class="page"><div class="live-pairing-toolbar"></div><div class="swiss-workspace"><div class="live-pairing-table-wrap"><table class="live-pairing-table"><thead><tr><th>Board</th></tr></thead></table></div><aside class="result-palette"><button id="btnGenerateGacrux">Generate Pairings</button></aside></div></section>
        <section id="standings" class="page"></section><section id="exportPage" class="page"></section><section id="schedule" class="page"></section><section id="chessresults" class="page"></section><section id="dgt" class="page"></section>
      </div>
    </div></body></html>"""
    out=wi.inject_window_mode(src).decode('utf-8')
    required=(
        'cpLinuxFluidWorkspaceStyle','cpLinuxFluidWorkspaceScript','cp-linux-fluid-ui',
        '#appWindow.window{','width:100%!important;height:100%!important','overflow:hidden!important',
        '#appWindow>.app-resize-handle{display:none!important','button[title="Minimize"]','button[title="Maximize / restore"]',
        'grid-template-columns:repeat(8,minmax(0,1fr))!important','#tabChessResults{display:flex!important;visibility:visible!important;opacity:1!important}',
        'ensureChessResultsTab','FAST_PAGE_IDS','installFastNavigation','normalizedTabButton','stateDirty','originalSaveAll','originalSaveData',
        "previousId!=='dgt'",'stats.fastSwitches','guardedMissingTargets','stopNestedWindowDragging',
        'installDeferredWorkGuards','guardTabWork','skippedStaleWork','renderLivePairings','refreshFinalStandings','refreshChessResultsXmlUi',
        '#pairings .live-pairing-toolbar','position:sticky!important;top:0!important','#pairingsChessResultsPublishBtn',
        'backdrop-filter:none!important','transition:none!important','contain:layout paint!important',APP_BUILD,DISPLAY_VERSION,'document.title=titleText',
        '@media print',"addEventListener('DOMContentLoaded',install,{once:true})",'else install();'
    )
    for marker in required:
        if marker not in out: raise RuntimeError(f'missing Linux fluid-v2 workspace marker: {marker}')
    forbidden=(
        'cpLinuxTabPopupBackdrop','cp-linux-popup-page','cp-linux-popup-titlebar','cp-linux-popup-max',
        'MutationObserver','resize:both','clampCurrentPosition','body.cp-linux-tab-popup-open',
        'backdrop-filter:blur(1px)',"'--start-fullscreen'",'requestAnimationFrame(install)'
    )
    for marker in forbidden:
        if marker in out: raise RuntimeError(f'fragmented/legacy/racy UI marker still present: {marker}')
    if out.count('id="cpLinuxFluidWorkspaceScript"')!=1: raise RuntimeError('fluid workspace integration injected more than once')
    again=wi.inject_window_mode(out.encode('utf-8')).decode('utf-8')
    if again!=out: raise RuntimeError('fluid workspace integration is not idempotent')

    desk=rd.inject_fixed_result_desk(out.encode('utf-8')).decode('utf-8')
    desk_required=(
        'cpLinuxFixedResultDeskStyle','#pairings .swiss-workspace','grid-template-columns:minmax(0,1fr) 214px!important',
        'height:clamp(430px,62vh,700px)!important','overflow:hidden!important',
        '#pairings .live-pairing-table-wrap','height:100%!important','overflow:auto!important','scrollbar-gutter:stable!important',
        '#pairings .live-pairing-table th','position:sticky!important','top:0!important',
        '#pairings .result-palette','align-self:start!important','max-height:none!important','overflow:visible!important',
        'scrollbar-width:none!important','#pairings .result-palette::-webkit-scrollbar{display:none!important',
        '#pairings #btnGenerateGacrux','visibility:visible!important',
        '@media(max-width:900px)','grid-template-columns:minmax(0,1fr) 180px!important'
    )
    for marker in desk_required:
        if marker not in desk: raise RuntimeError(f'missing fixed Result Desk v2 marker: {marker}')
    if '#pairings .result-palette{position:static!important' in desk or 'position:static!important;top:auto!important' in desk:
        raise RuntimeError('narrow desktop Result Desk regressed to static/scrolling layout')
    desk_again=rd.inject_fixed_result_desk(desk.encode('utf-8')).decode('utf-8')
    if desk_again!=desk: raise RuntimeError('Result Desk integration is not idempotent')

    print('LINUX_FLUID_WORKSPACE_V2=PASS (single workspace, eight visible main tabs, reduced repaint work)')
    print('LINUX_FLUID_STALE_WORK_GUARD=PASS (obsolete view rendering skipped after tab leave)')
    print('LINUX_CLEAN_NAVIGATION_FAST_PATH=PASS (clean tab switches skip full tournament persistence churn)')
    print('LINUX_CHESS_RESULTS_TAB=PASS (Chess-Results remains visible in navigation)')
    print('LINUX_PAIRINGS_RESULT_DESK_V2=PASS (controls fixed at all desktop widths; board table scroll only)')
    return 0

if __name__=='__main__': raise SystemExit(main())
