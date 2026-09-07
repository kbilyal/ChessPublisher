# Chess-Publisher Linux / Ubuntu development status

Updated: 2026-09-07

## Identity

- Development branch: `linux-ubuntu-port`
- Latest accepted functional runtime commit: `48cbfabbd19fff9f861a49140c719f21c1adc401`
- Ubuntu acceptance run: `34156257511` (run 120) — SUCCESS
- Package display version: `v1.06.00-beta.34-linuxdev5`
- App build: `1.06.00-beta.34-linux-dev.5`
- LocalEngine: `0.5.0-linux-dev`
- Base release target: `v1.06.00-beta.34`
- Pinned reconstructed source snapshot: `cp-v1.06.00-beta.34-linux-source-20260907`
- Pinned `ChessPublisher.html`: 1,526,307 bytes, SHA256 `f51355b1a449870be6ed69d1bb941c19a9d8d2bdf3c8f91da845b4bc1275f310`

The exact beta.34 Google Drive ZIP remains blocked for automated byte-for-byte archive download because Drive blocks executable/script-containing archives. The Linux port therefore uses the explicitly pinned 7-file reconstructed source snapshot; it does not claim byte identity with the beta.34 ZIP.

## Accepted automated gates

Run 120 passed the complete current Linux workflow on Ubuntu 24.04 and a clean Ubuntu 26.04 container:

- protected source identity
- Linux LocalEngine syntax/runtime
- exact packaged source guard: 7/7
- runtime manifest integrity
- local save/open/rename, Unicode, atomic writes, secret permissions
- cumulative TRF backup and TRF export
- TRF16 compatibility
- TRF26 fixed-width/report compatibility
- Gacrux 1.9.57 real Dutch pairing
- bbpPairings 6.0.0 independent comparison
- 13/13 Round 7 pairing equivalence
- Gacrux Tie-Break standings: 27/27 ranks, 0 mismatches
- FIDE database runtime and LocalEngine `/fide-update` routing
- Chess-Results secure Worker-only protocol contract
- Hub/Cloud local proxy bridge and browser security boundary
- DGT Linux serial pseudo-hardware protocol and PGN bridge
- Telegram fixed-host LocalEngine transport and WebView proxy
- Linux TXT/report save + `xdg-open` desktop integration
- Linux-only delivered UI wording without modifying the protected HTML on disk
- real headless Chromium Linux bridge
- Debian package install -> self-test -> pinned engine preparation -> LocalEngine health -> purge on Ubuntu 24.04
- clean Ubuntu 26.04 package/container acceptance

The exact private Drive UI raw-download Chromium gate remains source-access blocked in CI; the exact pinned UI is nevertheless source-hash verified and package-level HTTP delivery/platform translation was separately validated.

## Linux compatibility work completed in dev5

Telegram no longer relies on a direct cross-origin browser call. The browser shim intercepts the official Telegram Bot API `sendMessage` call and passes it to a fixed-host LocalEngine transport. The bot token is request-scoped and is not persisted or logged by this transport.

TXT reports now use the Linux desktop path and `xdg-open`. The protected application HTML is unchanged on disk. Windows-specific user-facing launcher/COM/File Explorer wording is translated only while the Linux LocalEngine serves the page; protected TRF/pairing/Chess-Results/DGT markers remain intact.

The normal Linux launcher applies FIDE, Chess-Results, DGT, Telegram and desktop integrations. The historical fail-closed `/fide-update` fallback in the base host is not the installed route: the FIDE integration intercepts that endpoint first. Run 120 explicitly tests that `/fide-update` reaches the FIDE runtime and rejects an external Origin.

## Protected tournament core

Do not reimplement or alter:

- Gacrux 1.9.57
- Swiss Dutch pairing logic
- TRF pairing/export core
- BBP checker
- Tie-Break core/checker
- Chess-Results XML/protocol/crypto boundary

Pinned engines:

- Gacrux version `1.9.57`, commit `14a34a2c2f36509b110e4f25d6247f31fc4bf2f5`
- bbpPairings `6.0.0`, archive SHA256 `bffd2d5a4dc9d86eb3d9886339e8ca446d88683f77559f0889ea0d2040e7d827`

## Current clean candidate

- Debian/Ubuntu amd64: `Chess-Publisher-v1.06.00-beta.34-linuxdev5-amd64.deb`
  - SHA256 `d3231c399c43dfb62fa7491308dab1182672eeeb3b027de2b1d209a2be9583de`
  - 350,616 bytes
- Portable amd64: `Chess-Publisher-v1.06.00-beta.34-linuxdev5-amd64.tar.gz`
  - SHA256 `794d09bb8a2dbf3ee42e867810e12ec8fb83a6b19178d2d9e6be67f8a040868e`
  - 458,576 bytes

Final package-level checks: protected source 7/7 PASS, packaged runtime 21/21 PASS, no `.pyc`/`.pyo`/`__pycache__`, offline self-test 6/6 PASS, exact delivered UI platform layer PASS.

## Intentionally deferred final gates

These are not software placeholders and are left until the end:

- real Chess-Results Worker `test {}` using the organizer token on a networked Ubuntu installation
- disposable federation `XXX` Chess-Results create/publish/admin/delete lifecycle
- physical DGT e-Board test on actual Ubuntu hardware

A real Telegram message can also be used as an external-service acceptance check when a disposable/test Bot Token and chat are available; the transport/proxy contracts are already automated and passing.

Do not merge this branch into `main` or call it a stable Linux release until the intentionally deferred real-service/hardware gates are completed.
