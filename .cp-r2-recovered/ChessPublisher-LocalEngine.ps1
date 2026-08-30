param(
  [int]$Port = 18765,
  [int]$IdleTimeoutMinutes = 5
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$gacrux = Join-Path $root 'engine\gacrux\pairingchecker.exe'
$fideFolder = Join-Path $root 'fide'
$fideUpdater = Join-Path $root 'FIDE-Update.ps1'
$htmlFile = Join-Path $root 'ChessPublisher.html'
$stateFile = Join-Path $root 'ChessPublisher-data.json'

# User tournament files live outside the application directory so installing or
# upgrading ChessPublisher can never replace them.  Use the Windows known-folder
# API instead of assuming that Documents is literally named "Documents" (it may
# be redirected by OneDrive, Group Policy or localization).
$documentsRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)
if ([string]::IsNullOrWhiteSpace($documentsRoot)) {
  $documentsRoot = Join-Path $env:USERPROFILE 'Documents'
}
$tournamentsRoot = Join-Path $documentsRoot 'ChessPublisher Tournaments'
$legacyTournamentsRoot = Join-Path $root 'Tournaments'

$settingsRoot = Join-Path $root 'Settings'
$recentFile = Join-Path $settingsRoot 'recent-tournaments.json'
$logFile = Join-Path $root 'ChessPublisher-engine.log'
New-Item -ItemType Directory -Path $tournamentsRoot -Force | Out-Null
New-Item -ItemType Directory -Path $settingsRoot -Force | Out-Null

# One-way, non-destructive migration from older portable builds.  Existing files
# in My Documents win; legacy files are copied only when the destination does not
# already exist.  The old folder is intentionally left untouched as a backup.
if ((Test-Path -LiteralPath $legacyTournamentsRoot) -and
    -not [string]::Equals($legacyTournamentsRoot, $tournamentsRoot, [StringComparison]::OrdinalIgnoreCase)) {
  try {
    foreach ($legacyItem in @(Get-ChildItem -LiteralPath $legacyTournamentsRoot -Force -ErrorAction SilentlyContinue)) {
      $targetItem = Join-Path $tournamentsRoot $legacyItem.Name
      if (-not (Test-Path -LiteralPath $targetItem)) {
        Copy-Item -LiteralPath $legacyItem.FullName -Destination $targetItem -Recurse -Force -ErrorAction Stop
      }
    }
  } catch {
    # Migration must never prevent the tournament service from starting.
  }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
$serviceVersion = 'V138'

# Independent Dutch 2026 verifier. Gacrux remains the ONLY pairing generator.
# bbpPairings is downloaded from the upstream GitHub release only on explicit
# user request, verified against the published v6.0.0 release SHA256, and kept
# under Settings so a venue without Internet never affects normal pairing.
$bbpVersion = '6.0.0'
$bbpReleaseUrl = 'https://github.com/BieremaBoyzProgramming/bbpPairings/releases/download/v6.0.0/bbpPairings-v6.0.0-x86_64-pc-windows.zip'
$bbpReleaseSha256 = 'D2BFC61CBD291A5458F18ADCCB43B19B6F1BE40A9C0CC86A5142B605298DC0D7'
$bbpRoot = Join-Path $settingsRoot 'bbpPairings-v6.0.0'
$bbpExe = Join-Path $bbpRoot 'bbpPairings.exe'
$bbpInstallMarker = Join-Path $bbpRoot 'ChessPublisher-install.json'
$script:bbpInstallError = ''

# Official FIDE/Gacrux Tie-Break Checker. It is a separate upstream executable
# from the pairingchecker runtime and is downloaded only on explicit user action.
# It never generates or changes pairings/results; it only validates the ranks in
# a completed TRF against the selected FIDE tie-break descriptors.
$tieBreakCheckerVersion = '1.9.57'
$tieBreakCheckerReleaseUrl = 'https://github.com/santino/vesus-pairings-desktop/releases/download/gacrux-v1.9.57/tiebreakchecker-windows-x64.zip'
$tieBreakCheckerReleaseSha256 = '6FAC8F6E344BF79890C38AB302D22AB9E242A556239320438C6200334B642C93'
$tieBreakCheckerRoot = Join-Path $settingsRoot 'gacrux-tiebreakchecker-v1.9.57'
$tieBreakCheckerExe = Join-Path $tieBreakCheckerRoot 'tiebreakchecker.exe'
$tieBreakCheckerInstallMarker = Join-Path $tieBreakCheckerRoot 'ChessPublisher-install.json'
$script:tieBreakCheckerInstallError = ''

# Official Chess-Results XML interface credentials assigned to ChessPublisher.
# IMPORTANT: these values are intentionally kept in the local Windows service,
# never in ChessPublisher.html or JavaScript. Keep this package private.
$chessResultsEndpoint = 'https://chess-results.com/UploadXML.aspx'
$chessResultsSourceId = 21
$chessResultsCreatorId = 100
[byte[]]$chessResultsAesIv = @(__CP_CR_AES_IV_BYTES__)
[byte[]]$chessResultsAesKey = @(__CP_CR_AES_KEY_BYTES__)
$chessResultsRecoveryFile = Join-Path $settingsRoot 'chessresults-key-recovery.json'
$chessResultsInvalidKeyFile = Join-Path $settingsRoot 'chessresults-invalid-key-evidence.json'



function Protect-ChessResultsValue([string]$Value) {
  if ($null -eq $Value) { $Value = '' }
  $aes = New-Object System.Security.Cryptography.AesManaged
  try {
    $aes.KeySize = 128
    $aes.BlockSize = 128
    $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
    $aes.Key = $chessResultsAesKey
    $aes.IV = $chessResultsAesIv
    $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$Value)
    $encryptor = $aes.CreateEncryptor()
    try {
      $encrypted = $encryptor.TransformFinalBlock($bytes, 0, $bytes.Length)
    } finally {
      $encryptor.Dispose()
    }
    return ([System.BitConverter]::ToString($encrypted)).Replace('-', '')
  } finally {
    $aes.Clear()
    $aes.Dispose()
  }
}

function New-ChessResultsWebClient {
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  $client = New-Object System.Net.WebClient
  $client.Encoding = [System.Text.Encoding]::UTF8
  $client.Headers['User-Agent'] = 'ChessPublisher/1.94 (Chess-Results XML Source 21)'
  return $client
}

function Get-ChessResultsResponseError([xml]$Document, [string]$Fallback) {
  try {
    $messages = @($Document.SelectNodes('//message'))
    $parts = @()
    foreach ($message in $messages) {
      $text = [string]$message.GetAttribute('Text')
      if ([string]::IsNullOrWhiteSpace($text)) { $text = [string]$message.InnerText }
      if (-not [string]::IsNullOrWhiteSpace($text)) { $parts += $text.Trim() }
    }
    if ($parts.Count -gt 0) { return ($parts -join '; ') }
  } catch {}
  return $Fallback
}

function Invoke-ChessResultsGetSid {
  $url = '{0}?key1=GETSID&source={1}' -f $chessResultsEndpoint, $chessResultsSourceId
  $client = New-ChessResultsWebClient
  try {
    $raw = $client.DownloadString($url)
  } finally {
    $client.Dispose()
  }
  if ([string]::IsNullOrWhiteSpace($raw)) { throw 'Chess-Results GETSID returned an empty response.' }
  try { [xml]$doc = $raw } catch { throw "Chess-Results GETSID returned invalid XML: $($_.Exception.Message)" }
  $result = $doc.SelectSingleNode('/chessresults/result')
  if ($null -eq $result) { throw 'Chess-Results GETSID response does not contain /chessresults/result.' }
  $status = [string]$result.GetAttribute('status')
  if ($status -ne 'OK') { throw (Get-ChessResultsResponseError $doc 'Chess-Results GETSID returned ERROR.') }
  $sid = [string]$result.GetAttribute('sid')
  if ([string]::IsNullOrWhiteSpace($sid)) { throw 'Chess-Results GETSID did not return a SID.' }
  $encrypted = Protect-ChessResultsValue $sid

  # In test mode the server returns sidEncrypt. Use it as an automatic
  # end-to-end check that ChessPublisher's owner-provided AES parameters match.
  $serverEncrypted = [string]$result.GetAttribute('sidEncrypt')
  if (-not [string]::IsNullOrWhiteSpace($serverEncrypted)) {
    if ($encrypted.ToUpperInvariant() -ne $serverEncrypted.Trim().ToUpperInvariant()) {
      throw 'Chess-Results AES verification failed: locally encrypted SID does not match sidEncrypt.'
    }
  }

  return [pscustomobject]@{
    Sid = $sid
    EncryptedSid = $encrypted
    Verified = -not [string]::IsNullOrWhiteSpace($serverEncrypted)
  }
}

function ConvertTo-ChessResultsTransportXml([string]$Xml) {
  if ([string]::IsNullOrWhiteSpace($Xml)) { throw 'Chess-Results XML is empty.' }
  # The official VB.NET example replaces angle brackets before UploadValues.
  return $Xml.Replace('<', '{').Replace('>', '}')
}

function Invoke-ChessResultsXmlPost([string]$Url, [string]$Xml) {
  $client = New-ChessResultsWebClient
  $data = New-Object System.Collections.Specialized.NameValueCollection
  $data.Add('xml', (ConvertTo-ChessResultsTransportXml $Xml))
  try {
    $bytes = $client.UploadValues($Url, 'POST', $data)
    return [System.Text.Encoding]::UTF8.GetString($bytes)
  } finally {
    $client.Dispose()
  }
}

function ConvertFrom-ChessResultsResponse([string]$Raw, [string]$Operation) {
  if ([string]::IsNullOrWhiteSpace($Raw)) { throw "Chess-Results $Operation returned an empty response." }
  try { [xml]$doc = $Raw } catch { throw "Chess-Results $Operation returned invalid XML: $($_.Exception.Message)" }
  $result = $doc.SelectSingleNode('/chessresults/result')
  if ($null -eq $result) { throw "Chess-Results $Operation response does not contain /chessresults/result." }
  $status = [string]$result.GetAttribute('status')
  if ($status -ne 'OK') {
    throw (Get-ChessResultsResponseError $doc "Chess-Results $Operation returned ERROR.")
  }
  return [pscustomobject]@{ Document = $doc; Result = $result; Raw = $Raw }
}

function Get-ChessResultsKeyRecovery([string]$ClientId) {
  try {
    $client = ([string]$ClientId).Trim()
    if ([string]::IsNullOrWhiteSpace($client)) { return $null }
    if (-not (Test-Path -LiteralPath $chessResultsRecoveryFile)) { return $null }
    $raw = Get-Content -LiteralPath $chessResultsRecoveryFile -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    $items = @($raw | ConvertFrom-Json)
    $match = @($items | Where-Object {
      ([string]$_.clientId).Trim() -eq $client -and
      ([string]$_.key) -match '^\d+$' -and
      ([int]$_.sourceId) -eq $chessResultsSourceId -and
      ([int]$_.creatorId) -eq $chessResultsCreatorId
    } | Select-Object -First 1)
    if ($match.Count -gt 0) { return $match[0] }
  } catch {
    Write-EngineLog "Chess-Results key recovery read failed: $($_.Exception.Message)"
  }
  return $null
}

function Get-ChessResultsKeyRecoveryByKey([string]$Key) {
  try {
    $keyValue = ([string]$Key).Trim()
    if ($keyValue -notmatch '^\d+$') { return $null }
    if (-not (Test-Path -LiteralPath $chessResultsRecoveryFile)) { return $null }
    $raw = Get-Content -LiteralPath $chessResultsRecoveryFile -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    $items = @($raw | ConvertFrom-Json)
    $match = @($items | Where-Object {
      ([string]$_.key).Trim() -eq $keyValue -and
      ([int]$_.sourceId) -eq $chessResultsSourceId -and
      ([int]$_.creatorId) -eq $chessResultsCreatorId
    } | Select-Object -First 1)
    if ($match.Count -gt 0) { return $match[0] }
  } catch {}
  return $null
}

function Save-ChessResultsKeyRecovery([string]$Tournament, [string]$Federation, [string]$Mode, [string]$Key, [string]$ClientId) {
  try {
    $items = @()
    if (Test-Path -LiteralPath $chessResultsRecoveryFile) {
      $raw = Get-Content -LiteralPath $chessResultsRecoveryFile -Raw -ErrorAction SilentlyContinue
      if ($raw) { $items = @($raw | ConvertFrom-Json) }
    }
    $client = ([string]$ClientId).Trim()
    $entry = [pscustomobject]@{
      createdAt = [DateTime]::UtcNow.ToString('o')
      tournament = $Tournament
      federation = $Federation
      mode = $Mode
      key = $Key
      clientId = $client
      sourceId = $chessResultsSourceId
      creatorId = $chessResultsCreatorId
    }
    if (-not [string]::IsNullOrWhiteSpace($client)) {
      $items = @($entry) + @($items | Where-Object { ([string]$_.clientId).Trim() -ne $client -and [string]$_.key -ne $Key })
    } else {
      $items = @($entry) + @($items | Where-Object { [string]$_.key -ne $Key })
    }
    $items = @($items | Select-Object -First 20)
    [System.IO.File]::WriteAllText($chessResultsRecoveryFile, ($items | ConvertTo-Json -Depth 5), $utf8NoBom)
  } catch {
    Write-EngineLog "Chess-Results key recovery save failed: $($_.Exception.Message)"
  }
}

function Remove-ChessResultsKeyRecovery([string]$Key, [string]$ClientId) {
  $keyValue = ([string]$Key).Trim()
  $client = ([string]$ClientId).Trim()
  if ($keyValue -notmatch '^\d+$') { throw 'Chess-Results tournament key must be numeric.' }

  try {
    if (-not (Test-Path -LiteralPath $chessResultsRecoveryFile)) { return $false }
    $raw = Get-Content -LiteralPath $chessResultsRecoveryFile -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($raw)) { return $false }
    $items = @($raw | ConvertFrom-Json)
    $before = $items.Count
    $items = @($items | Where-Object {
      $sameKey = ([string]$_.key).Trim() -eq $keyValue
      $sameClient = (-not [string]::IsNullOrWhiteSpace($client)) -and (([string]$_.clientId).Trim() -eq $client)
      -not ($sameKey -or $sameClient)
    })
    if ($items.Count -eq 0) {
      if (Test-Path -LiteralPath $chessResultsRecoveryFile) { Remove-Item -LiteralPath $chessResultsRecoveryFile -Force }
    } else {
      [System.IO.File]::WriteAllText($chessResultsRecoveryFile, ($items | ConvertTo-Json -Depth 5), $utf8NoBom)
    }
    return ($items.Count -lt $before)
  } catch {
    throw "Could not remove the Chess-Results recovery mapping: $($_.Exception.Message)"
  }
}

function Test-ChessResultsStoredTnrRejection([string]$Message) {
  $text = ([string]$Message).Trim()
  if ([string]::IsNullOrWhiteSpace($text)) { return $false }
  if ($text -match '(?i)Source-ID\s*\([^)]*Tournament[^)]*\)\s*not\s+valid') { return $true }
  if ($text -match '(?i)Source-ID\s+Tournament\s*\(0\)\s*different\s+from\s+Upload-Parameter\s*\(21\)') { return $true }
  if ($text -match '(?i)database\s*key[^;:.]{0,80}(?:not\s+valid|invalid|not\s+found|does\s+not\s+exist)') { return $true }
  return $false
}

function Save-ChessResultsInvalidKeyEvidence([string]$Key, [string]$ClientId, [string]$Message) {
  $keyValue = ([string]$Key).Trim()
  $client = ([string]$ClientId).Trim()
  $messageValue = ([string]$Message).Trim()
  if ($keyValue -notmatch '^\d+$' -or -not (Test-ChessResultsStoredTnrRejection $messageValue)) { return }
  try {
    $items = @()
    if (Test-Path -LiteralPath $chessResultsInvalidKeyFile) {
      $raw = Get-Content -LiteralPath $chessResultsInvalidKeyFile -Raw -ErrorAction SilentlyContinue
      if ($raw) { $items = @($raw | ConvertFrom-Json) }
    }
    $entry = [pscustomobject]@{
      createdAt = [DateTime]::UtcNow.ToString('o')
      key = $keyValue
      clientId = $client
      sourceId = $chessResultsSourceId
      message = $messageValue
    }
    $items = @($entry) + @($items | Where-Object {
      ([string]$_.key).Trim() -ne $keyValue -and
      ([string]$_.clientId).Trim() -ne $client
    })
    $items = @($items | Select-Object -First 20)
    [System.IO.File]::WriteAllText($chessResultsInvalidKeyFile, ($items | ConvertTo-Json -Depth 5), $utf8NoBom)
    Write-EngineLog "Chess-Results stale-TNR evidence recorded for TNR $keyValue."
  } catch {
    Write-EngineLog "Chess-Results stale-TNR evidence save failed: $($_.Exception.Message)"
  }
}

function Get-ChessResultsInvalidKeyEvidence([string]$Key, [string]$ClientId) {
  $keyValue = ([string]$Key).Trim()
  $client = ([string]$ClientId).Trim()
  if ($keyValue -notmatch '^\d+$' -or -not (Test-Path -LiteralPath $chessResultsInvalidKeyFile)) { return $null }
  try {
    $raw = Get-Content -LiteralPath $chessResultsInvalidKeyFile -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    $items = @($raw | ConvertFrom-Json)
    $match = @($items | Where-Object {
      ([string]$_.key).Trim() -eq $keyValue -and
      ([int]$_.sourceId) -eq $chessResultsSourceId -and
      ([string]$_.clientId).Trim() -eq $client -and
      (Test-ChessResultsStoredTnrRejection ([string]$_.message))
    } | Select-Object -First 1)
    if ($match.Count -gt 0) { return $match[0] }
  } catch {
    Write-EngineLog "Chess-Results stale-TNR evidence read failed: $($_.Exception.Message)"
  }
  return $null
}

function Remove-ChessResultsInvalidKeyEvidence([string]$Key, [string]$ClientId) {
  $keyValue = ([string]$Key).Trim()
  $client = ([string]$ClientId).Trim()
  try {
    if (-not (Test-Path -LiteralPath $chessResultsInvalidKeyFile)) { return }
    $raw = Get-Content -LiteralPath $chessResultsInvalidKeyFile -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($raw)) { return }
    $items = @($raw | ConvertFrom-Json)
    $items = @($items | Where-Object {
      -not (([string]$_.key).Trim() -eq $keyValue -or (([string]$_.clientId).Trim() -eq $client -and -not [string]::IsNullOrWhiteSpace($client)))
    })
    if ($items.Count -eq 0) {
      Remove-Item -LiteralPath $chessResultsInvalidKeyFile -Force -ErrorAction SilentlyContinue
    } else {
      [System.IO.File]::WriteAllText($chessResultsInvalidKeyFile, ($items | ConvertTo-Json -Depth 5), $utf8NoBom)
    }
  } catch {
    Write-EngineLog "Chess-Results stale-TNR evidence cleanup failed: $($_.Exception.Message)"
  }
}

function Test-ChessResultsTournamentPublicState([string]$Key) {
  $keyValue = ([string]$Key).Trim()
  if ($keyValue -notmatch '^\d+$') { throw 'Chess-Results tournament key must be numeric.' }

  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  $url = 'https://chess-results.com/tnr{0}.aspx?lan=1' -f $keyValue
  $request = [System.Net.HttpWebRequest]::Create($url)
  $request.Method = 'GET'
  $request.AllowAutoRedirect = $true
  $request.MaximumAutomaticRedirections = 8
  $request.UserAgent = 'ChessPublisher/1.94 (Chess-Results deletion verification)'
  $request.Timeout = 15000
  $request.ReadWriteTimeout = 15000
  try {
    $request.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
  } catch {}

  $response = $null
  try {
    try {
      $response = $request.GetResponse()
    } catch [System.Net.WebException] {
      if ($null -ne $_.Exception.Response) {
        $response = $_.Exception.Response
      } else {
        throw "Could not contact Chess-Results to verify TNR ${keyValue}: $($_.Exception.Message)"
      }
    }

    $statusCode = 0
    try { $statusCode = [int]$response.StatusCode } catch {}
    $finalUrl = ''
    try { $finalUrl = [string]$response.ResponseUri.AbsoluteUri } catch {}
    $body = ''
    try {
      $stream = $response.GetResponseStream()
      if ($null -ne $stream) {
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $true)
        try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
      }
    } catch {
      throw "Chess-Results answered, but the verification page could not be read: $($_.Exception.Message)"
    }
  } finally {
    if ($null -ne $response) { try { $response.Close() } catch {} }
  }

  if ($statusCode -eq 404 -or $statusCode -eq 410) {
    return [pscustomobject]@{
      Exists = $false
      ConfirmedDeleted = $true
      Reason = "Chess-Results returned HTTP $statusCode for TNR $keyValue."
      PublicUrl = $url
      FinalUrl = $finalUrl
      HttpStatus = $statusCode
    }
  }

  if ($statusCode -lt 200 -or $statusCode -ge 300) {
    return [pscustomobject]@{
      Exists = $null
      ConfirmedDeleted = $false
      Reason = "Chess-Results returned HTTP $statusCode. Deletion cannot be confirmed safely."
      PublicUrl = $url
      FinalUrl = $finalUrl
      HttpStatus = $statusCode
    }
  }

  $decoded = [System.Net.WebUtility]::HtmlDecode([string]$body)
  $flat = ($decoded -replace '[\r\n\t]+',' ' -replace '\s+',' ').Trim()
  $lower = $flat.ToLowerInvariant()
  $finalLower = ([string]$finalUrl).ToLowerInvariant()
  $tnrToken = ('tnr{0}.aspx' -f $keyValue).ToLowerInvariant()

  # Positive deletion signals.  Unlink is allowed only when one of these is observed.
  $missingPatterns = @(
    'tournament\s+(?:was\s+)?not\s+found',
    'tournament\s+does\s+not\s+exist',
    'no\s+tournament\s+(?:was\s+)?found',
    'database\s*key[^<]{0,80}(?:not\s+found|does\s+not\s+exist|invalid)',
    'turnier[^<]{0,80}nicht\s+gefunden',
    'turnier[^<]{0,80}existiert\s+nicht',
    'kein\s+turnier[^<]{0,80}gefunden'
  )
  foreach ($pattern in $missingPatterns) {
    if ($lower -match $pattern) {
      return [pscustomobject]@{
        Exists = $false
        ConfirmedDeleted = $true
        Reason = "Chess-Results reports that TNR $keyValue does not exist."
        PublicUrl = $url
        FinalUrl = $finalUrl
        HttpStatus = $statusCode
      }
    }
  }

  # A missing/deleted TNR commonly resolves back to a generic Chess-Results page.
  if ($finalLower -match '/(?:default|turniersuche)\.aspx' -and $finalLower -notmatch ([regex]::Escape($tnrToken))) {
    return [pscustomobject]@{
      Exists = $false
      ConfirmedDeleted = $true
      Reason = "Chess-Results redirected TNR $keyValue to a generic page."
      PublicUrl = $url
      FinalUrl = $finalUrl
      HttpStatus = $statusCode
    }
  }

  # Strong existence signals.  If any are present, deny Unlink.
  $hasTnrLink = $lower.Contains($tnrToken)
  $hasTournamentServer = $lower.Contains('chess-tournament-results-server') -or $lower.Contains('schachturnier-ergebnisserver')
  $hasTournamentContent = $lower.Contains('starting rank') -or $lower.Contains('starting rank list') -or $lower.Contains('final ranking') -or $lower.Contains('round ') -or $lower.Contains('tournament details') -or $lower.Contains('startrangliste') -or $lower.Contains('endstand')
  $finalIsRequestedTnr = $finalLower.Contains($tnrToken)

  if ($hasTnrLink -or ($finalIsRequestedTnr -and $hasTournamentServer -and $hasTournamentContent)) {
    return [pscustomobject]@{
      Exists = $true
      ConfirmedDeleted = $false
      Reason = "TNR $keyValue is still available on Chess-Results."
      PublicUrl = $url
      FinalUrl = $finalUrl
      HttpStatus = $statusCode
    }
  }

  # Never infer deletion from an ambiguous page or a transient server response.
  return [pscustomobject]@{
    Exists = $null
    ConfirmedDeleted = $false
    Reason = "The Chess-Results response was inconclusive. The existing TNR is kept for safety."
    PublicUrl = $url
    FinalUrl = $finalUrl
    HttpStatus = $statusCode
  }
}

