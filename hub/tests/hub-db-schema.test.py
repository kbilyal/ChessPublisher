import pathlib
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "backend" / "migrations" / "0001_hub_foundation.sql"

sql = MIGRATION.read_text(encoding="utf-8")
conn = sqlite3.connect(":memory:")
conn.executescript(sql)

expected_tables = {
    "organizers",
    "organizer_credentials",
    "tournaments",
    "publish_revisions",
    "audit_events",
}
actual_tables = {
    row[0]
    for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if not row[0].startswith("sqlite_")
}
assert expected_tables.issubset(actual_tables), (expected_tables, actual_tables)

conn.execute(
    "INSERT INTO organizers (id, display_name, created_at) VALUES (?,?,?)",
    ("org_test", "Test Organizer", "2026-08-31T10:00:00Z"),
)
conn.execute(
    "INSERT INTO tournaments (id, owner_id, local_key, public_slug, name, created_at, updated_at) "
    "VALUES (?,?,?,?,?,?,?)",
    (
        "ht_test0001",
        "org_test",
        "local-1",
        "test-open",
        "Test Open",
        "2026-08-31T10:00:00Z",
        "2026-08-31T10:00:00Z",
    ),
)

try:
    conn.execute(
        "INSERT INTO tournaments (id, owner_id, local_key, public_slug, name, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (
            "ht_test0002",
            "org_test",
            "local-2",
            "TEST-OPEN",
            "Duplicate Slug",
            "2026-08-31T10:00:00Z",
            "2026-08-31T10:00:00Z",
        ),
    )
    raise AssertionError("public_slug must be unique case-insensitively")
except sqlite3.IntegrityError:
    pass

try:
    conn.execute(
        "UPDATE tournaments SET current_revision=1 WHERE id='ht_test0001'"
    )
    raise AssertionError("revision pointer must require object key and checksum")
except sqlite3.IntegrityError:
    pass

conn.execute(
    "INSERT INTO publish_revisions "
    "(tournament_id, revision, object_key, state_checksum, client_version, accepted_at) "
    "VALUES (?,?,?,?,?,?)",
    (
        "ht_test0001",
        1,
        "tournaments/ht_test0001/revisions/00000001-abc.json",
        "a" * 64,
        "1.05.00-beta.1",
        "2026-08-31T10:01:00Z",
    ),
)
conn.execute(
    "UPDATE tournaments SET current_revision=1, current_object_key=?, current_checksum=? WHERE id=?",
    (
        "tournaments/ht_test0001/revisions/00000001-abc.json",
        "a" * 64,
        "ht_test0001",
    ),
)

try:
    conn.execute(
        "INSERT INTO publish_revisions "
        "(tournament_id, revision, object_key, state_checksum, client_version, accepted_at) "
        "VALUES (?,?,?,?,?,?)",
        (
            "ht_test0001",
            1,
            "another-object.json",
            "b" * 64,
            "1.05.00-beta.1",
            "2026-08-31T10:02:00Z",
        ),
    )
    raise AssertionError("revision number must be immutable and unique per tournament")
except sqlite3.IntegrityError:
    pass

print("PASS - Chess-Publisher Hub D1 foundation schema regression tests")
