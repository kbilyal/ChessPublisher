# Protected Core — Chess-Publisher FIDE/TEC development

These components are regression-protected. Do not modify them merely to satisfy UI/VCL wrappers. A deliberate change requires a dedicated reason, replacement hashes and full regression evidence.

- Gacrux 1.9.57 / `engine/` pairing tree.
- `ChessPublisher.exe`.
- `ChessPublisher-LocalEngine.ps1`.
- Swiss Dutch pairing logic/path.
- TRF pairing path and fixed-width core behavior.
- BBP independent checker core.
- protected Tie-Break calculation/checker core.
- Chess-Results protocol/core.
- DGT core.
- `webview/HubAdapter.js`.
- `webview/WebViewAdapter.js`.
- `webview/CloudWorkspaceAdapter.js`.
- `cloud/client/cloud-workspace-api.js`.

Latest beta.54 gate: **70/70 protected files byte-identical to beta.53**.

## Historical known hashes retained from beta.35 lineage

- `ChessPublisher.exe`: `1e5c93b987e156a81a3b1ca0bb6dc6fe84f97f38477c161b355a75b2c86458c3`
- `ChessPublisher-LocalEngine.ps1`: `baed6af16c693d45fd2a4e990881213eca69c0e2d79b1aee7ecb85735d128e81`
- `FIDE-Update.ps1`: `a1ecf7e1cc7fb2f3830c81da7a84fe7fb1ee434f156b9d1c0661e80e176509db`
- `webview/WebViewAdapter.js`: `d23af37ce1624fac96b46f62c85d7801ed733a66f7e03bab40f453ce4db67861`
- `webview/HubAdapter.js`: `e5d61eb452f8b98e70e874cb5a90da2ab6dfe4669c9da363a5047332c9ae62c0`
- `webview/CloudWorkspaceAdapter.js`: `a25dba042e46d0f120f9cf721b68fdb70178ab323da902bbcc34c42e6947a602`
- `cloud/client/cloud-workspace-api.js`: `733b9f921af5f4986c0ef89df62c650d1e621011b40aeeb02f5ba4ba900a1ab5`
- `engine/gacrux/pairingchecker.exe`: `6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb`

Always compare against the immediate accepted parent package as well as retained historical protected hashes.
