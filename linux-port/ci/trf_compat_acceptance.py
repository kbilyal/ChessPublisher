#!/usr/bin/env python3
"""Real Gacrux compatibility gate for historical TRF16 and current TRF26 fixtures.

Historical reference compatibility is deliberately separated from current-rule
pairing validity: an older file may parse and produce standings while its old
pairing history is not approved by the pinned 2026 Gacrux rules.
"""
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

def pairing_check(raw:dict):
    result=raw.get('pairingResult') if isinstance(raw,dict) else None
    return result.get('check') if isinstance(result,dict) else None

def competitors(raw:dict)->list:
    result=raw.get('tiebreakResult') if isinstance(raw,dict) else None
    return result.get('competitors',[]) if isinstance(result,dict) and isinstance(result.get('competitors'),list) else []

def real_ids(path:Path)->set[int]:
    ids=set()
    for line in path.read_text(encoding='utf-8-sig',errors='replace').replace('\r','').split('\n'):
        if line.startswith('001'):
            try:ids.add(int(line[4:8].strip()))
            except Exception:pass
    return ids

def check_pairing(gacrux:Path,path:Path,label:str,require_valid:bool)->dict:
    cp=ra.run([sys.executable,str(gacrux/'pairingchecker.py'),'-i',str(path),'-f','TRF','-m','dutch','-c'],cwd=gacrux)
    if cp.returncode!=0 or 'Program error' in cp.stdout or '(Pdb)' in cp.stdout:
        raise RuntimeError(f'{label} pairing checker process failed rc={cp.returncode}')
    raw=ra.parse_json_object(cp.stdout,f'{label} pairing checker')
    code=status_code(raw);check=pairing_check(raw)
    # code=1/check=false is a valid checker result for a parseable historical
    # tournament whose old pairing does not satisfy the pinned current rules.
    if code not in (0,1):raise RuntimeError(f'{label} pairing checker status={code} errors={raw.get("status",{}).get("error",[])[:5]}')
    if require_valid and (code!=0 or check is not True):
        raise RuntimeError(f'{label} current pairing must pass; status={code}, check={check}')
    return {'status':code,'check':check,'parsed':True}

def check_tiebreak(gacrux:Path,path:Path,label:str)->dict:
    cp=ra.run([sys.executable,str(gacrux/'tiebreakchecker.py'),'-i',str(path),'-f','TRF','-n','7','-r','-s','-t','PTS','BH/C1','SB'],cwd=gacrux)
    if cp.returncode!=0 or 'Program error' in cp.stdout or '(Pdb)' in cp.stdout:
        raise RuntimeError(f'{label} tie-break checker process failed rc={cp.returncode}')
    raw=ra.parse_json_object(cp.stdout,f'{label} tie-break checker')
    if status_code(raw)!=0:raise RuntimeError(f'{label} tie-break status={status_code(raw)} errors={raw.get("status",{}).get("error",[])[:5]}')
    rows=competitors(raw);actual={int(r.get('cid') or 0) for r in rows if int(r.get('cid') or 0)>0};expected=real_ids(path)
    missing=sorted(expected-actual)
    if missing:raise RuntimeError(f'{label} tie-break output is missing real competitors: {missing[:10]}')
    return {'parsed':True,'realPlayers':len(expected),'checkerRows':len(rows),'extraSyntheticRows':len(actual-expected)}

def main()->int:
    if not TRF16.is_file() or not TRF26.is_file():raise RuntimeError('TRF compatibility fixture missing')
    with tempfile.TemporaryDirectory(prefix='cp-trf-compat-') as td:
        gacrux=ra.safe_zip(ra.download(ra.GACRUX_URL),Path(td)/'gacrux')
        version=(gacrux/'version.py').read_text(encoding='utf-8')
        if f'"version": "{ra.GACRUX_VERSION}"' not in version:raise RuntimeError('Gacrux version mismatch')
        r16_pair=check_pairing(gacrux,TRF16,'TRF16',False)
        r16_tb=check_tiebreak(gacrux,TRF16,'TRF16')
        r26_pair=check_pairing(gacrux,TRF26,'TRF26',True)
        r26_tb=check_tiebreak(gacrux,TRF26,'TRF26')
    result={'TRF16':{'formatCompatible':True,'historicalPairingCurrentRuleCheck':r16_pair['check'],'pairingStatus':r16_pair['status'],**r16_tb},'TRF26':{'formatCompatible':True,'pairingCheck':r26_pair['check'],'pairingStatus':r26_pair['status'],**r26_tb},'gacrux':ra.GACRUX_VERSION}
    print(json.dumps(result,indent=2))
    print('TRF16_TRF26_REAL_COMPATIBILITY=PASS')
    return 0
if __name__=='__main__':raise SystemExit(main())
