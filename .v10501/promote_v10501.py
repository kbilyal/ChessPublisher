import hashlib
import re
import sys
from pathlib import Path

STABLE_VERSION = "1.05.01"
RC26_VERSION = "1.05.00-RC26"

EXPECTED_PROTECTED = {
    "ChessPublisher.exe": "1e5c93b987e156a81a3b1ca0bb6dc6fe84f97f38477c161b355a75b2c86458c3",
    "ChessPublisher-LocalEngine.ps1": "98e7014646619f9d1a12b88a64552c97411216c35fa817cb9657d68adb3fb8bb",
    "FIDE-Update.ps1": "a1ecf7e1cc7fb2f3830c81da7a84fe7fb1ee434f156b9d1c0661e80e176509db",
    "webview/WebViewAdapter.js": "d23af37ce1624fac96b46f62c85d7801ed733a66f7e03bab40f453ce4db67861",
    "hub/client/hub-snapshot.js": "d980c520d74a71e66b3a3aa2a54e5ed626ea3618c53159145f9e48b445effac9",
    "engine/gacrux/pairingchecker.exe": "6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb",
}

# These are the exact hashes of the uploaded v1.05.01-RC1 runtime files after
# changing only the visible/client version token from 1.05.01-RC1 to 1.05.01.
EXPECTED_STABLE_RUNTIME = {
    "ChessPublisher-WebView.ps1": "53e92b104e271996f306ce7b2666d6450ee356414543ce778b0fa4c0b08165a5",
    "ChessPublisher.html": "028cac4dfd6ba14003ab6d99f4072c384cc3c02d3457ea28b8252029cc8a2b59",
    "webview/HubAdapter.js": "ff71ce1f0895406abfd4dc0f4c8d547caf9b4c8063842c01f2de72f3cbfb5f3a",
    "hub/client/hub-api-client.js": "e77dd35a97dc15d5c06621ad02bb05bc63a11de54098f4fe9865e8896f32471c",
}

START_DIRECT = r'''function Start-EngineDirectProcess([string]$EngineScript) {
  Write-WvLog 'Universal launcher method 2: starting LocalEngine with System.Diagnostics.Process.'
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'powershell.exe'
  $psi.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Port {1}' -f $EngineScript,$Port
  $psi.WorkingDirectory = $root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $process = [System.Diagnostics.Process]::Start($psi)
  if(-not $process) { throw 'System.Diagnostics.Process returned no process.' }
  $script:engineProcess = $process

  $health = Wait-EngineReady 25 350
  if($health) {
    $script:engineMode = 'direct-process'
    Write-WvLog "LocalEngine $serviceVersion ready on port $Port using direct process startup."
    return $true
  }
  try {
    if(-not $process.HasExited) {
      $process.Kill()
      try { [void]$process.WaitForExit(2000) } catch {}
    }
  } catch {}
  try { $process.Dispose() } catch {}
  $script:engineProcess = $null
  throw 'LocalEngine child process did not become ready.'
}

'''

STOP_OWNED = r'''function Stop-OwnedEngine {
  if(-not $engineOwned) { return }
  try { Invoke-WebRequest -UseBasicParsing -Method Post "http://127.0.0.1:$Port/shutdown" -TimeoutSec 1 | Out-Null } catch {}

  if($engineMode -eq 'in-process-runspace') {
    try {
      if($engineAsync -and $enginePowerShell) {
        if(-not $engineAsync.AsyncWaitHandle.WaitOne(2500)) { try { $enginePowerShell.Stop() } catch {} }
        try { if($engineAsync.IsCompleted) { [void]$enginePowerShell.EndInvoke($engineAsync) } } catch {}
      }
    } finally {
      try { if($enginePowerShell) { $enginePowerShell.Dispose() } } catch {}
      try { if($engineRunspace) { $engineRunspace.Close(); $engineRunspace.Dispose() } } catch {}
      $script:engineAsync = $null
      $script:enginePowerShell = $null
      $script:engineRunspace = $null
    }
  } elseif($engineProcess) {
    try {
      if(-not $engineProcess.HasExited) {
        if(-not $engineProcess.WaitForExit(2500)) { $engineProcess.Kill() }
      }
    } catch {}
    try { $engineProcess.Dispose() } catch {}
    $script:engineProcess = $null
  }
  Write-WvLog "LocalEngine shutdown completed (mode=$engineMode)."
  $script:engineOwned = $false
  $script:engineMode = ''
}

'''


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def require_hash(root: Path, rel: str, expected: str, label: str) -> None:
    path = root / rel
    if not path.is_file():
        raise SystemExit(f"Missing {label}: {rel}")
    got = sha256(path)
    if got != expected:
        raise SystemExit(f"{label} hash mismatch for {rel}: {got} != {expected}")
    print(f"PASS {label}: {rel} {got}")


