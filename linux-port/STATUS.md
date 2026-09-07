# Chess-Publisher Linux / Ubuntu development status

Updated: 2026-09-07

## Identity

- Development branch: `linux-ubuntu-port`
- Latest accepted runtime CI commit: `7eaba282ce224d70e6a10e5163e1e858322db0f4`
- Ubuntu acceptance workflow run: `34153588768` (run 104) — SUCCESS
- Package display version: `v1.06.00-beta.34-linuxdev4`
- App build: `1.06.00-beta.34-linux-dev.4`
- LocalEngine: `0.4.1-linux-dev`
- Base release target: `v1.06.00-beta.34`
- Pinned reconstructed source snapshot: `cp-v1.06.00-beta.34-linux-source-20260907`
- Pinned `ChessPublisher.html`: 1,526,307 bytes, SHA256 `f51355b1a449870be6ed69d1bb941c19a9d8d2bdf3c8f91da845b4bc1275f310`

The exact beta.34 Google Drive ZIP cannot be retrieved byte-for-byte automatically because Google Drive blocks the executable/script-containing archive. The Linux source snapshot is therefore explicitly identified as a reconstructed, SHA256-pinned snapshot, not a claim of byte identity with the beta.34 ZIP.

## Accepted Ubuntu gates

Run 104 passed all required automated Linux gates:

- protected source identity contract
- bbpPairings adapter contract
- Linux DGT serial pseudo-hardware protocol contract
- Linux WebView safety + DGT PGN contract
- real headless Google Chrome Linux bridge execution
- FIDE database runtime contract
- secure Chess-Results Worker contract
- non-destructive Chess-Results live-test contract, including ephemeral environment-token non-persistence
- integrated LocalEngine HTTP / served UI identity contract
- on-machine offline self-test: 6/6
- on-machine self-test with pinned online engines: 7/7
- Ubuntu 24.04 `apt install` -> self-test -> pinned Gacrux/BBP -> LocalEngine `/health` -> `apt purge`: PASS
- clean official Ubuntu 26.04 container install and system-Python acceptance: PASS
- TRF16 compatibility: PASS
- TRF26 rating/report fixed-width semantic compatibility: PASS
- real Round 7 Gacrux 1.9.57 pairing: PASS
- independent bbpPairings 6.0.0 comparison: PASS
- Gacrux Tie-Break final standings: 27/27 ranks, 0 mismatches

Ubuntu 26.04 acceptance used Python 3.14.4 and distribution `networkx 3.2.1`. Ubuntu 24.04 acceptance used distribution `python3-networkx 2.8.8`.

The real Round 7 fixture produces the same 13 white/black pairs in Chess-Publisher, Gacrux 1.9.57 and bbpPairings 6.0.0, with player 10 excluded from that round.

Exact full-page Chromium execution of the pinned private Drive UI remains `BLOCKED_BY_SOURCE_ACCESS`: unauthenticated CI receives a Google sign-in HTML wrapper instead of the raw 1,526,307-byte source. This is not counted as a GUI failure. The real Chromium Linux bridge passes, the exact 7/7 packaged source passes SHA256 identity, and exact served-UI HTTP delivery passes.

## Protected tournament core

The Linux port does not reimplement or modify the protected tournament algorithms. It preserves the Gacrux 1.9.57 / Swiss Dutch pairing / TRF / BBP / Tie-Break / Chess-Results protocol boundaries.

- Gacrux pinned commit: `14a34a2c2f36509b110e4f25d6247f31fc4bf2f5`
- Gacrux version: `1.9.57`
- bbpPairings version: `6.0.0`
- bbpPairings Linux archive SHA256: `bffd2d5a4dc9d86eb3d9886339e8ca446d88683f77559f0889ea0d2040e7d827`

## Chess-Results security and live diagnostics

