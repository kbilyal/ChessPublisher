#!/usr/bin/env python3
"""Regression contract for offline FIDE rating-list seed/cache behavior."""
from __future__ import annotations

import io
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "linux"))
import fide_cache_integration as fc
import fide_download_integration as fd
import fide_runtime as fr


def make_zip(member: str, payload: bytes) -> bytes:
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(member, payload)
    return bio.getvalue()


RATING_TEXT = (
    b"ID Number       Name                         Fed  Sex Tit WTit OTit FOA  Rating Games K  B-day Flag\n"
    + b"1503014         Carlsen, Magnus              NOR  M   g                 2823   5    10 1990      \n" * 40
)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="cp-fide-cache-contract-") as td_raw:
        td = Path(td_raw)
        cache = td / "cache"
        cache.mkdir()
        (cache / "standard_rating_list.zip").write_bytes(
            make_zip("standard_rating_list.txt", RATING_TEXT)
        )
        old_dirs = fc.CACHE_DIRS
        old_downloader = fc._ORIGINAL_DOWNLOAD_CANDIDATES
        try:
            fc.CACHE_DIRS = (cache,)
            runtime = fr.FideRuntime(td / "data")
            seeded = fc._seed_lists(runtime)
            if "std" not in seeded:
                raise RuntimeError(f"standard cache was not seeded: {seeded}")
            if runtime.read_list("std")[:20].lower().find(b"id number") < 0:
                raise RuntimeError("seeded standard list is invalid")
            status = runtime.status()
            if status.lists["std"].get("ready") is not True:
                raise RuntimeError(f"seeded standard list not ready: {status.lists['std']}")

            def fail_network(*_args, **_kwargs):
                raise fr.FideRuntimeError("simulated official FIDE outage")

            fc._ORIGINAL_DOWNLOAD_CANDIDATES = fail_network
            used, archive, meta = fc._download_archive_candidates(
                ("standard_rating_list.zip",), td / "work"
            )
            if used != "standard_rating_list.zip":
                raise RuntimeError(f"wrong cache archive selected: {used}")
            if archive != cache / "standard_rating_list.zip":
                raise RuntimeError(f"wrong cache path selected: {archive}")
            if meta.get("transport") != "local-cache" or meta.get("cached") is not True:
                raise RuntimeError(f"cache fallback metadata invalid: {meta}")
        finally:
            fc.CACHE_DIRS = old_dirs
            fc._ORIGINAL_DOWNLOAD_CANDIDATES = old_downloader
    print("FIDE_OFFLINE_CACHE_CONTRACT=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
