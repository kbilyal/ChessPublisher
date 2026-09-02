# Chess-Publisher v1.05.00

Stable release promoted on 2026-09-02 from the validated `v1.05.00-RC26` candidate.

## Release gate

- Portable RC26 Windows runtime: PASS.
- Legacy/custom Windows installer install + launch smoke test: PASS.
- Stable promotion is version-only: no production-code rebuild and no RC27.
- Stable installer and portable ZIP are byte-identical to the Windows-validated RC26 artifacts; only the public Stable filenames change.

## Protected components

The release gate did not modify:

- Gacrux 1.9.57
- Swiss Dutch pairing logic
- TRF pairing path
- BBP independent checker core
- Tie-Break Checker core
- Chess-Results core

## SHA-256

- Windows installer: `bf4e5c787c9eab8150a95b47648ab5bf302a2a5f32705bfb022b1d3103dc85bd`
- Portable ZIP: `bb9db32b002a46dbf9a67cfd4cbe416c0c2555923cceff246a37fe55ead0e84c`

The Windows installer uses the validated legacy/custom installer format used before the Inno migration experiment.
