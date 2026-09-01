#!/usr/bin/env python3
"""RC26 Linux Gacrux gate with a byte-equivalent TRF serializer model.

The serializer below is a test model of the pinned RC26 production functions.
Before this file is used for engine testing, local differential tests compare its
TRF bytes against the real RC26 buildPairingEngineTRF extracted from
ChessPublisher.html. Production remains the source of truth.
"""
from __future__ import annotations
import argparse, json, re, subprocess, sys, tempfile
from dataclasses import dataclass, asdict
from pathlib import Path

GACRUX_COMMIT="14a34a2c2f36509b110e4f25d6247f31fc4bf2f5"
GACRUX_VERSION="1.9.57"
RC26_HTML_SHA256="9099d8c08c06e77117cce98d8160942af57b467f0994d6c7c3ff7f902c274098"
RC26_BUILD_PAIRING_TRF_SHA256="fb0979a5546cbcea4f5c6fa9ece23aa21ba1185c402db0eb4443ad4fdbcca8ce"


def run(cmd,cwd=None):
    p=subprocess.run(cmd,cwd=cwd,text=True,capture_output=True)
    if p.returncode:
        raise RuntimeError(f"command failed {p.returncode}: {' '.join(map(str,cmd))}\nstdout:\n{p.stdout}\nstderr:\n{p.stderr}")
    return p


def ascii_text(v):
    import unicodedata
    s=unicodedata.normalize('NFD',str(v or ''))
    s=''.join(c for c in s if not unicodedata.combining(c))
    s=''.join(c if 0x20<=ord(c)<=0x7e else '?' for c in s)
    return re.sub(r'\s+',' ',s).strip()


def norm_result(v): return re.sub(r'\s+','',str(v or '')).upper()

def points_for(code,override=None):
    if override is not None: return float(override)
    if code in {'1','+','U','F','W'}: return 1.0
    if code in {'=','H','D'}: return 0.5
    return 0.0


def build_state(fx):
    t=fx['tournament']; pab=float(t.get('regulations',{}).get('pabPoints',1) or 0)
    rows=[]; bykey={}; byno={}
    for p in sorted(t['players'],key=lambda x:int(x.get('pairingNumber') or x.get('pairingNo') or 0)):
        pid=int(p.get('pairingNumber') or p.get('pairingNo'))
        key=str(p.get('localKey') or p.get('key') or f'p{pid}')
        row={'id':pid,'key':key,'name':p.get('name',''),'rating':int(p.get('rating') or 0),
             'joinedFromRound':max(1,int(p.get('joinedFromRound') or 1)),'rounds':[], 'score':0.0}
        rows.append(row); byno[pid]=row
        aliases={key,str(pid),f'pn:{pid}',f'pairing:{pid}',f'pairingNumber:{pid}'}
        fid=str(p.get('fideId') or '').strip()
        if fid and fid!='-': aliases|={fid,'fid:'+fid}
        for a in aliases: bykey[a]=row
    def add(row,r,opp,color,result,played,kind,override=None):
        while len(row['rounds'])<r: row['rounds'].append(None)
        rec={'opp':opp,'color':color,'result':result,'played':played,'kind':kind}
        if override is not None: rec['points']=float(override)
        row['rounds'][r-1]=rec
        row['score']+=points_for(result,override)
    maxr=int(t.get('settings',{}).get('rounds') or 7)
    for row in rows:
        for r in range(1,min(row['joinedFromRound'],maxr+1)):
            add(row,r,0,'-','Z',False,'late-entry',0)
    for r in range(1,maxr+1):
        boards=t.get('pairings',{}).get('liveBoards',{}).get(str(r))
        if not boards: continue
        for b in boards:
            wk=str(b.get('whiteKey') or '').strip(); bk=str(b.get('blackKey') or '').strip()
            w=bykey.get(wk) if wk else None; bl=bykey.get(bk) if bk else None
            res=norm_result(b.get('result'))
            if w and bl:
                if res in {'1-0','1:0'}: wr,br,played,kind='1','0',True,'played'
                elif res in {'0-1','0:1'}: wr,br,played,kind='0','1',True,'played'
                elif res in {'½-½','1/2-1/2','0.5-0.5','='}: wr,br,played,kind='=','=',True,'played'
                elif res in {'1F-0F','+:-','+--'}: wr,br,played,kind='+','-',False,'forfeit'
                elif res in {'0F-1F','-:+','--+'}: wr,br,played,kind='-','+',False,'forfeit'
                elif res in {'0F-0F','-:-'}: wr,br,played,kind='-','-',False,'forfeit'
                else: continue
                add(w,r,bl['id'],'w',wr,played,kind); add(bl,r,w['id'],'b',br,played,kind)
            else:
                one=w or bl
                if not one: continue
                if res in {'1BYE','FULLBYE'}: add(one,r,0,'-','F',False,'full-bye',1)
                elif res=='PAB': add(one,r,0,'-','U',False,'pairing-bye',pab)
                elif res in {'½BYE','1/2BYE','0.5BYE'}: add(one,r,0,'-','H',False,'half-bye',.5)
                elif res=='0BYE': add(one,r,0,'-','Z',False,'zero-bye',0)
    return rows


