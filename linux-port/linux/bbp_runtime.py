#!/usr/bin/env python3
"""Verified bbpPairings 6.0.0 independent checker for Chess-Publisher Linux."""
from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BBP_VERSION = "6.0.0"
RELEASE_TAG = "v6.0.0"
REPOSITORY = "https://github.com/BieremaBoyzProgramming/bbpPairings"
MAX_ARCHIVE_BYTES = 4 * 1024 * 1024
MAX_TRF_BYTES = 8 * 1024 * 1024
TIMEOUT_SECONDS = 45

ASSETS = {
    "x86_64": {
        "name": "bbpPairings-v6.0.0-x86_64-pc-linux.tar.gz",
        "url": "https://github.com/BieremaBoyzProgramming/bbpPairings/releases/download/v6.0.0/bbpPairings-v6.0.0-x86_64-pc-linux.tar.gz",
        "sha256": "bffd2d5a4dc9d86eb3d9886339e8ca446d88683f77559f0889ea0d2040e7d827",
    },
    "i386": {
        "name": "bbpPairings-v6.0.0-i386-pc-linux.tar.gz",
        "url": "https://github.com/BieremaBoyzProgramming/bbpPairings/releases/download/v6.0.0/bbpPairings-v6.0.0-i386-pc-linux.tar.gz",
        "sha256": "a1bb9b8813bffaf67a82a915d5841ff7a24bf98acf7c883f2022f12e8532a6f2",
    },
}


class BBPError(RuntimeError):
    pass


