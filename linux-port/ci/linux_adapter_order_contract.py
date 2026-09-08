#!/usr/bin/env python3
"""Guard Linux adapter delivery order needed by installation-scoped secret RPC."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
text=(ROOT/'linux'/'chess_publisher_linux.py').read_text(encoding='utf-8')
shim=text.find('<script src="/linux/LinuxWebViewShim.js"></script>')
hub=text.find('<script src="/source/webview/HubAdapter.js"></script>')
cloud=text.find('<script src="/source/webview/CloudWorkspaceAdapter.js"></script>')
if min(shim,hub,cloud)<0:raise RuntimeError('required Linux/Hub/Cloud adapter injection marker is missing')
if not shim<hub<cloud:raise RuntimeError('LinuxWebViewShim must load before HubAdapter and CloudWorkspaceAdapter so native secret result listeners can register')
print('LINUX_ADAPTER_LOAD_ORDER_CONTRACT=PASS')
