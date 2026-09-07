#!/usr/bin/env python3
"""Install the Linux .deb in a clean official Ubuntu 26.04 container.

This is intentionally dependency-strict: the container receives only the .deb;
APT must resolve everything declared by the package. The installed package then
runs its offline self-test, pinned online-engine verification and fail-closed
live Chess-Results command using Ubuntu's system Python.
"""
from __future__ import annotations
import hashlib,json,shutil,subprocess,sys,tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BUILDER=ROOT/'packaging'/'build_deb.py'
IMAGE='ubuntu:26.04'

def sha(data:bytes)->str:return hashlib.sha256(data).hexdigest()

def run(cmd:list[str],**kwargs)->subprocess.CompletedProcess[str]:
    print('$',' '.join(cmd),flush=True)
    return subprocess.run(cmd,text=True,check=True,**kwargs)

def main()->int:
    if not shutil.which('docker'):raise RuntimeError('Docker is not available on this runner.')
    with tempfile.TemporaryDirectory(prefix='cp-ubuntu2604-') as td_raw:
        td=Path(td_raw);source=td/'source';out=td/'out';source.mkdir();out.mkdir()
        html=b'<!doctype html><html><body>Chess-Publisher Ubuntu 26.04 Tournament Setup Pairings Chess-Results Registration DGT</body></html>\n'
        (source/'ChessPublisher.html').write_bytes(html)
        manifest=td/'source_manifest.json'
        manifest.write_text(json.dumps({'schema':1,'snapshotId':'ci-ubuntu-2604','baseRelease':'ci','files':{'ChessPublisher.html':{'size':len(html),'sha256':sha(html)}}},indent=2)+'\n',encoding='utf-8')
        run([sys.executable,str(BUILDER),'--source',str(source),'--output-dir',str(out),'--manifest',str(manifest)])
        debs=list(out.glob('*.deb'))
        if len(debs)!=1:raise RuntimeError('builder did not produce exactly one deb')
        deb=debs[0]
        shell=r'''set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export PYTHONDONTWRITEBYTECODE=1
. /etc/os-release
printf 'CONTAINER_OS=%s %s\n' "$NAME" "$VERSION_ID"
[ "$VERSION_ID" = "26.04" ]
apt-get update -qq
apt-get install -y /pkg/chess-publisher.deb >/tmp/apt-install.log
/usr/bin/python3 --version
/usr/bin/python3 - <<'PY'
import networkx
print('SYSTEM_NETWORKX='+networkx.__version__)
PY
chess-publisher-self-test --json >/tmp/self.json
/usr/bin/python3 - <<'PY'
import json
x=json.load(open('/tmp/self.json'))
assert x.get('ok') is True and x.get('passed')==6 and x.get('failed')==0,x
names={r.get('name'):r for r in x.get('tests',[])}
assert names.get('http-delivery',{}).get('status')=='PASS',names
print('UBUNTU2604_OFFLINE_SELF_TEST=PASS')
PY
chess-publisher-self-test --online-engines --json >/tmp/online.json
/usr/bin/python3 - <<'PY'
import json
x=json.load(open('/tmp/online.json'))
assert x.get('ok') is True and x.get('passed')==7 and x.get('failed')==0,x
row={r.get('name'):r for r in x.get('tests',[])}['online-engines']
d=row['detail'];assert row['status']=='PASS' and d.get('gacrux')=='1.9.57' and d.get('bbp')=='6.0.0',row
print('UBUNTU2604_PINNED_ENGINES=PASS')
PY
set +e
chess-publisher-live-test --data-home /tmp/cp-live-empty --json >/tmp/live.json
rc=$?
set -e
[ "$rc" -eq 2 ]
/usr/bin/python3 - <<'PY'
import json
x=json.load(open('/tmp/live.json'));r=x['tests'][0]
assert r['status']=='BLOCKED' and 'Organizer Token' in r['error'],r
print('UBUNTU2604_LIVE_FAIL_CLOSED=PASS')
PY
chess-publisher --no-browser --quiet --port 18774 --data-home /tmp/cp-data >/tmp/engine.out 2>/tmp/engine.err &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
/usr/bin/python3 - <<'PY'
import json,time,urllib.request
for _ in range(50):
    try:
        with urllib.request.urlopen('http://127.0.0.1:18774/health',timeout=.4) as r:x=json.load(r)
        if x.get('ok'):break
    except Exception:time.sleep(.1)
else:raise SystemExit('LocalEngine health timeout')
assert x.get('appBuild')=='1.06.00-beta.34-linux-dev.6',x
assert x.get('engineVersion')=='0.5.1-linux-dev',x
print('UBUNTU2604_LOCALENGINE=PASS')
PY
kill "$pid";wait "$pid" || true
trap - EXIT
printf 'UBUNTU_26_04_CONTAINER_SMOKE=PASS\n'
'''
        cp=subprocess.run(['docker','run','--rm','-v',f'{deb}:/pkg/chess-publisher.deb:ro',IMAGE,'bash','-lc',shell],text=True,capture_output=True,timeout=240,check=False)
        if cp.stdout:print(cp.stdout)
        if cp.stderr:print(cp.stderr,file=sys.stderr)
        if cp.returncode!=0:raise RuntimeError(f'Ubuntu 26.04 container smoke failed rc={cp.returncode}')
        if 'UBUNTU_26_04_CONTAINER_SMOKE=PASS' not in cp.stdout:raise RuntimeError('Ubuntu 26.04 PASS marker missing')
    return 0

if __name__=='__main__':raise SystemExit(main())
