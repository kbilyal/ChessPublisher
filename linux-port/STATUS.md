# Chess-Publisher Linux / Ubuntu development status

Updated: 2026-09-07

## Identity

- Development branch: `linux-ubuntu-port`
- Latest accepted runtime CI commit: `6d8bf444c49f31bb1c824b1bd0a9c5bc35130eed`
- Ubuntu acceptance run: `34152113552` (run 95) — SUCCESS
- Package display version: `v1.06.00-beta.34-linuxdev3`
- App build: `1.06.00-beta.34-linux-dev.3`
- LocalEngine: `0.4.0-linux-dev`
- Base release target: `v1.06.00-beta.34`
- Pinned reconstructed source snapshot: `cp-v1.06.00-beta.34-linux-source-20260907`
- Pinned `ChessPublisher.html`: 1,526,307 bytes, SHA256 `f51355b1a449870be6ed69d1bb941c19a9d8d2bdf3c8f91da845b4bc1275f310`

The exact beta.34 Google Drive ZIP could not be retrieved byte-for-byte automatically because Google Drive blocks the executable/script-containing archive. The Linux source snapshot is therefore explicitly identified as a reconstructed, SHA256-pinned snapshot, not a claim of byte identity with the beta.34 ZIP.

## Ubuntu acceptance gates

All required automated Linux gates passed on Ubuntu 24.04:

- protected source identity contract
- bbpPairings adapter contract
- Linux DGT serial pseudo-hardware protocol contract
- Linux WebView safety + DGT PGN contract
- real headless Google Chrome Linux bridge execution
- FIDE database runtime contract
- secure Chess-Results Worker contract
- non-destructive Chess-Results live-test contract (missing-token fail-closed + sanitized `test {}` transport)
- integrated LocalEngine HTTP / served UI identity contract
- on-machine offline self-test: 6/6
- on-machine self-test with pinned online engines: 7/7
- Ubuntu `apt install` -> installed self-test -> installed pinned Gacrux/BBP preparation -> installed LocalEngine `/health` -> `apt purge` cleanup
- TRF16 compatibility
- TRF26 rating/report fixed-width semantic compatibility
- real Round 7 Gacrux 1.9.57 pairing
- independent bbpPairings 6.0.0 comparison
- Gacrux Tie-Break final standings: 27/27 ranks, 0 mismatches

The real Round 7 fixture produces the same 13 white/black pairs in Chess-Publisher, Gacrux 1.9.57 and bbpPairings 6.0.0, with player 10 excluded from that round.

Exact full-page Chromium execution of the pinned private Drive UI is currently `BLOCKED_BY_SOURCE_ACCESS`: unauthenticated CI receives a Google sign-in HTML wrapper instead of the raw 1,526,307-byte source. This is not counted as a GUI failure. A wrong raw source identity remains a hard failure. The exact pinned UI is still validated by the package source guard and by on-machine HTTP-delivery tests; the Linux bridge itself runs in real headless Chrome.

## Protected tournament core

The Linux port does not reimplement or modify the protected tournament algorithms. It preserves the Gacrux 1.9.57 / Swiss Dutch pairing / TRF / BBP / Tie-Break / Chess-Results protocol boundaries.

- Gacrux pinned commit: `14a34a2c2f36509b110e4f25d6247f31fc4bf2f5`
- Gacrux version: `1.9.57`
- bbpPairings version: `6.0.0`
- bbpPairings Linux archive SHA256: `bffd2d5a4dc9d86eb3d9886339e8ca446d88683f77559f0889ea0d2040e7d827`

## Chess-Results security and live diagnostics

Linux stores the Organizer Token only in the local secret store and communicates with the secure Chess-Publisher Chess-Results Worker. AES/IV, GETSID/GETKEY and official bridge crypto remain Worker-side. Ownership proofs are stored locally with restrictive permissions. Browser/Admin URLs are accepted only over HTTPS on `chess-results.com` or its subdomains.

Installed non-destructive live command:

```bash
chess-publisher-live-test
```

It performs only the Worker `test {}` operation. It never creates, publishes, deletes or unlinks a tournament. Without a connected Organizer Token it stops before networking and reports `BLOCKED`. Optional physical DGT check:

```bash
chess-publisher-live-test --dgt-connect
```

## Current development packages

Current clean candidate built from the run-95 verified runtime plus the exact 7/7 source snapshot:

- Debian/Ubuntu amd64: `Chess-Publisher-v1.06.00-beta.34-linuxdev3-amd64.deb`
  - SHA256: `96a62a7d8f88dc752d889fe6e201ad205324cd726de1a63cc9856636e132b73e`
  - size: 348,176 bytes
- Portable bundle: `Chess-Publisher-v1.06.00-beta.34-linuxdev3-amd64.tar.gz`
  - SHA256: `8c857bda9b7f5e27c3fe6d4c625932c36056e864029494172e67d63938e3db94`
  - size: 454,449 bytes

Artifact checks:

- exact protected source: 7/7 SHA256 PASS
- packaged Linux runtime: 18/18 SHA256 PASS
- `.deb` and portable bundle contain no `__pycache__`, `.pyc` or `.pyo`
- launchers set `PYTHONDONTWRITEBYTECODE=1`
- `.deb` offline self-test: 6/6 PASS
- portable offline self-test: 6/6 PASS
- Unicode save/open/rename PASS
- cumulative TRF backup PASS
- TRF export PASS
- local secret round-trip and `0600` PASS
- HTTP-delivery / exact packaged UI source / canonical dev3 marker PASS
- FIDE status PASS
- Chess-Results Worker-only security boundary and URL allowlist PASS
- DGT Linux diagnostics PASS
- LocalEngine `/health`: `1.06.00-beta.34-linux-dev.3` / `0.4.0-linux-dev`
- live-test without Organizer Token: fail-closed `BLOCKED` PASS

Installed self-test commands:

```bash
chess-publisher-self-test
chess-publisher-self-test --online-engines
chess-publisher-self-test --dgt-connect
chess-publisher-live-test
```

## Dependencies

Debian package runtime dependencies:

- `python3 (>= 3.10)`
- `python3-networkx (>= 2.6)`
- `xdg-utils`

Ubuntu 24.04 package-manager acceptance used the distribution `python3-networkx 2.8.8`; installed Gacrux/BBP preparation passed with the system `/usr/bin/python3`.

DGT serial transport uses Python standard-library `termios`, `select`, and the Linux kernel serial/FTDI stack; no `pyserial` dependency is required. A real USB DGT user may need membership in `dialout`.

## Remaining stable-release blockers

- physical DGT e-Board test on actual Ubuntu hardware
- real live Chess-Results Worker `test` using an Organizer Token stored in an actual Linux installation
- explicit disposable `XXX` Chess-Results create/publish/admin/delete lifecycle acceptance; this is intentionally not run automatically
- exact pinned full UI Chromium execution when CI can receive the authenticated raw source, or equivalent real Ubuntu desktop GUI acceptance
- AppImage acceptance only if AppImage distribution is retained

Do not merge this development branch into `main` or call it a stable Linux release until the remaining real-machine/live gates are completed.
