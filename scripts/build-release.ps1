param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [string]$Date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Version = $Version.Trim()
if ($Version.StartsWith('v', [System.StringComparison]::OrdinalIgnoreCase)) {
  $Version = $Version.Substring(1)
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Version must have the form 1.04.01 (received '$Version')."
}
if ($Date -notmatch '^\d{4}-\d{2}-\d{2}$') {
  throw "Date must have the form YYYY-MM-DD (received '$Date')."
}

$parts = $Version.Split('.') | ForEach-Object { [int]$_ }
$numericVersion = '{0}.{1}.{2}.0' -f $parts[0], $parts[1], $parts[2]
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$buildRoot = Join-Path $repoRoot 'build'
$payload = Join-Path $buildRoot 'payload'
$dist = Join-Path $repoRoot 'dist'

Write-Host "Preparing Chess-Publisher v$Version ($Date)"
Write-Host "Repository: $repoRoot"

function Assert-FileSha256 {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label is missing: $Path"
  }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Expected.ToLowerInvariant()) {
    throw "$Label SHA-256 mismatch. Expected $Expected but found $actual."
  }
}

function Get-ValidatedChessResultsByteList {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [AllowEmptyString()][string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "Required GitHub Actions secret '$Name' is not configured."
  }

  $tokens = @($Value.Split(',') | ForEach-Object { $_.Trim() })
  if ($tokens.Count -ne 16) {
    throw "Secret '$Name' must contain exactly 16 comma-separated byte values."
  }

  $bytes = @()
  foreach ($token in $tokens) {
    $number = 0
    if (-not [int]::TryParse($token, [ref]$number) -or $number -lt 0 -or $number -gt 255) {
      throw "Secret '$Name' contains an invalid byte value."
    }
    $bytes += $number
  }

  return ($bytes -join ',')
}

$versionFile = Join-Path $repoRoot 'VERSION'
if (-not (Test-Path -LiteralPath $versionFile)) {
  throw 'VERSION is missing from the repository.'
}
$repoVersion = (Get-Content -LiteralPath $versionFile -Raw).Trim().TrimStart('v')
if ($repoVersion -ne $Version) {
  throw "VERSION contains '$repoVersion' but the requested release is '$Version'. Update VERSION before releasing."
}

$requiredFiles = @(
  'ChessPublisher.html',
  'ChessPublisher-WebView.ps1',
  'ChessPublisher-LocalEngine.ps1',
  'FIDE-Update.ps1',
  'webview/WebViewAdapter.js',
  'src/launcher/ChessPublisherLauncher.cs',
  'scripts/fetch-gacrux.ps1',
  'installer/ChessPublisher.iss',
  'LICENSE'
)
$missing = @($requiredFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $repoRoot $_)) })
if ($missing.Count -gt 0) {
  throw ("Release source is incomplete. Missing:`n - " + ($missing -join "`n - "))
}

# v1.04.01 is a previously validated stable runtime. Do not build a release
# carrying a different public-source snapshot under the same version number.
if ($Version -eq '1.04.01') {
  Assert-FileSha256 (Join-Path $repoRoot 'ChessPublisher.html') '21ff798bd67a9f9dda83c29a2af861c2fcce3aa5bcc2a12c3465d361cd56fd36' 'v1.04.01 ChessPublisher.html'
  Assert-FileSha256 (Join-Path $repoRoot 'ChessPublisher-WebView.ps1') 'b0e941951102a36ad929064dd157af6bd942a4a598fe854919223f1e2bcef571' 'v1.04.01 WebView host'
  Assert-FileSha256 (Join-Path $repoRoot 'ChessPublisher-LocalEngine.ps1') '5ba79e21f19066f7bb9f55dd162eb433b0729fb4325198eb1748f7d439b10b9c' 'v1.04.01 sanitized LocalEngine source'
  Assert-FileSha256 (Join-Path $repoRoot 'FIDE-Update.ps1') 'be0e3253ffd9f44d0027c13d126fb44b73919469ab0506ef7307c70b6244d7f7' 'v1.04.01 FIDE updater'
  Assert-FileSha256 (Join-Path $repoRoot 'webview/WebViewAdapter.js') 'd23af37ce1624fac96b46f62c85d7801ed733a66f7e03bab40f453ce4db67861' 'v1.04.01 WebView adapter'
}