def _sha256_file(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def _arch_key() -> str:
    machine=platform.machine().lower()
    if machine in {"x86_64","amd64"}: return "x86_64"
    if machine in {"i386","i486","i586","i686","x86"}: return "i386"
    return ""


@dataclass(frozen=True)
class BBPStatus:
    ready: bool
    executable: Path|None
    message: str
    arch: str
    executable_sha256: str=""
    def as_dict(self)->dict[str,Any]:
        return {"ok":True,"ready":self.ready,"available":self.ready,"installed":self.ready,
                "checker":"bbpPairings","version":BBP_VERSION,"arch":self.arch,
                "executable":str(self.executable) if self.executable else "",
                "executableSha256":self.executable_sha256,"message":self.message}


class BBPRuntime:
    def __init__(self, install_dir: Path):
        self.install_dir=install_dir.expanduser().resolve()
        self.marker=self.install_dir/'verification.json'

    def status(self)->BBPStatus:
        arch=_arch_key()
        if not arch:
            return BBPStatus(False,None,f"bbpPairings {BBP_VERSION} has no prepared Linux asset for architecture {platform.machine()}.","")
        try: marker=json.loads(self.marker.read_text(encoding='utf-8'))
        except Exception: marker={}
        exe_path=Path(str(marker.get('executable') or '')) if marker.get('executable') else None
        if exe_path and not exe_path.is_absolute(): exe_path=self.install_dir/exe_path
        if not marker or marker.get('version')!=BBP_VERSION or marker.get('assetSha256')!=ASSETS[arch]['sha256']:
            return BBPStatus(False,exe_path,"Verified bbpPairings 6.0.0 Linux asset is not installed.",arch)
        if not exe_path or not exe_path.is_file():
            return BBPStatus(False,exe_path,"bbpPairings executable is missing.",arch)
        got=_sha256_file(exe_path)
        if got!=marker.get('executableSha256'):
            return BBPStatus(False,exe_path,"bbpPairings executable failed SHA256 integrity verification.",arch,got)
        if not os.access(exe_path,os.X_OK):
            try: exe_path.chmod(exe_path.stat().st_mode|0o111)
            except OSError: pass
        return BBPStatus(True,exe_path,"Official bbpPairings 6.0.0 Linux release is ready and SHA256-verified.",arch,got)

    def install(self,timeout:int=45)->dict[str,Any]:
        arch=_arch_key()
        if not arch: raise BBPError(f"bbpPairings {BBP_VERSION} has no official Linux asset for {platform.machine()}.")
        asset=ASSETS[arch]
        req=urllib.request.Request(asset['url'],headers={'User-Agent':'Chess-Publisher-Linux-bbpPairings/6.0.0','Accept':'application/gzip'})
        try:
            with urllib.request.urlopen(req,timeout=timeout) as resp: data=resp.read(MAX_ARCHIVE_BYTES+1)
        except Exception as exc: raise BBPError(f"Could not download official bbpPairings 6.0.0 Linux asset: {exc}") from exc
        if len(data)>MAX_ARCHIVE_BYTES: raise BBPError('bbpPairings archive exceeds the safety limit.')
        digest=hashlib.sha256(data).hexdigest()
        if digest!=asset['sha256']:
            raise BBPError(f"bbpPairings 6.0.0 archive SHA256 mismatch: expected {asset['sha256']}, got {digest}.")
        with tempfile.TemporaryDirectory(prefix='cp-bbp-install-') as td:
            tar_path=Path(td)/'bbp.tar.gz'; tar_path.write_bytes(data)
            extract=Path(td)/'extract'; extract.mkdir()
            with tarfile.open(tar_path,'r:gz') as tf:
                for member in tf.getmembers():
                    pp=Path(member.name)
                    if pp.is_absolute() or '..' in pp.parts or member.issym() or member.islnk():
                        raise BBPError('Unsafe path in bbpPairings release archive.')
                tf.extractall(extract,filter='data')
            candidates=[p for p in extract.rglob('*') if p.is_file() and p.name.lower() in {'bbppairings','bbppairings.exe'}]
            if not candidates:
                candidates=[p for p in extract.rglob('*') if p.is_file() and p.name.lower().startswith('bbppairings') and not p.name.endswith(('.txt','.md'))]
            if not candidates: raise BBPError('bbpPairings executable was not found in official release archive.')
            exe_src=sorted(candidates,key=lambda p:len(p.parts))[0]
            self.install_dir.mkdir(parents=True,exist_ok=True)
            exe=self.install_dir/'bbpPairings.exe'
            staged=self.install_dir/'.bbpPairings.exe.new'; shutil.copy2(exe_src,staged); staged.chmod(staged.stat().st_mode|0o755); os.replace(staged,exe)
            exe_sha=_sha256_file(exe)
            marker={'repository':REPOSITORY,'release':RELEASE_TAG,'version':BBP_VERSION,'arch':arch,
                    'assetName':asset['name'],'assetSha256':asset['sha256'],'executable':'bbpPairings.exe','executableSha256':exe_sha}
            tmp=self.install_dir/'.verification.json.new'; tmp.write_text(json.dumps(marker,indent=2,sort_keys=True)+'\n',encoding='utf-8'); os.replace(tmp,self.marker)
        status=self.status()
        if not status.ready: raise BBPError('bbpPairings installation completed but post-install verification failed.')
        out=status.as_dict(); out['assetSha256']=asset['sha256']; return out

    def _ready_executable(self)->Path:
        status=self.status()
        if not status.ready or not status.executable: raise BBPError(status.message)
        return status.executable

    @staticmethod
    def _validate_trf(trf:Any)->str:
        text=str(trf or '')
        if not text.strip(): raise BBPError('BBP independent checker input TRF is empty.')
        if len(text.encode('utf-8'))>MAX_TRF_BYTES: raise BBPError('BBP independent checker input TRF exceeds safety limit.')
        return text

    @staticmethod
    def _temporary_checker_trf(text:str,round_no:int=0,unpaired:list[int]|None=None)->str:
        # Keep all compatibility mutations inside the disposable checker copy.
        # 1) BBP 6.0.0 still expects legacy Z (not canonical TRF26 A) in 162.
        # 2) Future/current-round exclusions are represented with TRF 240.
        #    BBP explicitly treats 240 as a future-round bye when invoked with
        #    -p; adding a future 001 block would incorrectly increase playedRounds.
        wanted=set()
        for value in (unpaired or []):
            try: pid=int(value)
            except (TypeError,ValueError): continue
            if pid>0: wanted.add(pid)
        out=[]
        for line in text.replace('\r\n','\n').replace('\r','\n').split('\n'):
            if line.startswith('162'):
                line=re.sub(r'(?<=\s)A(?=\s+[-+]?\d)', 'Z', line, count=1)
            out.append(line)
        if wanted and round_no>0:
            # Syntax follows BBP TRF parser: 240 Z rrr pppp pppp ...
            out.append(f"240 Z {int(round_no):3d}"+''.join(f" {pid:4d}" for pid in sorted(wanted)))
        return '\n'.join(out)

    @staticmethod
    def parse_pairing_text(output:str)->list[tuple[int,int]]:
        lines=[x.strip() for x in str(output or '').replace('\r','').split('\n') if x.strip()]
        if not lines or not re.fullmatch(r'\d+',lines[0]): raise BBPError('BBP independent checker returned invalid pairing output.')
        count=int(lines[0]); pairs=[]
        if count<1 or count>1000 or len(lines)<count+1: raise BBPError('BBP independent checker pair count is invalid.')
        for line in lines[1:count+1]:
            m=re.fullmatch(r'\s*(\d+)\s+(\d+)\s*',line)
            if not m: raise BBPError('BBP independent checker returned an invalid pair line.')
            pairs.append((int(m.group(1)),int(m.group(2))))
        return pairs

    def generate(self,trf:Any,round_no:int=0,unpaired:list[int]|None=None,timeout:int=TIMEOUT_SECONDS)->dict[str,Any]:
        text=self._temporary_checker_trf(self._validate_trf(trf),round_no,unpaired); exe=self._ready_executable()
        with tempfile.TemporaryDirectory(prefix='cp-bbp-check-') as td:
            inp=Path(td)/'checker.trf'; out=Path(td)/'pairs.txt'; inp.write_text(text,encoding='utf-8',newline='')
            cmd=[str(exe),'--dutch',str(inp),'-p',str(out)]
            try: proc=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout,check=False)
            except subprocess.TimeoutExpired as exc: raise BBPError(f'BBP independent checker timed out after {timeout} seconds.') from exc
            if proc.returncode!=0:
                detail=(proc.stderr or proc.stdout or '').strip()[-1200:]
                raise BBPError(f'BBP independent checker exited with code {proc.returncode}. {detail}'.strip())
            if not out.is_file(): raise BBPError('BBP independent checker did not create a pairing output file.')
            raw=out.read_text(encoding='utf-8',errors='replace'); pairs=self.parse_pairing_text(raw)
            return {'output':raw,'pairs':pairs,'stderr':proc.stderr,'command':cmd}

    def verify(self,trf:Any,expected_pairs:list[tuple[int,int]],round_no:int,unpaired:list[int]|None=None)->dict[str,Any]:
        status=self.status()
        base={"round":int(round_no),"checker":"bbpPairings","version":BBP_VERSION}
        if not status.ready:
            return {**base,"state":"unavailable","available":False,"ok":False,"check":None,"message":status.message}
        try:
            got=self.generate(trf,round_no,unpaired)
            actual=got['pairs']
            # Board order is not a Dutch-rule identity requirement; white/black identity is.
            expected_sorted=sorted((int(w),int(b)) for w,b in expected_pairs)
            actual_sorted=sorted((int(w),int(b)) for w,b in actual)
            if expected_sorted!=actual_sorted:
                return {**base,"state":"fail","available":True,"ok":False,"check":False,
                        "message":"BBP Independent Pairing Checker found a concrete pairing discrepancy.",
                        "expected":[list(x) for x in expected_sorted],"actual":[list(x) for x in actual_sorted]}
            return {**base,"state":"pass","available":True,"ok":True,"check":True,
                    "message":"Independent bbpPairings 6.0.0 pairing matches Gacrux."}
        except BBPError as exc:
            return {**base,"state":"error","available":True,"ok":False,"check":None,"message":str(exc)}
