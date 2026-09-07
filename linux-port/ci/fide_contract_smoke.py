#!/usr/bin/env python3
"""Offline contract smoke for the Linux FIDE runtime."""
from __future__ import annotations
import json, sys, tempfile, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
from fide_runtime import FideRuntime, FideRuntimeError, build_legacy_index, _extract_single


def legacy_xml(count:int=1001)->str:
    rows=['<?xml version="1.0" encoding="UTF-8"?>','<playerslist>']
    rows.append('<player><fideid>1503014</fideid><name>Carlsen, Magnus</name><country>NOR</country><sex>M</sex><title>GM</title><w_title></w_title><o_title></o_title><foa_title></foa_title><rating>2823</rating><games>5</games><k>10</k><rapid_rating>2810</rapid_rating><rapid_games>2</rapid_games><rapid_k>10</rapid_k><blitz_rating>2880</blitz_rating><blitz_games>4</blitz_games><blitz_k>10</blitz_k><birthday>1990</birthday><flag></flag></player>')
    rows.append('<player><fideid>99999001</fideid><name>Unrated, Test Player</name><country>BUL</country><sex>F</sex><title></title><w_title></w_title><o_title>FA</o_title><foa_title>AFM</foa_title><rating></rating><games></games><k></k><rapid_rating></rapid_rating><rapid_games></rapid_games><rapid_k></rapid_k><blitz_rating></blitz_rating><blitz_games></blitz_games><blitz_k></blitz_k><birthday>2010</birthday><flag></flag></player>')
    for i in range(count-2):
        fid=600000000+i
        rows.append(f'<player><fideid>{fid}</fideid><name>Fixture, Player {i:04d}</name><country>FID</country><sex>M</sex><title></title><w_title></w_title><o_title></o_title><foa_title></foa_title><rating>1500</rating><games>0</games><k>40</k><rapid_rating>0</rapid_rating><rapid_games>0</rapid_games><rapid_k>0</rapid_k><blitz_rating>0</blitz_rating><blitz_games>0</blitz_games><blitz_k>0</blitz_k><birthday>2000</birthday><flag></flag></player>')
    rows.append('</playerslist>')
    return '\n'.join(rows)


def main()->int:
    with tempfile.TemporaryDirectory(prefix='cp-fide-contract-') as td_raw:
        td=Path(td_raw); xml=td/'players.xml'; xml.write_text(legacy_xml(),encoding='utf-8')
        rt=FideRuntime(td/'fide'); built=build_legacy_index(xml,rt.legacy_db)
        if built['players']!=1001: raise RuntimeError('legacy player count mismatch')
        got=rt.lookup(['1503014','99999001'])
        if got.get('matched')!=2: raise RuntimeError('FIDE-ID lookup mismatch')
        carlsen=got['players'][0]; unrated=got['players'][1]
        if (carlsen['std'],carlsen['rapid'],carlsen['blitz'],carlsen['stdK'],carlsen['title'],carlsen['birth'])!=(2823,2810,2880,10,'GM','1990'):
            raise RuntimeError('rated FIDE fields mismatch')
        if unrated['std']!=0 or unrated['gender']!='f' or unrated['birth']!='2010' or unrated['otherTitle']!='FA':
            raise RuntimeError('unrated FIDE metadata mismatch')
        search=rt.search('unrated test',60)
        if len(search['players'])!=1 or search['players'][0]['fideId']!='99999001': raise RuntimeError('name search mismatch')
        good=td/'good.zip'
        with zipfile.ZipFile(good,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('standard_rating_list.txt','x'*2000)
        extracted=_extract_single(good,td/'std.txt','.txt',10000)
        if extracted['bytes']!=2000: raise RuntimeError('safe ZIP extraction mismatch')
        bad=td/'bad.zip'
        with zipfile.ZipFile(bad,'w') as z:z.writestr('../escape.txt','evil')
        try:_extract_single(bad,td/'no.txt','.txt',10000)
        except FideRuntimeError:pass
        else:raise RuntimeError('unsafe ZIP accepted')
        print(json.dumps({'legacyPlayers':built['players'],'lookupMatched':2,'unratedSearch':1,'safeZip':True,'unsafeZipRejected':True},indent=2))
        print('FIDE_CONTRACT_SMOKE=PASS')
    return 0

if __name__=='__main__':raise SystemExit(main())