Remove-Item -LiteralPath $buildRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $payload -Force | Out-Null
New-Item -ItemType Directory -Path $dist -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $payload 'webview') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $payload 'engine') -Force | Out-Null

function Copy-RepoFile {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [string]$Destination = $Source
  )
  $sourcePath = Join-Path $repoRoot $Source
  if (-not (Test-Path -LiteralPath $sourcePath)) { return }
  $destinationPath = Join-Path $payload $Destination
  $destinationParent = Split-Path -Parent $destinationPath
  if ($destinationParent) { New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null }
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

# Core runtime.
Copy-RepoFile 'ChessPublisher.html'
Copy-RepoFile 'ChessPublisher-WebView.ps1'
Copy-RepoFile 'ChessPublisher-LocalEngine.ps1'
Copy-RepoFile 'FIDE-Update.ps1'
Copy-RepoFile 'webview/WebViewAdapter.js'

# Keep service-shared Chess-Results AES material out of the public repository.
# The public LocalEngine contains exactly one marker for each 16-byte value.
# Only the release payload copy is modified here.
$crIv = Get-ValidatedChessResultsByteList 'CHESSRESULTS_AES_IV_BYTES' ([string]$env:CHESSRESULTS_AES_IV_BYTES)
$crKey = Get-ValidatedChessResultsByteList 'CHESSRESULTS_AES_KEY_BYTES' ([string]$env:CHESSRESULTS_AES_KEY_BYTES)
$localEnginePayload = Join-Path $payload 'ChessPublisher-LocalEngine.ps1'
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
$localEngineText = [System.IO.File]::ReadAllText($localEnginePayload)
$ivMarker = '__CP_CR_AES_IV_BYTES__'
$keyMarker = '__CP_CR_AES_KEY_BYTES__'
if (-not $localEngineText.Contains($ivMarker) -or -not $localEngineText.Contains($keyMarker)) {
  throw 'Sanitized LocalEngine credential markers are missing. Refusing to build.'
}
$localEngineText = $localEngineText.Replace($ivMarker, $crIv).Replace($keyMarker, $crKey)
if ($localEngineText.Contains('__CP_CR_AES_')) {
  throw 'A Chess-Results credential placeholder remained after release injection.'
}
[System.IO.File]::WriteAllText($localEnginePayload, $localEngineText, $utf8Bom)

# For the already validated v1.04.01 release, correct secrets restore the exact
# stable LocalEngine bytes. A wrong secret therefore cannot silently publish.
if ($Version -eq '1.04.01') {
  Assert-FileSha256 $localEnginePayload '0fe60d712d9a470d0487149bd72b25d8597bbcc56b18361db6156a41be7b5602' 'Injected v1.04.01 LocalEngine runtime'
}

# Launch helpers and documentation are included when they exist in the public source tree.
@(
  'ChessPublisher-WebView.bat',
  'ChessPublisher-WebView-Debug.bat',
  'ChessPublisher.bat',
  'ChessPublisher.vbs',
  'Update-FIDE.bat',
  'ChessPublisher.ico',
  'README.txt',
  'README-WEBVIEW.txt',
  'WEBVIEW-CORE-HASHES.txt',
  'WEBVIEW-VERSION.txt',
  'CHANGELOG-v1.04.01-2026-08-30.txt'
) | ForEach-Object { Copy-RepoFile $_ }

Copy-RepoFile 'LICENSE' 'LICENSE.txt'
Copy-RepoFile 'PRIVACY.md'
Copy-RepoFile 'THIRD_PARTY_NOTICES.md'
Copy-RepoFile 'SECURITY.md'

