#!/usr/bin/env python3
"""Real Gacrux compatibility gate for historical TRF16 and rating/report TRF26.

The two fixtures intentionally exercise different contracts:
- reference-trf16.TXT is a historical tournament file; Gacrux must parse it and
  its historical pairing check may legitimately fail under pinned 2026 rules.
- chesspublisher-test-tournament-trf26.TXT is a full rating/report export. It
  must be structurally complete and fully parseable by Gacrux Tie-Break Checker.
  It is NOT the pairing-engine input contract; current pairing validity is gated
  separately by real_acceptance.py using pairing-engine-r7.trf with both Gacrux
  1.9.57 and bbpPairings 6.0.0.

This separation prevents an upstream pairingchecker breakpoint on a report file
from being mistaken for a TRF format failure while keeping the real pairing gate
strict and independent.
"""
from __future__ import annotations
import json,sys,tempfile
from pathlib import Path
import real_acceptance as ra

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
TRF16=ROOT/'tests/fixtures/reference-trf16.TXT'
TRF26=ROOT/'tests/fixtures/chesspublisher-test-tournament-trf26.TXT'
PAIRING_FIXTURE=ROOT/'tests/fixtures/pairing-engine-r7.trf'


def status_code(raw:dict)->int:
    try:return int(raw.get('status',{}).get('code',-1))
    except Exception:return -1

def pairing_check(raw:dict):
    result=raw.get('pairingResult') if isinstance(raw,dict) else None
    return result.get('check') if isinstance(result,dict) else None

def competitors(raw:dict)->list:
    result=raw.get('tiebreakResult') if isinstance(raw,dict) else None
    return result.get('competitors',[]) if isinstance(result,dict) and isinstance(result.get('competitors'),list) else []

def trf_lines(path:Path)->list[str]:
    return path.read_text(encoding='utf-8-sig',errors='strict').replace('\r\n','\n').replace('\r','\n').split('\n')

def real_ids(path:Path)->set[int]:
    ids=set()
    for line in trf_lines(path):
        if line.startswith('001'):
            try:ids.add(int(line[4:8].strip()))
            except Exception:pass
    return ids

def check_historical_pairing(gacrux:Path,path:Path,label:str)->dict:
    cp=ra.run([sys.executable,str(gacrux/'pairingchecker.py'),'-i',str(path),'-f','TRF','-m','dutch','-c'],cwd=gacrux)
    if cp.returncode!=0 or 'Program error' in cp.stdout or '(Pdb)' in cp.stdout:
        raise RuntimeError(f'{label} pairing checker process failed rc={cp.returncode}')
    raw=ra.parse_json_object(cp.stdout,f'{label} pairing checker')
    code=status_code(raw);check=pairing_check(raw)
    # code=1/check=false is an acceptable diagnostic for a parseable historical
    # tournament whose old pairing does not satisfy the pinned current rules.
    if code not in (0,1):raise RuntimeError(f'{label} pairing checker status={code} errors={raw.get("status",{}).get("error",[])[:5]}')
    return {'status':code,'check':check,'parsed':True}

def check_tiebreak(gacrux:Path,path:Path,label:str,ties:list[str])->dict:
    cp=ra.run([sys.executable,str(gacrux/'tiebreakchecker.py'),'-i',str(path),'-f','TRF','-n','7','-r','-s','-t',*ties],cwd=gacrux)
    if cp.returncode!=0 or 'Program error' in cp.stdout or '(Pdb)' in cp.stdout:
        raise RuntimeError(f'{label} tie-break checker process failed rc={cp.returncode}')
    raw=ra.parse_json_object(cp.stdout,f'{label} tie-break checker')
    if status_code(raw)!=0:raise RuntimeError(f'{label} tie-break status={status_code(raw)} errors={raw.get("status",{}).get("error",[])[:5]}')
    rows=competitors(raw);actual={int(r.get('cid') or 0) for r in rows if int(r.get('cid') or 0)>0};expected=real_ids(path)
    missing=sorted(expected-actual)
    if missing:raise RuntimeError(f'{label} tie-break output is missing real competitors: {missing[:10]}')
    return {'parsed':True,'realPlayers':len(expected),'checkerRows':len(rows),'extraSyntheticRows':len(actual-expected)}

