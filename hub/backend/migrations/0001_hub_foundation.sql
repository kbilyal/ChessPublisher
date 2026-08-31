PRAGMA foreign_keys = ON;

-- Chess-Publisher Hub beta foundation.
-- D1 stores ownership, public routing and revision pointers.
-- Immutable tournament snapshot payloads are stored in R2.

CREATE TABLE IF NOT EXISTS organizers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS organizer_credentials (
  id TEXT PRIMARY KEY,
  organizer_id TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'Desktop API token',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (organizer_id) REFERENCES organizers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_organizer_credentials_owner
  ON organizer_credentials(organizer_id);

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  local_key TEXT NOT NULL,
  public_slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','registration','playing','finished')),
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  current_object_key TEXT,
  current_checksum TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES organizers(id) ON DELETE RESTRICT,
  UNIQUE (owner_id, local_key),
  CHECK (
    (current_revision = 0 AND current_object_key IS NULL AND current_checksum IS NULL)
    OR
    (current_revision > 0 AND current_object_key IS NOT NULL AND current_checksum IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tournaments_owner
  ON tournaments(owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tournaments_public_status
  ON tournaments(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS publish_revisions (
  tournament_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  object_key TEXT NOT NULL UNIQUE,
  state_checksum TEXT NOT NULL,
  client_version TEXT NOT NULL,
  client_generated_at TEXT,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (tournament_id, revision),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_publish_revisions_checksum
  ON publish_revisions(tournament_id, state_checksum);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT,
  organizer_id TEXT,
  event_type TEXT NOT NULL,
  revision INTEGER,
  state_checksum TEXT,
  created_at TEXT NOT NULL,
  request_id TEXT,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE SET NULL,
  FOREIGN KEY (organizer_id) REFERENCES organizers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_tournament
  ON audit_events(tournament_id, created_at DESC);
