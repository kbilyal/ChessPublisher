# Chess-Publisher — FIDE/TEC development branch

> **Current development checkpoint: `v1.06.00-beta.54 — Rating List Freshness Verification`**

This branch exists to preserve the **current development handoff and compliance state** while the older validated/stable history remains on `main`.

## Read these first

1. [`DEVELOPMENT-STATE.md`](DEVELOPMENT-STATE.md)
2. [`NEW-CHAT-HANDOFF.md`](NEW-CHAT-HANDOFF.md)
3. [`PROTECTED-CORE.md`](PROTECTED-CORE.md)
4. [`DRIVE-ARTIFACTS.md`](DRIVE-ARTIFACTS.md)

## Critical source warning

The root `ChessPublisher.html` and other legacy files inherited from `main` are **older stable repository content and are NOT the beta.54 FIDE/TEC source checkpoint**. Do not reconstruct beta.54 by treating that inherited HTML as the current source.

The exact beta.54 development checkpoint, versioned VCL evidence, English manual and regression artifacts are stored in the Google Drive release folder documented in `DRIVE-ARTIFACTS.md`.

This limitation is explicit because automated GitHub write access in this workflow can safely write UTF-8 text files but is not the authoritative binary/package transport for the current portable release.

## Current beta.54 gate

- Q141 PASS.
- Dedicated beta.54: **23/23 PASS**.
- Static audit: **PASS**.
- Cumulative: **38 PASS / 3 historical exceptions / 1 browser-runner skip**.
- Unexpected functional failures: **0**.
- Protected core: **70/70 byte-identical to beta.53**.

## Next work

Continue automatically from beta.54:

1. **Q135** — maintained FIDE rating-list freshness while Chess-Publisher is running.
2. **Q139** — automatic first-opportunity rating consistency check.
3. Then re-read the living VCL `Blockers` sheet and continue with the next actionable P0/P1 blocker.

Do not implement conditional PTC/RTG work until TEC confirms whether the external-engine exemption applies.

## Release discipline

`implement -> dedicated tests -> static audit -> cumulative regression -> protected-core hash gate -> VCL update -> self-describing docs -> package/hash -> Drive upload -> living master VCL in-place update -> next actionable blocker`

No development beta is to be called Final/Stable. The target is a consolidated TAPC/RC candidate after all applicable VCL items and Windows-native acceptance gates are complete.
