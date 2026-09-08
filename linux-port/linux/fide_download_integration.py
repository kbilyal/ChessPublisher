#!/usr/bin/env python3
"""Resilient native FIDE rating-list downloader for Chess-Publisher Linux.

The Linux desktop follows the same offline-first model documented by Vesus
Pairings: rating lists are downloaded from their federation source, validated,
indexed/stored locally, and then used without requiring a live network request.

This integration changes only the FIDE network/update layer.  The protected
Chess-Publisher HTML and tournament core remain untouched.  A previously valid
local list is never replaced until a complete official ZIP and its payload have
passed validation.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Iterable

import fide_runtime as fr
import fide_streaming_integration as fs

_APPLIED = False
FIDE_DOWNLOAD_ROOTS = (
    "https://ratings.fide.com/download",
    "http://ratings.fide.com/download",
)
# FIDE's current combined XML is the primary local player directory.  The
# legacy-format archive remains a compatibility fallback only.
DIRECTORY_XML_ARCHIVES = ("players_list_xml.zip", fr.LEGACY_XML_ARCHIVE)
USER_AGENT = "Chess-Publisher/1.06 Linux (FIDE rating-list updater)"
REFERER = "https://ratings.fide.com/download_lists.phtml"
CONNECT_TIMEOUT = 15
DOWNLOAD_TIMEOUT = 120
RETRIES = 1
MIN_RATING_LIST_BYTES = 1000


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _source_urls(archive_name: str) -> list[str]:
    name = str(archive_name or "").strip().lstrip("/")
    if not name or "/" in name or "\\" in name or name in {".", ".."}:
        raise fr.FideRuntimeError("Invalid FIDE archive name.")
    return [f"{root}/{name}" for root in FIDE_DOWNLOAD_ROOTS]


def _validate_zip(path: Path, url: str, max_bytes: int) -> tuple[int, str]:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise fr.FideRuntimeError(f"FIDE download was not created: {url}") from exc
    if size < 100:
        raise fr.FideRuntimeError(f"FIDE download is unexpectedly small: {url}")
    if size > max_bytes:
        raise fr.FideRuntimeError(f"FIDE download exceeded safety limit: {url}")
    if not zipfile.is_zipfile(path):
        raise fr.FideRuntimeError(f"FIDE response is not a valid ZIP archive: {url}")
    with zipfile.ZipFile(path) as zf:
        fr._safe_zip_members(zf)
    return size, _sha256(path)


def _curl_download(url: str, target: Path, max_bytes: int, timeout: int) -> dict[str, Any] | None:
    curl = shutil.which("curl")
    if not curl:
        return None
    try:
        target.unlink()
    except FileNotFoundError:
        pass
    args = [
        curl,
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--retry",
        str(RETRIES),
        "--retry-delay",
        "1",
        "--retry-connrefused",
        "--connect-timeout",
        str(CONNECT_TIMEOUT),
        "--max-time",
        str(timeout),
        "--max-filesize",
        str(max_bytes),
        "--header",
        f"User-Agent: {USER_AGENT}",
        "--header",
        "Accept: application/zip, application/octet-stream;q=0.9, */*;q=0.1",
        "--header",
        "Accept-Encoding: identity",
        "--header",
        f"Referer: {REFERER}",
        "--output",
        str(target),
        "--write-out",
        "%{url_effective}\n%{http_code}\n%{content_type}\n",
        url,
    ]
    try:
        proc = subprocess.run(args, check=False, capture_output=True, text=True, timeout=timeout + 20)
    except (OSError, subprocess.TimeoutExpired) as exc:
        try:
            target.unlink()
        except OSError:
            pass
        raise fr.FideRuntimeError(f"curl could not download FIDE data from {url}: {exc}") from exc
    if proc.returncode != 0:
        try:
            target.unlink()
        except OSError:
            pass
        detail = (proc.stderr or proc.stdout or f"curl exit {proc.returncode}").strip()
        raise fr.FideRuntimeError(f"curl could not download FIDE data from {url}: {detail}")
    lines = (proc.stdout or "").splitlines()
    final_url = lines[-3].strip() if len(lines) >= 3 else url
    http_code = lines[-2].strip() if len(lines) >= 2 else ""
    ctype = lines[-1].strip() if lines else ""
    size, digest = _validate_zip(target, final_url or url, max_bytes)
    return {
        "url": url,
        "finalUrl": final_url or url,
        "httpCode": http_code,
        "bytes": size,
        "sha256": digest,
        "contentType": ctype,
        "transport": "curl",
    }


def _urllib_download(url: str, target: Path, max_bytes: int, timeout: int) -> dict[str, Any]:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=str(target.parent))
    total = 0
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/zip,application/octet-stream;q=0.9,*/*;q=0.1",
                "Accept-Encoding": "identity",
                "Referer": REFERER,
                "Cache-Control": "no-cache",
                "Connection": "close",
            },
        )
        with os.fdopen(fd, "wb") as out, urllib.request.urlopen(req, timeout=timeout) as resp:
            content_length = str(resp.headers.get("Content-Length") or "").strip()
            if content_length.isdigit() and int(content_length) > max_bytes:
                raise fr.FideRuntimeError(f"FIDE download exceeded safety limit before transfer: {url}")
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise fr.FideRuntimeError(f"FIDE download exceeded safety limit: {url}")
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
            final_url = str(resp.geturl() or url)
            ctype = str(resp.headers.get("Content-Type") or "")
            status = str(getattr(resp, "status", "") or "")
        tmp = Path(tmp_name)
        size, digest = _validate_zip(tmp, final_url, max_bytes)
        os.replace(tmp_name, target)
        return {
            "url": url,
            "finalUrl": final_url,
            "httpCode": status,
            "bytes": size,
            "sha256": digest,
            "contentType": ctype,
            "transport": "python-urllib",
        }
    except Exception as exc:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        if isinstance(exc, fr.FideRuntimeError):
            raise
        raise fr.FideRuntimeError(f"Python could not download FIDE data from {url}: {exc}") from exc


def _download_to(
    urls: str | Iterable[str],
    target: Path,
    max_bytes: int = fr.MAX_ARCHIVE_BYTES,
    timeout: int = DOWNLOAD_TIMEOUT,
) -> dict[str, Any]:
    candidates = [urls] if isinstance(urls, str) else [str(u) for u in urls]
    candidates = [u.strip() for u in candidates if str(u).strip()]
    if not candidates:
        raise fr.FideRuntimeError("No FIDE download URL was supplied.")
    target.parent.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    attempts: list[dict[str, str]] = []
    curl_available = bool(shutil.which("curl"))
    for url in candidates:
        if not re.match(r"^https?://", url, flags=re.I):
            errors.append(f"{url}: unsupported URL scheme")
            continue
        if curl_available:
            staged = target.with_name(f".{target.name}.curl-{os.getpid()}-{time.time_ns()}")
            try:
                meta = _curl_download(url, staged, max_bytes, timeout)
                if meta is not None:
                    os.replace(staged, target)
                    meta["attempts"] = attempts + [
                        {"url": url, "transport": "curl", "result": "success"}
                    ]
                    return meta
            except Exception as exc:
                attempts.append({"url": url, "transport": "curl", "result": "failed"})
                errors.append(str(exc))
                try:
                    staged.unlink()
                except OSError:
                    pass
                continue
        try:
            meta = _urllib_download(url, target, max_bytes, timeout)
            meta["attempts"] = attempts + [
                {"url": url, "transport": "python-urllib", "result": "success"}
            ]
            return meta
        except Exception as exc:
            attempts.append({"url": url, "transport": "python-urllib", "result": "failed"})
            errors.append(str(exc))
    raise fr.FideRuntimeError("All FIDE download attempts failed. " + "; ".join(errors[-6:]))


def _download_archive_candidates(
    archive_names: Iterable[str],
    work: Path,
    max_bytes: int = fr.MAX_ARCHIVE_BYTES,
    timeout: int = DOWNLOAD_TIMEOUT,
) -> tuple[str, Path, dict[str, Any]]:
    errors: list[str] = []
    for archive_name in archive_names:
        try:
            archive = work / archive_name
            meta = _download_to(_source_urls(archive_name), archive, max_bytes=max_bytes, timeout=timeout)
            return archive_name, archive, meta
        except Exception as exc:
            errors.append(f"{archive_name}: {exc}")
    raise fr.FideRuntimeError("No usable official FIDE archive was available. " + "; ".join(errors))


def _validate_rating_txt(path: Path, list_type: str) -> dict[str, Any]:
    size = path.stat().st_size if path.is_file() else 0
    if size < MIN_RATING_LIST_BYTES:
        raise fr.FideRuntimeError(f"FIDE {list_type} rating list is incomplete (bytes={size}).")
    with path.open("rb") as f:
        head = f.read(64 * 1024)
    text = head.decode("latin-1", errors="ignore").casefold().replace("\ufeff", "")
    if not all(marker in text for marker in ("id number", "name", "fed")):
        raise fr.FideRuntimeError(f"FIDE {list_type} TXT header was not recognised; previous list kept.")
    return {"validated": True, "format": "FIDE fixed-width TXT", "bytes": size}


def _atomic_copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=str(target.parent))
    try:
        with source.open("rb") as src, os.fdopen(fd, "wb") as out:
            shutil.copyfileobj(src, out, length=1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp_name, target)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _update_list(self: fr.FideRuntime, key: str, work: Path) -> dict[str, Any]:
    archive_name, _ = fr.LISTS[key]
    used_name, archive, dl = _download_archive_candidates((archive_name,), work)
    staged = work / f"validated-{key}.txt"
    extract = fr._extract_single(archive, staged, ".txt", fr.MAX_EXTRACTED_LIST_BYTES)
    validation = _validate_rating_txt(staged, key)
    _atomic_copy(staged, self.list_path(key))
    return {
        "source": str(dl.get("finalUrl") or dl.get("url") or ""),
        "archiveName": used_name,
        "transport": dl.get("transport"),
        "archiveSha256": dl["sha256"],
        "archiveBytes": dl["bytes"],
        "attempts": dl.get("attempts", []),
        **extract,
        **validation,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def _update_legacy(self: fr.FideRuntime, work: Path) -> dict[str, Any]:
    used_name, archive, dl = _download_archive_candidates(
        DIRECTORY_XML_ARCHIVES, work, max_bytes=fs.MAX_LEGACY_ARCHIVE_BYTES
    )
    indexed = fs.build_legacy_index_from_zip(
        archive, self.legacy_db, max_xml_bytes=fs.MAX_LEGACY_XML_STREAM_BYTES
    )
    return {
        "source": str(dl.get("finalUrl") or dl.get("url") or ""),
        "archiveName": used_name,
        "transport": dl.get("transport"),
        "archiveSha256": dl["sha256"],
        "archiveBytes": dl["bytes"],
        "attempts": dl.get("attempts", []),
        **indexed,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def apply() -> None:
    global _APPLIED
    if _APPLIED:
        return
    _APPLIED = True
    fr._download_to = _download_to  # type: ignore[assignment]
    fr.FideRuntime._update_list = _update_list  # type: ignore[assignment]
    fr.FideRuntime._update_legacy = _update_legacy  # type: ignore[assignment]
