# Chess-Publisher v1.06.00-beta.98-r12 — Pre-FIDE / TEC Review Candidate

Release date: 2026-09-15

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

## Public GitHub download

The GitHub prerelease contains the verified protected Windows launcher and its checksum:

- `ChessPublisher-v1.06.00-beta.98-r12.exe`
- `SHA256SUMS.txt`

Launcher SHA-256: `1e5c93b987e156a81a3b1ca0bb6dc6fe84f97f38477c161b355a75b2c86458c3`

The launcher is protected-core content and is byte-identical to the launcher already carried by the public Stable v1.05.01 portable artifact. The release workflow re-materializes that immutable public copy and verifies the exact r12 SHA-256 before publication; it is not rebuilt or modified.

## Full portable mirror

The exact full r12 portable package is retained in the official Google Drive release folder:

`ChessPublisher Releases/Pre-FIDE v1.06.00-beta.98-r12`

Portable SHA-256: `e33ed93e1b81af83fa1d1b17fcc4dfaeec2daec73b89aa9d5ba6ebee3310ce5b`

## Status / wording

**Pre-FIDE / TEC Review Candidate** means the build is being presented as a candidate aligned with the project's FIDE/TEC review work. It does **not** claim that this version is FIDE-approved or FIDE-certified.
