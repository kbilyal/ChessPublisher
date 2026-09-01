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
  throw "Version must have the form 1.05.00 (received '$Version')."
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
$iconPath = Join-Path $repoRoot 'ChessPublisher.ico'

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
  'ChessPublisher.ico',
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

$iconHash = (Get-FileHash -LiteralPath $iconPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ((Get-Item -LiteralPath $iconPath).Length -lt 1024) {
  throw 'ChessPublisher.ico is unexpectedly small; refusing to build a release.'
}
Write-Host "Release icon SHA256: $iconHash"

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

function Assert-PeHasGroupIcon {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not ('ChessPublisher.ReleaseResourceProbe' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace ChessPublisher {
  public static class ReleaseResourceProbe {
    private const uint LOAD_LIBRARY_AS_DATAFILE = 0x00000002;
    private delegate bool EnumResNameProc(IntPtr hModule, IntPtr lpszType, IntPtr lpszName, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryEx(string lpFileName, IntPtr hFile, uint dwFlags);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr hModule);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumResourceNames(IntPtr hModule, IntPtr lpszType, EnumResNameProc lpEnumFunc, IntPtr lParam);

    public static bool HasGroupIcon(string path) {
      IntPtr module = LoadLibraryEx(path, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
      if (module == IntPtr.Zero) return false;
      bool found = false;
      EnumResNameProc callback = delegate(IntPtr h, IntPtr type, IntPtr name, IntPtr param) {
        found = true;
        return false;
      };
      try {
        EnumResourceNames(module, (IntPtr)14, callback, IntPtr.Zero); // RT_GROUP_ICON
        return found;
      } finally {
        FreeLibrary(module);
      }
    }
  }
}
'@
  }

  if (-not [ChessPublisher.ReleaseResourceProbe]::HasGroupIcon($Path)) {
    throw "Release gate failed: '$Path' has no embedded RT_GROUP_ICON resource."
  }
}

# Core runtime.
Copy-RepoFile 'ChessPublisher.html'
Copy-RepoFile 'ChessPublisher-WebView.ps1'
Copy-RepoFile 'ChessPublisher-LocalEngine.ps1'
Copy-RepoFile 'FIDE-Update.ps1'
Copy-RepoFile 'webview/WebViewAdapter.js'
Copy-RepoFile 'ChessPublisher.ico'

# Launch helpers and documentation are included when they exist in the public source tree.
@(
  'ChessPublisher-WebView.bat',
  'ChessPublisher-WebView-Debug.bat',
  'ChessPublisher.bat',
  'ChessPublisher.vbs',
  'Update-FIDE.bat',
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

# Build the small open-source launcher from tagged source, stamp the release version,
# and embed the mandatory Chess-Publisher application icon.
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

$launcherExe = Join-Path $payload 'ChessPublisher.exe'
$cscArgs = @(
  '/nologo',
  '/target:winexe',
  '/optimize+',
  '/platform:anycpu',
  '/r:System.dll',
  '/r:System.Windows.Forms.dll',
  ('/win32icon:' + $iconPath),
  ('/out:' + $launcherExe),
  $generatedLauncher
)
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "Launcher compilation failed with exit code $LASTEXITCODE." }
Assert-PeHasGroupIcon -Path $launcherExe
Write-Host 'PASS - ChessPublisher.exe contains an embedded application icon.'

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
& $iscc "/DMyVersion=$Version" "/DMyDate=$Date" "/DMyNumericVersion=$numericVersion" "/DSourceDir=$payload" "/DOutputDir=$dist" "/DReleaseIcon=$iconPath" $iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE." }

$innoOutput = Join-Path $dist ("Chess-Publisher-v$Version-$Date.exe")
if (-not (Test-Path -LiteralPath $innoOutput)) {
  $innoOutput = Get-ChildItem -LiteralPath $dist -Filter '*.exe' | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $innoOutput) { throw 'Installer output was not produced.' }
$installerPath = Join-Path $dist $installerName
if ($innoOutput -ne $installerPath) { Move-Item -LiteralPath $innoOutput -Destination $installerPath -Force }
Assert-PeHasGroupIcon -Path $installerPath
Write-Host 'PASS - Inno Setup installer contains an embedded icon resource.'

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
