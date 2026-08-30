# ChessPublisher

ChessPublisher is an open-source Windows desktop application for managing and publishing chess tournaments. The UI is HTML/CSS/JavaScript hosted in Microsoft WebView2, with a PowerShell local bridge/service. Swiss Dutch pairing is delegated to the upstream **Gacrux 1.9.57** pairing engine rather than reimplemented in JavaScript.

**Current stable distribution:** v1.04.02 (2026-08-30), a version-only promotion of the FINAL-approved v1.04.01 RC6 codebase after a complete **36/36 PASS** Runtime & Release Gate on the v1.04.02 RC1 candidate.

## v1.04.02 stable highlights

- Swiss-Manager interoperability provides:
  - **TRF Starting List (.TXT)** for setup/participants only.
  - **Editable Tournament TXT** and **Full Tournament TXT** export paths for transferring tournament state for continuation/interoperability.
- FIDE TRF16/TRF26 workflows remain validated.
- Chess-Results TNR lifecycle evidence and XLSX round-import coverage are included in the final release gate.
- Persistence/autosave, forced managed-file failure handling, rapid correction races, tournament switching, rollback, rename/autosave, restore/reload, stale modal/context, FIDE database atomicity and full-import rollback guards are covered by the RC6 point-fix set P-07–P-27.
- v1.04.02 changes only release/version metadata relative to the approved RC6 functional codebase.
- Gacrux 1.9.57, Swiss Dutch pairing logic, pairing-engine TRF path, BBP independent checker, Tie-Break Checker core and Chess-Results XML/network protocol core remain unchanged.

## Stable distribution artifacts

- Installer: `chess-publisher-v1.04.02-2026-08-30.exe`
  - SHA-256: `5af57ede202f1e65c8fc2e2356af5c6961bd6902006269a7f8b64ffb08accacf`
- Portable/source package: `chess-publisher-v1.04.02-2026-08-30.zip`
  - SHA-256: `316eadb9c2f12ea2021ffbc3852c81614140daf55015e00992cd59974336fa20`
- Gacrux 1.9.57 SHA-256: `6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb`

The stable EXE and ZIP are byte-identical promotions of the v1.04.02 RC1 candidate that passed the FINAL gate. The installer embeds the exact stable ZIP payload once, and both ZIP and installer deterministic rebuild checks passed byte-for-byte.

## Main features

- Tournament setup, registration, pairings, result entry and standings
- FIDE rating-list workflows and TRF16/TRF26 export
- Swiss pairing through Gacrux 1.9.57
- Chess-Results publishing/admin integration
- Telegram publishing configured by the user
- DGT e-Board detection/mapping foundation
- Local tournament storage under the user's Documents folder

## Architecture

```text
ChessPublisher.exe
  -> ChessPublisher-WebView.ps1
      -> ChessPublisher.html
      -> WebViewAdapter.js
      -> ChessPublisher-LocalEngine.ps1
          -> Gacrux 1.9.57
```

## Credentials

**No service credential should be embedded in the public source tree.** User-owned credentials such as Telegram tokens remain local. Service-shared production integration material is intentionally not committed to this public repository.

This means the public repository documents the stable distribution version and credential-free source baseline, while the complete production runtime package is distributed separately. Do not commit credentials, tournament backups, signing keys or production shared AES material.

## Release discipline

The v1.04.02 RC1 candidate passed the unified FINAL Runtime & Release Gate with **36 PASS / 0 FAIL**. The gate covers exact candidate and Gacrux hashes, V138 WebView/LocalEngine handshake, PowerShell parser validation, LocalEngine `/health`, both runtime startup/shutdown paths, JavaScript 47/47, RC6 regression/dynamic persistence evidence, protected-core identity, live v1.04.02 metadata validation, 85/85 ZIP readback, deterministic ZIP/EXE reproduction, exact embedded-payload identity, AMD64/PE32+ sanity, PE structure/resource checks, valid RT_MANIFEST XML, `asInvoker`, and final EXE/ZIP/SHA256 consistency.

Final gate result:

`FINAL RESULT: PASS - RELEASE APPROVED`

Full release record: `RELEASE-v1.04.02.md`.

## Network behavior and privacy

ChessPublisher has no project analytics or tracking. Network features for FIDE, Chess-Results and Telegram are used when the operator invokes/configures those features. See `PRIVACY.md`.

## Code signing policy

The project is being prepared for the free SignPath Foundation OSS signing program. **Free code signing provided by SignPath.io, certificate by SignPath Foundation** once the application is accepted and the signing pipeline is activated.

- Committer / reviewer: [Kyamran Bilyal (`kbilyal`)](https://github.com/kbilyal)
- Signing approver: [Kyamran Bilyal (`kbilyal`)](https://github.com/kbilyal)
- Builds intended for signing are produced on GitHub-hosted Windows runners from public, credential-free source.
- Third-party upstream binaries are not signed as ChessPublisher-owned code.

Full policy: `CODE_SIGNING.md`.

## License

ChessPublisher-owned source is released under the MIT License. Third-party components retain their own licenses; see `THIRD_PARTY_NOTICES.md`.
