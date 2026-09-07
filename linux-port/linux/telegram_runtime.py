#!/usr/bin/env python3
"""Linux-safe Telegram Bot API transport for Chess-Publisher.

The bot token is accepted only for the current request. It is never persisted,
logged, cached, or included in diagnostics. The upstream host is fixed to the
official Telegram Bot API, so this transport cannot be used as a generic proxy.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

TELEGRAM_API_ORIGIN = "https://api.telegram.org"
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_TEXT_CHARS = 4096
DEFAULT_TIMEOUT = 20
_TOKEN = re.compile(r"^[0-9]{5,20}:[A-Za-z0-9_-]{20,200}$")


class TelegramRuntimeError(RuntimeError):
    pass


@dataclass(frozen=True)
class TelegramResponse:
    status: int
    payload: dict[str, Any]


def _read_json_bytes(data: bytes) -> dict[str, Any]:
    try:
        value = json.loads(data.decode("utf-8", "replace"))
    except Exception:
        return {"ok": False, "description": "Telegram returned an invalid JSON response."}
    return value if isinstance(value, dict) else {"ok": False, "description": "Telegram returned an invalid response object."}


class TelegramRuntime:
    def send_message(self, token: Any, payload: Any, timeout: int = DEFAULT_TIMEOUT) -> TelegramResponse:
        token_text = str(token or "").strip()
        if not _TOKEN.fullmatch(token_text):
            raise ValueError("Telegram Bot Token is missing or invalid.")
        if not isinstance(payload, dict):
            raise ValueError("Telegram request payload must be an object.")
        chat_id = str(payload.get("chat_id") or "").strip()
        text = str(payload.get("text") or "")
        if not chat_id or len(chat_id) > 256:
            raise ValueError("Telegram chat/channel is missing or invalid.")
        if not text:
            raise ValueError("Telegram message is empty.")
        if len(text) > MAX_TEXT_CHARS:
            raise ValueError(f"Telegram message exceeds {MAX_TEXT_CHARS} characters.")

        body = json.dumps({"chat_id": chat_id, "text": text}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            f"{TELEGRAM_API_ORIGIN}/bot{token_text}/sendMessage",
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json",
                "User-Agent": "Chess-Publisher-Linux/Telegram",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise TelegramRuntimeError("Telegram response exceeded the safety limit.")
                return TelegramResponse(int(getattr(resp, "status", 200) or 200), _read_json_bytes(raw))
        except urllib.error.HTTPError as exc:
            raw = exc.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise TelegramRuntimeError("Telegram error response exceeded the safety limit.") from exc
            payload_obj = _read_json_bytes(raw)
            payload_obj.setdefault("ok", False)
            payload_obj.setdefault("description", f"Telegram HTTP {exc.code}")
            return TelegramResponse(int(exc.code), payload_obj)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise TelegramRuntimeError(f"Telegram network request failed: {exc}") from exc
