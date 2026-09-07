#!/usr/bin/env python3
"""Real Linux acceptance gate for Chess-Publisher protected pairing helpers.

Runs only on a network-enabled Ubuntu/CI runner. It downloads the exact pinned
Gacrux 1.9.57 source and bbpPairings 6.0.0 x86_64 Linux release, verifies their
identity, then checks real Chess-Publisher TRF fixtures with both independent
engines. It never changes Chess-Publisher pairing/TRF data.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "chesspublisher-test-tournament-trf26.TXT"
GACRUX_COMMIT = "14a34a2c2f36509b110e4f25d6247f31fc4bf2f5"
GACRUX_VERSION = "1.9.57"
GACRUX_DATE = "2026-07-21"
GACRUX_URL = f"https://codeload.github.com/OttoMilvang/TieBreakServer/zip/{GACRUX_COMMIT}"
BBP_VERSION = "6.0.0"
BBP_URL = "https://github.com/BieremaBoyzProgramming/bbpPairings/releases/download/v6.0.0/bbpPairings-v6.0.0-x86_64-pc-linux.tar.gz"
BBP_ARCHIVE_SHA256 = "bffd2d5a4dc9d86eb3d9886339e8ca446d88683f77559f0889ea0d2040e7d827"
TIMEOUT = 90


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def download(url: str, max_bytes: int = 16 * 1024 * 1024) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Chess-Publisher-Linux-Acceptance/1"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        data = r.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise RuntimeError(f"download too large: {url}")
    return data


def safe_zip(data: bytes, target: Path) -> Path:
    archive = target.parent / "gacrux.zip"
    archive.write_bytes(data)
    with zipfile.ZipFile(archive) as zf:
        roots = set()
        for info in zf.infolist():
            p = Path(info.filename)
            if p.is_absolute() or ".." in p.parts:
                raise RuntimeError("unsafe Gacrux archive path")
            if p.parts:
                roots.add(p.parts[0])
        if len(roots) != 1:
            raise RuntimeError("unexpected Gacrux archive root")
        zf.extractall(target)
    return target / next(iter(roots))


def safe_tar(data: bytes, target: Path) -> Path:
    archive = target.parent / "bbp.tar.gz"
    archive.write_bytes(data)
    with tarfile.open(archive, "r:gz") as tf:
        for member in tf.getmembers():
            p = Path(member.name)
            if p.is_absolute() or ".." in p.parts or member.issym() or member.islnk():
                raise RuntimeError("unsafe BBP archive path")
        tf.extractall(target, filter="data")
    candidates = [p for p in target.rglob("*") if p.is_file() and p.name.lower() in {"bbppairings", "bbppairings.exe"}]
    if not candidates:
        raise RuntimeError("bbpPairings executable not found")
    exe = sorted(candidates, key=lambda p: len(p.parts))[0]
    exe.chmod(exe.stat().st_mode | 0o755)
    return exe


def run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    print("$", " ".join(cmd))
    cp = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, timeout=TIMEOUT, check=False)
    if cp.stdout:
        print(cp.stdout[-6000:])
    if cp.stderr:
        print(cp.stderr[-4000:], file=sys.stderr)
    return cp


def parse_gacrux_json(stdout: str) -> dict:
    text = stdout.strip()
    candidates = [text]
    first = text.find("{")
    last = text.rfind("}")
    if 0 <= first < last:
        candidates.append(text[first:last + 1])
    for item in candidates:
        try:
            value = json.loads(item)
            if isinstance(value, dict):
                return value
        except Exception:
            pass
    return {}


def convert_162_a_to_z(text: str) -> str:
    # Historical Chess-Publisher independent-checker compatibility transform.
    # The canonical fixture itself is never modified.
    out = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if line.startswith("162"):
            line = re.sub(r"(?<=\s)A(?=\s+[-+]?\d)", "Z", line, count=1)
        out.append(line)
    return "\n".join(out)


def main() -> int:
    if not FIXTURE.is_file():
        raise RuntimeError(f"missing fixture: {FIXTURE}")
    fixture_text = FIXTURE.read_text(encoding="utf-8-sig")
    if not fixture_text.startswith("012 ") or "192 FIDE_DUTCH_2025" not in fixture_text:
        raise RuntimeError("fixture is not the expected TRF26 Dutch test tournament")

    with tempfile.TemporaryDirectory(prefix="cp-linux-real-") as td_raw:
        td = Path(td_raw)

        print("== Gacrux 1.9.57 pinned source ==")
        gacrux_data = download(GACRUX_URL)
        gacrux = safe_zip(gacrux_data, td / "gacrux")
        version_text = (gacrux / "version.py").read_text(encoding="utf-8")
        if f'"version": "{GACRUX_VERSION}"' not in version_text or f'"version_date": "{GACRUX_DATE}"' not in version_text:
            raise RuntimeError("Gacrux version/date mismatch")
        print("Gacrux commit:", GACRUX_COMMIT)
        print("Gacrux version: PASS", GACRUX_VERSION, GACRUX_DATE)

        print("== bbpPairings 6.0.0 verified Linux release ==")
        bbp_data = download(BBP_URL)
        got = sha256(bbp_data)
        if got != BBP_ARCHIVE_SHA256:
            raise RuntimeError(f"BBP archive SHA256 mismatch: {got}")
        print("BBP archive SHA256: PASS", got)
        bbp = safe_tar(bbp_data, td / "bbp")

        fixture = td / "fixture.trf"
        fixture.write_text(fixture_text, encoding="utf-8", newline="")

        print("== Gacrux check of real Chess-Publisher TRF26 ==")
        gacrux_cmd = [sys.executable, str(gacrux / "pairingchecker.py"), "-i", str(fixture), "-f", "TRF", "-m", "dutch", "-c", "-d", "J"]
        gc = run(gacrux_cmd, cwd=gacrux)
        gj = parse_gacrux_json(gc.stdout)
        status_code = gj.get("status", {}).get("code") if gj else None
        if gc.returncode != 0 or (status_code not in (None, 0)):
            raise RuntimeError(f"Gacrux rejected fixture (process={gc.returncode}, status={status_code})")
        print("Gacrux TRF pairing check: PASS")

        print("== bbpPairings raw TRF26 check ==")
        bc_raw = run([str(bbp), "--dutch", str(fixture), "-c"])
        raw_ok = bc_raw.returncode == 0
        print("BBP raw TRF26:", "PASS" if raw_ok else f"NOT ACCEPTED (rc={bc_raw.returncode})")

        print("== bbpPairings historical temporary A->Z checker copy ==")
        legacy = td / "fixture-bbp-legacy.trf"
        legacy.write_text(convert_162_a_to_z(fixture_text), encoding="utf-8", newline="")
        bc_legacy = run([str(bbp), "--dutch", str(legacy), "-c"])
        legacy_ok = bc_legacy.returncode == 0
        print("BBP A->Z temporary copy:", "PASS" if legacy_ok else f"FAIL (rc={bc_legacy.returncode})")

        if not raw_ok and not legacy_ok:
            raise RuntimeError("bbpPairings rejected both canonical TRF26 and temporary compatibility copy")

        result = {
            "gacrux": {"commit": GACRUX_COMMIT, "version": GACRUX_VERSION, "check": True},
            "bbp": {"version": BBP_VERSION, "archiveSha256": got, "rawTrf26Accepted": raw_ok, "legacy162AtoZAccepted": legacy_ok},
            "fixture": FIXTURE.name,
        }
        report = ROOT / "tests" / "logs" / "real-linux-acceptance.json"
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(result, indent=2, sort_keys=True))
        print("REAL_LINUX_ACCEPTANCE=PASS")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
