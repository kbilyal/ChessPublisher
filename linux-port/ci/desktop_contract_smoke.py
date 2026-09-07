#!/usr/bin/env python3
from __future__ import annotations
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'linux'))
import chess_publisher_linux as app
from desktop_integration import translate_delivered_ui,_open_text_report

sample=(b'Windows driver / COM | ChessPublisher.bat | Windows WebView TRF bridge is unavailable. | '
        b'Windows PGN export failed. | Imported tournament name is not a valid Windows tournament folder name.')
out=translate_delivered_ui(sample)
assert b'Linux device / serial' in out
assert b'ChessPublisher.bat' not in out
assert b'Windows WebView TRF bridge is unavailable.' not in out
assert b'Windows PGN export failed.' not in out
assert b'valid Windows tournament folder name' not in out

with tempfile.TemporaryDirectory(prefix='cp-desktop-contract-') as td:
    engine=app.LinuxEngine(ROOT,Path(td)/'data')
    fake=type('P',(),{'pid':4321})()
    with patch('desktop_integration.subprocess.Popen',return_value=fake) as popen:
        result=_open_text_report(engine,{'fileName':'ChessPublisherLmsg.txt','text':'Unicode: България'})
    assert result.get('ok') is True and result.get('opened') is True and result.get('pid')==4321
    target=Path(result['path']);assert target.is_file() and 'България' in target.read_text(encoding='utf-8')
    assert popen.call_args.args[0][0]=='xdg-open'

print('LINUX_DESKTOP_INTEGRATION_CONTRACT=PASS')
