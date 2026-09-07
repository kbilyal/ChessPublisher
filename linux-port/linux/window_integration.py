#!/usr/bin/env python3
"""Linux desktop window UX for Chess-Publisher.

Applied only to the HTTP-delivered page. The pinned ChessPublisher.html on disk
remains byte-for-byte unchanged.
"""
from __future__ import annotations
from typing import Any

import chess_publisher_linux as cp
from build_info import APP_BUILD, DISPLAY_VERSION

_APPLIED = False

_STYLE = r'''
<style id="cpLinuxWindowModeStyle">
html,body{width:100%!important;height:100%!important;margin:0!important;overflow:hidden!important}
#appWindow.window{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;border-radius:0!important}
#appWindow>.app-resize-handle{display:none!important}
#appWindow>.titlebar{cursor:default!important;user-select:none}
#windowDocumentTitle{font-weight:700!important;letter-spacing:.01em}
.cp-linux-version-badge{display:inline-flex;align-items:center;margin-left:8px;padding:1px 7px;border:1px solid rgba(255,255,255,.45);border-radius:10px;font-size:10px;font-weight:700;background:rgba(255,255,255,.12);white-space:nowrap}
.modal-overlay{backdrop-filter:blur(1px)}
.modal-window{border:1px solid #7f8790!important;border-radius:3px!important;box-shadow:0 12px 34px rgba(0,0,0,.34)!important}
.modal-titlebar{background:linear-gradient(#315f95,#234a78)!important;color:#fff!important;font-weight:700!important;min-height:29px!important;display:flex!important;align-items:center!important}
#cpLinuxPairingsBackdrop{display:none;position:fixed;inset:0;z-index:9050;background:rgba(18,22,28,.30)}
body.cp-linux-pairings-open #cpLinuxPairingsBackdrop{display:block}
#pairings.page.active{display:block!important;position:fixed!important;z-index:9100!important;left:24px!important;top:58px!important;width:calc(100vw - 48px)!important;height:calc(100vh - 76px)!important;max-width:none!important;max-height:none!important;min-width:min(860px,calc(100vw - 16px))!important;min-height:520px!important;margin:0!important;padding:0 10px 10px!important;overflow:auto!important;resize:both;background:#d4d0c8!important;border:1px solid #59636e!important;border-top:0!important;box-shadow:0 18px 42px rgba(0,0,0,.42)!important}
#pairings.page.active.cp-linux-pairings-max{left:4px!important;top:34px!important;width:calc(100vw - 8px)!important;height:calc(100vh - 38px)!important;resize:none!important}
#pairings .cp-linux-pairings-titlebar{position:sticky;top:0;z-index:9200;height:31px;margin:0 -10px 8px;padding:0 7px 0 10px;display:flex;align-items:center;gap:8px;background:linear-gradient(#315f95,#234a78);color:#fff;border-bottom:1px solid #163451;box-shadow:0 1px 0 rgba(255,255,255,.22) inset;cursor:move;user-select:none}
#pairings .cp-linux-pairings-title{font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pairings .cp-linux-pairings-version{margin-left:auto;opacity:.86;font-size:10px;white-space:nowrap}
#pairings .cp-linux-pairings-window-controls{display:flex;gap:3px;margin-left:4px}
#pairings .cp-linux-pairings-window-controls button{width:30px!important;min-width:30px!important;height:23px!important;padding:0!important;border:1px solid rgba(255,255,255,.45)!important;background:rgba(255,255,255,.10)!important;color:#fff!important;font-weight:700!important;line-height:20px!important}
#pairings .cp-linux-pairings-window-controls button:hover{background:rgba(255,255,255,.22)!important}
#pairings .pairing-quickbar{top:31px!important}
@media(max-width:900px){#pairings.page.active{left:6px!important;top:42px!important;width:calc(100vw - 12px)!important;height:calc(100vh - 48px)!important;min-width:0!important;resize:none!important}}
</style>
'''.encode('utf-8')

