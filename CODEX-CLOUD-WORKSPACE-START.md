# Codex Start Prompt — Chess-Publisher Cloud Workspace

Copy the prompt below into Codex after opening branch `cloud-workspace-v1.06`.

---

You are continuing development of **Chess-Publisher** on the isolated branch `cloud-workspace-v1.06`.

Before doing anything else, read `AGENTS.md` completely and treat it as mandatory project policy.

## Exact baseline

- Stable parent: `v1.05.01`
- Stable parent portable SHA256: `34d89888d52eca1e4dc3b114701ce5ca4a417f84f186dff66467f875605ea44e`
- Current beta line: `v1.06.x`
- Current candidate: `v1.06.00-beta.1 — Cloud Workspace Phase 1`
- Current path-safe package name: `CP-v1.06.00-beta.1-Cloud-PathSafe.zip`
- `v1.05.01` must remain Stable and untouched.

## Goal

Work **only** on Private Cloud Workspace / Cloud Sync.

Chess-Publisher must remain local-first. Cloud is a private mirror and continuation layer. A network/API/cloud failure must never block or invalidate a successful local save.

The same Organizer Token should identify the organizer's private workspace. Private cloud storage and the public Tournament Hub must remain separate.

## Already implemented — preserve all of it

- private Organizer Workspace using existing Organizer Token;
- token access through existing DPAPI/native secret bridge;
- stable cloud identity per tournament;
- automatic private cloud backup after completed local persistence checkpoint;
- manual Sync Now;
- Back Up All Local Tournaments;
- My Private Cloud Tournaments;
- open/download a tournament on another PC using the same token;
- immutable cloud revisions;
- non-destructive restore;
- expected-revision optimistic concurrency;
- HTTP 409 stale-write protection;
- offline-safe operation;
- B2 private organizer-scoped snapshots;
- additive D1 cloud tables;
- cloud snapshot scrubbing of device-global Telegram credentials;
- no automatic public Hub publication.

The Cloud Workspace backend is Hub API beta.8. Production health has shown D1=true, B2=true, organizerAuth=true, desktopCors=true, and the new `/api/v1/cloud/workspace` route is active because an unauthenticated request returns the expected 401 rather than 404.

## Critical protected areas

Do not modify Gacrux 1.9.57, Swiss Dutch pairing, TRF pairing/history/export core, BBP checker, Tie-Break core, Chess-Results core, `ChessPublisher-LocalEngine.ps1` service logic, `webview/WebViewAdapter.js`, `hub/client/hub-snapshot.js`, or launcher behavior.

Do not refactor protected code merely to make Cloud Sync easier.

## Known packaging defect already diagnosed

A long extracted beta path caused Tie-Break Checker preparation to fail because the staging path exceeded legacy Windows path limits. This was a **packaging/path-depth issue**, not a Tie-Break or Gacrux defect.

Keep packaging path-safe. Do not alter Gacrux/Tie-Break core to solve path length.

## Your first task

Do **not** begin Phase 2 and do **not** redesign the system.

Audit Phase 1 for real-device acceptance readiness and make only fixes that are necessary for the following sequence to pass safely:

1. Device A opens an existing normal tournament.
2. Local save completes normally.
3. Sync Now uploads the private snapshot.
4. My Private Cloud Tournaments shows the event and current revision.
5. A second saved change increments the revision without duplicating the cloud tournament.
6. Device B authenticates with the same Organizer Token.
7. Device B downloads/opens the same tournament as a normal local tournament.
8. All players, rounds, results, standings, schedule, regulations and tournament history needed for continued local operation are preserved.
9. Device A or B can work offline; local save still succeeds.
10. After reconnect, sync succeeds.
11. A stale device attempts to sync an older expected revision and receives HTTP 409.
12. The stale write does not overwrite the newer cloud revision.
13. Restoring an older cloud revision creates a new current revision instead of deleting history.
14. Private backup never makes the event public in Tournament Hub.

## Working method

First inspect and report:

- the Cloud Workspace client/module boundaries;
- exactly where cloud sync hooks into successful local persistence;
- how tournament cloud identity is generated and persisted;
- how expected revision is stored and updated;
- how a cloud download is converted into a safe local tournament;
- how token/organizer ownership is enforced server-side;
- how cloud snapshots are sanitized;
- any race condition, duplicate-ID risk, destructive restore risk, or accidental public-publish coupling you find.

Then create a short test plan before editing.

If you find a defect, reproduce it or demonstrate it from the code path before changing production code. Make the smallest possible fix.

After each fix run targeted tests, then the regression gate required by `AGENTS.md`.

## Required output from this Codex task

At the end provide:

1. files changed;
2. exact reason for each change;
3. tests run and results;
4. protected-core hash result;
5. remaining risks;
6. whether the candidate is ready for the Device A → Device B acceptance test;
7. if a new beta package is produced, its exact filename and SHA256.

Do not create a Stable release. Do not merge to `main`. Do not modify unrelated functionality.

---