def replace_function(text: str, name: str, next_name: str, replacement: str) -> str:
    pattern = rf"(?ms)^function {re.escape(name)}\b.*?(?=^function {re.escape(next_name)}\b)"
    new_text, count = re.subn(pattern, lambda _m: replacement, text, count=1)
    if count != 1:
        raise SystemExit(f"Could not replace {name}; matches={count}")
    return new_text


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: promote_v10501.py <extracted-v1.05.00-root>")
    root = Path(sys.argv[1]).resolve()
    if not root.is_dir():
        raise SystemExit(f"Not a directory: {root}")

    # Gate the parent before changing anything.
    for rel, expected in EXPECTED_PROTECTED.items():
        require_hash(root, rel, expected, "protected parent")

    wv_path = root / "ChessPublisher-WebView.ps1"
    raw = wv_path.read_bytes()
    had_bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    if RC26_VERSION not in text:
        raise SystemExit(f"Expected parent version marker {RC26_VERSION} not found in WebView host")

    text = replace_function(text, "Start-EngineDirectProcess", "Start-EngineCmdFallback", START_DIRECT)
    text = replace_function(text, "Stop-OwnedEngine", "Ensure-WebView2Sdk", STOP_OWNED)
    text = text.replace(RC26_VERSION, STABLE_VERSION)
    encoded = text.encode("utf-8")
    if had_bom:
        encoded = b"\xef\xbb\xbf" + encoded
    wv_path.write_bytes(encoded)

    for rel in ("ChessPublisher.html", "webview/HubAdapter.js", "hub/client/hub-api-client.js"):
        path = root / rel
        data = path.read_bytes()
        if RC26_VERSION.encode("ascii") not in data:
            raise SystemExit(f"Expected parent version marker {RC26_VERSION} not found in {rel}")
        path.write_bytes(data.replace(RC26_VERSION.encode("ascii"), STABLE_VERSION.encode("ascii")))

    (root / "VERSION.txt").write_text(STABLE_VERSION + "\n", encoding="ascii")
    (root / "WEBVIEW-VERSION.txt").write_text(STABLE_VERSION + "\n", encoding="ascii")

    changelog = f"""Chess-Publisher v{STABLE_VERSION} Stable — 2026-09-03
====================================================
Parent: Chess-Publisher v1.05.00 Stable (byte-identical RC26 portable base)
Candidate: v1.05.01-RC1, promoted by maintainer approval on 2026-09-03

Scope: Windows host lifecycle point-fix only.

Fixed:
- Failed direct LocalEngine startup now performs Kill -> WaitForExit(2000) -> Dispose and clears $script:engineProcess.
- Normal owned-engine shutdown clears disposed runspace/process references and resets ownership/mode state.
- Existing FormClosing save bridge and FormClosed Stop-OwnedEngine behavior are retained.

Protected / unchanged:
- ChessPublisher.exe launcher bytes
- ChessPublisher-LocalEngine.ps1 service logic
- Gacrux 1.9.57 / Swiss Dutch pairing
- TRF pairing and history paths
- BBP checker
- Tie-Break core
- Chess-Results core

Release gate:
- Exact RC1-to-stable runtime hashes verified during publication.
- Protected core SHA-256 hashes verified before and after patching.
- No unrelated production-code changes.
"""
    (root / f"CHANGELOG-v{STABLE_VERSION}-2026-09-03.txt").write_text(changelog, encoding="utf-8")

    # Exact RC1 -> stable runtime gate.
    for rel, expected in EXPECTED_STABLE_RUNTIME.items():
        require_hash(root, rel, expected, "stable runtime")

    # Protected bytes must still be untouched after the point fix.
    for rel, expected in EXPECTED_PROTECTED.items():
        require_hash(root, rel, expected, "protected stable")

    final_wv = wv_path.read_text(encoding="utf-8-sig")
    required_markers = (
        "$process.WaitForExit(2000)",
        "$process.Dispose()",
        "$script:engineProcess = $null",
        "$script:engineAsync = $null",
        "$script:enginePowerShell = $null",
        "$script:engineRunspace = $null",
        "$script:engineOwned = $false",
        "$script:engineMode = ''",
    )
    for marker in required_markers:
        if marker not in final_wv:
            raise SystemExit(f"Missing v1.05.01 lifecycle marker: {marker}")
    if final_wv.count("function Stop-OwnedEngine") != 1:
        raise SystemExit("Stop-OwnedEngine definition count is not exactly 1")
    print("PASS v1.05.01 stable point-fix promotion gate")


if __name__ == "__main__":
    main()
