#!/usr/bin/env python3
"""Linux fluid single-workspace UI for Chess-Publisher.

The protected ChessPublisher.html remains byte-for-byte unchanged on disk.
This delivery-only layer removes nested pseudo-window fragmentation, keeps all
main tabs visible, suppresses redundant persistence on clean navigation, and
filters obsolete delayed rendering work after the user leaves a page.
"""
from __future__ import annotations
from typing import Any

import chess_publisher_linux as cp
from build_info import APP_BUILD, DISPLAY_VERSION

_APPLIED = False

_STYLE = r'''
<style id="cpLinuxFluidWorkspaceStyle">
html,body{width:100%!important;height:100%!important;margin:0!important;padding:0!important;overflow:hidden!important;background:#f3f3f3!important}
#appWindow.window{
  position:relative!important;left:auto!important;top:auto!important;transform:none!important;
  width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;
  max-width:none!important;max-height:none!important;margin:0!important;resize:none!important;
  border:0!important;border-radius:0!important;box-shadow:none!important;overflow:hidden!important
}
#appWindow>.app-resize-handle{display:none!important;pointer-events:none!important}
#appWindow .titlebar{cursor:default!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important}
#appWindow .file-menu,.modal-overlay{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
#appWindow .window-controls button[title="Minimize"],
#appWindow .window-controls button[title="Maximize / restore"],
#appWindow .window-controls button.window-close{display:none!important}

/* Fluid v2 navigation: all eight main tabs remain visible, including Chess-Results. */
#appWindow .tabs{
  flex:0 0 auto!important;height:34px!important;min-height:34px!important;
  display:grid!important;grid-template-columns:repeat(8,minmax(0,1fr))!important;
  align-items:end!important;gap:1px!important;padding:3px 5px 0!important;
  overflow:hidden!important;contain:layout paint!important
}
#appWindow .tabs .tab{
  min-width:0!important;width:auto!important;height:27px!important;margin:0!important;
  padding:3px 5px!important;display:flex!important;align-items:center!important;justify-content:center!important;
  overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;
  font-size:11.5px!important;line-height:17px!important;transition:none!important
}
#appWindow .tabs .tab.active{height:30px!important;top:1px!important}
#tabChessResults{display:flex!important;visibility:visible!important;opacity:1!important}

#appWindow .content{flex:1 1 auto!important;min-height:0!important;overflow:hidden!important;contain:layout paint!important}
#appWindow .page{min-height:0!important;max-height:none!important;overscroll-behavior:contain;scroll-behavior:auto!important}
#appWindow .page.active{display:block!important;width:100%!important;height:100%!important;overflow:auto!important;scrollbar-gutter:stable!important}
#appWindow .page:not(.active){display:none!important}

/* Remove animation/blur work that does not carry functional state. */
#appWindow .tab,#appWindow button,#appWindow input,#appWindow select,#appWindow textarea,
#appWindow .autosave-slider,#appWindow .autosave-slider::after,#appWindow .next-round-manager,
#appWindow .groupbox,#appWindow .gacrux-box{transition:none!important}
#appWindow .groupbox,#appWindow .gacrux-box{box-shadow:none!important}
#appWindow .modal-window{box-shadow:0 8px 20px rgba(0,0,0,.18)!important}

/* Keep the Pairings action row available while the page itself scrolls. */
#pairings .live-pairing-toolbar{
  position:sticky!important;top:0!important;z-index:45!important;background:#fafafa!important;
  box-shadow:0 1px 0 rgba(0,0,0,.12)!important;contain:layout paint!important
}
#pairingsChessResultsPublishBtn{display:inline-flex!important;visibility:visible!important;opacity:1!important}
#pairings .pairing-engine-bottom{contain:layout paint!important}

.table-frame,.registration-lists,.fide-results,#nextRoundTableContainer,#pairings .live-pairing-table-wrap{
  overscroll-behavior:contain!important
}

#cpLinuxDevBadge{opacity:.56!important;font-size:10px!important;padding:3px 6px!important;right:7px!important;bottom:5px!important}
body.cp-linux-fluid-ui #appWindow{visibility:visible}
@media(max-width:1100px){
  #appWindow .tabs .tab{font-size:10.5px!important;padding-left:3px!important;padding-right:3px!important}
}
@media(max-width:980px){
  #appWindow .content{padding:5px!important}
  #appWindow .tabs{padding-left:4px!important;padding-right:4px!important}
}
@media print{
  html,body{height:auto!important;overflow:visible!important;background:#fff!important}
  #appWindow.window{height:auto!important;overflow:visible!important}
  #cpLinuxDevBadge{display:none!important}
}
</style>
'''.encode('utf-8')

