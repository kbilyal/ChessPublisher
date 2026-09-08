#!/usr/bin/env python3
"""Linux desktop window UX for Chess-Publisher.

The protected ChessPublisher.html remains byte-for-byte unchanged on disk.
The Linux delivery layer expands the main application surface to the full
available browser viewport and presents working tabs as movable, resizable
in-app popup workspaces.
"""
from __future__ import annotations
from typing import Any

import chess_publisher_linux as cp
from build_info import APP_BUILD, DISPLAY_VERSION

_APPLIED = False

_STYLE = r'''
<style id="cpLinuxWindowModeStyle">
html,body{width:100%!important;height:100%!important}
body{padding:0!important;overflow:hidden!important}
#appWindow.window{
  width:100vw!important;height:100vh!important;
  min-width:0!important;min-height:0!important;
  max-width:none!important;max-height:none!important;
  margin:0!important;resize:none!important
}
.cp-linux-version-badge{display:inline-flex;align-items:center;margin-left:8px;padding:1px 7px;border:1px solid rgba(255,255,255,.45);border-radius:10px;font-size:10px;font-weight:700;background:rgba(255,255,255,.12);white-space:nowrap}
.modal-overlay{backdrop-filter:blur(1px)}
.modal-window{border:1px solid #7f8790!important;border-radius:3px!important;box-shadow:0 12px 34px rgba(0,0,0,.34)!important}
.modal-titlebar{background:linear-gradient(#315f95,#234a78)!important;color:#fff!important;font-weight:700!important;min-height:29px!important;display:flex!important;align-items:center!important}
#cpLinuxTabPopupBackdrop{display:none;position:fixed;inset:0;z-index:9050;background:rgba(18,22,28,.22);pointer-events:none}
body.cp-linux-tab-popup-open #cpLinuxTabPopupBackdrop{display:block}
body.cp-linux-tab-popup-open .app-save-corner{z-index:9001!important}
#main.cp-linux-base-visible{display:block!important}
.page.cp-linux-popup-page.active{
  display:block!important;position:fixed!important;z-index:9100!important;
  left:50%!important;top:74px!important;transform:translateX(-50%);
  width:min(1180px,calc(100vw - 64px));
  height:min(700px,calc(100vh - 92px));
  max-width:calc(100vw - 24px)!important;max-height:calc(100vh - 64px)!important;
  min-width:min(760px,calc(100vw - 24px))!important;
  min-height:min(480px,calc(100vh - 64px))!important;
  margin:0!important;padding:0 10px 10px!important;overflow:auto!important;resize:both;
  background:#d4d0c8!important;border:1px solid #59636e!important;border-top:0!important;
  box-shadow:0 18px 42px rgba(0,0,0,.42)!important
}
.page.cp-linux-popup-page.active.cp-linux-popup-max{
  left:8px!important;top:68px!important;transform:none!important;
  width:calc(100vw - 16px)!important;height:calc(100vh - 76px)!important;
  max-width:none!important;max-height:none!important;resize:none!important
}
.cp-linux-popup-page .cp-linux-popup-titlebar{
  position:sticky;top:0;z-index:9200;height:31px;margin:0 -10px 8px;padding:0 7px 0 10px;
  display:flex;align-items:center;gap:8px;background:linear-gradient(#315f95,#234a78);
  color:#fff;border-bottom:1px solid #163451;box-shadow:0 1px 0 rgba(255,255,255,.22) inset;
  cursor:move;user-select:none
}
.cp-linux-popup-page .cp-linux-popup-title{font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cp-linux-popup-page .cp-linux-popup-version{margin-left:auto;opacity:.86;font-size:10px;white-space:nowrap}
.cp-linux-popup-page .cp-linux-popup-controls{display:flex;gap:3px;margin-left:4px}
.cp-linux-popup-page .cp-linux-popup-controls button{
  width:30px!important;min-width:30px!important;height:23px!important;padding:0!important;
  border:1px solid rgba(255,255,255,.45)!important;background:rgba(255,255,255,.10)!important;
  color:#fff!important;font-weight:700!important;line-height:20px!important
}
.cp-linux-popup-page .cp-linux-popup-controls button:hover{background:rgba(255,255,255,.22)!important}
.cp-linux-popup-page .pairing-quickbar{top:31px!important}
@media(max-width:900px){
  .page.cp-linux-popup-page.active{
    left:6px!important;top:68px!important;transform:none!important;
    width:calc(100vw - 12px)!important;height:calc(100vh - 74px)!important;
    min-width:0!important;min-height:0!important;resize:none!important
  }
}
</style>
'''.encode('utf-8')

