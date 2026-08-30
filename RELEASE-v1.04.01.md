# ChessPublisher v1.04.01 — stable distribution

Date: 2026-08-30

## Status

**Stable:** maintainer-approved RC2 baseline.

The stable ZIP is byte-identical to `chess-publisher-v1.04.01-2026-08-30-RC2.zip` and is published without the RC suffix as:

- `chess-publisher-v1.04.01-2026-08-30.zip`
- SHA-256: `fe2ac470a6f2cd351139e45043c7b5112006e0bbedadd3f5f932be84b3e84645`

Stable installer:

- `chess-publisher-v1.04.01-2026-08-30.exe`
- SHA-256: `6162042359a3d24647fd8f250571004dd8ffa4f18a2245cfb90bb7944d0ec0cb`

The installer embeds the exact stable ZIP once and was reproduced byte-for-byte in an independent second build.

## RC2 fixes included in stable

### Swiss-Manager interoperability

1. **TRF Starting List (.TXT)** — setup and participants only.
2. **Export Tournament in TXT** — transfers the generated tournament for continuation in Swiss-Manager, including players, generated rounds, entered results and legitimate forfeits/byes.

### Persistence/export correction

A completed Swiss round can be corrected after it was already complete. Serialized persistence and revision guards prevent an older asynchronous save from overwriting a later correction.

RC2 also fixes a self-triggered revision change in export preparation: automatic TRF backup validation no longer calls the normal UI-sync/save path while a stable export checkpoint is being captured. This prevents FIDE Rating TRF26 and Swiss-Manager tournament export from incorrectly reporting that tournament data changed when the operator made no change.

### Autosave UI

Routine successful `Saved`, `Saved to file` and `Saved backup` messages are hidden beside Autosave. Meaningful states such as save failures, read-only state and unsaved changes with Autosave disabled remain visible.

### Round Complete dialog

The informational dialog remains shortened to:

`All results for Round N are entered.`

## Stable packaging checks

- ZIP CRC/readback: PASS
- ZIP entries: 85/85
- deterministic ZIP rebuild: PASS
- deterministic installer rebuild: PASS
- installer exact embedded ZIP identity: PASS
- installer AMD64 / PE32+: PASS
- installer valid RT_MANIFEST XML: PASS
- installer execution level: `asInvoker`
- Gacrux 1.9.57 SHA-256 unchanged: `6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb`

## Runtime continuity

The unchanged runtime components retain the previously validated values:

- WebView host SHA-256: `b0e941951102a36ad929064dd157af6bd942a4a598fe854919223f1e2bcef571`
- LocalEngine SHA-256: `0fe60d712d9a470d0487149bd72b25d8597bbcc56b18361db6156a41be7b5602`
- WebView ↔ LocalEngine handshake: `V138 / V138`
- STA in-process LocalEngine startup/shutdown path: previously validated PASS
- `System.Diagnostics.Process` fallback startup/shutdown path: previously validated PASS

RC2 changed only the HTML/UI/export-persistence layer; WebView host, LocalEngine and Gacrux remained byte-identical.

## Protected components

Unchanged:

- Gacrux 1.9.57
- Swiss Dutch pairing logic
- pairing-engine TRF path
- BBP independent checker core
- Tie-Break Checker core
- Chess-Results core

## Public-source safety

Production service-shared credentials are not committed to the public repository. Stable binary distribution is tracked separately from the credential-free public source baseline.
