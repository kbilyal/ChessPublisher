#!/usr/bin/env python3
"""Pinned Gacrux 1.9.57 runtime for Chess-Publisher Linux.

This module is platform glue only. It does not modify Gacrux algorithms.
The helper is accepted only when its source reports the exact pinned upstream
version and the required source set is complete.
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

UPSTREAM_REPOSITORY = "https://github.com/OttoMilvang/TieBreakServer"
UPSTREAM_COMMIT = "14a34a2c2f36509b110e4f25d6247f31fc4bf2f5"
GACRUX_VERSION = "1.9.57"
GACRUX_VERSION_DATE = "2026-07-21"
ARCHIVE_URL = f"https://codeload.github.com/OttoMilvang/TieBreakServer/zip/{UPSTREAM_COMMIT}"
MAX_ARCHIVE_BYTES = 8 * 1024 * 1024
MAX_TRF_BYTES = 8 * 1024 * 1024
PROCESS_TIMEOUT_SECONDS = 45

# Root files required by pairingchecker/tiebreakchecker imports. Keep the full
# upstream Python tool set so the runtime is not accidentally dependent on a
# subset that only happens to work for one fixture.
SOURCE_FILES = (
    "__init__.py", "berger.py", "chessjson.py", "chessserver.py", "commonmain.py",
    "convert.py", "crosstable.py", "crosstabledutch.py", "drawresult.py", "fidetables.py",
    "games2matches.py", "helpers.py", "jsonscheme.py", "pairing.py", "pairingberger.py",
    "pairingchecker.py", "pairingdutch.py", "qdefs.py", "rating.py", "ratingsimulation.py",
    "scoresystem.py", "tiebreak.py", "tiebreakchecker.py", "tiebreaktest.py",
    "tournamentgenerator.py", "trf2json.py", "ts2json.py", "verifyjch.py", "version.py",
    "xxxmain.py", "requirements.txt", "LICENSE",
)


class GacruxError(RuntimeError):
    pass


@dataclass(frozen=True)
class SourceStatus:
    ready: bool
    source_dir: Path | None
    message: str
    missing: tuple[str, ...] = ()
    networkx_version: str = ""
    source_manifest_sha256: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": True,
            "ready": self.ready,
            "available": self.ready,
            "installed": self.ready,
            "checker": "Gacrux",
            "version": GACRUX_VERSION,
            "versionDate": GACRUX_VERSION_DATE,
            "upstreamCommit": UPSTREAM_COMMIT,
            "source": str(self.source_dir) if self.source_dir else "",
            "networkxVersion": self.networkx_version,
            "sourceManifestSha256": self.source_manifest_sha256,
            "missing": list(self.missing),
            "message": self.message,
        }


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _source_manifest(source_dir: Path) -> tuple[dict[str, str], str]:
    rows: dict[str, str] = {}
    for name in SOURCE_FILES:
        p = source_dir / name
        if p.is_file():
            rows[name] = _sha256_file(p)
    encoded = json.dumps(rows, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return rows, hashlib.sha256(encoded).hexdigest()


def _load_version(source_dir: Path) -> dict[str, Any]:
    path = source_dir / "version.py"
    if not path.is_file():
        return {}
    # Parse the literal values rather than importing arbitrary unverified source.
    text = path.read_text(encoding="utf-8", errors="replace")
    vm = re.search(r'["\']version["\']\s*:\s*["\']([^"\']+)', text)
    dm = re.search(r'["\']version_date["\']\s*:\s*["\']([^"\']+)', text)
    return {"version": vm.group(1) if vm else "", "version_date": dm.group(1) if dm else ""}


def _networkx_version() -> str:
    try:
        import networkx  # type: ignore
        return str(getattr(networkx, "__version__", "unknown"))
    except Exception:
        return ""


def _safe_extract_zip(data: bytes, destination: Path) -> Path:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = [n for n in zf.namelist() if n and not n.endswith("/")]
        if not names:
            raise GacruxError("Official Gacrux source archive is empty.")
        top = names[0].split("/", 1)[0]
        if not top:
            raise GacruxError("Official Gacrux source archive has an invalid root.")
        for info in zf.infolist():
            name = info.filename
            if not name:
                continue
            pp = Path(name)
            if pp.is_absolute() or ".." in pp.parts:
                raise GacruxError("Unsafe path in official Gacrux source archive.")
            # Refuse symlinks from the archive.
            unix_mode = (info.external_attr >> 16) & 0o170000
            if unix_mode == 0o120000:
                raise GacruxError("Symlink in official Gacrux source archive is not accepted.")
        zf.extractall(destination)
        root = destination / top
        if not root.is_dir():
            raise GacruxError("Official Gacrux source archive root was not found.")
        return root


def _read_json_file(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


class GacruxRuntime:
    def __init__(self, bundled_source: Path, installed_source: Path):
        self.bundled_source = bundled_source.resolve()
        self.installed_source = installed_source.expanduser().resolve()

    def _candidate_dirs(self) -> list[Path]:
        # Installed copy wins, because a source-only distribution may intentionally
        # omit the vendor payload and prepare it on first use.
        return [self.installed_source, self.bundled_source]

    def inspect_dir(self, source_dir: Path) -> SourceStatus:
        source_dir = source_dir.resolve()
        missing = tuple(name for name in SOURCE_FILES if not (source_dir / name).is_file())
        ver = _load_version(source_dir)
        nx = _networkx_version()
        if missing:
            return SourceStatus(False, source_dir, "Pinned Gacrux 1.9.57 source is incomplete.", missing, nx)
        if ver.get("version") != GACRUX_VERSION or ver.get("version_date") != GACRUX_VERSION_DATE:
            return SourceStatus(False, source_dir, "Gacrux source version does not match the protected 1.9.57 release.", (), nx)
        if not nx:
            return SourceStatus(False, source_dir, "Python dependency networkx is not installed.", (), nx)
        manifest, manifest_hash = _source_manifest(source_dir)

        installed_marker = source_dir / "CHESS-PUBLISHER-UPSTREAM-VERIFICATION.json"
        bundled_marker = source_dir / "UPSTREAM.json"
        if installed_marker.is_file():
            marker = _read_json_file(installed_marker)
            if marker.get("commit") != UPSTREAM_COMMIT or marker.get("version") != GACRUX_VERSION:
                return SourceStatus(False, source_dir, "Installed Gacrux verification marker does not match the pinned upstream release.", (), nx)
            expected = marker.get("files")
            if not isinstance(expected, dict) or any(expected.get(name) != digest for name, digest in manifest.items()):
                return SourceStatus(False, source_dir, "Installed Gacrux source failed SHA256 integrity verification.", (), nx, manifest_hash)
            if marker.get("sourceManifestSha256") != manifest_hash:
                return SourceStatus(False, source_dir, "Installed Gacrux source manifest checksum changed.", (), nx, manifest_hash)
        elif bundled_marker.is_file():
            marker = _read_json_file(bundled_marker)
            if marker.get("commit") != UPSTREAM_COMMIT or marker.get("version") != GACRUX_VERSION:
                return SourceStatus(False, source_dir, "Bundled Gacrux metadata does not match the pinned upstream release.", (), nx, manifest_hash)
        else:
            return SourceStatus(False, source_dir, "Gacrux source has no pinned-upstream verification metadata.", (), nx, manifest_hash)
        return SourceStatus(True, source_dir, "Pinned official Gacrux 1.9.57 source is ready and integrity-verified.", (), nx, manifest_hash)

    def status(self) -> SourceStatus:
        best: SourceStatus | None = None
        for source_dir in self._candidate_dirs():
            if not source_dir.exists():
                continue
            status = self.inspect_dir(source_dir)
            if status.ready:
                return status
            if best is None or len(status.missing) < len(best.missing):
                best = status
        if best:
            return best
        return SourceStatus(False, None, "Pinned Gacrux 1.9.57 source has not been prepared.", SOURCE_FILES, _networkx_version())

    def install(self, timeout: int = 45) -> dict[str, Any]:
        """Download the immutable upstream commit into the user's data directory."""
        req = urllib.request.Request(
            ARCHIVE_URL,
            headers={"User-Agent": "Chess-Publisher-Linux-Gacrux/1.9.57", "Accept": "application/zip"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read(MAX_ARCHIVE_BYTES + 1)
        except Exception as exc:
            raise GacruxError(f"Could not download pinned Gacrux 1.9.57 source: {exc}") from exc
        if len(data) > MAX_ARCHIVE_BYTES:
            raise GacruxError("Official Gacrux source archive exceeds the safety limit.")
        archive_sha256 = hashlib.sha256(data).hexdigest()
        with tempfile.TemporaryDirectory(prefix="cp-gacrux-install-") as tmp:
            tmp_root = Path(tmp)
            extracted = _safe_extract_zip(data, tmp_root)
            # The upstream repository does not contain Chess-Publisher metadata.
            # Add only the immutable provenance record before validating the copy.
            (extracted / "UPSTREAM.json").write_text(
                json.dumps({"repository": UPSTREAM_REPOSITORY, "commit": UPSTREAM_COMMIT, "version": GACRUX_VERSION, "versionDate": GACRUX_VERSION_DATE}, indent=2) + "\n",
                encoding="utf-8",
            )
            status = self.inspect_dir(extracted)
            if not status.ready:
                detail = f" Missing: {', '.join(status.missing[:8])}" if status.missing else ""
                raise GacruxError(status.message + detail)
            manifest, manifest_sha256 = _source_manifest(extracted)
            marker = {
                "repository": UPSTREAM_REPOSITORY,
                "commit": UPSTREAM_COMMIT,
                "version": GACRUX_VERSION,
                "versionDate": GACRUX_VERSION_DATE,
                "archiveSha256": archive_sha256,
                "sourceManifestSha256": manifest_sha256,
                "files": manifest,
            }
            (extracted / "CHESS-PUBLISHER-UPSTREAM-VERIFICATION.json").write_text(
                json.dumps(marker, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
            parent = self.installed_source.parent
            parent.mkdir(parents=True, exist_ok=True)
            staged = parent / (self.installed_source.name + ".new")
            if staged.exists():
                shutil.rmtree(staged)
            shutil.copytree(extracted, staged)
            old = parent / (self.installed_source.name + ".old")
            if old.exists():
                shutil.rmtree(old)
            if self.installed_source.exists():
                self.installed_source.rename(old)
            staged.rename(self.installed_source)
            if old.exists():
                shutil.rmtree(old)
        final = self.status()
        if not final.ready:
            raise GacruxError("Gacrux 1.9.57 install completed but post-install verification failed.")
        out = final.as_dict()
        out.update({"archiveSha256": archive_sha256, "ready": True})
        return out

    def _ready_dir(self) -> Path:
        status = self.status()
        if not status.ready or not status.source_dir:
            raise GacruxError(status.message)
        return status.source_dir

    @staticmethod
    def _validate_trf(trf: Any) -> str:
        text = str(trf or "")
        if not text.strip():
            raise GacruxError("Gacrux input TRF is empty.")
        if len(text.encode("utf-8")) > MAX_TRF_BYTES:
            raise GacruxError("Gacrux input TRF exceeds the safety limit.")
        return text

    @staticmethod
    def _positive_int(value: Any, label: str) -> int:
        try:
            n = int(value)
        except Exception as exc:
            raise GacruxError(f"{label} must be a positive integer.") from exc
        if n <= 0 or n > 1000:
            raise GacruxError(f"{label} must be a positive integer.")
        return n

    def _run(self, script: str, args: list[str], trf: str, timeout: int = PROCESS_TIMEOUT_SECONDS) -> subprocess.CompletedProcess[str]:
        source = self._ready_dir()
        fd, temp_name = tempfile.mkstemp(prefix="cp-gacrux-", suffix=".trf")
        os.close(fd)
        temp = Path(temp_name)
        try:
            temp.write_text(trf, encoding="utf-8", newline="")
            command = [sys.executable, str(source / script), "-i", str(temp), "-f", "TRF", *args]
            env = os.environ.copy()
            # Ensure sibling upstream modules are resolved from the pinned source.
            env["PYTHONPATH"] = str(source) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
            try:
                proc = subprocess.run(
                    command,
                    cwd=str(source),
                    env=env,
                    text=True,
                    capture_output=True,
                    timeout=timeout,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise GacruxError(f"Gacrux {script} timed out after {timeout} seconds.") from exc
            if proc.returncode != 0:
                detail = (proc.stderr or proc.stdout or "").strip()[-1200:]
                raise GacruxError(f"Gacrux {script} failed with exit code {proc.returncode}. {detail}".strip())
            return proc
        finally:
            try:
                temp.unlink()
            except OSError:
                pass

    @staticmethod
    def parse_pairing_text(output: str) -> list[tuple[int, int]]:
        lines = [line.strip() for line in str(output or "").replace("\r", "").split("\n") if line.strip()]
        if not lines or not re.fullmatch(r"\d+", lines[0]):
            raise GacruxError("Gacrux pairing output does not begin with a pair count.")
        count = int(lines[0])
        if count <= 0 or count > 1000 or len(lines) < count + 1:
            raise GacruxError("Gacrux pairing output pair count is invalid.")
        pairs: list[tuple[int, int]] = []
        seen: set[int] = set()
        for line in lines[1:count + 1]:
            m = re.fullmatch(r"\s*(\d+)\s+(\d+)\s*", line)
            if not m:
                raise GacruxError("Gacrux pairing output contains an invalid pair line.")
            white, black = int(m.group(1)), int(m.group(2))
            if white <= 0 or black < 0 or white in seen or (black and black in seen) or white == black:
                raise GacruxError("Gacrux pairing output contains an invalid or duplicate Pairing No.")
            seen.add(white)
            if black:
                seen.add(black)
            pairs.append((white, black))
        return pairs

    def pair(self, request: dict[str, Any]) -> dict[str, Any]:
        trf = self._validate_trf(request.get("trf"))
        rnd = self._positive_int(request.get("round"), "Round")
        rounds = self._positive_int(request.get("rounds"), "Number of rounds")
        if rnd > rounds:
            raise GacruxError("Round cannot exceed the declared number of rounds.")
        top = str(request.get("topColor") or "W").strip().lower()
        if top not in {"w", "b"}:
            raise GacruxError("Initial top color must be W or B.")
        raw_unpaired = request.get("unpaired") or []
        if not isinstance(raw_unpaired, list) or len(raw_unpaired) > 2000:
            raise GacruxError("Unpaired list is invalid.")
        unpaired: list[int] = []
        for value in raw_unpaired:
            try:
                n = int(value)
            except Exception as exc:
                raise GacruxError("Unpaired Pairing No. must be an integer.") from exc
            if n <= 0 or n > 99999:
                raise GacruxError("Unpaired Pairing No. is out of range.")
            if n not in unpaired:
                unpaired.append(n)
        args = ["-p", "-d", "T", "-n", str(rnd), "-N", str(rounds), "-t", top]
        if unpaired:
            args.extend(["-u", *map(str, unpaired)])
        proc = self._run("pairingchecker.py", args, trf)
        pairs = self.parse_pairing_text(proc.stdout)
        return {
            "ok": True,
            "output": proc.stdout,
            "pairs": [[w, b] for w, b in pairs],
            "checker": "Gacrux Pairing Checker",
            "version": GACRUX_VERSION,
            "upstreamCommit": UPSTREAM_COMMIT,
            # BBP is intentionally still a separate independent gate.
            "independentChecker": {
                "state": "unavailable", "available": False, "ok": False, "check": None,
                "round": rnd, "checker": "bbpPairings", "version": "6.0.0",
                "message": "Independent bbpPairings checker is not connected on Linux yet. Gacrux self-pairing completed successfully.",
            },
        }

    @staticmethod
    def _parse_json_output(output: str) -> dict[str, Any]:
        text = str(output or "").strip()
        if not text:
            raise GacruxError("Gacrux returned no JSON output.")
        try:
            value = json.loads(text)
        except Exception as exc:
            # Be tolerant of a diagnostic prefix, but require a complete JSON object.
            start = text.find("{")
            end = text.rfind("}")
            if start < 0 or end <= start:
                raise GacruxError("Gacrux returned invalid JSON output.") from exc
            try:
                value = json.loads(text[start:end + 1])
            except Exception as exc2:
                raise GacruxError("Gacrux returned invalid JSON output.") from exc2
        if not isinstance(value, dict):
            raise GacruxError("Gacrux JSON output must be an object.")
        return value

    @staticmethod
    def _numeric_equal(a: Any, b: Any, tolerance: float = 1e-6) -> bool:
        try:
            return abs(float(a) - float(b)) <= tolerance
        except Exception:
            return str(a) == str(b)

    def tiebreak_check(self, request: dict[str, Any], use_trf_descriptors: bool = False) -> dict[str, Any]:
        trf = self._validate_trf(request.get("trf"))
        rnd = self._positive_int(request.get("round"), "Round")
        mode = str(request.get("mode") or "swiss").strip().lower()
        if mode not in {"swiss", "rr"}:
            raise GacruxError("Tie-break checker mode must be swiss or rr.")
        ties_raw = request.get("tieBreaks") or []
        if not isinstance(ties_raw, list):
            raise GacruxError("Tie-break descriptor list is invalid.")
        ties = [str(x).strip() for x in ties_raw if str(x).strip()]
        if len(ties) > 32 or any(len(x) > 120 for x in ties):
            raise GacruxError("Tie-break descriptor list is too large.")
        args = ["-n", str(rnd), "-r", "-s" if mode == "swiss" else "-p"]
        unrated = request.get("unratedRating")
        if unrated is not None and str(unrated).strip() != "":
            try:
                r = int(float(unrated))
            except Exception as exc:
                raise GacruxError("Unrated replacement rating is invalid.") from exc
            if r < 0 or r > 4000:
                raise GacruxError("Unrated replacement rating is out of range.")
            args.extend(["-u", str(r)])
        if ties and not use_trf_descriptors:
            args.extend(["-t", *ties])
        proc = self._run("tiebreakchecker.py", args, trf)
        raw = self._parse_json_output(proc.stdout)
        result = raw.get("tiebreakResult")
        if not isinstance(result, dict):
            # Some commonmain outputs expose the result directly during service use.
            result = raw.get("result") if isinstance(raw.get("result"), dict) else raw
        competitors = result.get("competitors") if isinstance(result, dict) else None
        if not isinstance(competitors, list):
            raise GacruxError("Gacrux tie-break output does not contain competitors.")
        by_id: dict[int, dict[str, Any]] = {}
        for row in competitors:
            if not isinstance(row, dict):
                continue
            try:
                cid = int(row.get("cid"))
            except Exception:
                continue
            if cid > 0:
                by_id[cid] = row

        # Prefer the requested descriptors; for TRF exchange, derive descriptor
        # names from upstream result if they are present.
        effective_ties = ties[:]
        if not effective_ties:
            tb_defs = result.get("tiebreaks") if isinstance(result, dict) else None
            if isinstance(tb_defs, list):
                for item in tb_defs:
                    if isinstance(item, str):
                        effective_ties.append(item)
                    elif isinstance(item, dict):
                        name = str(item.get("name") or item.get("tieBreak") or item.get("key") or "").strip()
                        if name:
                            effective_ties.append(name)
        expected = request.get("expected") or []
        if not isinstance(expected, list):
            raise GacruxError("Expected standings snapshot is invalid.")
        mismatches: list[dict[str, Any]] = []
        for exp in expected:
            if not isinstance(exp, dict):
                continue
            try:
                cid = int(exp.get("startNo"))
            except Exception:
                continue
            actual = by_id.get(cid)
            if actual is None:
                mismatches.append({"startNo": cid, "field": "player", "expected": "present", "actual": "missing"})
                continue
            try:
                erank = int(exp.get("rank"))
                arank = int(actual.get("rank"))
                if erank != arank:
                    mismatches.append({"startNo": cid, "field": "rank", "expected": erank, "actual": arank})
            except Exception:
                mismatches.append({"startNo": cid, "field": "rank", "expected": exp.get("rank"), "actual": actual.get("rank")})
            values = exp.get("values") if isinstance(exp.get("values"), dict) else {}
            scores = actual.get("tiebreakScore")
            if not isinstance(scores, list):
                scores = actual.get("score") if isinstance(actual.get("score"), list) else []
            # Upstream receives exactly the requested list, so scores are aligned.
            for index, desc in enumerate(effective_ties):
                if desc not in values or index >= len(scores):
                    continue
                if not self._numeric_equal(values.get(desc), scores[index]):
                    mismatches.append({"startNo": cid, "field": desc, "expected": values.get(desc), "actual": scores[index]})
        state = "pass" if not mismatches else "fail"
        return {
            "ok": True,
            "state": state,
            "available": True,
            "check": not mismatches,
            "round": rnd,
            "checker": "Gacrux Tie-Break Checker",
            "version": GACRUX_VERSION,
            "upstreamCommit": UPSTREAM_COMMIT,
            "message": "Computed Gacrux ranking matches Chess-Publisher." if not mismatches else f"Gacrux found {len(mismatches)} ranking/tie-break mismatch(es).",
            "mismatches": mismatches[:200],
            "output": proc.stdout,
        }
