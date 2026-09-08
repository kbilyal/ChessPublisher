#!/usr/bin/env python3
"""Non-destructive live probe of the official FIDE Standard rating-list ZIP."""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "linux"))
import fide_runtime as fr
import fide_download_integration as fd


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="cp-fide-live-") as td_raw:
        td = Path(td_raw)
        name, archive, meta = fd._download_archive_candidates(
            ("standard_rating_list.zip",), td, timeout=fd.DOWNLOAD_TIMEOUT
        )
        staged = td / "standard.txt"
        extracted = fr._extract_single(
            archive, staged, ".txt", fr.MAX_EXTRACTED_LIST_BYTES
        )
        validated = fd._validate_rating_txt(staged, "std")
        print(
            json.dumps(
                {
                    "archiveName": name,
                    "source": meta.get("finalUrl") or meta.get("url"),
                    "transport": meta.get("transport"),
                    "archiveBytes": meta.get("bytes"),
                    "member": extracted.get("member"),
                    "txtBytes": validated.get("bytes"),
                    "attempts": meta.get("attempts"),
                },
                indent=2,
            )
        )
    print("FIDE_OFFICIAL_STANDARD_DOWNLOAD=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
