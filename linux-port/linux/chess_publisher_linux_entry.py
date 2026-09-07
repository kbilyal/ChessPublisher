#!/usr/bin/env python3
"""Chess-Publisher Linux development entrypoint with platform integrations."""
from __future__ import annotations
import chess_publisher_linux as app
from fide_integration import apply

apply()

if __name__=='__main__':
    raise SystemExit(app.main())
