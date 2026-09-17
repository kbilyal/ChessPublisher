# Chess-Publisher v1.06.00-beta.98-r12 — Pre-FIDE / TEC Review Candidate

Release date: 2026-09-15  
Self-contained Windows installer published: 2026-09-17

This is the public **Pre-FIDE** candidate of the current Windows line. It is published in parallel with the Stable channel and does **not** replace Stable v1.05.01.

## Release gate

- Full packaged JS corpus: **111 scenarios total**
- **108 PASS**
- **2 approved historical exceptions**
- **1 designated browser-only skip**
- **0 unexpected failures**
- r12 Late Entry double-click regression: **23/23 PASS**
- Static audit: **PASS**
- Protected-core gate: **70/70 byte-identical**

## r12 point change

Late Entry player addition can be completed directly by double-clicking a FIDE search result. Existing player lifecycle and pairing semantics remain authoritative.

The r12 delta explicitly introduces **no pairing, TRF, BBP, tie-break, Chess-Results, SYNC or rating-calculation core changes**.

## Windows installer

Use the self-contained Windows Setup executable:

- `Chess-Publisher-v1.06.00-beta.98-r12-Setup.exe`
- Size: **34,183,168 bytes**
- SHA-256: `37a8e5a88905849edb6ee9b83b1d7ca8d82c2ca170c9d8fc7617975aecf9e502`
- Checksum file: `SHA256SUMS-INSTALLER.txt`

The Setup executable contains the complete r12 runtime package. It is not the former standalone launcher. The installed application therefore includes the required companion files such as `ChessPublisher-WebView.ps1`, `ChessPublisher-LocalEngine.ps1`, `ChessPublisher.html`, the packaged engines, webview modules and other runtime resources.

The embedded authoritative portable payload is **32,037,199 bytes** with SHA-256:

`e33ed93e1b81af83fa1d1b17fcc4dfaeec2daec73b89aa9d5ba6ebee3310ce5b`

The former 1.8 MB launcher-only download has been retired from this prerelease because it is not a standalone installation package.

## Full portable mirror

The exact full r12 portable package is retained in the official Google Drive release folder:

`ChessPublisher Releases/Pre-FIDE v1.06.00-beta.98-r12`

Portable SHA-256: `e33ed93e1b81af83fa1d1b17fcc4dfaeec2daec73b89aa9d5ba6ebee3310ce5b`

## Status / wording

**Pre-FIDE / TEC Review Candidate** means the build is being presented as a candidate aligned with the project's FIDE/TEC review work. It does **not** claim that this version is FIDE-approved or FIDE-certified.
