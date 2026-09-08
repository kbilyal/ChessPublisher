#!/usr/bin/env python3
"""Cross-platform FIDE database runtime for Chess-Publisher Linux.

Monthly Standard/Rapid/Blitz lists are stored as the official FIDE TXT payloads
because the existing Chess-Publisher UI already owns that parser. The full
LEGACY directory is imported from the official XML payload into a local SQLite
index for exact FIDE-ID lookup and fast unrated-player search.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import tempfile
import time
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET

FIDE_DOWNLOAD_ROOT = "https://ratings.fide.com/download"
LISTS = {
    "std": ("standard_rating_list.zip", "txt"),
    "rapid": ("rapid_rating_list.zip", "txt"),
    "blitz": ("blitz_rating_list.zip", "txt"),
}
LEGACY_XML_ARCHIVE = "players_list_xml_legacy.zip"
USER_AGENT = "Chess-Publisher-Linux-FIDE/1"
MAX_ARCHIVE_BYTES = 96 * 1024 * 1024
MAX_EXTRACTED_LIST_BYTES = 160 * 1024 * 1024
MAX_LEGACY_XML_BYTES = 260 * 1024 * 1024
DOWNLOAD_TIMEOUT = 120
MAX_LOOKUP_IDS = 1000
MAX_SEARCH_LIMIT = 100

class FideRuntimeError(RuntimeError):
    pass

def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            json.dump(value, f, ensure_ascii=False, indent=2, sort_keys=True); f.write("\n"); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try: os.unlink(tmp)
        except OSError: pass
        raise

def _download_to(url: str, target: Path, max_bytes: int = MAX_ARCHIVE_BYTES, timeout: int = DOWNLOAD_TIMEOUT) -> dict[str, Any]:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=str(target.parent))
    total = 0; h = hashlib.sha256()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/zip,application/octet-stream;q=0.9,*/*;q=0.1"})
        with os.fdopen(fd, "wb") as out, urllib.request.urlopen(req, timeout=timeout) as resp:
            ctype = str(resp.headers.get("Content-Type") or "")
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk: break
                total += len(chunk)
                if total > max_bytes: raise FideRuntimeError(f"FIDE download exceeded safety limit: {url}")
                out.write(chunk); h.update(chunk)
            out.flush(); os.fsync(out.fileno())
        if total < 100: raise FideRuntimeError(f"FIDE download is unexpectedly small: {url}")
        os.replace(tmp_name, target)
        return {"url": url, "bytes": total, "sha256": h.hexdigest(), "contentType": ctype}
    except Exception as exc:
        try: os.unlink(tmp_name)
        except OSError: pass
        if isinstance(exc, FideRuntimeError): raise
        raise FideRuntimeError(f"Could not download FIDE data from {url}: {exc}") from exc

def _safe_zip_members(zf: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    members = []
    for info in zf.infolist():
        p = Path(info.filename)
        if p.is_absolute() or ".." in p.parts: raise FideRuntimeError("Unsafe path in FIDE ZIP archive.")
        unix_mode = (info.external_attr >> 16) & 0o170000
        if unix_mode == 0o120000: raise FideRuntimeError("Symlink in FIDE ZIP archive is not accepted.")
        if not info.is_dir(): members.append(info)
    if not members: raise FideRuntimeError("FIDE ZIP archive has no files.")
    return members

def _extract_single(archive: Path, target: Path, suffix: str, max_bytes: int) -> dict[str, Any]:
    with zipfile.ZipFile(archive) as zf:
        candidates = [m for m in _safe_zip_members(zf) if m.filename.lower().endswith(suffix.lower())]
        if not candidates: raise FideRuntimeError(f"FIDE archive contains no {suffix} payload.")
        info = max(candidates, key=lambda m: int(m.file_size or 0))
        if info.file_size <= 0 or info.file_size > max_bytes: raise FideRuntimeError(f"FIDE extracted {suffix} payload size is outside safety limits.")
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=str(target.parent)); h = hashlib.sha256(); total = 0
        try:
            with os.fdopen(fd, "wb") as out, zf.open(info, "r") as src:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk: break
                    total += len(chunk)
                    if total > max_bytes: raise FideRuntimeError("FIDE extracted payload exceeded safety limit.")
                    out.write(chunk); h.update(chunk)
                out.flush(); os.fsync(out.fileno())
            os.replace(tmp_name, target)
        except Exception:
            try: os.unlink(tmp_name)
            except OSError: pass
            raise
    return {"member": info.filename, "bytes": total, "sha256": h.hexdigest()}

def _txt(elem: ET.Element, name: str) -> str:
    node = elem.find(name); return str(node.text or "").strip() if node is not None else ""

def _int_or_zero(value: str) -> int:
    try: return max(0, int(str(value or "0").strip() or "0"))
    except Exception: return 0

def _player_tuple(player: ET.Element) -> tuple[Any, ...] | None:
    fide_id = _txt(player, "fideid")
    if not re.fullmatch(r"\d{5,15}", fide_id): return None
    name = _txt(player, "name")
    if not name: return None
    country = (_txt(player, "country") or "FIDE").upper(); sex = _txt(player, "sex").upper()
    if sex not in {"M", "F"}: sex = ""
    birthday = _txt(player, "birthday")
    if not re.fullmatch(r"(?:19\d{2}|20[0-3]\d)", birthday): birthday = ""
    return (int(fide_id), name, name.casefold(), country, sex, _txt(player,"title").upper(), _txt(player,"w_title").upper(), _txt(player,"o_title").upper(), _txt(player,"foa_title").upper(), _int_or_zero(_txt(player,"rating")), _int_or_zero(_txt(player,"games")), _int_or_zero(_txt(player,"k")), _int_or_zero(_txt(player,"rapid_rating")), _int_or_zero(_txt(player,"rapid_games")), _int_or_zero(_txt(player,"rapid_k")), _int_or_zero(_txt(player,"blitz_rating")), _int_or_zero(_txt(player,"blitz_games")), _int_or_zero(_txt(player,"blitz_k")), birthday, _txt(player,"flag"))

def build_legacy_index(xml_file: Path, db_target: Path) -> dict[str, Any]:
    db_target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{db_target.name}.", dir=str(db_target.parent)); os.close(fd); tmp = Path(tmp_name)
    try:
        conn = sqlite3.connect(tmp)
        try:
            conn.executescript("""PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY; CREATE TABLE players(fideid INTEGER PRIMARY KEY,name TEXT NOT NULL,name_fold TEXT NOT NULL,country TEXT,sex TEXT,title TEXT,w_title TEXT,o_title TEXT,foa_title TEXT,rating INTEGER NOT NULL DEFAULT 0,games INTEGER NOT NULL DEFAULT 0,k INTEGER NOT NULL DEFAULT 0,rapid_rating INTEGER NOT NULL DEFAULT 0,rapid_games INTEGER NOT NULL DEFAULT 0,rapid_k INTEGER NOT NULL DEFAULT 0,blitz_rating INTEGER NOT NULL DEFAULT 0,blitz_games INTEGER NOT NULL DEFAULT 0,blitz_k INTEGER NOT NULL DEFAULT 0,birthday TEXT,flag TEXT);""")
            sql="INSERT OR REPLACE INTO players VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?); batch=[]; count=0
            for _, elem in ET.iterparse(xml_file, events=("end",)):
                if elem.tag.rsplit("}",1)[-1] != "player": continue
                row=_player_tuple(elem); elem.clear()
                if row is None: continue
                batch.append(row); count+=1
                if len(batch)>=2000: conn.executemany(sql,batch); batch.clear()
            if batch: conn.executemany(sql,batch)
            if count<1000: raise FideRuntimeError(f"FIDE LEGACY XML produced only {count} player records; refusing incomplete index.")
            conn.execute("CREATE INDEX idx_players_name_fold ON players(name_fold)"); conn.execute("CREATE INDEX idx_players_country ON players(country)"); conn.commit()
            check=conn.execute("PRAGMA quick_check").fetchone()
            if not check or check[0] != "ok": raise FideRuntimeError("FIDE SQLite index integrity check failed.")
        finally: conn.close()
        os.replace(tmp,db_target)
    except Exception:
        try: tmp.unlink()
        except OSError: pass
        raise
    return {"players":count,"bytes":db_target.stat().st_size,"sha256":_sha256_file(db_target)}

def _rating_list_header_ready(path:Path)->bool:
    try:
        if not path.is_file() or path.stat().st_size < 1000:return False
        with path.open('rb') as f:head=f.read(64*1024).lower()
        return b'id number' in head and b'name' in head and b'fed' in head
    except OSError:return False


@dataclass
class FideStatus:
    ready: bool; lists: dict[str,dict[str,Any]]; legacy_ready: bool; legacy_players: int; updated_at: str
    def as_dict(self)->dict[str,Any]:
        return {"ok":True,"ready":self.ready,"lists":self.lists,"legacyReady":self.legacy_ready,"legacyPlayers":self.legacy_players,"updatedAt":self.updated_at,"source":"FIDE official rating downloads"}

class FideRuntime:
    def __init__(self,data_dir:Path):
        self.data_dir=data_dir.expanduser().resolve(); self.lists_dir=self.data_dir/'lists'; self.legacy_dir=self.data_dir/'legacy'; self.metadata_file=self.data_dir/'metadata.json'; self.legacy_db=self.legacy_dir/'players.sqlite3'
    def _metadata(self)->dict[str,Any]:
        try:
            obj=json.loads(self.metadata_file.read_text(encoding='utf-8')); return obj if isinstance(obj,dict) else {}
        except Exception:return {}
    def list_path(self,list_type:str)->Path:
        if list_type not in LISTS: raise FideRuntimeError("Unknown FIDE rating list type.")
        return self.lists_dir/f'{list_type}.txt'
    def read_list(self,list_type:str)->bytes:
        path=self.list_path(list_type)
        if not path.is_file(): raise FileNotFoundError(f"FIDE {list_type} list has not been downloaded yet.")
        data=path.read_bytes()
        head=data[:64*1024].lower()
        if len(data)<1000 or b'id number' not in head or b'name' not in head or b'fed' not in head:
            raise FideRuntimeError(f"FIDE {list_type} list is invalid or incomplete.")
        return data
    def status(self)->FideStatus:
        meta=self._metadata(); rows={}; all_lists=True
        for key in LISTS:
            path=self.list_path(key); item=dict((meta.get('lists') or {}).get(key) or {}); item['ready']=_rating_list_header_ready(path); item['bytes']=path.stat().st_size if path.is_file() else 0; rows[key]=item; all_lists=all_lists and item['ready']
        legacy=dict(meta.get('legacy') or {}); legacy_ready=self.legacy_db.is_file() and self.legacy_db.stat().st_size>4096
        return FideStatus(all_lists,rows,legacy_ready,int(legacy.get('players') or 0),str(meta.get('updatedAt') or ''))
    def _update_list(self,key:str,work:Path)->dict[str,Any]:
        archive_name,_=LISTS[key]; url=f'{FIDE_DOWNLOAD_ROOT}/{archive_name}'; archive=work/archive_name; dl=_download_to(url,archive); target=self.list_path(key); extract=_extract_single(archive,target,'.txt',MAX_EXTRACTED_LIST_BYTES)
        return {"source":url,"archiveSha256":dl['sha256'],"archiveBytes":dl['bytes'],**extract,"updatedAt":time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    def _update_legacy(self,work:Path)->dict[str,Any]:
        url=f'{FIDE_DOWNLOAD_ROOT}/{LEGACY_XML_ARCHIVE}'; archive=work/LEGACY_XML_ARCHIVE; dl=_download_to(url,archive); xml=work/'players_list_xml_legacy.xml'; extract=_extract_single(archive,xml,'.xml',MAX_LEGACY_XML_BYTES)