_SCRIPT_TEMPLATE = r'''
<script id="cpLinuxFluidWorkspaceScript">
(function(){
  'use strict';
  if(window.__cpLinuxFluidWorkspaceLoaded)return;
  window.__cpLinuxFluidWorkspaceLoaded=true;

  const APP_BUILD=__APP_BUILD__;
  const DISPLAY_VERSION=__DISPLAY_VERSION__;
  const FAST_PAGE_IDS=new Set(['main','registration','pairings','standings','exportPage','schedule','chessresults']);
  const TAB_BY_PAGE={
    main:'tabMain',registration:'tabRegistration',pairings:'tabPairings',standings:'tabStandings',
    exportPage:'tabExport',schedule:'tabSchedule',chessresults:'tabChessResults',dgt:'tabDgt'
  };
  const stats={fastSwitches:0,dirtySwitches:0,guardedMissingTargets:0,skippedStaleWork:0};
  window.__cpLinuxFluidUiStats=stats;

  function syncTitle(){
    const titleText='Chess-Publisher '+DISPLAY_VERSION+' — Tournament Manager & Publisher';
    const title=document.getElementById('windowDocumentTitle');
    if(title){title.textContent=titleText;title.title='Build '+APP_BUILD;}
    document.title=titleText;
  }

  function activePage(){return document.querySelector('.page.active')?.id||'';}

  function dirtyState(){
    try{return typeof stateDirty!=='undefined'?!!stateDirty:true;}catch(_){return true;}
  }

  function normalizedTabButton(id,button){
    if(button?.classList)return button;
    return document.getElementById(TAB_BY_PAGE[id]||'');
  }

  function ensureChessResultsTab(){
    const tabs=document.querySelector('#appWindow .tabs');
    let tab=document.getElementById('tabChessResults');
    if(!tabs)return;
    if(!tab){
      tab=document.createElement('div');
      tab.id='tabChessResults';
      tab.className='tab';
      tab.textContent='Chess-Results';
      tab.onclick=function(){window.showTab?.('chessresults',tab);};
      tabs.appendChild(tab);
    }
    tab.hidden=false;
    tab.style.removeProperty('display');
    tab.style.removeProperty('visibility');
  }

  // Rendering functions can be scheduled by the protected UI and fire after
  // the user has already left that tab. Guard only view-rendering work; do not
  // change tournament state, pairing calculations or persistence semantics.
  function guardTabWork(name,pageId){
    const original=window[name];
    if(typeof original!=='function'||original.__cpLinuxFluidGuarded)return;
    function guarded(){
      if(activePage()!==pageId){
        stats.skippedStaleWork++;
        return undefined;
      }
      return original.apply(this,arguments);
    }
    guarded.__cpLinuxFluidGuarded=true;
    guarded.__cpOriginal=original;
    window[name]=guarded;
  }

  function installDeferredWorkGuards(){
    for(const name of [
      'populatePairingsRoundMenu','renderLivePairings','loadPairingEngineSettings',
      'renderNextRoundPlayerManager','updateGacruxPanel'
    ]) guardTabWork(name,'pairings');
    for(const name of [
      'renderSpecialPrizeSettings','refreshFinalStandings','renderSpecialPrizeResults'
    ]) guardTabWork(name,'standings');
    guardTabWork('refreshChessResultsXmlUi','chessresults');
  }

  function installFastNavigation(){
    const original=window.showTab;
    if(typeof original!=='function'||window.__cpLinuxFluidShowTabWrapped)return;

    window.showTab=function(id,button){
      const pageId=String(id||'');
      const target=document.getElementById(pageId);
      const tab=normalizedTabButton(pageId,button);
      if(!target||!tab){
        stats.guardedMissingTargets++;
        return undefined;
      }
      if(tab.classList.contains('disabled'))return original.call(this,pageId,tab);

      const previousId=activePage();
      if(previousId===pageId&&tab.classList.contains('active'))return undefined;

      const dirty=dirtyState();
      const canFast=FAST_PAGE_IDS.has(pageId)&&previousId!=='dgt'&&!dirty;
      if(!canFast){
        if(dirty)stats.dirtySwitches++;
        return original.call(this,pageId,tab);
      }

      // The protected showTab() deliberately calls saveAll() and saveData() on
      // every navigation. When there are no unsaved changes those calls only
      // serialize the entire tournament and schedule an autosave because the
      // active-tab preference changed. Suppress that clean-navigation churn;
      // real input/change still marks stateDirty and uses the protected save path.
      const originalSaveAll=window.saveAll;
      const originalSaveData=window.saveData;
      if(typeof originalSaveAll==='function')window.saveAll=function(){};
      if(typeof originalSaveData==='function')window.saveData=function(){};
      try{
        stats.fastSwitches++;
        return original.call(this,pageId,tab);
      }finally{
        if(typeof originalSaveAll==='function')window.saveAll=originalSaveAll;
        if(typeof originalSaveData==='function')window.saveData=originalSaveData;
      }
    };
    window.__cpLinuxFluidShowTabWrapped=true;
  }

  function stopNestedWindowDragging(){
    const titlebar=document.querySelector('#appWindow>.titlebar');
    if(!titlebar||titlebar.dataset.cpLinuxFluidGuard==='1')return;
    titlebar.dataset.cpLinuxFluidGuard='1';
    titlebar.addEventListener('pointerdown',event=>{
      if(event.target?.closest?.('.window-controls'))return;
      event.stopImmediatePropagation();
    },true);
  }

  function normalizeLegacyWindowState(){
    const app=document.getElementById('appWindow');
    if(!app)return;
    app.classList.remove('app-window-minimized');
    delete app.dataset.restoreWindowStyle;
    for(const name of ['position','left','top','width','height','margin','max-width','max-height','transform']){
      app.style.removeProperty(name);
    }
  }

  function install(){
    syncTitle();
    normalizeLegacyWindowState();
    stopNestedWindowDragging();
    ensureChessResultsTab();
    installDeferredWorkGuards();
    installFastNavigation();
    document.body.classList.add('cp-linux-fluid-ui');

    // The protected application can rewrite tab visibility during startup.
    // Re-assert only UI visibility/guards after its zero-delay startup work.
    setTimeout(()=>{
      ensureChessResultsTab();
      installDeferredWorkGuards();
      installFastNavigation();
    },0);
    setTimeout(()=>{
      ensureChessResultsTab();
      installDeferredWorkGuards();
    },250);
  }

  // Injected at the end of <body>: install synchronously after DOMContentLoaded
  // rather than waiting for an animation frame. This removes the startup race
  // where first navigation could hit the expensive protected path.
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();
</script>
'''

