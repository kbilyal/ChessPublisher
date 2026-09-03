# Chess-Publisher v1.05.01 Stable

Released: 2026-09-03

## Scope

Maintenance point release promoted from `v1.05.01-RC1` using the exact `v1.05.00` Stable portable package as the parent.

## Fixed

- Correct cleanup of the LocalEngine child process after a failed direct startup.
- Wait for the killed process to exit, dispose the `Process` object, and clear the stored process reference.
- Clear disposed runspace/process references during normal owned-engine shutdown and reset ownership/mode state.

## Deliberately unchanged

- `ChessPublisher.exe` launcher bytes
- `ChessPublisher-LocalEngine.ps1` service logic
- Gacrux 1.9.57 / Swiss Dutch pairing
- TRF pairing and history paths
- BBP checker
- Tie-Break core
- Chess-Results core

UI/client files received version-token changes only. Unrelated HTML drift present in the RC package was intentionally excluded from Stable.

## Official artifacts

- Installer: `chess-publisher-v1.05.01-2026-09-03.exe`
  - SHA256: `2b6db9069f6a2ba0dcda37c7d855b893ed2fe01ea61323878a22437a73b6663d`
- Portable ZIP: `chess-publisher-v1.05.01-2026-09-03.zip`
  - SHA256: `34d89888d52eca1e4dc3b114701ce5ca4a417f84f186dff66467f875605ea44e`
- Checksums: `chess-publisher-v1.05.01-2026-09-03-SHA256.txt`
  - SHA256: `4915c8dc1df21ab7d1f70350af18f4bf125f3cca87722f169cb32f561622207e`

Official release: https://github.com/kbilyal/ChessPublisher/releases/tag/v1.05.01
