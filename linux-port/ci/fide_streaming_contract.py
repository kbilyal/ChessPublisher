#!/usr/bin/env python3
"""Regression contract for dev7 FIDE LEGACY ZIP-stream indexing."""
from __future__ import annotations
import io,sys,tempfile,zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
import fide_runtime as fr
import fide_streaming_integration as fs


def xml_fixture(n:int=1205)->bytes:
    out=['<playerslist>']
    for i in range(n):
        out.append(f'<player><fideid>{700000000+i}</fideid><name>Streaming Player {i}</name><country>FID</country><sex>M</sex><title></title><w_title></w_title><o_title></o_title><foa_title></foa_title><rating>{1500+i%200}</rating><games>1</games><k>40</k><rapid_rating>0</rapid_rating><rapid_games>0</rapid_games><rapid_k>0</rapid_k><blitz_rating>0</blitz_rating><blitz_games>0</blitz_games><blitz_k>0</blitz_k><birthday>2000</birthday><flag></flag></player>')
    out.append('</playerslist>')
    return ''.join(out).encode('utf-8')


def main()->int:
    if fs.MAX_LEGACY_XML_STREAM_BYTES < 2*1024*1024*1024:raise RuntimeError('stream cap is unexpectedly small')
    if fs.MAX_LEGACY_PLAYERS < 2_000_000:raise RuntimeError('player cap is unexpectedly small')
    with tempfile.TemporaryDirectory(prefix='cp-fide-stream-') as td_raw:
        td=Path(td_raw);archive=td/'legacy.zip';db=td/'players.sqlite3'
        payload=xml_fixture()
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as zf:zf.writestr('players_list_xml_legacy.xml',payload)
        result=fs.build_legacy_index_from_zip(archive,db)
        if result.get('streamed') is not True:raise RuntimeError(f'legacy import not marked streamed: {result}')
        if result.get('players')!=1205:raise RuntimeError(f'wrong player count: {result}')
        if result.get('xmlBytes')!=len(payload):raise RuntimeError(f'wrong streamed byte count: {result}')
        if not db.is_file() or db.stat().st_size<4096:raise RuntimeError('SQLite index was not created')
        if any(p.suffix.lower()=='.xml' for p in td.iterdir()):raise RuntimeError('streaming importer materialised an XML file')
        bounded=fs._BoundedHashReader(io.BytesIO(b'x'*32),16)
        try:bounded.read()
        except fr.FideRuntimeError as exc:
            if 'stream exceeded safety limit' not in str(exc):raise
        else:raise RuntimeError('bounded reader failed open instead of fail closed')
    print('FIDE_LEGACY_ZIP_STREAMING=PASS')
    return 0

if __name__=='__main__':raise SystemExit(main())