_SCRIPT_TEMPLATE = r'''
<script id="cpLinuxWindowModeScript">
(function(){
  'use strict';
  const APP_BUILD=__APP_BUILD__;
  const DISPLAY_VERSION=__DISPLAY_VERSION__;
  const titleText='Chess-Publisher '+DISPLAY_VERSION+' — Tournament Manager & Publisher';
  function forceMainFullscreen(){
    const w=document.getElementById('appWindow'); if(!w)return;
    w.classList.remove('app-window-minimized');
    delete w.dataset.restoreWindowStyle;
    w.style.position='fixed';w.style.left='0';w.style.top='0';w.style.width='100vw';w.style.height='100vh';
    w.style.margin='0';w.style.maxWidth='none';w.style.maxHeight='none';
  }
  function syncTitle(){
    const title=document.getElementById('windowDocumentTitle');
    if(title){title.textContent=titleText;title.title='Build '+APP_BUILD;}
    document.title=titleText;
  }
  function pairingTitle(){
    const round=(document.getElementById('livePairingRoundTitle')?.textContent||'').trim();
    const tournament=(document.getElementById('pairingsTournamentSelect')?.selectedOptions?.[0]?.textContent||'').trim();
    return 'Pairing Manager'+(round?' — '+round:'')+(tournament?' · '+tournament:'');
  }
  function syncPairingPopup(){
    const page=document.getElementById('pairings');
    const active=!!page?.classList.contains('active');
    document.body.classList.toggle('cp-linux-pairings-open',active);
    const label=document.getElementById('cpLinuxPairingsTitle'); if(label)label.textContent=pairingTitle();
  }
  function closePairings(){
    let id=window.__cpLinuxPreviousTab||'main'; if(id==='pairings')id='main';
    const map={main:'tabMain',registration:'tabRegistration',standings:'tabStandings',exportPage:'tabExport',schedule:'tabSchedule',chessresults:'tabChessResults',dgt:'tabDgt'};
    const tab=document.getElementById(map[id]||'tabMain');if(tab)tab.click();
  }
  function installPairingPopup(){
    const page=document.getElementById('pairings'); if(!page||document.getElementById('cpLinuxPairingsWindowBar'))return;
    const bar=document.createElement('div');bar.id='cpLinuxPairingsWindowBar';bar.className='cp-linux-pairings-titlebar';
    bar.innerHTML='<span id="cpLinuxPairingsTitle" class="cp-linux-pairings-title">Pairing Manager</span><span class="cp-linux-pairings-version">'+DISPLAY_VERSION+'</span><span class="cp-linux-pairings-window-controls"><button type="button" id="cpLinuxPairingsMax" title="Maximize / restore">▢</button><button type="button" id="cpLinuxPairingsClose" title="Close pairing window">×</button></span>';
    page.insertBefore(bar,page.firstChild);
    let backdrop=document.getElementById('cpLinuxPairingsBackdrop');if(!backdrop){backdrop=document.createElement('div');backdrop.id='cpLinuxPairingsBackdrop';document.body.appendChild(backdrop);}
    document.getElementById('cpLinuxPairingsClose')?.addEventListener('click',e=>{e.stopPropagation();closePairings();});
    document.getElementById('cpLinuxPairingsMax')?.addEventListener('click',e=>{e.stopPropagation();page.classList.toggle('cp-linux-pairings-max');});
    let drag=null;
    bar.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button')||page.classList.contains('cp-linux-pairings-max'))return;const r=page.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top};bar.setPointerCapture?.(e.pointerId);e.preventDefault();});
    bar.addEventListener('pointermove',e=>{if(!drag)return;const maxL=Math.max(0,window.innerWidth-page.offsetWidth),maxT=Math.max(32,window.innerHeight-80);page.style.setProperty('left',Math.max(0,Math.min(maxL,drag.left+e.clientX-drag.x))+'px','important');page.style.setProperty('top',Math.max(32,Math.min(maxT,drag.top+e.clientY-drag.y))+'px','important');});
    const stop=()=>{drag=null};bar.addEventListener('pointerup',stop);bar.addEventListener('pointercancel',stop);
    new MutationObserver(syncPairingPopup).observe(page,{attributes:true,attributeFilter:['class']});
    const rt=document.getElementById('livePairingRoundTitle');if(rt)new MutationObserver(syncPairingPopup).observe(rt,{childList:true,subtree:true,characterData:true});
    const sel=document.getElementById('pairingsTournamentSelect');if(sel)sel.addEventListener('change',()=>setTimeout(syncPairingPopup,0));
  }
  function wrapNavigation(){
    const original=window.showTab;if(typeof original!=='function'||window.__cpLinuxPopupShowTabWrapped)return;
    window.showTab=function(id,button){if(id==='pairings'){const prev=document.querySelector('.page.active')?.id;if(prev&&prev!=='pairings')window.__cpLinuxPreviousTab=prev;}const out=original.apply(this,arguments);setTimeout(syncPairingPopup,0);return out;};
    window.__cpLinuxPopupShowTabWrapped=true;
  }
  function install(){
    forceMainFullscreen();syncTitle();installPairingPopup();wrapNavigation();syncPairingPopup();
    window.addEventListener('resize',forceMainFullscreen);
    window.toggleMaximizeAppWindow=function(e){e?.stopPropagation?.();forceMainFullscreen();};
    window.minimizeAppWindow=function(e){e?.stopPropagation?.();forceMainFullscreen();};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0),{once:true});else setTimeout(install,0);
})();
</script>
'''

_SCRIPT = (_SCRIPT_TEMPLATE.replace('__APP_BUILD__', repr(APP_BUILD)).replace('__DISPLAY_VERSION__', repr(DISPLAY_VERSION)).encode('utf-8'))


def inject_window_mode(data: bytes) -> bytes:
    if b'id="cpLinuxWindowModeScript"' in data:return data
    head=data.lower().rfind(b'</head>')
    if head>=0:data=data[:head]+_STYLE+data[head:]
    else:data=_STYLE+data
    body=data.lower().rfind(b'</body>')
    if body>=0:data=data[:body]+_SCRIPT+data[body:]
    else:data+=_SCRIPT
    return data


def apply() -> None:
    global _APPLIED
    if _APPLIED:return
    _APPLIED=True
    original_serve=cp.Handler._serve_app
    def serve_app(self:cp.Handler)->Any:
        original_text=self._text
        def window_text(status:int,data:bytes,content_type:str)->Any:
            if content_type.lower().startswith('text/html'):data=inject_window_mode(data)
            return original_text(status,data,content_type)
        self._text=window_text  # type: ignore[method-assign]
        try:return original_serve(self)
        finally:self._text=original_text  # type: ignore[method-assign]
    cp.Handler._serve_app=serve_app  # type: ignore[assignment]
