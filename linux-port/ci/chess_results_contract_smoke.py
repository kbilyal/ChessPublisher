#!/usr/bin/env python3
"""Offline secure-Worker Chess-Results contract smoke for Linux."""
from __future__ import annotations
import json, sys, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'linux'))
from chess_results_runtime import ChessResultsRuntime, ChessResultsRuntimeError


def main()->int:
    with tempfile.TemporaryDirectory(prefix='cp-cr-contract-') as td_raw:
        td=Path(td_raw);calls=[]
        def transport(op,payload,token):
            calls.append((op,dict(payload),token))
            if op=='create':return {'ok':True,'key':'12345','ownershipProof':'signed-proof','sourceId':21,'federation':'XXX'}
            if op=='publish':return {'ok':True,'key':'12345','published':True}
            if op=='admin-link':return {'ok':True,'key':'12345','url':'https://chess-results.com/UploadData.aspx?sid=fresh'}
            if op=='delete-authorize':return {'ok':True,'key':'12345','verifiedOwner':True,'url':'https://s1.chess-results.com/Stammdaten.aspx?sid=fresh','alreadyDeleted':False}
            if op=='unlink':return {'ok':True,'key':'12345','canUnlink':True}
            raise RuntimeError('unexpected operation '+op)
        rt=ChessResultsRuntime(lambda:{'organizer-primary':'organizer-token'},td/'proofs.json',transport=transport)
        created=rt.request('create',{'mode':'test','federation':'BUL','tournament':'Smoke','clientId':'cid'})
        if created['key']!='12345' or oct((td/'proofs.json').stat().st_mode&0o777)!='0o600':raise RuntimeError('create/proof persistence mismatch')
        rt.request('publish',{'key':'12345','xml':'<chessresults/>'})
        if calls[-1][1].get('ownershipProof')!='signed-proof':raise RuntimeError('publish did not use stored ownership proof')
        upload=rt.request('admin-link',{'key':'12345','clientId':'cid','section':'upload'})
        if not str(upload.get('url') or '').startswith('https://chess-results.com/UploadData.aspx'):raise RuntimeError('official UploadData URL was rejected')
        auth=rt.request('delete-authorize',{'key':'12345','clientId':'cid'})
        if not auth.get('canDelete') or not str(auth.get('adminUrl') or '').startswith('https://s1.chess-results.com/'):raise RuntimeError('delete authorize desktop contract mismatch')

        def malicious_transport(op,payload,token):
            if op=='admin-link':return {'ok':True,'key':'12345','url':'https://evil.example/UploadData.aspx?sid=stolen'}
            if op=='delete-authorize':return {'ok':True,'key':'12345','verifiedOwner':True,'url':'http://chess-results.com/Stammdaten.aspx?sid=insecure','alreadyDeleted':False}
            raise RuntimeError('unexpected operation '+op)
        unsafe=ChessResultsRuntime(lambda:{'organizer-primary':'organizer-token'},td/'proofs.json',transport=malicious_transport)
        for operation in ('admin-link','delete-authorize'):
            try:unsafe.request(operation,{'key':'12345','clientId':'cid'})
            except ChessResultsRuntimeError:pass
            else:raise RuntimeError(f'untrusted Chess-Results URL was accepted for {operation}')

        unlinked=rt.request('unlink',{'key':'12345','clientId':'cid','serverError':''})
        if not unlinked.get('canUnlink') or rt._stored_proof('12345'):raise RuntimeError('unlink did not clear proof')
        missing=ChessResultsRuntime(lambda:{},td/'missing.json',transport=transport)
        try:missing.request('test',{})
        except ChessResultsRuntimeError:pass
        else:raise RuntimeError('missing Organizer Token was accepted')
        source=(ROOT/'linux'/'chess_results_runtime.py').read_text(encoding='utf-8')
        if 'CHESS_RESULTS_AES_KEY' in source or 'CHESS_RESULTS_AES_IV' in source:raise RuntimeError('AES secret name leaked into Linux runtime')
        if rt.status().get('localBridgeCrypto') is not False:raise RuntimeError('Linux transport unexpectedly claims local bridge crypto')
        print(json.dumps({'createProof':True,'publishProofReuse':True,'adminUrlAllowlist':True,'maliciousUrlRejected':True,'deleteAuthorize':True,'unlinkProofRemoval':True,'tokenFailClosed':True,'localBridgeCrypto':False,'sourceId':21},indent=2))
        print('CHESS_RESULTS_CONTRACT_SMOKE=PASS')
    return 0
if __name__=='__main__':raise SystemExit(main())
