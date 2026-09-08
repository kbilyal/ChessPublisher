# Linux development build 10

Fixes an infinite MutationObserver loop when opening tab workspaces. Updating a popup title now changes the DOM only when its text changes. Also restores maximize/restore after dragging and allows native popup resizing. Includes the existing full-viewport main window changes.

Version: `v1.06.00-beta.34-linuxdev10`

Validation:
- Real Chromium: open/close all seven popup workspaces, update title, resize, maximize and restore.
- Window mode, browser launcher and adapter ordering contracts: PASS.
- Extracted Debian package self-test: 6/6 PASS, including protected source identity and runtime integrity.

Package: `chess-publisher_1.06.00~beta34+linuxdev10_amd64.deb`

SHA256: `a9e94b95ecc5c6e5a7e89b9e977f58dabf424f850236856936e68f2dc3dfef12`

Built from the installed source snapshot after verifying all seven files against the repository's pinned source manifest. Protected source and tournament engines are unchanged. This remains a development beta; no physical DGT or live Chess-Results acceptance was performed for this fix.
