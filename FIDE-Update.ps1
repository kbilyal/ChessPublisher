<#
  Chess-Publisher Windows Integrated Rating Lists updater
  beta.72: staged all-or-nothing source refresh for Standard/Rapid/Blitz + LEGACY.
  Active searchable generation is committed atomically by ChessPublisher-Beta72-RatingLists.js.
#>

[CmdletBinding()]
param(
  [ValidateRange(1, 10)]
  [int]$RetryCount = 5,
  [ValidateRange(30, 900)]
  [int]$TimeoutSeconds = 240
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$fideFolder = Join-Path $scriptRoot 'fide'
$userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ChessPublisher-RatingLists-Updater/2.0'
$generationId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$stagingRoot = Join-Path $fideFolder ('.staging-' + $generationId)

$downloads = @(
  @{ Name = 'Standard'; FileName = 'standard_rating_list.zip'; TextFileName = 'standard.txt'; Url = 'https://ratings.fide.com/download/standard_rating_list.zip' },
  @{ Name = 'Rapid'; FileName = 'rapid_rating_list.zip'; TextFileName = 'rapid.txt'; Url = 'https://ratings.fide.com/download/rapid_rating_list.zip' },
  @{ Name = 'Blitz'; FileName = 'blitz_rating_list.zip'; TextFileName = 'blitz.txt'; Url = 'https://ratings.fide.com/download/blitz_rating_list.zip' },
  @{ Name = 'Players LEGACY (all, incl. unrated)'; FileName = 'players_list_legacy.zip'; TextFileName = 'players_legacy.txt'; EntryPattern = '\.txt$'; Url = 'https://ratings.fide.com/download/players_list_legacy.zip' }
)

function Write-Status([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Gray) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message) -ForegroundColor $Color
}

function Test-ZipFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  if ((Get-Item -LiteralPath $Path).Length -lt 1024) { return $false }
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try { return $zip.Entries.Count -gt 0 }
    finally { $zip.Dispose() }
  } catch { return $false }
}

function Get-StagedFideFile($Item) {
  $zipPath = Join-Path $stagingRoot $Item.FileName
  $textPath = Join-Path $stagingRoot $Item.TextFileName
  $part = "$zipPath.part"

  for ($attempt = 1; $attempt -le $RetryCount; $attempt++) {
    try {
      Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
      Write-Status ("{0}: staging download (attempt {1}/{2})..." -f $Item.Name, $attempt, $RetryCount) Cyan
      
      $wc = New-Object System.Net.WebClient
      try {
        $wc.Headers.Add('User-Agent', $userAgent)
        $wc.Headers.Add('Accept', 'application/zip,application/octet-stream,*/*')
        $wc.DownloadFile($Item.Url, $part)
      } finally {
        $wc.Dispose()
      }
      if (-not (Test-ZipFile $part)) { throw 'The downloaded payload is empty or is not a valid ZIP archive.' }
      Move-Item -LiteralPath $part -Destination $zipPath -Force

      $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
      try {
        $entryPattern = if ($Item.EntryPattern) { [string]$Item.EntryPattern } else { '\.txt$' }
        $entry = @($zip.Entries | Where-Object { $_.Name -match $entryPattern } | Sort-Object Length -Descending | Select-Object -First 1)[0]
        if ($null -eq $entry) { throw 'The ZIP archive does not contain the expected FIDE text payload.' }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $textPath, $true)
      } finally { $zip.Dispose() }

      if (-not (Test-Path -LiteralPath $textPath -PathType Leaf)) { throw 'The extracted rating-list payload is missing.' }
      if ((Get-Item -LiteralPath $textPath).Length -lt 1024) { throw 'The extracted rating-list payload is too small.' }
      Write-Status ("{0}: staged and validated." -f $Item.Name) Green
      return
    } catch {
      Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $textPath -Force -ErrorAction SilentlyContinue
      $reason = $_.Exception.Message
      if ($attempt -lt $RetryCount) {
        $wait = [math]::Min(60, 5 * [math]::Pow(2, $attempt - 1))
        Write-Status ("{0}: failed - {1}. Retrying in {2} seconds..." -f $Item.Name, $reason, $wait) Yellow
        Start-Sleep -Seconds $wait
      } else { throw ("{0}: FAILED after {1} attempts - {2}" -f $Item.Name, $RetryCount, $reason) }
    }
  }
}

function Promote-StagedGeneration {
  $backups = @()
  $promoted = @()
  try {
    foreach ($item in $downloads) {
      foreach ($name in @($item.FileName, $item.TextFileName)) {
        $source = Join-Path $stagingRoot $name
        $dest = Join-Path $fideFolder $name
        $backup = "$dest.pre-beta72"
        Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $dest -PathType Leaf) {
          Move-Item -LiteralPath $dest -Destination $backup -Force
          $backups += [pscustomobject]@{ Dest = $dest; Backup = $backup }
        }
        Move-Item -LiteralPath $source -Destination $dest -Force
        $promoted += $dest
      }
    }
    foreach ($b in $backups) { Remove-Item -LiteralPath $b.Backup -Force -ErrorAction SilentlyContinue }
  } catch {
    foreach ($dest in $promoted) { Remove-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue }
    foreach ($b in $backups) {
      if (Test-Path -LiteralPath $b.Backup -PathType Leaf) { Move-Item -LiteralPath $b.Backup -Destination $b.Dest -Force }
    }
    throw
  }
}

Write-Host ''
Write-Host 'Chess-Publisher - Integrated Rating Lists staged updater' -ForegroundColor White -BackgroundColor DarkBlue
Write-Status "Target folder: $fideFolder"
Write-Status "Staging generation: $generationId"
New-Item -ItemType Directory -Path $fideFolder -Force | Out-Null
Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

try {
  # No active flat-file source is touched until every requested payload is downloaded,
  # ZIP-validated and extracted successfully in the staging generation.
  foreach ($item in $downloads) { Get-StagedFideFile $item }

  # Validate that the complete requested generation is present before promotion.
  foreach ($item in $downloads) {
    foreach ($name in @($item.FileName, $item.TextFileName)) {
      $path = Join-Path $stagingRoot $name
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Staging generation is incomplete: $name is missing." }
    }
  }

  Promote-StagedGeneration
  Write-Status 'Source generation promoted: Standard, Rapid, Blitz and Players LEGACY are complete.' Green

  # Pre-build fast C# binary index for instant search and instant loading
  $fideIndexCs = Join-Path (Join-Path $scriptRoot 'engine') 'FideIndex.cs'
  if (Test-Path -LiteralPath $fideIndexCs) {
    try {
      Add-Type -Path $fideIndexCs -ErrorAction SilentlyContinue
      if ('CP.FideIndex' -as [type]) {
        Write-Status 'Building fast in-memory FIDE index...' Cyan
        [CP.FideIndex]::Reload($fideFolder)
        [CP.RatingsIndex]::EnsureBuilt($fideFolder) | Out-Null
        Write-Status ('FIDE search index ready: {0} players' -f [CP.FideIndex]::Count) Green
      }
    } catch {
      Write-Status ('Index pre-build warning: ' + $_.Exception.Message) Yellow
    }
  }

  Write-Status 'Chess-Publisher will parse/index all rating lists and atomically activate its local database only after full integrity checks.' Green
  exit 0
} catch {
  $reason = $_.Exception.Message
  Write-Status ("ROLLED BACK / NOT ACTIVATED: {0}" -f $reason) Red
  Write-Status 'The previous complete local source files and active rating-list database remain in use.' Yellow
  exit 1
} finally {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
}
