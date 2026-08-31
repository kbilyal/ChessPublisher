INSERT INTO organizers (id, display_name, created_at)
VALUES ('org_test', 'Hub Local Integration Test', '2026-08-31T10:00:00Z');

INSERT INTO organizer_credentials (
  id, organizer_id, token_prefix, token_hash, label, created_at
) VALUES (
  'cred_test',
  'org_test',
  'cp_test_0123',
  '114348bb0904860af46e54a35e579af1ac4ac4dd4036f26aa0c78fa139fd2df4',
  'Local integration test token',
  '2026-08-31T10:00:00Z'
);

-- Raw test-only token used by CI:
-- cp_test_0123456789abcdef0123456789abcdef
-- Never reuse this value outside the local integration test.
