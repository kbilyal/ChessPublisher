#!/usr/bin/env python3
"""Regression contract for growing official FIDE LEGACY XML payloads."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
import fide_runtime as fr
import fide_payload_policy as policy

class FakeInfo:
    def __init__(self,size:int,compressed:int):
        self.file_size=size
        self.compress_size=compressed


def expect_fail(size:int,compressed:int,needle:str)->None:
    try:policy._validate_member(FakeInfo(size,compressed),'.xml',policy.MAX_LEGACY_XML_BYTES)
    except fr.FideRuntimeError as exc:
        if needle not in str(exc):raise RuntimeError(f'unexpected FIDE policy error: {exc}')
    else:raise RuntimeError('FIDE policy unexpectedly accepted invalid payload')


def main()->int:
    policy.apply()
    if fr.MAX_LEGACY_XML_BYTES != 768*1024*1024:raise RuntimeError('legacy XML cap is not dev6 value')
    # This size is deliberately above the old 260 MiB cap and models the current
    # official FIDE legacy XML growth without allocating a giant fixture.
    ok=policy._validate_member(FakeInfo(384*1024*1024,24*1024*1024),'.xml',policy.MAX_LEGACY_XML_BYTES)
    if ok['expansionRatio'] != 16.0:raise RuntimeError(f'wrong expansion ratio: {ok}')
    expect_fail(769*1024*1024,40*1024*1024,'size is outside safety limits')
    expect_fail(512*1024*1024,2*1024*1024,'expansion ratio is outside safety limits')
    print('FIDE_LEGACY_LARGE_XML_POLICY=PASS')
    return 0

if __name__=='__main__':raise SystemExit(main())