function New-ChessResultsKey([string]$Tournament, [string]$Federation, [string]$Mode, [string]$ClientId) {
  $name = ([string]$Tournament).Trim()
  if ([string]::IsNullOrWhiteSpace($name)) { throw 'Tournament name is required for Chess-Results GETKEY.' }
  if ($name.Length -gt 160) { $name = $name.Substring(0,160) }
  $modeValue = ([string]$Mode).Trim().ToLowerInvariant()
  if ($modeValue -ne 'real' -and $modeValue -ne 'test') { throw 'Chess-Results tournament mode must be real or test.' }
  $fed = ([string]$Federation).Trim().ToUpperInvariant()
  if ($modeValue -eq 'test') { $fed = 'XXX' }
  if ($fed -notmatch '^[A-Z]{3}$') { throw 'Chess-Results federation must be a 3-letter FIDE code.' }

  $client = ([string]$ClientId).Trim()
  if ($client.Length -gt 160) { throw 'Chess-Results local tournament identity is too long.' }

  # Idempotency guard: if this exact local tournament already received a key, reuse it
  # instead of calling GETKEY again. This protects against UI/app interruption after key assignment.
  if (-not [string]::IsNullOrWhiteSpace($client)) {
    $recovery = Get-ChessResultsKeyRecovery $client
    if ($null -ne $recovery) {
      $recoveredKey = [string]$recovery.key
      $recoveryMode = ([string]$recovery.mode).Trim().ToLowerInvariant()
      $recoveryFed = ([string]$recovery.federation).Trim().ToUpperInvariant()
      if ($recoveryMode -ne $modeValue -or $recoveryFed -ne $fed) {
        throw "Chess-Results recovery mismatch for TNR $recoveredKey. The saved safety mapping belongs to mode '$recoveryMode' / federation '$recoveryFed', but the current request is '$modeValue' / '$fed'. Restore the original tournament type/federation before recovery; a new GETKEY was NOT requested."
      }
      Write-EngineLog "Chess-Results GETKEY skipped: recovered TNR $recoveredKey for local tournament $client."
      return [pscustomobject]@{ Key = $recoveredKey; Federation = $fed; Mode = $modeValue; SidVerified = $false; Recovered = $true }
    }
  }

  $sid = Invoke-ChessResultsGetSid
  $escapedName = [System.Security.SecurityElement]::Escape($name)
  $escapedFed = [System.Security.SecurityElement]::Escape($fed)
  $xml = @"
<?xml version="1.0" encoding="UTF-8"?>
<chessresults>
  <getkey source="$chessResultsSourceId" sid="$($sid.EncryptedSid)" creatorID="$chessResultsCreatorId" federation="$escapedFed" tournament="$escapedName" />
</chessresults>
"@
  $url = '{0}?key1=GETKEY' -f $chessResultsEndpoint
  $raw = Invoke-ChessResultsXmlPost $url $xml
  $response = ConvertFrom-ChessResultsResponse $raw 'GETKEY'
  $key = [string]$response.Result.GetAttribute('key')
  if ($key -notmatch '^\d+$') { throw 'Chess-Results GETKEY returned OK but no numeric database key.' }

  # Save locally before the HTTP response is sent back to the HTML application.
  Save-ChessResultsKeyRecovery $name $fed $modeValue $key $client
  Write-EngineLog "Chess-Results GETKEY OK: TNR $key for '$name' ($fed)."
  return [pscustomobject]@{ Key = $key; Federation = $fed; Mode = $modeValue; SidVerified = [bool]$sid.Verified; Recovered = $false }
}

function Publish-ChessResultsXml([string]$Key, [string]$Xml) {
  $keyValue = ([string]$Key).Trim()
  if ($keyValue -notmatch '^\d+$') { throw 'Chess-Results tournament key must be numeric.' }
  if ([string]::IsNullOrWhiteSpace($Xml)) { throw 'No Chess-Results XML snapshot was supplied.' }
  if ($Xml.Length -gt 20000000) { throw 'Chess-Results XML snapshot is too large.' }

  # Prevent a snapshot from accidentally updating a different tournament key.
  $keyPattern = 'key\s*=\s*["'']' + [regex]::Escape($keyValue) + '["'']'
  if ($Xml -notmatch $keyPattern) { throw "The XML tournament key does not match TNR $keyValue." }
  foreach ($placeholder in @('__CP_CR_SID__','__CP_CR_CREATOR__','__CP_CR_TNR__')) {
    if (-not $Xml.Contains($placeholder)) { throw "Chess-Results XML security placeholder $placeholder is missing." }
  }

  $sid = Invoke-ChessResultsGetSid
  $secured = $Xml.Replace('__CP_CR_SID__', $sid.EncryptedSid)
  $secured = $secured.Replace('__CP_CR_CREATOR__', (Protect-ChessResultsValue ([string]$chessResultsCreatorId)))
  $secured = $secured.Replace('__CP_CR_TNR__', (Protect-ChessResultsValue $keyValue))

  try { [xml]$null = $secured } catch { throw "Secured Chess-Results XML is invalid: $($_.Exception.Message)" }
  $url = '{0}?key1=UPLOAD' -f $chessResultsEndpoint
  $raw = Invoke-ChessResultsXmlPost $url $secured
  try {
    $response = ConvertFrom-ChessResultsResponse $raw 'UPLOAD'
  } catch {
    $uploadError = $_.Exception.Message
    if (Test-ChessResultsStoredTnrRejection $uploadError) {
      # The authenticated XML endpoint is stronger evidence than the public page:
      # the stored TNR no longer belongs to ChessPublisher Source ID 21 (for
      # example after deletion/reset). Record this exact server rejection so an
      # explicit Unlink can safely release the stale local TNR.
      $recovery = Get-ChessResultsKeyRecoveryByKey $keyValue
      $clientId = if ($null -ne $recovery) { [string]$recovery.clientId } else { '' }
      Save-ChessResultsInvalidKeyEvidence $keyValue $clientId $uploadError
    }
    throw
  }
  Remove-ChessResultsInvalidKeyEvidence $keyValue ''
  Write-EngineLog "Chess-Results UPLOAD OK: TNR $keyValue."
  return [pscustomobject]@{ Key = $keyValue; SidVerified = [bool]$sid.Verified; Raw = $response.Raw }
}

function Get-ChessResultsAdminUrl([string]$Key, [int]$Language = 1) {
  $keyValue = ([string]$Key).Trim()
  if ($keyValue -notmatch '^\d+$') { throw 'Chess-Results tournament key must be numeric.' }
  if ($Language -lt 0 -or $Language -gt 20) { $Language = 1 }
  $creatorEncrypted = Protect-ChessResultsValue ([string]$chessResultsCreatorId)
  $keyEncrypted = Protect-ChessResultsValue $keyValue
  return ('https://chess-results.com/Stammdaten.aspx?art=1&lan={0}&tabkey=26&key1={1}&luser_sec={2}&tnr_sec={3}' -f $Language,$keyValue,$creatorEncrypted,$keyEncrypted)
}

function Get-ChessResultsUploadSectionUrl([string]$Key, [int]$Language = 1) {
  $keyValue = ([string]$Key).Trim()
  if ($keyValue -notmatch '^\d+$') { throw 'Chess-Results tournament key must be numeric.' }
  if ($Language -lt 0 -or $Language -gt 20) { $Language = 1 }

  # Authenticate through the owner-provided admin link.  UploadData session
  # parameters (sid/sid1/time) are server-generated and are never fabricated or
  # persisted by ChessPublisher.
  $adminUrl = Get-ChessResultsAdminUrl $keyValue $Language
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  $cookieJar = New-Object System.Net.CookieContainer

  function Invoke-CrAuthenticatedGet([string]$Url) {
    $request = [System.Net.HttpWebRequest]::Create($Url)
    $request.Method = 'GET'
    $request.AllowAutoRedirect = $true
    $request.MaximumAutomaticRedirections = 10
    $request.CookieContainer = $cookieJar
    $request.UserAgent = 'ChessPublisher/1.94 (Chess-Results admin upload section)'
    $request.Timeout = 15000
    $request.ReadWriteTimeout = 15000
    try { $request.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate } catch {}
    $response = $null
    try {
      $response = $request.GetResponse()
      $finalUrl = [string]$response.ResponseUri.AbsoluteUri
      $stream = $response.GetResponseStream()
      $html = ''
      if ($null -ne $stream) {
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $true)
        try { $html = $reader.ReadToEnd() } finally { $reader.Dispose() }
      }
      return [pscustomobject]@{ Url = $finalUrl; Html = $html }
    } finally {
      if ($null -ne $response) { try { $response.Close() } catch {} }
    }
  }

  function Test-CrUploadUrl([string]$Url, [bool]$RequireSession = $false) {
    if ([string]::IsNullOrWhiteSpace($Url)) { return $null }
    try {
      $candidate = [System.Net.WebUtility]::HtmlDecode([string]$Url).Replace('\u0026','&').Replace('\x26','&').Trim()
      $absolute = (New-Object System.Uri((New-Object System.Uri('https://chess-results.com/')), $candidate)).AbsoluteUri
      $uri = New-Object System.Uri($absolute)
      $host = $uri.Host.ToLowerInvariant()
      if (-not ($host -eq 'chess-results.com' -or $host.EndsWith('.chess-results.com'))) { return $null }
      if ($uri.AbsolutePath -notmatch '(?i)/UploadData\.aspx$') { return $null }
      if ($uri.Query -notmatch ('(?i)(?:^|[?&])tnr=' + [regex]::Escape($keyValue) + '(?:&|$)')) { return $null }
      if ($RequireSession) {
        # The URL is opened in the user's browser, which does not share this
        # private CookieContainer. Require server-issued URL session values so
        # the returned link can stand on its own.
        if ($uri.Query -notmatch '(?i)(?:^|[?&])sid=[^&]+') { return $null }
        if ($uri.Query -notmatch '(?i)(?:^|[?&])sid1=[^&]+') { return $null }
        if ($uri.Query -notmatch '(?i)(?:^|[?&])time=[^&]+') { return $null }
      }
      return $absolute
    } catch { return $null }
  }

  function Find-CrUploadUrlInHtml([string]$Html, [bool]$RequireSession = $false) {
    if ([string]::IsNullOrWhiteSpace($Html)) { return $null }
    $decodedHtml = [System.Net.WebUtility]::HtmlDecode([string]$Html)
    # Accept the main host and s1/s2/s3/... content hosts, relative href/action,
    # and JavaScript targets.  Do not require sid/sid1/time to be present in the
    # page source because the server may add them only after navigation.
    $patterns = @(
      '(?is)(?<url>https?://(?:[a-z0-9-]+\.)?chess-results\.com/UploadData\.aspx\?[^"''<>\s]+)',
      '(?is)(?<url>/?UploadData\.aspx\?[^"''<>\s\)]+)'
    )
    foreach ($pattern in $patterns) {
      foreach ($match in [regex]::Matches($decodedHtml, $pattern)) {
        $value = [string]$match.Groups['url'].Value
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        $value = $value.TrimEnd(';',',',')')
        $valid = Test-CrUploadUrl $value $RequireSession
        if ($valid) { return $valid }
      }
    }
    return $null
  }

  function Find-CrSessionValueInHtml([string]$Html, [string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Html) -or [string]::IsNullOrWhiteSpace($Name)) { return $null }
    $decoded = [System.Net.WebUtility]::HtmlDecode([string]$Html)
    $n = [regex]::Escape($Name)
    $patterns = @(
      ('(?is)<input[^>]*\bname\s*=\s*["'']' + $n + '["''][^>]*\bvalue\s*=\s*["''](?<v>[^"'']+)["'']'),
      ('(?is)<input[^>]*\bvalue\s*=\s*["''](?<v>[^"'']+)["''][^>]*\bname\s*=\s*["'']' + $n + '["'']'),
      ('(?is)\b' + $n + '\s*[:=]\s*["''](?<v>[A-Za-z0-9_-]{6,128})["'']')
    )
    foreach ($pattern in $patterns) {
      $m = [regex]::Match($decoded, $pattern)
      if ($m.Success) {
        $v = ([string]$m.Groups['v'].Value).Trim()
        if (-not [string]::IsNullOrWhiteSpace($v)) { return $v }
      }
    }
    return $null
  }

  function Build-CrUploadSessionUrlFromHtml([string]$Html) {
    $sid = Find-CrSessionValueInHtml $Html 'sid'
    $sid1 = Find-CrSessionValueInHtml $Html 'sid1'
    $time = Find-CrSessionValueInHtml $Html 'time'
    if ([string]::IsNullOrWhiteSpace($sid) -or [string]::IsNullOrWhiteSpace($sid1) -or [string]::IsNullOrWhiteSpace($time)) { return $null }
    # sid/sid1/time are copied from Chess-Results' authenticated response. Only
    # stable route fields (tnr/source/lan) come from ChessPublisher.
    $url = 'https://chess-results.com/UploadData.aspx?tnr={0}&sid={1}&sid1={2}&source=0&lan={3}&time={4}' -f       $keyValue,[System.Uri]::EscapeDataString($sid),[System.Uri]::EscapeDataString($sid1),$Language,[System.Uri]::EscapeDataString($time)
    return Test-CrUploadUrl $url $true
  }

  # Step 1: establish the authenticated Chess-Results session.
  $admin = Invoke-CrAuthenticatedGet $adminUrl
  if ([string]::IsNullOrWhiteSpace($admin.Html)) { throw 'Chess-Results returned an empty administration page.' }

  # Step 2: use a direct UploadData target if Chess-Results emitted one.
  $standaloneFromAdmin = Find-CrUploadUrlInHtml $admin.Html $true
  if ($standaloneFromAdmin) {
    Write-EngineLog "Chess-Results standalone UploadData URL found on admin page for TNR $keyValue."
    return $standaloneFromAdmin
  }
  $sessionFromAdmin = Build-CrUploadSessionUrlFromHtml $admin.Html
  if ($sessionFromAdmin) {
    Write-EngineLog "Chess-Results UploadData session values resolved on admin page for TNR $keyValue."
    return $sessionFromAdmin
  }
  $direct = Find-CrUploadUrlInHtml $admin.Html $false
  if ($direct) {
    # Follow it with the same cookie jar. The final redirect is authoritative and
    # may add fresh sid/sid1/time values.
    try {
      $resolved = Invoke-CrAuthenticatedGet $direct
      $final = Test-CrUploadUrl $resolved.Url $true
      if ($final) {
        Write-EngineLog "Chess-Results upload section URL resolved from admin page for TNR $keyValue."
        return $final
      }
      $fromBody = Find-CrUploadUrlInHtml $resolved.Html $true
      if ($fromBody) {
        Write-EngineLog "Chess-Results upload section URL resolved from UploadData response for TNR $keyValue."
        return $fromBody
      }
      $fromFields = Build-CrUploadSessionUrlFromHtml $resolved.Html
      if ($fromFields) {
        Write-EngineLog "Chess-Results UploadData session fields resolved for TNR $keyValue."
        return $fromFields
      }
    } catch {
      Write-EngineLog "Chess-Results direct UploadData navigation failed for TNR ${keyValue}: $($_.Exception.Message)"
    }
  }

  # Step 3: preserve the owner-provided encrypted credentials when entering
  # UploadData.  The Stammdaten owner link itself is URL-authenticated; it does
  # not guarantee that a reusable cookie was created.  v1.03.16 dropped
  # luser_sec/tnr_sec here, which could leave the UploadData request as Guest.
  $creatorEncrypted = Protect-ChessResultsValue ([string]$chessResultsCreatorId)
  $keyEncrypted = Protect-ChessResultsValue $keyValue
  $secureSectionStart = 'https://chess-results.com/UploadData.aspx?tnr={0}&source=0&lan={1}&luser_sec={2}&tnr_sec={3}' -f $keyValue,$Language,$creatorEncrypted,$keyEncrypted
  try {
    $resolved = Invoke-CrAuthenticatedGet $secureSectionStart
    $final = Test-CrUploadUrl $resolved.Url $true
    if ($final) {
      Write-EngineLog "Chess-Results upload section URL resolved from owner-authenticated section navigation for TNR $keyValue."
      return $final
    }
    $fromBody = Find-CrUploadUrlInHtml $resolved.Html $true
    if ($fromBody) {
      Write-EngineLog "Chess-Results upload section URL resolved from owner-authenticated section HTML for TNR $keyValue."
      return $fromBody
    }
    $fromFields = Build-CrUploadSessionUrlFromHtml $resolved.Html
    if ($fromFields) {
      Write-EngineLog "Chess-Results UploadData session fields resolved after owner-authenticated section navigation for TNR $keyValue."
      return $fromFields
    }
  } catch {
    Write-EngineLog "Chess-Results owner-authenticated UploadData navigation failed for TNR ${keyValue}: $($_.Exception.Message)"
  }

  # Step 4: legacy cookie-only fallback. Keep it as a final compatibility path,
  # but never treat the bare URL as a portable browser URL unless the server
  # actually redirects it to sid/sid1/time.
  $sectionStart = 'https://chess-results.com/UploadData.aspx?tnr={0}&source=0&lan={1}' -f $keyValue,$Language
  try {
    $resolved = Invoke-CrAuthenticatedGet $sectionStart
    $final = Test-CrUploadUrl $resolved.Url $true
    if ($final) {
      Write-EngineLog "Chess-Results upload section URL resolved by authenticated cookie navigation for TNR $keyValue."
      return $final
    }
    $fromBody = Find-CrUploadUrlInHtml $resolved.Html $true
    if ($fromBody) {
      Write-EngineLog "Chess-Results upload section URL resolved from authenticated cookie section HTML for TNR $keyValue."
      return $fromBody
    }
    $fromFields = Build-CrUploadSessionUrlFromHtml $resolved.Html
    if ($fromFields) {
      Write-EngineLog "Chess-Results UploadData session fields resolved after authenticated cookie section navigation for TNR $keyValue."
      return $fromFields
    }
  } catch {
    Write-EngineLog "Chess-Results authenticated cookie UploadData fallback failed for TNR ${keyValue}: $($_.Exception.Message)"
  }

  Write-EngineLog "Chess-Results upload section URL not resolved for TNR $keyValue after owner-authenticated admin + section navigation."
  throw 'Chess-Results administration opened, but the Upload Section could not be resolved after authenticated navigation. Open Admin once and retry; no session token was fabricated or stored.'
}

function Get-SafeTournamentFolderName([string]$Name) {
  $safe = ([string]$Name).Trim()
  if ([string]::IsNullOrWhiteSpace($safe)) { throw 'Tournament name is required.' }
  foreach ($c in [System.IO.Path]::GetInvalidFileNameChars()) { $safe = $safe.Replace([string]$c, '_') }
  $safe = $safe.Trim().TrimEnd('.')
  if ([string]::IsNullOrWhiteSpace($safe)) { throw 'Tournament name is not valid for a folder.' }
  if ($safe.Length -gt 120) { $safe = $safe.Substring(0,120).Trim() }
  return $safe
}

function Get-TournamentFolder([string]$Name) {
  $safe = Get-SafeTournamentFolderName $Name
  return Join-Path $tournamentsRoot $safe
}

# v1.03.60: Recent Tournaments must reopen the exact folder that /tournaments
# already enumerated.  Do not sanitize/truncate the display name a second time:
# older builds and manually restored folders may legitimately have a leaf name
# that differs from the current Get-SafeTournamentFolderName result.
function Resolve-ExistingTournamentFolder([string]$Name) {
  $requested = ([string]$Name).Trim()
  if ([string]::IsNullOrWhiteSpace($requested)) { return $null }

  # Only a leaf folder name is accepted.  The actual path is always resolved by
  # enumerating the known ChessPublisher Tournaments root, so ../ or an absolute
  # path can never escape the tournament store.
  if ($requested -ne [System.IO.Path]::GetFileName($requested)) { return $null }

  try { $requestedNormalized = $requested.Normalize([System.Text.NormalizationForm]::FormC) }
  catch { $requestedNormalized = $requested }

  foreach ($folder in @(Get-ChildItem -LiteralPath $tournamentsRoot -Directory -ErrorAction SilentlyContinue)) {
    $candidate = [string]$folder.Name
    try { $candidateNormalized = $candidate.Normalize([System.Text.NormalizationForm]::FormC) }
    catch { $candidateNormalized = $candidate }

    if ([string]::Equals($candidateNormalized, $requestedNormalized, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $folder.FullName
    }
  }

  return $null
}

# v1.03.92: Recent Tournaments uses one canonical inventory for BOTH listing
# and opening. The browser receives an opaque inventory id rather than relying on
# a Windows path round-trip through a query string. Every Open request re-scans
# the managed tournament root, so stale cached paths cannot make a valid row fail.
function Get-TournamentInventoryId([string]$File) {
  try {
    $full = [System.IO.Path]::GetFullPath([string]$File)
    try { $full = $full.Normalize([System.Text.NormalizationForm]::FormC) } catch {}
    $normalized = $full.ToLowerInvariant()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($normalized)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
    return ([System.BitConverter]::ToString($hash)).Replace('-','').ToLowerInvariant()
  } catch {
    Write-EngineLog "Recent tournament inventory id failed: $($_.Exception.Message)"
    return ''
  }
}

function Get-TournamentInventory([object[]]$RecentNames = @()) {
  $result = New-Object System.Collections.Generic.List[object]
  foreach ($folder in @(Get-ChildItem -LiteralPath $tournamentsRoot -Directory -ErrorAction SilentlyContinue)) {
    $file = Join-Path $folder.FullName 'tournament.json'
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }

    # Every valid managed tournament gets its emergency TRF destination even if
    # the folder came from an older build or was restored manually.
    New-Item -ItemType Directory -Path (Join-Path $folder.FullName 'TRF_Backup') -Force -ErrorAction SilentlyContinue | Out-Null

    $recentIndex = 9999
    for ($i = 0; $i -lt @($RecentNames).Count; $i++) {
      if ([System.String]::Equals([string]$RecentNames[$i], [string]$folder.Name, [System.StringComparison]::OrdinalIgnoreCase)) {
        $recentIndex = $i
        break
      }
    }

    $info = Get-Item -LiteralPath $file -ErrorAction Stop
    $result.Add([pscustomobject]@{
      id = (Get-TournamentInventoryId $file)
      name = [string]$folder.Name
      path = [string]$file
      modified = $info.LastWriteTimeUtc.ToString('o')
      recentIndex = $recentIndex
    })
  }
  return @($result.ToArray())
}

