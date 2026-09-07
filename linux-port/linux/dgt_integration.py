#!/usr/bin/env python3
"""Attach Linux DGT serial + managed PGN folder services to LocalEngine."""
from __future__ import annotations
import re, urllib.parse
from typing import Any
import chess_publisher_linux as cp
from dgt_runtime import DgtLinuxRuntime,DgtError

_APPLIED=False

def _pgn(engine:cp.LinuxEngine,body:dict[str,Any])->dict[str,Any]:
    name=str(body.get('tournamentName') or '').strip()
    if not name:raise ValueError('No tournament is selected.')
    folder=engine._folder(cp.safe_storage_name(name));pgn_dir=folder/'PGN';pgn_dir.mkdir(parents=True,exist_ok=True)
    operation=str(body.get('operation') or 'ensure').lower()
    if operation=='ensure':return {'ok':True,'folder':str(pgn_dir),'path':str(pgn_dir)}
    if operation!='write':raise ValueError('Unsupported PGN operation.')
    file_name=re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',str(body.get('fileName') or 'games.pgn')).strip() or 'games.pgn'
    if not file_name.lower().endswith('.pgn'):file_name+='.pgn'
    target=pgn_dir/file_name
    cp.atomic_write_bytes(target,str(body.get('text') or '').encode('utf-8'))
    return {'ok':True,'folder':str(pgn_dir),'path':str(target),'file':str(target)}

def apply()->None:
    global _APPLIED
    if _APPLIED:return
    _APPLIED=True
    original_init=cp.LinuxEngine.__init__
    def init(self:cp.LinuxEngine,*args:Any,**kwargs:Any)->None:
        original_init(self,*args,**kwargs);self.dgt=DgtLinuxRuntime()
    cp.LinuxEngine.__init__=init  # type: ignore

    original_get=cp.Handler.do_GET
    def do_get(self:cp.Handler)->None:
        path=urllib.parse.urlsplit(self.path).path
        if path=='/dgt/status':return self._json(200,self.engine.dgt.diagnostics())
        return original_get(self)
    cp.Handler.do_GET=do_get  # type: ignore

    original_post=cp.Handler.do_POST
    def do_post(self:cp.Handler)->None:
        path=urllib.parse.urlsplit(self.path).path
        try:
            if path.startswith('/dgt/'):
                if not self._require_local_origin():return
                body=self._body_json(1024*1024);op=path[len('/dgt/'):].strip('/')
                return self._json(200,self.engine.dgt.request(op,int(body.get('expectedBoards') or 1)))
            if path=='/tournament/pgn':
                if not self._require_local_origin():return
                return self._json(200,_pgn(self.engine,self._body_json(16*1024*1024)))
        except DgtError as exc:return self._json(503,{'ok':False,'error':str(exc),'platform':'linux','service':'DGT'})
        except ValueError as exc:return self._json(400,{'ok':False,'error':str(exc)})
        return original_post(self)
    cp.Handler.do_POST=do_post  # type: ignore