Linux talks only to the secure Chess-Publisher Chess-Results Worker. AES/IV, GETSID/GETKEY and official bridge crypto remain Worker-side. Source ID remains 21. Ownership proofs are stored locally with restrictive permissions. Browser/Admin URLs are accepted only over HTTPS on `chess-results.com` or its subdomains.

`linuxdev4` supports two Organizer Token sources for the non-destructive live test:

1. installation-local secret store;
2. ephemeral process environment `CP_ORGANIZER_TOKEN`.

The environment token takes precedence, is kept in memory for that process only, and the live command does not create or update `secrets.json` when this path is used. CI explicitly verifies that the token is not persisted and is not echoed in diagnostic JSON.

Installed command:

```bash
chess-publisher-live-test
```

It performs only Worker `test {}`. It never creates, publishes, deletes or unlinks a tournament. Without a token it stops before networking and reports `BLOCKED`.

A real Organizer Token was supplied during development and a non-destructive live test was attempted from the local build environment. The environment could not resolve external DNS, so the request stopped with `Temporary failure in name resolution` before reaching the Worker. The token was not rejected or accepted, was not committed, was not included in CI or build artifacts, and the temporary local credential file was removed. Real remote authentication therefore remains unverified.

## Current development packages

Current clean candidate built from the exact run-104 runtime artifact plus the exact 7/7 source snapshot:

- Debian/Ubuntu amd64: `Chess-Publisher-v1.06.00-beta.34-linuxdev4-amd64.deb`
  - SHA256: `cd33d0e2c2324a43f8425f1461e876f4548ce3a9057f901fef90d1c6b1696885`
  - size: 348,400 bytes
- Portable bundle: `Chess-Publisher-v1.06.00-beta.34-linuxdev4-amd64.tar.gz`
  - SHA256: `0e321c30d5317b1c5544457e0ec29d612af1aa5c79f75340792c7a84c956b6a7`
  - size: 454,784 bytes

Artifact checks performed on the final files themselves:

- exact protected source: 7/7 SHA256 PASS
- packaged Linux runtime: 18/18 SHA256 PASS
- `.deb` and portable bundle contain no `__pycache__`, `.pyc` or `.pyo`
- launch paths set `PYTHONDONTWRITEBYTECODE=1`
- extracted `.deb` offline self-test: 6/6 PASS
- portable offline self-test: 6/6 PASS
- live-test without Organizer Token: `BLOCKED` before network PASS
- LocalEngine `/health`: `1.06.00-beta.34-linux-dev.4` / `0.4.1-linux-dev`
- exact served UI contains canonical dev4 marker and no delivered stale `linux-dev.2` marker
- exact served UI and Linux shim HTTP delivery: PASS

Installed commands:

```bash
chess-publisher
chess-publisher-self-test
chess-publisher-self-test --online-engines
chess-publisher-self-test --dgt-connect
chess-publisher-live-test
```

For a one-process non-persistent live test on a networked Ubuntu machine, set `CP_ORGANIZER_TOKEN` only for the process invoking `chess-publisher-live-test`; do not commit it or put it in shell history.

## Dependencies

Debian package runtime dependencies:

- `python3 (>= 3.10)`
- `python3-networkx (>= 2.6)`
- `xdg-utils`

DGT serial transport uses Python standard-library `termios`, `select`, and the Linux kernel serial/FTDI stack; no `pyserial` dependency is required. A real USB DGT user may need membership in `dialout`.

## Remaining stable-release blockers

- physical DGT e-Board test on actual Ubuntu hardware
- real live Chess-Results Worker `test` on a networked Ubuntu machine with a valid Organizer Token
- explicit disposable `XXX` Chess-Results create/publish/admin/delete lifecycle acceptance; this is intentionally not run automatically until safe cleanup can be guaranteed
- exact pinned full UI Chromium execution when CI can receive the authenticated raw source, or equivalent real Ubuntu desktop GUI acceptance
- AppImage acceptance only if AppImage distribution is retained

Do not merge this development branch into `main` or call it a stable Linux release until the remaining real-machine/live gates are completed.
