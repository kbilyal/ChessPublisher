#!/usr/bin/env python3
"""Linux Pairings Result Desk layout: keep result controls fixed; scroll boards only.

Protected ChessPublisher.html remains byte-identical. This delivery-only adapter
adds CSS after the protected UI and Linux window adapter so the Result Desk has
no internal scrollbar and never moves while the board table scrolls.
"""
from __future__ import annotations
from typing import Any

import chess_publisher_linux as cp

_APPLIED = False

_STYLE = r'''
<style id="cpLinuxFixedResultDeskStyle">
/* Desktop Result Desk: only the boards/table area scrolls. */
#pairings .swiss-workspace{
  height:auto!important;
  min-height:390px!important;
  overflow:visible!important;
  align-items:start!important;
}
#pairings .live-pairing-table-wrap{
  height:clamp(390px,58vh,620px)!important;
  min-height:390px!important;
  max-height:calc(100vh - 180px)!important;
  overflow:auto!important;
  overscroll-behavior:contain!important;
  scrollbar-gutter:stable!important;
}
#pairings .result-palette{
  position:sticky!important;
  top:39px!important;
  align-self:start!important;
  height:auto!important;
  max-height:none!important;
  overflow:visible!important;
  overscroll-behavior:none!important;
  scrollbar-width:none!important;
}
#pairings .result-palette::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
#pairings .result-palette button,
#pairings .result-palette .result-main-grid,
#pairings .result-palette .result-admin-grid,
#pairings .result-palette .result-filter-grid{
  flex-shrink:0!important;
}
@media(max-width:900px){
  #pairings .swiss-workspace{height:auto!important;overflow:visible!important}
  #pairings .live-pairing-table-wrap{height:min(56vh,520px)!important;min-height:340px!important;overflow:auto!important}
  #pairings .result-palette{position:static!important;top:auto!important;max-height:none!important;overflow:visible!important}
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