def score_history(rounds,completed):
    score=0.0
    for rd in rounds[:completed]:
        if not rd: continue
        code=str(rd.get('result') or ' ')[:1]; kind=str(rd.get('kind') or '').lower()
        if rd.get('points') is not None and (kind=='pairing-bye' or code in {'F','U'}): score+=float(rd['points']); continue
        if code in {'1','+','F','U','W'}: score+=1
        elif code in {'=','H','D'}: score+=.5
    return score


def round_field(rd):
    if not rd: return ' '*10
    opp=int(rd.get('opp') or 0); o=f'{opp:4d}'[-4:] if opp>0 else '0000'
    c=rd.get('color') if rd.get('color') in {'w','b'} else '-'
    result=str(rd.get('result') or ' ')[:1]; kind=str(rd.get('kind') or '').lower()
    if result=='F' and (kind in {'pairing-bye','pab'} or not kind): result='U'
    return f'{o} {c} {result}  '


def serialize(fx):
    t=fx['tournament']; completed=int(fx.get('completed') or 0); total=int(t.get('settings',{}).get('rounds') or 7)
    pab=float(t.get('regulations',{}).get('pabPoints',1) or 0)
    lines=[f"012 {ascii_text(fx.get('name') or 'Tournament')}",f'142 {total}',f"152 {'B' if str(fx.get('topColor','w')).lower()=='b' else 'W'}",
           f'162  W 1.0    D 0.5    L 0.0    A 0.0    P {pab:.1f}','192 FIDE_DUTCH_2025']
    for p in build_state(fx):
        history=''.join(round_field(p['rounds'][i] if i<len(p['rounds']) else None) for i in range(completed))
        line='001'+str(p['id']).rjust(5)+'      '+ascii_text(p['name'])[:33].ljust(33)+' '+str(max(0,p['rating'])).rjust(4)+' '*28+f'{score_history(p["rounds"],completed):.1f}'.rjust(4)+str(p['id']).rjust(5)+'  '+history
        lines.append(line)
    return '\r\n'.join(lines)+'\r\n'


def make_players(n):
    return [{'name':f'Player {i:03d}','rating':2305-i*7,'fed':'BUL','fideId':str(2900000+i),'birth':'1990/01/01','gender':'M','pairingNumber':i,'localKey':f'p{i}','joinedFromRound':1} for i in range(1,n+1)]

def fixture(name,n,rounds):
    return {'name':name,'topColor':'w','completed':0,'tournament':{'settings':{'rounds':str(rounds)},'regulations':{'pabPoints':'1'},'players':make_players(n),'pairings':{'liveBoards':{},'engine':{'lastGeneratedRound':0}}}}


