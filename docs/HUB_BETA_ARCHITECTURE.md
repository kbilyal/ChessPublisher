# Chess-Publisher Hub — Beta Architecture

Status: **BETA DESIGN CONTRACT**

Baseline: `v1.04.02` / commit `869c914fb736ee713f0877a959c98138b36e16c3`

Target beta line: `v1.05.00-beta.*`

## 1. Non-negotiable release rules

1. The `v1.04.02` stable release is the immutable code baseline for this work.
2. The existing Chess-Results integration is an independent publishing channel and MUST NOT be changed as part of Hub development.
3. Hub code MUST NOT alter pairing, Gacrux, TRF pairing, BBP checker, tie-break core, or existing Chess-Results behavior.
4. The Hub consumes tournament state only after Chess-Publisher core has produced it.
5. No `v1.05.00` final/stable release is allowed until the complete Hub scope passes the final release gates.
6. Beta development must be reversible. A Hub failure must never prevent the local tournament from continuing.

## 2. Product model

Chess-Publisher Hub is a separate online tournament ecosystem for tournaments created and managed in Chess-Publisher.

Publishing channels are parallel:

```text
Chess-Publisher core
  ├─ Existing Chess-Results integration  (unchanged)
  └─ Chess-Publisher Hub                (new, isolated)
```

The first Hub versions are read/publish oriented. Tournament pairing and ranking computation remain local in Chess-Publisher.

## 3. Architectural boundaries

### Desktop application

A new `Chess-Publisher Hub` tab will be added as an isolated UI surface. It may read:

- tournament settings;
- registered players;
- generated round history;
- entered results;
- standings already calculated by Chess-Publisher;
- schedule and public tournament information.

It MUST NOT call or modify Chess-Results functions.

### Hub client adapter

The desktop application will serialize local state into a versioned **Tournament Snapshot**. The serializer is the only component allowed to translate Chess-Publisher's internal data model into the public Hub API model.

The serializer must be deterministic: the same local tournament state must produce the same canonical payload/checksum, excluding transport-only timestamps.

### API layer

Recommended deployment architecture for beta:

- `api.chess-publisher.org` — API endpoint;
- edge/serverless API;
- relational database for canonical tournament data;
- immutable publication revisions for recovery/audit;
- object storage added later for PGN/media if required.

The public website must never contain write credentials.

### Public website

The public Hub UI is a read-only client of the Hub API. It is developed separately from the existing marketing site and is not deployed to the production site until its beta gates pass.

Target public routes:

```text
/t/<public-slug>
/t/<public-slug>/players
/t/<public-slug>/round/<n>
/t/<public-slug>/standings
```

Later routes may include tournament search, organizer pages, player profiles and federation views.

## 4. Public identity

Every published tournament has two identifiers:

- `hubTournamentId` — opaque immutable internal/public API ID;
- `publicSlug` — human-friendly URL slug that may be changed without changing the immutable ID.

Local tournament names are not identifiers.

Players use a stable Hub player identity within the tournament. When a valid FIDE ID is present it is retained as external identity data, but the Hub must still support local/unrated players.

## 5. Snapshot model

The versioned contract is stored in:

`hub/contracts/tournament-snapshot-v1.schema.json`

A snapshot contains:

- schema/client metadata;
- public tournament metadata;
- players;
- complete generated round history;
- current/final standings snapshot;
- tie-break labels and values;
- schedule;
- publication revision metadata.

Chess-Results identifiers are deliberately not part of the Hub contract. This prevents coupling between the two publishing systems.

## 6. Publication semantics

Publishing is **revision based**, not blind overwrite.

Each accepted publication creates an immutable revision containing:

- tournament ID;
- revision number;
- payload checksum;
- client version;
- creation timestamp;
- normalized current state.

The current public tournament view points to the latest accepted revision.

Required guarantees:

1. retrying the same snapshot is idempotent;
2. stale clients cannot silently overwrite a newer revision;
3. a failed publish cannot corrupt the previous public revision;
4. the desktop app keeps the local tournament authoritative;
5. publication can be retried after connectivity returns.

## 7. Initial data storage model

Logical entities:

- `tournaments`
- `tournament_players`
- `rounds`
- `pairings`
- `standings_snapshots`
- `standing_rows`
- `publish_revisions`
- `tournament_manage_credentials` (beta auth stage)

Recommended uniqueness rules:

- one `(tournament_id, round_no)` round;
- one `(tournament_id, round_no, board_no)` pairing;
- one `(tournament_id, round_no, player_id)` standing row;
- monotonically increasing revision per tournament;
- unique public slug.

## 8. Security model

The public API is split into read and write paths.

Read:

- public tournament data;
- rate limited;
- cacheable;
- no authentication required for public tournaments.

Write:

- authenticated per tournament/organizer;
- credentials never embedded in public pages;
- HTTPS only;
- request-size limits;
- schema validation;
- revision/concurrency checks;
- rate limiting;
- audit metadata;
- no arbitrary HTML accepted from the desktop client.

Do not use tournament names, Chess-Results IDs or predictable sequential numbers as write credentials.

## 9. Failure isolation

Hub operations are asynchronous from the tournament workflow.

If Hub is offline or rejects a publication:

- local save continues;
- pairing/results entry continues;
- Chess-Results integration continues unchanged;
- the Hub tab reports the error and keeps a retryable local publication state;
- no tournament core state is rolled back.

## 10. Beta delivery stages

### Beta 1 — foundation

- isolated branches;
- architecture contract;
- snapshot JSON schema;
- responsive public UX contract;
- local snapshot serializer + validation fixtures;
- no network writes yet.

### Beta 2 — public read-only UI

- tournament overview;
- players;
- round pairings/results;
- standings;
- mobile/desktop responsive layouts;
- fixture-driven tests;
- accessibility baseline.

### Beta 3 — API + publishing

- database migrations;
- create tournament;
- publish snapshot;
- revision/idempotency logic;
- desktop Hub tab;
- publish status/live log;
- public API reads.

### Beta 4 — ownership/security

- organizer/tournament ownership;
- credential rotation;
- revoke/unpublish controls;
- audit history;
- abuse/rate controls.

### Beta 5 — ecosystem discovery

- tournament search;
- federation/date/status filters;
- organizer pages;
- stable player discovery model;
- SEO/social metadata.

### Beta 6 — resilience and scale

- backup/restore drills;
- revision rollback;
- load tests;
- API monitoring;
- caching strategy;
- browser/device matrix;
- security review.

### RC gate

RC begins only after all beta stages above are functionally complete. Final release requires all release-gate tests to pass with no known release-blocking defects.

## 11. Explicitly out of scope for the first beta

- replacing Chess-Results;
- changing Chess-Results integration;
- cloud-side pairing computation;
- cloud-side tie-break computation;
- changing local tournament algorithms;
- DGT/live-board streaming until the core Hub publication path is stable;
- payment/donation handling inside Hub.

## 12. Definition of success

The Hub is successful when an arbiter can run a tournament locally with the same reliability as `v1.04.02`, publish it independently to Chess-Publisher Hub, and participants can reliably view the tournament on both mobile and desktop without the Hub becoming a dependency for pairing or result entry.
