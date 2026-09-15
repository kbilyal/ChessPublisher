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

## Downloads

The GitHub prerelease contains:

- `ChessPublisher-v1.06.00-beta.98-r12.exe`
- `Chess-Publisher-v1.06.00-beta.98-r12-FULL-PORTABLE.zip`
- `SHA256SUMS.txt`

Google Drive mirrors are stored in the official `ChessPublisher Releases/Pre-FIDE v1.06.00-beta.98-r12` folder.

## Status / wording

**Pre-FIDE / TEC Review Candidate** means the build is being presented as a candidate aligned with the project's FIDE/TEC review work. It does **not** claim that this version is FIDE-approved or FIDE-certified.
