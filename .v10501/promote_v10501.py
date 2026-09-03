import hashlib
import re
import sys
from pathlib import Path

STABLE_VERSION = "1.05.01"
PARENT_VERSION = "1.05.00-RC26"

EXPECTED_PROTECTED = {
    "ChessPublisher.exe": "1e5c93b987e156a81a3b1ca0bb6dc6fe84f97f38477c161b355a75b2c86458c3",
    "ChessPublisher-LocalEngine.ps1": "98e7014646619f9d1a12b88a64552c97411216c35fa817cb9657d68adb3fb8bb",
    "FIDE-Update.ps1": "a1ecf7e1cc7fb2f3830c81da7a84fe7fb1ee434f156b9d1c0661e80e176509db",
    "webview/WebViewAdapter.js": "d23af37ce1624fac96b46f62c85d7801ed733a66f7e03bab40f453ce4db67861",
    "hub/client/hub-snapshot.js": "d980c520d74a71e66b3a3aa2a54e5ed626ea3618c53159145f9e48b445effac9",
    "engine/gacrux/pairingchecker.exe": "6955c4c1f16425fa662f70d08311cfddeeaf21cca1aee3d04a3a6b0f7bbb45fb",
}

# Exact approved RC1 host file after only RC1 -> Stable version-label promotion.
EXPECTED_STABLE_WEBVIEW = "53e92b104e271996f306ce7b2666d6450ee356414543ce778b0fa4c0b08165a5"

START_DIRECT = '''function Start-EngineDirectProcess([string]$EngineScript) {
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

STOP_OWNED = '''function Stop-OwnedEngine {
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


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def gate(root, mapping, label):
    for rel, expected in mapping.items():
        path = root / rel
        if not path.is_file():
            raise SystemExit(f"Missing {label}: {rel}")
        got = sha256(path)
        if got != expected:
            raise SystemExit(f"{label} hash mismatch for {rel}: {got} != {expected}")
        print(f"PASS {label}: {rel} {got}")


def replace_function(text, name, next_name, replacement):
    pattern = rf"(?ms)^function {re.escape(name)}\b.*?(?=^function {re.escape(next_name)}\b)"
    text, count = re.subn(pattern, lambda _m: replacement, text, count=1)
    if count != 1:
        raise SystemExit(f"Could not replace {name}; matches={count}")
    return text


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: promote_v10501.py <extracted-v1.05.00-root>")
    root = Path(sys.argv[1]).resolve()
    gate(root, EXPECTED_PROTECTED, "protected parent")

    # Snapshot the three UI/client files before touching them. Their ONLY permitted
    # change in this maintenance release is the visible/client version token.
    token_files = ("ChessPublisher.html", "webview/HubAdapter.js", "hub/client/hub-api-client.js")
    original = {}
    for rel in token_files:
        p = root / rel
        data = p.read_bytes()
        old = PARENT_VERSION.encode("ascii")
        if old not in data:
            raise SystemExit(f"Missing parent marker {PARENT_VERSION} in {rel}")
        original[rel] = data

    wv = root / "ChessPublisher-WebView.ps1"
    raw = wv.read_bytes()
    bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    if PARENT_VERSION not in text:
        raise SystemExit(f"Missing parent marker {PARENT_VERSION} in WebView host")
    text = replace_function(text, "Start-EngineDirectProcess", "Start-EngineCmdFallback", START_DIRECT)
    text = replace_function(text, "Stop-OwnedEngine", "Ensure-WebView2Sdk", STOP_OWNED)
    text = text.replace(PARENT_VERSION, STABLE_VERSION)
    out = text.encode("utf-8")
    if bom:
        out = b"\xef\xbb\xbf" + out
    wv.write_bytes(out)

    old = PARENT_VERSION.encode("ascii")
    new = STABLE_VERSION.encode("ascii")
    for rel in token_files:
        p = root / rel
        expected = original[rel].replace(old, new)
        p.write_bytes(expected)
        if p.read_bytes() != expected:
            raise SystemExit(f"Non-version drift detected in {rel}")
        print(f"PASS version-only file: {rel} {sha256(p)}")

    (root / "VERSION.txt").write_text(STABLE_VERSION + "\n", encoding="ascii")
    (root / "WEBVIEW-VERSION.txt").write_text(STABLE_VERSION + "\n", encoding="ascii")
    (root / "CHANGELOG-v1.05.01-2026-09-03.txt").write_text(
        "Chess-Publisher v1.05.01 Stable — 2026-09-03\n"
        "Parent: v1.05.00 Stable (byte-identical RC26 portable base)\n"
        "Candidate: v1.05.01-RC1\n\n"
        "Scope: Windows host lifecycle point-fix only.\n"
        "- Failed direct LocalEngine startup: Kill -> WaitForExit(2000) -> Dispose -> clear process reference.\n"
        "- Normal owned-engine shutdown clears disposed runspace/process references and resets ownership/mode.\n"
        "- RC1 HTML drift unrelated to this point-fix was intentionally excluded from Stable.\n"
        "- Gacrux 1.9.57, Swiss Dutch pairing, TRF, BBP, tie-break and Chess-Results core unchanged.\n"
        "- Exact approved RC1 WebView host SHA-256 and protected-core SHA-256 gates enforced.\n",
        encoding="utf-8",
    )

    if sha256(wv) != EXPECTED_STABLE_WEBVIEW:
        raise SystemExit(f"Approved RC1 WebView hash mismatch: {sha256(wv)} != {EXPECTED_STABLE_WEBVIEW}")
    print(f"PASS exact approved RC1 host: ChessPublisher-WebView.ps1 {EXPECTED_STABLE_WEBVIEW}")
    gate(root, EXPECTED_PROTECTED, "protected stable")

    final = wv.read_text(encoding="utf-8-sig")
    for marker in (
        "$process.WaitForExit(2000)", "$process.Dispose()", "$script:engineProcess = $null",
        "$script:engineAsync = $null", "$script:enginePowerShell = $null", "$script:engineRunspace = $null",
        "$script:engineOwned = $false", "$script:engineMode = ''",
    ):
        if marker not in final:
            raise SystemExit(f"Missing lifecycle marker: {marker}")
    if final.count("function Stop-OwnedEngine") != 1:
        raise SystemExit("Stop-OwnedEngine definition count is not exactly 1")
    print("PASS v1.05.01 minimal stable point-fix promotion gate")


if __name__ == "__main__":
    main()
