#!/usr/bin/env python3
"""Stream the FIDE LEGACY XML directly from ZIP into SQLite on Linux.

This avoids materialising the very large XML payload on disk.  The import is
bounded by archive size, streamed XML bytes and maximum player records.  The
protected Chess-Publisher UI and tournament core are untouched.
"""
from __future__ import annotations
import hashlib
import os
import sqlite3
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

import fide_runtime as fr

_APPLIED=False
MAX_LEGACY_ARCHIVE_BYTES=256*1024*1024
MAX_LEGACY_XML_STREAM_BYTES=3*1024*1024*1024
MAX_LEGACY_PLAYERS=3_000_000

class _BoundedHashReader:
    def __init__(self,source:Any,max_bytes:int):
        self.source=source;self.max_bytes=int(max_bytes);self.total=0;self.hash=hashlib.sha256()
    def read(self,size:int=-1)->bytes:
        chunk=self.source.read(size)
        if chunk:
            self.total+=len(chunk)
            if self.total>self.max_bytes:
                raise fr.FideRuntimeError(f"FIDE LEGACY XML stream exceeded safety limit (bytes>{self.max_bytes}).")
            self.hash.update(chunk)
        return chunk
    def hexdigest(self)->str:return self.hash.hexdigest()


def _build_index_stream(source:Any,db_target:Path,max_players:int=MAX_LEGACY_PLAYERS)->dict[str,Any]:
    db_target.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp_name=tempfile.mkstemp(prefix=f'.{db_target.name}.',dir=str(db_target.parent));os.close(fd);tmp=Path(tmp_name)
    count=0
    try:
        conn=sqlite3.connect(tmp)
        try:
            conn.executescript("""PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY; CREATE TABLE players(fideid INTEGER PRIMARY KEY,name TEXT NOT NULL,name_fold TEXT NOT NULL,country TEXT,sex TEXT,title TEXT,w_title TEXT,o_title TEXT,foa_title TEXT,rating INTEGER NOT NULL DEFAULT 0,games INTEGER NOT NULL DEFAULT 0,k INTEGER NOT NULL DEFAULT 0,rapid_rating INTEGER NOT NULL DEFAULT 0,rapid_games INTEGER NOT NULL DEFAULT 0,rapid_k INTEGER NOT NULL DEFAULT 0,blitz_rating INTEGER NOT NULL DEFAULT 0,blitz_games INTEGER NOT NULL DEFAULT 0,blitz_k INTEGER NOT NULL DEFAULT 0,birthday TEXT,flag TEXT);""")
            sql='INSERT OR REPLACE INTO players VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';batch=[]
            parser=ET.iterparse(source,events=('start','end'));root=None
            for event,elem in parser:
                if root is None and event=='start':root=elem;continue
                if event!='end' or elem.tag.rsplit('}',1)[-1]!='player':continue
                row=fr._player_tuple(elem);elem.clear()
                if root is not None:root.clear()
                if row is None:continue
                batch.append(row);count+=1
                if count>max_players:raise fr.FideRuntimeError(f'FIDE LEGACY XML exceeded player safety limit ({max_players:,}).')
                if len(batch)>=2000:conn.executemany(sql,batch);batch.clear()
            if batch:conn.executemany(sql,batch)
            if count<1000:raise fr.FideRuntimeError(f'FIDE LEGACY XML produced only {count} player records; refusing incomplete index.')
            conn.execute('CREATE INDEX idx_players_name_fold ON players(name_fold)');conn.execute('CREATE INDEX idx_players_country ON players(country)');conn.commit()
            check=conn.execute('PRAGMA quick_check').fetchone()
            if not check or check[0]!='ok':raise fr.FideRuntimeError('FIDE SQLite index integrity check failed.')
        finally:conn.close()
        os.replace(tmp,db_target)
    except Exception:
        try:tmp.unlink()
        except OSError:pass
        raise
    return {'players':count,'bytes':db_target.stat().st_size,'sha256':fr._sha256_file(db_target)}


def build_legacy_index_from_zip(archive:Path,db_target:Path,max_xml_bytes:int=MAX_LEGACY_XML_STREAM_BYTES)->dict[str,Any]:
    with zipfile.ZipFile(archive) as zf:
        candidates=[m for m in fr._safe_zip_members(zf) if m.filename.lower().endswith('.xml')]
        if not candidates:raise fr.FideRuntimeError('FIDE archive contains no .xml payload.')
        info=max(candidates,key=lambda m:int(m.file_size or 0));declared=int(info.file_size or 0)
        if declared<=0:raise fr.FideRuntimeError('FIDE LEGACY XML has an invalid declared size.')
        if declared>max_xml_bytes:raise fr.FideRuntimeError(f'FIDE LEGACY XML declared size exceeds streaming safety limit (bytes={declared}, max={max_xml_bytes}).')
        with zf.open(info,'r') as raw:
            bounded=_BoundedHashReader(raw,max_xml_bytes);indexed=_build_index_stream(bounded,db_target)
        return {'member':info.filename,'xmlBytes':bounded.total,'xmlSha256':bounded.hexdigest(),'compressedBytes':int(info.compress_size or 0),'streamed':True,**indexed}


def _update_legacy(self:fr.FideRuntime,work:Path)->dict[str,Any]:
    url=f'{fr.FIDE_DOWNLOAD_ROOT}/{fr.LEGACY_XML_ARCHIVE}';archive=work/fr.LEGACY_XML_ARCHIVE
    dl=fr._download_to(url,archive,max_bytes=MAX_LEGACY_ARCHIVE_BYTES)
    indexed=build_legacy_index_from_zip(archive,self.legacy_db,max_xml_bytes=MAX_LEGACY_XML_STREAM_BYTES)
    return {'source':url,'archiveSha256':dl['sha256'],'archiveBytes':dl['bytes'],**indexed,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}


def apply()->None:
    global _APPLIED
    if _APPLIED:return
    _APPLIED=True
    fr.FideRuntime._update_legacy=_update_legacy  # type: ignore[assignment]
