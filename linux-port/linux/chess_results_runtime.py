#!/usr/bin/env python3
"""Secure Chess-Results transport for Chess-Publisher Linux.

No official bridge crypto lives here. The Linux LocalEngine sends authenticated
requests to the Chess-Publisher Chess-Results Worker. That Worker is the security
boundary that owns AES/IV, GETSID, GETKEY, secure XML upload and organizer-scoped
TNR ownership.
"""
from __future__ import annotations
import json, os, re, tempfile, time, urllib.error, urllib.request
from pathlib import Path
from typing import Any, Callable

API_PREFIX="https://chess-publisher-chess-results.kyamranbilyal.workers.dev/api/chess-results/"
WEB_ORIGIN="https://web.chess-publisher.org"
ORGANIZER_SECRET_KEY="organizer-primary"
TIMEOUT=60
MAX_BODY_BYTES=12*1024*1024
ALLOWED={"test","create","claim","publish","admin-link","delete-authorize","unlink"}

class ChessResultsRuntimeError(RuntimeError):pass

def _atomic_json(path:Path,value:Any)->None:
    path.parent.mkdir(parents=True,exist_ok=True);fd,tmp=tempfile.mkstemp(prefix=f'.{path.name}.',dir=str(path.parent))
    try:
        with os.fdopen(fd,'w',encoding='utf-8',newline='\n') as f:json.dump(value,f,ensure_ascii=False,indent=2,sort_keys=True);f.write('\n');f.flush();os.fsync(f.fileno())
        os.chmod(tmp,0o600);os.replace(tmp,path)
    except Exception:
        try:os.unlink(tmp)
        except OSError:pass
        raise

class ChessResultsRuntime:
    def __init__(self,secrets_provider:Callable[[],dict[str,str]],ownership_file:Path,cloud_identity_resolver:Callable[[str,str],str]|None=None,transport:Callable[[str,dict[str,Any],str],dict[str,Any]]|None=None):
        self.secrets_provider=secrets_provider;self.ownership_file=ownership_file.expanduser().resolve();self.cloud_identity_resolver=cloud_identity_resolver;self.transport=transport or self._http_post
    def _token(self)->str:
        token=str((self.secrets_provider() or {}).get(ORGANIZER_SECRET_KEY) or '').strip()
        if not token:raise ChessResultsRuntimeError('Organizer Token is not connected. Connect it first in Online & Cloud.')
        if len(token)>4096:raise ChessResultsRuntimeError('Organizer Token is invalid.')
        return token
    def _proofs(self)->dict[str,dict[str,Any]]:
        try:
            obj=json.loads(self.ownership_file.read_text(encoding='utf-8'));return obj if isinstance(obj,dict) else {}
        except Exception:return {}
    def _save_proofs(self,proofs:dict[str,dict[str,Any]])->None:_atomic_json(self.ownership_file,proofs)
    def _save_proof(self,key:str,proof:str,client_id:str='')->None:
        if not re.fullmatch(r'\d+',key) or not proof:return
        proofs=self._proofs();proofs[key]={"ownershipProof":proof,"clientId":str(client_id or ''),"updatedAt":time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())};self._save_proofs(proofs)
    def _remove_proof(self,key:str)->None:
        proofs=self._proofs()
        if key in proofs:proofs.pop(key,None);self._save_proofs(proofs)
    def _stored_proof(self,key:str)->str:return str((self._proofs().get(key) or {}).get('ownershipProof') or '').strip()
    def _http_post(self,operation:str,payload:dict[str,Any],token:str)->dict[str,Any]:
        raw=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode('utf-8')
        if len(raw)>MAX_BODY_BYTES:raise ChessResultsRuntimeError('Chess-Results request exceeds the safety limit.')
        req=urllib.request.Request(API_PREFIX+operation,data=raw,method='POST',headers={'Content-Type':'application/json;charset=utf-8','Accept':'application/json','Authorization':f'Bearer {token}','Origin':WEB_ORIGIN,'User-Agent':'Chess-Publisher-Linux-ChessResults/1'})
        try:
            with urllib.request.urlopen(req,timeout=TIMEOUT) as resp:body=resp.read(MAX_BODY_BYTES+1);status=resp.status
        except urllib.error.HTTPError as exc:body=exc.read(MAX_BODY_BYTES+1);status=exc.code
        except Exception as exc:raise ChessResultsRuntimeError(f'Chess-Results secure Worker is unavailable: {exc}') from exc
        if len(body)>MAX_BODY_BYTES:raise ChessResultsRuntimeError('Chess-Results Worker response exceeds safety limit.')
        try:result=json.loads(body.decode('utf-8')) if body else {}
        except Exception:result={}
        if not isinstance(result,dict):result={}
        if status<200 or status>=300 or not result.get('ok'):raise ChessResultsRuntimeError(str(result.get('message') or result.get('error') or f'Chess-Results service HTTP {status}'))
        return result
    def _claim(self,key:str,client_id:str,token:str)->str:
        cloud_id=''
        if self.cloud_identity_resolver:
            try:cloud_id=str(self.cloud_identity_resolver(key,client_id) or '').strip()
            except Exception:cloud_id=''
        if not cloud_id:raise ChessResultsRuntimeError(f'TNR {key} has no local ownership proof and no synchronized cloud tournament identity for safe recovery.')
        result=self.transport('claim',{'key':key,'cloudTournamentId':cloud_id,'clientId':client_id},token);proof=str(result.get('ownershipProof') or '').strip()
        if not proof:raise ChessResultsRuntimeError('The secure Worker did not return a recovered TNR ownership proof.')
        self._save_proof(key,proof,client_id);return proof
    def request(self,operation:str,body:dict[str,Any]|None=None)->dict[str,Any]:
        op=str(operation or '').strip().lower()
        if op not in ALLOWED:raise ChessResultsRuntimeError('Unsupported Chess-Results backend operation.')
        payload=dict(body or {});token=self._token();key=str(payload.get('key') or payload.get('tnr') or '').strip();client_id=str(payload.get('clientId') or '').strip()
        if op not in {'test','create','claim'}:
            if not re.fullmatch(r'\d+',key):raise ChessResultsRuntimeError('Chess-Results TNR is missing or invalid.')
            proof=str(payload.get('ownershipProof') or '').strip() or self._stored_proof(key)
            if not proof:proof=self._claim(key,client_id,token)
            payload['ownershipProof']=proof
        result=self.transport(op,payload,token);result_key=str(result.get('key') or key or '').strip();proof=str(result.get('ownershipProof') or '').strip()
        if op in {'create','claim'} and re.fullmatch(r'\d+',result_key or '') and proof:self._save_proof(result_key,proof,client_id)
        if op=='delete-authorize':result={**result,'canDelete':result.get('canDelete') is True or result.get('verifiedOwner') is True,'adminUrl':str(result.get('adminUrl') or result.get('url') or ''),'alreadyDeleted':result.get('alreadyDeleted') is True}
        if op=='unlink' and result.get('canUnlink') is True and re.fullmatch(r'\d+',result_key or ''):self._remove_proof(result_key)
        return result
    def status(self)->dict[str,Any]:
        token=''
        try:token=self._token()
        except ChessResultsRuntimeError:pass
        return {'ok':True,'ready':bool(token),'transport':'secure-worker','worker':API_PREFIX,'organizerTokenConnected':bool(token),'localBridgeCrypto':False,'sourceId':21}
