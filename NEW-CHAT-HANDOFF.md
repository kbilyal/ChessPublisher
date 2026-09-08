# New Chat Handoff — Chess-Publisher

Paste the block below as the first message in a new ChatGPT chat.

```text
Продължаваме Chess-Publisher FIDE/TEC development.

REPOSITORY
- GitHub: https://github.com/kbilyal/ChessPublisher
- Development branch: development/fide-tec-beta54
- Read first: DEVELOPMENT-STATE.md and NEW-CHAT-HANDOFF.md from that branch.
- Do NOT use main as the current development baseline. main is older stable history.

CURRENT CHECKPOINT
- Latest verified development checkpoint: Chess-Publisher v1.06.00-beta.54 — Rating List Freshness Verification.
- Date: 2026-09-08.
- Parent: beta.53 Date-Effective Rating Consistency.
- beta.54 dedicated regression: 23/23 PASS.
- Static audit: PASS.
- Cumulative suites: 38 PASS / 3 known historical exceptions / 1 browser-runner skip.
- Unexpected functional failures: 0.
- Protected core: 70/70 byte-identical to beta.53.

GOOGLE DRIVE SOURCES
- Latest beta.54 release folder:
  https://drive.google.com/drive/folders/1izbJUWPqKCYUGAqUrU0kKuQ5sR2QNeMo
- Living master VCL matrix — update this exact Drive file IN PLACE after every accepted beta:
  ID: 11P-6T64_fmSHY3WXQSyqAVlVyHxHvCVc
  https://docs.google.com/spreadsheets/d/11P-6T64_fmSHY3WXQSyqAVlVyHxHvCVc/edit
- beta.54 VCL snapshot:
  https://docs.google.com/spreadsheets/d/1kh6feySZn4a31AdWb83F5x-U-tSxDmxF/edit
- beta.54 regression report:
  https://drive.google.com/file/d/1i69GV5_g7Pi1W9uhZPX6VO8GkHkX8mD-/view
- beta.54 changelog:
  https://drive.google.com/file/d/1KE4HvwWJeqDObFR7SK8U322zvBRHF8md/view
- beta.54 English manual:
  https://drive.google.com/file/d/1VV517sEZxshJhZubpT-XjWWLGr-6GFju/view

DO NOT RESTART FROM beta.51. Development already continued:
- beta.51 — Tournament Rating Methods / HBFN + OTHER / TRF26 Record 172 + NRS.
- beta.52 — Rating Provenance.
- beta.53 — Date-Effective Rating Consistency.
- beta.54 — Rating List Freshness Verification for user-requested consistency checks.

NEXT WORK — START IMMEDIATELY, NO CLARIFYING QUESTION
1. Q135 — keep maintained FIDE rating lists within the required freshness window while Chess-Publisher is running.
2. After Q135 passes full release gate, automatically start Q139 — automatic first-opportunity rating consistency check.
3. Then re-read the current master VCL Blockers sheet and continue automatically with the next actionable P0/P1 item.
4. Skip TEC-dependent conditional PTC/RTG implementation until TEC confirms whether the exact external-engine exemption applies.

PROTECTED CORE — DO NOT MODIFY CASUALLY
- Gacrux 1.9.57 / engine tree.
- ChessPublisher.exe.
- ChessPublisher-LocalEngine.ps1.
- Swiss Dutch pairing core/path.
- TRF pairing path and fixed-width core behavior.
- BBP independent checker core.
- protected Tie-Break calculation/checker core.
- Chess-Results protocol/core.
- DGT core.
- HubAdapter.js, WebViewAdapter.js, CloudWorkspaceAdapter.js, cloud-workspace-api.js unless a task explicitly requires an adapter change and the protected hash gate is intentionally revised.

REGRESSION RULES
- Every new beta must be self-describing and regression-safe.
- Preserve all fixed behavior from earlier betas.
- TRF16/TRF26 must always receive explicit regression attention.
- Run dedicated tests, static audit, cumulative standalone tests and protected-core hash comparison.
- Historical exceptions currently allowed only:
  1) beta.20 exact historical branding assertion;
  2) beta.30 exact historical branding assertion;
  3) old CLOUD-WORKSPACE-BETA4 superseded contract;
  plus beta.29 browser-runner scenario is a skip outside its browser runner.
- Any NEW unexpected functional failure blocks the release.

FIDE/TEC DEVELOPMENT ALREADY CLOSED
- FIDE Mode / warning levels / PIBE / TRF ### framework.
- Pairing integrity / Manual Pairing verification / TRF import verification.
- sensitive configuration and historical PAB revalidation.
- Manual Pairing absolute criteria and prohibited pairings.
- FIDE Baku Acceleration via existing Gacrux.
- Round Robin public-draw TPN and withdrawal <50% rule.
- mandatory Round Robin tie-break catalogue.
- tie-break-change Level-4 safety and audit trail.
- Adjourned Games / ITDX unknown results.
- unusual valid OTB results ½-0, 0-½, 0-0.
- complete 39-item mandatory Swiss tie-break catalogue / TRF212.
- English user manual.
- HPB eligibility / full-point-bye warning and audit.
- repeat HPB Level-3 warning.
- TPN Exchange / regeneration / late-entry verification.
- Tournament Rating methods / rating provenance / date-effective list selection / user-requested freshness verification.

UI RULE
- Keep normal user screens concise and professional.
- Remove internal engineering, debug, experimental, pending, TEC-development commentary that makes the product look unfinished.
- Do NOT remove required FIDE warnings, validation/errors, compliance controls or genuinely useful operational instructions.

WORKFLOW RULE
After finishing each task, DO NOT wait for confirmation. Continue automatically:
implement -> dedicated tests -> static -> cumulative -> protected-core hashes -> VCL -> docs -> package/SHA256 -> Drive upload -> master matrix update -> next actionable VCL blocker.

FINAL TARGET
Do not call a beta Final/Stable. When all applicable VCL items are PASS/N/A/TEC-confirmed, perform a full consolidation audit and Windows-native acceptance gate, then create a TAPC/RC candidate.
```
