# Privacy policy

ChessPublisher does not include project analytics, advertising, telemetry, or a remote ChessPublisher account service. Tournament data is stored locally unless the operator explicitly uses a publishing/integration feature.

## Network connections

- **Microsoft/NuGet:** the WebView host may download the official Microsoft WebView2 SDK package on first use if the required SDK files are not cached.
- **FIDE:** requests/downloads occur when the operator uses FIDE rating/player functions.
- **Chess-Results:** requests occur when the operator creates, publishes, administers or removes a Chess-Results tournament.
- **Telegram:** requests occur only after the operator configures a Telegram bot token/channel and uses a Telegram publishing function.
- **Gacrux:** the release build downloads a pinned upstream archive; the installed pairing engine itself is used locally.

Credentials entered by the operator must not be committed to the source repository. ChessPublisher does not ship with a Telegram bot token.

This program will not transfer tournament or credential information to other networked systems except as required by a feature specifically requested/configured by the person operating it, plus the WebView2 SDK bootstrap described above.
