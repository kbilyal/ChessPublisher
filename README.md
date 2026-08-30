# ChessPublisher

ChessPublisher is an open-source Windows desktop application for managing and publishing chess tournaments. The UI is HTML/CSS/JavaScript hosted in Microsoft WebView2, with a PowerShell local bridge/service. Swiss Dutch pairing is delegated to the upstream **Gacrux 1.9.57** pairing engine rather than reimplemented in JavaScript.

**Latest validated application candidate:** v1.04.01 (2026-08-30).

The v1.04.01 Windows runtime gate passed with the exact tested UI, WebView host, LocalEngine and Gacrux hashes. The public repository must remain credential-free: production integration material that contains service-shared credentials is not committed. Until the credential-injection path is fully public/reproducible, GitHub release publication remains manual and intentionally blocked from automatic VERSION-triggered publishing.

## v1.04.01 highlights

- Swiss-Manager interoperability now has two explicit exports:
  - **TRF Starting List (.TXT)** for setup/participants only.
  - **Full Tournament to Swiss-Manager (.TXT)** with tournament setup, players, generated rounds, results and genuine forfeits/byes, intended for continuing/editing the tournament in Swiss-Manager.
- Fixed the completed-round persistence gap that could leave corrected results stale in `tournament.json` / `Latest.trf` when Autosave was off.
- Critical result persistence is serialized and revision-guarded; exports wait for a stable persisted revision before writing.
- Shortened the Round Complete dialog to a single informational sentence.
- Gacrux 1.9.57, Swiss Dutch pairing logic, pairing-engine TRF path, BBP independent checker and Tie-Break Checker core remain unchanged.

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
ChessPublisher.exe (small open-source C# launcher)
  -> ChessPublisher-WebView.ps1 (WinForms/WebView2 host)
      -> ChessPublisher.html (HTML/CSS/JavaScript UI)
      -> WebViewAdapter.js (native/UI bridge)
      -> ChessPublisher-LocalEngine.ps1 (local service + integrations)
          -> Gacrux 1.9.57 (upstream FIDE pairing engine)
```

The Gacrux binary is **not authored or re-signed by ChessPublisher**. Release packaging pins Gacrux 1.9.57 and verifies the expected SHA-256 before use.

Expected Gacrux SHA-256:

```text
6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb
```

## Credentials

**No service credential should be embedded in the public source tree.** User-owned credentials such as Telegram tokens remain local. Any service-shared production integration material must be injected outside the public source tree; do not commit credentials, tournament backups or signing keys.

## Release discipline

A candidate is not considered a release until all mandatory gates pass, including JavaScript syntax, ZIP readback/reproducibility, installer payload identity, PE/manifest checks, exact WebView↔LocalEngine service handshake, LocalEngine startup, STA runspace startup/shutdown, child-process fallback startup/shutdown and protected pairing/checker regression guards.

For v1.04.01 the real Windows runtime gate passed on 2026-08-30 with:

- WebView / LocalEngine handshake: `V138 / V138`
- LocalEngine SHA-256: `0fe60d712d9a470d0487149bd72b25d8597bbcc56b18361db6156a41be7b5602`
- Gacrux 1.9.57 SHA-256: `6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb`
- STA in-process runspace startup + shutdown: PASS
- `System.Diagnostics.Process` fallback startup + shutdown: PASS

## Network behavior and privacy

ChessPublisher has no project analytics or tracking. On first use, the WebView host may download the official Microsoft WebView2 SDK package from NuGet if the SDK files are not already cached. Network features for FIDE, Chess-Results and Telegram are used when the operator invokes/configures those features. See `PRIVACY.md`.

## Code signing policy

The project is being prepared for the free SignPath Foundation OSS signing program. **Free code signing provided by SignPath.io, certificate by SignPath Foundation** once the application is accepted and the signing pipeline is activated.

- Committer / reviewer: [Kyamran Bilyal (`kbilyal`)](https://github.com/kbilyal)
- Signing approver: [Kyamran Bilyal (`kbilyal`)](https://github.com/kbilyal)
- Builds intended for signing are produced on GitHub-hosted Windows runners from public, credential-free source.
- Third-party upstream binaries are not signed as ChessPublisher-owned code.

Full policy: `CODE_SIGNING.md`.

## License

ChessPublisher-owned source is released under the MIT License. Third-party components retain their own licenses; see `THIRD_PARTY_NOTICES.md`.
