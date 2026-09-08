#!/usr/bin/env python3
"""Normalize Linux Hub/Cloud proxy requests to the public WEB_ORIGIN contract."""
from __future__ import annotations
import urllib.error,urllib.request
import chess_publisher_linux as cp

WEB_ORIGIN="https://web.chess-publisher.org"
_APPLIED=False

def apply()->None:
    global _APPLIED
    if _APPLIED:return
    _APPLIED=True
    def _proxy_worker(self:cp.Handler,path:str,query:str)->None:
        suffix=path[len('/proxy/hub-api'):]
        if not suffix.startswith('/'):suffix='/'+suffix
        target=cp.WORKER_ORIGIN+suffix+(('?'+query) if query else '')
        length=int(self.headers.get('Content-Length','0') or 0)
        body=self.rfile.read(length) if length else None
        headers={
            'Accept':self.headers.get('Accept','application/json'),
            'Origin':WEB_ORIGIN,
            'User-Agent':'Chess-Publisher-Linux-HubProxy/1',
        }
        # Do not reintroduce X-Client-Version: beta.31 deliberately removed it
        # because it caused Worker CORS/preflight failures.
        for name in ('Authorization','Content-Type','X-Organizer-Token','X-Expected-Revision','X-Confirm-Delete'):
            value=self.headers.get(name)
            if value:headers[name]=value
        req=urllib.request.Request(target,data=body,method=self.command,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=45) as resp:
                data=resp.read();ctype=resp.headers.get('Content-Type','application/json; charset=utf-8')
                return self._text(resp.status,data,ctype)
        except urllib.error.HTTPError as exc:
            data=exc.read();return self._text(exc.code,data,exc.headers.get('Content-Type','application/json; charset=utf-8'))
        except Exception as exc:
            return self._json(502,{'error':'Cloud proxy request failed.','detail':str(exc)})
    cp.Handler._proxy_worker=_proxy_worker  # type: ignore[assignment]
