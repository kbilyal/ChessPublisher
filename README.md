# ChessPublisher

ChessPublisher is an open-source Windows desktop application for managing and publishing chess tournaments. The UI is HTML/CSS/JavaScript hosted in Microsoft WebView2, with a PowerShell local bridge/service. Swiss Dutch pairing is delegated to the upstream **Gacrux 1.9.57** pairing engine rather than reimplemented in JavaScript.

**Current OSS baseline:** v1.03.64 (2026-08-29).

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

The Gacrux binary is **not authored or re-signed by ChessPublisher**. The build downloads a pinned upstream release archive and verifies SHA-256 before packaging it.

## Credentials

**No service credential should be embedded in the public source tree.** Telegram bot tokens and Chess-Results credentials are user-provided and stored locally by the application. Do not commit credentials, tournament backups or signing keys.

## Network behavior and privacy

ChessPublisher has no project analytics or tracking. On first use, the WebView host may download the official Microsoft WebView2 SDK package from NuGet if the SDK files are not already cached. Network features for FIDE, Chess-Results and Telegram are used when the operator invokes/configures those features. See `PRIVACY.md`.

## Code signing policy

The project is being prepared for the free SignPath Foundation OSS signing program. **Free code signing provided by SignPath.io, certificate by SignPath Foundation** once the application is accepted and the signing pipeline is activated.

- Committer / reviewer: [Kyamran Bilyal (`kbilyal`)](https://github.com/kbilyal)
- Signing approver: [Kyamran Bilyal (`kbilyal`)](https://github.com/kbilyal)
- Builds intended for signing are produced on GitHub-hosted Windows runners from this public repository.
- Third-party upstream binaries are not signed as ChessPublisher-owned code.

Full policy: `CODE_SIGNING.md`.

## License

ChessPublisher-owned source is released under the MIT License. Third-party components retain their own licenses; see `THIRD_PARTY_NOTICES.md`.
