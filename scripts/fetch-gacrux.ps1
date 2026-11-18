param(
  [string]$Destination = (Join-Path $PSScriptRoot '..\build\payload\engine\gacrux')
)
$ErrorActionPreference = 'Stop'
$version = '1.11.65'
$url = 'https://github.com/santino/vesus-pairings-desktop/releases/download/gacrux-v1.11.65/pairingchecker-windows-x64.zip'
$expected = 'e3861ed88fca45181965c2633065c2586569843f79a56f9161ec85ebec1b3aa5'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('ChessPublisher-Gacrux-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $zip = Join-Path $temp 'pairingchecker-windows-x64.zip'
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Gacrux archive SHA-256 mismatch. Expected $expected, got $actual" }
  $unpack = Join-Path $temp 'unpack'
  Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
  if (Test-Path $Destination) { Remove-Item -Recurse -Force $Destination }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  $items = Get-ChildItem -LiteralPath $unpack -Force
  if ($items.Count -eq 1 -and $items[0].PSIsContainer) {
    Copy-Item -Path (Join-Path $items[0].FullName '*') -Destination $Destination -Recurse -Force
  } else {
    Copy-Item -Path (Join-Path $unpack '*') -Destination $Destination -Recurse -Force
  }
  $exe = Get-ChildItem -LiteralPath $Destination -Filter 'pairingchecker.exe' -Recurse | Select-Object -First 1
  if (-not $exe) { throw 'pairingchecker.exe was not found in the verified Gacrux release archive.' }
  if ($exe.DirectoryName -ne $Destination) {
    $nestedRoot = $exe.DirectoryName
    Copy-Item -Path (Join-Path $nestedRoot '*') -Destination $Destination -Recurse -Force
  }
  Write-Host "Gacrux $version prepared from pinned upstream archive."
} finally {
  Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
}
