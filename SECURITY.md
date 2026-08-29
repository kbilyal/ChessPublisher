# Security policy

## Supported version

The latest public release is the supported branch. Security fixes may be backported only when necessary for tournament data safety.

## Reporting

For non-sensitive bugs, open a GitHub issue. For a vulnerability that would expose credentials or tournament data, contact the maintainer through the GitHub account `kbilyal` and avoid posting secrets or exploit details publicly until a fix is available.

## Secrets

Never commit Telegram tokens, Chess-Results credentials, PFX/P12 files, private keys or SignPath API tokens. The repository intentionally contains no default Telegram bot token.

## Release integrity

Release artifacts include SHA-256 checksums. Once SignPath Foundation signing is approved, public Windows release binaries will also be Authenticode signed through the source-verified GitHub build pipeline.
