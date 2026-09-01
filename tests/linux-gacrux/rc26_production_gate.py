#!/usr/bin/env python3
"""Run the RC26 Gacrux matrix using the pinned production JS TRF serializer."""
from __future__ import annotations
import argparse, importlib.util, json, subprocess, sys, tempfile
from dataclasses import asdict
from pathlib import Path

HERE=Path(__file__).resolve().parent
COMPACT=HERE/'rc26_compact_gate.py'
SERIALIZER=HERE/'rc26_serializer.js'
FRAGMENT=HERE/'rc26-production-pairing-fragment.js'
FRAGMENT_SHA256='20a9e226a1cf5a4313638ee62bf024af033118c5ea5e4862a231e9b3bd472fcf'

spec=importlib.util.spec_from_file_location('rc26_compact_gate',COMPACT)
cg=importlib.util.module_from_spec(spec); sys.modules[spec.name]=cg; spec.loader.exec_module(cg)


def production_serialize(fx):
    with tempfile.TemporaryDirectory(prefix='cp-rc26-js-') as td:
        d=Path(td); fixture=d/'fixture.json'; out=d/'out.trf'
        fixture.write_text(json.dumps(fx,ensure_ascii=False),encoding='utf-8')
        p=subprocess.run(['node',str(SERIALIZER),str(FRAGMENT),str(fixture),str(out)],text=True,capture_output=True)
        if p.returncode:
            raise RuntimeError(f'RC26 production serializer failed\nstdout:\n{p.stdout}\nstderr:\n{p.stderr}')
        return out.read_bytes().decode('ascii')

# Every matrix case in rc26_compact_gate resolves this global at runtime.
cg.serialize=production_serialize


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--gacrux',type=Path,required=True); ap.add_argument('--report',type=Path); args=ap.parse_args()
    cg.detect_version(args.gacrux)
    py=sys.executable
    cases=[
        cg.normal_case('even-16x7',16,7,py,args.gacrux),
        cg.normal_case('odd-15x7',15,7,py,args.gacrux),
        cg.normal_case('double-forfeit-16x5',16,5,py,args.gacrux,True),
        cg.late_entry_case(py,args.gacrux),
        cg.unpaired_case(py,args.gacrux),
    ]
    report={
        'status':'PASS','chessPublisher':'1.05.00-RC26',
        'serializer':'pinned production buildPairingEngineTRF JavaScript fragment',
        'rc26HtmlSha256':cg.RC26_HTML_SHA256,
        'rc26BuildPairingEngineTRFSha256':cg.RC26_BUILD_PAIRING_TRF_SHA256,
        'productionFragmentSha256':FRAGMENT_SHA256,
        'gacruxVersion':cg.GACRUX_VERSION,'gacruxCommit':cg.GACRUX_COMMIT,
        'cases':[asdict(x) for x in cases],
        'totalRounds':sum(x.rounds for x in cases),
        'totalCheckTrue':sum(x.checks for x in cases),
    }
    text=json.dumps(report,indent=2)+'\n'; print(text)
    if args.report:
        args.report.parent.mkdir(parents=True,exist_ok=True); args.report.write_text(text,encoding='utf-8')

if __name__=='__main__': main()
