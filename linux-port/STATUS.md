# Chess-Publisher Linux / Ubuntu development status

Updated: 2026-09-07

## Identity

- Development branch: `linux-ubuntu-port`
- Latest accepted CI commit: `6f027212216d07cb59fb604a4d1a0caf9f7b8387`
- Ubuntu acceptance run: `34147177398` — SUCCESS
- Package display version: `v1.06.00-beta.34-linuxdev3`
- App build: `1.06.00-beta.34-linux-dev.3`
- LocalEngine: `0.4.0-linux-dev`
- Base release target: `v1.06.00-beta.34`
- Pinned reconstructed source snapshot: `cp-v1.06.00-beta.34-linux-source-20260907`
- Pinned `ChessPublisher.html`: 1,526,307 bytes, SHA256 `f51355b1a449870be6ed69d1bb941c19a9d8d2bdf3c8f91da845b4bc1275f310`

The exact beta.34 Google Drive ZIP could not be byte-for-byte retrieved because Google Drive blocks automated download of the executable/script-containing archive. The Linux source snapshot is therefore explicitly identified as a reconstructed and SHA256-pinned source snapshot, not as a byte-identical copy of the beta.34 ZIP.

## Real Ubuntu acceptance gates

All of the following passed on Ubuntu 24.04 in GitHub Actions:

- protected source identity contract
- bbpPairings adapter contract
- Linux DGT serial protocol pseudo-hardware contract
- Linux WebView safety + DGT PGN contract
- FIDE database runtime contract
- secure Chess-Results Worker contract
- integrated LocalEngine HTTP contract
- installed/package-like Linux offline self-test contract
- installed/package-like self-test `--online-engines` contract
- TRF16 compatibility gate
- TRF26 rating/report fixed-width semantic compatibility gate
- real Round 7 Gacrux 1.9.57 pairing
- independent bbpPairings 6.0.0 pairing comparison
- Gacrux Tie-Break final standings comparison: 27/27 ranks, 0 mismatches

The current real Round 7 fixture produces the same 13 white/black pairs in Chess-Publisher, Gacrux 1.9.57 and bbpPairings 6.0.0, with player 10 excluded from that round.

The self-test online-engine gate independently downloads and verifies the pinned Gacrux 1.9.57 and bbpPairings 6.0.0 runtimes before reporting PASS.

## Protected tournament core

The Linux port does not reimplement or modify the protected tournament algorithms. In particular it preserves the protected Gacrux 1.9.57 / Swiss Dutch pairing / TRF / BBP / Tie-Break / Chess-Results protocol boundaries. Gacrux is pinned to upstream commit `14a34a2c2f36509b110e4f25d6247f31fc4bf2f5`; the verified bbpPairings 6.0.0 Linux archive SHA256 is `bffd2d5a4dc9d86eb3d9886339e8ca446d88683f77559f0889ea0d2040e7d827`.

## Chess-Results security

Linux keeps the Organizer Token in the local secret store and talks only to the secure Chess-Publisher Chess-Results Worker. AES key/IV, GETSID/GETKEY secrets and official bridge crypto remain Worker-side. Organizer ownership proofs are persisted locally with restrictive permissions. Browser/Admin URLs returned by the Worker are accepted only over HTTPS on `chess-results.com` or its subdomains.

## Development packages built from the verified runtime

Current clean development candidate: `linuxdev3`.

- Debian/Ubuntu amd64: `Chess-Publisher-v1.06.00-beta.34-linuxdev3-amd64.deb`
  - SHA256: `cb3c830da674ca11bcef857d88fe270dc877ba7bf71bb9629ade4210faf9df41`
  - size: 346,248 bytes
- Portable bundle: `Chess-Publisher-v1.06.00-beta.34-linuxdev3-amd64.tar.gz`
  - SHA256: `cf7485258fa508223194810bbb071559358cfc994e692fb3b36654dd82bd5499`
  - size: 451,709 bytes

Packaging and on-machine checks passed:

- exact 7/7 protected source files match `source_manifest.json`
- 16/16 packaged Linux runtime files match the runtime SHA256 manifest
- `.deb` contains no `__pycache__`, `.pyc` or `.pyo`
- portable bundle contains no Python bytecode
- both launch paths set `PYTHONDONTWRITEBYTECODE=1`
- extracted `.deb` passes the on-machine offline self-test: 5/5
- portable bundle passes the same on-machine offline self-test: 5/5
- Unicode save/open/rename PASS
- cumulative TRF backup PASS
- TRF export PASS
- local secret store round-trip and `0600` permissions PASS
- FIDE status contract PASS
- Chess-Results Worker-only security boundary and URL allowlist PASS
- DGT Linux diagnostics contract PASS
- packaged LocalEngine `/health` PASS and reports exactly `1.06.00-beta.34-linux-dev.3` / `0.4.0-linux-dev`

Installed package self-test command:

```bash
chess-publisher-self-test
```

Optional pinned engine download/integrity test:

```bash
chess-publisher-self-test --online-engines
```

Optional real DGT non-destructive connect / `BOARD_DUMP` test:

```bash
chess-publisher-self-test --dgt-connect
```

Portable equivalents are `./linux/run-self-test.sh`, with the same optional flags.

## Dependencies

Debian package runtime dependencies:

- `python3 (>= 3.10)`
- `python3-networkx`
- `xdg-utils`

DGT serial transport uses Python standard library `termios`, `select` and the Linux kernel serial/FTDI stack; no `pyserial` dependency is required. A real USB DGT user may need membership in the `dialout` group.

## Not yet production/tournament-ready

The following remain acceptance blockers before a stable Linux release:

- physical DGT e-Board hardware test on an actual Ubuntu machine
- full GUI/browser end-to-end test on a normal Ubuntu desktop (the local sandbox browser blocks navigation by policy)
- live Chess-Results test/create/publish using a real Organizer Token and disposable `XXX` test tournament
- install/uninstall test with `apt`/`dpkg` on a normal Ubuntu workstation, including desktop launcher behavior
- AppImage packaging/acceptance only if AppImage distribution is retained

Do not merge this development branch into `main` or call it a stable Linux release until the remaining real-machine gates are completed.
