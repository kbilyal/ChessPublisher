# Chess-Publisher — Codex Development Rules

## Scope

This branch is the isolated **Chess-Publisher v1.06.x Cloud Workspace beta line**.

- Stable parent: **Chess-Publisher v1.05.01 Stable**
- Stable parent portable SHA256: `34d89888d52eca1e4dc3b114701ce5ca4a417f84f186dff66467f875605ea44e`
- Current beta target: **v1.06.00-beta.1 — Cloud Workspace Phase 1**
- Development goal: private organizer-scoped cloud storage and safe multi-device continuation while preserving the existing local-first tournament workflow.

Do not broaden the scope into unrelated UI cleanup, pairing changes, TRF changes, Chess-Results changes, or general refactors.

## Non-negotiable architecture

Chess-Publisher remains **local-first**.

1. A tournament must always save locally first.
2. Cloud Sync is an adapter/mirror above the existing local persistence path.
3. A cloud/network/API failure must never prevent a successful local save.
4. Private Cloud Workspace is not the public Tournament Hub.
5. Cloud backup must never automatically publish a tournament publicly.
6. No cloud-only mode in Phase 1.
7. No automatic conflict merge in Phase 1.
8. No true simultaneous live multi-device editing in Phase 1.

## Protected areas — DO NOT MODIFY

Unless a reproducible defect proves the fault is inside one of these exact components and the user explicitly approves the change, do not modify:

- Gacrux 1.9.57
- Swiss Dutch pairing logic
- TRF pairing/history paths
- TRF16/TRF26 export/import core
- BBP independent checker
- Tie-Break core
- Chess-Results core
- ChessPublisher-LocalEngine.ps1 service logic
- `webview/WebViewAdapter.js`
- `hub/client/hub-snapshot.js`
- launcher behavior / `ChessPublisher.exe`

The protected v1.05.01 hashes are:

- `ChessPublisher.exe` — `1e5c93b987e156a81a3b1ca0bb6dc6fe84f97f38477c161b355a75b2c86458c3`
- `ChessPublisher-LocalEngine.ps1` — `98e7014646619f9d1a12b88a64552c97411216c35fa817cb9657d68adb3fb8bb`
- `FIDE-Update.ps1` — `a1ecf7e1cc7fb2f3830c81da7a84fe7fb1ee434f156b9d1c0661e80e176509db`
- `webview/WebViewAdapter.js` — `d23af37ce1624fac96b46f62c85d7801ed733a66f7e03bab40f453ce4db67861`
- `hub/client/hub-snapshot.js` — `d980c520d74a71e66b3a3aa2a54e5ed626ea3618c53159145f9e48b445effac9`
- `engine/gacrux/pairingchecker.exe` — `6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb`

Every candidate must re-check these hashes. If any protected hash changes unexpectedly, stop and report the regression instead of continuing.

## Phase 1 features already implemented

Treat these as existing functionality that must not disappear:

- Private Organizer Workspace using the existing Organizer Token.
- Organizer Token obtained through the existing Windows DPAPI/native secret bridge; do not store it as plaintext in tournament files.
- Stable per-tournament cloud identity.
- Organizer-scoped private cloud tournament identity.
- Automatic private cloud backup after a completed local persistence checkpoint.
- Manual **Sync Now**.
- **Back Up All Local Tournaments**.
- **My Private Cloud Tournaments** list.
- Download/open a cloud tournament on another PC using the same Organizer Token.
- Immutable revision history.
- Non-destructive restore: restoring an old revision creates a new current revision.
- Optimistic conflict protection using expected revision and HTTP `409`.
- Offline-safe operation.
- Cloud snapshots are private and single-tournament.
- Device-global Telegram credentials are stripped from cloud snapshots.
- Private Cloud Workspace never triggers public Tournament Hub publishing.

Backend Phase 1 uses additive D1 tables:

- `cloud_tournaments`
- `cloud_revisions`
- `cloud_devices`

Private snapshot objects are stored under an organizer-scoped B2 path such as:

`private/organizers/<organizer-id>/...`