def validate_trf26_report(path:Path)->dict:
    lines=trf_lines(path)
    records={line[:3]:line for line in lines if len(line)>=3 and line[:3] in {'012','032','042','052','062','072','092','102','122','132','142','162','182','192','212','222'}}
    required={'012','032','042','052','062','072','092','102','122','132','142','162','182','192','212','222'}
    missing=sorted(required-set(records))
    if missing:raise RuntimeError(f'TRF26 report missing required records: {missing}')
    try:rounds=int(records['142'][4:].strip())
    except Exception:rounds=0
    if rounds!=7:raise RuntimeError(f'TRF26 report expected 7 rounds, found {rounds}')
    if 'FIDE_DUTCH_2025' not in records['192']:raise RuntimeError('TRF26 report does not declare FIDE_DUTCH_2025')
    if 'PTS' not in records['212']:raise RuntimeError('TRF26 report has no standings tie-break definition')
    players=[line for line in lines if line.startswith('001')]
    if len(players)!=27:raise RuntimeError(f'TRF26 report expected 27 player records, found {len(players)}')

    # TRF is fixed-width, but trailing spaces at the physical end of a line may
    # be omitted by exporters/editors. Validate the semantic 10-character round
    # blocks after right-padding rather than rejecting a valid line for missing
    # insignificant trailing blanks. Round blocks start at zero-based offset 91.
    expected_width=91+rounds*10
    allowed_colors={'w','b','-',' '}
    allowed_results={'1','0','=','+','-','F','H','U','D','L','W','Z','X','A','?',' '}
    invalid=[]
    for line in players:
        try:pid=int(line[4:8].strip())
        except Exception:pid=0
        padded=line.ljust(expected_width)
        for r in range(rounds):
            block=padded[91+r*10:91+(r+1)*10]
            opponent=block[:4].strip();color=block[5:6];result=block[7:8]
            if not opponent.isdigit() or color not in allowed_colors or result not in allowed_results:
                invalid.append({'player':pid,'round':r+1,'block':block})
                break
    if invalid:raise RuntimeError(f'TRF26 report has invalid player round blocks: {invalid[:5]}')
    return {'rounds':rounds,'players':len(players),'requiredRecords':len(required),'pairingSystem':'FIDE_DUTCH_2025','fixedWidthRoundBlocks':True}

def main()->int:
    if not TRF16.is_file() or not TRF26.is_file() or not PAIRING_FIXTURE.is_file():raise RuntimeError('TRF compatibility fixture missing')
    report_structure=validate_trf26_report(TRF26)
    with tempfile.TemporaryDirectory(prefix='cp-trf-compat-') as td:
        gacrux=ra.safe_zip(ra.download(ra.GACRUX_URL),Path(td)/'gacrux')
        version=(gacrux/'version.py').read_text(encoding='utf-8')
        if f'"version": "{ra.GACRUX_VERSION}"' not in version:raise RuntimeError('Gacrux version mismatch')
        r16_pair=check_historical_pairing(gacrux,TRF16,'TRF16')
        r16_tb=check_tiebreak(gacrux,TRF16,'TRF16',['PTS','BH/C1','SB'])
        # Full rating/report TRF26 is validated through the parser/tie-break path.
        # Strict current pairing validity is deliberately left to real_acceptance.py
        # and its exact pairing-engine fixture, which runs immediately after this gate.
        r26_tb=check_tiebreak(gacrux,TRF26,'TRF26',['PTS','DE','BH/C1','SB','TPR'])
    result={
        'TRF16':{'formatCompatible':True,'historicalPairingCurrentRuleCheck':r16_pair['check'],'pairingStatus':r16_pair['status'],**r16_tb},
        'TRF26':{'formatCompatible':True,'reportStructure':report_structure,'pairingValidityGate':'real_acceptance.py / pairing-engine-r7.trf',**r26_tb},
        'gacrux':ra.GACRUX_VERSION
    }
    print(json.dumps(result,indent=2))
    print('TRF16_TRF26_REAL_COMPATIBILITY=PASS')
    return 0
if __name__=='__main__':raise SystemExit(main())
