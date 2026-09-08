#!/usr/bin/env python3
"""Offline regression contract for resilient FIDE rating-list downloads."""
from __future__ import annotations

import http.server
import io
import sys
import tempfile
import threading
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "linux"))
import fide_runtime as fr
import fide_download_integration as fd


def make_zip(member: str, payload: bytes) -> bytes:
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(member, payload)
    return bio.getvalue()


RATING_TEXT = (
    b"ID Number       Name                         Fed  Sex Tit WTit OTit FOA  Rating Games K  B-day Flag\n"
    + (
        b"1503014         Carlsen, Magnus              NOR  M   g                 2823   5    10 1990      \n"
        * 40
    )
)
STANDARD_ZIP = make_zip("standard_rating_list.txt", RATING_TEXT)
DIRECTORY_ZIP = make_zip(
    "players_list_xml.xml", b"<playerslist>" + b"<player></player>" * 100 + b"</playerslist>"
)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path.endswith("/standard_rating_list.zip"):
            payload = STANDARD_ZIP
        elif self.path.endswith("/players_list_xml.zip"):
            payload = DIRECTORY_ZIP
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="cp-fide-download-strategy-") as td_raw:
        td = Path(td_raw)
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        th = threading.Thread(target=srv.serve_forever, daemon=True)
        th.start()
        old_roots = fd.FIDE_DOWNLOAD_ROOTS
        try:
            host, port = srv.server_address
            base = f"http://{host}:{port}/download"
            target = td / "std.zip"
            meta = fd._download_to(
                [base + "/missing.zip", base + "/standard_rating_list.zip"],
                target,
                max_bytes=1024 * 1024,
                timeout=10,
            )
            if not zipfile.is_zipfile(target):
                raise RuntimeError("validated ZIP was not installed")
            if meta.get("transport") not in {"curl", "python-urllib"}:
                raise RuntimeError(f"unknown transport: {meta}")
            if len(meta.get("attempts") or []) < 2:
                raise RuntimeError(f"failover attempts were not recorded: {meta}")
            staged = td / "std.txt"
            fr._extract_single(target, staged, ".txt", 1024 * 1024)
            valid = fd._validate_rating_txt(staged, "std")
            if valid.get("validated") is not True:
                raise RuntimeError("rating TXT validation failed")

            fd.FIDE_DOWNLOAD_ROOTS = (base,)
            used, archive, _ = fd._download_archive_candidates(
                fd.DIRECTORY_XML_ARCHIVES, td, max_bytes=1024 * 1024, timeout=10
            )
            if used != "players_list_xml.zip" or not zipfile.is_zipfile(archive):
                raise RuntimeError(
                    f"combined XML fallback failed: used={used} archive={archive}"
                )
        finally:
            fd.FIDE_DOWNLOAD_ROOTS = old_roots
            srv.shutdown()
            srv.server_close()
            th.join(timeout=2)
    print("FIDE_RESILIENT_DOWNLOAD_STRATEGY=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
