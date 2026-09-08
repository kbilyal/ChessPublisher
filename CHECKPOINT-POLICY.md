# Windows FIDE Beta Checkpoint Policy

Effective from v1.06.00-beta.70 onward.

Every accepted Windows FIDE beta must create a Git checkpoint before further development.

Each checkpoint must record:

- exact version and accepted parent
- exact Git commit SHA
- exact portable package filename and SHA256
- Drive release folder / artifact references
- FIDE/TEC VCL snapshot and status counts
- dedicated regression result
- cumulative regression result
- static audit result
- protected-core hash result
- Gacrux 1.9.57 integrity result
- known historical exceptions / browser skips
- next actionable TEC blocker
- any explicit protected Windows UI regressions carried forward

Rules:

1. Never develop from an older checkpoint when a newer accepted checkpoint exists.
2. Never overwrite or rewrite checkpoint history.
3. No force-push for checkpoint refs.
4. A beta checkpoint is not a Final/Stable release.
5. Gacrux 1.9.57, Swiss Dutch pairing, TRF16/TRF26 core, BBP checker, Tie-Break core/checker and Chess-Results protocol/core remain protected.
6. Desktop ↔ Web sync and Windows Fluidity/UI changes must pass their dedicated protected regression gates before an accepted checkpoint is created.
7. If a regression appears, do not advance the checkpoint until the unexpected failure is zero.

The accepted portable package remains the runtime source of truth for each checkpoint. Git is the auditable development/checkpoint history and must be kept aligned with accepted packages.
