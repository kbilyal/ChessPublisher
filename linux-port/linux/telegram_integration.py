#!/usr/bin/env python3
"""Attach the fixed-host Telegram transport to the Linux LocalEngine."""
from __future__ import annotations
import urllib.parse
from typing import Any

import chess_publisher_linux as cp
from telegram_runtime import TelegramRuntime, TelegramRuntimeError

_APPLIED = False


def apply() -> None:
    global _APPLIED
    if _APPLIED:
        return
    _APPLIED = True

    original_init = cp.LinuxEngine.__init__
    def init(self: cp.LinuxEngine, *args: Any, **kwargs: Any) -> None:
        original_init(self, *args, **kwargs)
        self.telegram = TelegramRuntime()
    cp.LinuxEngine.__init__ = init  # type: ignore[assignment]

    original_post = cp.Handler.do_POST
    def do_post(self: cp.Handler) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if path != "/telegram/send-message":
            return original_post(self)
        if not self._require_local_origin():
            return
        try:
            body = self._body_json(64 * 1024)
            result = self.engine.telegram.send_message(body.get("token"), body.get("payload"))
            return self._json(result.status, result.payload)
        except ValueError as exc:
            return self._json(400, {"ok": False, "description": str(exc)})
        except TelegramRuntimeError as exc:
            return self._json(503, {"ok": False, "description": str(exc), "service": "Telegram Bot API", "platform": "linux"})
    cp.Handler.do_POST = do_post  # type: ignore[assignment]
