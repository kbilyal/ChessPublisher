#!/usr/bin/env python3
"""Bind the Linux LocalEngine delivery metadata to the canonical build identity.

This is platform-only glue. It does not modify the protected Chess-Publisher UI
source or tournament algorithms; it rewrites only the injected Linux build marker
at HTTP delivery time.
"""
from __future__ import annotations
import re
from typing import Any
import chess_publisher_linux as app
from build_info import APP_BUILD, ENGINE_VERSION

_APPLIED=False
_MARKER=re.compile(rb"document\.documentElement\.dataset\.chesspublisherLinuxBuild='[^']*';")
_REPLACEMENT=f"document.documentElement.dataset.chesspublisherLinuxBuild='{APP_BUILD}';".encode('ascii')


def apply()->None:
    global _APPLIED
    if _APPLIED:return
    _APPLIED=True
    app.APP_BUILD=APP_BUILD
    app.ENGINE_VERSION=ENGINE_VERSION
    app.Handler.server_version=f"ChessPublisherLinuxEngine/{ENGINE_VERSION.split('-',1)[0]}"
    original_serve=app.Handler._serve_app

    def serve_app(self:app.Handler)->Any:
        original_text=self._text
        def identity_text(status:int,data:bytes,content_type:str)->Any:
            if content_type.lower().startswith('text/html'):
                matches=_MARKER.findall(data)
                if len(matches)!=1:
                    raise RuntimeError(f'Linux served UI build marker count is {len(matches)}, expected exactly 1.')
                data=_MARKER.sub(_REPLACEMENT,data,count=1)
            return original_text(status,data,content_type)
        self._text=identity_text  # type: ignore[method-assign]
        try:return original_serve(self)
        finally:self._text=original_text  # type: ignore[method-assign]

    app.Handler._serve_app=serve_app  # type: ignore[assignment]
