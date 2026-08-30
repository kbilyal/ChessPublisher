# ChessPublisher v1.04.01 — stable distribution

Date: 2026-08-30

## Status

**Stable:** FINAL-approved RC6 candidate promoted after the complete Runtime & Release Gate returned **36 PASS / 0 FAIL**.

The stable ZIP is byte-identical to `chess-publisher-v1.04.01-2026-08-30-RC6.zip` and is published without the RC suffix as:

- `chess-publisher-v1.04.01-2026-08-30.zip`
- SHA-256: `fbbbffdea456b895ba793e544e688021c1d1b73a024c5f440692274699b53872`

Stable installer:

- `chess-publisher-v1.04.01-2026-08-30.exe`
- SHA-256: `5642e611a13b75022578fb245ea325a75e557e14aa36b824c6cb6925ca00e24b`

The installer embeds the exact stable ZIP payload once. Both ZIP and installer deterministic rebuild checks passed byte-for-byte.

## Final release gate

The FINAL Runtime & Release Gate passed **36/36 checks**, including:

- exact candidate hashes
- Gacrux 1.9.57 exact SHA-256
- WebView ↔ LocalEngine `serviceVersion` handshake (`V138 / V138`)
- PowerShell parser checks
- LocalEngine `/health`
- STA in-process runspace startup/shutdown
- `System.Diagnostics.Process` fallback startup/shutdown
- JavaScript syntax suite 47/47
- persistence/autosave and forced-failure handling
- rapid result correction/race coverage
- tournament switch, rollback, rename/autosave and restore/reload guards
- Starting List TXT, Editable Tournament TXT and Full Tournament TXT
- FIDE TRF16/TRF26 paths
- Chess-Results TNR lifecycle evidence and XLSX round import
- strict date/calendar validation
- registration/pairing critical persistence
- stale modal/context guards
- FIDE database atomic/sanity guards
- full tournament import rollback/validation
- protected-function hash suite 11/11
- ZIP CRC/readback 85/85
- deterministic ZIP rebuild
- installer embedded-payload byte identity
- deterministic installer rebuild
- PE AMD64 / PE32+
- ImageBase / section / entry-point checks
- valid RT_MANIFEST XML
- execution level `asInvoker`
- final EXE/ZIP/SHA256 consistency

Final gate result:

`FINAL RESULT: PASS - RELEASE APPROVED`

## RC6 point-fix scope

RC6 incorporates the accumulated point-fix set P-07–P-27 while preserving protected pairing and checker components. The final regression evidence includes JavaScript syntax 47/47, targeted fix assertions 42/42, dynamic persistence/FIDE/autosave tests 4/4, and protected core functions 11/11 byte-identical to the protected baseline.

## Protected components

Unchanged:

- Gacrux 1.9.57
- Swiss Dutch pairing logic
- pairing-engine TRF path
- BBP independent checker core
- Tie-Break Checker core
- Chess-Results XML/network protocol core, except only where separately proven by reproducible defects

Gacrux 1.9.57 SHA-256:

`6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb`

## Runtime continuity

Validated runtime values:

- WebView host SHA-256: `b0e941951102a36ad929064dd157af6bd942a4a598fe854919223f1e2bcef571`
- LocalEngine SHA-256: `0fe60d712d9a470d0487149bd72b25d8597bbcc56b18361db6156a41be7b5602`
- WebView ↔ LocalEngine handshake: `V138 / V138`
- STA in-process LocalEngine startup/shutdown: PASS
- `System.Diagnostics.Process` fallback startup/shutdown: PASS
- LocalEngine `/health`: PASS

## Public-source safety

The public repository remains credential-free. Production service-shared credentials, AES material, signing secrets, tournament backups and other operational secrets are not committed to the public source tree. Stable binary distribution is tracked separately from the credential-free public source baseline.
