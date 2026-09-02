import base64, hashlib, io, lzma, shutil, subprocess, sys, tarfile, tempfile, zipfile
from pathlib import Path

EXPECTED_BASE_ZIP='316eadb9c2f12ea2021ffbc3852c81614140daf55015e00992cd59974336fa20'
EXPECTED_BASE_EXE='5af57ede202f1e65c8fc2e2356af5c6961bd6902006269a7f8b64ffb08accacf'
EXPECTED_DELTA_XZ='380afc02ac9de75000d74ef3ee37a707f6d7cf74e2f5dba6cbe9b3339b653a24'
EXPECTED_RC26_ZIP='bb9db32b002a46dbf9a67cfd4cbe416c0c2555923cceff246a37fe55ead0e84c'
EXPECTED_OLD_PAYLOAD='6fcf4d0c4ad5c1ae6ac49135585973ffc956913c4d21f21afa45dea8ae766127'
EXPECTED_INSTALLER='bf4e5c787c9eab8150a95b47648ab5bf302a2a5f32705bfb022b1d3103dc85bd'
EXPECTED_UNINSTALL='3bc77a4b05dc1775383fc8723f7d6036b67e1f83257cfec72dcd32e11ea40b21'

PATCHES=[(134,10),(161,238),(162,173),(163,1),(209,160),(210,209),(211,1),(752,46),(753,99),(754,112),(755,122),(756,105),(757,112),(760,58),(761,58),(762,215),(765,96),(766,250),(769,60),(770,215),(773,100),(774,245),(788,64),(791,192),(1073832,53),(1073835,48),(1117018,53),(1117021,48),(1118611,53),(1118614,48),(15961824,0),(15961825,96),(15961826,58),(15961827,1),(15961832,58),(15961833,58),(15961834,215),(15961840,58),(15961841,58),(15961842,215),(16080786,53),(16080789,48)]
TIME54={'ChessPublisher-LocalEngine.ps1','ChessPublisher-WebView.ps1','ChessPublisher.html','GACRUX-TIEBREAK-MAPPING-AUDIT-v1.05.00-RC26.txt','HUB-BETA-README.txt','RC26-WINDOWS-TIEBREAK-ACCEPTANCE.txt','README-WEBVIEW.txt','README.txt','TIEBREAK-SETTINGS-MATRIX-v1.05.00-RC26.txt','VERSION.txt','WEBVIEW-VERSION.txt','hub/client/hub-api-client.js','webview/HubAdapter.js'}
TIME56={'CHANGELOG-v1.05.00-RC26-2026-09-01.txt','PACKAGE-FILE-SHA256.txt','PROJECT-STATE.md','PROTECTED-CORE-SHA256.txt','RC26-TEST-REPORT.txt','REGRESSION-MANIFEST.json','RELEASE-GATE-REPORT.txt','SEPTEMBER-RELEASE-GATE.txt','START-HERE.txt'}
EXCLUDE_OLD={'PACKAGE-FILE-SHA256.txt','RC26-TEST-REPORT.txt','RELEASE-GATE-REPORT.txt','SEPTEMBER-RELEASE-GATE.txt'}

