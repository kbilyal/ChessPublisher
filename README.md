# Chess-Publisher

Chess-Publisher is an open-source Windows desktop application for managing and publishing chess tournaments. The UI is HTML/CSS/JavaScript hosted in Microsoft WebView2, with a PowerShell local bridge/service. Swiss Dutch pairing is delegated to the upstream **Gacrux 1.9.57** pairing engine rather than reimplemented in JavaScript.

**Current stable distribution:** **v1.05.01 (2026-09-03)**.

## v1.05.01 stable

v1.05.01 is a deliberately narrow maintenance release promoted from `v1.05.01-RC1` using the exact v1.05.00 Stable portable package as its parent.

Fixed:
- LocalEngine child-process cleanup after failed direct startup.
- Wait for the killed process to exit, dispose the `Process` object and clear the stored process reference.
- Clear disposed runspace/process references during normal owned-engine shutdown and reset ownership/mode state.

Protected and unchanged:
- `ChessPublisher.exe` launcher bytes
- `ChessPublisher-LocalEngine.ps1` service logic
- Gacrux 1.9.57 / Swiss Dutch pairing
- TRF pairing and history paths
- BBP independent checker
- Tie-Break core
- Chess-Results core

UI/client files received version-token changes only. Unrelated HTML drift present in the RC package was intentionally excluded from Stable.

## Stable distribution artifacts

- Installer: `chess-publisher-v1.05.01-2026-09-03.exe`
  - SHA-256: `2b6db9069f6a2ba0dcda37c7d855b893ed2fe01ea61323878a22437a73b6663d`
- Portable ZIP: `chess-publisher-v1.05.01-2026-09-03.zip`
  - SHA-256: `34d89888d52eca1e4dc3b114701ce5ca4a417f84f186dff66467f875605ea44e`
- Checksums: `chess-publisher-v1.05.01-2026-09-03-SHA256.txt`
  - SHA-256: `4915c8dc1df21ab7d1f70350af18f4bf125f3cca87722f169cb32f561622207e`
- Gacrux 1.9.57 SHA-256: `6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb`

Official release: <https://github.com/kbilyal/ChessPublisher/releases/tag/v1.05.01>

## Main features

- Tournament setup, registration, pairings, result entry and standings
- FIDE rating-list workflows and TRF16/TRF26 export
- Swiss Dutch pairing through Gacrux 1.9.57
- Chess-Results publishing/admin integration
- Chess-Publisher Online Tournament Hub beta
- Smart Calendar and tournament schedule workflow
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

Do not commit credentials, tournament backups, signing keys or production shared secrets.

## Release discipline

Stable desktop releases are promoted from an explicitly validated candidate. Updating the repository `VERSION` metadata does not automatically rebuild or overwrite an existing Stable release. Existing stable assets are treated as immutable; a functional change requires a new version.

The v1.05.01 publication gate verified:
- the exact v1.05.00 Stable parent ZIP SHA-256;
- exact approved RC1 WebView host bytes after Stable version-label promotion;
- protected-core hashes before and after the point-fix;
- version-only changes for the UI/client files outside the approved host fix;
- successful Windows Inno Setup installer and portable ZIP production.

Full release record: `RELEASE-v1.05.01.md`.

## Network behavior and privacy

Chess-Publisher has no project analytics or tracking. Network features for FIDE, Chess-Results, Tournament Hub and Telegram are used when the operator invokes/configures those features. See `PRIVACY.md`.

## Code signing policy

The project is being prepared for the SignPath Foundation OSS signing program. Until signing is activated, verify downloaded artifacts against the published SHA-256 checksums.

- Committer / reviewer: [Kyamran Bilyal (`kbilyal`)](https://github.com/kbilyal)
- Signing approver: [Kyamran Bilyal (`kbilyal`)](https://github.com/kbilyal)
- Builds intended for signing are produced on GitHub-hosted Windows runners from public, credential-free source.
- Third-party upstream binaries are not signed as Chess-Publisher-owned code.

Full policy: `CODE_SIGNING.md`.

## License

Chess-Publisher-owned source is released under the MIT License. Third-party components retain their own licenses; see `THIRD_PARTY_NOTICES.md`.
