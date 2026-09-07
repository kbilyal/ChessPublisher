#!/usr/bin/env python3
"""Minimal Linux DGT e-Board transport for Chess-Publisher.

Implements the documented DGT serial e-board framing directly with Python's
standard library. Scope is deliberately limited to the Chess-Publisher UI
contract: enumerate serial ports, request one-shot board/serial/version data,
refresh positions, and disconnect. It does not infer chess moves or modify
pairings/results.
"""
from __future__ import annotations

import glob
import os
import select
import termios
import threading
import time
from pathlib import Path
from typing import Any

BAUD=termios.B9600
SEND_RESET=0x40
SEND_BRD=0x42
RETURN_SERIALNR=0x45
SEND_VERSION=0x4D
MSG_BOARD_DUMP=0x06
MSG_SERIALNR=0x11
MSG_VERSION=0x13
MAX_BOARDS=120

class DgtError(RuntimeError): pass


def _candidate_ports()->list[str]:
    patterns=("/dev/ttyUSB*","/dev/ttyACM*","/dev/rfcomm*","/dev/ttyS*")
    rows=[]
    for pattern in patterns: rows.extend(glob.glob(pattern))
    order=lambda p:(0 if '/ttyUSB' in p else 1 if '/ttyACM' in p else 2 if '/rfcomm' in p else 3,p)
    return sorted({p for p in rows if os.path.exists(p)},key=order)


def _configure(fd:int)->None:
    attrs=termios.tcgetattr(fd)
    attrs[0]=0;attrs[1]=0;attrs[2]=termios.CS8|termios.CREAD|termios.CLOCAL;attrs[3]=0
    attrs[4]=BAUD;attrs[5]=BAUD
    attrs[6][termios.VMIN]=0;attrs[6][termios.VTIME]=0
    termios.tcsetattr(fd,termios.TCSANOW,attrs);termios.tcflush(fd,termios.TCIOFLUSH)


def _frames(fd:int,timeout:float):
    end=time.monotonic()+timeout;buf=bytearray()
    while time.monotonic()<end:
        wait=max(0.0,end-time.monotonic());ready,_,_=select.select([fd],[],[],min(wait,0.15))
        if ready:
            try:chunk=os.read(fd,4096)
            except BlockingIOError:chunk=b''
            if chunk:buf.extend(chunk)
        while len(buf)>=3:
            if not (buf[0]&0x80):del buf[0];continue
            b1,b2=buf[1],buf[2]
            if b1&0x80 or b2&0x80:del buf[0];continue
            length=(b1<<7)|b2
            if length<3 or length>8192:del buf[0];continue
            if len(buf)<length:break
            raw=bytes(buf[:length]);del buf[:length]
            yield raw[0]&0x7f,raw[3:]


def _serial_text(payload:bytes)->str:
    return payload.decode('ascii','ignore').replace('\x00','').strip()


def snapshot_port(port:str,timeout:float=1.8)->dict[str,Any]:
    path=str(port or '').strip()
    if not path.startswith('/dev/') and not path.startswith('/tmp/'):
        raise DgtError('Invalid Linux serial device path.')
    try:fd=os.open(path,os.O_RDWR|os.O_NOCTTY|os.O_NONBLOCK)
    except PermissionError as exc:raise DgtError(f'Permission denied for {path}. Add the user to the serial-port group (usually dialout) and reconnect.') from exc
    except OSError as exc:raise DgtError(f'Could not open {path}: {exc}') from exc
    try:
        _configure(fd);os.write(fd,bytes([SEND_RESET]));time.sleep(0.025);os.write(fd,bytes([RETURN_SERIALNR,SEND_VERSION,SEND_BRD]))
        serial='';version='';pieces=None;deadline=time.monotonic()+timeout
        for msg,payload in _frames(fd,max(0.05,deadline-time.monotonic())):
            if msg==MSG_SERIALNR:serial=_serial_text(payload)
            elif msg==MSG_VERSION and payload:version='.'.join(str(int(x)) for x in payload[:2]) if len(payload)>=2 else str(int(payload[0]))
            elif msg==MSG_BOARD_DUMP and len(payload)>=64:pieces=[int(x) for x in payload[:64]]
            if pieces is not None and serial and version:break
        if pieces is None:raise DgtError(f'{path} opened, but no DGT BOARD_DUMP response was received.')
        return {'Port':path,'Mode':'Serial','Address':0,'Serial':serial or Path(path).name,'Version':version or '—','Pieces':pieces,'Error':''}
    finally:
        try:os.close(fd)
        except OSError:pass


