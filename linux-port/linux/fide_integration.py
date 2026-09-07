#!/usr/bin/env python3
"""Attach the Linux FIDE runtime to the current LocalEngine without touching UI/core."""
from __future__ import annotations
import urllib.parse
from typing import Any

import chess_publisher_linux as cp
from fide_runtime import FideRuntime, FideRuntimeError

_APPLIED=False


def apply()->None:
    global _APPLIED
    if _APPLIED:return
    _APPLIED=True

    original_init=cp.LinuxEngine.__init__
    def init(self:cp.LinuxEngine,*args:Any,**kwargs:Any)->None:
        original_init(self,*args,**kwargs)
        self.fide=FideRuntime(self.data_home/'fide')
    cp.LinuxEngine.__init__=init  # type: ignore[assignment]

    original_get=cp.Handler.do_GET
    def do_get(self:cp.Handler)->None:
        path=urllib.parse.urlsplit(self.path).path
        try:
            if path in ('/fide/std','/fide/rapid','/fide/blitz'):
                list_type=path.rsplit('/',1)[-1]
                try:data=self.engine.fide.read_list(list_type)
                except FileNotFoundError as exc:return self._json(404,{'ok':False,'error':str(exc)})
                return self._text(200,data,'text/plain; charset=utf-8')
            if path=='/fide/status':
                return self._json(200,self.engine.fide.status().as_dict())
        except FideRuntimeError as exc:
            return self._json(503,{'ok':False,'ready':False,'error':str(exc),'service':'FIDE database','platform':'linux'})
        return original_get(self)
    cp.Handler.do_GET=do_get  # type: ignore[assignment]

    original_post=cp.Handler.do_POST
    def do_post(self:cp.Handler)->None:
        path=urllib.parse.urlsplit(self.path).path
        if path not in ('/fide-update','/fide/players-lookup','/fide/players-search'):
            return original_post(self)
        if not self._require_local_origin():return
        try:
            if path=='/fide-update':return self._json(200,self.engine.fide.update())
            if path=='/fide/players-lookup':
                body=self._body_json(2*1024*1024); ids=body.get('fideIds') or []
                if not isinstance(ids,list):raise ValueError('fideIds must be an array.')
                return self._json(200,self.engine.fide.lookup(ids))
            body=self._body_json(1024*1024)
            return self._json(200,self.engine.fide.search(body.get('query'),body.get('limit',60)))
        except FileNotFoundError as exc:
            return self._json(404,{'ok':False,'error':str(exc)})
        except ValueError as exc:
            return self._json(400,{'ok':False,'error':str(exc)})
        except FideRuntimeError as exc:
            return self._json(503,{'ok':False,'ready':False,'error':str(exc),'service':'FIDE database','platform':'linux'})
    cp.Handler.do_POST=do_post  # type: ignore[assignment]
