#!/usr/bin/env python3
"""Real Gacrux compatibility gate for historical TRF16 and current TRF26 fixtures."""
from __future__ import annotations
import json,sys,tempfile
from pathlib import Path
import real_acceptance as ra

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
TRF16=ROOT/'tests/fixtures/reference-trf16.TXT'
TRF26=ROOT/'tests/fixtures/chesspublisher-test-tournament-trf26.TXT'


def status_code(raw:dict)->int:
    try:return int(raw.get('status',{}).get('code',-1))
    except Exception:return -1

def competitors(raw:dict)->list:
    result=raw.get('tiebreakResult') if isinstance(raw,dict) else None
    return result.get('competitors',[]) if isinstance(result,dict) and isinstance(result.get('competitors'),list) else []

def check_pairing(gacrux:Path,path:Path,label:str)->dict:
    cp=ra.run([sys.executable,str(gacrux/'pairingchecker.py'),'-i',str(path),'-f','TRF','-m','dutch','-c'],cwd=gacrux)
    if cp.returncode!=0 or 'Program error' in cp.stdout or '(Pdb)' in cp.stdout:
        raise RuntimeError(f'{label} pairing checker process failed rc={cp.returncode}')
    raw=ra.parse_json_object(cp.stdout,f'{label} pairing checker')
    if status_code(raw)!=0:raise RuntimeError(f'{label} pairing checker status={status_code(raw)} errors={raw.get("status",{}).get("error",[])[:5]}')
    return raw

def check_tiebreak(gacrux:Path,path:Path,label:str,count:int)->dict:
    cp=ra.run([sys.executable,str(gacrux/'tiebreakchecker.py'),'-i',str(path),'-f','TRF','-n','7','-r','-s','-t','PTS','BH/C1','SB'],cwd=gacrux)
    if cp.returncode!=0 or 'Program error' in cp.stdout or '(Pdb)' in cp.stdout:
        raise RuntimeError(f'{label} tie-break checker process failed rc={cp.returncode}')
    raw=ra.parse_json_object(cp.stdout,f'{label} tie-break checker')
    if status_code(raw)!=0:raise RuntimeError(f'{label} tie-break status={status_code(raw)} errors={raw.get("status",{}).get("error",[])[:5]}')
    rows=competitors(raw)
    if len(rows)!=count:raise RuntimeError(f'{label} expected {count} competitors, got {len(rows)}')
    if len({int(r.get("cid") or 0) for r in rows})!=count:raise RuntimeError(f'{label} competitor IDs are not unique')
    return raw

def main()->int:
    if not TRF16.is_file() or not TRF26.is_file():raise RuntimeError('TRF compatibility fixture missing')
    with tempfile.TemporaryDirectory(prefix='cp-trf-compat-') as td:
        gacrux=ra.safe_zip(ra.download(ra.GACRUX_URL),Path(td)/'gacrux')
        version=(gacrux/'version.py').read_text(encoding='utf-8')
        if f'"version": "{ra.GACRUX_VERSION}"' not in version:raise RuntimeError('Gacrux version mismatch')
        check_pairing(gacrux,TRF16,'TRF16')
        check_tiebreak(gacrux,TRF16,'TRF16',47)
        check_pairing(gacrux,TRF26,'TRF26')
        check_tiebreak(gacrux,TRF26,'TRF26',27)
    print(json.dumps({'TRF16':{'players':47,'pairingCheck':True,'tiebreakParse':True},'TRF26':{'players':27,'pairingCheck':True,'tiebreakParse':True},'gacrux':ra.GACRUX_VERSION},indent=2))
    print('TRF16_TRF26_REAL_COMPATIBILITY=PASS')
    return 0
if __name__=='__main__':raise SystemExit(main())