def pair(python,gacrux,trf,r,total,unpaired=()):
    out=trf.with_suffix('.pair.txt'); cmd=[python,str(gacrux/'pairingchecker.py'),'-p','-m','dutch','-i',str(trf),'-o',str(out),'-f','TRF','-F','JSON','-d','T','-n',str(r),'-N',str(total),'-t','W','-x','weighted']
    u=list(dict.fromkeys(int(x) for x in unpaired if int(x)>0))
    if u: cmd+=['-u',*map(str,u)]
    run(cmd,gacrux); lines=[x.strip() for x in out.read_text().splitlines() if x.strip()]; n=int(lines[0]); result=[]
    for x in lines[1:1+n]:
        m=re.fullmatch(r'(\d+)\s+(\d+)',x)
        if not m: raise RuntimeError('bad Gacrux pair line '+x)
        result.append((int(m.group(1)),int(m.group(2))))
    return result


def check_pairing(python,gacrux,trf,r,total):
    out=trf.with_suffix('.check.txt'); cmd=[python,str(gacrux/'pairingchecker.py'),'-c','-m','dutch','-i',str(trf),'-o',str(out),'-f','TRF','-F','JSON','-n',str(r),'-N',str(total),'-t','W','-x','weighted','-d','T']
    run(cmd,gacrux); text=out.read_text()
    if not re.search(r'^Check:\s*True\s*$',text,re.M|re.I): raise RuntimeError(f'Gacrux checker rejected R{r}:\n{text[-2500:]}')


def result_for(r,b): return ('1 - 0','0 - 1','½ - ½')[(r+b)%3]

def apply(fx,r,pairs,double_forfeit=False):
    by={int(p['pairingNumber']):p for p in fx['tournament']['players']}; seen=set(); boards=[]; pabs=0
    for b,(w,bl) in enumerate(pairs,1):
        if w in seen or w not in by: raise RuntimeError('duplicate/unknown white')
        seen.add(w)
        if bl==0: pabs+=1; boards.append({'board':b,'whiteKey':by[w]['localKey'],'blackKey':'','result':'PAB'}); continue
        if bl in seen or bl not in by: raise RuntimeError('duplicate/unknown black')
        seen.add(bl); boards.append({'board':b,'whiteKey':by[w]['localKey'],'blackKey':by[bl]['localKey'],'result':'0F-0F' if double_forfeit and b==1 else result_for(r,b)})
    if pabs>1: raise RuntimeError(f'{pabs} PABs in R{r}')
    fx['tournament']['pairings']['liveBoards'][str(r)]=boards; fx['completed']=r
    return pabs

@dataclass
class Case: name:str; players:int; rounds:int; checks:int; pabs:int; unpaired_regenerations:int=0


def normal_case(name,n,rounds,python,gacrux,double_forfeit=False):
    fx=fixture(name,n,rounds); history=set(); checks=0; pabs=0
    with tempfile.TemporaryDirectory() as td:
        d=Path(td)
        for r in range(1,rounds+1):
            before=d/f'b{r}.trf'; before.write_text(serialize(fx),encoding='ascii',newline='')
            a=pair(python,gacrux,before,r,rounds); b=pair(python,gacrux,before,r,rounds)
            if a!=b: raise RuntimeError(f'non-deterministic pairing R{r}')
            for w,bl in a:
                if bl:
                    k=frozenset((w,bl))
                    if k in history: raise RuntimeError(f'repeated opponents {w}-{bl} R{r}')
                    history.add(k)
            pabs+=apply(fx,r,a,double_forfeit=(double_forfeit and r==2))
            after=d/f'a{r}.trf'; after.write_text(serialize(fx),encoding='ascii',newline=''); check_pairing(python,gacrux,after,r,rounds); checks+=1
    return Case(name,n,rounds,checks,pabs)


