# Chess-Publisher Windows FIDE Beta Checkpoint — v1.06.00-beta.70

Date: 2026-09-08
Status: ACCEPTED BETA CHECKPOINT (not Final/Stable)

## Exact accepted package

- Version: `v1.06.00-beta.70`
- Title: `Long Event Rating History`
- ZIP: `Chess-Publisher-v1.06.00-beta.70-Long-Event-Rating-History-FULL-PORTABLE-2026-09-08.zip`
- SHA256: `69fc07ac27ca5315f7a58c8adf63d358cd5e20efd0413b5b023ed779953a1d58`
- Google Drive release folder: `https://drive.google.com/drive/folders/1saZQJHWSLerBxuv-YZP1-sEXUUwG_wzC`
- Living FIDE/TEC VCL Drive ID: `11P-6T64_fmSHY3WXQSyqAVlVyHxHvCVc`

## Final beta.70 gates

- Dedicated: 37/37 PASS
- Static audit: PASS
- Cumulative: 55 PASS + 3 known historical exceptions + 1 browser-runner skip
- Unexpected failures: 0
- Protected core: 70/70 byte-identical to beta.69
- Engine hardening from beta.68 retained
- Gacrux 1.9.57 remains protected
- Portable ZIP internal max path: 92 characters

## FIDE/TEC VCL state

- PASS: 144
- PARTIAL: 22
- FAIL: 3
- CONDITIONAL: 21
- NEEDS TEST: 4
- NEEDS TEC: 1
- N/A: 30

Current immediate P1 blockers: Q214, Q215, Q216.

## beta.70 completed scope

- Q210 PASS — long-event detection / flag
- Q211 PASS — C.07:10 guidance for rating/performance tie-breaks
- Q212 PASS — multiple official ratings per player
- Q213 PASS — exact round validity ranges for ratings
- `ratingForRound()` data resolver foundation
- Q214–Q216 intentionally remain open until rating-based tie-break calculations are proven to use the correct historical/default/user-selected rating policy.

## Protected components — DO NOT MODIFY without explicit technical necessity

- Gacrux 1.9.57 / engine tree
- Swiss Dutch pairing logic/path
- TRF16 core
- TRF26 core / fixed-width writer
- BBP checker / bbpPairings core
- Tie-Break core/checker
- Chess-Results protocol/core
- DGT core
- pairingNumber / player IDs / starting-number semantics

## Windows Desktop requirements carried forward

The following are mandatory for future Windows FIDE beta checkpoints:

1. Desktop ↔ Web Cloud synchronization redesign must use explicit Pull and Push directions, stable `internalId` / `cloudTournamentId`, three-way conflict handling, and local-only autosave.
2. Pairings → Result Desk must remain fixed; only the board table scrolls; Generate Pairings remains visible; dev16 Print/PDF and focus-darkening fixes remain preserved.
3. Windows Fluidity v2 work must preserve all primary tabs including Chess-Results and DGT, use safe clean-navigation fast path, discard stale VIEW-only renders only, and keep all protected cores unchanged.
4. Every completed beta must create a checkpoint containing exact parent, version, commit SHA, package SHA256, regression gate results, VCL snapshot/state, protected-core verification, and next blocker.
5. No beta checkpoint is a Final/Stable release.

## Next work

Continue from this exact checkpoint with Q214–Q216 historical-rating-aware tie-break policy, then remaining actionable TEC gaps. Do not use old GitHub root runtime as the source of truth; accepted portable checkpoint packages remain authoritative until the dedicated Windows FIDE beta repository is populated.