class DgtLinuxRuntime:
    def __init__(self):
        self._lock=threading.RLock();self._connected_ports:list[str]=[];self._last_snapshot:dict[str,Any]={'Connected':False,'Ports':[],'Boards':[],'Warnings':[]}

    def diagnostics(self)->dict[str,Any]:
        ports=_candidate_ports();devices=[{'Name':Path(p).name,'ComPort':p,'ConfigError':0} for p in ports]
        if ports:status='SerialReady';summary=f'Linux serial subsystem ready. {len(ports)} candidate port(s) detected.'
        else:status='NoComPort';summary='No Linux serial ports suitable for a DGT e-Board are currently visible.'
        snap=dict(self._last_snapshot);snap['Ports']=ports
        return {'ok':True,'diagnostics':{'Status':status,'Summary':summary,'Devices':devices,'Platform':'Linux','DriverModel':'kernel serial/FTDI'},'snapshot':snap}

    def connect(self,expected_boards:int=1,ports:list[str]|None=None)->dict[str,Any]:
        expected=max(1,min(MAX_BOARDS,int(expected_boards or 1)));candidates=[str(x) for x in (ports or _candidate_ports())]
        boards=[];warnings=[];used=[]
        for port in candidates:
            if len(boards)>=expected:break
            try:boards.append(snapshot_port(port));used.append(port)
            except DgtError as exc:warnings.append(str(exc))
        with self._lock:self._connected_ports=used;self._last_snapshot={'Connected':bool(boards),'Ports':candidates,'Boards':boards,'Warnings':warnings}
        status='DgtDriverReady' if boards else ('SerialReady' if candidates else 'NoComPort')
        summary=(f'DGT protocol response OK from {len(boards)} board(s).' if boards else ('Serial ports detected, but no DGT protocol response was received.' if candidates else 'No compatible Linux serial ports detected.'))
        return {'ok':True,'diagnostics':{'Status':status,'Summary':summary,'Devices':[{'Name':Path(p).name,'ComPort':p,'ConfigError':0} for p in candidates],'Platform':'Linux','DriverModel':'kernel serial/FTDI'},'snapshot':dict(self._last_snapshot)}

    def refresh(self)->dict[str,Any]:
        with self._lock:ports=list(self._connected_ports)
        if not ports:return {'ok':True,'snapshot':{'Connected':False,'Ports':_candidate_ports(),'Boards':[],'Warnings':['No DGT board connection is active.']}}
        boards=[];warnings=[];still=[]
        for port in ports:
            try:boards.append(snapshot_port(port,1.2));still.append(port)
            except DgtError as exc:warnings.append(str(exc))
        snapshot={'Connected':bool(boards),'Ports':_candidate_ports(),'Boards':boards,'Warnings':warnings}
        with self._lock:self._connected_ports=still;self._last_snapshot=snapshot
        return {'ok':True,'snapshot':snapshot}

    def disconnect(self)->dict[str,Any]:
        with self._lock:self._connected_ports=[];self._last_snapshot={'Connected':False,'Ports':_candidate_ports(),'Boards':[],'Warnings':[]}
        return {'ok':True,'snapshot':dict(self._last_snapshot)}

    def request(self,operation:str,expected_boards:int=1)->dict[str,Any]:
        op=str(operation or '').strip().lower()
        if op=='diagnostics':return self.diagnostics()
        if op=='connect':return self.connect(expected_boards)
        if op=='refresh':return self.refresh()
        if op=='disconnect':return self.disconnect()
        raise DgtError('Unsupported DGT Linux operation.')
