#!/usr/bin/env python3
"""Guard Linux adapter delivery order needed by secrets and directional Cloud sync."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
text=(ROOT/'linux'/'chess_publisher_linux.py').read_text(encoding='utf-8')
shim=text.find('<script src="/linux/LinuxWebViewShim.js"></script>')
hub=text.find('<script src="/source/webview/HubAdapter.js"></script>')
cloud=text.find('<script src="/source/webview/CloudWorkspaceAdapter.js"></script>')
if min(shim,hub,cloud)<0:raise RuntimeError('required Linux/Hub/Cloud adapter injection marker is missing')
if not shim<hub<cloud:raise RuntimeError('LinuxWebViewShim must load before HubAdapter and CloudWorkspaceAdapter so native secret result listeners can register')
entry=(ROOT/'linux'/'chess_publisher_linux_entry.py').read_text(encoding='utf-8')
legacy=entry.find('apply_pairings_result_desk()')
directional=entry.find('apply_cloud_directional_sync()')
if legacy<0 or directional<0 or not legacy<directional:raise RuntimeError('directional Cloud policy must be applied last, after legacy UI/runtime adapters')
integration=(ROOT/'linux'/'cloud_directional_sync_integration.py').read_text(encoding='utf-8')
if '/linux/cloud_directional_sync.js' not in integration:raise RuntimeError('directional Cloud delivery adapter is not wired')
loader=(ROOT/'linux'/'cloud_directional_sync.js').read_text(encoding='utf-8')
if 'ChessPublisherCloudWorkspace_AutoSync_v1' not in loader or '"0"' not in loader:raise RuntimeError('legacy automatic Cloud sync is not disabled before directional policy loads')
print('LINUX_ADAPTER_LOAD_ORDER_CONTRACT=PASS (directional Cloud sync last)')
