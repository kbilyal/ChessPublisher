# Code signing policy

ChessPublisher is preparing to use the free Open Source signing service from SignPath Foundation.

**Free code signing provided by SignPath.io, certificate by SignPath Foundation.**

## Roles

- **Committer / reviewer:** Kyamran Bilyal (`kbilyal`)
- **Signing approver:** Kyamran Bilyal (`kbilyal`)

All maintainers with repository or signing permissions are expected to use multi-factor authentication.

## Source and builds

- Source of truth: `https://github.com/kbilyal/ChessPublisher`
- Signing builds must originate from the public repository.
- GitHub-hosted Windows runners are used for the build leading to a signing request.
- Generated release binaries are not treated as source.
- Gacrux is an upstream MIT-licensed project. Its pinned upstream Windows bundle may be included unsigned inside ChessPublisher packages; it is not re-signed as ChessPublisher-owned code.

## Planned SignPath release flow

1. Merge reviewed source/build changes to `main`.
2. GitHub Actions builds the unsigned launcher, portable package and Inno Setup installer.
3. The unsigned artifact is uploaded to GitHub Actions before the SignPath request.
4. SignPath verifies build origin.
5. The maintainer manually approves the release signing request.
6. Signed artifacts are published with SHA-256 checksums and copied to the project's normal distribution storage.

No attempt will be made to bypass SignPath origin verification or sign unrelated third-party binaries.

## Privacy

See [PRIVACY.md](PRIVACY.md).
