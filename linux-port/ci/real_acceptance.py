#!/usr/bin/env python3
"""Real Ubuntu pairing and standings equivalence gate for Chess-Publisher.

Uses real Chess-Publisher TRF fixtures and the same protected architecture as
the desktop application: Gacrux 1.9.57 generates the round, bbpPairings 6.0.0
independently generates it, then Gacrux Tie-Break Checker recomputes final
standings. Nothing in either upstream engine is modified.
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
FIXTURE = ROOT / "tests" / "fixtures" / "pairing-engine-r7.trf"
RATING_FIXTURE = ROOT / "tests" / "fixtures" / "chesspublisher-test-tournament-trf26.TXT"
TIE_BREAKS = ["PTS", "DE", "BH/C1", "SB", "TPR"]
ROUND = 7
ROUNDS = 7
TOP_COLOR = "b"
UNPAIRED = [10]
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
    req = urllib.request.Request(url, headers={"User-Agent": "Chess-Publisher-Linux-Acceptance/2"})
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
        print(cp.stdout[-7000:])
    if cp.stderr:
        print(cp.stderr[-5000:], file=sys.stderr)
    return cp


def parse_pair_text(text: str, label: str) -> list[tuple[int, int]]:
    lines = [x.strip() for x in text.replace("\r", "").split("\n") if x.strip()]
    if not lines or not re.fullmatch(r"\d+", lines[0]):
        raise RuntimeError(f"{label} output does not start with a pair count")
    count = int(lines[0])
    if count < 1 or len(lines) < count + 1:
        raise RuntimeError(f"{label} pair count is invalid")
    pairs: list[tuple[int, int]] = []
    for line in lines[1:count + 1]:
        m = re.fullmatch(r"(\d+)\s+(\d+)", line)
        if not m:
            raise RuntimeError(f"{label} invalid pair line: {line!r}")
        pairs.append((int(m.group(1)), int(m.group(2))))
    return pairs


def score_from_blocks(line: str, completed: int) -> float:
    padded = line.ljust(91 + ROUNDS * 10)
    score = 0.0
    for i in range(completed):
        result = padded[91 + i * 10 + 7:91 + i * 10 + 8]
        if result in {"1", "+", "F", "U", "W"}:
            score += 1.0
        elif result in {"=", "H", "D"}:
            score += 0.5
    return score


def prepare_history(full_text: str, completed: int) -> tuple[str, list[tuple[int, int]]]:
    lines = full_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    headers = {line[:3]: line for line in lines if len(line) >= 3 and line[:3] in {"012", "142", "152", "192"}}
    if headers.get("152", "").strip().upper() != "152 B":
        raise RuntimeError("fixture initial top color is not the expected B")
    out = [headers["012"], headers["142"], headers["152"], headers["192"]]
    expected: list[tuple[int, int]] = []
    for line in lines:
        if not line.startswith("001"):
            continue
        arr = list(line.ljust(91 + ROUNDS * 10))
        pid = int("".join(arr[4:8]).strip())
        arr[85:89] = list(f"{pid:4d}")
        arr[80:84] = list(f"{score_from_blocks(line, completed):4.1f}")
        round_block = "".join(arr[91 + (ROUND - 1) * 10:91 + ROUND * 10])
        opp = int(round_block[:4].strip() or "0")
        color = round_block[5:6]
        if opp > 0 and color == "w":
            expected.append((pid, opp))
        out.append("".join(arr[:91 + completed * 10]))
    return "\r\n".join(out) + "\r\n", expected


def mark_current_round_unpaired(history: str, round_no: int, unpaired: list[int]) -> str:
    clean = history.replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")
    wanted = sorted({int(x) for x in unpaired if int(x) > 0})
    if wanted:
        clean += "\n" + f"240 Z {round_no:3d}" + "".join(f" {pid:4d}" for pid in wanted)
    return clean.replace("\n", "\r\n") + "\r\n"


def parse_json_object(text: str, label: str) -> dict:
    raw = str(text or "").strip()
    candidates = [raw]
    first, last = raw.find("{"), raw.rfind("}")
    if 0 <= first < last:
        candidates.append(raw[first:last + 1])
    for item in candidates:
        try:
            value = json.loads(item)
            if isinstance(value, dict):
                return value
        except Exception:
            pass
    raise RuntimeError(f"{label} did not return a valid JSON object")


def expected_ranks_from_trf(text: str) -> dict[int, int]:
    ranks: dict[int, int] = {}
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if not line.startswith("001") or len(line) < 89:
            continue
        try:
            start_no = int(line[4:8].strip())
            rank = int(line[85:89].strip())
        except Exception:
            continue
        if start_no > 0 and rank > 0:
            ranks[start_no] = rank
    return ranks


def gacrux_tiebreak_ranks(gacrux: Path, trf_file: Path) -> tuple[dict[int, int], dict]:
    cmd = [
        sys.executable, str(gacrux / "tiebreakchecker.py"),
        "-i", str(trf_file), "-f", "TRF", "-n", str(ROUNDS),
        "-r", "-s", "-t", *TIE_BREAKS,
    ]
    cp = run(cmd, cwd=gacrux)
    if cp.returncode != 0 or "Program error" in cp.stdout or "(Pdb)" in cp.stdout:
        raise RuntimeError(f"Gacrux Tie-Break Checker failed with rc={cp.returncode}")
    raw = parse_json_object(cp.stdout, "Gacrux Tie-Break Checker")
    result = raw.get("tiebreakResult")
    if not isinstance(result, dict):
        result = raw.get("result") if isinstance(raw.get("result"), dict) else raw
    competitors = result.get("competitors") if isinstance(result, dict) else None
    if not isinstance(competitors, list):
        raise RuntimeError("Gacrux Tie-Break output has no competitor list")
    ranks: dict[int, int] = {}
    for row in competitors:
        if not isinstance(row, dict):
            continue
        try:
            cid, rank = int(row.get("cid")), int(row.get("rank"))
        except Exception:
            continue
        if cid > 0 and rank > 0:
            ranks[cid] = rank
    return ranks, result


def canonical(pairs: list[tuple[int, int]]) -> list[tuple[int, int]]:
    return sorted((int(w), int(b)) for w, b in pairs)


def main() -> int:
    if not FIXTURE.is_file():
        raise RuntimeError(f"missing fixture: {FIXTURE}")
    if not RATING_FIXTURE.is_file():
        raise RuntimeError(f"missing rating fixture: {RATING_FIXTURE}")
    full = FIXTURE.read_text(encoding="ascii")
    history, expected = prepare_history(full, ROUND - 1)
    if len(expected) != 13:
        raise RuntimeError(f"fixture expected Round {ROUND} has {len(expected)} normal pairs, expected 13")

    with tempfile.TemporaryDirectory(prefix="cp-linux-real-") as td_raw:
        td = Path(td_raw)
        history_file = td / "history.trf"
        history_file.write_text(history, encoding="ascii", newline="")

        print("== Install exact upstream engines ==")
        gacrux = safe_zip(download(GACRUX_URL), td / "gacrux")
        version_text = (gacrux / "version.py").read_text(encoding="utf-8")
        if f'"version": "{GACRUX_VERSION}"' not in version_text or f'"version_date": "{GACRUX_DATE}"' not in version_text:
            raise RuntimeError("Gacrux version/date mismatch")
        bbp_data = download(BBP_URL)
        got = sha256(bbp_data)
        if got != BBP_ARCHIVE_SHA256:
            raise RuntimeError(f"BBP archive SHA256 mismatch: {got}")
        bbp = safe_tar(bbp_data, td / "bbp")
        print("Gacrux:", GACRUX_VERSION, GACRUX_COMMIT)
        print("BBP archive SHA256: PASS", got)

        print(f"== Generate Round {ROUND} with Gacrux ==")
        gc_cmd = [
            sys.executable, str(gacrux / "pairingchecker.py"),
            "-i", str(history_file), "-f", "TRF", "-m", "dutch",
            "-p", "-d", "T", "-n", str(ROUND), "-N", str(ROUNDS), "-t", TOP_COLOR,
            "-u", *[str(x) for x in UNPAIRED],
        ]
        gc = run(gc_cmd, cwd=gacrux)
        if gc.returncode != 0 or "Program error" in gc.stdout or "(Pdb)" in gc.stdout:
            raise RuntimeError(f"Gacrux pairing failed with rc={gc.returncode}")
        gacrux_pairs = parse_pair_text(gc.stdout, "Gacrux")

        print(f"== Independently generate Round {ROUND} with bbpPairings ==")
        bbp_history = td / "history-bbp.trf"
        bbp_history.write_text(mark_current_round_unpaired(history, ROUND, UNPAIRED), encoding="ascii", newline="")
        bbp_out = td / "bbp-pairs.txt"
        bc = run([str(bbp), "--dutch", str(bbp_history), "-p", str(bbp_out)])
        if bc.returncode != 0 or not bbp_out.is_file():
            raise RuntimeError(f"bbpPairings pairing failed with rc={bc.returncode}")
        bbp_pairs = parse_pair_text(bbp_out.read_text(encoding="utf-8", errors="replace"), "bbpPairings")

        expected_c = canonical(expected)
        gacrux_c = canonical(gacrux_pairs)
        bbp_c = canonical(bbp_pairs)
        print("Expected:", expected_c)
        print("Gacrux  :", gacrux_c)
        print("BBP     :", bbp_c)
        if gacrux_c != expected_c:
            raise RuntimeError("Gacrux Round 7 differs from the stored Chess-Publisher pairing fixture")
        if bbp_c != gacrux_c:
            raise RuntimeError("bbpPairings Round 7 differs from Gacrux")

        print("== Compute final standings with Gacrux Tie-Break Checker ==")
        rating_text = RATING_FIXTURE.read_text(encoding="utf-8-sig")
        expected_ranks = expected_ranks_from_trf(rating_text)
        if len(expected_ranks) != 27 or len(set(expected_ranks.values())) != 27:
            raise RuntimeError("rating fixture does not contain 27 unique Chess-Publisher ranks")
        tb_ranks, _tb_result = gacrux_tiebreak_ranks(gacrux, RATING_FIXTURE)
        missing = sorted(set(expected_ranks) - set(tb_ranks))
        rank_mismatches = [
            {"startNo": cid, "expected": expected_ranks[cid], "actual": tb_ranks.get(cid)}
            for cid in sorted(expected_ranks) if tb_ranks.get(cid) != expected_ranks[cid]
        ]
        print("Tie-break chain:", " -> ".join(TIE_BREAKS))
        print("Tie-break competitors:", len(tb_ranks), "mismatches:", len(rank_mismatches))
        if missing or rank_mismatches:
            raise RuntimeError(f"Gacrux final standings differ from Chess-Publisher: missing={missing}, mismatches={rank_mismatches[:10]}")
        print("Gacrux Tie-Break standings: PASS (27/27 ranks)")

        result = {
            "fixture": FIXTURE.name,
            "round": ROUND,
            "unpaired": UNPAIRED,
            "gacrux": {"version": GACRUX_VERSION, "commit": GACRUX_COMMIT, "pairs": [list(x) for x in gacrux_c]},
            "bbp": {"version": BBP_VERSION, "archiveSha256": got, "pairs": [list(x) for x in bbp_c]},
            "expected": [list(x) for x in expected_c],
            "equivalent": True,
            "tiebreak": {"chain": TIE_BREAKS, "players": len(tb_ranks), "rankMismatches": 0, "equivalent": True},
        }
        report = ROOT / "tests" / "logs" / "real-linux-acceptance.json"
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(result, indent=2, sort_keys=True))
        print("REAL_LINUX_ACCEPTANCE=PASS")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
