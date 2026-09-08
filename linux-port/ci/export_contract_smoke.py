#!/usr/bin/env python3
"""Linux native export regression contract."""
from __future__ import annotations
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINUX = ROOT / "linux"
sys.path.insert(0, str(LINUX))

import chess_publisher_linux as cp  # noqa: E402
import export_runtime_integration as ex  # noqa: E402


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="cp-export-contract-") as td_raw:
        td = Path(td_raw)
        downloads = td / "Изтегляния"
        downloads.mkdir(parents=True)
        old = os.environ.get("XDG_DOWNLOAD_DIR")
        os.environ["XDG_DOWNLOAD_DIR"] = str(downloads)
        try:
            engine = cp.LinuxEngine(ROOT, td / "data")
            ex.apply()
            txt = ex._write_text_export(engine, {
                "tournamentName": "Golden Rhodopes 2026",
                "fileName": "Starting_List.txt",
                "category": "Starting List",
                "text": "Starting rank\r\nNo. Name FideID FED Rtg\r\n1 Eren, Ataberk 6349765 TUR 2370\r\n",
            })
            txt_path = Path(txt["path"])
            if not txt_path.is_file() or not str(txt_path).startswith(str(downloads)):
                raise RuntimeError(f"visible TXT export missing: {txt}")
            if not txt_path.read_bytes().startswith(b"\xef\xbb\xbf"):
                raise RuntimeError("native TXT export must be UTF-8 BOM for desktop compatibility")

            trf = engine.write_trf_export("Golden Rhodopes 2026", "Starting.TXT", "012 TEST\r\n001 PLAYER\r\n")
            visible = Path(trf["path"])
            managed = Path(trf["managedPath"])
            if not visible.is_file() or not managed.is_file():
                raise RuntimeError(f"TRF must keep managed copy and visible export: {trf}")
            if not str(visible).startswith(str(downloads)):
                raise RuntimeError("TRF visible copy was not written below XDG Downloads")

            delivered = ex._inject_export_script(b"<html><body>test</body></html>")
            if delivered.count(b'/linux/export_integration.js') != 1:
                raise RuntimeError("Linux export integration script was not injected exactly once")
        finally:
            if old is None:
                os.environ.pop("XDG_DOWNLOAD_DIR", None)
            else:
                os.environ["XDG_DOWNLOAD_DIR"] = old
    print("LINUX_NATIVE_EXPORT_CONTRACT=PASS (starting-list TXT, pairings route, visible TRF mirror)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
