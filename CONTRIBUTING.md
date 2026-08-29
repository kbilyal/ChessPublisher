# Contributing

Issues and pull requests are welcome. Please keep changes focused and preserve the separation between the UI, WebView host, LocalEngine and the upstream Gacrux pairing engine.

Before proposing a change:

1. Do not commit credentials, tournament backups or user data.
2. Do not modify or replace the pinned Gacrux binary/source reference without documenting the upstream release and new SHA-256.
3. Pairing-engine changes require regression tests against existing TRF/Gacrux behavior.
4. Build and distribution changes must remain reproducible from the public repository.
5. Pull requests from non-committers require maintainer review before merge.
