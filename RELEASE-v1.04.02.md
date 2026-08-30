# ChessPublisher v1.04.02 — stable distribution

Date: 2026-08-30

## Status

**Stable:** FINAL-approved v1.04.02 RC1 promoted after the complete Runtime & Release Gate returned **36 PASS / 0 FAIL**.

v1.04.02 is a version-only promotion of the fully audited v1.04.01 RC6 functional codebase. No functional pairing, TRF, BBP, Tie-Break or Chess-Results XML/network-core changes were introduced by this promotion.

## Stable artifacts

- `chess-publisher-v1.04.02-2026-08-30.exe`
  - SHA-256: `5af57ede202f1e65c8fc2e2356af5c6961bd6902006269a7f8b64ffb08accacf`
- `chess-publisher-v1.04.02-2026-08-30.zip`
  - SHA-256: `316eadb9c2f12ea2021ffbc3852c81614140daf55015e00992cd59974336fa20`
- Gacrux 1.9.57
  - SHA-256: `6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb`

The stable EXE and ZIP are byte-identical copies of the exact RC1 candidate that passed the Windows FINAL gate.

## Version promotion validation

- `VERSION.txt`: `1.04.02`
- `WEBVIEW-VERSION.txt`: `1.04.02`
- application HTML/version branding: `v1.04.02`
- installer version metadata: `v1.04.02`
- WebView ↔ LocalEngine serviceVersion: `V138 / V138`
- historical v1.04.01 source comments intentionally preserved

## FINAL Runtime & Release Gate

All 36 mandatory checks passed:

1. Exact candidate hashes
2. Gacrux 1.9.57 exact SHA256
3. WebView ↔ LocalEngine serviceVersion exact handshake
4. PowerShell parser
5. LocalEngine `/health`
6. STA in-process runspace startup/shutdown
7. `System.Diagnostics.Process` fallback startup/shutdown
8. JavaScript 47/47 syntax
9. Persistence Autosave ON/OFF
10. Forced managed-file persistence failure handling
11. Rapid result corrections/race tests
12. Tournament switch persistence
13. Don't Save rollback
14. Rename/autosave race
15. Backup restore/reload race
16. Starting List TXT
17. Editable Tournament TXT
18. Full Tournament TXT
19. FIDE TRF16/TRF26
20. Chess-Results TNR lifecycle evidence
21. Chess-Results XLSX round import
22. Strict date/calendar validation
23. Registration/pairing critical persistence
24. Stale modal/context guards
25. FIDE database atomic/sanity guards
26. Full tournament import rollback/validation
27. Protected-function hashes and live v1.04.02 metadata
28. ZIP CRC/readback — 85/85
29. Deterministic ZIP rebuild
30. Installer embedded payload byte-identical to release ZIP
31. Deterministic EXE rebuild
32. PE AMD64 / PE32+
33. ImageBase / sections / entry point
34. Valid RT_MANIFEST XML
35. Execution level `asInvoker`
36. Final EXE/ZIP/SHA256 consistency

Final result:

`TOTAL: 36 PASS / 0 FAIL`

`FINAL RESULT: PASS - RELEASE APPROVED`

## Protected components

The v1.04.02 promotion does not modify:

- Gacrux 1.9.57
- Swiss Dutch pairing logic
- TRF pairing path
- BBP independent checker core
- Tie-Break Checker core
- Chess-Results XML/network protocol core

## Public-source security

The public repository remains credential-free. Production LocalEngine shared AES key/IV and other production secrets must not be committed to GitHub.
