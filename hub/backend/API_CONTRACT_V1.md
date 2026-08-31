# Chess-Publisher Hub API v1 — Beta Contract

Status: **BETA / NOT PRODUCTION DEPLOYED**

Baseline desktop line: `v1.05.00-beta.*`

## Principles

- Chess-Publisher local tournament state remains authoritative.
- Chess-Results integration is a separate channel and is not referenced by this API.
- Public reads are anonymous and cacheable.
- Writes require an organizer credential; no write credential is embedded in the public site or source code.
- Accepted publications are immutable revisions.
- A failed publication never replaces the previously accepted public revision.
- The server computes the canonical public-state SHA-256 checksum. Transport metadata is excluded from this checksum.

## Storage bindings

Worker bindings:

- `DB` — Cloudflare D1 database.
- `SNAPSHOTS` — Cloudflare R2 bucket containing immutable snapshot revisions.

The public site never receives either binding directly; only the Worker can use them.

## Authentication

Write endpoints require:

```http
Authorization: Bearer <organizer-api-token>
```

The database stores only SHA-256 token hashes plus a non-secret prefix for operator identification. Raw tokens are never stored by the Hub backend.

Token issuance is deliberately out-of-band during the private beta. A public account/session flow is a later phase and MUST NOT be simulated by embedding a shared secret into Chess-Publisher.

## Resource identifiers

- Tournament ID: opaque server-generated `ht_...` identifier.
- Public slug: lowercase ASCII letters, digits and hyphens; unique case-insensitively.
- Local key: stable Chess-Publisher local tournament identifier, unique per organizer.

## Endpoints

### `GET /health`

No authentication.

Returns API/schema version and service status. Does not expose binding names, secrets or account metadata.

### `POST /v1/tournaments`

Organizer authentication required.

Request:

```json
{
  "localKey": "stable-local-tournament-key",
  "name": "Tournament name",
  "requestedSlug": "tournament-name-2026"
}
```

`requestedSlug` is optional. If omitted, the server creates a neutral slug using the generated tournament ID. The server never silently changes a requested slug that is already taken; it returns `409` so the organizer can choose deliberately.

Success: `201 Created`

```json
{
  "tournamentId": "ht_...",
  "publicSlug": "tournament-name-2026",
  "currentRevision": 0
}
```

Idempotency by `(organizer, localKey)`: if that local tournament is already linked, the existing Hub tournament is returned with `200 OK`; a conflicting name/slug request does not create a second Hub tournament.

### `PUT /v1/tournaments/{tournamentId}/revisions`

Organizer authentication required and ownership checked.

Body: Tournament Snapshot schema `1.0`.

Concurrency contract:

- `snapshot.publication.previousRevision` is the client's last accepted Hub revision.
- `snapshot.publication.revision` must equal `previousRevision + 1`.
- The server never accepts a rollback over a newer revision.
- Retrying the exact publication after a lost response returns the already accepted revision as idempotent success.

Canonical checksum:

The SHA-256 checksum is computed from these snapshot fields only:

- `schemaVersion`
- `tournament`
- `players`
- `rounds`
- `standings`
- `schedule`

The following are deliberately excluded so identical tournament state remains identical across retries and client upgrades:

- `client`
- `publication`

The accepted R2 object contains the full normalized snapshot including server-confirmed tournament ID, slug, revision and checksum.

Success: `201 Created`

Retry of same accepted state: `200 OK`, `idempotent: true`.

Stale/concurrent different publication: `409 Conflict`.

### `GET /v1/public/tournaments/{publicSlug}`

No authentication.

Returns the full latest accepted Tournament Snapshot. Draft tournaments with revision `0` return `404` on the public route.

Response headers include:

```http
ETag: "<state-checksum>"
Cache-Control: public, max-age=15, stale-while-revalidate=60
```

The endpoint honors `If-None-Match` and returns `304` when appropriate.

### `GET /v1/public/tournaments/{publicSlug}/revisions/{revision}`

No authentication during beta only when the revision belongs to a published public tournament. This route exists for audit/recovery testing and may be restricted or removed before stable release.

## Status/error shape

Every JSON error uses:

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "Human-readable message",
    "requestId": "..."
  }
}
```

Important codes:

- `bad_request` — malformed JSON or contract violation.
- `snapshot_invalid` — invalid Tournament Snapshot.
- `unauthorized` — missing/invalid/revoked organizer credential.
- `forbidden` — organizer does not own the tournament.
- `not_found` — unknown/private-unpublished public resource.
- `slug_conflict` — requested public slug is already in use.
- `revision_conflict` — stale or competing revision.
- `payload_too_large` — request exceeds beta snapshot limit.
- `storage_error` — internal persistence failure; previous public revision remains authoritative.

## Beta payload limits

- Maximum snapshot request body: 2 MiB.
- Maximum tournament name: 240 characters.
- Maximum players: 10,000.
- Maximum generated rounds: 99.
- Maximum pairings per round: 10,000.

These are safety ceilings, not product recommendations.

## Security boundary for the desktop app

The future Hub tab MUST NOT keep organizer bearer tokens in public HTML/JavaScript. The network write path should run through the trusted desktop host/local service layer and use protected local credential storage. The Hub UI receives only status/result data needed for display.
