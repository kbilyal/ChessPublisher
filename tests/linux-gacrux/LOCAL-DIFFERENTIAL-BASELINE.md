# RC26 Linux Gacrux differential baseline

Production release under test: Chess-Publisher v1.05.00-RC26

- RC26 `ChessPublisher.html` SHA256: `9099d8c08c06e77117cce98d8160942af57b467f0994d6c7c3ff7f902c274098`
- Production `buildPairingEngineTRF` SHA256: `fb0979a5546cbcea4f5c6fa9ece23aa21ba1185c402db0eb4443ad4fdbcca8ce`
- Pinned Gacrux/TieBreakServer commit: `14a34a2c2f36509b110e4f25d6247f31fc4bf2f5`
- Expected upstream version: `1.9.57`

Before the compact Linux model was admitted to the cloud gate, its generated TRF bytes were compared locally against the real RC26 production `buildPairingEngineTRF` extracted from `ChessPublisher.html`.

Differential fixtures:

1. 16 players, pre-Round 1 / empty history — PASS, 1585 bytes.
2. 16 players, completed normal Round 1 — PASS, 1746 bytes.
3. 15 players, completed Round 1 with one PAB/U — PASS, 1644 bytes.
4. Late-entry administrative full bye/F — PASS, 1644 bytes.
5. Double forfeit 0F-0F — PASS, 1744 bytes.

Result: **5/5 byte-identical PASS**.

The compact serializer is test infrastructure only. Production RC26 remains the source of truth and is not modified by this branch.
