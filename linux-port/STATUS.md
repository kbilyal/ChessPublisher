# Chess-Publisher Linux / Ubuntu development status

Updated: 2026-09-07

## Identity

- Development branch: `linux-ubuntu-port`
- Latest accepted functional runtime commit: `2f74c8c1df83701be88d3659df6a4cd71ee5a0d7`
- Ubuntu acceptance run: `34159374877` (run 129) — SUCCESS
- Package display version: `v1.06.00-beta.34-linuxdev6`
- App build: `1.06.00-beta.34-linux-dev.6`
- LocalEngine: `0.5.1-linux-dev`
- Base release target: `v1.06.00-beta.34`
- Pinned reconstructed source snapshot: `cp-v1.06.00-beta.34-linux-source-20260907`
- Pinned `ChessPublisher.html`: 1,526,307 bytes, SHA256 `f51355b1a449870be6ed69d1bb941c19a9d8d2bdf3c8f91da845b4bc1275f310`

The exact beta.34 Drive ZIP remains blocked for automated byte-for-byte archive download because Drive blocks executable/script-containing archives. The Linux port therefore uses the explicitly pinned 7-file reconstructed source snapshot and does not claim byte identity with the ZIP.

## dev6 FIDE fix

A real dev5 installation reported:

`FIDE database update incomplete: legacy: FIDE extracted .xml payload size is outside safety limits.`

The original Linux preview capped the extracted official FIDE LEGACY XML at 260 MiB. The current official file has grown beyond that guard. dev6 keeps bounded, streaming extraction/import but raises the LEGACY XML cap to 768 MiB and adds an independent ZIP expansion-ratio limit of 120x.

Regression gate:

- representative 384 MiB LEGACY XML: PASS
- 769 MiB XML: rejected by absolute cap
- 512 MiB payload compressed to 2 MiB (256x): rejected as suspicious expansion
- FIDE LocalEngine `/fide-update` routing: PASS

The XML is still extracted incrementally and parsed with `ElementTree.iterparse`; the SQLite player index remains streamed/batched rather than loading the full XML into memory.

## Accepted automated gates

Run 129 passed the complete Linux workflow on Ubuntu 24.04 and a clean Ubuntu 26.04 container:

- protected source identity 7/7
- packaged runtime integrity 22/22
- local save/open/rename, Unicode, atomic writes and secret permissions
- cumulative TRF backup and TRF export
- TRF16 compatibility
- TRF26 fixed-width/report compatibility
- Gacrux 1.9.57 real Dutch pairing
- bbpPairings 6.0.0 independent comparison
- 13/13 Round 7 pairing equivalence
- Gacrux Tie-Break standings 27/27, 0 mismatches
- FIDE runtime, update endpoint and large-LEGACY-XML policy
- Chess-Results secure Worker protocol contract
- Hub/Cloud local proxy bridge
- DGT Linux serial pseudo-hardware protocol and PGN bridge
- Telegram LocalEngine transport and WebView proxy
- Linux TXT/report save + `xdg-open`
- Linux-only delivered UI wording without changing protected source on disk
- real headless Chromium Linux bridge
- Debian install -> self-test -> pinned engines -> LocalEngine health -> purge on Ubuntu 24.04
- clean Ubuntu 26.04 package/container acceptance

The exact private Drive UI raw-download Chromium gate remains source-access blocked in CI; exact pinned UI identity and package HTTP delivery are independently validated.

## Protected tournament core

Do not reimplement or alter:

- Gacrux 1.9.57
- Swiss Dutch pairing logic
- TRF pairing/export core
- BBP checker
- Tie-Break core/checker
- Chess-Results XML/protocol/crypto boundary

Pinned engines:

- Gacrux `1.9.57`, commit `14a34a2c2f36509b110e4f25d6247f31fc4bf2f5`
- bbpPairings `6.0.0`, archive SHA256 `bffd2d5a4dc9d86eb3d9886339e8ca446d88683f77559f0889ea0d2040e7d827`

## Current clean candidate

- Debian/Ubuntu amd64: `Chess-Publisher-v1.06.00-beta.34-linuxdev6-amd64.deb`
  - SHA256 `784c9da6c59647040147f51f3213bf47a4d18f1626da330478defe10bb69e2a1`
  - 351,212 bytes
- Portable amd64: `Chess-Publisher-v1.06.00-beta.34-linuxdev6-amd64.tar.gz`
  - SHA256 `e81354d8623c8b48ee0956c476134f6d8e0ca001835ec1f37ec46e49510fdfb9`
  - 459,406 bytes

Package-level checks: protected source 7/7 PASS, runtime 22/22 PASS, no Python bytecode, self-test 6/6 PASS, exact delivered UI platform layer PASS, packaged FIDE large-XML policy PASS.

## Intentionally deferred final gates

Leave these until the end:

- real Chess-Results Worker `test {}` using the Organizer Token on a networked Ubuntu installation
- disposable federation `XXX` Chess-Results create/publish/admin/delete lifecycle
- physical DGT e-Board test on actual Ubuntu hardware

Do not merge this development branch into `main` or call it a stable Linux release until the deferred live/hardware gates are completed.
