#!/usr/bin/env python3
"""Offline seed/cache layer for Chess-Publisher Linux FIDE rating lists.

Vesus Pairings documents an offline-first rating-list workflow: once a list has
been downloaded and indexed, the desktop application keeps it locally and can
continue searching without network access.  Chess-Publisher already carries
verified FIDE Standard/Rapid/Blitz snapshots in the repository.  This layer
uses those snapshots only as a seed/fallback when the official FIDE endpoint is
unreachable; an official successful refresh always has priority.
"""
from __future__ import annotations

import tempfile
import time
from pathlib import Path
from typing import Any, Iterable

import fide_download_integration as fd
import fide_runtime as fr

_APPLIED = False
_MODULE = Path(__file__).resolve()
CACHE_DIRS = (
    _MODULE.parent.parent / "fide-cache",  # installed .deb
    _MODULE.parents[2] / "fide",           # development checkout
)
_ORIGINAL_DOWNLOAD_CANDIDATES = fd._download_archive_candidates
_ORIGINAL_RUNTIME_INIT = fr.FideRuntime.__init__


def _find_cache(archive_name: str, max_bytes: int) -> tuple[Path, dict[str, Any]] | None:
    for directory in CACHE_DIRS:
        path = directory / archive_name
        if not path.is_file():
            continue
        try:
            size, digest = fd._validate_zip(path, str(path), max_bytes)
        except Exception:
            continue
        return path, {
            "url": str(path),
            "finalUrl": str(path),
            "bytes": size,
            "sha256": digest,
            "contentType": "application/zip",
            "transport": "local-cache",
            "cached": True,
            "cachePath": str(path),
        }
    return None


def _download_archive_candidates(
    archive_names: Iterable[str],
    work: Path,
    max_bytes: int = fr.MAX_ARCHIVE_BYTES,
    timeout: int = fd.DOWNLOAD_TIMEOUT,
) -> tuple[str, Path, dict[str, Any]]:
    names = tuple(str(name) for name in archive_names)
    try:
        return _ORIGINAL_DOWNLOAD_CANDIDATES(names, work, max_bytes=max_bytes, timeout=timeout)
    except Exception as network_exc:
        for archive_name in names:
            cached = _find_cache(archive_name, max_bytes)
            if cached is None:
                continue
            path, meta = cached
            meta["networkError"] = str(network_exc)
            meta["attempts"] = [
                {"url": "official-fide", "transport": "network", "result": "failed"},
                {"url": str(path), "transport": "local-cache", "result": "success"},
            ]
            return archive_name, path, meta
        raise


def _seed_lists(runtime: fr.FideRuntime) -> dict[str, Any]:
    seeded: dict[str, Any] = {}
    metadata = runtime._metadata()
    list_meta = dict(metadata.get("lists") or {})
    with tempfile.TemporaryDirectory(prefix="cp-fide-seed-") as td_raw:
        work = Path(td_raw)
        for key, (archive_name, _) in fr.LISTS.items():
            target = runtime.list_path(key)
            if target.is_file() and target.stat().st_size >= fd.MIN_RATING_LIST_BYTES:
                continue
            cached = _find_cache(archive_name, fr.MAX_ARCHIVE_BYTES)
            if cached is None:
                continue
            archive, cache_meta = cached
            staged = work / f"seed-{key}.txt"
            extract = fr._extract_single(
                archive, staged, ".txt", fr.MAX_EXTRACTED_LIST_BYTES
            )
            validation = fd._validate_rating_txt(staged, key)
            fd._atomic_copy(staged, target)
            item = {
                "source": str(archive),
                "transport": "local-cache",
                "cached": True,
                "seeded": True,
                "archiveSha256": cache_meta["sha256"],
                "archiveBytes": cache_meta["bytes"],
                **extract,
                **validation,
                "seededAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            list_meta[key] = item
            seeded[key] = item
    if seeded:
        metadata["lists"] = list_meta
        metadata.setdefault("updatedAt", "")
        fr._atomic_json(runtime.metadata_file, metadata)
    return seeded


def _runtime_init(self: fr.FideRuntime, *args: Any, **kwargs: Any) -> None:
    _ORIGINAL_RUNTIME_INIT(self, *args, **kwargs)
    try:
        _seed_lists(self)
    except Exception:
        # A seed is a convenience fallback, never a startup requirement.
        pass


def apply() -> None:
    global _APPLIED
    if _APPLIED:
        return
    _APPLIED = True
    fd._download_archive_candidates = _download_archive_candidates  # type: ignore[assignment]
    fr.FideRuntime.__init__ = _runtime_init  # type: ignore[assignment]
