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
  throw "Version must have the form 1.03.96 (received '$Version')."
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
  'WEBVIEW-VERSION.txt'
) | ForEach-Object { Copy-RepoFile $_ }

Copy-RepoFile 'LICENSE' 'LICENSE.txt'
Copy-RepoFile 'PRIVACY.md'
Copy-RepoFile 'THIRD_PARTY_NOTICES.md'
Copy-RepoFile 'SECURITY.md'

if (Test-Path -LiteralPath (Join-Path $repoRoot 'engine')) {
  Get-ChildItem -LiteralPath (Join-Path $repoRoot 'engine') -File -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $payload ('engine\' + $_.Name)) -Force
  }
}

Set-Content -LiteralPath (Join-Path $payload 'VERSION.txt') -Value $Version -Encoding ASCII

# Build the small open-source launcher from the tagged source and stamp the release version.
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

# Fetch the pinned upstream Gacrux 1.9.57 archive and verify its SHA-256 before packaging.
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
