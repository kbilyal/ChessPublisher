#!/usr/bin/env python3
"""Attach secure Worker-backed Chess-Results transport to Linux LocalEngine."""
from __future__ import annotations
import json, urllib.parse
from pathlib import Path
from typing import Any
import chess_publisher_linux as cp
from chess_results_runtime import ChessResultsRuntime, ChessResultsRuntimeError

_APPLIED=False

def _cloud_resolver(engine:cp.LinuxEngine,key:str,client_id:str)->str:
    for row in engine.list_tournaments():
        try:snapshot=json.loads(Path(row['file']).read_text(encoding='utf-8'))
        except Exception:continue
        current=str(snapshot.get('currentTournament') or '')
        tournaments=snapshot.get('tournaments') if isinstance(snapshot.get('tournaments'),dict) else {}
        tournament=tournaments.get(current) if isinstance(tournaments,dict) else None
        if not isinstance(tournament,dict):continue
        cr=tournament.get('chessResults') if isinstance(tournament.get('chessResults'),dict) else {}
        settings=tournament.get('settings') if isinstance(tournament.get('settings'),dict) else {}
        if str(cr.get('key') or settings.get('tnr') or '').strip()!=str(key):continue
        local_client=str(cr.get('clientId') or '').strip()
        if client_id and local_client and client_id!=local_client:continue
        for section in ('cloud','online','hub'):
            obj=tournament.get(section) if isinstance(tournament.get(section),dict) else {}
            cloud_id=str(obj.get('cloudTournamentId') or '').strip()
            if cloud_id:return cloud_id
    return ''

def apply()->None:
    global _APPLIED
    if _APPLIED:return
    _APPLIED=True
    original_init=cp.LinuxEngine.__init__
    def init(self:cp.LinuxEngine,*args:Any,**kwargs:Any)->None:
        original_init(self,*args,**kwargs)
        self.chess_results=ChessResultsRuntime(self.load_secrets,self.settings_root/'chess-results-ownership.json',lambda key,cid:_cloud_resolver(self,key,cid))
    cp.LinuxEngine.__init__=init  # type: ignore[assignment]
    original_get=cp.Handler.do_GET
    def do_get(self:cp.Handler)->None:
        path=urllib.parse.urlsplit(self.path).path
        if path=='/chessresults/status':return self._json(200,self.engine.chess_results.status())
        return original_get(self)
    cp.Handler.do_GET=do_get  # type: ignore[assignment]
    original_post=cp.Handler.do_POST
    def do_post(self:cp.Handler)->None:
        path=urllib.parse.urlsplit(self.path).path;prefix='/chessresults/'
        if not path.startswith(prefix):return original_post(self)
        operation=path[len(prefix):].strip('/').lower()
        if operation not in {'test','create','claim','publish','admin-link','delete-authorize','unlink'}:return self._json(404,{'ok':False,'error':'Unsupported Chess-Results operation.'})
        if not self._require_local_origin():return
        try:
            body=self._body_json(12*1024*1024);return self._json(200,self.engine.chess_results.request(operation,body))
        except ChessResultsRuntimeError as exc:return self._json(503,{'ok':False,'error':str(exc),'service':'Chess-Results secure Worker','transport':'secure-worker','platform':'linux'})
        except ValueError as exc:return self._json(400,{'ok':False,'error':str(exc)})
    cp.Handler.do_POST=do_post  # type: ignore[assignment]
