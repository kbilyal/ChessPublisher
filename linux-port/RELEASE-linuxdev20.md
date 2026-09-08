# Chess-Publisher v1.06.00-beta.34-linuxdev20

Base: v1.06.00-beta.34-linuxdev19 (`3b05defa636280efab0a3d8ef5cb27ffc3c12e00`)

## Scope
Linux Desktop UI fluidity and reliability pass only.

## Changes
- Replaced routine tab popup workspaces with one viewport-filling single workspace.
- Removed nested inner-window resize/drag chrome in Chromium app mode; native OS window management remains authoritative.
- Disabled expensive Linux-only blur/backdrop effects and non-essential control transitions.
- Added clean-navigation fast path: when `stateDirty` is false, routine tab changes do not call the protected `saveAll()` / `saveData()` persistence path merely to change `activeTab`.
- Dirty navigation, DGT transitions, tournament persistence, autosave, exports and all tournament logic retain the protected original path.
- Added missing-tab-button fallback and invalid-target guard to avoid UI navigation exceptions.
- Added real Chromium regression for 70 clean tab switches plus dirty-path preservation.

## Protected components
Not modified:
- protected `ChessPublisher.html`
- Gacrux 1.9.57
- Swiss Dutch pairing
- TRF pairing/export core
- BBP checker/runtime core
- Tie-Break core/checker
- Chess-Results protocol/core

## Release status
Development test candidate only. Not a final/stable release. Full Ubuntu acceptance must pass before packaging is offered for manual testing.