Never put B2 credentials or infrastructure secrets in the desktop client.

## Conflict model

Phase 1 uses optimistic concurrency.

A write must carry the local/base expected cloud revision. If the server has a newer current revision, the server must reject the write with HTTP `409` and return the current revision. A stale device must never silently overwrite newer cloud data.

Do not add last-write-wins behavior.

## Public Hub separation

The following are different operations:

- **Cloud Sync / Private Backup** — private organizer workspace.
- **Publish to Tournament Hub** — public tournament snapshot.

Never couple them implicitly.

## Windows packaging rule

A real beta test exposed a Windows path-length failure in the Tie-Break Checker staging path when the release ZIP and nested build directory names were too long.

Do not fix this by changing Gacrux or Tie-Break core.

Packaging must remain path-safe:

- use short release archive names where practical;
- avoid redundant nested build directories;
- do not introduce unnecessarily deep runtime paths;
- preserve protected binary bytes.

Current path-safe beta package name: `CP-v1.06.00-beta.1-Cloud-PathSafe.zip`.

## Source discipline

Before changing code:

1. Read this `AGENTS.md`.
2. Read `CODEX-CLOUD-WORKSPACE-START.md`.
3. Identify the exact files required for the requested change.
4. Inspect current behavior before editing.
5. Avoid opportunistic refactors.
6. Make the smallest compatible change.
7. Run targeted tests first, then regression tests.

Do not change release/stable version markers unless explicitly preparing a candidate.
Do not publish or overwrite a Stable GitHub release.
Do not merge this branch to `main` automatically.

## Required regression gate for every beta candidate

At minimum verify:

- protected hashes remain exact;
- application starts on Windows;
- normal local tournament create/open/save still works without network;
- pairing generation behavior is unchanged;
- historical rounds remain intact;
- TRF16/TRF26 import/export smoke tests pass;
- BBP checker path passes;
- Tie-Break Checker prepares and launches from a path-safe extraction directory;
- Chess-Results workflow smoke test remains unchanged;
- Organizer Token authentication works;
- local save succeeds when cloud is unreachable;
- manual Sync Now succeeds when cloud is reachable;
- first sync creates revision 1;
- subsequent sync increments revision;
- device A → sync → device B → open works;
- offline edit → reconnect → sync works;
- stale expected revision returns HTTP 409 without overwrite;
- restore is non-destructive and creates a new current revision;
- cloud backup does not make a tournament public.

## Current deployment state

The Cloud Workspace backend is based on **Hub API beta.8** and has been deployed through the Cloudflare Dashboard web editor.

Observed health response confirmed:

- service online;
- D1 available;
- B2 available;
- organizer authentication available;
- desktop CORS available;
- existing Hub capabilities still online.

The Cloud Workspace route was also verified to exist because an unauthenticated request to `/api/v1/cloud/workspace` returned the expected `401 invalid_organizer_token` behavior rather than `404`.

Do not assume production multi-device behavior is fully validated yet.

## Next development objective

Do not start Phase 2 yet.

First complete the Phase 1 real-world acceptance sequence:

1. Windows device A opens a normal test tournament.
2. Local save succeeds.
3. `Sync Now` uploads it to the private Organizer Workspace.
4. `My Private Cloud Tournaments` shows the tournament and revision.
5. Make a second local change and confirm revision increments.
6. Windows device B authenticates with the same Organizer Token and opens/downloads the tournament.
7. Confirm tournament data is complete and local operation continues normally.
8. Test offline edit on one device, reconnect, then sync.
9. Create a stale-revision scenario and confirm HTTP 409 prevents overwrite.
10. Run the full protected regression gate.

Only after these pass should a beta.2 scope be proposed.

## Release policy

`v1.05.01` remains Stable.

`v1.06.x` remains Beta until explicit promotion after all Cloud Workspace and protected-core gates pass.

Every candidate must be self-describing and include:

- exact parent version and parent hash;
- changelog;
- feature/regression manifest;
- protected-core hash report;
- test report;
- exact artifact SHA256;
- clear deployment status.

Never silently remove a previously fixed feature.