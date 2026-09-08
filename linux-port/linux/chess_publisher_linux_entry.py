#!/usr/bin/env python3
"""Chess-Publisher Linux development entrypoint with platform integrations."""
from __future__ import annotations
from pathlib import Path
import chess_publisher_linux as app
from build_info import APP_BUILD,ENGINE_VERSION
from build_identity_integration import apply as apply_build_identity
from hub_proxy_integration import apply as apply_hub_proxy
from source_guard import require_package_source,SourceIdentityError
from fide_payload_policy import apply as apply_fide_payload_policy
from fide_streaming_integration import apply as apply_fide_streaming
from fide_download_integration import apply as apply_fide_download
from fide_cache_integration import apply as apply_fide_cache
from fide_readiness_integration import apply as apply_fide_readiness
from fide_integration import apply as apply_fide
from chess_results_integration import apply as apply_chess_results
from dgt_integration import apply as apply_dgt
from telegram_integration import apply as apply_telegram
from desktop_integration import apply as apply_desktop
from export_runtime_integration import apply as apply_export_runtime
from browser_integration import apply as apply_browser
from window_integration import apply as apply_window
from pairings_result_desk_integration import apply as apply_pairings_result_desk
from cloud_directional_sync_integration import apply as apply_cloud_directional_sync

apply_build_identity()
apply_hub_proxy()
apply_fide_payload_policy()
apply_fide_streaming()
apply_fide_download()
apply_fide_cache()
apply_fide_readiness()
apply_fide()
apply_chess_results()
apply_dgt()
apply_telegram()
apply_desktop()
apply_export_runtime()
apply_browser()
apply_window()
apply_pairings_result_desk()
apply_cloud_directional_sync()

if __name__=='__main__':
    package_root=Path(__file__).resolve().parent.parent
    try:
        verified=require_package_source(package_root)
    except SourceIdentityError as exc:
        print(f'Chess-Publisher Linux refused to start: {exc}',file=__import__('sys').stderr)
        raise SystemExit(3)
    print(f"Verified source snapshot: {verified.get('snapshotId')} · {APP_BUILD} · LocalEngine {ENGINE_VERSION}")
    raise SystemExit(app.main())