_SCRIPT_TEMPLATE = r'''
<script id="cpLinuxWindowModeScript">
(function(){
  'use strict';
  const APP_BUILD=__APP_BUILD__;
  const DISPLAY_VERSION=__DISPLAY_VERSION__;
  const POPUP_IDS=['registration','pairings','standings','exportPage','schedule','chessresults','dgt'];
  const TAB_BY_PAGE={
    registration:'tabRegistration',pairings:'tabPairings',standings:'tabStandings',
    exportPage:'tabExport',schedule:'tabSchedule',chessresults:'tabChessResults',dgt:'tabDgt'
  };
  const titleText='Chess-Publisher '+DISPLAY_VERSION+' — Tournament Manager & Publisher';

  function syncTitle(){
    const title=document.getElementById('windowDocumentTitle');
    if(title){title.textContent=titleText;title.title='Build '+APP_BUILD;}
    document.title=titleText;
  }

  function popupTitle(id){
    const tab=document.getElementById(TAB_BY_PAGE[id]||'');
    const label=(tab?.textContent||'').trim();
    return label||id;
  }

  function ensureBackdrop(){
    let backdrop=document.getElementById('cpLinuxTabPopupBackdrop');
    if(!backdrop){
      backdrop=document.createElement('div');
      backdrop.id='cpLinuxTabPopupBackdrop';
      document.body.appendChild(backdrop);
    }
    return backdrop;
  }

  function closePopup(){
    const mainTab=document.getElementById('tabMain');
    if(mainTab){mainTab.click();return;}
    if(typeof window.showTab==='function')window.showTab('main',mainTab);
  }

  function installPopup(page,id){
    if(!page||page.dataset.cpLinuxPopupInstalled==='1')return;
    page.dataset.cpLinuxPopupInstalled='1';
    page.classList.add('cp-linux-popup-page');

    const bar=document.createElement('div');
    bar.className='cp-linux-popup-titlebar';
    bar.setAttribute('data-cp-linux-popup-bar',id);
    bar.innerHTML=
      '<span class="cp-linux-popup-title"></span>'+ 
      '<span class="cp-linux-popup-version">'+DISPLAY_VERSION+'</span>'+ 
      '<span class="cp-linux-popup-controls">'+
      '<button type="button" class="cp-linux-popup-max-btn" title="Maximize / restore">▢</button>'+ 
      '<button type="button" class="cp-linux-popup-close-btn" title="Close window">×</button>'+ 
      '</span>';
    page.insertBefore(bar,page.firstChild);

    const label=bar.querySelector('.cp-linux-popup-title');
    if(label&&label.textContent!==popupTitle(id))label.textContent=popupTitle(id);

    bar.querySelector('.cp-linux-popup-close-btn')?.addEventListener('click',e=>{
      e.stopPropagation();closePopup();
    });
    let restoredPosition=null;
    bar.querySelector('.cp-linux-popup-max-btn')?.addEventListener('click',e=>{
      e.stopPropagation();
      if(page.classList.toggle('cp-linux-popup-max')){
        restoredPosition=['left','top','transform'].map(name=>[
          name,page.style.getPropertyValue(name),page.style.getPropertyPriority(name)
        ]);
        for(const [name] of restoredPosition)page.style.removeProperty(name);
      }else{
        for(const [name,value,priority] of restoredPosition||[]){
          if(value)page.style.setProperty(name,value,priority);
        }
        restoredPosition=null;
      }
    });

    let drag=null;
    bar.addEventListener('pointerdown',e=>{
      if(e.button!==0||e.target.closest('button')||page.classList.contains('cp-linux-popup-max'))return;
      const r=page.getBoundingClientRect();
      page.style.setProperty('transform','none','important');
      page.style.setProperty('left',r.left+'px','important');
      page.style.setProperty('top',r.top+'px','important');
      drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top};
      bar.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    bar.addEventListener('pointermove',e=>{
      if(!drag)return;
      const maxL=Math.max(0,window.innerWidth-page.offsetWidth);
      const maxT=Math.max(32,window.innerHeight-72);
      page.style.setProperty('left',Math.max(0,Math.min(maxL,drag.left+e.clientX-drag.x))+'px','important');
      page.style.setProperty('top',Math.max(32,Math.min(maxT,drag.top+e.clientY-drag.y))+'px','important');
    });
    const stop=()=>{drag=null};
    bar.addEventListener('pointerup',stop);
    bar.addEventListener('pointercancel',stop);
  }

  function syncPopupState(){
    let activePopup=null;
    for(const id of POPUP_IDS){
      const page=document.getElementById(id);
      if(!page)continue;
      installPopup(page,id);
      const label=page.querySelector('.cp-linux-popup-title');
      if(label&&label.textContent!==popupTitle(id))label.textContent=popupTitle(id);
      if(page.classList.contains('active'))activePopup=page;
    }
    const main=document.getElementById('main');
    if(main)main.classList.toggle('cp-linux-base-visible',!!activePopup);
    document.body.classList.toggle('cp-linux-tab-popup-open',!!activePopup);
  }

  function wrapNavigation(){
    const original=window.showTab;
    if(typeof original!=='function'||window.__cpLinuxPopupShowTabWrapped)return;
    window.showTab=function(){
      const out=original.apply(this,arguments);
      setTimeout(syncPopupState,0);
      return out;
    };
    window.__cpLinuxPopupShowTabWrapped=true;
  }

  function install(){
    syncTitle();
    ensureBackdrop();
    wrapNavigation();
    syncPopupState();
    const content=document.querySelector('.content');
    if(content){
      new MutationObserver(()=>syncPopupState()).observe(content,{
        subtree:true,childList:true,attributes:true,attributeFilter:['class']
      });
    }
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0),{once:true});
  }else setTimeout(install,0);
})();
</script>
'''

_SCRIPT = (_SCRIPT_TEMPLATE
    .replace('__APP_BUILD__', repr(APP_BUILD))
    .replace('__DISPLAY_VERSION__', repr(DISPLAY_VERSION))
    .encode('utf-8'))


def inject_window_mode(data: bytes) -> bytes:
    if b'id="cpLinuxWindowModeScript"' in data:
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
