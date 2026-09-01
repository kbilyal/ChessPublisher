#!/usr/bin/env python3
from pathlib import Path
import argparse, json, subprocess, tempfile, sys
ROOT=Path(__file__).resolve().parent
RATING_PREFIX=('ARO','TPR','PTP','APRO','APPO')
CODES=['PTS','WIN','WON','BPG','BWG','AOB','REP','ARO','ARO/C1','ARO/C2','ARO/M1','ARO/M2','DE','DE/P','BH','BH/C1','BH/C2','BH/M1','BH/M2','BH/P','BH/C1/P','SB','SB/C1','SB/C2','SB/P','PS','PS/C1','PS/C2','KS','TPR','PTP','APRO','APPO']

def run_checker(gacrux,trf,code,unrated=None):
    with tempfile.TemporaryDirectory(prefix='cp-tb-') as td:
        out=Path(td)/'out.txt'
        cmd=[sys.executable,str(gacrux/'tiebreakchecker.py'),'-i',str(trf),'-o',str(out),'-f','TRF','-F','TXT','-n','7','-r','-d','T','-s','-t','PTS']
        if code!='PTS': cmd.append(code)
        if unrated is not None: cmd += ['-u',str(unrated)]
        p=subprocess.run(cmd,text=True,capture_output=True)
        text=out.read_text(encoding='utf-8',errors='replace') if out.exists() else ''
        return p.returncode,text,p.stdout,p.stderr,cmd

def make_unrated(src,dst):
    lines=[]
    for ln in src.read_text(encoding='utf-8').splitlines():
        if ln.startswith('001   27 '):
            c=list(ln); c[48:52]=list('   0'); ln=''.join(c)
        lines.append(ln)
    dst.write_text('\r\n'.join(lines)+'\r\n',encoding='latin1')

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--gacrux',required=True); ap.add_argument('--report',required=True)
    args=ap.parse_args(); gacrux=Path(args.gacrux)
    if '1.9.57' not in (gacrux/'version.py').read_text(encoding='utf-8'): raise SystemExit('Gacrux source is not 1.9.57')
    with tempfile.TemporaryDirectory(prefix='cp-tb-fixture-') as td:
        fixture=Path(td)/'fixture.trf'
        raw=(ROOT/'fixtures/synthetic-rc26.trf').read_text(encoding='utf-8').replace('\r\n','\n').replace('\r','\n')
        fixture.write_text(raw.replace('\n','\r\n'),encoding='latin1')
        accepted=[]
        for code in CODES:
            u=1550 if code.startswith(RATING_PREFIX) else None
            rc,text,stdout,stderr,cmd=run_checker(gacrux,fixture,code,u)
            if rc!=0 or not text.strip(): raise SystemExit(f'{code} failed rc={rc}\nCMD={cmd}\nOUT={text}\nSTDOUT={stdout}\nSTDERR={stderr}')
            header=text.splitlines()[0] if text.splitlines() else ''
            expected='PTS' if code=='PTS' else code
            if expected not in header: raise SystemExit(f'{code}: output header does not contain descriptor: {header!r}')
            accepted.append(code)
        unrated=Path(td)/'unrated.trf'; make_unrated(fixture,unrated)
        rating_results={}
        for code in ['ARO','ARO/C1','TPR','PTP','APRO','APPO']:
            rc_no,text_no,so,se,_=run_checker(gacrux,unrated,code,None)
            rc_u,text_u,so_u,se_u,_=run_checker(gacrux,unrated,code,1550)
            if rc_u!=0 or not text_u.strip(): raise SystemExit(f'{code} with -u 1550 failed rc={rc_u}: {se_u or so_u}')
            diff=text_no!=text_u
            rating_results[code]={'without_u_rc':rc_no,'with_u_rc':rc_u,'without_u_has_output':bool(text_no.strip()),'with_u_has_output':bool(text_u.strip()),'outputs_differ':diff}
        if not any(v['outputs_differ'] for v in rating_results.values()):
            raise SystemExit('Gacrux -u 1550 did not change any rating-based checker output for the unrated fixture; transport test is inconclusive.')
        result={'gate':'UPSTREAM_TIEBREAKCHECKER','status':'PASS','gacruxVersion':'1.9.57','upstreamCommit':'14a34a2c2f36509b110e4f25d6247f31fc4bf2f5','acceptedDescriptors':accepted,'acceptedCount':len(accepted),'ratingUnratedTransport':rating_results}
        Path(args.report).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
        print('UPSTREAM TIEBREAKCHECKER GATE PASS',json.dumps(result))
if __name__=='__main__': main()
