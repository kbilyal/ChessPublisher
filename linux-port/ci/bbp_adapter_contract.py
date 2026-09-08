#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
from bbp_runtime import BBPRuntime

line=(f"001 {2:4d} "+"Player".ljust(73)+f" 0.0 {2:4d}").ljust(131)
text='012 Test\n142 4\n152 B\n192 FIDE_DUTCH_2025\n'+line+'\n'
mapped=BBPRuntime._temporary_checker_trf(text,3,[2])
assert '240 Z   3    2' in mapped.splitlines()
start=91+(3-1)*10
player=next(x for x in mapped.splitlines() if x.startswith('001'))
assert player[start:start+10].strip()==''

engine=(ROOT/'linux'/'chess_publisher_linux.py').read_text(encoding='utf-8')
assert 'b.get("unpaired") or b.get("unpairedIds") or []' in engine
print('BBP_ADAPTER_CONTRACT=PASS')
