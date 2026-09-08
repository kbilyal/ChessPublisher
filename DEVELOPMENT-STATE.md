# Chess-Publisher FIDE / TEC Development State

## Current checkpoint

**Version:** `v1.06.00-beta.54 — Rating List Freshness Verification`  
**Date:** 2026-09-08  
**GitHub branch:** `development/fide-tec-beta54`  
**Stable branch:** `main` — DO NOT promote or overwrite from this development line yet.

## Source of truth

The current FIDE/TEC development line is stored as versioned release checkpoints in Google Drive because executable portable ZIP files are frequently flagged by Google Drive and cannot always be re-downloaded through automation. GitHub is used here as the durable development handoff/state mirror.

Latest Drive release folder:
`https://drive.google.com/drive/folders/1izbJUWPqKCYUGAqUrU0kKuQ5sR2QNeMo`

Living master VCL matrix (update this file in-place after every accepted beta):
`https://docs.google.com/spreadsheets/d/11P-6T64_fmSHY3WXQSyqAVlVyHxHvCVc/edit`

beta.54 VCL snapshot:
`https://docs.google.com/spreadsheets/d/1kh6feySZn4a31AdWb83F5x-U-tSxDmxF/edit`

beta.54 regression report:
`https://drive.google.com/file/d/1i69GV5_g7Pi1W9uhZPX6VO8GkHkX8mD-/view`

beta.54 changelog:
`https://drive.google.com/file/d/1KE4HvwWJeqDObFR7SK8U322zvBRHF8md/view`

beta.54 English manual:
`https://drive.google.com/file/d/1VV517sEZxshJhZubpT-XjWWLGr-6GFju/view`

## beta.54 status

- VCL **Q141 PASS** — a user-requested rating consistency check verifies the maintained/effective FIDE rating list before comparison.
- Dedicated beta.54 regression: **23/23 PASS**.
- Static audit: **PASS**.
- Cumulative standalone suites: **38 PASS / 3 known historical exceptions / 1 browser-runner skip**.
- Unexpected functional beta.54 failures: **0**.
- Protected core: **70/70 byte-identical to beta.53**.

### Known historical exceptions

These are not current product regressions:
1. `BETA20-REGISTRATION-WORKFLOW-RULES-REGRESSION.js` — exact historical branding assertion.
2. `BETA30-ONLINE-HUB-RELIABILITY-REGRESSION.js` — exact beta.30 branding assertion.
3. `CLOUD-WORKSPACE-BETA4-REGRESSION.js` — superseded old Cloud API contract.

Browser-runner scenario file:
`BETA29-TRF-EXPORT-BROWSER-RUNTIME-SCENARIOS.js` — requires browser-runner context and is not counted as a standalone Node failure.

## Recent lineage

- beta.34 — FIDE Mode / Warning Levels 1–5 / PIBE log / TRF `###` framework.
- beta.35 — Pairing Integrity Verification, Manual Pairing final check, TRF import verification.
- beta.36 — sensitive configuration pairing revalidation.
- beta.37 — Manual Pairing absolute criteria + prohibited pairings.
- beta.38 — full historical PAB pairing revalidation.
- beta.39 — FIDE Baku Acceleration via existing Gacrux 1.9.57/TRF250.
- beta.40 — Round Robin public-draw TPN assignment.
- beta.41 — Round Robin withdrawal `<50%` standings rule.
- beta.42 — mandatory Round Robin tie-break catalogue.
- beta.43 — Level-4 mid-event tie-break change safety + audit trail.
- beta.44 — Adjourned Games / ITDX unknown-result workflow.
- beta.45 — unusual valid OTB results `½-0`, `0-½`, `0-0` with TRF26 Record 299 round-trip.
- beta.46 — complete 39-item mandatory Swiss tie-break catalogue / TRF212.
- beta.47 — version-matched English user manual and direct Manual access.
- beta.48 — HPB eligibility + full-point-bye Level-2 warning / TRF audit.
- beta.49 — Level-3 warning for second/subsequent HPB.
- beta.50 — TPN Exchange / regeneration warning / post-R4 late-entry TPN verification.
- beta.51 — Tournament Rating methods including HBFN/OTHER and TRF26 Record 172/NRS path.
- beta.52 — Rating Provenance.
- beta.53 — Date-Effective Rating Consistency.
- beta.54 — Rating List Freshness Verification for user-requested checks.

## Next actionable work

**Do not restart from beta.51. Continue from beta.54.**

Next actionable VCL sequence from the beta.54 regression report:
1. **Q135** — keep maintained FIDE lists within the required freshness window while Chess-Publisher is running.
2. **Q139** — automatic first-opportunity rating consistency check.
3. Re-read the current master VCL `Blockers` sheet and continue with the next actionable P0/P1 item, skipping TEC-dependent conditional PTC/RTG work until TEC confirms whether the external-engine exemption applies.

## Release discipline

For each task:
`implement -> dedicated regression -> static audit -> cumulative regression -> protected-core hash gate -> VCL update -> self-describing docs -> package/hash -> Drive upload -> master VCL in-place update -> immediately begin next actionable item`.

Do not call a development beta Final/Stable. The target is a consolidated TAPC/RC candidate only after all applicable VCL items are PASS/N/A/TEC-confirmed and the Windows-native release gate is clean.