function Resolve-TournamentInventoryItem([string]$Id, [string]$Name, [string]$RequestedFile) {
  $items = @(Get-TournamentInventory @())

  $requestedId = ([string]$Id).Trim()
  if (-not [string]::IsNullOrWhiteSpace($requestedId)) {
    foreach ($item in $items) {
      if ([System.String]::Equals([string]$item.id, $requestedId, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $item
      }
    }
  }

  # Compatibility fallback for v1.03.91 callers. Compare the requested path
  # against freshly enumerated canonical files; never trust it as a direct path.
  if (-not [string]::IsNullOrWhiteSpace($RequestedFile)) {
    try {
      $requestedFull = [System.IO.Path]::GetFullPath([string]$RequestedFile)
      foreach ($item in $items) {
        $itemFull = [System.IO.Path]::GetFullPath([string]$item.path)
        if ([System.String]::Equals($itemFull, $requestedFull, [System.StringComparison]::OrdinalIgnoreCase)) {
          return $item
        }
      }
    } catch {
      Write-EngineLog "Recent tournament compatibility-path comparison failed: $($_.Exception.Message)"
    }
  }

  $requestedName = ([string]$Name).Trim()
  if (-not [string]::IsNullOrWhiteSpace($requestedName)) {
    try { $requestedNameNormalized = $requestedName.Normalize([System.Text.NormalizationForm]::FormC) }
    catch { $requestedNameNormalized = $requestedName }
    foreach ($item in $items) {
      $candidate = [string]$item.name
      try { $candidate = $candidate.Normalize([System.Text.NormalizationForm]::FormC) } catch {}
      if ([System.String]::Equals($candidate, $requestedNameNormalized, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $item
      }
    }
  }

  return $null
}

function Read-TournamentInventoryItem($Item) {
  if ($null -eq $Item) { return $null }
  $file = [string]$Item.path
  if ([string]::IsNullOrWhiteSpace($file) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) { return $null }
  $json = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
  $parsed = $json | ConvertFrom-Json
  if ($null -eq $parsed.data -or $null -eq $parsed.data.tournaments) { throw 'The tournament file is not valid ChessPublisher data.' }
  return [pscustomobject]@{ item = $Item; snapshot = $parsed }
}

function Ensure-TournamentFolders([string]$Folder) {
  New-Item -ItemType Directory -Path $Folder -Force | Out-Null
  foreach ($sub in @('rounds','imports','exports','backup','TRF_Backup')) {
    New-Item -ItemType Directory -Path (Join-Path $Folder $sub) -Force | Out-Null
  }
}

function Update-RecentTournament([string]$Name) {
  try {
    $recent = @()
    if (Test-Path -LiteralPath $recentFile) {
      $raw = Get-Content -LiteralPath $recentFile -Raw -ErrorAction SilentlyContinue
      if ($raw) { $recent = @($raw | ConvertFrom-Json) }
    }
    $recent = @($Name) + @($recent | Where-Object { [string]$_ -ne $Name })
    $recent = @($recent | Select-Object -First 12)
    [System.IO.File]::WriteAllText($recentFile, ($recent | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
  } catch {
    Write-EngineLog "Recent tournament update failed: $($_.Exception.Message)"
  }
}

# v1.03.64: keep Recent Tournaments consistent after an on-disk folder rename.
function Replace-RecentTournamentName([string]$OldName, [string]$NewName) {
  try {
    $recent = @()
    if (Test-Path -LiteralPath $recentFile) {
      $raw = Get-Content -LiteralPath $recentFile -Raw -ErrorAction SilentlyContinue
      if ($raw) { $recent = @($raw | ConvertFrom-Json) }
    }
    $filtered = @($recent | Where-Object {
      -not [System.String]::Equals([string]$_, $OldName, [System.StringComparison]::OrdinalIgnoreCase) -and
      -not [System.String]::Equals([string]$_, $NewName, [System.StringComparison]::OrdinalIgnoreCase)
    })
    $recent = @($NewName) + $filtered
    $recent = @($recent | Select-Object -First 12)
    [System.IO.File]::WriteAllText($recentFile, ($recent | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
  } catch {
    Write-EngineLog "Recent tournament rename update failed: $($_.Exception.Message)"
  }
}

# v1.03.96 SECURITY: managed tournament files/backups are shareable. Redact
# device-local Telegram secrets from legacy snapshots before they are rotated.
function Remove-TournamentSnapshotSecrets($Snapshot) {
  if ($null -eq $Snapshot) { return $Snapshot }
  try {
    if ($null -ne $Snapshot.telegramGlobal) {
      $Snapshot.telegramGlobal.PSObject.Properties.Remove('token')
    }
  } catch {}
  try {
    if ($null -ne $Snapshot.telegram) {
      $Snapshot.telegram.PSObject.Properties.Remove('token')
    }
  } catch {}
  return $Snapshot
}

function Copy-SanitizedTournamentJson([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { return $false }
  try {
    $raw = [System.IO.File]::ReadAllText($Source, [System.Text.Encoding]::UTF8)
    $snapshot = $raw | ConvertFrom-Json
    $snapshot = Remove-TournamentSnapshotSecrets $snapshot
    $serialized = $snapshot | ConvertTo-Json -Compress -Depth 30
    [System.IO.File]::WriteAllText($Destination, $serialized, (New-Object System.Text.UTF8Encoding($false)))
    return $true
  } catch {
    Write-EngineLog ('Security backup sanitization skipped unreadable JSON: ' + $Source + ' — ' + $_.Exception.Message)
    return $false
  }
}

function Sanitize-TournamentBackupFolder([string]$Folder) {
  if ([string]::IsNullOrWhiteSpace($Folder) -or -not (Test-Path -LiteralPath $Folder)) { return }
  foreach ($item in @(Get-ChildItem -LiteralPath $Folder -Filter '*.json' -File -ErrorAction SilentlyContinue)) {
    try {
      $raw = [System.IO.File]::ReadAllText($item.FullName, [System.Text.Encoding]::UTF8)
      if ($raw -notmatch '"token"\s*:') { continue }
      $snapshot = $raw | ConvertFrom-Json
      $snapshot = Remove-TournamentSnapshotSecrets $snapshot
      $serialized = $snapshot | ConvertTo-Json -Compress -Depth 30
      [System.IO.File]::WriteAllText($item.FullName, $serialized, (New-Object System.Text.UTF8Encoding($false)))
    } catch {
      Write-EngineLog ('Could not sanitize legacy tournament backup: ' + $item.FullName + ' — ' + $_.Exception.Message)
    }
  }
}

function Write-EngineLog([string]$Message) {
  try {
    $line = '[{0}] {1}{2}' -f ([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss')), $Message, [Environment]::NewLine
    [System.IO.File]::AppendAllText($logFile, $line, $utf8NoBom)
  } catch {
    # Logging must never be able to stop the pairing service.
  }
}

# v1.03.73 SECURITY POINT-FIX START
# The LocalEngine is intentionally bound to loopback, but browser security still
# matters: an arbitrary web page must not be able to use the user's browser as a
# bridge to privileged 127.0.0.1 endpoints.  Native/internal PowerShell calls do
# not normally send Origin or Sec-Fetch-* headers and remain allowed.
$allowedBrowserOrigins = @(
  "http://127.0.0.1:$Port",
  "http://localhost:$Port"
)
$allowedBrowserHosts = @(
  "127.0.0.1:$Port",
  "localhost:$Port"
)

function Get-AllowedBrowserOrigin([string]$Origin) {
  if ([string]::IsNullOrWhiteSpace($Origin)) { return $null }
  $candidate = $Origin.Trim()
  if ($candidate -ieq 'null') { return $null }
  foreach ($allowed in $allowedBrowserOrigins) {
    if ([string]::Equals($candidate, [string]$allowed, [System.StringComparison]::OrdinalIgnoreCase)) {
      return [string]$allowed
    }
  }
  return $null
}

function Test-AllowedBrowserHost([string]$HostHeader) {
  if ([string]::IsNullOrWhiteSpace($HostHeader)) { return $false }
  $candidate = $HostHeader.Trim()
  foreach ($allowed in $allowedBrowserHosts) {
    if ([string]::Equals($candidate, [string]$allowed, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }
  return $false
}

function Add-ValidatedCorsResponseHeaders($Context) {
  # CORS is reflected only for a request that carries one of our exact allowed
  # origins.  Native/internal requests receive no CORS headers at all.
  $allowedOrigin = Get-AllowedBrowserOrigin ([string]$Context.Request.Headers['Origin'])
  if ([string]::IsNullOrWhiteSpace($allowedOrigin)) { return }
  $Context.Response.Headers['Access-Control-Allow-Origin'] = $allowedOrigin
  $Context.Response.Headers['Vary'] = 'Origin'
}

function New-LocalRequestSecurityDecision($Context) {
  $request = $Context.Request
  $method = ([string]$request.HttpMethod).ToUpperInvariant()
  $path = [string]$request.Url.AbsolutePath
  $originRaw = [string]$request.Headers['Origin']
  $fetchSite = ([string]$request.Headers['Sec-Fetch-Site']).Trim().ToLowerInvariant()
  $fetchMode = ([string]$request.Headers['Sec-Fetch-Mode']).Trim().ToLowerInvariant()
  $referer = ([string]$request.Headers['Referer']).Trim()
  # HttpListener exposes the requested host reliably through UserHostName.
  # Keep a Host-header fallback for compatibility, but never trust either value
  # unless it exactly matches one of the allowed loopback host+port pairs.
  $hostHeader = ([string]$request.UserHostName).Trim()
  if ([string]::IsNullOrWhiteSpace($hostHeader)) {
    $hostHeader = ([string]$request.Headers['Host']).Trim()
  }
  $hasOrigin = -not [string]::IsNullOrWhiteSpace($originRaw)
  $allowedOrigin = Get-AllowedBrowserOrigin $originRaw
  $browserMetadataPresent = $hasOrigin -or (-not [string]::IsNullOrWhiteSpace($fetchSite))

  # Explicitly reject opaque/file origins. Chromium/WebView2 normally serializes
  # file:// and other opaque browser contexts as Origin: null.
  if ($hasOrigin -and $originRaw.Trim() -ieq 'null') {
    return [pscustomobject]@{ Allowed = $false; Reason = 'Origin: null is not allowed.'; AllowedOrigin = $null }
  }
  if ($hasOrigin -and [string]::IsNullOrWhiteSpace($allowedOrigin)) {
    return [pscustomobject]@{ Allowed = $false; Reason = 'Browser Origin is not allowed.'; AllowedOrigin = $null }
  }
  if (-not [string]::IsNullOrWhiteSpace($referer) -and $referer.StartsWith('file:', [System.StringComparison]::OrdinalIgnoreCase)) {
    return [pscustomobject]@{ Allowed = $false; Reason = 'file:// browser context is not allowed.'; AllowedOrigin = $null }
  }

  if ($fetchSite -eq 'cross-site') {
    return [pscustomobject]@{ Allowed = $false; Reason = 'Sec-Fetch-Site: cross-site is not allowed.'; AllowedOrigin = $null }
  }
  if ($fetchSite -eq 'same-site' -and [string]::IsNullOrWhiteSpace($allowedOrigin)) {
    return [pscustomobject]@{ Allowed = $false; Reason = 'same-site browser request does not carry the exact allowed Origin.'; AllowedOrigin = $null }
  }
  if (-not [string]::IsNullOrWhiteSpace($fetchSite) -and
      $fetchSite -ne 'same-origin' -and
      $fetchSite -ne 'same-site' -and
      $fetchSite -ne 'cross-site' -and
      $fetchSite -ne 'none') {
    return [pscustomobject]@{ Allowed = $false; Reason = 'Unsupported Sec-Fetch-Site value.'; AllowedOrigin = $null }
  }

  # Sec-Fetch-Site:none is expected for a user/native top-level navigation to
  # the UI.  Do not allow it to call service APIs unless an exact allowed Origin
  # is also present.
  if ($fetchSite -eq 'none' -and [string]::IsNullOrWhiteSpace($allowedOrigin)) {
    $uiNavigation = ($method -eq 'GET') -and (($path -eq '/') -or ($path -eq '/ChessPublisher.html')) -and
      ([string]::IsNullOrWhiteSpace($fetchMode) -or $fetchMode -eq 'navigate')
    if (-not $uiNavigation) {
      return [pscustomobject]@{ Allowed = $false; Reason = 'Sec-Fetch-Site:none is allowed only for the ChessPublisher UI navigation.'; AllowedOrigin = $null }
    }
  }

  # Browser-associated traffic must target the exact LocalEngine host/port.
  # This also blocks a same-site page running on a different localhost port.
  if ($browserMetadataPresent -and -not (Test-AllowedBrowserHost $hostHeader)) {
    return [pscustomobject]@{ Allowed = $false; Reason = 'Browser request targets an unexpected host or LocalEngine port.'; AllowedOrigin = $null }
  }
  if ($hasOrigin -and -not [string]::IsNullOrWhiteSpace($allowedOrigin)) {
    $requestOrigin = 'http://' + $hostHeader
    if (-not [string]::Equals($allowedOrigin, $requestOrigin, [System.StringComparison]::OrdinalIgnoreCase)) {
      return [pscustomobject]@{ Allowed = $false; Reason = 'Browser Origin does not exactly match the LocalEngine destination origin.'; AllowedOrigin = $null }
    }
  }

  # OPTIONS is accepted only as an explicit, tightly scoped preflight from one
  # of our exact allowed origins.  Native code does not need OPTIONS.
  if ($method -eq 'OPTIONS') {
    if ([string]::IsNullOrWhiteSpace($allowedOrigin)) {
      return [pscustomobject]@{ Allowed = $false; Reason = 'Preflight Origin is not allowed.'; AllowedOrigin = $null }
    }
    $requestedMethod = ([string]$request.Headers['Access-Control-Request-Method']).Trim().ToUpperInvariant()
    if ($requestedMethod -ne 'GET' -and $requestedMethod -ne 'POST') {
      return [pscustomobject]@{ Allowed = $false; Reason = 'Preflight method is not allowed.'; AllowedOrigin = $null }
    }
    $requestedHeaders = ([string]$request.Headers['Access-Control-Request-Headers']).Trim()
    if (-not [string]::IsNullOrWhiteSpace($requestedHeaders)) {
      foreach ($header in @($requestedHeaders.Split(','))) {
        $name = ([string]$header).Trim().ToLowerInvariant()
        if (-not [string]::IsNullOrWhiteSpace($name) -and $name -ne 'content-type') {
          return [pscustomobject]@{ Allowed = $false; Reason = 'Preflight request header is not allowed.'; AllowedOrigin = $null }
        }
      }
    }
  }

  return [pscustomobject]@{ Allowed = $true; Reason = ''; AllowedOrigin = $allowedOrigin }
}

function Send-ForbiddenLocalRequest($Context, [string]$Reason) {
  $body = @{ ok = $false; error = 'Forbidden'; reason = [string]$Reason } | ConvertTo-Json -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $Context.Response.StatusCode = 403
  $Context.Response.ContentType = 'application/json; charset=utf-8'
  # Deliberately no CORS headers on rejected requests.
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Context.Response.Close()
}

function Send-AllowedPreflightResponse($Context, [string]$AllowedOrigin) {
  $requestedMethod = ([string]$Context.Request.Headers['Access-Control-Request-Method']).Trim().ToUpperInvariant()
  $requestedHeaders = ([string]$Context.Request.Headers['Access-Control-Request-Headers']).Trim()
  $Context.Response.StatusCode = 204
  $Context.Response.Headers['Access-Control-Allow-Origin'] = $AllowedOrigin
  $Context.Response.Headers['Vary'] = 'Origin'
  $Context.Response.Headers['Access-Control-Allow-Methods'] = $requestedMethod
  if (-not [string]::IsNullOrWhiteSpace($requestedHeaders)) {
    $Context.Response.Headers['Access-Control-Allow-Headers'] = 'Content-Type'
  }
  if (([string]$Context.Request.Headers['Access-Control-Request-Private-Network']).Trim() -ieq 'true') {
    $Context.Response.Headers['Access-Control-Allow-Private-Network'] = 'true'
  }
  $Context.Response.Close()
}
# v1.03.73 SECURITY POINT-FIX END

function Send-JsonResponse($Context, [int]$Status, $Body) {
  $json = $Body | ConvertTo-Json -Compress -Depth 8
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $Context.Response.StatusCode = $Status
  $Context.Response.ContentType = 'application/json; charset=utf-8'
  Add-ValidatedCorsResponseHeaders $Context
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Context.Response.Close()
}

function Send-TextResponse($Context, [int]$Status, [string]$Text) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  $Context.Response.StatusCode = $Status
  $Context.Response.ContentType = 'text/plain; charset=utf-8'
  Add-ValidatedCorsResponseHeaders $Context
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Context.Response.Close()
}

function Read-Utf8RequestBody($Context) {
  $reader = New-Object System.IO.StreamReader($Context.Request.InputStream, [System.Text.Encoding]::UTF8, $true)
  try { return $reader.ReadToEnd() }
  finally { $reader.Close() }
}

function Send-HtmlResponse($Context) {
  if (-not (Test-Path -LiteralPath $htmlFile)) {
    Send-TextResponse $Context 404 'ChessPublisher.html is missing.'
    return
  }
  $bytes = [System.IO.File]::ReadAllBytes($htmlFile)
  $Context.Response.StatusCode = 200
  $Context.Response.ContentType = 'text/html; charset=utf-8'
  Add-ValidatedCorsResponseHeaders $Context
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Context.Response.Close()
}

function Send-RawJsonResponse($Context, [int]$Status, [string]$Json) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
  $Context.Response.StatusCode = $Status
  $Context.Response.ContentType = 'application/json; charset=utf-8'
  Add-ValidatedCorsResponseHeaders $Context
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Context.Response.Close()
}

function Convert-ToFideRating([string]$Value) {
  $n = 0
  if ([int]::TryParse(([string]$Value).Trim(), [ref]$n) -and $n -ge 100 -and $n -le 3300) { return $n }
  return 0
}

function Convert-ToFideInt([string]$Value) {
  $n = 0
  if ([int]::TryParse(([string]$Value).Trim(), [ref]$n)) { return $n }
  return 0
}

function Get-FideLegacyTextLayout([string]$Header) {
  # FIDE's LEGACY combined TXT format is fixed-width, but optional columns have
  # changed over the years. In particular FOA is not guaranteed to be present
  # in the LEGACY file. Never reject an otherwise valid player directory just
  # because an optional metadata column is absent.
  $tokens = @('Name','Fed','Sex','Tit','WTit','OTit','FOA','SRtng','SGm','SK','RRtng','RGm','Rk','BRtng','BGm','BK','B-day','Flag')
  $required = @('Name','Fed','Sex','SRtng','RRtng','BRtng','B-day')
  $starts = [ordered]@{}

  foreach ($token in $tokens) {
    # Match the complete header label only. This avoids e.g. Tit accidentally
    # matching the tail of WTit/OTit when a column is absent.
    $pattern = '(?<!\S)' + [regex]::Escape($token) + '(?!\S)'
    $match = [regex]::Match($Header, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($match.Success) { $starts[$token] = $match.Index }
  }

  foreach ($token in $required) {
    if (-not $starts.Contains($token)) {
      throw "The FIDE LEGACY TXT header is missing required field '$token'."
    }
  }

  return $starts
}

function Get-FideLegacyTextField([string]$Line, $Layout, [string]$Field) {
  if ([string]::IsNullOrEmpty($Line)) { return '' }
  $keys = @($Layout.Keys)
  $index = -1
  for ($i = 0; $i -lt $keys.Count; $i++) {
    if ([string]$keys[$i] -ieq $Field) { $index = $i; break }
  }
  if ($index -lt 0) { return '' }
  $start = [int]$Layout[$Field]
  if ($start -ge $Line.Length) { return '' }
  $end = if ($index + 1 -lt $keys.Count) { [int]$Layout[$keys[$index + 1]] } else { $Line.Length }
  if ($end -gt $Line.Length) { $end = $Line.Length }
  if ($end -le $start) { return '' }
  return $Line.Substring($start, $end - $start).Trim()
}

function Find-FidePlayerDirectoryEntriesTxt([string]$DirectoryFile, [string[]]$FideIds) {
  $wanted = @{}
  foreach ($rawId in @($FideIds)) {
    $id = ([string]$rawId).Trim()
    if ($id -match '^\d{5,15}$') { $wanted[$id] = $true }
  }
  if ($wanted.Count -eq 0) { return @() }

  $found = @()
  $reader = New-Object System.IO.StreamReader($DirectoryFile, [System.Text.Encoding]::UTF8, $true)
  try {
    $header = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($header)) { throw 'The FIDE LEGACY TXT player directory has no header.' }
    $layout = Get-FideLegacyTextLayout $header
    $nameStart = [int]$layout['Name']

    while (-not $reader.EndOfStream -and $wanted.Count -gt 0) {
      $line = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -lt $nameStart) { continue }
      $fideId = $line.Substring(0, [math]::Min($nameStart, $line.Length)).Trim()
      if (-not $wanted.ContainsKey($fideId)) { continue }

      $name = Get-FideLegacyTextField $line $layout 'Name'
      $fed = (Get-FideLegacyTextField $line $layout 'Fed').ToUpperInvariant()
      if ($fed -notmatch '^[A-Z]{3}$') { $fed = 'FIDE' }
      $gender = (Get-FideLegacyTextField $line $layout 'Sex').ToUpperInvariant()
      if ($gender -notmatch '^[MF]$') { $gender = '' }
      $title = (Get-FideLegacyTextField $line $layout 'Tit').ToUpperInvariant()
      $wTitle = (Get-FideLegacyTextField $line $layout 'WTit').ToUpperInvariant()

      $stdRaw = Get-FideLegacyTextField $line $layout 'SRtng'
      $rapidRaw = Get-FideLegacyTextField $line $layout 'RRtng'
      $blitzRaw = Get-FideLegacyTextField $line $layout 'BRtng'
      $std = Convert-ToFideRating $stdRaw
      $rapid = Convert-ToFideRating $rapidRaw
      $blitz = Convert-ToFideRating $blitzRaw
      $stdK = Convert-ToFideInt (Get-FideLegacyTextField $line $layout 'SK')
      $rapidK = Convert-ToFideInt (Get-FideLegacyTextField $line $layout 'Rk')
      $blitzK = Convert-ToFideInt (Get-FideLegacyTextField $line $layout 'BK')

      $birthRaw = Get-FideLegacyTextField $line $layout 'B-day'
      $birth = '-'
      if ($birthRaw -match '^(?:19\d{2}|20[0-3]\d)$') { $birth = $birthRaw }

      $found += ,([pscustomobject]@{
        fideId = $fideId
        name = $name
        fed = $fed
        birth = $birth
        gender = $gender
        title = $title
        wTitle = $wTitle
        std = $std
        rapid = $rapid
        blitz = $blitz
        stdK = $stdK
        rapidK = $rapidK
        blitzK = $blitzK
        stdAvailable = ($std -gt 0)
        rapidAvailable = ($rapid -gt 0)
        blitzAvailable = ($blitz -gt 0)
        source = 'legacy-txt'
      })
      $null = $wanted.Remove($fideId)
    }
  } finally {
    $reader.Dispose()
  }
  # Windows PowerShell 5.1 can throw "Argument types do not match" when
  # @() wraps Generic.List[object]. Keep FIDE lookup results as a plain
  # PowerShell array so JSON serialization is stable on the bundled backend.
  return $found
}

function Find-FidePlayerDirectorySearchTxt([string]$DirectoryFile, [string]$Query, [int]$Limit = 60) {
  $q = ([string]$Query).Trim().ToLowerInvariant()
  if ($q.Length -lt 2) { return @() }
  if ($Limit -lt 1) { $Limit = 1 }
  if ($Limit -gt 60) { $Limit = 60 }
  $terms = @($q -split '[\s,]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($terms.Count -eq 0) { return @() }

  $found = @()
  $reader = New-Object System.IO.StreamReader($DirectoryFile, [System.Text.Encoding]::UTF8, $true)
  try {
    $header = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($header)) { throw 'The FIDE LEGACY TXT player directory has no header.' }
    $layout = Get-FideLegacyTextLayout $header
    $nameStart = [int]$layout['Name']

    while (-not $reader.EndOfStream -and $found.Count -lt $Limit) {
      $line = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -lt $nameStart) { continue }
      $lower = $line.ToLowerInvariant()
      $matches = $true
      foreach ($term in $terms) {
        if ($lower.IndexOf([string]$term, [System.StringComparison]::Ordinal) -lt 0) { $matches = $false; break }
      }
      if (-not $matches) { continue }

      $fideId = $line.Substring(0, [math]::Min($nameStart, $line.Length)).Trim()
      if ($fideId -notmatch '^\d{5,15}$') { continue }
      $name = Get-FideLegacyTextField $line $layout 'Name'
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      $fed = (Get-FideLegacyTextField $line $layout 'Fed').ToUpperInvariant()
      if ($fed -notmatch '^[A-Z]{3}$') { $fed = 'FIDE' }
      $gender = (Get-FideLegacyTextField $line $layout 'Sex').ToUpperInvariant()
      if ($gender -notmatch '^[MF]$') { $gender = '' }
      $title = (Get-FideLegacyTextField $line $layout 'Tit').ToUpperInvariant()
      $wTitle = (Get-FideLegacyTextField $line $layout 'WTit').ToUpperInvariant()
      $std = Convert-ToFideRating (Get-FideLegacyTextField $line $layout 'SRtng')
      $rapid = Convert-ToFideRating (Get-FideLegacyTextField $line $layout 'RRtng')
      $blitz = Convert-ToFideRating (Get-FideLegacyTextField $line $layout 'BRtng')
      $stdK = Convert-ToFideInt (Get-FideLegacyTextField $line $layout 'SK')
      $rapidK = Convert-ToFideInt (Get-FideLegacyTextField $line $layout 'Rk')
      $blitzK = Convert-ToFideInt (Get-FideLegacyTextField $line $layout 'BK')
      $birthRaw = Get-FideLegacyTextField $line $layout 'B-day'
      $birth = '-'
      if ($birthRaw -match '^(?:19\d{2}|20[0-3]\d)$') { $birth = $birthRaw }

      $found += ,([pscustomobject]@{
        fideId = $fideId; name = $name; fed = $fed; birth = $birth; gender = $gender
        title = $title; wTitle = $wTitle; std = $std; rapid = $rapid; blitz = $blitz
        stdK = $stdK; rapidK = $rapidK; blitzK = $blitzK
        stdAvailable = ($std -gt 0); rapidAvailable = ($rapid -gt 0); blitzAvailable = ($blitz -gt 0)
        source = 'legacy-txt'
      })
    }
  } finally {
    $reader.Dispose()
  }
  return $found
}

function Read-FideXmlElementText($Reader) {
  if ($Reader.IsEmptyElement) { return '' }
  $startDepth = $Reader.Depth
  $parts = New-Object System.Collections.Generic.List[string]
  while ($Reader.Read()) {
    if ($Reader.NodeType -eq [System.Xml.XmlNodeType]::Text -or $Reader.NodeType -eq [System.Xml.XmlNodeType]::CDATA) {
      $parts.Add($Reader.Value)
      continue
    }
    if ($Reader.NodeType -eq [System.Xml.XmlNodeType]::EndElement -and $Reader.Depth -eq $startDepth) { break }
  }
  return ($parts -join '')
}

function Find-FidePlayerDirectoryEntriesXml([string]$DirectoryFile, [string[]]$FideIds) {
  $wanted = @{}
  foreach ($rawId in @($FideIds)) {
    $id = ([string]$rawId).Trim()
    if ($id -match '^\d{5,15}$') { $wanted[$id] = $true }
  }
  if ($wanted.Count -eq 0) { return @() }

  $found = @()
  $settings = New-Object System.Xml.XmlReaderSettings
  $settings.IgnoreComments = $true
  $settings.IgnoreWhitespace = $true
  $settings.DtdProcessing = [System.Xml.DtdProcessing]::Ignore
  $reader = [System.Xml.XmlReader]::Create($DirectoryFile, $settings)

  $inPlayer = $false
  $fideId = ''
  $name = ''
  $fed = 'FIDE'
  $gender = ''
  $title = ''
  $wTitle = ''
  $birth = '-'
  $std = 0
  $rapid = 0
  $blitz = 0
  $stdK = 0
  $rapidK = 0
  $blitzK = 0

  try {
    while ($reader.Read() -and $wanted.Count -gt 0) {
      if ($reader.NodeType -eq [System.Xml.XmlNodeType]::Element -and $reader.LocalName -eq 'player') {
        $inPlayer = $true
        $fideId = ''
        $name = ''
        $fed = 'FIDE'
        $gender = ''
        $title = ''
        $wTitle = ''
        $birth = '-'
        $std = 0
        $rapid = 0
        $blitz = 0
        $stdK = 0
        $rapidK = 0
        $blitzK = 0
        continue
      }

      if (-not $inPlayer) { continue }

      if ($reader.NodeType -eq [System.Xml.XmlNodeType]::Element) {
        $field = $reader.LocalName.ToLowerInvariant()
        switch ($field) {
          'fideid' {
            $fideId = (Read-FideXmlElementText $reader).Trim()
          }
          'name' {
            $name = (Read-FideXmlElementText $reader).Trim()
          }
          'country' {
            $value = (Read-FideXmlElementText $reader).Trim().ToUpperInvariant()
            if ($value -match '^[A-Z]{3}$') { $fed = $value }
          }
          'sex' {
            $value = (Read-FideXmlElementText $reader).Trim().ToUpperInvariant()
            if ($value -match '^[MF]$') { $gender = $value }
          }
          'title' {
            $title = (Read-FideXmlElementText $reader).Trim().ToUpperInvariant()
          }
          'w_title' {
            $wTitle = (Read-FideXmlElementText $reader).Trim().ToUpperInvariant()
          }
          'birthday' {
            $value = (Read-FideXmlElementText $reader).Trim()
            if ($value -match '^(?:19\d{2}|20[0-3]\d)$') { $birth = $value }
          }
          'rating' {
            $std = Convert-ToFideRating (Read-FideXmlElementText $reader)
          }
          'rapid_rating' {
            $rapid = Convert-ToFideRating (Read-FideXmlElementText $reader)
          }
          'blitz_rating' {
            $blitz = Convert-ToFideRating (Read-FideXmlElementText $reader)
          }
          'k' {
            $stdK = Convert-ToFideInt (Read-FideXmlElementText $reader)
          }
          'rapid_k' {
            $rapidK = Convert-ToFideInt (Read-FideXmlElementText $reader)
          }
          'blitz_k' {
            $blitzK = Convert-ToFideInt (Read-FideXmlElementText $reader)
          }
        }
        continue
      }

      if ($reader.NodeType -eq [System.Xml.XmlNodeType]::EndElement -and $reader.LocalName -eq 'player') {
        if ($fideId -and $wanted.ContainsKey($fideId)) {
          $found += ,([pscustomobject]@{
            fideId = $fideId
            name = $name
            fed = $fed
            birth = $birth
            gender = $gender
            title = $title
            wTitle = $wTitle
            std = $std
            rapid = $rapid
            blitz = $blitz
            stdK = $stdK
            rapidK = $rapidK
            blitzK = $blitzK
            stdAvailable = ($std -gt 0)
            rapidAvailable = ($rapid -gt 0)
            blitzAvailable = ($blitz -gt 0)
            source = 'legacy-xml'
          })
          $null = $wanted.Remove($fideId)
        }
        $inPlayer = $false
      }
    }
  } finally {
    $reader.Dispose()
  }

  # Windows PowerShell 5.1 can throw "Argument types do not match" when
  # @() wraps Generic.List[object]. Keep FIDE lookup results as a plain
  # PowerShell array so JSON serialization is stable on the bundled backend.
  return $found
}

function Find-FidePlayerDirectoryEntries([string[]]$FideIds) {
  $txtFile = Join-Path $fideFolder 'players_legacy.txt'
  $xmlFile = Join-Path $fideFolder 'players.xml'

  $ids = @($FideIds | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -match '^\d{5,15}$' } | Select-Object -Unique)
  if ($ids.Count -eq 0) { return @() }
  if ($ids.Count -gt 5000) { throw 'Too many FIDE IDs were requested in one lookup.' }

  # v1.65: prefer the official LEGACY combined TXT list. It is the same source
  # Swiss-Manager-style updates are based on: one row contains FIDE ID,
  # STD/RPD/BLZ ratings, K factors and B-day, including unrated players.
  # Parsing its published header positions is both faster and more robust than
  # walking the full XML document for every tournament update.
  if (Test-Path -LiteralPath $txtFile -PathType Leaf) {
    return @(Find-FidePlayerDirectoryEntriesTxt $txtFile $ids)
  }
  if (Test-Path -LiteralPath $xmlFile -PathType Leaf) {
    return @(Find-FidePlayerDirectoryEntriesXml $xmlFile $ids)
  }
  throw 'The full FIDE LEGACY player directory is not available. Run Download and update FIDE Databases first.'
}

function Sync-PairingTrfScores([string]$Trf) {
  $lines = [regex]::Split($Trf.TrimEnd("`r", "`n"), "\r?\n")
  $repairs = 0

  # TRF26 record 162 can define a tournament-specific pairing-allocated-bye
  # value. ChessPublisher supports PAB = 1.0, 0.5 or 0.0. Do not silently
  # convert U/F history back to one point while reconciling declared scores.
  [double]$pabPoints = 1.0
  foreach ($record in $lines) {
    $recordText = [string]$record
    if (-not $recordText.StartsWith('162')) { continue }
    $m = [regex]::Match($recordText, '(?:^|\s)P\s+([0-9]+(?:[\.,][0-9]+)?)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($m.Success) {
      $rawPab = $m.Groups[1].Value.Replace(',', '.')
      [double]$parsedPab = 1.0
      if ([double]::TryParse($rawPab, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$parsedPab)) {
        $pabPoints = $parsedPab
      }
    }
    break
  }

  for ($lineIndex = 0; $lineIndex -lt $lines.Count; $lineIndex++) {
    $line = [string]$lines[$lineIndex]
    # FIDE TRF16/TRF26 uses columns 81-84 for the declared score and starts
    # Round 1 at column 92 (zero-based offset 91). In each ten-character round
    # block the result is the eighth character (offset +7 / absolute column 99).
    if (-not $line.StartsWith('001') -or $line.Length -le 91) { continue }
    $history = $line.Substring(91)
    [double]$score = 0
    for ($offset = 0; $offset + 9 -lt $history.Length; $offset += 10) {
      $code = [string]$history[$offset + 7]
      if ($code -in @('F', 'U')) { $score += $pabPoints }
      elseif ($code -in @('1', '+', 'W')) { $score += 1 }
      elseif ($code -in @('=', 'H', 'D')) { $score += 0.5 }
    }
    $scoreText = [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0,4:0.0}', $score)
    if ($line.Substring(80, 4) -ne $scoreText) {
      $lines[$lineIndex] = $line.Substring(0, 80) + $scoreText + $line.Substring(84)
      $repairs++
    }
  }
  return [pscustomobject]@{
    Trf = (($lines -join "`r`n") + "`r`n")
    Repairs = $repairs
  }
}

function Assert-PairingTrfHistoryWidth([string]$Trf, [int]$PairingRound) {
  $completedRounds = [Math]::Max(0, $PairingRound - 1)
  if ($completedRounds -eq 0) { return }

  # FIDE round records begin at zero-based offset 91 (column 92) and occupy
  # ten characters each. A Round N request must carry N-1 complete history
  # slots for every player, including blank slots for legitimate unpaired rounds.
  $requiredLength = 91 + (10 * $completedRounds)
  $playerLines = @([regex]::Split($Trf.TrimEnd("`r", "`n"), "\r?\n") | Where-Object { ([string]$_).StartsWith('001') })
  if ($playerLines.Count -lt 2) { throw 'The pairing TRF does not contain a valid player list.' }

  $shortPlayers = New-Object System.Collections.Generic.List[int]
  foreach ($lineValue in $playerLines) {
    $line = [string]$lineValue
    if ($line.Length -ge $requiredLength) { continue }
    $numberText = if ($line.Length -ge 8) { $line.Substring(3, 5).Trim() } else { '0' }
    [int]$number = 0
    [void][int]::TryParse($numberText, [ref]$number)
    $shortPlayers.Add($number)
  }
  if ($shortPlayers.Count -gt 0) {
    $sample = @($shortPlayers | Select-Object -First 8) -join ', '
    throw "Round $PairingRound requires $completedRounds complete historical round record(s) for every player. Missing history for Pairing No.: $sample."
  }
}

# --- CHESSPUBLISHER INDEPENDENT BBP PAIRING CHECKER ---
function Get-BbpPairingCheckerStatus {
  $ready = Test-Path -LiteralPath $bbpExe
  $verified = $false
  $exeSha256 = ''
  $message = ''

  if ($ready) {
    try {
      $exeSha256 = (Get-FileHash -LiteralPath $bbpExe -Algorithm SHA256).Hash.ToUpperInvariant()
      if (Test-Path -LiteralPath $bbpInstallMarker) {
        $marker = [System.IO.File]::ReadAllText($bbpInstallMarker, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        $verified = (
          ([string]$marker.version -eq $bbpVersion) -and
          ([string]$marker.releaseSha256).ToUpperInvariant() -eq $bbpReleaseSha256 -and
          ([string]$marker.exeSha256).ToUpperInvariant() -eq $exeSha256
        )
      }
      if (-not $verified) {
        $message = 'bbpPairings is present but its verified-install marker does not match. Reinstall the independent checker.'
      }
    } catch {
      $message = $_.Exception.Message
      $verified = $false
    }
  } else {
    $message = if ($script:bbpInstallError) { $script:bbpInstallError } else { 'Independent checker is not prepared yet.' }
  }

  return [pscustomobject]@{
    Ready = [bool]($ready -and $verified)
    Present = [bool]$ready
    Verified = [bool]$verified
    Version = $bbpVersion
    ExeSha256 = $exeSha256
    Message = $message
    ReleaseSha256 = $bbpReleaseSha256
  }
}

function Install-BbpPairingChecker {
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('ChessPublisher-BBP-' + [guid]::NewGuid().ToString('N'))
  $zipPath = Join-Path $tempRoot 'bbpPairings.zip'
  $extractPath = Join-Path $tempRoot 'extract'
  try {
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $extractPath -Force | Out-Null

    # GitHub requires modern TLS. Preserve the caller's setting after download.
    $oldTls = [Net.ServicePointManager]::SecurityProtocol
    try {
      [Net.ServicePointManager]::SecurityProtocol = $oldTls -bor [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -UseBasicParsing -Uri $bbpReleaseUrl -OutFile $zipPath -Headers @{ 'User-Agent' = 'ChessPublisher/1.03.77' }
    } finally {
      [Net.ServicePointManager]::SecurityProtocol = $oldTls
    }

    $zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($zipHash -ne $bbpReleaseSha256) {
      throw "bbpPairings download SHA256 mismatch. Expected $bbpReleaseSha256, received $zipHash."
    }

    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force
    $candidate = @(Get-ChildItem -LiteralPath $extractPath -Recurse -File -Filter 'bbpPairings.exe' | Select-Object -First 1)
    if ($candidate.Count -ne 1) { throw 'The verified bbpPairings archive does not contain bbpPairings.exe.' }

    $candidateDir = Split-Path -Parent $candidate[0].FullName
    $staging = $bbpRoot + '.staging-' + [guid]::NewGuid().ToString('N')
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    Copy-Item -Path (Join-Path $candidateDir '*') -Destination $staging -Recurse -Force -ErrorAction Stop

    $stagedExe = Join-Path $staging 'bbpPairings.exe'
    if (-not (Test-Path -LiteralPath $stagedExe)) { throw 'bbpPairings.exe was not staged correctly.' }

    $probeOut = Join-Path $tempRoot 'probe-out.txt'
    $probeErr = Join-Path $tempRoot 'probe-err.txt'
    & $stagedExe '-r' 1> $probeOut 2> $probeErr
    $probeExit = $LASTEXITCODE
    $probeText = ((Get-Content -Raw $probeOut -ErrorAction SilentlyContinue) + "`n" + (Get-Content -Raw $probeErr -ErrorAction SilentlyContinue)).Trim()
    if ($probeExit -ne 0 -or $probeText -notmatch 'BBP Pairings') {
      throw "bbpPairings executable self-test failed (exit=$probeExit). $probeText"
    }

    $exeHash = (Get-FileHash -LiteralPath $stagedExe -Algorithm SHA256).Hash.ToUpperInvariant()
    $markerObject = [ordered]@{
      product = 'bbpPairings'
      version = $bbpVersion
      source = 'BieremaBoyzProgramming/bbpPairings'
      releaseUrl = $bbpReleaseUrl
      releaseSha256 = $bbpReleaseSha256
      exeSha256 = $exeHash
      license = 'Apache-2.0'
      installedUtc = [DateTime]::UtcNow.ToString('o')
    }
    [System.IO.File]::WriteAllText(
      (Join-Path $staging 'ChessPublisher-install.json'),
      ($markerObject | ConvertTo-Json -Depth 5),
      $utf8NoBom
    )
    [System.IO.File]::WriteAllText(
      (Join-Path $staging 'CHESSPUBLISHER-BBP-NOTICE.txt'),
      ("bbpPairings v$bbpVersion`r`nSource: https://github.com/BieremaBoyzProgramming/bbpPairings`r`nLicense: Apache-2.0`r`nRelease archive SHA256: $bbpReleaseSha256`r`nThis executable is downloaded directly from the upstream release and is used only as an independent verifier. Gacrux remains ChessPublisher's pairing generator.`r`n"),
      $utf8NoBom
    )

    if (Test-Path -LiteralPath $bbpRoot) { Remove-Item -LiteralPath $bbpRoot -Recurse -Force }
    Move-Item -LiteralPath $staging -Destination $bbpRoot -Force
    $script:bbpInstallError = ''
    Write-EngineLog "Independent checker prepared: bbpPairings v$bbpVersion, release SHA256 verified."
    return Get-BbpPairingCheckerStatus
  } catch {
    $script:bbpInstallError = $_.Exception.Message
    Write-EngineLog "Independent checker install ERROR: $script:bbpInstallError"
    throw
  } finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
}


# --- CHESSPUBLISHER OFFICIAL GACRUX TIE-BREAK CHECKER ---
function Get-TieBreakCheckerStatus {
  $ready = Test-Path -LiteralPath $tieBreakCheckerExe
  $verified = $false
  $exeSha256 = ''
  $message = ''
  if ($ready) {
    try {
      $exeSha256 = (Get-FileHash -LiteralPath $tieBreakCheckerExe -Algorithm SHA256).Hash.ToUpperInvariant()
      if (Test-Path -LiteralPath $tieBreakCheckerInstallMarker) {
        $marker = [System.IO.File]::ReadAllText($tieBreakCheckerInstallMarker, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        $verified = (
          ([string]$marker.version -eq $tieBreakCheckerVersion) -and
          ([string]$marker.releaseSha256).ToUpperInvariant() -eq $tieBreakCheckerReleaseSha256 -and
          ([string]$marker.exeSha256).ToUpperInvariant() -eq $exeSha256
        )
      }
      if (-not $verified) { $message = 'Tie-Break Checker is present but its verified-install marker does not match. Reinstall it.' }
    } catch {
      $message = $_.Exception.Message
      $verified = $false
    }
  } else {
    $message = if ($script:tieBreakCheckerInstallError) { $script:tieBreakCheckerInstallError } else { 'Official Tie-Break Checker is not prepared yet.' }
  }
  return [pscustomobject]@{
    Ready = [bool]($ready -and $verified); Present = [bool]$ready; Verified = [bool]$verified
    Version = $tieBreakCheckerVersion; ExeSha256 = $exeSha256; Message = $message; ReleaseSha256 = $tieBreakCheckerReleaseSha256
  }
}

function Install-TieBreakChecker {
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('ChessPublisher-TBC-' + [guid]::NewGuid().ToString('N'))
  $zipPath = Join-Path $tempRoot 'tiebreakchecker.zip'
  $extractPath = Join-Path $tempRoot 'extract'
  try {
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $extractPath -Force | Out-Null
    $oldTls = [Net.ServicePointManager]::SecurityProtocol
    try {
      [Net.ServicePointManager]::SecurityProtocol = $oldTls -bor [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -UseBasicParsing -Uri $tieBreakCheckerReleaseUrl -OutFile $zipPath -Headers @{ 'User-Agent' = 'ChessPublisher/1.03.80' }
    } finally { [Net.ServicePointManager]::SecurityProtocol = $oldTls }
    $zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($zipHash -ne $tieBreakCheckerReleaseSha256) {
      throw "Tie-Break Checker download SHA256 mismatch. Expected $tieBreakCheckerReleaseSha256, received $zipHash."
    }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force
    $candidate = @(Get-ChildItem -LiteralPath $extractPath -Recurse -File -Filter 'tiebreakchecker.exe' | Select-Object -First 1)
    if ($candidate.Count -ne 1) { throw 'The verified Gacrux archive does not contain tiebreakchecker.exe.' }
    $candidateDir = Split-Path -Parent $candidate[0].FullName
    $staging = $tieBreakCheckerRoot + '.staging-' + [guid]::NewGuid().ToString('N')
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    Copy-Item -Path (Join-Path $candidateDir '*') -Destination $staging -Recurse -Force -ErrorAction Stop
    $stagedExe = Join-Path $staging 'tiebreakchecker.exe'
    if (-not (Test-Path -LiteralPath $stagedExe)) { throw 'tiebreakchecker.exe was not staged correctly.' }
    $probeOut = Join-Path $tempRoot 'probe-out.txt'; $probeErr = Join-Path $tempRoot 'probe-err.txt'
    & $stagedExe '-V' 1> $probeOut 2> $probeErr
    $probeExit = $LASTEXITCODE
    $probeText = ((Get-Content -Raw $probeOut -ErrorAction SilentlyContinue) + "`n" + (Get-Content -Raw $probeErr -ErrorAction SilentlyContinue)).Trim()
    if ($probeExit -ne 0 -or $probeText -notmatch 'tiebreakchecker' -or $probeText -notmatch '1\.9\.57') {
      throw "Tie-Break Checker executable self-test failed (exit=$probeExit). $probeText"
    }
    $exeHash = (Get-FileHash -LiteralPath $stagedExe -Algorithm SHA256).Hash.ToUpperInvariant()
    $markerObject = [ordered]@{
      product='Gacrux Tie-Break Checker'; version=$tieBreakCheckerVersion; source='OttoMilvang/TieBreakServer'
      distributor='santino/vesus-pairings-desktop'; releaseUrl=$tieBreakCheckerReleaseUrl; releaseSha256=$tieBreakCheckerReleaseSha256
      exeSha256=$exeHash; license='MIT (Copyright FIDE; source by Otto Milvang)'; installedUtc=[DateTime]::UtcNow.ToString('o')
    }
    [System.IO.File]::WriteAllText((Join-Path $staging 'ChessPublisher-install.json'),($markerObject | ConvertTo-Json -Depth 5),$utf8NoBom)
    [System.IO.File]::WriteAllText(
      (Join-Path $staging 'CHESSPUBLISHER-TIEBREAK-NOTICE.txt'),
      ("Gacrux Tie-Break Checker $tieBreakCheckerVersion`r`nSource: https://github.com/OttoMilvang/TieBreakServer`r`nVerified binary distributor: https://github.com/santino/vesus-pairings-desktop/releases/tag/gacrux-v1.9.57`r`nLicense: MIT; Copyright (c) 2024 FIDE; source developed by Otto Milvang and donated to FIDE.`r`nRelease archive SHA256: $tieBreakCheckerReleaseSha256`r`nUsed by ChessPublisher only as an independent tie-break/ranking verifier.`r`n"),
      $utf8NoBom
    )
    if (Test-Path -LiteralPath $tieBreakCheckerRoot) { Remove-Item -LiteralPath $tieBreakCheckerRoot -Recurse -Force }
    Move-Item -LiteralPath $staging -Destination $tieBreakCheckerRoot -Force
    $script:tieBreakCheckerInstallError = ''
    Write-EngineLog "Tie-Break Checker prepared: Gacrux $tieBreakCheckerVersion, release SHA256 verified."
    return Get-TieBreakCheckerStatus
  } catch {
    $script:tieBreakCheckerInstallError = $_.Exception.Message
    Write-EngineLog "Tie-Break Checker install ERROR: $script:tieBreakCheckerInstallError"
    throw
  } finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function Get-TieBreakExpectedRanksFromTrf([string]$Trf) {
  $map = @{}
  foreach ($line in ($Trf -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -lt 89 -or $line.Substring(0,3) -ne '001') { continue }
    $id = 0; $rank = 0
    [void][int]::TryParse($line.Substring(4,4).Trim(), [ref]$id)
    [void][int]::TryParse($line.Substring(85,4).Trim(), [ref]$rank)
    if ($id -gt 0 -and $rank -gt 0) { $map[[string]$id] = $rank }
  }
  return $map
}

function Read-TieBreakCheckerText([string]$Path,[string[]]$RequestedTieBreaks) {
  $text = Get-Content -Raw -LiteralPath $Path -ErrorAction Stop
  $lines = @($text -split "`r?`n")
  $headerIndex = -1; $headers = @(); $check = $null
  for ($i=0; $i -lt $lines.Count; $i++) {
    $line = [string]$lines[$i]
    if ($line -match '^Check:\s*(True|False)\s*$') { $check = ($Matches[1] -eq 'True') }
    if ($headerIndex -lt 0 -and $line -match '^(Rank|StartNo)\t(StartNo|Rank)(\t|$)') {
      $headerIndex = $i; $headers = @($line -split "`t")
    }
  }
  if ($headerIndex -lt 0) { throw 'Tie-Break Checker output has no Rank/StartNo header.' }
  $rankIndex = [Array]::IndexOf($headers,'Rank'); $startIndex = [Array]::IndexOf($headers,'StartNo')
  if ($rankIndex -lt 0 -or $startIndex -lt 0) { throw 'Tie-Break Checker output header is incomplete.' }
  $rows = @()
  for ($i=$headerIndex+1; $i -lt $lines.Count; $i++) {
    $line = [string]$lines[$i]
    if ([string]::IsNullOrWhiteSpace($line) -or $line -match '^Check:') { continue }
    $parts = @($line -split "`t")
    if ($parts.Count -lt 2) { continue }
    $rank=0; $start=0
    if (-not [int]::TryParse(([string]$parts[$rankIndex]).Trim(),[ref]$rank)) { continue }
    if (-not [int]::TryParse(([string]$parts[$startIndex]).Trim(),[ref]$start)) { continue }
    $values = [ordered]@{}
    for ($j=2; $j -lt [Math]::Min($headers.Count,$parts.Count); $j++) { $values[[string]$headers[$j]] = ([string]$parts[$j]).Trim() }
    $rows += [pscustomobject]@{ Rank=$rank; StartNo=$start; Values=$values }
  }
  if ($rows.Count -eq 0) { throw 'Tie-Break Checker output contains no competitor rows.' }
  return [pscustomobject]@{ Text=$text; Headers=$headers; Rows=$rows; Check=$check }
}

function Invoke-TieBreakValidation([string]$Trf,[int]$Round,[string]$Mode,[string[]]$TieBreaks,$Expected) {
  $status = Get-TieBreakCheckerStatus
  if (-not $status.Ready) {
    return [pscustomobject]@{ Available=$false; Ok=$false; Check=$null; Round=$Round; Version=$tieBreakCheckerVersion; State='unavailable'; Message=[string]$status.Message; Rules=''; Mismatches=@() }
  }
  if ($Round -lt 1) { throw 'Tie-Break Checker requires at least one completed round.' }
  if ([string]::IsNullOrWhiteSpace($Trf)) { throw 'Tie-Break Checker received an empty TRF.' }
  $requested = @($TieBreaks | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ } | Select-Object -Unique)
  if ($requested.Count -eq 0 -or $requested[0] -ne 'PTS') { $requested = @('PTS') + @($requested | Where-Object { $_ -ne 'PTS' }) }
  $temp = Join-Path ([System.IO.Path]::GetTempPath()) ('ChessPublisher-TieBreak-' + [guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Path $temp -Force | Out-Null
    $input=Join-Path $temp 'tiebreak-input.trf'; $output=Join-Path $temp 'tiebreak-output.txt'; $stdout=Join-Path $temp 'stdout.txt'; $stderr=Join-Path $temp 'stderr.txt'
    [System.IO.File]::WriteAllText($input,$Trf,[System.Text.Encoding]::GetEncoding(28591))
    $args=@('-i',$input,'-o',$output,'-f','TRF','-F','TXT','-n',[string]$Round,'-c','-r','-d','T')
    if ($Mode -eq 'rr') { $args += '-p' } else { $args += '-s' }
    $args += '-t'; $args += $requested
    & $tieBreakCheckerExe @args 1> $stdout 2> $stderr
    $exitCode=$LASTEXITCODE
    $details=((Get-Content -Raw $stderr -ErrorAction SilentlyContinue)+"`n"+(Get-Content -Raw $stdout -ErrorAction SilentlyContinue)).Trim()
    if (-not (Test-Path -LiteralPath $output)) { throw "Tie-Break Checker produced no output (exit=$exitCode). $details" }
    $parsed=Read-TieBreakCheckerText $output $requested
    $trfRanks=Get-TieBreakExpectedRanksFromTrf $Trf
    $mismatches=@()
    $checkerByStart=@{}
    foreach($row in @($parsed.Rows)) { $checkerByStart[[string][int]$row.StartNo]=$row }

    # ChessPublisher assigns a persistent drawing-of-lots order when every
    # announced tie-break is still equal. The upstream checker legitimately
    # keeps such competitors in one rank group. Therefore compare the ORDER OF
    # CHECKER RANK GROUPS, not unique row numbers inside an unresolved group.
    $expectedRows=@($Expected)
    if($expectedRows.Count -eq 0){
      $expectedRows=@($trfRanks.GetEnumerator() | ForEach-Object { [pscustomobject]@{ startNo=[int]$_.Key; rank=[int]$_.Value; values=$null } })
    }
    $orderedExpected=@($expectedRows | Sort-Object { [int]$_.rank }, { [int]$_.startNo })
    $lastCheckerRank=0
    foreach($exp in $orderedExpected){
      $key=[string][int]$exp.startNo
      if(-not $checkerByStart.ContainsKey($key)){ $mismatches += "StartNo $key is missing from the Gacrux output."; continue }
      $checkerRow=$checkerByStart[$key]
      $checkerRank=[int]$checkerRow.Rank
      if($lastCheckerRank -gt 0 -and $checkerRank -lt $lastCheckerRank){
        $mismatches += ("Rank-group order differs at StartNo {0}: Gacrux rank group {1} follows group {2} in ChessPublisher order." -f $key,$checkerRank,$lastCheckerRank)
      }
      if($checkerRank -gt $lastCheckerRank){$lastCheckerRank=$checkerRank}

      # Compare stable numeric tie-break values as a second independent layer.
      # Direct Encounter is intentionally omitted by the UI payload because its
      # recursive group representation is not a single portable display scalar.
      if($null -ne $exp.values){
        foreach($prop in @($exp.values.PSObject.Properties)){
          $descriptor=[string]$prop.Name
          $expectedNumber=0.0
          try{$expectedNumber=[double]$prop.Value}catch{continue}
          $rawValue=$null
          try{$rawValue=$checkerRow.Values[$descriptor]}catch{$rawValue=$null}
          if($null -eq $rawValue){$mismatches += ("StartNo {0}: Gacrux output is missing tie-break value {1}." -f $key,$descriptor);continue}
          $actualNumber=0.0
          $parsedNumber=[double]::TryParse(([string]$rawValue).Trim(),[System.Globalization.NumberStyles]::Float,[System.Globalization.CultureInfo]::InvariantCulture,[ref]$actualNumber)
          if(-not $parsedNumber){$mismatches += ("StartNo {0}: Gacrux returned non-numeric {1} value '{2}'." -f $key,$descriptor,[string]$rawValue);continue}
          if([Math]::Abs($actualNumber-$expectedNumber) -gt 0.011){
            $mismatches += ("StartNo {0}: {1} ChessPublisher={2}, Gacrux={3}" -f $key,$descriptor,$expectedNumber,$actualNumber)
          }
        }
      }
    }
    if (@($parsed.Rows).Count -ne $expectedRows.Count) { $mismatches += ("Competitor count differs: ChessPublisher {0}, Gacrux {1}" -f $expectedRows.Count,@($parsed.Rows).Count) }
    $check = if ($null -ne $parsed.Check) { [bool]$parsed.Check } else { $null }
    $ok = [bool]($mismatches.Count -eq 0)
    $state = if ($ok) { 'pass' } else { 'fail' }
    $rules='2026-03-01'
    $message = if ($ok) {
      if($check -eq $false){
        "Gacrux Tie-Break Checker $tieBreakCheckerVersion computed the same tie-break values/rank-group order through Round $Round. Exact ties are resolved by ChessPublisher's persistent drawing of lots, so upstream Check: False is expected for unique row numbers inside those groups."
      }else{
        "Gacrux Tie-Break Checker $tieBreakCheckerVersion independently computed the same tie-break values and ranking through Round $Round."
      }
    } else {
      $preview=@($mismatches | Select-Object -First 8) -join '; '
      "Tie-break validation differs through Round $Round. $preview"
    }
    Write-EngineLog ("Tie-Break Checker {0} through Round {1}: {2}" -f $state.ToUpperInvariant(),$Round,$message)
    return [pscustomobject]@{ Available=$true; Ok=$ok; Check=$check; Round=$Round; Version=$tieBreakCheckerVersion; State=$state; Message=$message; Rules=$rules; Mismatches=@($mismatches); Output=[string]$parsed.Text; ExitCode=$exitCode }
  } catch {
    $msg=$_.Exception.Message
    Write-EngineLog ("Tie-Break Checker ERROR through Round {0}: {1}" -f $Round,$msg)
    return [pscustomobject]@{ Available=$true; Ok=$false; Check=$null; Round=$Round; Version=$tieBreakCheckerVersion; State='error'; Message=$msg; Rules=''; Mismatches=@() }
  } finally {
    if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue}
  }
}
# --- END CHESSPUBLISHER OFFICIAL GACRUX TIE-BREAK CHECKER ---

# bbpPairings v6.0.0 has only initial TRF26 support and still expects the
# legacy result symbol Z in record 162 for absence/zero-point-bye/forfeit loss.
# Official FIDE TRF26 uses A for this scoring-system symbol.  Keep the canonical
# ChessPublisher/Gacrux TRF unchanged and normalize ONLY the temporary copy
# supplied to the independent BBP verifier.
function Convert-Trf26ForBbpPairings600([string]$TrfText) {
  if ([string]::IsNullOrEmpty($TrfText)) { return $TrfText }

  $lines = [regex]::Split($TrfText, "`r?`n")
  for ($lineIndex = 0; $lineIndex -lt $lines.Length; $lineIndex++) {
    $line = [string]$lines[$lineIndex]
    if ($line.Length -lt 10 -or -not $line.StartsWith('162')) { continue }

    $chars = $line.ToCharArray()
    # TRF26 record 162 result symbols are at 1-based columns 6, 15, 24, ...
    # (zero-based indexes 5, 14, 23, ...), i.e. every 9 characters.
    for ($fieldIndex = 5; $fieldIndex -lt $chars.Length; $fieldIndex += 9) {
      if ($chars[$fieldIndex] -eq 'A' -or $chars[$fieldIndex] -eq 'a') {
        $chars[$fieldIndex] = 'Z'
      }
    }
    $lines[$lineIndex] = -join $chars
  }
  return ($lines -join "`r`n")
}

function Add-BbpCurrentRoundUnpairedMarkers(
  [string]$Trf,
  [int]$PairingRound,
  $Unpaired
) {
  $completedRounds = [Math]::Max(0, $PairingRound - 1)
  $baseLength = 91 + (10 * $completedRounds)
  $targetLength = $baseLength + 10

  $unpairedSet = @{}
  foreach ($id in @($Unpaired)) {
    [int]$number = 0
    if ([int]::TryParse([string]$id, [ref]$number) -and $number -gt 0) {
      $unpairedSet[$number] = $true
    }
  }

  $lines = [regex]::Split($Trf.TrimEnd("`r", "`n"), "\r?\n")
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = [string]$lines[$i]
    if (-not $line.StartsWith('001')) { continue }

    if ($line.Length -lt $baseLength) {
      $line = $line.PadRight($baseLength, ' ')
    } elseif ($line.Length -gt $baseLength) {
      # The independent checker must see only completed history.  Any
      # accidentally supplied current-round block is removed here.
      $line = $line.Substring(0, $baseLength)
    }

    $numberText = if ($line.Length -ge 8) { $line.Substring(3,5).Trim() } else { '0' }
    [int]$number = 0
    [void][int]::TryParse($numberText, [ref]$number)

    if ($number -gt 0 -and $unpairedSet.ContainsKey($number)) {
      # bbpPairings -p reads its input with includesUnpairedRound=true.
      # A temporary current-round zero-bye marker removes this player from
      # the generated matching without changing any completed history.
      $lines[$i] = $line.PadRight($targetLength, ' ').Substring(0,$baseLength) + '0000 - Z  '
    } else {
      $lines[$i] = $line
    }
  }

  return (($lines -join "`r`n") + "`r`n")
}

function Invoke-BbpPairingCheck(
  [string]$InputTrf,
  [int]$PairingRound,
  $Pairs,
  [string]$TempFolder,
  $Unpaired = @()
) {
  $status = Get-BbpPairingCheckerStatus
  if (-not $status.Ready) {
    return [pscustomobject]@{
      Available = $false
      Ok = $false
      Check = $null
      Round = $PairingRound
      Version = $bbpVersion
      State = 'unavailable'
      Message = [string]$status.Message
      MismatchRounds = @()
    }
  }

  $bbpInput = Join-Path $TempFolder 'bbp-checker.trf'
  $bbpOutput = Join-Path $TempFolder 'bbp-generated-pairing.txt'
  $bbpStdout = Join-Path $TempFolder 'bbp-checker-stdout.txt'
  $bbpStderr = Join-Path $TempFolder 'bbp-checker-stderr.txt'

  try {
    # IMPORTANT: -c cannot validate a just-generated round whose game results
    # are still blank; bbpPairings 6.0.0 rejects opponent+colour+blank result
    # in a 001 round block.  The independent verification therefore uses the
    # correct next-round workflow: feed completed history only, ask BBP to
    # generate the next Dutch pairing with -p, then compare that result with
    # the Gacrux pairing.  BBP never replaces or commits a ChessPublisher pair.
    $checkerTrf = [string]$InputTrf
    $checkerTrf = Add-BbpCurrentRoundUnpairedMarkers $checkerTrf $PairingRound $Unpaired
    $checkerTrf = Convert-Trf26ForBbpPairings600 $checkerTrf
    [System.IO.File]::WriteAllText($bbpInput, $checkerTrf, [System.Text.Encoding]::ASCII)

    & $bbpExe '--dutch' $bbpInput '-p' $bbpOutput 1> $bbpStdout 2> $bbpStderr
    $exitCode = $LASTEXITCODE
    $stdoutText = Get-Content -Raw $bbpStdout -ErrorAction SilentlyContinue
    $stderrText = Get-Content -Raw $bbpStderr -ErrorAction SilentlyContinue
    $allText = (([string]$stdoutText) + "`n" + ([string]$stderrText)).Trim()

    if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $bbpOutput)) {
      $preview = $allText
      if ($preview.Length -gt 2500) { $preview = $preview.Substring(0,2500) + '...' }
      $state = if ($exitCode -eq 1) { 'fail' } else { 'error' }
      $check = if ($exitCode -eq 1) { $false } else { $null }
      Write-EngineLog "BBP independent next-round verifier Round ${PairingRound}: exit=$exitCode."
      return [pscustomobject]@{
        Available = $true; Ok = $false; Check = $check; Round = $PairingRound
        Version = $bbpVersion; State = $state
        Message = "bbpPairings could not independently generate Round $PairingRound (exit=$exitCode). $preview"
        MismatchRounds = if ($state -eq 'fail') { @($PairingRound) } else { @() }
      }
    }

    $bbpParsed = Read-GacruxPairingText $bbpOutput 'bbpPairings'
    $bbpPairs = [object[]]$bbpParsed.Pairs

    # Compare the actual white/black assignment (including PAB as black=0).
    # Board-order presentation is intentionally not part of this equality
    # test; the FIDE pairing identity and colours are.
    $gacruxKeys = @(
      @($Pairs) | ForEach-Object {
        if ($_.Count -lt 2) { throw 'Gacrux returned an incomplete pair to the independent checker.' }
        ('{0}:{1}' -f [int]$_[0],[int]$_[1])
      } | Sort-Object
    )
    $bbpKeys = @(
      @($bbpPairs) | ForEach-Object {
        if ($_.Count -lt 2) { throw 'bbpPairings returned an incomplete pair.' }
        ('{0}:{1}' -f [int]$_[0],[int]$_[1])
      } | Sort-Object
    )

    $diff = @(Compare-Object -ReferenceObject $gacruxKeys -DifferenceObject $bbpKeys)
    if ($diff.Count -gt 0 -or $gacruxKeys.Count -ne $bbpKeys.Count) {
      $details = @($diff | Select-Object -First 20 | ForEach-Object { "$($_.InputObject) $($_.SideIndicator)" }) -join '; '
      if ([string]::IsNullOrWhiteSpace($details)) {
        $details = "Gacrux pair count=$($gacruxKeys.Count), BBP pair count=$($bbpKeys.Count)."
      }
      Write-EngineLog "BBP independent checker REJECTED Round ${PairingRound}: $details"
      return [pscustomobject]@{
        Available = $true; Ok = $false; Check = $false; Round = $PairingRound
        Version = $bbpVersion; State = 'fail'
        Message = "Independent Dutch regeneration differs from Gacrux in Round $PairingRound. $details"
        MismatchRounds = @($PairingRound)
      }
    }

    Write-EngineLog "BBP independent checker PASS Round ${PairingRound}: independently regenerated the same Dutch pairing."
    return [pscustomobject]@{
      Available = $true; Ok = $true; Check = $true; Round = $PairingRound
      Version = $bbpVersion; State = 'pass'
      Message = "bbpPairings v$bbpVersion independently regenerated the same Dutch Round $PairingRound pairing."
      MismatchRounds = @()
    }
  } catch {
    $msg = $_.Exception.Message
    Write-EngineLog "BBP independent checker ERROR Round ${PairingRound}: $msg"
    return [pscustomobject]@{
      Available = $true; Ok = $false; Check = $null; Round = $PairingRound
      Version = $bbpVersion; State = 'error'; Message = $msg; MismatchRounds = @()
    }
  }
}

# --- END CHESSPUBLISHER INDEPENDENT BBP PAIRING CHECKER ---

# --- CHESSPUBLISHER STRICT PAIRING CHECKER ---
function Add-GeneratedPairingToTrf(
  [string]$Trf,
  [int]$PairingRound,
  $Pairs
) {
  $completedRounds = [Math]::Max(0, $PairingRound - 1)
  $baseLength = 91 + (10 * $completedRounds)
  $targetLength = $baseLength + 10

  $lines = [regex]::Split($Trf.TrimEnd("`r", "`n"), "\r?\n")
  $playerLineByNumber = @{}

  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = [string]$lines[$i]
    if (-not $line.StartsWith('001')) { continue }

    if ($line.Length -lt $baseLength) {
      $line = $line.PadRight($baseLength, ' ')
    } elseif ($line.Length -gt $baseLength) {
      $line = $line.Substring(0, $baseLength)
    }

    $line = $line.PadRight($targetLength, ' ')
    $lines[$i] = $line

    $numberText = if ($line.Length -ge 8) {
      $line.Substring(3,5).Trim()
    } else {
      '0'
    }

    [int]$number = 0
    [void][int]::TryParse($numberText, [ref]$number)
    if ($number -gt 0) {
      $playerLineByNumber[$number] = $i
    }
  }

  foreach ($pair in @($Pairs)) {
    if ($pair.Count -lt 2) {
      throw 'Cannot build checker TRF from an incomplete Gacrux pair.'
    }

    $white = [int]$pair[0]
    $black = [int]$pair[1]

    if (-not $playerLineByNumber.ContainsKey($white)) {
      throw "Checker TRF cannot find Pairing No. $white."
    }

    if ($black -gt 0) {
      if (-not $playerLineByNumber.ContainsKey($black)) {
        throw "Checker TRF cannot find Pairing No. $black."
      }

      $whiteBlock = ('{0,4} w    ' -f $black)
      $blackBlock = ('{0,4} b    ' -f $white)

      $wi = [int]$playerLineByNumber[$white]
      $bi = [int]$playerLineByNumber[$black]

      $lines[$wi] = $lines[$wi].Substring(0,$baseLength) + $whiteBlock
      $lines[$bi] = $lines[$bi].Substring(0,$baseLength) + $blackBlock
    } else {
      $pabBlock = '     - U  '
      $wi = [int]$playerLineByNumber[$white]
      $lines[$wi] = $lines[$wi].Substring(0,$baseLength) + $pabBlock
    }
  }

  return (($lines -join "`r`n") + "`r`n")
}


function Read-GacruxPairingText([string]$FilePath, [string]$ContextLabel) {
  if (-not (Test-Path -LiteralPath $FilePath)) {
    throw "$ContextLabel did not create a pairing output file."
  }
  $raw = [System.IO.File]::ReadAllText($FilePath)
  $lines = @(
    $raw -split "`r?`n" |
      ForEach-Object { ([string]$_).Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  )
  if ($lines.Count -lt 2) {
    throw "$ContextLabel returned no pairing."
  }
  $pairCount = 0
  if (-not [int]::TryParse([string]$lines[0], [ref]$pairCount) -or $pairCount -lt 1) {
    throw "$ContextLabel returned an unreadable pairing count: $($lines[0])"
  }
  if ($lines.Count -lt ($pairCount + 1)) {
    throw "$ContextLabel returned $($lines.Count - 1) pair line(s); $pairCount were expected."
  }
  # Windows PowerShell 5.1 can throw "Argument types do not match" when
  # @() wraps a Generic.List[object] created through New-Object.  Keep this
  # parser on plain PowerShell arrays; a tournament has at most a few hundred
  # pair entries, so the simpler representation is also the safest one here.
  $pairs = @()
  $pairingLines = @([string]$pairCount)
  for ($i = 1; $i -le $pairCount; $i++) {
    $m = [regex]::Match([string]$lines[$i], '^\s*(\d+)\s+(\d+)\s*$')
    if (-not $m.Success) {
      throw "$ContextLabel returned an unreadable pair line: $($lines[$i])"
    }
    $white = [int]$m.Groups[1].Value
    $black = [int]$m.Groups[2].Value
    $pairs += ,([int[]]@($white,$black))
    $pairingLines += ('{0} {1}' -f $white,$black)
  }
  return [pscustomobject]@{
    Pairs = $pairs
    Text = ($pairingLines -join "`r`n")
  }
}

function Invoke-GacruxPairingCheck(
  [string]$InputTrf,
  [int]$PairingRound,
  [int]$AnnouncedRounds,
  [string]$TopColor,
  $Pairs,
  $Unpaired,
  [string]$TempFolder
) {
  $checkerUnpaired = @(
    $Unpaired |
      ForEach-Object { [int]$_ } |
      Where-Object { $_ -gt 0 } |
      Select-Object -Unique
  )

  # ------------------------------------------------------------------
  # GACRUX UNPAIRED-SAFE VERIFICATION
  #
  # Upstream Gacrux treats competitor.present differently in pairing mode
  # and check-only mode.  In crosstable.py, present=False is applied only
  # when NOT checkonly.  Therefore "-c ... -u <players>" cannot reliably
  # validate a round containing intentionally unpaired competitors.
  #
  # When unpaired competitors exist, verify by a SECOND, independent Gacrux
  # pairing invocation using the exact same tournament history and constraints,
  # then compare every generated pair 1:1.  No ChessPublisher pairing logic is
  # involved in this verification.
  # ------------------------------------------------------------------
  if ($checkerUnpaired.Count -gt 0) {
    $verifyInput = Join-Path $TempFolder 'verify-unpaired.trf'
    $verifyOutput = Join-Path $TempFolder 'verify-unpaired.txt'
    $verifyStdout = Join-Path $TempFolder 'verify-unpaired-stdout.txt'
    $verifyStderr = Join-Path $TempFolder 'verify-unpaired-stderr.txt'

    [System.IO.File]::WriteAllText(
      $verifyInput,
      [string]$InputTrf,
      [System.Text.Encoding]::ASCII
    )

    $verifyArguments = @(
      '-p', '-m', 'dutch',
      '-i', $verifyInput, '-o', $verifyOutput,
      '-f', 'TRF', '-F', 'JSON', '-d', 'T',
      '-n', [string]$PairingRound,
      '-N', [string]$AnnouncedRounds,
      '-t', $TopColor,
      '-x', 'weighted',
      '-u'
    )
    $verifyArguments += @($checkerUnpaired | ForEach-Object { [string]$_ })

    & $gacrux @verifyArguments 1> $verifyStdout 2> $verifyStderr
    $verifyExitCode = $LASTEXITCODE

    $verifyDetails = (
      (Get-Content -Raw $verifyStderr -ErrorAction SilentlyContinue) +
      "`n" +
      (Get-Content -Raw $verifyStdout -ErrorAction SilentlyContinue)
    ).Trim()

    if ($verifyExitCode -ne 0 -or -not (Test-Path -LiteralPath $verifyOutput)) {
      if ($verifyDetails) {
        throw "Gacrux unpaired verification failed: $verifyDetails"
      }
      throw "Gacrux unpaired verification exited with code $verifyExitCode."
    }

    $verifyParsed = Read-GacruxPairingText $verifyOutput "Gacrux unpaired verification"
    $verifyStatus = 0
    $verifiedPairs = [object[]]$verifyParsed.Pairs

    $originalPairStrings = @(
      $Pairs | ForEach-Object {
        if ($_.Count -lt 2) {
          throw "Original Gacrux pairing contains an incomplete pair."
        }
        '{0}-{1}' -f [int]$_[0], [int]$_[1]
      }
    )

    $verifiedPairStrings = @(
      $verifiedPairs | ForEach-Object {
        if ($_.Count -lt 2) {
          throw "Verification Gacrux pairing contains an incomplete pair."
        }
        '{0}-{1}' -f [int]$_[0], [int]$_[1]
      }
    )

    $samePairing =
      ($originalPairStrings.Count -eq $verifiedPairStrings.Count) -and
      (($originalPairStrings -join '|') -ceq ($verifiedPairStrings -join '|'))

    Write-EngineLog (
      "Gacrux unpaired verification Round {0}: status={1}, match={2}, generatedPairs={3}, verifierPairs={4}, unpaired={5}" -f
      $PairingRound,
      $verifyStatus,
      $samePairing,
      $originalPairStrings.Count,
      $verifiedPairStrings.Count,
      ($checkerUnpaired -join ',')
    )

    if (-not $samePairing) {
      throw (
        "Gacrux unpaired verification found a different Round $PairingRound pairing. " +
        "Generated: " + ($originalPairStrings -join ', ') + ". " +
        "Verifier: " + ($verifiedPairStrings -join ', ') + "."
      )
    }

    return [pscustomobject]@{
      Ok = $true
      Round = $PairingRound
      StatusCode = $verifyStatus
      Check = $true
      Rules = 'FIDE Dutch System — Gacrux 1.9.57 weighted'
      Mode = 'unpaired-regeneration'
    }
  }

  # ------------------------------------------------------------------
  # NORMAL STRICT GACRUX PAIRING CHECKER
  # No unpaired competitors: use Gacrux's official check mode.
  #
  # Windows PowerShell 5.1 cannot safely deserialize Gacrux weighted JSON
  # because the diagnostic quality vector may contain very large Python ints.
  # v1.51 therefore tried Gacrux's compact "@" status prefix, but upstream
  # commonmain.py has a write-output defect in that exact path and can emit
  # "### Error 503" after the checker itself has already run successfully.
  #
  # Gacrux's documented plain text check mode (-c -d T) does not use the
  # broken compact-status writer and finishes with its own "Check: True" or
  # "Check: False" line.  Parse only that authoritative line.  The actual
  # Dutch weighted checker remains Gacrux; ChessPublisher does not re-check
  # pairing rules itself.
  # ------------------------------------------------------------------
  $checkInput = Join-Path $TempFolder 'checker.trf'
  $checkOutput = Join-Path $TempFolder 'checker.txt'
  $checkStdout = Join-Path $TempFolder 'checker-stdout.txt'
  $checkStderr = Join-Path $TempFolder 'checker-stderr.txt'

  $checkerTrf = Add-GeneratedPairingToTrf $InputTrf $PairingRound $Pairs

  # The checker copy contains the CURRENT generated round.  If that round has
  # a pairing-allocated bye (U/PAB), its round record immediately contributes
  # points.  The input TRF score field, however, correctly contains only the
  # score BEFORE the round.  Reconcile the checker-only copy after appending
  # the current pairing so Gacrux sees a self-consistent TRF.  This does not
  # change the TRF used to GENERATE the pairing.
  $checkerSyncedTrf = Sync-PairingTrfScores ([string]$checkerTrf)
  if ($checkerSyncedTrf.Repairs -gt 0) {
    Write-EngineLog "Pairing Checker Round ${PairingRound}: reconciled $($checkerSyncedTrf.Repairs) score field(s) after appending the current pairing/PAB."
  }
  $checkerTrf = [string]$checkerSyncedTrf.Trf

  [System.IO.File]::WriteAllText(
    $checkInput,
    [string]$checkerTrf,
    [System.Text.Encoding]::ASCII
  )

  $checkArguments = @(
    '-c', '-m', 'dutch',
    '-i', $checkInput, '-o', $checkOutput,
    '-f', 'TRF', '-F', 'JSON',
    '-n', [string]$PairingRound,
    '-N', [string]$AnnouncedRounds,
    '-t', $TopColor,
    '-x', 'weighted',
    '-d', 'T'
  )

  & $gacrux @checkArguments 1> $checkStdout 2> $checkStderr
  $checkExitCode = $LASTEXITCODE

  $checkDetails = (
    (Get-Content -Raw $checkStderr -ErrorAction SilentlyContinue) +
    "`n" +
    (Get-Content -Raw $checkStdout -ErrorAction SilentlyContinue)
  ).Trim()

  if (-not (Test-Path -LiteralPath $checkOutput)) {
    if ($checkDetails) {
      throw "Gacrux Pairing Checker failed: $checkDetails"
    }
    throw "Gacrux Pairing Checker did not create its checker output (exit code $checkExitCode)."
  }

  $checkerText = [System.IO.File]::ReadAllText($checkOutput)
  $checkerLines = @(
    $checkerText -split "`r?`n" |
      ForEach-Object { ([string]$_).Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
  )
  if ($checkerLines.Count -lt 1) {
    throw "Gacrux Pairing Checker returned an empty status for Round $PairingRound."
  }

  # Gacrux write_error_file() uses "### Error <code>" in delimited/text mode.
  # Surface the real body instead of misclassifying it as a check result.
  $errorHeader = [regex]::Match(
    [string]$checkerLines[0],
    '^###\s+Error\s+(\d+)\s*$',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  if ($errorHeader.Success) {
    $gacruxStatus = [int]$errorHeader.Groups[1].Value
    $errorBody = if ($checkerLines.Count -gt 1) {
      (($checkerLines | Select-Object -Skip 1) -join ' | ').Trim()
    } else { '' }
    if ($errorBody.Length -gt 3000) { $errorBody = $errorBody.Substring(0,3000) + '...' }
    $message = "Gacrux Pairing Checker failed for Round $PairingRound (status=$gacruxStatus)."
    if ($errorBody) { $message += " $errorBody" }
    if ($checkDetails) { $message += " $checkDetails" }
    throw $message
  }

  $checkLine = @(
    $checkerLines |
      Where-Object { ([string]$_) -match '^Check:\s*(True|False)\s*$' } |
      Select-Object -Last 1
  )
  if ($checkLine.Count -lt 1) {
    $preview = ($checkerLines | Select-Object -Last 8) -join ' | '
    if ($preview.Length -gt 1500) { $preview = $preview.Substring(0,1500) + '...' }
    throw "Gacrux Pairing Checker returned no Check: True/False result for Round ${PairingRound}. Output: $preview"
  }

  $checkMatch = [regex]::Match(
    [string]$checkLine[0],
    '^Check:\s*(True|False)\s*$',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  $checkValue = $checkMatch.Success -and ($checkMatch.Groups[1].Value -ieq 'True')
  $statusCode = if ($checkValue) { 0 } else { 1 }

  Write-EngineLog (
    "Pairing Checker Round {0}: processExit={1}, status={2}, check={3}, parser=plain-text-check" -f
    $PairingRound,
    $checkExitCode,
    $statusCode,
    $checkValue
  )

  if ($checkExitCode -ne 0) {
    $message = "Gacrux Pairing Checker process failed for Round $PairingRound (exit=$checkExitCode)."
    if ($checkDetails) { $message += " $checkDetails" }
    throw $message
  }

  if (-not $checkValue) {
    $body = ($checkerLines -join ' | ').Trim()
    if ($body.Length -gt 3000) { $body = $body.Substring(0,3000) + '...' }
    throw "Gacrux Pairing Checker rejected Round $PairingRound. $body"
  }

  return [pscustomobject]@{
    Ok = $true
    Round = $PairingRound
    StatusCode = $statusCode
    Check = $checkValue
    Rules = ''
    Mode = 'pairing-checker-plain-text'
  }
}

# --- END CHESSPUBLISHER STRICT PAIRING CHECKER ---

# --- CP WINDOWS DIALOG HELPERS START ---
function Ensure-ChessPublisherWindowsForms {
  if (-not ('System.Windows.Forms.SaveFileDialog' -as [type])) {
    Add-Type -AssemblyName System.Windows.Forms
  }
  [System.Windows.Forms.Application]::EnableVisualStyles()
}

function Get-TournamentNameFromJsonPath([string]$FilePath) {
  $full = [System.IO.Path]::GetFullPath($FilePath)
  $base = [System.IO.Path]::GetFileNameWithoutExtension($full)

  if ($base -ieq 'tournament') {
    $parent = Split-Path -Parent $full
    $folderName = Split-Path -Leaf $parent
    if (-not [string]::IsNullOrWhiteSpace($folderName)) { return $folderName }
  }

  if ([string]::IsNullOrWhiteSpace($base)) { return 'Tournament' }
  return $base
}

function Show-ChessPublisherSaveDialog([string]$SuggestedName) {
  Ensure-ChessPublisherWindowsForms
  $safeName = Get-SafeTournamentFolderName $SuggestedName

  $d = New-Object System.Windows.Forms.SaveFileDialog
  try {
    $d.Title = 'Save Tournament As'
    $d.InitialDirectory = $tournamentsRoot
    $d.FileName = ($safeName + '.json')
    $d.Filter = 'ChessPublisher tournament (*.json)|*.json|JSON files (*.json)|*.json|All files (*.*)|*.*'
    $d.DefaultExt = 'json'
    $d.AddExtension = $true
    $d.OverwritePrompt = $true
    $d.CheckPathExists = $true
    $d.RestoreDirectory = $true

    if ($d.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
    return [System.IO.Path]::GetFullPath($d.FileName)
  }
  finally { $d.Dispose() }
}

function Show-ChessPublisherOpenDialog {
  Ensure-ChessPublisherWindowsForms

  $d = New-Object System.Windows.Forms.OpenFileDialog
  try {
    $d.Title = 'Open Tournament'
    $d.InitialDirectory = $tournamentsRoot
    $d.Filter = 'ChessPublisher tournament (*.json)|*.json|JSON files (*.json)|*.json|All files (*.*)|*.*'
    $d.CheckFileExists = $true
    $d.CheckPathExists = $true
    $d.Multiselect = $false
    $d.RestoreDirectory = $true

    if ($d.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
    return [System.IO.Path]::GetFullPath($d.FileName)
  }
  finally { $d.Dispose() }
}
# --- CP WINDOWS DIALOG HELPERS END ---

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try {
  $listener.Start()
  Write-EngineLog "Service started on 127.0.0.1:$Port (Gacrux present: $(Test-Path -LiteralPath $gacrux))."
} catch {
  Write-EngineLog "ERROR starting service: $($_.Exception.Message)"
  exit 1
}

$lastRequest = [DateTime]::UtcNow
$stopReason = 'service loop ended'

try {
  :serverLoop while ($listener.IsListening) {
    $async = $listener.BeginGetContext($null, $null)
    while (-not $async.AsyncWaitHandle.WaitOne(30000)) {
      if (([DateTime]::UtcNow - $lastRequest).TotalMinutes -ge $IdleTimeoutMinutes) {
        $stopReason = "no open ChessPublisher page for $IdleTimeoutMinutes minute(s)"
        break serverLoop
      }
    }
    try {
      $context = $listener.EndGetContext($async)
    } catch {
      if ($listener.IsListening) { Write-EngineLog "ERROR accepting request: $($_.Exception.Message)" }
      continue
    }
    $temp = $null
    $pairStage = $null
    try {
      $securityDecision = New-LocalRequestSecurityDecision $context
      if (-not $securityDecision.Allowed) {
        Write-EngineLog ("SECURITY blocked {0} {1}: {2}" -f $context.Request.HttpMethod, $context.Request.Url.AbsolutePath, $securityDecision.Reason)
        Send-ForbiddenLocalRequest $context $securityDecision.Reason
        continue
      }
      # Rejected web traffic must not keep the LocalEngine alive indefinitely.
      $lastRequest = [DateTime]::UtcNow
      if ($context.Request.HttpMethod -eq 'OPTIONS') {
        Send-AllowedPreflightResponse $context ([string]$securityDecision.AllowedOrigin)
        continue
      }
      if ($context.Request.HttpMethod -eq 'GET' -and ($context.Request.Url.AbsolutePath -eq '/' -or $context.Request.Url.AbsolutePath -eq '/ChessPublisher.html')) {
        Send-HtmlResponse $context
        continue
      }
      if ($context.Request.Url.AbsolutePath -eq '/health') {
        Send-JsonResponse $context 200 @{ ok = $true; engine = (Test-Path -LiteralPath $gacrux); engineName = 'Gacrux 1.9.57'; serviceVersion = $serviceVersion; root = $root }
        continue
      }

      if ($context.Request.HttpMethod -eq 'GET' -and $context.Request.Url.AbsolutePath -eq '/pairing-checker/status') {
        $bbpStatus = Get-BbpPairingCheckerStatus
        Send-JsonResponse $context 200 @{
          ok = $true
          ready = [bool]$bbpStatus.Ready
          present = [bool]$bbpStatus.Present
          verified = [bool]$bbpStatus.Verified
          checker = 'bbpPairings'
          version = [string]$bbpStatus.Version
          message = [string]$bbpStatus.Message
          releaseSha256 = [string]$bbpStatus.ReleaseSha256
        }
        continue
      }

      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/pairing-checker/install') {
        $bbpStatus = Install-BbpPairingChecker
        Send-JsonResponse $context 200 @{
          ok = $true
          ready = [bool]$bbpStatus.Ready
          present = [bool]$bbpStatus.Present
          verified = [bool]$bbpStatus.Verified
          checker = 'bbpPairings'
          version = [string]$bbpStatus.Version
          message = [string]$bbpStatus.Message
          releaseSha256 = [string]$bbpStatus.ReleaseSha256
        }
        continue
      }


      if ($context.Request.HttpMethod -eq 'GET' -and $context.Request.Url.AbsolutePath -eq '/tiebreak-checker/status') {
        $tbStatus = Get-TieBreakCheckerStatus
        Send-JsonResponse $context 200 @{
          ok=$true; ready=[bool]$tbStatus.Ready; present=[bool]$tbStatus.Present; verified=[bool]$tbStatus.Verified
          checker='Gacrux Tie-Break Checker'; version=[string]$tbStatus.Version; message=[string]$tbStatus.Message
          releaseSha256=[string]$tbStatus.ReleaseSha256
        }
        continue
      }

      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/tiebreak-checker/install') {
        $tbStatus = Install-TieBreakChecker
        Send-JsonResponse $context 200 @{
          ok=$true; ready=[bool]$tbStatus.Ready; present=[bool]$tbStatus.Present; verified=[bool]$tbStatus.Verified
          checker='Gacrux Tie-Break Checker'; version=[string]$tbStatus.Version; message=[string]$tbStatus.Message
          releaseSha256=[string]$tbStatus.ReleaseSha256
        }
        continue
      }

      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/tiebreak-checker/check') {
        if ($context.Request.ContentLength64 -gt 26214400) { throw 'The tie-break checker request is too large.' }
        $requestJson = Read-Utf8RequestBody $context
        $body = $requestJson | ConvertFrom-Json
        $trf = [string]$body.trf
        $round = [int]$body.round
        $mode = [string]$body.mode
        $ties = @($body.tieBreaks | ForEach-Object { [string]$_ })
        $expected = @($body.expected)
        $tbResult = Invoke-TieBreakValidation $trf $round $mode $ties $expected
        Send-JsonResponse $context 200 @{
          ok=$true; available=[bool]$tbResult.Available; state=[string]$tbResult.State; check=$tbResult.Check
          checker='Gacrux Tie-Break Checker'; version=[string]$tbResult.Version; round=[int]$tbResult.Round
          rules=[string]$tbResult.Rules; message=[string]$tbResult.Message; mismatches=@($tbResult.Mismatches); output=[string]$tbResult.Output
        }
        continue
      }


      # --- OFFICIAL CHESS-RESULTS XML INTERFACE START ---
      if ($context.Request.HttpMethod -eq 'GET' -and $context.Request.Url.AbsolutePath -eq '/chessresults/config') {
        Send-JsonResponse $context 200 @{
          ok = $true
          sourceId = $chessResultsSourceId
          creatorId = $chessResultsCreatorId
          endpoint = $chessResultsEndpoint
          authentication = 'AES-128-CBC-PKCS7'
          stage = 'individual-swiss'
        }
        continue
      }

      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/chessresults/test') {
        if ($context.Request.ContentLength64 -gt 65536) { throw 'Chess-Results test request is too large.' }
        $sid = Invoke-ChessResultsGetSid
        Send-JsonResponse $context 200 @{
          ok = $true
          sourceId = $chessResultsSourceId
          creatorId = $chessResultsCreatorId
          sidVerified = [bool]$sid.Verified
        }
        continue
      }

      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/chessresults/create') {
        if ($context.Request.ContentLength64 -gt 131072) { throw 'Chess-Results create request is too large.' }
        $requestJson = Read-Utf8RequestBody $context
        if ([string]::IsNullOrWhiteSpace($requestJson)) { throw 'No Chess-Results create data was supplied.' }
        $payload = $requestJson | ConvertFrom-Json
        $result = New-ChessResultsKey ([string]$payload.tournament) ([string]$payload.federation) ([string]$payload.mode) ([string]$payload.clientId)
        Send-JsonResponse $context 200 @{
          ok = $true
          key = $result.Key
          federation = $result.Federation
          mode = $result.Mode
          sidVerified = $result.SidVerified
          recovered = [bool]$result.Recovered
          publicUrl = ('https://chess-results.com/tnr{0}.aspx?lan=1' -f $result.Key)
        }
        continue
      }

      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/chessresults/delete-authorize') {
        if ($context.Request.ContentLength64 -gt 65536) { throw 'Chess-Results delete authorization request is too large.' }
        $requestJson = Read-Utf8RequestBody $context
        if ([string]::IsNullOrWhiteSpace($requestJson)) { throw 'No Chess-Results delete authorization data was supplied.' }
        $payload = $requestJson | ConvertFrom-Json
        $deleteKey = ([string]$payload.key).Trim()
        $deleteClient = ([string]$payload.clientId).Trim()
        if ($deleteKey -notmatch '^\d+$') { throw 'Chess-Results tournament key must be numeric.' }
        if ([string]::IsNullOrWhiteSpace($deleteClient)) { throw 'Chess-Results local tournament identity is missing.' }

        # Deletion is intentionally stricter than ordinary Admin access.  The TNR
        # must be the exact key returned by GETKEY for this local tournament
        # clientId.  Get-ChessResultsKeyRecoveryByKey also requires this Source ID
        # and CreatorID, so a manually entered/public TNR cannot become deletable.
        $recovery = Get-ChessResultsKeyRecoveryByKey $deleteKey
        if ($null -eq $recovery) {
          Write-EngineLog "Chess-Results DELETE denied: no local GETKEY recovery mapping exists for TNR $deleteKey."
          Send-JsonResponse $context 200 @{
            ok = $true; canDelete = $false; key = $deleteKey; alreadyDeleted = $false
            reason = 'This TNR is not present in ChessPublisher''s authenticated GETKEY recovery mapping. Remote deletion is blocked.'
          }
          continue
        }
        $mappedClient = ([string]$recovery.clientId).Trim()
        if ($mappedClient -ne $deleteClient) {
          Write-EngineLog "Chess-Results DELETE denied: clientId mismatch for TNR $deleteKey."
          Send-JsonResponse $context 200 @{
            ok = $true; canDelete = $false; key = $deleteKey; alreadyDeleted = $false
            reason = 'This TNR belongs to a different local ChessPublisher tournament identity. Remote deletion is blocked.'
          }
          continue
        }

        $publicState = Test-ChessResultsTournamentPublicState $deleteKey
        if ([bool]$publicState.ConfirmedDeleted) {
          Send-JsonResponse $context 200 @{
            ok = $true; canDelete = $true; key = $deleteKey; alreadyDeleted = $true
            reason = $publicState.Reason; publicUrl = $publicState.PublicUrl
          }
          continue
        }
        if ($publicState.Exists -ne $true) {
          Send-JsonResponse $context 200 @{
            ok = $true; canDelete = $false; key = $deleteKey; alreadyDeleted = $false
            reason = 'Chess-Results public-state verification was inconclusive. Deletion is blocked until the TNR can be verified safely.'
            publicUrl = $publicState.PublicUrl
          }
          continue
        }

        $adminUrl = Get-ChessResultsAdminUrl $deleteKey 1
        Write-EngineLog "Chess-Results DELETE authorized locally for TNR $deleteKey using its exact GETKEY recovery mapping."
        Send-JsonResponse $context 200 @{
          ok = $true; canDelete = $true; key = $deleteKey; alreadyDeleted = $false
          adminUrl = $adminUrl; publicUrl = $publicState.PublicUrl
          creatorId = $chessResultsCreatorId; sourceId = $chessResultsSourceId
        }
        continue
      }

      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/chessresults/unlink') {
        if ($context.Request.ContentLength64 -gt 65536) { throw 'Chess-Results unlink request is too large.' }
        $requestJson = Read-Utf8RequestBody $context
        if ([string]::IsNullOrWhiteSpace($requestJson)) { throw 'No Chess-Results unlink data was supplied.' }
        $payload = $requestJson | ConvertFrom-Json
        $unlinkKey = ([string]$payload.key).Trim()
        $unlinkClient = ([string]$payload.clientId).Trim()
        $unlinkServerError = ([string]$payload.serverError).Trim()
        if ($unlinkKey -notmatch '^\d+$') { throw 'Chess-Results tournament key must be numeric.' }

        # Verify against Chess-Results AFTER the user confirmation and BEFORE deleting any local mapping.
        # A previously recorded authenticated UPLOAD rejection for this exact TNR/client
        # (for example Source-ID Tournament (0) != Upload-Parameter (21)) is accepted
        # as strong stale/deleted-TNR evidence even when the public page still resolves.
        $rejectEvidence = Get-ChessResultsInvalidKeyEvidence $unlinkKey $unlinkClient
        $savedStateRejected = Test-ChessResultsStoredTnrRejection $unlinkServerError
        if ($null -eq $rejectEvidence -and $savedStateRejected) {
          # Compatibility with failures that happened in WebView 1.03.18 before
          # LocalEngine started persisting stale-TNR evidence. The tournament's
          # own saved lastError can seed the same exact Source-ID/database-key
          # rejection proof for the current TNR after explicit user confirmation.
          Save-ChessResultsInvalidKeyEvidence $unlinkKey $unlinkClient $unlinkServerError
          $rejectEvidence = Get-ChessResultsInvalidKeyEvidence $unlinkKey $unlinkClient
        }
        $serverRejected = ($null -ne $rejectEvidence)
        try {
          $check = Test-ChessResultsTournamentPublicState $unlinkKey
        } catch {
          if (-not $serverRejected) { throw }
          $check = [pscustomobject]@{
            Exists = $null
            ConfirmedDeleted = $false
            Reason = "Public-page verification failed, but an authenticated UPLOAD rejection for this exact TNR was already recorded: $($_.Exception.Message)"
            PublicUrl = ('https://chess-results.com/tnr{0}.aspx?lan=1' -f $unlinkKey)
          }
        }

        if (-not $serverRejected -and $check.Exists -eq $true) {
          Write-EngineLog "Chess-Results UNLINK denied: TNR $unlinkKey still exists."
          Send-JsonResponse $context 200 @{
            ok = $true
            canUnlink = $false
            exists = $true
            confirmedDeleted = $false
            key = $unlinkKey
            reason = $check.Reason
            publicUrl = $check.PublicUrl
          }
          continue
        }
        if (-not $serverRejected -and -not [bool]$check.ConfirmedDeleted) {
          Write-EngineLog "Chess-Results UNLINK denied: deletion of TNR $unlinkKey could not be confirmed."
          Send-JsonResponse $context 200 @{
            ok = $true
            canUnlink = $false
            exists = $null
            confirmedDeleted = $false
            key = $unlinkKey
            reason = $check.Reason
            publicUrl = $check.PublicUrl
          }
          continue
        }

        $removed = Remove-ChessResultsKeyRecovery $unlinkKey $unlinkClient
        Remove-ChessResultsInvalidKeyEvidence $unlinkKey $unlinkClient
        $unlinkReason = if ($serverRejected) {
          "Authenticated Chess-Results UPLOAD rejected this TNR for Source ID ${chessResultsSourceId}: $([string]$rejectEvidence.message)"
        } else {
          [string]$check.Reason
        }
        Write-EngineLog "Chess-Results UNLINK allowed: TNR $unlinkKey released; serverRejected=$serverRejected recoveryRemoved=$removed."
        Send-JsonResponse $context 200 @{
          ok = $true
          canUnlink = $true
          exists = if ($serverRejected) { $null } else { $false }
          confirmedDeleted = [bool]$check.ConfirmedDeleted
          serverRejected = [bool]$serverRejected
          key = $unlinkKey
          recoveryRemoved = [bool]$removed
          reason = $unlinkReason
          publicUrl = $check.PublicUrl
        }
        continue
      }

      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/chessresults/publish') {
        if ($context.Request.ContentLength64 -gt 22000000) { throw 'Chess-Results publish request is too large.' }
        $requestJson = Read-Utf8RequestBody $context
        if ([string]::IsNullOrWhiteSpace($requestJson)) { throw 'No Chess-Results publish data was supplied.' }
        $payload = $requestJson | ConvertFrom-Json
        $result = Publish-ChessResultsXml ([string]$payload.key) ([string]$payload.xml)
        Send-JsonResponse $context 200 @{
          ok = $true
          key = $result.Key
          sidVerified = $result.SidVerified
          publicUrl = ('https://chess-results.com/tnr{0}.aspx?lan=1' -f $result.Key)
        }
        continue
      }

      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/chessresults/admin-link') {
        if ($context.Request.ContentLength64 -gt 65536) { throw 'Chess-Results admin-link request is too large.' }
        $requestJson = Read-Utf8RequestBody $context
        if ([string]::IsNullOrWhiteSpace($requestJson)) { throw 'No Chess-Results key was supplied.' }
        $payload = $requestJson | ConvertFrom-Json
        $language = 1
        if ($null -ne $payload.language) { $language = [int]$payload.language }
        $section = ([string]$payload.section).Trim().ToLowerInvariant()
        if ($section -eq 'upload') {
          $url = Get-ChessResultsUploadSectionUrl ([string]$payload.key) $language
        } else {
          $url = Get-ChessResultsAdminUrl ([string]$payload.key) $language
        }
        Send-JsonResponse $context 200 @{ ok = $true; key = [string]$payload.key; section = $section; url = $url }
        continue
      }
      # --- OFFICIAL CHESS-RESULTS XML INTERFACE END ---


      # --- CP WINDOWS DIALOG ROUTES START ---
      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/windows/save-as-dialog') {
        if ($context.Request.ContentLength64 -gt 65536) { throw 'The Save As dialog request is too large.' }
        $requestJson = Read-Utf8RequestBody $context

        $suggestedName = 'Tournament'
        if (-not [string]::IsNullOrWhiteSpace($requestJson)) {
          $dlgPayload = $requestJson | ConvertFrom-Json
          if (-not [string]::IsNullOrWhiteSpace([string]$dlgPayload.suggestedName)) {
            $suggestedName = [string]$dlgPayload.suggestedName
          }
        }

        $selectedFile = Show-ChessPublisherSaveDialog $suggestedName

        if ([string]::IsNullOrWhiteSpace($selectedFile)) {
          Send-JsonResponse $context 200 @{ ok=$true; cancelled=$true }
          continue
        }

        Send-JsonResponse $context 200 @{
          ok=$true
          cancelled=$false
          name=(Get-TournamentNameFromJsonPath $selectedFile)
          path=$selectedFile
        }
        continue
      }

      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/windows/open-tournament-dialog') {
        if ($context.Request.ContentLength64 -gt 65536) { throw 'The Open Tournament dialog request is too large.' }
        $selectedFile = Show-ChessPublisherOpenDialog

        if ([string]::IsNullOrWhiteSpace($selectedFile)) {
          Send-JsonResponse $context 200 @{ ok=$true; cancelled=$true }
          continue
        }

        $json = [System.IO.File]::ReadAllText($selectedFile, [System.Text.Encoding]::UTF8)
        $parsed = $json | ConvertFrom-Json

        if ($null -eq $parsed.data -or $null -eq $parsed.data.tournaments) {
          throw 'The selected file is not valid ChessPublisher tournament data.'
        }

        $responseBody = @{
          ok=$true
          cancelled=$false
          name=(Get-TournamentNameFromJsonPath $selectedFile)
          path=$selectedFile
          snapshot=$parsed
        } | ConvertTo-Json -Compress -Depth 40

        Send-RawJsonResponse $context 200 $responseBody
        continue
      }
      # --- CP WINDOWS DIALOG ROUTES END ---

      # v1.03.64 TM-01/TM-02/TM-03: rename is a filesystem operation, not
      # only an in-memory key change. The LocalEngine is the final collision
      # authority because it uses the same Windows folder sanitization as save.
      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/tournament/rename') {
        if ($context.Request.ContentLength64 -gt 26214400) { throw 'The tournament rename payload is too large.' }
        $requestJson = Read-Utf8RequestBody $context
        if ([string]::IsNullOrWhiteSpace($requestJson)) { throw 'No tournament rename data was supplied.' }
        $payload = $requestJson | ConvertFrom-Json
        $oldName = ([string]$payload.oldName).Trim()
        $newName = ([string]$payload.newName).Trim()
        if ([string]::IsNullOrWhiteSpace($oldName) -or [string]::IsNullOrWhiteSpace($newName)) { throw 'Both old and new tournament names are required.' }
        if ($null -eq $payload.snapshot -or $null -eq $payload.snapshot.data -or $null -eq $payload.snapshot.data.tournaments) { throw 'The renamed tournament snapshot is invalid.' }

        $oldFolder = Resolve-ExistingTournamentFolder $oldName
        if ([string]::IsNullOrWhiteSpace([string]$oldFolder)) {
          Send-JsonResponse $context 404 @{ ok = $false; error = 'The tournament folder to rename was not found. Refresh Recent Tournaments and try again.' }
          continue
        }
        $newFolder = Get-TournamentFolder $newName
        $oldFull = [System.IO.Path]::GetFullPath($oldFolder).TrimEnd('\')
        $newFull = [System.IO.Path]::GetFullPath($newFolder).TrimEnd('\')
        $sameStorage = [System.String]::Equals($oldFull, $newFull, [System.StringComparison]::OrdinalIgnoreCase)
        if (-not $sameStorage -and (Test-Path -LiteralPath $newFolder)) {
          throw 'A tournament folder with that name already exists. Rename was cancelled to prevent overwrite.'
        }

        $snapshotCurrent = ([string]$payload.snapshot.data.currentTournament).Trim()
        $snapshotProps = @($payload.snapshot.data.tournaments.PSObject.Properties)
        $matchingProp = @($snapshotProps | Where-Object { [System.String]::Equals([string]$_.Name, $newName, [System.StringComparison]::Ordinal) })
        if (-not [System.String]::Equals($snapshotCurrent, $newName, [System.StringComparison]::Ordinal) -or $matchingProp.Count -ne 1) {
          throw 'The renamed tournament snapshot does not match the requested new name.'
        }

        $oldFile = Join-Path $oldFolder 'tournament.json'
        if (-not (Test-Path -LiteralPath $oldFile)) { throw 'The tournament file to rename was not found.' }
        $backupFolder = Join-Path $oldFolder 'backup'
        New-Item -ItemType Directory -Path $backupFolder -Force | Out-Null
        $stamp = [DateTime]::Now.ToString('yyyy-MM-dd_HH-mm-ss')
        [void](Copy-SanitizedTournamentJson $oldFile (Join-Path $backupFolder ("tournament-before-rename-$stamp.json")))
        Sanitize-TournamentBackupFolder $backupFolder

        $moved = $false
        $temporary = $null
        try {
          if (-not $sameStorage) {
            Move-Item -LiteralPath $oldFolder -Destination $newFolder -ErrorAction Stop
            $moved = $true
          } else {
            $newFolder = $oldFolder
          }
          $targetFile = Join-Path $newFolder 'tournament.json'
          $serialized = $payload.snapshot | ConvertTo-Json -Compress -Depth 30
          $temporary = "$targetFile.part"
          [System.IO.File]::WriteAllText($temporary, $serialized, (New-Object System.Text.UTF8Encoding($false)))
          Move-Item -LiteralPath $temporary -Destination $targetFile -Force -ErrorAction Stop
        } catch {
          if ($temporary -and (Test-Path -LiteralPath $temporary)) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
          if ($moved -and (Test-Path -LiteralPath $newFolder) -and -not (Test-Path -LiteralPath $oldFolder)) {
            Move-Item -LiteralPath $newFolder -Destination $oldFolder -ErrorAction SilentlyContinue
          }
          throw
        }

        $resolvedName = Split-Path $newFolder -Leaf
        Replace-RecentTournamentName $oldName $resolvedName
        Write-EngineLog "Tournament folder renamed '$oldName' -> '$resolvedName'."
        Send-JsonResponse $context 200 @{ ok = $true; name = $resolvedName; file = (Join-Path $newFolder 'tournament.json') }
        continue
      }

      if ($context.Request.HttpMethod -eq 'GET' -and $context.Request.Url.AbsolutePath -eq '/tournaments') {
        $recentNames = @()
        if (Test-Path -LiteralPath $recentFile) {
          try { $recentNames = @((Get-Content -LiteralPath $recentFile -Raw | ConvertFrom-Json)) } catch { $recentNames = @() }
        }
        $items = @(Get-TournamentInventory $recentNames)
        $sorted = @($items | Sort-Object @{Expression='recentIndex';Ascending=$true}, @{Expression='modified';Descending=$true})
        Send-JsonResponse $context 200 @{ ok = $true; root = $tournamentsRoot; tournaments = $sorted }
        continue
      }

      # v1.03.92 canonical Recent-Tournament open path. POST avoids putting a
      # Windows file path in the URL; the opaque id is resolved against a fresh
      # inventory built by the same code used for /tournaments.
      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/tournament/open') {
        if ($context.Request.ContentLength64 -gt 65536) { throw 'The tournament open request is too large.' }
        $requestJson = Read-Utf8RequestBody $context
        $payload = if ([string]::IsNullOrWhiteSpace($requestJson)) { $null } else { $requestJson | ConvertFrom-Json }
        $id = [string]$payload.id
        $name = [string]$payload.name
        $requestedFile = [string]$payload.path
        $item = Resolve-TournamentInventoryItem $id $name $requestedFile
        $loaded = Read-TournamentInventoryItem $item
        if ($null -eq $loaded) {
          Send-JsonResponse $context 404 @{ ok = $false; error = 'Tournament file was not found in the current Recent Tournaments inventory.' }
          continue
        }
        $resolvedName = [string]$loaded.item.name
        Update-RecentTournament $resolvedName
        Write-EngineLog "Recent tournament opened: '$resolvedName' [$([string]$loaded.item.id)]"
        Send-JsonResponse $context 200 @{ ok = $true; id = [string]$loaded.item.id; name = $resolvedName; file = [string]$loaded.item.path; snapshot = $loaded.snapshot }
        continue
      }

      # Compatibility endpoint for older frontends. It now resolves through the
      # same fresh inventory as /tournaments instead of trusting a cached path.
      if ($context.Request.HttpMethod -eq 'GET' -and $context.Request.Url.AbsolutePath -eq '/tournament') {
        $name = [string]$context.Request.QueryString['name']
        $requestedFile = [string]$context.Request.QueryString['path']
        $id = [string]$context.Request.QueryString['id']
        $item = Resolve-TournamentInventoryItem $id $name $requestedFile
        $loaded = Read-TournamentInventoryItem $item
        if ($null -eq $loaded) {
          Send-JsonResponse $context 404 @{ ok = $false; error = 'Tournament file was not found in the current Recent Tournaments inventory.' }
          continue
        }
        $resolvedName = [string]$loaded.item.name
        Update-RecentTournament $resolvedName
        Send-JsonResponse $context 200 @{ ok = $true; id = [string]$loaded.item.id; name = $resolvedName; file = [string]$loaded.item.path; snapshot = $loaded.snapshot }
        continue
      }
      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/tournament/save') {
        if ($context.Request.ContentLength64 -gt 26214400) { throw 'The saved tournament is too large.' }
        $requestJson = Read-Utf8RequestBody $context
        if ([string]::IsNullOrWhiteSpace($requestJson)) { throw 'No tournament data was supplied.' }
        $payload = $requestJson | ConvertFrom-Json
        $name = [string]$payload.name
        if ($null -eq $payload.snapshot -or $null -eq $payload.snapshot.data -or $null -eq $payload.snapshot.data.tournaments) { throw 'The saved tournament data is invalid.' }
        # v1.03.96 SECURITY: /tournament/save always targets the managed
        # Documents\ChessPublisher Tournaments root. Native Save As uses the
        # explicit WebView file-picker bridge and never grants an HTTP caller an
        # arbitrary filesystem path capability. Legacy payload.path is ignored.
        $folder = Get-TournamentFolder $name
        Ensure-TournamentFolders $folder
        $file = Join-Path $folder 'tournament.json'
        $resolvedName = Split-Path $folder -Leaf
        if (Test-Path -LiteralPath $file) {
          $backupFolder = Join-Path $folder 'backup'
          $stamp = [DateTime]::Now.ToString('yyyy-MM-dd_HH-mm-ss')
          $backupFile = Join-Path $backupFolder ("tournament-$stamp.json")
          [void](Copy-SanitizedTournamentJson $file $backupFile)
          Sanitize-TournamentBackupFolder $backupFolder
          $oldBackups = @(Get-ChildItem -LiteralPath $backupFolder -Filter 'tournament-*.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -Skip 10)
          foreach ($old in $oldBackups) { Remove-Item -LiteralPath $old.FullName -Force -ErrorAction SilentlyContinue }
        }
        $serialized = $payload.snapshot | ConvertTo-Json -Compress -Depth 30
        $temporary = "$file.part"
        [System.IO.File]::WriteAllText($temporary, $serialized, (New-Object System.Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination $file -Force

        # v1.03.72: cumulative emergency TRF snapshots, one file per latest generated round.
        # Round_03.trf contains the complete R1-R3 history, including a still-pending R3.
        # Latest.trf is always byte-identical to the newest generated-round snapshot.
        $trfBackupInfo = $null
        if ($null -ne $payload.trfBackup) {
          $trfFolder = Join-Path $folder 'TRF_Backup'
          New-Item -ItemType Directory -Path $trfFolder -Force | Out-Null
          $trfRound = [int]$payload.trfBackup.round
          if ($trfRound -lt 0 -or $trfRound -gt 999) { throw 'Invalid automatic TRF backup round.' }

          if ($trfRound -eq 0) {
            # Ordinary autosave before the first generated round must never
            # destroy an existing emergency backup.  Destructive cleanup is an
            # explicit tournament-reset concern, not a save side effect.
            $trfBackupInfo = @{ round = 0; folder = $trfFolder; file = ''; preserved = $true }
          }
          else {
            $trfText = [string]$payload.trfBackup.text
            if ([string]::IsNullOrWhiteSpace($trfText)) { throw 'Automatic TRF backup text is empty.' }

            # If a generated round was deleted/reopened, remove stale future files
            # so the highest Round_XX always represents the current tournament.
            foreach ($oldTrf in @(Get-ChildItem -LiteralPath $trfFolder -Filter 'Round_*.*' -File -ErrorAction SilentlyContinue)) {
              if ($oldTrf.Name -match '^Round_(\d+)\.(?:trf|txt)$') {
                $oldRound = [int]$Matches[1]
                if ($oldRound -gt $trfRound) { Remove-Item -LiteralPath $oldTrf.FullName -Force -ErrorAction SilentlyContinue }
              }
            }

            $roundFile = Join-Path $trfFolder ("Round_{0:D2}.trf" -f $trfRound)
            $latestFile = Join-Path $trfFolder 'Latest.trf'
            $roundPart = "$roundFile.part"
            $latestPart = "$latestFile.part"
            [System.IO.File]::WriteAllText($roundPart, $trfText, $utf8NoBom)
            Move-Item -LiteralPath $roundPart -Destination $roundFile -Force
            [System.IO.File]::WriteAllText($latestPart, $trfText, $utf8NoBom)
            Move-Item -LiteralPath $latestPart -Destination $latestFile -Force

            # v1.03.86: keep the internal rich .trf recovery snapshot, and write
            # a byte-separate Swiss-Manager-native .TXT sidecar from the simple
            # TRF26 profile. Existing .trf names remain fully compatible.
            $swissManagerText = [string]$payload.trfBackup.swissManagerText
            if ([string]::IsNullOrWhiteSpace($swissManagerText)) { $swissManagerText = $trfText }
            $roundSwissFile = Join-Path $trfFolder ("Round_{0:D2}.TXT" -f $trfRound)
            $latestSwissFile = Join-Path $trfFolder 'Latest.TXT'
            $roundSwissPart = "$roundSwissFile.part"
            $latestSwissPart = "$latestSwissFile.part"
            [System.IO.File]::WriteAllText($roundSwissPart, $swissManagerText, $utf8NoBom)
            Move-Item -LiteralPath $roundSwissPart -Destination $roundSwissFile -Force
            [System.IO.File]::WriteAllText($latestSwissPart, $swissManagerText, $utf8NoBom)
            Move-Item -LiteralPath $latestSwissPart -Destination $latestSwissFile -Force

            $trfBackupInfo = @{ round = $trfRound; folder = $trfFolder; file = $roundFile; latest = $latestFile; swissManagerFile = $roundSwissFile; swissManagerLatest = $latestSwissFile }
          }
        }

        Update-RecentTournament $resolvedName
        Send-JsonResponse $context 200 @{ ok = $true; name = $resolvedName; file = $file; savedAt = $payload.snapshot.savedAt; trfBackup = $trfBackupInfo }
        continue
      }

      if ($context.Request.HttpMethod -eq 'GET' -and $context.Request.Url.AbsolutePath -eq '/state') {
        if (-not (Test-Path -LiteralPath $stateFile)) {
          Send-JsonResponse $context 404 @{ ok = $false; error = 'No saved tournament state is available.' }
          continue
        }
        Send-RawJsonResponse $context 200 ([System.IO.File]::ReadAllText($stateFile, [System.Text.Encoding]::UTF8))
        continue
      }
      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/state') {
        if ($context.Request.ContentLength64 -gt 26214400) { throw 'The saved state is too large.' }
        $json = Read-Utf8RequestBody $context
        if ([string]::IsNullOrWhiteSpace($json)) { throw 'No saved state was supplied.' }
        $parsed = $json | ConvertFrom-Json
        if ($null -eq $parsed.data -or $null -eq $parsed.data.tournaments) { throw 'The saved state is not valid ChessPublisher data.' }
        $temporaryState = "$stateFile.part"
        [System.IO.File]::WriteAllText($temporaryState, $json, (New-Object System.Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporaryState -Destination $stateFile -Force
        Send-JsonResponse $context 200 @{ ok = $true; savedAt = $parsed.savedAt }
        continue
      }
      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/shutdown') {
        Send-JsonResponse $context 200 @{ ok = $true }
        $stopReason = 'replacement launcher requested shutdown'
        break
      }
      if ($context.Request.HttpMethod -eq 'GET' -and $context.Request.Url.AbsolutePath -match '^/fide/(std|rapid|blitz)$') {
        $type = $Matches[1]
        $files = @{ std = 'standard.txt'; rapid = 'rapid.txt'; blitz = 'blitz.txt' }
        $ratingFile = Join-Path $fideFolder $files[$type]
        if (-not (Test-Path -LiteralPath $ratingFile)) {
          Send-JsonResponse $context 404 @{ ok = $false; error = 'The requested local rating list is not available.' }
          continue
        }
        Send-TextResponse $context 200 (Get-Content -LiteralPath $ratingFile -Raw)
        continue
      }
      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/fide/players-search') {
        if ($context.Request.ContentLength64 -gt 65536) { throw 'The FIDE player search request is too large.' }
        $request = Read-Utf8RequestBody $context
        if ([string]::IsNullOrWhiteSpace($request)) { throw 'No FIDE search query was supplied.' }
        $payload = $request | ConvertFrom-Json
        $query = ([string]$payload.query).Trim()
        if ($query.Length -lt 2) { throw 'FIDE search requires at least 2 characters.' }
        if ($query.Length -gt 100) { throw 'FIDE search query is too long.' }
        $limit = 60
        if ($null -ne $payload.limit) { $limit = [math]::Max(1, [math]::Min(60, [int]$payload.limit)) }
        $legacyTxt = Join-Path $fideFolder 'players_legacy.txt'
        if (-not (Test-Path -LiteralPath $legacyTxt)) {
          Send-JsonResponse $context 404 @{ ok = $false; error = 'The full FIDE LEGACY player directory is not available. Run Download and update FIDE Databases first.' }
          continue
        }
        $players = @(Find-FidePlayerDirectorySearchTxt $legacyTxt $query $limit)
        Send-JsonResponse $context 200 @{ ok = $true; matched = $players.Count; source = 'legacy-txt'; players = $players }
        continue
      }
      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/fide/players-lookup') {
        if ($context.Request.ContentLength64 -gt 1048576) { throw 'The FIDE player lookup request is too large.' }
        $request = Read-Utf8RequestBody $context
        if ([string]::IsNullOrWhiteSpace($request)) { throw 'No FIDE IDs were supplied.' }

        $payload = $request | ConvertFrom-Json
        $ids = @($payload.fideIds | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -match '^\d{5,15}$' } | Select-Object -Unique)
        if ($ids.Count -eq 0) { throw 'No valid FIDE IDs were supplied.' }
        if ($ids.Count -gt 5000) { throw 'A maximum of 5000 FIDE IDs can be looked up at once.' }

        $players = @(Find-FidePlayerDirectoryEntries $ids)
        $lookupSource = if ($players.Count -gt 0 -and $players[0].source) { [string]$players[0].source } elseif (Test-Path -LiteralPath (Join-Path $fideFolder 'players_legacy.txt')) { 'legacy-txt' } else { 'legacy-xml' }
        Send-JsonResponse $context 200 @{ ok = $true; requested = $ids.Count; matched = $players.Count; source = $lookupSource; players = $players }
        continue
      }
      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/fide-update') {
        if (-not (Test-Path -LiteralPath $fideUpdater)) { throw 'FIDE updater script is missing.' }
        $temp = Join-Path ([System.IO.Path]::GetTempPath()) ('ChessPublisher-FIDE-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $temp | Out-Null
        $stdout = Join-Path $temp 'stdout.txt'
        $stderr = Join-Path $temp 'stderr.txt'
        # Start-Process joins ArgumentList items into one command line. The
        # script path therefore MUST remain explicitly quoted, otherwise a
        # folder such as "OneDrive\Desktop\Fully Test" is split at spaces
        # and Windows PowerShell receives only the first path fragment.
        $fideUpdaterArguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $fideUpdater
        $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $fideUpdaterArguments -WorkingDirectory $root -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $details = ((Get-Content -Raw $stderr -ErrorAction SilentlyContinue) + "`n" + (Get-Content -Raw $stdout -ErrorAction SilentlyContinue)).Trim()
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
        if ($process.ExitCode -ne 0) {
          if ($details) { throw $details }
          throw "The FIDE updater exited with code $($process.ExitCode)."
        }
        $files = @('standard.txt','rapid.txt','blitz.txt','players_legacy.txt')
        if (@($files | Where-Object { -not (Test-Path -LiteralPath (Join-Path $fideFolder $_)) }).Count -gt 0) { throw 'The FIDE updater completed, but one or more extracted lists are missing.' }
        Send-JsonResponse $context 200 @{ ok = $true; message = 'Standard, Rapid, Blitz and the full FIDE LEGACY player directory were downloaded and extracted.' }
        continue
      }
      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/windows/open-text-report') {
        if ($context.Request.ContentLength64 -gt 5242880) { throw 'The text report is too large.' }
        $request = Read-Utf8RequestBody $context
        $payload = $request | ConvertFrom-Json
        $name = [string]$payload.tournamentName
        $text = [string]$payload.text
        if ([string]::IsNullOrWhiteSpace($name)) { throw 'Tournament name is required for the report.' }
        if ($null -eq $payload.text) { throw 'Report text is missing.' }

        $folder = Get-TournamentFolder $name
        Ensure-TournamentFolders $folder
        $exports = Join-Path $folder 'exports'
        $requestedName = [System.IO.Path]::GetFileName([string]$payload.fileName)
        if ([string]::IsNullOrWhiteSpace($requestedName)) { $requestedName = 'Update-Registered-Players.txt' }
        foreach ($c in [System.IO.Path]::GetInvalidFileNameChars()) { $requestedName = $requestedName.Replace([string]$c, '_') }
        if (-not $requestedName.EndsWith('.txt', [System.StringComparison]::OrdinalIgnoreCase)) { $requestedName += '.txt' }
        $reportFile = Join-Path $exports $requestedName
        [System.IO.File]::WriteAllText($reportFile, $text, $utf8Bom)

        # Swiss-Manager-style visible TXT report. Explicitly request a normal
        # Notepad window because LocalEngine itself runs hidden in the background.
        $notepadArguments = '"{0}"' -f $reportFile
        try {
          $notepad = Start-Process -FilePath 'notepad.exe' -ArgumentList $notepadArguments -WorkingDirectory $exports -WindowStyle Normal -PassThru -ErrorAction Stop
          Send-JsonResponse $context 200 @{ ok = $true; path = $reportFile; pid = $notepad.Id }
        } catch {
          # Shell-open the TXT as a fallback; Windows normally routes .txt to Notepad.
          $viewer = Start-Process -FilePath $reportFile -WorkingDirectory $exports -PassThru -ErrorAction Stop
          Send-JsonResponse $context 200 @{ ok = $true; path = $reportFile; pid = $viewer.Id }
        }
        continue
      }

      if ($context.Request.HttpMethod -eq 'POST' -and $context.Request.Url.AbsolutePath -eq '/round-robin') {
        if ($context.Request.ContentLength64 -gt 26214400) { throw 'The Round Robin pairing request is too large.' }
        if (-not (Test-Path -LiteralPath $gacrux)) { throw 'Local Gacrux pairing engine is missing.' }
        $request = Read-Utf8RequestBody $context
        $payload = $request | ConvertFrom-Json
        if ([string]::IsNullOrWhiteSpace([string]$payload.trf)) { throw 'No TRF was supplied.' }

        $playerCount = [int]$payload.playerCount
        if ($playerCount -lt 2) { throw 'Round Robin requires at least two players.' }
        $roundsPerCycle = if (($playerCount % 2) -eq 0) { $playerCount - 1 } else { $playerCount }
        $topColor = ([string]$payload.topColor).ToUpperInvariant()
        if ($topColor -ne 'B') { $topColor = 'W' }

        $temp = Join-Path ([System.IO.Path]::GetTempPath()) ('ChessPublisher-Berger-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $temp | Out-Null
        $input = Join-Path $temp 'tournament.trf'
        $stdout = Join-Path $temp 'stdout.txt'
        $stderr = Join-Path $temp 'stderr.txt'
        [System.IO.File]::WriteAllText($input, [string]$payload.trf, [System.Text.Encoding]::ASCII)

        Write-EngineLog "Generating a complete Berger schedule: $playerCount players, $roundsPerCycle round(s) per cycle."
        $allRounds = @()
        for ($round = 1; $round -le $roundsPerCycle; $round++) {
          $output = Join-Path $temp ("round-{0}.json" -f $round)
          $arguments = @(
            '-p', '-m', 'berger',
            '-i', $input, '-o', $output,
            '-f', 'TRF', '-F', 'JSON',
            '-n', [string]$round,
            '-N', [string]$roundsPerCycle,
            '-t', $topColor
          )
          & $gacrux @arguments 1> $stdout 2> $stderr
          $exitCode = $LASTEXITCODE
          $details = ((Get-Content -Raw $stderr -ErrorAction SilentlyContinue) + "`n" + (Get-Content -Raw $stdout -ErrorAction SilentlyContinue)).Trim()
          if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $output)) {
            if ($details) { throw "Berger Round $round failed: $details" }
            throw "Gacrux Berger exited with code $exitCode for Round $round."
          }

          $bergerResult = [System.IO.File]::ReadAllText($output) | ConvertFrom-Json
          if ([int]$bergerResult.status.code -ne 0) {
            $engineErrors = @($bergerResult.status.error) -join '; '
            if ($engineErrors) { throw "Berger Round $round failed: $engineErrors" }
            throw "Gacrux Berger did not produce Round $round."
          }
          $rawPairs = @($bergerResult.pairingResult.pairs)
          if ($rawPairs.Count -eq 2 -and $rawPairs[0] -isnot [System.Array]) {
            $rawPairs = ,@($rawPairs)
          }
          $roundPairs = @()
          foreach ($pair in $rawPairs) {
            if ($pair.Count -lt 2) { throw "Gacrux Berger returned an incomplete pairing in Round $round." }
            $roundPairs += ,@([int]$pair[0], [int]$pair[1])
          }
          if ($roundPairs.Count -lt 1) { throw "Gacrux Berger returned no pairings for Round $round." }
          $allRounds += [pscustomobject]@{ round = $round; pairs = $roundPairs; rules = [string]$bergerResult.pairingResult.rules }
        }

        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
        $temp = $null
        Write-EngineLog "Complete Berger cycle generated: $roundsPerCycle round(s)."
        Send-JsonResponse $context 200 @{ ok = $true; roundsPerCycle = $roundsPerCycle; rounds = $allRounds; engine = 'Gacrux 1.9.57 Berger' }
        continue
      }
      if ($context.Request.HttpMethod -ne 'POST' -or $context.Request.Url.AbsolutePath -ne '/pair') {
        Send-JsonResponse $context 404 @{ ok = $false; error = 'Not found.' }
        continue
      }
      if (-not (Test-Path -LiteralPath $gacrux)) {
        Send-JsonResponse $context 503 @{ ok = $false; error = 'Local Gacrux pairing engine is missing.' }
        continue
      }
      if ($context.Request.ContentLength64 -gt 26214400) { throw 'The pairing request is too large.' }
      $pairStage = 'request-read'
      $request = Read-Utf8RequestBody $context
      $pairStage = 'request-json'
      $payload = $request | ConvertFrom-Json
      if ([string]::IsNullOrWhiteSpace([string]$payload.trf)) { throw 'No TRF was supplied.' }

      $pairingRound = [int]$payload.round
      $announcedRounds = [int]$payload.rounds
      if ($pairingRound -lt 1) { throw 'The pairing round is invalid.' }
      if ($announcedRounds -lt $pairingRound) { throw 'The announced number of rounds is invalid.' }
      Write-EngineLog "Generating Round $pairingRound of $announcedRounds."
      Write-EngineLog "Dutch mode: weighted criteria search with standard FIDE TRF round fields."
      $topColor = ([string]$payload.topColor).ToUpperInvariant()
      if ($topColor -ne 'B') { $topColor = 'W' }

      $temp = Join-Path ([System.IO.Path]::GetTempPath()) ('ChessPublisher-Gacrux-' + [guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $temp | Out-Null
      $input = Join-Path $temp 'tournament.trf'
      $output = Join-Path $temp 'pairing.txt'
      $stdout = Join-Path $temp 'stdout.txt'
      $stderr = Join-Path $temp 'stderr.txt'
      $pairStage = 'trf-prepare'
      Assert-PairingTrfHistoryWidth ([string]$payload.trf) $pairingRound
      $syncedTrf = Sync-PairingTrfScores ([string]$payload.trf)
      if ($syncedTrf.Repairs -gt 0) {
        Write-EngineLog "Reconciled $($syncedTrf.Repairs) declared player score(s) with the supplied completed-round history."
      }
      [System.IO.File]::WriteAllText($input, [string]$syncedTrf.Trf, [System.Text.Encoding]::ASCII)
      $arguments = @(
        '-p', '-m', 'dutch',
        '-i', $input, '-o', $output,
        '-f', 'TRF', '-F', 'JSON', '-d', 'T',
        '-n', [string]$pairingRound,
        '-N', [string]$announcedRounds,
        '-t', $topColor,
        '-x', 'weighted'
      )
      $unpaired = @($payload.unpaired | ForEach-Object { [int]$_ } | Where-Object { $_ -gt 0 } | Select-Object -Unique)
      if ($unpaired.Count -gt 0) {
        $arguments += '-u'
        $arguments += @($unpaired | ForEach-Object { [string]$_ })
      }
      $pairStage = 'gacrux-pairing'
      & $gacrux @arguments 1> $stdout 2> $stderr
      $exitCode = $LASTEXITCODE
      $details = ((Get-Content -Raw $stderr -ErrorAction SilentlyContinue) + "`n" + (Get-Content -Raw $stdout -ErrorAction SilentlyContinue)).Trim()
      if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $output)) {
        if ($details) {
          throw $details
        }
        throw "Gacrux exited with code $exitCode."
      }

      # Gacrux pairing itself is unchanged (Dutch + weighted).  Only its output
      # serialization is text, because Windows PowerShell 5.1 cannot safely
      # deserialize Gacrux's arbitrarily large weighted-quality JSON integers.
      $pairStage = 'pairing-text-parse'
      $gacruxParsed = Read-GacruxPairingText $output 'Gacrux'
      $pairs = [object[]]$gacruxParsed.Pairs
      $pairing = [string]$gacruxParsed.Text

      Write-EngineLog "Round $pairingRound text pairing parsed: $($pairs.Count) pair(s)."
      $pairStage = 'gacrux-checker'
      $checker = Invoke-GacruxPairingCheck `
        ([string]$syncedTrf.Trf) `
        $pairingRound `
        $announcedRounds `
        $topColor `
        $pairs `
        $unpaired `
        $temp

      $checkerLabel = if ([string]$checker.Mode -eq 'unpaired-regeneration') {
        'Gacrux unpaired-safe verifier'
      } else {
        'Pairing Checker'
      }

      Write-EngineLog "Round $pairingRound generated and $checkerLabel approved it."

      $checkerPayload = @{
        ok = [bool]$checker.Ok
        round = [int]$checker.Round
        statusCode = [int]$checker.StatusCode
        check = [bool]$checker.Check
        rules = [string]$checker.Rules
        mode = [string]$checker.Mode
      }

      # Independent verifier: bbpPairings never generates or replaces a pairing.
      # A concrete mismatch is fail-closed; missing/unavailable checker is surfaced
      # separately so an offline venue cannot silently switch pairing engines.
      $pairStage = 'bbp-independent-checker'
      $independent = Invoke-BbpPairingCheck ([string]$syncedTrf.Trf) $pairingRound $pairs $temp $unpaired
      $independentPayload = @{
        available = [bool]$independent.Available
        ok = [bool]$independent.Ok
        check = $independent.Check
        round = [int]$independent.Round
        checker = 'bbpPairings'
        version = [string]$independent.Version
        state = [string]$independent.State
        message = [string]$independent.Message
        mismatchRounds = @($independent.MismatchRounds)
      }
      if ([string]$independent.State -eq 'fail') {
        throw "BBP Independent Pairing Checker rejected Round $pairingRound. $([string]$independent.Message)"
      }

      Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
      $temp = $null

      $pairStage = 'response-json'
      Send-JsonResponse $context 200 @{
        ok = $true
        output = $pairing
        engine = 'Gacrux 1.9.57'
        rules = 'FIDE Dutch System — Gacrux 1.9.57 weighted'
        checker = $checkerPayload
        independentChecker = $independentPayload
      }
    } catch {
      $rawMessage = $_.Exception.Message
      $message = if ($pairStage) { "Pairing stage ${pairStage}: $rawMessage" } else { $rawMessage }
      $errorLine = 0
      try { $errorLine = [int]$_.InvocationInfo.ScriptLineNumber } catch { $errorLine = 0 }
      if ($temp -and (Test-Path -LiteralPath $temp)) {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
      }
      if ($errorLine -gt 0) {
        Write-EngineLog "REQUEST ERROR line ${errorLine}: $message"
      } else {
        Write-EngineLog "REQUEST ERROR: $message"
      }
      try {
        Send-JsonResponse $context 400 @{ ok = $false; error = $message }
      } catch {
        # A closed/reloaded browser connection must not terminate the service.
        Write-EngineLog "Response connection closed before the error could be delivered."
      }
    }
  }
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
  Write-EngineLog "Service stopped: $stopReason."
}
