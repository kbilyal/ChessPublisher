#!/usr/bin/env python3
"""Linux native export bridge for real, user-visible tournament files.

The protected ChessPublisher.html remains byte-identical. This adapter only:
- injects the Linux export JS at HTTP delivery time;
- gives TXT exports a native LocalEngine endpoint;
- mirrors TRF/TXT interoperability exports into the user's XDG Downloads dir
  while preserving the managed internal TRF copy.
"""
from __future__ import annotations

import os
import re
import subprocess
import urllib.parse
from pathlib import Path
from typing import Any

import chess_publisher_linux as cp

_APPLIED = False
_SCRIPT = b'<script src="/linux/export_integration.js"></script>\n'


def _download_dir() -> Path:
    env_value = str(os.environ.get("XDG_DOWNLOAD_DIR") or "").strip()
    if env_value:
        expanded = os.path.expandvars(os.path.expanduser(env_value.replace('"', "")))
        candidate = Path(expanded)
        if candidate.is_absolute():
            return candidate
    try:
        proc = subprocess.run(
            ["xdg-user-dir", "DOWNLOAD"],
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
            env=os.environ.copy(),
        )
        value = str(proc.stdout or "").strip()
        if value:
            candidate = Path(os.path.expandvars(os.path.expanduser(value)))
            if candidate.is_absolute():
                return candidate
    except (OSError, subprocess.SubprocessError):
        pass
    return Path.home() / "Downloads"


def _clean_file_name(name: str, fallback: str = "Export.txt") -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(name or fallback)).strip().rstrip(". ")
    if not cleaned:
        cleaned = fallback
    if len(cleaned) > 180:
        cleaned = (Path(cleaned).stem[:150].rstrip() + Path(cleaned).suffix[:20]) or fallback
    return cleaned


def _visible_dir(tournament_name: str, category: str) -> Path:
    root = _download_dir() / "Chess-Publisher" / cp.safe_storage_name(tournament_name or "Tournament") / cp.safe_storage_name(category or "Exports")
    root.mkdir(parents=True, exist_ok=True)
    return root


def _write_text_export(engine: cp.LinuxEngine, body: dict[str, Any]) -> dict[str, Any]:
    tournament = str(body.get("tournamentName") or "Tournament").strip() or "Tournament"
    file_name = _clean_file_name(str(body.get("fileName") or "Export.txt"))
    category = str(body.get("category") or "Exports").strip() or "Exports"
    text = str(body.get("text") or "")
    if len(text.encode("utf-8")) > 8 * 1024 * 1024:
        raise ValueError("TXT export is too large.")
    target = _visible_dir(tournament, category) / file_name
    payload = text if text.startswith("\ufeff") else "\ufeff" + text
    cp.atomic_write_bytes(target, payload.encode("utf-8"))
    return {"ok": True, "path": str(target), "file": str(target), "directory": str(target.parent), "browserDownload": False, "platform": "linux"}


def _inject_export_script(data: bytes) -> bytes:
    marker = b"</body>"
    if _SCRIPT in data or marker not in data:
        return data
    return data.replace(marker, _SCRIPT + marker, 1)


def apply() -> None:
    global _APPLIED
    if _APPLIED:
        return
    _APPLIED = True

    original_trf = cp.LinuxEngine.write_trf_export
    def write_trf_export(self: cp.LinuxEngine, tournament_name: str, file_name: str, text: str) -> dict[str, Any]:
        managed = original_trf(self, tournament_name, file_name, text)
        visible = _visible_dir(tournament_name, "TRF") / _clean_file_name(file_name, "TRF.txt")
        cp.atomic_write_bytes(visible, str(text).encode("utf-8"))
        return {**managed, "managedPath": str(managed.get("path") or managed.get("file") or ""), "path": str(visible), "file": str(visible), "directory": str(visible.parent), "visibleCopy": True, "browserDownload": False}
    cp.LinuxEngine.write_trf_export = write_trf_export  # type: ignore[assignment]

    original_serve = cp.Handler._serve_app
    def serve_app(self: cp.Handler) -> Any:
        original_text = self._text
        def export_text(status: int, data: bytes, content_type: str) -> Any:
            if content_type.lower().startswith("text/html"):
                data = _inject_export_script(data)
            return original_text(status, data, content_type)
        self._text = export_text  # type: ignore[method-assign]
        try:
            return original_serve(self)
        finally:
            self._text = original_text  # type: ignore[method-assign]
    cp.Handler._serve_app = serve_app  # type: ignore[assignment]

    original_post = cp.Handler.do_POST
    def do_post(self: cp.Handler) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if path != "/linux/export-text":
            return original_post(self)
        if not self._require_local_origin():
            return
        try:
            return self._json(200, _write_text_export(self.engine, self._body_json(8 * 1024 * 1024)))
        except ValueError as exc:
            return self._json(400, {"ok": False, "error": str(exc)})
    cp.Handler.do_POST = do_post  # type: ignore[assignment]
