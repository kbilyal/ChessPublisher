#!/usr/bin/env python3
"""Chess-Publisher Linux LocalEngine dev preview.

Cross-platform compatibility host for the existing Chess-Publisher HTML/JS UI.
It intentionally does NOT reimplement pairing/TRF/tie-break/Chess-Results algorithms.
Those remain in the protected application core or fail closed when no verified
Linux-native helper is available.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

from gacrux_runtime import GacruxRuntime, GacruxError, GACRUX_VERSION, UPSTREAM_COMMIT
from bbp_runtime import BBPRuntime, BBPError, BBP_VERSION

ENGINE_VERSION = "0.2.0-linux-dev"
APP_BUILD = "1.06.00-beta.34-linux-dev.2"
DEFAULT_PORT = 18765
WORKER_ORIGIN = "https://chess-publisher-hub-api-beta.kyamranbilyal.workers.dev"
WORKER_WEB_ORIGIN = "https://web.chess-publisher.org"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_storage_name(name: str) -> str:
    s = str(name or "").strip()
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", s)
    s = s.rstrip(". ").strip()
    if len(s) > 120:
        s = s[:120].rstrip()
    return s or "Tournament"


def atomic_write_bytes(path: Path, data: bytes, mode: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        if mode is not None:
            os.chmod(tmp_name, mode)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def atomic_write_json(path: Path, value: Any, mode: int | None = None) -> None:
    atomic_write_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"), mode)


class LinuxEngine:
    def __init__(self, package_root: Path, data_home: Path):
        self.package_root = package_root.resolve()
        self.source_root = self.package_root / "source"
        self.linux_root = self.package_root / "linux"
        self.data_home = data_home.expanduser().resolve()
        self.tournaments_root = self.data_home / "tournaments"
        self.settings_root = self.data_home / "settings"
        self.state_file = self.data_home / "state.json"
        self.secrets_file = self.settings_root / "secrets.json"
        self.tournaments_root.mkdir(parents=True, exist_ok=True)
        self.settings_root.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.settings_root, 0o700)
        except OSError:
            pass
        self.lock = threading.RLock()
        self.gacrux = GacruxRuntime(
            self.package_root / "vendor" / "gacrux-1.9.57",
            self.settings_root / "gacrux" / "1.9.57",
        )
        self.bbp = BBPRuntime(self.settings_root / "bbpPairings" / "6.0.0")

    def inventory_id(self, folder_name: str) -> str:
        return "linux-" + hashlib.sha256(folder_name.encode("utf-8")).hexdigest()[:24]

    def _folder(self, name: str) -> Path:
        return self.tournaments_root / safe_storage_name(name)

    def list_tournaments(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        if not self.tournaments_root.exists():
            return rows
        for folder in self.tournaments_root.iterdir():
            if not folder.is_dir():
                continue
            f = folder / "tournament.json"
            if not f.is_file():
                continue
            try:
                st = f.stat()
                display_name = folder.name
                try:
                    snapshot = json.loads(f.read_text(encoding="utf-8"))
                    display_name = str(snapshot.get("currentTournament") or snapshot.get("data", {}).get("currentTournament") or folder.name)
                except Exception:
                    pass
                rows.append({
                    "id": self.inventory_id(folder.name),
                    "name": display_name,
                    "storageName": folder.name,
                    "path": str(f),
                    "file": str(f),
                    "updatedAt": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
                    "size": st.st_size,
                })
            except OSError:
                continue
        rows.sort(key=lambda r: r.get("updatedAt", ""), reverse=True)
        return rows

    def resolve_inventory(self, inventory_id: str = "", name: str = "") -> tuple[str, Path]:
        rows = self.list_tournaments()
        if inventory_id:
            for row in rows:
                if row["id"] == inventory_id:
                    return str(row["storageName"]), Path(row["file"])
            raise FileNotFoundError("Tournament inventory entry is stale or missing.")
        key = safe_storage_name(name).casefold()
        for row in rows:
            if str(row["storageName"]).casefold() == key or str(row["name"]).casefold() == str(name).casefold():
                return str(row["storageName"]), Path(row["file"])
        raise FileNotFoundError("Tournament was not found.")

    def save_tournament(self, name: str, snapshot: dict[str, Any], trf_backup: Any = None) -> dict[str, Any]:
        storage = safe_storage_name(name)
        folder = self._folder(storage)
        file = folder / "tournament.json"
        folder.mkdir(parents=True, exist_ok=True)
        with self.lock:
            if file.exists():
                backup = folder / "tournament.json.bak"
                try:
                    shutil.copy2(file, backup)
                except OSError:
                    pass
            atomic_write_json(file, snapshot)
            atomic_write_json(self.state_file, snapshot)
            backup_result = self._write_trf_backup(folder, trf_backup)
        return {"ok": True, "name": storage, "file": str(file), "trfBackup": backup_result}

    def _write_trf_backup(self, folder: Path, trf_backup: Any) -> Any:
        if not isinstance(trf_backup, dict):
            return None
        round_no = int(trf_backup.get("round") or 0)
        if round_no <= 0:
            return None
        text = str(trf_backup.get("text") or "")
        if not text:
            return None
        backup_dir = folder / "TRF_Backup"
        backup_dir.mkdir(parents=True, exist_ok=True)
        target = backup_dir / f"Round_{round_no:02d}.trf"
        atomic_write_bytes(target, text.encode("utf-8"))
        result: dict[str, Any] = {"round": round_no, "file": str(target)}
        sm_text = str(trf_backup.get("swissManagerText") or "")
        if sm_text:
            sm_target = backup_dir / f"Round_{round_no:02d}_compat.trf"
            atomic_write_bytes(sm_target, sm_text.encode("utf-8"))
            result["compatFile"] = str(sm_target)
        return result

    def open_tournament(self, inventory_id: str = "", name: str = "") -> dict[str, Any]:
        storage, file = self.resolve_inventory(inventory_id, name)
        snapshot = json.loads(file.read_text(encoding="utf-8"))
        atomic_write_json(self.state_file, snapshot)
        return {"ok": True, "name": storage, "file": str(file), "snapshot": snapshot}

    def rename_tournament(self, old_name: str, new_name: str, snapshot: dict[str, Any]) -> dict[str, Any]:
        old_storage, old_file = self.resolve_inventory(name=old_name)
        old_folder = old_file.parent
        new_storage = safe_storage_name(new_name)
        new_folder = self._folder(new_storage)
        if new_folder.exists() and new_folder.resolve() != old_folder.resolve():
            raise FileExistsError("Tournament already exists or conflicts with an existing tournament folder.")
        with self.lock:
            if new_folder.resolve() != old_folder.resolve():
                old_folder.rename(new_folder)
            file = new_folder / "tournament.json"
            atomic_write_json(file, snapshot)
            atomic_write_json(self.state_file, snapshot)
        return {"ok": True, "name": new_storage, "file": str(file)}

    def write_trf_export(self, tournament_name: str, file_name: str, text: str) -> dict[str, Any]:
        storage = safe_storage_name(tournament_name)
        folder = self._folder(storage)
        if not folder.exists():
            folder.mkdir(parents=True, exist_ok=True)
        trf_dir = folder / "TRF"
        trf_dir.mkdir(parents=True, exist_ok=True)
        clean_file = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(file_name or "TRF.txt")).strip() or "TRF.txt"
        target = trf_dir / clean_file
        atomic_write_bytes(target, str(text).encode("utf-8"))
        return {"ok": True, "path": str(target), "file": str(target)}

    def load_secrets(self) -> dict[str, str]:
        try:
            obj = json.loads(self.secrets_file.read_text(encoding="utf-8"))
            return {str(k): str(v) for k, v in obj.items() if isinstance(k, str) and isinstance(v, str)}
        except Exception:
            return {}

    def secret_op(self, operation: str, key: str, value: str = "") -> dict[str, Any]:
        if not key or len(key) > 256:
            raise ValueError("Secret key is invalid.")
        with self.lock:
            secrets = self.load_secrets()
            if operation == "get":
                return {"ok": True, "found": key in secrets, "value": secrets.get(key, "")}
            if operation == "set":
                secrets[key] = value
                atomic_write_json(self.secrets_file, secrets, 0o600)
                return {"ok": True}
            if operation == "remove":
                secrets.pop(key, None)
                atomic_write_json(self.secrets_file, secrets, 0o600)
                return {"ok": True}
        raise ValueError("Unsupported secret operation.")


class Handler(BaseHTTPRequestHandler):
    server_version = "ChessPublisherLinuxEngine/0.2"

    @property
    def engine(self) -> LinuxEngine:
        return self.server.engine  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args: Any) -> None:
        if getattr(self.server, "quiet", False):
            return
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _json(self, status: int, obj: Any, extra_headers: dict[str, str] | None = None) -> None:
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(payload)

    def _text(self, status: int, data: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def _body_json(self, max_bytes: int = 32 * 1024 * 1024) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length < 0 or length > max_bytes:
            raise ValueError("Request body is too large.")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("JSON object is required.")
        return value

    def _local_origin_allowed(self) -> bool:
        origin = (self.headers.get("Origin") or "").strip()
        if not origin:
            return True
        try:
            u = urllib.parse.urlsplit(origin)
            host = (u.hostname or "").lower()
            return u.scheme == "http" and host in {"127.0.0.1", "localhost", "::1"}
        except Exception:
            return False

    def _require_local_origin(self) -> bool:
        if self._local_origin_allowed():
            return True
        self._json(403, {"ok": False, "error": "External browser origin is not allowed to modify the local Chess-Publisher engine."})
        return False

    def do_GET(self) -> None:
        try:
            u = urllib.parse.urlsplit(self.path)
            path = u.path
            q = urllib.parse.parse_qs(u.query)
            if path in ("/", "/index.html"):
                return self._serve_app()
            if path == "/health":
                return self._json(200, {"ok": True, "service": "Chess-Publisher Linux LocalEngine", "engineVersion": ENGINE_VERSION, "appBuild": APP_BUILD, "platform": sys.platform})
            if path == "/state":
                if not self.engine.state_file.is_file():
                    return self._json(404, {"error": "No saved state."})
                return self._text(200, self.engine.state_file.read_bytes(), "application/json; charset=utf-8")
            if path == "/tournaments":
                return self._json(200, {"tournaments": self.engine.list_tournaments()})
            if path == "/tournament":
                name = (q.get("name") or [""])[0]
                result = self.engine.open_tournament(name=name)
                return self._json(200, result)
            if path.startswith("/source/") or path.startswith("/linux/"):
                return self._serve_static(path)
            if path.startswith("/proxy/hub-api/") or path == "/proxy/hub-api":
                return self._proxy_worker(path, u.query)
            if path.startswith("/fide/"):
                return self._json(503, {"ok": False, "error": "Linux FIDE database service is not connected in dev preview 1."})
            if path == "/pairing-checker/status":
                status = self.engine.bbp.status().as_dict()
                status["platform"] = "linux"
                return self._json(200, status)
            if path in ("/tiebreak-checker/status", "/gacrux/status"):
                status = self.engine.gacrux.status().as_dict()
                status["platform"] = "linux"
                if path == "/tiebreak-checker/status":
                    status["checker"] = "Gacrux Tie-Break Checker"
                return self._json(200, status)
            return self._json(404, {"error": "Not found", "path": path})
        except FileNotFoundError as e:
            self._json(404, {"error": str(e)})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def do_POST(self) -> None:
        try:
            u = urllib.parse.urlsplit(self.path)
            path = u.path
            if path.startswith("/proxy/hub-api/") or path == "/proxy/hub-api":
                return self._proxy_worker(path, u.query)
            if path == "/tournament/save":
                if not self._require_local_origin():
                    return
                b = self._body_json(64 * 1024 * 1024)
                result = self.engine.save_tournament(str(b.get("name") or "Tournament"), b.get("snapshot") or {}, b.get("trfBackup"))
                return self._json(200, result)
            if path == "/tournament/open":
                if not self._require_local_origin():
                    return
                b = self._body_json()
                return self._json(200, self.engine.open_tournament(str(b.get("inventoryId") or ""), str(b.get("name") or "")))
            if path == "/tournament/rename":
                if not self._require_local_origin():
                    return
                b = self._body_json(64 * 1024 * 1024)
                return self._json(200, self.engine.rename_tournament(str(b.get("oldName") or ""), str(b.get("newName") or ""), b.get("snapshot") or {}))
            if path == "/tournament/trf-export":
                if not self._require_local_origin():
                    return
                b = self._body_json(32 * 1024 * 1024)
                return self._json(200, self.engine.write_trf_export(str(b.get("tournamentName") or b.get("name") or "Tournament"), str(b.get("fileName") or "TRF.txt"), str(b.get("text") or "")))
            if path == "/native/secret":
                if not self._require_local_origin():
                    return
                b = self._body_json(128 * 1024)
                return self._json(200, self.engine.secret_op(str(b.get("operation") or ""), str(b.get("key") or ""), str(b.get("value") or "")))
            if path == "/gacrux/install":
                if not self._require_local_origin():
                    return
                return self._json(200, self.engine.gacrux.install().as_dict())
            if path == "/pairing-checker/install":
                if not self._require_local_origin():
                    return
                return self._json(200, self.engine.bbp.install().as_dict())
            if path == "/tiebreak-checker/install":
                if not self._require_local_origin():
                    return
                return self._json(200, self.engine.gacrux.install().as_dict())
            if path == "/pair":
                if not self._require_local_origin():
                    return
                b = self._body_json(16 * 1024 * 1024)
                try:
                    trf_text = str(b.get("trfText") or b.get("trf") or "")
                    round_no = int(b.get("roundNo") or b.get("round") or 0)
                    rounds = int(b.get("rounds") or b.get("totalRounds") or round_no or 0)
                    top_color = str(b.get("topColor") or b.get("topRatedColor") or "w")
                    unpaired = b.get("unpaired") or b.get("unpairedIds") or []
                    pairs = self.engine.gacrux.generate_pairing(trf_text, round_no, rounds, top_color, unpaired)
                    checker = self.engine.bbp.compare_pairing(trf_text, pairs, round_no, unpaired)
                    if checker.get("state") == "fail":
                        return self._json(503, {"ok": False, "error": "Independent BBP pairing checker rejected the Gacrux pairing.", "pairs": pairs, "independentChecker": checker})
                    return self._json(200, {"ok": True, "pairs": pairs, "source": "Gacrux 1.9.57 upstream Python", "upstreamCommit": UPSTREAM_COMMIT, "independentChecker": checker})
                except (GacruxError, BBPError, ValueError) as e:
                    return self._json(503, {"ok": False, "error": str(e), "source": "Gacrux 1.9.57 upstream Python", "independentChecker": self.engine.bbp.status().as_dict()})
            if path == "/tiebreak-checker/check":
                if not self._require_local_origin():
                    return
                b = self._body_json(20 * 1024 * 1024)
                try:
                    result = self.engine.gacrux.check_tiebreak(
                        str(b.get("trfText") or b.get("trf") or ""),
                        int(b.get("roundNo") or b.get("round") or 0),
                        b.get("descriptors") or b.get("tieBreaks") or [],
                        str(b.get("resultType") or b.get("type") or "swiss"),
                        b.get("expected") or b.get("competitors") or [],
                        int(b.get("unratedRating") or 0),
                    )
                    return self._json(200, result)
                except GacruxError as e:
                    return self._json(503, {"ok": False, "error": str(e), "checker": "Gacrux 1.9.57 Tie-Break Checker"})
            if path == "/trf26-exchange/check":
                if not self._require_local_origin():
                    return
                b = self._body_json(20 * 1024 * 1024)
                try:
                    result = self.engine.gacrux.check_tiebreak(
                        str(b.get("trfText") or b.get("trf") or ""),
                        int(b.get("roundNo") or b.get("round") or 0),
                        b.get("descriptors") if "descriptors" in b else None,
                        str(b.get("resultType") or b.get("type") or "swiss"),
                        b.get("expected") or b.get("competitors") or [],
                        int(b.get("unratedRating") or 0),
                    )
                    result["exchange"] = "TRF26"
                    return self._json(200, result)
                except GacruxError as e:
                    return self._json(503, {"ok": False, "error": str(e), "exchange": "TRF26"})
            return self._json(404, {"error": "Not found", "path": path})
        except FileNotFoundError as e:
            self._json(404, {"error": str(e)})
        except FileExistsError as e:
            self._json(409, {"error": str(e)})
        except ValueError as e:
            self._json(400, {"error": str(e)})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def do_PUT(self) -> None:
        try:
            u = urllib.parse.urlsplit(self.path)
            path = u.path
            if path.startswith("/proxy/hub-api/") or path == "/proxy/hub-api":
                return self._proxy_worker(path, u.query)
            return self._json(404, {"error": "Not found", "path": path})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def do_DELETE(self) -> None:
        try:
            u = urllib.parse.urlsplit(self.path)
            path = u.path
            if path.startswith("/proxy/hub-api/") or path == "/proxy/hub-api":
                return self._proxy_worker(path, u.query)
            return self._json(404, {"error": "Not found", "path": path})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _serve_app(self) -> None:
        app = self.source_root / "ChessPublisher.html"
        if not app.is_file():
            return self._json(500, {"error": f"App HTML missing at {app}"})
        html = app.read_text(encoding="utf-8")
        injection = """
