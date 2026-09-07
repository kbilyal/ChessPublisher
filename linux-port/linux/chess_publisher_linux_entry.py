#!/usr/bin/env python3
"""Chess-Publisher Linux development entrypoint with platform integrations."""
from __future__ import annotations
from pathlib import Path
import chess_publisher_linux as app
from build_info import APP_BUILD,ENGINE_VERSION
from source_guard import require_package_source,SourceIdentityError
from fide_integration import apply as apply_fide
from chess_results_integration import apply as apply_chess_results
from dgt_integration import apply as apply_dgt

# The legacy host module predates the packaged Linux build identity. Bind its
# exported health/version fields here so every supported launcher reports the
# single canonical build_info values.
app.APP_BUILD=APP_BUILD
app.ENGINE_VERSION=ENGINE_VERSION

apply_fide()
apply_chess_results()
apply_dgt()

if __name__=='__main__':
    package_root=Path(__file__).resolve().parent.parent
    try:
        verified=require_package_source(package_root)
    except SourceIdentityError as exc:
        print(f'Chess-Publisher Linux refused to start: {exc}',file=__import__('sys').stderr)
        raise SystemExit(3)
    print(f"Verified source snapshot: {verified.get('snapshotId')} · {APP_BUILD} · LocalEngine {ENGINE_VERSION}")
    raise SystemExit(app.main())
