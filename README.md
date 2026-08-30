# ChessPublisher

ChessPublisher is an open-source Windows desktop application for managing and publishing chess tournaments. The UI is HTML/CSS/JavaScript hosted in Microsoft WebView2, with a PowerShell local bridge/service. Swiss Dutch pairing is delegated to the upstream **Gacrux 1.9.57** pairing engine rather than reimplemented in JavaScript.

**Current stable distribution:** v1.04.01 (2026-08-30), promoted from the FINAL-approved RC6 candidate after a complete **36/36 PASS** Runtime & Release Gate.

## v1.04.01 stable highlights

- Swiss-Manager interoperability provides:
  - **TRF Starting List (.TXT)** for setup/participants only.
  - **Editable Tournament TXT** and **Full Tournament TXT** export paths for transferring tournament state for continuation/interoperability.
- FIDE TRF16/TRF26 workflows remain validated.
- Chess-Results TNR lifecycle evidence and XLSX round-import coverage are included in the final release gate.
- Persistence/autosave, forced managed-file failure handling, rapid correction races, tournament switching, rollback, rename/autosave, restore/reload, stale modal/context, FIDE database atomicity and full-import rollback guards are covered by the RC6 point-fix set P-07–P-27.
- Gacrux 1.9.57, Swiss Dutch pairing logic, pairing-engine TRF path, BBP independent checker and Tie-Break Checker core remain unchanged.

## Stable distribution artifacts

- Installer: `chess-publisher-v1.04.01-2026-08-30.exe`
  - SHA-256: `5642e611a13b75022578fb245ea325a75e557e14aa36b824c6cb6925ca00e24b`
- Portable/source package: `chess-publisher-v1.04.01-2026-08-30.zip`
  - SHA-256: `fbbbffdea456b895ba793e544e688021c1d1b73a024c5f440692274699b53872`
- Gacrux 1.9.57 SHA-256: `6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb`

The stable EXE and ZIP are byte-identical promotions of the candidate that passed the FINAL gate. The installer embeds the exact stable ZIP payload once, and both ZIP and installer deterministic rebuild checks passed byte-for-byte.

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

The promoted v1.04.01 RC6 candidate passed the unified FINAL Runtime & Release Gate with **36 PASS / 0 FAIL**. The gate covers exact candidate and Gacrux hashes, V138 WebView/LocalEngine handshake, PowerShell parser validation, LocalEngine `/health`, both runtime startup/shutdown paths, JavaScript 47/47, RC6 regression/dynamic persistence evidence, protected-core 11/11 identity, 85/85 ZIP readback, deterministic ZIP/EXE reproduction, exact embedded-payload identity, AMD64/PE32+ sanity, PE structure/resource checks, valid RT_MANIFEST XML, `asInvoker`, and final EXE/ZIP/SHA256 consistency.

Final gate result:

`FINAL RESULT: PASS - RELEASE APPROVED`

Full release record: `RELEASE-v1.04.01.md`.

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