<script>document.documentElement.dataset.chesspublisherPlatform='linux';document.documentElement.dataset.chesspublisherLinuxBuild='1.06.00-beta.34-linux-dev.2';</script>
<script src="/source/hub/client/hub-api-client.js"></script>
<script src="/source/hub/client/hub-snapshot.js"></script>
<script src="/source/webview/HubAdapter.js"></script>
<script src="/source/cloud/client/cloud-workspace-api.js"></script>
<script src="/source/webview/CloudWorkspaceAdapter.js"></script>
<script src="/linux/LinuxWebViewShim.js"></script>
"""
        if "</body>" in html:
            html = html.replace("</body>", injection + "\n</body>", 1)
        else:
            html += injection
        self._text(200, html.encode("utf-8"), "text/html; charset=utf-8")

    def _serve_static(self, path: str) -> None:
        if path.startswith("/source/"):
            rel = path[len("/source/"):]
            root = self.source_root
        else:
            rel = path[len("/linux/"):]
            root = self.linux_root
        candidate = (root / urllib.parse.unquote(rel)).resolve()
        if root.resolve() not in candidate.parents and candidate != root.resolve():
            return self._json(403, {"error": "Forbidden"})
        if not candidate.is_file():
            return self._json(404, {"error": "Static file not found"})
        ctype = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self._text(200, candidate.read_bytes(), ctype)

    def _proxy_worker(self, path: str, query: str) -> None:
        suffix = path[len("/proxy/hub-api"):]
        if not suffix.startswith("/"):
            suffix = "/" + suffix
        target = WORKER_ORIGIN + suffix + (("?" + query) if query else "")
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else None
        headers: dict[str, str] = {
            "Accept": self.headers.get("Accept", "application/json"),
            "Origin": WORKER_WEB_ORIGIN,
            "User-Agent": "Chess-Publisher-Linux-HubProxy/1",
        }
        for name in ("Authorization", "Content-Type", "X-Organizer-Token", "X-Expected-Revision", "X-Confirm-Delete"):
            value = self.headers.get(name)
            if value:
                headers[name] = value
        req = urllib.request.Request(target, data=body, method=self.command, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = resp.read()
                ctype = resp.headers.get("Content-Type", "application/json; charset=utf-8")
                self._text(resp.status, data, ctype)
        except urllib.error.HTTPError as e:
            data = e.read()
            self._text(e.code, data, e.headers.get("Content-Type", "application/json; charset=utf-8"))
        except Exception as e:
            self._json(502, {"error": "Cloud proxy request failed.", "detail": str(e)})


def make_server(engine: LinuxEngine, host: str, port: int, quiet: bool = False) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), Handler)
    server.engine = engine  # type: ignore[attr-defined]
    server.quiet = quiet  # type: ignore[attr-defined]
    return server


def main() -> int:
    parser = argparse.ArgumentParser(description="Chess-Publisher Linux LocalEngine development preview")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--data-home", type=Path, default=Path(os.environ.get("CP_DATA_HOME", "~/.local/share/chess-publisher")))
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    package_root = Path(__file__).resolve().parent.parent
    engine = LinuxEngine(package_root, args.data_home)
    url = f"http://{args.host}:{args.port}/"
    try:
        with urllib.request.urlopen(url + "health", timeout=0.35) as resp:
            existing = json.loads(resp.read().decode("utf-8"))
        if existing.get("service") == "Chess-Publisher Linux LocalEngine":
            print(f"Chess-Publisher Linux LocalEngine already running at {url}")
            if not args.no_browser:
                webbrowser.open(url)
            return 0
        print(f"Port {args.port} is already used by another service.", file=sys.stderr)
        return 2
    except Exception:
        pass
    server = make_server(engine, args.host, args.port, args.quiet)
    print(f"Chess-Publisher Linux LocalEngine dev preview: {url}")
    print(f"Data home: {engine.data_home}")
    print(f"Gacrux: {engine.gacrux.status().as_dict()}")
    print(f"BBP: {engine.bbp.status().as_dict()}")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
