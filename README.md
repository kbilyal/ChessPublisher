# Chess-Publisher 1.06.00

Stable Windows release for chess organizers and arbiters.

[Download the Windows installer](https://github.com/kbilyal/ChessPublisher/releases/tag/v1.06.00) · [Website](https://chess-publisher.org/)

Manage registration, Swiss and Round Robin tournaments, pairings, results, standings, tournament schedules and public publishing in one desktop workspace.

- Gacrux 1.11.65 pairing engine with verified runtime files and recovery archive.
- FIDE rating-list management, custom rating lists, TRF16/TRF26 import and export.
- Tournament Hub, Cloud Workspace and Chess-Results integration.
- Improved late-entry registration, player lists and report controls.
- Optional DGT board workflows and an included English user manual.

## Install

Download the Setup executable from the release, run it, then launch Chess-Publisher. A portable ZIP and SHA-256 checksums are also available. Requires Windows 10/11 x64 and Microsoft Edge WebView2. Back up tournament files before upgrading.

## Build from source

Run `./scripts/build-release.ps1 -Version 1.06.00 -Date 2026-11-18` in PowerShell with Inno Setup 6 installed. The build compiles the launcher, verifies the pinned upstream engine, and packages the complete runtime.

This release is based on the local r15 candidate, including its current UI refinements. A stable release label does not constitute FIDE certification of Chess-Publisher.

Licensed under MIT. See THIRD_PARTY_NOTICES.md for bundled components.