_SCRIPT = (_SCRIPT_TEMPLATE
    .replace('__APP_BUILD__', repr(APP_BUILD))
    .replace('__DISPLAY_VERSION__', repr(DISPLAY_VERSION))
    .encode('utf-8'))


def inject_window_mode(data: bytes) -> bytes:
    if b'id="cpLinuxFluidWorkspaceScript"' in data:
        return data
    head = data.lower().rfind(b'</head>')
    if head >= 0:
        data = data[:head] + _STYLE + data[head:]
    else:
        data = _STYLE + data
    body = data.lower().rfind(b'</body>')
    if body >= 0:
        data = data[:body] + _SCRIPT + data[body:]
    else:
        data += _SCRIPT
    return data


def apply() -> None:
    global _APPLIED
    if _APPLIED:
        return
    _APPLIED = True
    original_serve = cp.Handler._serve_app

    def serve_app(self: cp.Handler) -> Any:
        original_text = self._text

        def window_text(status: int, data: bytes, content_type: str) -> Any:
            if content_type.lower().startswith('text/html'):
                data = inject_window_mode(data)
            return original_text(status, data, content_type)

        self._text = window_text  # type: ignore[method-assign]
        try:
            return original_serve(self)
        finally:
            self._text = original_text  # type: ignore[method-assign]

    cp.Handler._serve_app = serve_app  # type: ignore[assignment]
