#!/usr/bin/env python3
"""On-machine self-test for Chess-Publisher Linux development packages.

Default mode is offline and non-destructive. Optional online engine installation
and DGT connect checks must be explicitly requested.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import stat
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path
from typing import Any, Callable

import chess_publisher_linux as app
from build_info import APP_BUILD, ENGINE_VERSION
from build_identity_integration import apply as apply_build_identity
from source_guard import require_package_source, SourceIdentityError
from fide_runtime import FideRuntime
from chess_results_runtime import ChessResultsRuntime
from dgt_runtime import DgtLinuxRuntime, DgtError
from gacrux_runtime import GacruxRuntime, GacruxError, GACRUX_VERSION
from bbp_runtime import BBPRuntime, BBPError, BBP_VERSION

# Self-test must exercise the same canonical build identity used by the normal
# packaged entrypoint, not the historical constants retained in the base host.
app.APP_BUILD = APP_BUILD
app.ENGINE_VERSION = ENGINE_VERSION
apply_build_identity()
LinuxEngine = app.LinuxEngine


class SelfTestFailure(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _runtime_manifest(package_root: Path) -> tuple[Path | None, dict[str, Any]]:
    for name in ("PACKAGE-MANIFEST.json", "BUILD-MANIFEST.json"):
        p = package_root / name
        if p.is_file():
            try:
                value = json.loads(p.read_text(encoding="utf-8"))
            except Exception as exc:
                raise SelfTestFailure(f"Could not read {name}: {exc}") from exc
            if not isinstance(value, dict):
                raise SelfTestFailure(f"{name} is not a JSON object.")
            return p, value
    return None, {}


def _verify_runtime_files(package_root: Path) -> dict[str, Any]:
    manifest_path, manifest = _runtime_manifest(package_root)
    specs = manifest.get("runtimeFiles") if isinstance(manifest, dict) else None
    if not isinstance(specs, dict) or not specs:
        return {"verified": False, "reason": "runtime hash manifest not present"}
    checked = 0
    for rel, spec in specs.items():
        if not isinstance(spec, dict):
            raise SelfTestFailure(f"Invalid runtime manifest entry: {rel}")
        candidate = (package_root / "linux" / str(rel)).resolve()
        linux_root = (package_root / "linux").resolve()
        if candidate != linux_root and linux_root not in candidate.parents:
            raise SelfTestFailure(f"Unsafe runtime manifest path: {rel}")
        if not candidate.is_file():
            raise SelfTestFailure(f"Runtime file missing: {rel}")
        expected_size = int(spec.get("size") or 0)
        expected_sha = str(spec.get("sha256") or "").lower()
        if candidate.stat().st_size != expected_size or _sha256(candidate) != expected_sha:
            raise SelfTestFailure(f"Runtime integrity mismatch: {rel}")
        checked += 1
    return {"verified": True, "files": checked, "manifest": manifest_path.name if manifest_path else ""}


def _offline_localengine(package_root: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="cp-selftest-") as td_raw:
        data_home = Path(td_raw) / "data"
        engine = LinuxEngine(package_root, data_home)
        name = "Self Test Ω Турнир"
        renamed = "Self Test Ω Турнир Renamed"
        snapshot = {"name": name, "settings": {"rounds": 7}, "players": [{"id": 1, "name": "Тест"}]}
        trf = "012 Self Test\r\n142 1\r\n001    1      Test Player\r\n"
        saved = engine.save_tournament(name, snapshot, {"round": 1, "text": trf})
        if not Path(saved["file"]).is_file():
            raise SelfTestFailure("Tournament save did not create tournament.json.")
        backup = ((saved.get("trfBackup") or {}).get("file") or "")
        if not backup or not Path(backup).is_file():
            raise SelfTestFailure("Cumulative TRF backup was not created.")
        opened = engine.open_tournament(name=name)
        if opened.get("snapshot", {}).get("players", [{}])[0].get("name") != "Тест":
            raise SelfTestFailure("Unicode tournament open round-trip failed.")
        changed = {**snapshot, "name": renamed}
        engine.rename_tournament(name, renamed, changed)
        exported = engine.write_trf_export(renamed, "Self Test TRF26.txt", trf)
        if not Path(exported["path"]).is_file():
            raise SelfTestFailure("TRF export was not written.")
        engine.secret_op("set", "self-test-secret", "value")
        got = engine.secret_op("get", "self-test-secret")
        if not got.get("found") or got.get("value") != "value":
            raise SelfTestFailure("Local secret store round-trip failed.")
        if stat.S_IMODE(engine.secrets_file.stat().st_mode) != 0o600:
            raise SelfTestFailure("Local secret file permissions are not 0600.")
        engine.secret_op("remove", "self-test-secret")
        if engine.secret_op("get", "self-test-secret").get("found"):
            raise SelfTestFailure("Local secret removal failed.")
        inventory = engine.list_tournaments()
        if len(inventory) != 1 or inventory[0].get("name") != renamed:
            raise SelfTestFailure("Tournament inventory/rename contract failed.")
        return {"saveOpenRename": True, "unicode": True, "trfBackup": True, "trfExport": True, "secret0600": True}


def _offline_http_delivery(package_root: Path) -> dict[str, Any]:
    html_file = package_root / "source" / "ChessPublisher.html"
    shim_file = package_root / "linux" / "LinuxWebViewShim.js"
    if not html_file.is_file() or not shim_file.is_file():
        raise SelfTestFailure("Package is missing ChessPublisher.html or LinuxWebViewShim.js.")
    with tempfile.TemporaryDirectory(prefix="cp-http-selftest-") as td_raw:
        engine = LinuxEngine(package_root, Path(td_raw) / "data")
        srv = app.make_server(engine, "127.0.0.1", 0, True)
        th = threading.Thread(target=srv.serve_forever, daemon=True)
        th.start()
        try:
            host, port = srv.server_address
            base = f"http://{host}:{port}"
            with urllib.request.urlopen(base + "/health", timeout=3) as r:
                health = json.loads(r.read().decode("utf-8"))
            if health.get("appBuild") != APP_BUILD or health.get("engineVersion") != ENGINE_VERSION:
                raise SelfTestFailure(f"LocalEngine build identity mismatch: {health}")
            with urllib.request.urlopen(base + "/", timeout=5) as r:
                served = r.read().decode("utf-8", "replace")
            with urllib.request.urlopen(base + "/linux/LinuxWebViewShim.js", timeout=3) as r:
                shim = r.read().decode("utf-8", "replace")
            if APP_BUILD not in served:
                raise SelfTestFailure("Served UI does not contain the canonical Linux build marker.")
            if "linux-dev.2" in served:
                raise SelfTestFailure("Served UI contains stale linux-dev.2 build identity.")
            if "/linux/LinuxWebViewShim.js" not in served:
                raise SelfTestFailure("Served UI does not inject LinuxWebViewShim.js.")
            for marker in ("Tournament Setup", "Pairings", "Chess-Results", "Registration", "DGT"):
                if marker not in served:
                    raise SelfTestFailure(f"Served UI is missing expected application marker: {marker}")
            if "window.chrome" not in shim or "webview" not in shim:
                raise SelfTestFailure("Linux WebView shim content is not the expected bridge implementation.")
            return {
                "health": True,
                "appBuild": health.get("appBuild"),
                "engineVersion": health.get("engineVersion"),
                "servedUiBytes": len(served.encode("utf-8")),
                "shimBytes": len(shim.encode("utf-8")),
                "canonicalBuildMarker": True,
            }
        finally:
            srv.shutdown()
            srv.server_close()
            th.join(timeout=2)


def _offline_platform(package_root: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="cp-platform-selftest-") as td_raw:
        td = Path(td_raw)
        fide = FideRuntime(td / "fide").status().as_dict()
        cr = ChessResultsRuntime(lambda: {}, td / "proofs.json").status()
        if cr.get("localBridgeCrypto") is not False or cr.get("sourceId") != 21:
            raise SelfTestFailure("Chess-Results Linux security boundary is not the expected Worker-only contract.")
        if "chess-results.com" not in str(cr.get("browserUrlPolicy") or ""):
            raise SelfTestFailure("Chess-Results browser URL allowlist is not active.")
        dgt = DgtLinuxRuntime().diagnostics()
        if not dgt.get("ok") or dgt.get("diagnostics", {}).get("Platform") != "Linux":
            raise SelfTestFailure("DGT Linux diagnostics contract failed.")
        return {
            "fideStatusReadable": isinstance(fide, dict),
            "chessResultsWorkerOnly": True,
            "chessResultsUrlAllowlist": True,
            "dgtDiagnostics": dgt.get("diagnostics", {}).get("Status"),
            "dgtPorts": len(dgt.get("snapshot", {}).get("Ports", [])),
        }


def _online_engines(package_root: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="cp-engine-selftest-") as td_raw:
        td = Path(td_raw)
        gacrux = GacruxRuntime(package_root / "vendor" / "gacrux-1.9.57", td / "gacrux")
        g = gacrux.install()
        if not gacrux.status().ready:
            raise SelfTestFailure("Gacrux installation did not become ready.")
        bbp = BBPRuntime(td / "bbp")
        b = bbp.install()
        if not bbp.status().ready:
            raise SelfTestFailure("bbpPairings installation did not become ready.")
        return {"gacrux": GACRUX_VERSION, "gacruxInstalled": bool(g.get("ok", True)), "bbp": BBP_VERSION, "bbpInstalled": bool(b.get("ok", True))}


def _dgt_connect() -> dict[str, Any]:
    runtime = DgtLinuxRuntime()
    diagnostics = runtime.diagnostics()
    ports = diagnostics.get("snapshot", {}).get("Ports", [])
    if not ports:
        raise SelfTestFailure("No Linux serial port is visible for a real DGT connect test.")
    result = runtime.connect(1)
    boards = result.get("snapshot", {}).get("Boards", [])
    if not boards:
        raise SelfTestFailure("Serial ports are visible, but no DGT BOARD_DUMP response was received.")
    runtime.disconnect()
    return {"connectedBoards": len(boards), "port": boards[0].get("Port", "")}


def _record(results: list[dict[str, Any]], name: str, fn: Callable[[], Any]) -> bool:
    try:
        detail = fn()
        results.append({"name": name, "status": "PASS", "detail": detail})
        return True
    except Exception as exc:
        results.append({"name": name, "status": "FAIL", "error": str(exc)})
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Chess-Publisher Linux on-machine self-test")
    parser.add_argument("--package-root", type=Path, default=Path(__file__).resolve().parent.parent, help=argparse.SUPPRESS)
    parser.add_argument("--online-engines", action="store_true", help="Download and verify pinned Gacrux and bbpPairings runtimes.")
    parser.add_argument("--dgt-connect", action="store_true", help="Attempt a real non-destructive DGT board connect/BOARD_DUMP test.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON only.")
    args = parser.parse_args()
    root = args.package_root.expanduser().resolve()
    results: list[dict[str, Any]] = []

    _record(results, "platform", lambda: {
        "system": platform.system(), "machine": platform.machine(), "python": platform.python_version(),
        "linux": platform.system().lower() == "linux", "python310Plus": sys.version_info >= (3, 10),
    } if platform.system().lower() == "linux" and sys.version_info >= (3, 10) else (_ for _ in ()).throw(SelfTestFailure("Linux with Python 3.10+ is required.")))
    _record(results, "protected-source", lambda: require_package_source(root))
    _record(results, "runtime-integrity", lambda: _verify_runtime_files(root))
    _record(results, "localengine-filesystem", lambda: _offline_localengine(root))
    _record(results, "http-delivery", lambda: _offline_http_delivery(root))
    _record(results, "platform-services", lambda: _offline_platform(root))
    if args.online_engines:
        _record(results, "online-engines", lambda: _online_engines(root))
    if args.dgt_connect:
        _record(results, "dgt-hardware", _dgt_connect)

    failures = [r for r in results if r["status"] == "FAIL"]
    summary = {"ok": not failures, "packageRoot": str(root), "tests": results, "passed": len(results) - len(failures), "failed": len(failures)}
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print("Chess-Publisher Linux self-test")
        print(f"Package: {root}")
        for item in results:
            suffix = f" — {item.get('error')}" if item["status"] == "FAIL" else ""
            print(f"[{item['status']}] {item['name']}{suffix}")
        print(f"SELF_TEST_RESULT={'PASS' if not failures else 'FAIL'} ({summary['passed']} passed, {summary['failed']} failed)")
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
