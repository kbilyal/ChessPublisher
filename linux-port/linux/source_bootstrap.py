#!/usr/bin/env python3
"""Bootstrap the exact pinned protected source for a Linux development checkout.

The protected application source is verified by source_manifest.json and must
never silently fall back to the older repository-root ChessPublisher.html.
When a source tree is absent, this helper may restore it from the exact
beta.34 recovery archive supplied alongside the checkout or in the user's
Downloads directory. The archive and the extracted source are both verified
before activation.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import tarfile
import tempfile
from pathlib import Path
from typing import Any

from source_guard import SourceIdentityError, verify_source

ARCHIVE_NAME = "Chess-Publisher-v1.06.00-beta.34-protected-source.tar.gz"
ARCHIVE_SHA256 = "19d6f55bd6954db4cd6327ad61892b538e5b7a7129ac1fce2adf5e3ec2176eff"
MAX_ARCHIVE_BYTES = 2 * 1024 * 1024
MAX_EXTRACTED_BYTES = 8 * 1024 * 1024


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _archive_candidates(package_root: Path) -> list[Path]:
    home = Path.home()
    raw = [
        package_root / ARCHIVE_NAME,
        package_root.parent / ARCHIVE_NAME,
        home / "Downloads" / ARCHIVE_NAME,
        home / "Изтегляния" / ARCHIVE_NAME,
    ]
    out: list[Path] = []
    seen: set[Path] = set()
    for item in raw:
        resolved = item.expanduser().resolve()
        if resolved not in seen:
            seen.add(resolved)
            out.append(resolved)
    return out


def _safe_members(tf: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members = tf.getmembers()
    if not members:
        raise SourceIdentityError("Protected source recovery archive is empty.")
    total = 0
    for member in members:
        p = Path(member.name)
        if p.is_absolute() or ".." in p.parts:
            raise SourceIdentityError(f"Unsafe recovery archive path: {member.name}")
        if not p.parts or p.parts[0] not in {"source", "SHA256SUMS.txt"}:
            raise SourceIdentityError(f"Unexpected recovery archive entry: {member.name}")
        if member.issym() or member.islnk() or member.isdev() or member.isfifo():
            raise SourceIdentityError(f"Unsafe recovery archive entry type: {member.name}")
        if member.isfile():
            total += int(member.size or 0)
            if total > MAX_EXTRACTED_BYTES:
                raise SourceIdentityError("Protected source recovery archive exceeds extraction limit.")
        elif not member.isdir():
            raise SourceIdentityError(f"Unsupported recovery archive entry: {member.name}")
    return members


def ensure_source(package_root: Path) -> dict[str, Any]:
    root = package_root.expanduser().resolve()
    source = root / "source"
    manifest = root / "source_manifest.json"

    try:
        result = verify_source(source, manifest)
        result["bootstrapped"] = False
        return result
    except SourceIdentityError:
        # Never repair/overwrite a non-empty source tree: that could conceal
        # user edits or corruption. Only a genuinely absent source may recover.
        if source.exists() and any(source.rglob("*")):
            raise

    archive = next((p for p in _archive_candidates(root) if p.is_file()), None)
    if archive is None:
        locations = "\n  - ".join(str(p) for p in _archive_candidates(root))
        raise SourceIdentityError(
            "Required protected source is not present in this Git checkout.\n"
            f"Place {ARCHIVE_NAME} in one of these locations and start again:\n  - {locations}"
        )
    size = archive.stat().st_size
    if size <= 0 or size > MAX_ARCHIVE_BYTES:
        raise SourceIdentityError(f"Protected source recovery archive size is invalid: {size} bytes")
    digest = _sha256(archive)
    if digest != ARCHIVE_SHA256:
        raise SourceIdentityError(
            "Protected source recovery archive SHA256 mismatch; refusing to use it. "
            f"Expected {ARCHIVE_SHA256}, got {digest}."
        )

    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cp-source-bootstrap-", dir=str(root)) as td_raw:
        td = Path(td_raw)
        try:
            with tarfile.open(archive, "r:gz") as tf:
                members = _safe_members(tf)
                tf.extractall(td, members=members, filter="data")
        except (OSError, tarfile.TarError) as exc:
            raise SourceIdentityError(f"Could not extract protected source recovery archive: {exc}") from exc
        staged = td / "source"
        verified = verify_source(staged, manifest)
        if source.exists():
            shutil.rmtree(source)
        os.replace(staged, source)
        verified = verify_source(source, manifest)
        verified["bootstrapped"] = True
        verified["archive"] = str(archive)
        return verified


if __name__ == "__main__":
    package_root = Path(__file__).resolve().parent.parent
    result = ensure_source(package_root)
    state = "RESTORED" if result.get("bootstrapped") else "READY"
    print(f"PROTECTED_SOURCE_{state}={result.get('snapshotId')}")
