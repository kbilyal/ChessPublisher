# ChessPublisher v1.04.01 — validated candidate status

Date: 2026-08-30

## Status

The v1.04.01 candidate passed the real Windows runtime gate on Windows PowerShell 5.1.

Validated runtime checks:

- Candidate HTML SHA-256: `67ca7ab370247906449f716e53992edf9ddbc1cec734a11bb962f312ef1070bf`
- WebView host SHA-256: `b0e941951102a36ad929064dd157af6bd942a4a598fe854919223f1e2bcef571`
- LocalEngine SHA-256: `0fe60d712d9a470d0487149bd72b25d8597bbcc56b18361db6156a41be7b5602`
- Gacrux 1.9.57 SHA-256: `6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb`
- WebView ↔ LocalEngine service handshake: `V138 / V138` PASS
- PowerShell parser for WebView host: PASS, 0 errors
- PowerShell parser for LocalEngine: PASS, 0 errors
- Production-equivalent STA in-process runspace startup + `/health` + shutdown: PASS
- Production-equivalent `System.Diagnostics.Process` fallback startup + `/health` + shutdown: PASS

## Changes in v1.04.01

### Swiss-Manager interoperability

Two separate exports are provided:

1. **TRF Starting List (.TXT)** — tournament setup and participants only.
2. **Full Tournament to Swiss-Manager (.TXT)** — tournament setup, participants, generated rounds, entered results, legitimate forfeits and byes. This export is intended to allow an arbiter to open the event in Swiss-Manager and continue/edit the tournament there.

### Persistence correction

A completed Swiss round can be corrected after it was already complete. Previously, with Autosave disabled, a corrected result could remain only in the active UI/browser state while `tournament.json` and `Latest.trf` retained the earlier result (including earlier forfeit codes).

v1.04.01 adds serialized critical persistence with a revision guard and export checkpointing. Critical exports wait for a stable persisted revision before generating their output. This prevents an older asynchronous write from overwriting a later correction.

### Round Complete dialog

The informational dialog is shortened to:

`All results for Round N are entered.`

## Protected components

The following are intentionally unchanged by this fix:

- Gacrux 1.9.57
- Swiss Dutch pairing logic
- pairing-engine TRF path
- BBP independent checker core
- Tie-Break Checker core
- Chess-Results core

## Public-source safety

The public repository must remain free of service-shared credentials. Production integration material containing private/shared credentials is not to be committed. GitHub release publication therefore remains manual until the credential-injection/reproducible-build path can produce the complete production runtime from credential-free public source.

This file records validation status; it is not itself a GitHub Release asset.
