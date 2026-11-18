# Chess-Publisher v1.06.00

The new stable Windows release brings tournament registration, pairings, results, standings and online publishing into one workspace.

## Download

- **Windows installer:** `Chess-Publisher-v1.06.00-2026-11-18.exe`
- **Portable ZIP:** `Chess-Publisher-v1.06.00-2026-11-18.zip`
- Verify downloads with `Chess-Publisher-v1.06.00-2026-11-18-SHA256.txt`.

Requires Windows 10/11 x64 and Microsoft Edge WebView2. Back up tournament files before upgrading.

## Highlights

- Gacrux 1.11.65 pairing engine, verified runtime manifest and sealed recovery archive.
- Improved FIDE and custom rating-list management, registration and late-entry workflow.
- Refined player-list, pairing and report controls from the latest r15 working source.
- Cloud Workspace synchronization, Tournament Hub and Chess-Results publishing.
- English user manual included in both packages.

The installer includes the complete desktop runtime and pairing engine. FIDE rating lists and optional checker components can be downloaded through the application's existing workflows.

## Validation

- Gacrux runtime, checksums and real Dutch pairing: 25/25 passed.
- Static audit, inline JavaScript syntax and current protected runtime hashes: passed.
- Packaged LocalEngine smoke test: healthy, service V140, Gacrux 1.11.65.
- Directional synchronization, schema-7, metadata, recovery and preflight regression checks passed.

The historical beta.96 freeze manifest is retained for provenance. Its two PowerShell hashes predate the r13 engine upgrade; `STABLE-RUNTIME-MANIFEST.json` records the promoted runtime. LocalEngine remains byte-identical to r15, and WebView changes are release branding only.

Chess-Publisher's stable release status does not imply FIDE certification of the application.
