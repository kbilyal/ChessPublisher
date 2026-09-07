#!/usr/bin/env python3
"""Linux desktop-only glue: file opening and Linux-neutral delivered UI wording.

The protected ChessPublisher.html on disk is never modified. Text replacements
happen only in the HTTP response served by the Linux LocalEngine.
"""
from __future__ import annotations
import os
import subprocess
import urllib.parse
from pathlib import Path
from typing import Any

import chess_publisher_linux as cp

_APPLIED = False

# Exact user-facing strings only. Algorithm/source markers are intentionally not touched.
_TEXT_REPLACEMENTS = {
    b"Windows driver / COM": b"Linux device / serial",
    b"Hardware scan is idle. Press Connect / Detect to query Windows devices and DGT hardware.": b"Hardware scan is idle. Press Connect / Detect to query Linux serial devices and DGT hardware.",
    b"Windows serial ports: not scanned yet.": b"Linux serial ports: not scanned yet.",
    b"Windows serial ports: scan runs only on Connect / Detect.": b"Linux serial ports: scan runs only on Connect / Detect.",
    b"Windows serial ports: none detected": b"Linux serial ports: none detected",
    b"Windows serial ports: ${cpDgtState.ports.join(\", \")}": b"Linux serial ports: ${cpDgtState.ports.join(\", \")}",
    b"Checking Windows devices\xe2\x80\xa6": b"Checking Linux devices\xe2\x80\xa6",
    b"DGT: Windows sees the device, but the DGT/USB serial driver is missing.": b"DGT: Linux sees the device, but the DGT/USB serial driver is missing.",
    b"DGT-related hardware is visible, but Windows exposes no COM port.": b"DGT-related hardware is visible, but Linux exposes no serial port.",
    b"Check driver, cable, power and Windows Device Manager.": b"Check driver, cable, power and Linux device permissions.",
    b"Native Save As is not supported by this browser. Use current Chrome or Edge and start Chess-Publisher with the supplied launcher (ChessPublisher.bat).": b"Native Save As is not supported by this browser. Use current Chromium/Chrome and start Chess-Publisher from the installed Linux launcher.",
    b"Tournament name is not valid for a Windows folder.": b"Tournament name is not valid for a tournament folder.",
    b"Delete the tournament folder from Windows Explorer if required.": b"Delete the tournament folder from your Linux file manager if required.",
    b"Local FIDE updater is unavailable. Start Chess-Publisher with the supplied launcher (ChessPublisher.bat).": b"Local FIDE updater is unavailable. Start Chess-Publisher from the installed Linux launcher.",
    b"Start Chess-Publisher with the supplied launcher (ChessPublisher.bat), then try again.": b"Start Chess-Publisher from the installed Linux launcher, then try again.",
    b"FIDE data is not available. Start Chess-Publisher with the supplied launcher (ChessPublisher.bat) and run Download and update FIDE Databases first.": b"FIDE data is not available. Start Chess-Publisher from the installed Linux launcher and run Download and update FIDE Databases first.",
    b"Automatic Chess-Results deletion is available only in the installed Windows chess-publisher application.": b"Automatic Chess-Results deletion is available only in the installed Chess-Publisher desktop application.",
    b"Delete other TNR is available only in the installed Windows chess-publisher application.": b"Delete other TNR is available only in the installed Chess-Publisher desktop application.",
    b"Start Chess-Publisher with the supplied launcher (ChessPublisher-WebView.bat or ChessPublisher.bat). The official Chess-Results integration runs through the local Windows service.": b"Start Chess-Publisher from the installed Linux launcher. The official Chess-Results integration runs through the secure local Linux service.",
    b"Delete other TNR requires the installed Windows chess-publisher application so ownership can be verified in a private Admin WebView session.": b"Delete other TNR requires the installed Chess-Publisher desktop application so ownership can be verified through the secure Admin flow.",
    b"Direct DGT hardware access is available only in the installed Windows chess-publisher application.": b"Direct DGT hardware access is available only in the installed Chess-Publisher desktop application.",
    b"Windows WebView TRF bridge is unavailable.": b"Desktop TRF bridge is unavailable.",
    b"Windows TRF operation timed out.": b"Desktop TRF operation timed out.",
    b"Windows TRF operation failed.": b"Desktop TRF operation failed.",
    b"Windows PGN export failed.": b"Desktop PGN export failed.",
    b"Imported tournament name is not a valid Windows tournament folder name.": b"Imported tournament name is not a valid tournament folder name.",
    b"ChessPublisher-WebView.bat": b"Linux launcher",
    b"ChessPublisher.bat": b"Linux launcher",
}


def translate_delivered_ui(data: bytes) -> bytes:
    for old, new in _TEXT_REPLACEMENTS.items():
        data = data.replace(old, new)
    return data


def _open_text_report(engine: cp.LinuxEngine, body: dict[str, Any]) -> dict[str, Any]:
    text = str(body.get("text") or "")
    requested = str(body.get("fileName") or body.get("title") or "report.txt")
    stem = cp.safe_storage_name(Path(requested).stem or "report")
    out = engine.data_home / "reports" / f"{stem}.txt"
    cp.atomic_write_bytes(out, text.encode("utf-8"))

    # xdg-open is a package dependency. Do not fail the report write if a headless
    # environment has no desktop session; in that case return ok=false so the
    # protected UI falls back to its browser download path.
    try:
        proc = subprocess.Popen(
            ["xdg-open", str(out)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            env=os.environ.copy(),
        )
        return {"ok": True, "path": str(out), "opened": True, "platform": "linux", "pid": int(proc.pid or 0)}
    except OSError as exc:
        return {"ok": False, "path": str(out), "opened": False, "platform": "linux", "error": f"Report was saved but could not be opened: {exc}"}


def apply() -> None:
    global _APPLIED
    if _APPLIED:
        return
    _APPLIED = True

    original_serve = cp.Handler._serve_app
    def serve_app(self: cp.Handler) -> Any:
        original_text = self._text
        def platform_text(status: int, data: bytes, content_type: str) -> Any:
            if content_type.lower().startswith("text/html"):
                data = translate_delivered_ui(data)
            return original_text(status, data, content_type)
        self._text = platform_text  # type: ignore[method-assign]
        try:
            return original_serve(self)
        finally:
            self._text = original_text  # type: ignore[method-assign]
    cp.Handler._serve_app = serve_app  # type: ignore[assignment]

    original_post = cp.Handler.do_POST
    def do_post(self: cp.Handler) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if path != "/windows/open-text-report":
            return original_post(self)
        if not self._require_local_origin():
            return
        try:
            result = _open_text_report(self.engine, self._body_json(4 * 1024 * 1024))
            return self._json(200 if result.get("ok") else 503, result)
        except ValueError as exc:
            return self._json(400, {"ok": False, "error": str(exc)})
    cp.Handler.do_POST = do_post  # type: ignore[assignment]
