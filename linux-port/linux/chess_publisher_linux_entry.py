#!/usr/bin/env python3
"""Chess-Publisher Linux development entrypoint with platform integrations."""
from __future__ import annotations
import chess_publisher_linux as app
from fide_integration import apply as apply_fide
from chess_results_integration import apply as apply_chess_results

apply_fide()
apply_chess_results()

if __name__=='__main__':
    raise SystemExit(app.main())
