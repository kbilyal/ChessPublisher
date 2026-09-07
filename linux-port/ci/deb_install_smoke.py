#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,os,signal,subprocess,sys,tempfile,time,urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BUILDER=ROOT/'packaging'/'build_deb.py'
PACKAGE='chess-publisher'

def sha(data:bytes)->str:return hashlib.sha256(data).hexdigest()

def run(cmd:list[str],**kwargs)->subprocess.CompletedProcess[str]:
    print('$',' '.join(cmd),flush=True)
    return subprocess.run(cmd,text=True,check=True,**kwargs)

def main()->int:
    with tempfile.TemporaryDirectory(prefix='cp-deb-install-') as td_raw:
        td=Path(td_raw);source=td/'source';out=td/'out';source.mkdir();out.mkdir()
        html=b'<!doctype html><html><body>Chess-Publisher CI install smoke Tournament Setup Pairings Chess-Results Registration DGT</body></html>\n'
        (source/'ChessPublisher.html').write_bytes(html)
        manifest=td/'source_manifest.json'
        manifest.write_text(json.dumps({'schema':1,'snapshotId':'ci-deb-install-smoke','baseRelease':'ci','files':{'ChessPublisher.html':{'size':len(html),'sha256':sha(html)}}},indent=2)+'\n',encoding='utf-8')
        run([sys.executable,str(BUILDER),'--source',str(source),'--output-dir',str(out),'--manifest',str(manifest)])
        debs=list(out.glob('*.deb'))
        if len(debs)!=1:raise RuntimeError('builder did not produce exactly one deb')
        deb=debs[0];proc=None
        try:
            run(['sudo','apt-get','update','-qq'])
            run(['sudo','apt-get','install','-y',str(deb)])
            info=run(['dpkg-query','-W','-f=${Status} ${Version}\n',PACKAGE],capture_output=True).stdout.strip()
            if not info.startswith('install ok installed '):raise RuntimeError('dpkg does not report package installed')
            env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'}
            st=run(['/usr/bin/chess-publisher-self-test','--json'],capture_output=True,env=env).stdout
            result=json.loads(st)
            if result.get('ok') is not True or result.get('failed')!=0:raise RuntimeError('installed self-test did not pass')
            names={row.get('name'):row for row in result.get('tests',[])}
            if names.get('http-delivery',{}).get('status')!='PASS':raise RuntimeError('installed HTTP-delivery self-test did not pass')
            online=run(['/usr/bin/chess-publisher-self-test','--online-engines','--json'],capture_output=True,env=env).stdout
            online_result=json.loads(online)
            if online_result.get('ok') is not True or online_result.get('failed')!=0:raise RuntimeError('installed online-engine self-test did not pass')
            online_names={row.get('name'):row for row in online_result.get('tests',[])}
            detail=online_names.get('online-engines',{}).get('detail',{})
            if online_names.get('online-engines',{}).get('status')!='PASS' or detail.get('gacrux')!='1.9.57' or detail.get('bbp')!='6.0.0':raise RuntimeError('installed package did not prepare pinned Gacrux/BBP engines')
            live=subprocess.run(['/usr/bin/chess-publisher-live-test','--data-home',str(td/'live-empty'),'--json'],text=True,capture_output=True,timeout=15,check=False,env=env)
            if live.returncode!=2:raise RuntimeError(f'installed live-test did not fail closed without token rc={live.returncode}')
            live_result=json.loads(live.stdout);live_row=live_result.get('tests',[{}])[0]
            if live_row.get('status')!='BLOCKED' or 'Organizer Token' not in str(live_row.get('error')):raise RuntimeError('installed live-test missing-token contract failed')
            data_home=td/'data';port='18769'
            proc=subprocess.Popen(['/usr/bin/chess-publisher','--no-browser','--quiet','--port',port,'--data-home',str(data_home)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
            health=None
            for _ in range(50):
                if proc.poll() is not None:break
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=.4) as r:health=json.load(r)
                    if health.get('ok'):break
                except Exception:time.sleep(.15)
            if not isinstance(health,dict) or health.get('ok') is not True:
                stdout,stderr=proc.communicate(timeout=2) if proc.poll() is not None else ('','')
                raise RuntimeError(f'installed LocalEngine health failed stdout={stdout[-1000:]} stderr={stderr[-1000:]}')
            if health.get('appBuild')!='1.06.00-beta.34-linux-dev.7' or health.get('engineVersion')!='0.6.0-linux-dev':raise RuntimeError(f'installed build identity mismatch: {health}')
            print(json.dumps({'installed':True,'selfTestPassed':True,'httpDeliverySelfTest':True,'onlineEnginesPassed':True,'liveTestFailClosed':True,'health':health},indent=2))
        finally:
            if proc is not None and proc.poll() is None:
                proc.send_signal(signal.SIGTERM)
                try:proc.wait(timeout=4)
                except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=2)
            subprocess.run(['sudo','apt-get','purge','-y',PACKAGE],text=True,check=False,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        leftovers=[Path('/usr/bin/chess-publisher'),Path('/usr/bin/chess-publisher-self-test'),Path('/usr/bin/chess-publisher-live-test'),Path('/opt/chess-publisher'),Path('/usr/share/applications/chess-publisher.desktop')]
        existing=[str(p) for p in leftovers if p.exists()]
        if existing:raise RuntimeError(f'package purge left managed files behind: {existing}')
        print('LINUX_DEB_INSTALL_PURGE_SMOKE=PASS')
    return 0

if __name__=='__main__':raise SystemExit(main())
