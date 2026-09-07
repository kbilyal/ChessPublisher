#!/usr/bin/env python3
"""Non-destructive real-machine acceptance checks for Chess-Publisher Linux.

Default scope is the live Chess-Results Worker connection test using the
Organizer Token already stored by Chess-Publisher. It never creates, publishes,
deletes or unlinks a tournament. A physical DGT BOARD_DUMP check is optional.
"""
from __future__ import annotations
import argparse,json,os,platform,sys
from pathlib import Path
from typing import Any,Callable

from chess_publisher_linux import LinuxEngine
from chess_results_runtime import ChessResultsRuntime,ChessResultsRuntimeError
from dgt_runtime import DgtLinuxRuntime,DgtError
from build_info import APP_BUILD,ENGINE_VERSION


def default_data_home()->Path:
    return Path(os.environ.get('CP_DATA_HOME','~/.local/share/chess-publisher')).expanduser().resolve()


def chess_results_live_test(package_root:Path,data_home:Path,transport:Callable[[str,dict[str,Any],str],dict[str,Any]]|None=None)->dict[str,Any]:
    engine=LinuxEngine(package_root,data_home)
    runtime=ChessResultsRuntime(engine.load_secrets,engine.settings_root/'chess-results-ownership.json',transport=transport)
    status=runtime.status()
    if not status.get('organizerTokenConnected'):
        raise ChessResultsRuntimeError('Organizer Token is not connected in this Chess-Publisher installation.')
    result=runtime.request('test',{})
    # Never include token, request headers, AES material or other secret values in
    # diagnostics. The Worker owns bridge crypto; Linux only reports safe status.
    return {
        'workerReachable':bool(result.get('ok')),
        'sidVerified':bool(result.get('sidVerified')),
        'sourceId':21,
        'transport':'secure-worker',
        'localBridgeCrypto':False,
    }


def dgt_live_test()->dict[str,Any]:
    runtime=DgtLinuxRuntime();diagnostics=runtime.diagnostics();ports=diagnostics.get('snapshot',{}).get('Ports',[])
    if not ports:raise DgtError('No Linux serial port is visible for a physical DGT test.')
    result=runtime.connect(1);boards=result.get('snapshot',{}).get('Boards',[])
    if not boards:raise DgtError('Serial ports are visible, but no DGT BOARD_DUMP response was received.')
    try:
        board=boards[0]
        return {'connectedBoards':len(boards),'port':board.get('Port',''),'serial':board.get('Serial',''),'version':board.get('Version','')}
    finally:runtime.disconnect()


def main()->int:
    ap=argparse.ArgumentParser(description='Chess-Publisher Linux non-destructive live acceptance')
    ap.add_argument('--package-root',type=Path,default=Path(__file__).resolve().parent.parent,help=argparse.SUPPRESS)
    ap.add_argument('--data-home',type=Path,default=default_data_home())
    ap.add_argument('--dgt-connect',action='store_true',help='Also attempt a non-destructive physical DGT BOARD_DUMP test.')
    ap.add_argument('--json',action='store_true')
    args=ap.parse_args();root=args.package_root.expanduser().resolve();data=args.data_home.expanduser().resolve()
    tests=[]
    try:
        detail=chess_results_live_test(root,data)
        tests.append({'name':'chess-results-live','status':'PASS','detail':detail})
    except ChessResultsRuntimeError as exc:
        tests.append({'name':'chess-results-live','status':'BLOCKED','error':str(exc)})
    if args.dgt_connect:
        try:tests.append({'name':'dgt-hardware','status':'PASS','detail':dgt_live_test()})
        except DgtError as exc:tests.append({'name':'dgt-hardware','status':'BLOCKED','error':str(exc)})
    failed=[x for x in tests if x['status'] not in {'PASS'}]
    out={'ok':not failed,'appBuild':APP_BUILD,'engineVersion':ENGINE_VERSION,'platform':platform.system(),'dataHome':str(data),'tests':tests,'passed':len(tests)-len(failed),'blocked':len(failed)}
    if args.json:print(json.dumps(out,ensure_ascii=False,indent=2))
    else:
        print(f'Chess-Publisher Linux live acceptance — {APP_BUILD}')
        for row in tests:print(f"[{row['status']}] {row['name']}"+(f" — {row.get('error')}" if row.get('error') else ''))
        print('LIVE_ACCEPTANCE_RESULT=' + ('PASS' if not failed else 'BLOCKED'))
    return 0 if not failed else 2

if __name__=='__main__':raise SystemExit(main())