def sha256(x):
    if isinstance(x,(bytes,bytearray)): return hashlib.sha256(x).hexdigest()
    h=hashlib.sha256()
    with open(x,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def check(path, expected, label):
    got=sha256(path)
    if got!=expected: raise SystemExit(f'{label} SHA256 mismatch: {got}')
    print(f'PASS {label}: {got}')

def clone_info(src,name):
    z=zipfile.ZipInfo(name,src.date_time); z.compress_type=src.compress_type; z.comment=src.comment; z.extra=src.extra; z.create_system=src.create_system; z.create_version=src.create_version; z.extract_version=src.extract_version; z.flag_bits=src.flag_bits; z.volume=src.volume; z.internal_attr=src.internal_attr; z.external_attr=src.external_attr
    return z

def main():
    if len(sys.argv)!=5: raise SystemExit('usage: promote_v10500.py <base.zip> <base.exe> <parts_dir> <output_dir>')
    base_zip=Path(sys.argv[1]).resolve(); base_exe=Path(sys.argv[2]).resolve(); parts=Path(sys.argv[3]).resolve(); out=Path(sys.argv[4]).resolve(); out.mkdir(parents=True,exist_ok=True)
    check(base_zip,EXPECTED_BASE_ZIP,'v1.04.02 transport ZIP'); check(base_exe,EXPECTED_BASE_EXE,'v1.04.02 custom installer')
    b64=''
    for i in range(10):
        p=parts/f'part{i:02d}.b64'
        if not p.exists(): raise SystemExit(f'missing delta part: {p}')
        s=p.read_text(encoding='ascii').strip()
        if i in (0,7):
            if len(s)<18000: raise SystemExit(f'{p.name} shorter than 18000')
            s=s[:18000]
        b64+=s
    xz=base64.b64decode(b64,validate=True)
    if sha256(xz)!=EXPECTED_DELTA_XZ: raise SystemExit(f'delta XZ mismatch: {sha256(xz)}')
    print(f'PASS RC26 delta transport: {sha256(xz)}')
    with tempfile.TemporaryDirectory() as td:
        td=Path(td); work=td/'work'; delta=td/'delta'; work.mkdir(); delta.mkdir()
        with zipfile.ZipFile(base_zip,'r') as z: z.extractall(work)
        with tarfile.open(fileobj=io.BytesIO(lzma.decompress(xz)),mode='r:') as tf: tf.extractall(delta,filter='data')
        subprocess.run([sys.executable,str(delta/'apply_delta.py'),str(delta),str(work)],check=True)
        rc26=td/'rc26.zip'; prefix='Chess-Publisher-v1.05.00-RC26/'
        rels=sorted(p.relative_to(work).as_posix() for p in work.rglob('*') if p.is_file())
        if len(rels)!=113: raise SystemExit(f'expected 113 RC26 files, got {len(rels)}')
        with zipfile.ZipFile(rc26,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
            for rel in rels:
                dt=(2026,9,1,14,49,54) if rel in TIME54 else (2026,9,1,14,49,56) if rel in TIME56 else (2026,9,1,13,58,46)
                zi=zipfile.ZipInfo(prefix+rel,dt); zi.compress_type=zipfile.ZIP_DEFLATED; zi.create_system=3; zi.external_attr=2175008768; zi.flag_bits=0
                z.writestr(zi,(work/rel).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
        check(rc26,EXPECTED_RC26_ZIP,'exact RC26 portable ZIP')
        uninstall=work/'Uninstall ChessPublisher.exe'
        if not uninstall.exists():
            with zipfile.ZipFile(base_zip,'r') as z: uninstall.write_bytes(z.read('Uninstall ChessPublisher.exe'))
        if sha256(uninstall)!=EXPECTED_UNINSTALL: raise SystemExit('uninstaller hash mismatch')
        payload=td/'oldstyle-payload.zip'
        with zipfile.ZipFile(rc26,'r') as src, zipfile.ZipFile(payload,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as dst:
            for info in src.infolist():
                rel=info.filename[len(prefix):]
                if rel.startswith('HISTORY/') or rel.startswith('RELEASE-PACKAGING/') or rel in EXCLUDE_OLD: continue
                dst.writestr(clone_info(info,rel),src.read(info),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
            ui=zipfile.ZipInfo('Uninstall ChessPublisher.exe',(2026,9,1,0,0,0)); ui.compress_type=zipfile.ZIP_DEFLATED; ui.create_system=3; ui.create_version=20; ui.extract_version=20; ui.external_attr=2179792896; ui.flag_bits=0
            dst.writestr(ui,uninstall.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
        check(payload,EXPECTED_OLD_PAYLOAD,'legacy RC26 installer payload')
        exe=bytearray(base_exe.read_bytes())
        for off,val in PATCHES: exe[off]=val
        exe+=payload.read_bytes(); exe+=b'\0'*454
        if sha256(exe)!=EXPECTED_INSTALLER: raise SystemExit(f'installer mismatch: {sha256(exe)}')
        stable_exe=out/'chess-publisher-v1.05.00-2026-09-02.exe'; stable_zip=out/'chess-publisher-v1.05.00-2026-09-02.zip'; stable_sha=out/'chess-publisher-v1.05.00-2026-09-02-SHA256.txt'
        stable_exe.write_bytes(exe); shutil.copyfile(rc26,stable_zip); stable_sha.write_text(f'{EXPECTED_INSTALLER}  {stable_exe.name}\n{EXPECTED_RC26_ZIP}  {stable_zip.name}\n',encoding='ascii')
        check(stable_exe,EXPECTED_INSTALLER,'Stable installer'); check(stable_zip,EXPECTED_RC26_ZIP,'Stable portable ZIP'); print('PASS v1.05.00 stable promotion artifacts')

if __name__=='__main__': main()
