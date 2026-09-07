#!/usr/bin/env python3
"""Linux FIDE download payload policy.

The official FIDE LEGACY XML has grown beyond the original 260 MiB guard used
by the first Linux preview. Keep the import streaming and bounded, but allow the
current official payload size while rejecting extreme ZIP expansion ratios.
"""
from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Any

import fide_runtime as fr

MAX_LEGACY_XML_BYTES = 768 * 1024 * 1024
MAX_ZIP_EXPANSION_RATIO = 120.0
ZIP_RATIO_CHECK_MIN_BYTES = 8 * 1024 * 1024
_APPLIED = False
_ORIGINAL_EXTRACT = fr._extract_single


def _validate_member(info: zipfile.ZipInfo, suffix: str, max_bytes: int) -> dict[str, float | int]:
    size = int(info.file_size or 0)
    compressed = int(info.compress_size or 0)
    if size <= 0 or size > max_bytes:
        raise fr.FideRuntimeError(
            f"FIDE extracted {suffix} payload size is outside safety limits "
            f"(bytes={size}, max={max_bytes})."
        )
    if compressed < 0:
        raise fr.FideRuntimeError("FIDE ZIP payload has an invalid compressed size.")
    ratio = (float(size) / float(compressed)) if compressed > 0 else 1.0
    if size >= ZIP_RATIO_CHECK_MIN_BYTES and compressed > 0 and ratio > MAX_ZIP_EXPANSION_RATIO:
        raise fr.FideRuntimeError(
            "FIDE ZIP payload expansion ratio is outside safety limits "
            f"(ratio={ratio:.1f}, max={MAX_ZIP_EXPANSION_RATIO:.1f})."
        )
    return {"bytes": size, "compressedBytes": compressed, "expansionRatio": ratio}


def _extract_single_guarded(archive: Path, target: Path, suffix: str, max_bytes: int) -> dict[str, Any]:
    effective_max = MAX_LEGACY_XML_BYTES if suffix.lower() == ".xml" else max_bytes
    with zipfile.ZipFile(archive) as zf:
        candidates = [m for m in fr._safe_zip_members(zf) if m.filename.lower().endswith(suffix.lower())]
        if not candidates:
            raise fr.FideRuntimeError(f"FIDE archive contains no {suffix} payload.")
        info = max(candidates, key=lambda m: int(m.file_size or 0))
        limits = _validate_member(info, suffix, effective_max)
    result = _ORIGINAL_EXTRACT(archive, target, suffix, effective_max)
    result["compressedBytes"] = limits["compressedBytes"]
    result["expansionRatio"] = limits["expansionRatio"]
    return result


def apply() -> None:
    global _APPLIED
    if _APPLIED:
        return
    _APPLIED = True
    fr.MAX_LEGACY_XML_BYTES = MAX_LEGACY_XML_BYTES
    fr._extract_single = _extract_single_guarded  # type: ignore[assignment]
