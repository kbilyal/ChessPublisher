#!/usr/bin/env python3
import os,pty,threading,time,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
from dgt_runtime import snapshot_port,DgtLinuxRuntime,SEND_BRD,RETURN_SERIALNR,SEND_VERSION,MSG_BOARD_DUMP,MSG_SERIALNR,MSG_VERSION
from chess_publisher_linux import LinuxEngine
from dgt_integration import _pgn

def frame(msg,payload=b''):
    n=3+len(payload);return bytes([0x80|msg,(n>>7)&0x7f,n&0x7f])+payload

START=[8,9,10,12,11,10,9,8]+[7]*8+[0]*32+[1]*8+[2,3,4,6,5,4,3,2]
master,slave=pty.openpty();port=os.ttyname(slave);stop=False

def fake_board():
    while not stop:
        try:data=os.read(master,64)
        except OSError:time.sleep(.01);continue
        for cmd in data or b'':
            try:
                if cmd==RETURN_SERIALNR:os.write(master,frame(MSG_SERIALNR,b'13116'))
                elif cmd==SEND_VERSION:os.write(master,frame(MSG_VERSION,bytes([1,8])))
                elif cmd==SEND_BRD:os.write(master,frame(MSG_BOARD_DUMP,bytes(START)))
            except OSError:pass

thread=threading.Thread(target=fake_board,daemon=True);thread.start()
try:
    row=snapshot_port(port,1.0)
    assert row['Serial']=='13116' and row['Version']=='1.8' and row['Pieces']==START
    rt=DgtLinuxRuntime();result=rt.connect(1,[port])
    assert result['snapshot']['Connected'] is True and len(result['snapshot']['Boards'])==1
    assert result['diagnostics']['Status']=='DgtDriverReady'
    assert rt.disconnect()['snapshot']['Connected'] is False

    import tempfile
    with tempfile.TemporaryDirectory(prefix='cp-pgn-') as td:
        engine=LinuxEngine(ROOT,Path(td)/'data')
        ensured=_pgn(engine,{'operation':'ensure','tournamentName':'Linux Test'})
        assert Path(ensured['folder']).name=='PGN'
        written=_pgn(engine,{'operation':'write','tournamentName':'Linux Test','fileName':'Round-01.pgn','text':'[Event "Test"]\n\n*\n'})
        assert Path(written['path']).is_file() and Path(written['path']).parent.name=='PGN'
    print('DGT_LINUX_PROTOCOL_CONTRACT=PASS')
finally:
    stop=True
    try:os.close(slave)
    except OSError:pass
    try:os.close(master)
    except OSError:pass
    thread.join(timeout=1)
