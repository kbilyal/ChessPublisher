#!/usr/bin/env python3
"""Resilient/offline-first FIDE rating-list layer for Chess-Publisher Linux.

Vesus Pairings' public desktop documentation/changelog describes rating lists as
integrated local data refreshed by a separate "Update rating list data" task.
This adapter applies the same reliability principle without changing the
protected Chess-Publisher UI or the pairing/TRF core:

* Standard/Rapid/Blitz are independently usable local resources.
* Bundled official FIDE ZIPs are used as first-run/offline seeds when present.
* Official FIDE HTTPS remains the primary refresh source.
* curl/wget are native fallbacks when Python urllib has TLS/proxy issues.
* The optional LEGACY XML search index no longer makes the three rating lists
  appear unavailable when its much larger download fails.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import fide_runtime as fr

_APPLIED = False
_ORIGINAL_DOWNLOAD = fr._download_to
_ORIGINAL_INIT = fr.FideRuntime.__init__
_ORIGINAL_STATUS = fr.FideRuntime.status


def _validate_download(path: Path, url: str, max_bytes: int, method: str) -> dict[str, Any]:
    if not path.is_file():
        raise fr.FideRuntimeError(f"FIDE {method} downloader did not create a file: {url}")
    size = path.stat().st_size
    if size < 100:
        raise fr.FideRuntimeError(f"FIDE download is unexpectedly small: {url}")
    if size > max_bytes:
        raise fr.FideRuntimeError(f"FIDE download exceeded safety limit: {url}")
    h = hashlib.sha256()
    with path.open('rb') as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b''):
            h.update(chunk)
    return {
        'url': url,
        'bytes': size,
        'sha256': h.hexdigest(),
        'contentType': 'application/zip',
        'downloadMethod': method,
    }


def _native_download(url: str, target: Path, max_bytes: int, timeout: int) -> dict[str, Any]:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f'.{target.name}.', dir=str(target.parent))
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        curl = shutil.which('curl')
        if curl:
            proc = subprocess.run([
                curl, '--fail', '--location', '--silent', '--show-error',
                '--retry', '3', '--retry-delay', '1', '--connect-timeout', '20',
                '--max-time', str(max(30, int(timeout))),
                '--user-agent', fr.USER_AGENT,
                '--header', 'Accept: application/zip,application/octet-stream;q=0.9,*/*;q=0.1',
                '--output', str(tmp), url,
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=max(45, int(timeout) + 15))
            if proc.returncode == 0:
                result = _validate_download(tmp, url, max_bytes, 'curl')
                os.replace(tmp, target)
                return result

        wget = shutil.which('wget')
        if wget:
            proc = subprocess.run([
                wget, '--quiet', '--tries=3', '--timeout=20',
                '--user-agent', fr.USER_AGENT,
                '--header=Accept: application/zip,application/octet-stream;q=0.9,*/*;q=0.1',
                '-O', str(tmp), url,
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=max(45, int(timeout) + 15))
            if proc.returncode == 0:
                result = _validate_download(tmp, url, max_bytes, 'wget')
                os.replace(tmp, target)
                return result
        raise fr.FideRuntimeError('No working native HTTPS downloader (curl/wget) was available.')
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass


def _resilient_download(url: str, target: Path, max_bytes: int = fr.MAX_ARCHIVE_BYTES, timeout: int = fr.DOWNLOAD_TIMEOUT) -> dict[str, Any]:
    first_error: Exception | None = None
    try:
        result = _ORIGINAL_DOWNLOAD(url, target, max_bytes, timeout)
        result['downloadMethod'] = 'urllib'
        return result
    except Exception as exc:
        first_error = exc
    try:
        return _native_download(url, target, max_bytes, timeout)
    except Exception as native_exc:
        raise fr.FideRuntimeError(
            f"Could not download FIDE data from {url}. Python downloader: {first_error}; native fallback: {native_exc}"
        ) from native_exc


def _seed_candidates() -> list[Path]:
    here = Path(__file__).resolve()
    candidates = [
        here.parents[1] / 'source' / 'fide',   # installed bundle/deb
        here.parents[2] / 'fide',              # repository development checkout
    ]
    out: list[Path] = []
    for path in candidates:
        if path not in out:
            out.append(path)
    return out


def _seed_lists(runtime: fr.FideRuntime) -> None:
    runtime.lists_dir.mkdir(parents=True, exist_ok=True)
    for key, (archive_name, _) in fr.LISTS.items():
        target = runtime.list_path(key)
        if target.is_file() and target.stat().st_size >= 1000:
            continue
        archive = None
        for root in _seed_candidates():
            candidate = root / archive_name
            if candidate.is_file() and candidate.stat().st_size >= 100:
                archive = candidate
                break
        if archive is None:
            continue
        try:
            fr._extract_single(archive, target, '.txt', fr.MAX_EXTRACTED_LIST_BYTES)
        except Exception:
            # A bad bundled seed must never prevent startup; online refresh can repair it.
            try:
                target.unlink()
            except OSError:
                pass


def _init_with_seed(self: fr.FideRuntime, data_dir: Path) -> None:
    _ORIGINAL_INIT(self, data_dir)
    _seed_lists(self)


def _status_lists_first(self: fr.FideRuntime) -> fr.FideStatus:
    status = _ORIGINAL_STATUS(self)
    # The three monthly lists drive registration/player import. LEGACY is an
    # optional enhanced search/index and may be hundreds of MiB.
    lists_ready = all(bool((status.lists.get(key) or {}).get('ready')) for key in fr.LISTS)
    return fr.FideStatus(
        ready=lists_ready,
        lists=status.lists,
        legacy_ready=status.legacy_ready,
        legacy_players=status.legacy_players,
        updated_at=status.updated_at,
    )


def apply() -> None:
    global _APPLIED
    if _APPLIED:
        return
    _APPLIED = True
    fr._download_to = _resilient_download  # type: ignore[assignment]
    fr.FideRuntime.__init__ = _init_with_seed  # type: ignore[assignment]
    fr.FideRuntime.status = _status_lists_first  # type: ignore[assignment]
