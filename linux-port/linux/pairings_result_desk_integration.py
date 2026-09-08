#!/usr/bin/env python3
"""Linux Pairings Result Desk layout: fixed controls; scroll boards only.

Protected ChessPublisher.html remains byte-identical. This delivery-only adapter
keeps the Result Desk and Generate Pairings controls anchored at every supported
Linux desktop width while the board table is the only Pairings workspace scroll
surface.
"""
from __future__ import annotations
from typing import Any

import chess_publisher_linux as cp

_APPLIED = False

_STYLE = r'''
<style id="cpLinuxFixedResultDeskStyle">
/* Fluid v2 Result Desk: board list scrolls; result controls never do. */
#pairings .swiss-workspace{
  display:grid!important;
  grid-template-columns:minmax(0,1fr) 214px!important;
  gap:8px!important;
  height:clamp(430px,62vh,700px)!important;
  min-height:430px!important;
  max-height:700px!important;
  overflow:hidden!important;
  align-items:stretch!important;
  padding:0 6px 7px!important;
  contain:layout paint!important;
}
#pairings .live-pairing-table-wrap{
  height:100%!important;
  min-height:0!important;
  max-height:none!important;
  overflow:auto!important;
  overscroll-behavior:contain!important;
  scrollbar-gutter:stable!important;
  contain:paint!important;
}
#pairings .live-pairing-table th{
  position:sticky!important;
  top:0!important;
  z-index:8!important;
}
#pairings .result-palette{
  position:sticky!important;
  top:0!important;
  align-self:start!important;
  height:auto!important;
  max-height:none!important;
  overflow:visible!important;
  overscroll-behavior:none!important;
  scrollbar-width:none!important;
  z-index:35!important;
  transform:translateZ(0);
  contain:layout paint!important;
}
#pairings .result-palette::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
#pairings .result-palette button,
#pairings .result-palette .result-main-grid,
#pairings .result-palette .result-admin-grid,
#pairings .result-palette .result-filter-grid{
  flex-shrink:0!important;
}
#pairings #btnGenerateGacrux{
  display:block!important;
  visibility:visible!important;
  position:relative!important;
}
@media(max-width:1100px){
  #pairings .swiss-workspace{grid-template-columns:minmax(0,1fr) 190px!important}
}
@media(max-width:900px){
  /* Do not fall back to a scrolling Result Desk on narrower desktop windows. */
  #pairings .swiss-workspace{
    grid-template-columns:minmax(0,1fr) 180px!important;
    height:clamp(400px,58vh,620px)!important;
    min-height:400px!important;
    max-height:620px!important;
    overflow:hidden!important;
  }
  #pairings .live-pairing-table-wrap{
    height:100%!important;
    min-height:0!important;
    max-height:none!important;
    overflow:auto!important;
  }
  #pairings .result-palette{
    position:sticky!important;
    top:0!important;
    max-height:none!important;
    overflow:visible!important;
  }
}
</style>
'''.encode('utf-8')


def inject_fixed_result_desk(data: bytes) -> bytes:
    if b'id="cpLinuxFixedResultDeskStyle"' in data:
        return data
    head = data.lower().rfind(b'</head>')
    if head >= 0:
        return data[:head] + _STYLE + data[head:]
    return _STYLE + data


def apply() -> None:
    global _APPLIED
    if _APPLIED:
        return
    _APPLIED = True
    original_serve = cp.Handler._serve_app

    def serve_app(self: cp.Handler) -> Any:
        original_text = self._text

        def result_desk_text(status: int, data: bytes, content_type: str) -> Any:
            if content_type.lower().startswith('text/html'):
                data = inject_fixed_result_desk(data)
            return original_text(status, data, content_type)

        self._text = result_desk_text  # type: ignore[method-assign]
        try:
            return original_serve(self)
        finally:
            self._text = original_text  # type: ignore[method-assign]

    cp.Handler._serve_app = serve_app  # type: ignore[assignment]