def late_entry_case(python,gacrux):
    fx=fixture('late-entry-admin-bye',14,5); pabs=0; checks=0
    with tempfile.TemporaryDirectory() as td:
        d=Path(td); before=d/'b1.trf'; before.write_text(serialize(fx),encoding='ascii',newline=''); ps=pair(python,gacrux,before,1,5); pabs+=apply(fx,1,ps)
        after=d/'a1.trf'; after.write_text(serialize(fx),encoding='ascii',newline=''); check_pairing(python,gacrux,after,1,5); checks+=1
        p=make_players(15)[-1]; p['joinedFromRound']=2; fx['tournament']['players'].append(p); fx['tournament']['pairings']['liveBoards']['1'].append({'board':99,'whiteKey':p['localKey'],'blackKey':'','result':'1 BYE','manualLateEntryBye':True})
        txt=serialize(fx); line=next(x for x in txt.splitlines() if x.startswith('001') and int(x[4:9])==15)
        if line[96]!='-' or line[98]!='F': raise RuntimeError('late-entry full bye is not F')
        if sum(1 for x in txt.splitlines() if x.startswith('001') and len(x)>98 and x[96]=='-' and x[98]=='U')>1: raise RuntimeError('multiple U after late entry')
        for r in range(2,6):
            before=d/f'b{r}.trf'; before.write_text(serialize(fx),encoding='ascii',newline=''); ps=pair(python,gacrux,before,r,5); pabs+=apply(fx,r,ps); after=d/f'a{r}.trf'; after.write_text(serialize(fx),encoding='ascii',newline=''); check_pairing(python,gacrux,after,r,5); checks+=1
    return Case('late-entry-admin-bye',15,5,checks,pabs)


def unpaired_case(python,gacrux):
    fx=fixture('intentional-unpaired',16,4); pabs=0; checks=0; regen=0
    with tempfile.TemporaryDirectory() as td:
        d=Path(td)
        for r in range(1,5):
            before=d/f'b{r}.trf'; before.write_text(serialize(fx),encoding='ascii',newline=''); u=[16] if r==2 else []
            a=pair(python,gacrux,before,r,4,u); b=pair(python,gacrux,before,r,4,u)
            if a!=b: raise RuntimeError('unpaired regeneration mismatch')
            if u and any(16 in x for x in a): raise RuntimeError('explicitly unpaired player was paired')
            if u: regen+=1
            pabs+=apply(fx,r,a)
            if u:
                p=fx['tournament']['players'][15]; fx['tournament']['pairings']['liveBoards'][str(r)].append({'board':99,'whiteKey':p['localKey'],'blackKey':'','result':'0 BYE'})
            after=d/f'a{r}.trf'; after.write_text(serialize(fx),encoding='ascii',newline='')
            if not u: check_pairing(python,gacrux,after,r,4); checks+=1
    return Case('intentional-unpaired',16,4,checks,pabs,regen)


def detect_version(gacrux):
    text=(gacrux/'version.py').read_text()
    if '1.9.57' not in text: raise RuntimeError('Gacrux source is not 1.9.57')


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--gacrux',type=Path,required=True); ap.add_argument('--report',type=Path); args=ap.parse_args(); detect_version(args.gacrux)
    py=sys.executable
    cases=[normal_case('even-16x7',16,7,py,args.gacrux),normal_case('odd-15x7',15,7,py,args.gacrux),normal_case('double-forfeit-16x5',16,5,py,args.gacrux,True),late_entry_case(py,args.gacrux),unpaired_case(py,args.gacrux)]
    report={'status':'PASS','chessPublisher':'1.05.00-RC26','rc26HtmlSha256':RC26_HTML_SHA256,'rc26BuildPairingEngineTRFSha256':RC26_BUILD_PAIRING_TRF_SHA256,'gacruxVersion':GACRUX_VERSION,'gacruxCommit':GACRUX_COMMIT,'cases':[asdict(x) for x in cases],'totalRounds':sum(x.rounds for x in cases),'totalCheckTrue':sum(x.checks for x in cases)}
    text=json.dumps(report,indent=2)+'\n'; print(text)
    if args.report: args.report.parent.mkdir(parents=True,exist_ok=True); args.report.write_text(text)
if __name__=='__main__': main()
