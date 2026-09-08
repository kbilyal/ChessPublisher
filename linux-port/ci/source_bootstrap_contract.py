#!/usr/bin/env python3
"""Regression contract for fresh-checkout protected-source bootstrapping."""
from __future__ import annotations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = ROOT / "linux" / "source_bootstrap.py"
RUNNER = ROOT / "linux" / "run-chess-publisher.sh"


def main() -> int:
    bootstrap = BOOTSTRAP.read_text(encoding="utf-8")
    runner = RUNNER.read_text(encoding="utf-8")

    required = [
        'ARCHIVE_NAME = "Chess-Publisher-v1.06.00-beta.34-protected-source.tar.gz"',
        'ARCHIVE_SHA256 = "19d6f55bd6954db4cd6327ad61892b538e5b7a7129ac1fce2adf5e3ec2176eff"',
        'verify_source(source, manifest)',
        'verify_source(staged, manifest)',
        'if source.exists() and any(source.rglob("*")):',
        'tf.extractall(td, members=members, filter="data")',
    ]
    missing = [marker for marker in required if marker not in bootstrap]
    if missing:
        raise RuntimeError(f"protected source bootstrap markers missing: {missing}")

    bootstrap_call = 'python3 "$HERE/source_bootstrap.py"'
    entry_call = 'exec python3 "$HERE/chess_publisher_linux_entry.py"'
    if bootstrap_call not in runner or entry_call not in runner:
        raise RuntimeError("Linux runner does not invoke bootstrap and entrypoint")
    if runner.index(bootstrap_call) > runner.index(entry_call):
        raise RuntimeError("protected source bootstrap must run before Linux entrypoint")
    if "../ChessPublisher.html" in bootstrap or "package_root.parent / \"ChessPublisher.html\"" in bootstrap:
        raise RuntimeError("old repository-root ChessPublisher.html fallback must not be accepted")

    print("LINUX_FRESH_CHECKOUT_SOURCE_BOOTSTRAP=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
