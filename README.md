# ChessPublisher

ChessPublisher is an open-source Windows desktop application for managing and publishing chess tournaments. The UI is HTML/CSS/JavaScript hosted in Microsoft WebView2, with a PowerShell local bridge/service. Swiss Dutch pairing is delegated to the upstream **Gacrux 1.9.57** pairing engine rather than reimplemented in JavaScript.

**Current stable distribution:** v1.04.01 (2026-08-30), based on the maintainer-approved RC2 package.

## v1.04.01 stable highlights

- Swiss-Manager interoperability provides:
  - **TRF Starting List (.TXT)** for setup/participants only.
  - **Export Tournament in TXT** for transferring the generated tournament, including players, rounds, entered results and legitimate forfeits/byes, so the event can be continued in Swiss-Manager.
- Fixed the completed-round persistence gap that could leave corrected results stale in `tournament.json` / `Latest.trf` when Autosave was off.
- Critical result persistence is serialized and revision-guarded.
- Fixed the self-triggered export revision error where automatic TRF backup validation could increment the internal state revision during FIDE/Swiss-Manager export preparation.
- Routine successful `Saved to file` / autosave success text is hidden; only meaningful save/error/read-only states remain visible.
- Shortened the Round Complete dialog to a single informational sentence.
- Gacrux 1.9.57, Swiss Dutch pairing logic, pairing-engine TRF path, BBP independent checker and Tie-Break Checker core remain unchanged.

## Stable distribution artifacts

- Installer: `chess-publisher-v1.04.01-2026-08-30.exe`
  - SHA-256: `6162042359a3d24647fd8f250571004dd8ffa4f18a2245cfb90bb7944d0ec0cb`
- Portable/source package: `chess-publisher-v1.04.01-2026-08-30.zip`
  - SHA-256: `fe2ac470a6f2cd351139e45043c7b5112006e0bbedadd3f5f932be84b3e84645`
- Gacrux 1.9.57 SHA-256: `6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb`

The stable ZIP is byte-identical to the accepted RC2 payload; the installer embeds that exact ZIP payload once and was reproduced byte-for-byte in a second deterministic build.

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

This means the public repository documents the stable distribution version and credential-free source baseline, while the complete production runtime package is distributed separately. Do not commit credentials, tournament backups or signing keys.

## Release discipline

The accepted v1.04.01 RC2 package passed targeted JavaScript/export/persistence regression, ZIP CRC/readback, deterministic ZIP reproduction and protected-core hash checks. The stable installer packaging additionally passed deterministic EXE reproduction, exact embedded-ZIP identity, AMD64/PE32+ sanity and a valid `asInvoker` RT_MANIFEST.

The earlier v1.04.01 Windows runtime gate validated the unchanged V138 WebView/LocalEngine runtime path, including STA in-process runspace startup/shutdown and `System.Diagnostics.Process` fallback startup/shutdown. RC2 changes are confined to the HTML/UI/export persistence layer; the WebView host, LocalEngine and Gacrux hashes are unchanged.

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