if (Test-Path -LiteralPath (Join-Path $repoRoot 'engine')) {
  Get-ChildItem -LiteralPath (Join-Path $repoRoot 'engine') -File -Force | ForEach-Object {
    $destination = Join-Path $payload ('engine\' + $_.Name)
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
  }
}
if (Test-Path -LiteralPath (Join-Path $repoRoot 'fide\README.txt')) {
  New-Item -ItemType Directory -Path (Join-Path $payload 'fide') -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $repoRoot 'fide\README.txt') -Destination (Join-Path $payload 'fide\README.txt') -Force
}

Set-Content -LiteralPath (Join-Path $payload 'VERSION.txt') -Value $Version -Encoding ASCII

# Build the small open-source launcher from public source and stamp the release version.
$launcherSource = Get-Content -LiteralPath (Join-Path $repoRoot 'src/launcher/ChessPublisherLauncher.cs') -Raw
$launcherSource = [regex]::Replace($launcherSource, 'AssemblyVersion\("[^"]+"\)', ('AssemblyVersion("' + $numericVersion + '")'))
$launcherSource = [regex]::Replace($launcherSource, 'AssemblyFileVersion\("[^"]+"\)', ('AssemblyFileVersion("' + $numericVersion + '")'))
$generatedLauncher = Join-Path $buildRoot 'ChessPublisherLauncher.release.cs'
Set-Content -LiteralPath $generatedLauncher -Value $launcherSource -Encoding UTF8

$cscCandidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw 'Microsoft .NET Framework C# compiler (csc.exe) was not found.' }

$cscArgs = @(
  '/nologo',
  '/target:winexe',
  '/optimize+',
  '/platform:anycpu',
  '/r:System.dll',
  '/r:System.Windows.Forms.dll',
  ('/out:' + (Join-Path $payload 'ChessPublisher.exe'))
)
$iconPath = Join-Path $repoRoot 'ChessPublisher.ico'
if (Test-Path -LiteralPath $iconPath) { $cscArgs += ('/win32icon:' + $iconPath) }
$cscArgs += $generatedLauncher
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "Launcher compilation failed with exit code $LASTEXITCODE." }

# Fetch pinned upstream Gacrux 1.9.57 and verify it before packaging.
& (Join-Path $repoRoot 'scripts/fetch-gacrux.ps1') -Destination (Join-Path $payload 'engine/gacrux')

$portableName = "Chess-Publisher-v$Version-$Date.zip"
$installerName = "Chess-Publisher-v$Version-$Date.exe"
$checksumName = "Chess-Publisher-v$Version-$Date-SHA256.txt"
$portablePath = Join-Path $dist $portableName
Compress-Archive -Path (Join-Path $payload '*') -DestinationPath $portablePath -CompressionLevel Optimal -Force

$isccCandidates = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
)
$iscc = $isccCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 (ISCC.exe) was not found.' }

$iss = Join-Path $repoRoot 'installer/ChessPublisher.iss'
& $iscc "/DMyVersion=$Version" "/DMyDate=$Date" "/DMyNumericVersion=$numericVersion" "/DSourceDir=$payload" "/DOutputDir=$dist" $iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE." }

$innoOutput = Join-Path $dist ("ChessPublisher-v$Version-$Date.exe")
if (-not (Test-Path -LiteralPath $innoOutput)) {
  $innoOutput = Get-ChildItem -LiteralPath $dist -Filter '*.exe' | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $innoOutput) { throw 'Installer output was not produced.' }
$installerPath = Join-Path $dist $installerName
if ($innoOutput -ne $installerPath) { Move-Item -LiteralPath $innoOutput -Destination $installerPath -Force }

$hashLines = @()
foreach ($file in @($installerPath, $portablePath)) {
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  $hashLines += "$hash  $([IO.Path]::GetFileName($file))"
}
Set-Content -LiteralPath (Join-Path $dist $checksumName) -Value $hashLines -Encoding ASCII

Write-Host 'Release artifacts:'
Get-ChildItem -LiteralPath $dist -File | ForEach-Object {
  Write-Host (' - {0} ({1:N0} bytes)' -f $_.Name, $_.Length)
}
