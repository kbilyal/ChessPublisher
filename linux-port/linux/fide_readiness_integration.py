#!/usr/bin/env python3
"""FIDE readiness policy for Chess-Publisher Linux.

Standard, Rapid and Blitz are the operational rating lists used by the UI.
The optional full LEGACY XML/SQLite directory has its own legacyReady flag and
must not block normal rating-list availability.
"""
from __future__ import annotations

import fide_runtime as runtime

_APPLIED = False
_ORIGINAL_STATUS = None


def apply() -> None:
    global _APPLIED, _ORIGINAL_STATUS
    if _APPLIED:
        return
    _ORIGINAL_STATUS = runtime.FideRuntime.status

    def status(self):
        current = _ORIGINAL_STATUS(self)
        lists_ready = all(bool((current.lists.get(key) or {}).get("ready")) for key in runtime.LISTS)
        return runtime.FideStatus(
            lists_ready,
            current.lists,
            current.legacy_ready,
            current.legacy_players,
            current.updated_at,
        )

    runtime.FideRuntime.status = status
    _APPLIED = True
