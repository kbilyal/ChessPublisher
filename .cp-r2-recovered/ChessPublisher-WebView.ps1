param(
  [int]$Port = 18765,
  [switch]$ShowConsole
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceVersion = 'V138'
$webViewRelease = '1.03.77'
$webView2SdkVersion = '1.0.4129.50'
$logFile = Join-Path $root 'ChessPublisher-WebView.log'
$engineOwned = $false
$engineMode = ''
$engineProcess = $null
$engineRunspace = $null
$enginePowerShell = $null
$engineAsync = $null

function Write-WvLog([string]$Message) {
  try {
    $line = '[{0}] {1}{2}' -f ([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss')), $Message, [Environment]::NewLine
    [System.IO.File]::AppendAllText($logFile, $line, (New-Object System.Text.UTF8Encoding($false)))
  } catch {}
}

function Get-WvSafeTournamentFolderName([string]$Name) {
  $safe = ([string]$Name).Trim()
  if ([string]::IsNullOrWhiteSpace($safe)) { throw 'Tournament name is required for TRF export.' }
  foreach ($c in [System.IO.Path]::GetInvalidFileNameChars()) { $safe = $safe.Replace([string]$c, '_') }
  $safe = $safe.Trim().TrimEnd('.')
  if ([string]::IsNullOrWhiteSpace($safe)) { throw 'Tournament name is not valid for a folder.' }
  if ($safe.Length -gt 120) { $safe = $safe.Substring(0,120).Trim() }
  return $safe
}

function Test-WvTournamentFileMatchesName([string]$FullPath, [string]$TournamentName) {
  try {
    $expected = Get-WvSafeTournamentFolderName $TournamentName
    $parent = Split-Path -Parent $FullPath
    if ([string]::IsNullOrWhiteSpace($parent)) { return $false }

    # Normal ChessPublisher layout: ...\ChessPublisher Tournaments\<Tournament>\tournament.json
    $leaf = Split-Path -Leaf $parent
    if ([string]::Equals([string]$leaf,[string]$expected,[System.StringComparison]::OrdinalIgnoreCase)) { return $true }

    # Defense-in-depth for a future/custom absolute path: trust it only when the
    # JSON file itself identifies the same tournament. Never infer ownership from
    # a stale path merely because it ends in .json.
    if (Test-Path -LiteralPath $FullPath -PathType Leaf) {
      try {
        $raw = [System.IO.File]::ReadAllText($FullPath)
        $obj = $raw | ConvertFrom-Json
        $declared = ''
        if ($null -ne $obj.data -and $null -ne $obj.data.currentTournament) { $declared = [string]$obj.data.currentTournament }
        elseif ($null -ne $obj.currentTournament) { $declared = [string]$obj.currentTournament }
        if ([string]::Equals($declared.Trim(),([string]$TournamentName).Trim(),[System.StringComparison]::OrdinalIgnoreCase)) { return $true }
      } catch {
        Write-WvLog ('TRF folder: tournament JSON identity check failed: ' + $_.Exception.Message)
      }
    }
  } catch {
    Write-WvLog ('TRF folder: path identity validation failed: ' + $_.Exception.Message)
  }
  return $false
}

function Get-WvTournamentTrfFolder([string]$TournamentName, [string]$TournamentFilePath) {
  $tournamentFolder = $null
  $candidate = ([string]$TournamentFilePath).Trim()
  if (-not [string]::IsNullOrWhiteSpace($candidate)) {
    try {
      if (-not [System.IO.Path]::IsPathRooted($candidate)) {
        throw 'supplied tournament path is not absolute'
      }
      $full = [System.IO.Path]::GetFullPath($candidate)
      if ([System.IO.Path]::GetExtension($full) -ine '.json') {
        throw 'supplied tournament path is not a JSON tournament file'
      }
      if (-not (Test-WvTournamentFileMatchesName $full $TournamentName)) {
        throw "supplied tournament path does not belong to '$TournamentName'"
      }
      $parent = Split-Path -Parent $full
      if (-not [string]::IsNullOrWhiteSpace($parent)) { $tournamentFolder = $parent }
    } catch {
      # A stale/mismatched document path must never route a TRF into another
      # tournament's folder. Ignore it and use the current tournament fallback.
      Write-WvLog ('TRF folder: supplied tournament file path was ignored: ' + $_.Exception.Message)
    }
  }

  if ([string]::IsNullOrWhiteSpace($tournamentFolder)) {
    $documents = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)
    if ([string]::IsNullOrWhiteSpace($documents)) { throw 'Windows Documents folder could not be resolved.' }
    $rootFolder = Join-Path $documents 'ChessPublisher Tournaments'
    $tournamentFolder = Join-Path $rootFolder (Get-WvSafeTournamentFolderName $TournamentName)
  }

  New-Item -ItemType Directory -Path $tournamentFolder -Force | Out-Null
  $trfFolder = Join-Path $tournamentFolder 'TRF'
  New-Item -ItemType Directory -Path $trfFolder -Force | Out-Null
  return $trfFolder
}

function Get-WvSafeTrfFileName([string]$Name) {
  $fileName = [System.IO.Path]::GetFileName(([string]$Name).Trim())
  if ([string]::IsNullOrWhiteSpace($fileName)) { throw 'TRF file name is required.' }
  foreach ($c in [System.IO.Path]::GetInvalidFileNameChars()) { $fileName = $fileName.Replace([string]$c, '_') }
  $ext = [System.IO.Path]::GetExtension($fileName)
  if (($ext -ine '.trf') -and ($ext -ine '.txt')) { throw 'TRF export file must use .TRF or .TXT.' }
  return $fileName
}


function Get-WvTournamentPgnFolder([string]$TournamentName, [string]$TournamentFilePath) {
  # Reuse the v1.03.47 tournament-identity guard already used by TRF exports.
  # The returned parent is therefore guaranteed to belong to the active
  # tournament (or to the safe Documents fallback for that tournament).
  $trfFolder = Get-WvTournamentTrfFolder $TournamentName $TournamentFilePath
  $tournamentFolder = Split-Path -Parent $trfFolder
  if ([string]::IsNullOrWhiteSpace($tournamentFolder)) { throw 'Tournament folder could not be resolved for PGN output.' }
  $pgnFolder = Join-Path $tournamentFolder 'PGN'
  New-Item -ItemType Directory -Path $pgnFolder -Force | Out-Null
  return $pgnFolder
}

function Get-WvSafePgnFileName([string]$Name) {
  $fileName = [System.IO.Path]::GetFileName(([string]$Name).Trim())
  if ([string]::IsNullOrWhiteSpace($fileName)) { throw 'PGN file name is required.' }
  foreach ($c in [System.IO.Path]::GetInvalidFileNameChars()) { $fileName = $fileName.Replace([string]$c, '_') }
  if ([System.IO.Path]::GetExtension($fileName) -ine '.pgn') { throw 'PGN export file must use .pgn.' }
  return $fileName
}

function Get-WvDgtWindowsDiagnostics {
  $ports = @()
  try {
    if ('ChessPublisher.DgtBridge' -as [type]) { $ports = @([ChessPublisher.DgtBridge]::GetPortNames()) }
    else { $ports = @([System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object) }
  } catch { $ports = @() }

  $devices = @()
  $queryError = ''
  try {
    $entities = @(Get-CimInstance Win32_PnPEntity -ErrorAction Stop)
    foreach($d in $entities) {
      $name = [string]$d.Name
      $id = [string]$d.PNPDeviceID
      $manufacturer = [string]$d.Manufacturer
      $service = [string]$d.Service
      $isCandidate =
        ($name -match '\(COM\d+\)') -or
        ($name -match '(?i)DGT|USB Serial|FTDI|Rabbit') -or
        ($manufacturer -match '(?i)DGT|FTDI') -or
        ($id -match '(?i)VID_045B&PID_8111|VID_0403')
      if(-not $isCandidate) { continue }

      $com = ''
      $m = [regex]::Match($name,'\((COM\d+)\)',[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
      if($m.Success) { $com = $m.Groups[1].Value.ToUpperInvariant() }

      $devices += [pscustomobject]@{
        Name = $name
        Manufacturer = $manufacturer
        PnpId = $id
        Service = $service
        ComPort = $com
        Status = [string]$d.Status
        ConfigError = [int]$d.ConfigManagerErrorCode
      }
    }
  } catch {
    $queryError = $_.Exception.Message
  }

  $installedPackages = @()
  try {
    $roots = @(
      'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach($rootKey in $roots) {
      foreach($pkg in @(Get-ItemProperty -Path $rootKey -ErrorAction SilentlyContinue)) {
        $displayName = [string]$pkg.DisplayName
        if($displayName -match '(?i)DGT.*e-?Board|DGT.*Rabbit|RabbitPlugin') {
          $installedPackages += [pscustomobject]@{
            Name = $displayName
            Version = [string]$pkg.DisplayVersion
            Publisher = [string]$pkg.Publisher
          }
        }
      }
    }
    $installedPackages = @($installedPackages | Sort-Object Name,Version -Unique)
  } catch {}

  $dgtSpecific = @($devices | Where-Object {
    ([string]$_.Name -match '(?i)DGT|Rabbit') -or
    ([string]$_.Manufacturer -match '(?i)DGT') -or
    ([string]$_.PnpId -match '(?i)VID_045B&PID_8111')
  })
  $problemDevices = @($devices | Where-Object { [int]$_.ConfigError -ne 0 })
  $status = 'Unknown'
  $summary = ''

  if($problemDevices.Count -gt 0) {
    $missingDriver = @($problemDevices | Where-Object { [int]$_.ConfigError -eq 28 })
    if($missingDriver.Count -gt 0) {
      $status = 'DriverMissing'
      $summary = 'Windows detects a relevant USB/serial device, but its driver is not installed (Device Manager code 28).'
    } else {
      $status = 'DeviceProblem'
      $codes = ($problemDevices | ForEach-Object { [string]$_.ConfigError } | Select-Object -Unique) -join ', '
      $summary = "Windows reports a device/driver problem (Device Manager code $codes)."
    }
  } elseif($ports.Count -gt 0) {
    if($dgtSpecific.Count -gt 0) {
      $status = 'DgtDriverReady'
      $summary = "DGT/compatible Windows device detected and $($ports.Count) COM port(s) are available."
    } elseif($installedPackages.Count -gt 0) {
      $status = 'DriverInstalledSerialReady'
      $summary = "DGT e-Board/Rabbit driver package is installed and $($ports.Count) COM port(s) are available. chess-publisher will verify the board by protocol response."
    } else {
      $status = 'SerialReady'
      $summary = "$($ports.Count) Windows COM port(s) are available. chess-publisher will verify DGT compatibility by protocol response."
    }
  } elseif($dgtSpecific.Count -gt 0) {
    $status = 'NoComPort'
    $summary = 'A DGT-related device is visible in Windows, but no COM port is exposed. Check/reinstall the official DGT e-Board driver.'
  } elseif($installedPackages.Count -gt 0) {
    $status = 'DriverInstalledNoHardware'
    $summary = 'DGT e-Board/Rabbit driver package is installed, but no board/COM interface is currently connected.'
  } else {
    $status = 'NoSerialDevice'
    $summary = 'No Windows COM port or DGT-related USB/serial device is currently visible, and no DGT e-Board/Rabbit package was found in the installed-program registry.'
  }

  if(-not [string]::IsNullOrWhiteSpace($queryError)) {
    $summary += ' Windows device details could not be fully queried: ' + $queryError
  }

  return [pscustomobject]@{
    Status = $status
    Summary = $summary.Trim()
    Ports = $ports
    Devices = $devices
    InstalledPackages = $installedPackages
    OfficialDriverUrl = 'https://www.digitalgametechnology.com/support/software/software-downloads'
  }
}


function Initialize-ChessPublisherDgtBridge {
  if ('ChessPublisher.DgtBridge' -as [type]) { return }
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.IO.Ports;
using System.Linq;
using System.Text;
using System.Threading;
using System.Management;
using Microsoft.Win32;

namespace ChessPublisher {
  public sealed class DgtBoardInfo {
    public int Number { get; set; }
    public string Port { get; set; }
    public string Mode { get; set; }
    public int Address { get; set; }
    public string Serial { get; set; }
    public string Version { get; set; }
    public int[] Pieces { get; set; }
    public string Error { get; set; }
  }

  public sealed class DgtSnapshot {
    public bool Connected { get; set; }
    public string[] Ports { get; set; }
    public DgtBoardInfo[] Boards { get; set; }
    public string[] Warnings { get; set; }
  }

  public sealed class DgtWindowsDevice {
    public string Name { get; set; }
    public string Manufacturer { get; set; }
    public string PnpId { get; set; }
    public string Service { get; set; }
    public string ComPort { get; set; }
    public string Status { get; set; }
    public int ConfigError { get; set; }
  }

  public sealed class DgtInstalledPackage {
    public string Name { get; set; }
    public string Version { get; set; }
    public string Publisher { get; set; }
  }

  public sealed class DgtWindowsDiagnostics {
    public string Status { get; set; }
    public string Summary { get; set; }
    public string[] Ports { get; set; }
    public DgtWindowsDevice[] Devices { get; set; }
    public DgtInstalledPackage[] InstalledPackages { get; set; }
    public string OfficialDriverUrl { get; set; }
  }

  public sealed class DgtAsyncResult {
    public string RequestId { get; set; }
    public string Operation { get; set; }
    public bool Ok { get; set; }
    public string Error { get; set; }
    public DgtSnapshot Snapshot { get; set; }
    public DgtWindowsDiagnostics Diagnostics { get; set; }
  }

  internal sealed class DgtConnection {
    public SerialPort Port;
    public string Mode;
    public List<int> Addresses = new List<int>();
    public Dictionary<int,DgtBoardInfo> Boards = new Dictionary<int,DgtBoardInfo>();
  }

  internal sealed class DgtFrame {
    public byte[] Bytes;
    public int Type { get { return Bytes == null || Bytes.Length == 0 ? -1 : Bytes[0]; } }
  }

  public static class DgtBridge {
    private static readonly object Sync = new object();
    private static readonly object JobSync = new object();
    private static readonly Dictionary<string,DgtConnection> Connections = new Dictionary<string,DgtConnection>(StringComparer.OrdinalIgnoreCase);
    private static readonly Dictionary<string,DgtAsyncResult> CompletedJobs = new Dictionary<string,DgtAsyncResult>(StringComparer.Ordinal);
    private static readonly HashSet<string> RunningJobs = new HashSet<string>(StringComparer.Ordinal);

    public static string[] GetPortNames() {
      try { return SerialPort.GetPortNames().OrderBy(NaturalPortKey).ToArray(); }
      catch { return new string[0]; }
    }

    public static bool BeginAsync(string requestId, string operation, int expectedBoards) {
      if (String.IsNullOrWhiteSpace(requestId)) throw new ArgumentException("DGT request id is missing.");
      operation = (operation ?? "").Trim().ToLowerInvariant();
      lock (JobSync) {
        if (RunningJobs.Contains(requestId) || CompletedJobs.ContainsKey(requestId)) return false;
        RunningJobs.Add(requestId);
      }
      ThreadPool.QueueUserWorkItem(delegate {
        var result = new DgtAsyncResult { RequestId = requestId, Operation = operation, Ok = false, Error = "" };
        try {
          if (operation == "ports" || operation == "diagnostics") {
            result.Snapshot = GetSnapshot();
            result.Diagnostics = GetWindowsDiagnostics();
          } else if (operation == "connect") {
            result.Snapshot = ConnectAll(Math.Max(0, expectedBoards));
            result.Diagnostics = GetWindowsDiagnostics();
          } else if (operation == "refresh") {
            result.Snapshot = RefreshAll();
          } else if (operation == "disconnect") {
            result.Snapshot = DisconnectAll();
          } else {
            throw new InvalidOperationException("Unknown DGT operation '" + operation + "'.");
          }
          result.Ok = true;
        } catch (Exception ex) {
          result.Error = CleanError(ex.Message);
        } finally {
          lock (JobSync) {
            RunningJobs.Remove(requestId);
            CompletedJobs[requestId] = result;
          }
        }
      });
      return true;
    }

    public static DgtAsyncResult[] TakeCompleted() {
      lock (JobSync) {
        if (CompletedJobs.Count == 0) return new DgtAsyncResult[0];
        var items = CompletedJobs.Values.ToArray();
        CompletedJobs.Clear();
        return items;
      }
    }

    public static DgtSnapshot GetSnapshot() {
      lock (Sync) { return BuildSnapshot(GetPortNames(), new List<string>()); }
    }

    public static DgtWindowsDiagnostics GetWindowsDiagnostics() {
      var ports = GetPortNames();
      var devices = new List<DgtWindowsDevice>();
      var packages = new List<DgtInstalledPackage>();
      string queryError = "";
      try {
        using (var searcher = new ManagementObjectSearcher("SELECT Name,PNPDeviceID,Manufacturer,Service,Status,ConfigManagerErrorCode FROM Win32_PnPEntity"))
        using (var results = searcher.Get()) {
          foreach (ManagementObject d in results) {
            string name = SafeString(d["Name"]), pnpId = SafeString(d["PNPDeviceID"]), manufacturer = SafeString(d["Manufacturer"]), service = SafeString(d["Service"]);
            bool candidate = ContainsIgnoreCase(name,"(COM") || ContainsIgnoreCase(name,"DGT") || ContainsIgnoreCase(name,"USB Serial") || ContainsIgnoreCase(name,"FTDI") || ContainsIgnoreCase(name,"Rabbit") || ContainsIgnoreCase(manufacturer,"DGT") || ContainsIgnoreCase(manufacturer,"FTDI") || ContainsIgnoreCase(pnpId,"VID_045B&PID_8111") || ContainsIgnoreCase(pnpId,"VID_0403");
            if (!candidate) continue;
            string com = ExtractComPort(name);
            int configError = 0;
            try { if (d["ConfigManagerErrorCode"] != null) configError = Convert.ToInt32(d["ConfigManagerErrorCode"]); } catch {}
            devices.Add(new DgtWindowsDevice { Name=name, Manufacturer=manufacturer, PnpId=pnpId, Service=service, ComPort=com, Status=SafeString(d["Status"]), ConfigError=configError });
          }
        }
      } catch (Exception ex) { queryError = CleanError(ex.Message); }

      try {
        using (var hklm64 = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)) ScanUninstallRoot(hklm64, @"Software\Microsoft\Windows\CurrentVersion\Uninstall", packages);
      } catch {}
      try {
        using (var hklm32 = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry32)) ScanUninstallRoot(hklm32, @"Software\Microsoft\Windows\CurrentVersion\Uninstall", packages);
      } catch {}
      try {
        using (var hkcu = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryView.Default)) ScanUninstallRoot(hkcu, @"Software\Microsoft\Windows\CurrentVersion\Uninstall", packages);
      } catch {}
      packages = packages.GroupBy(x => (x.Name ?? "") + "\n" + (x.Version ?? ""), StringComparer.OrdinalIgnoreCase).Select(g => g.First()).OrderBy(x => x.Name).ThenBy(x => x.Version).ToList();

      var dgtSpecific = devices.Where(x => ContainsIgnoreCase(x.Name,"DGT") || ContainsIgnoreCase(x.Name,"Rabbit") || ContainsIgnoreCase(x.Manufacturer,"DGT") || ContainsIgnoreCase(x.PnpId,"VID_045B&PID_8111")).ToList();
      var problemDevices = devices.Where(x => x.ConfigError != 0).ToList();
      string status = "Unknown", summary = "";
      if (problemDevices.Count > 0) {
        if (problemDevices.Any(x => x.ConfigError == 28)) { status="DriverMissing"; summary="Windows detects a relevant USB/serial device, but its driver is not installed (Device Manager code 28)."; }
        else { status="DeviceProblem"; summary="Windows reports a device/driver problem (Device Manager code " + String.Join(", ", problemDevices.Select(x => x.ConfigError.ToString()).Distinct().ToArray()) + ")."; }
      } else if (ports.Length > 0) {
        if (dgtSpecific.Count > 0) { status="DgtDriverReady"; summary="DGT/compatible Windows device detected and " + ports.Length + " COM port(s) are available."; }
        else if (packages.Count > 0) { status="DriverInstalledSerialReady"; summary="DGT e-Board/Rabbit driver package is installed and " + ports.Length + " COM port(s) are available. chess-publisher will verify the board by protocol response."; }
        else { status="SerialReady"; summary=ports.Length + " Windows COM port(s) are available. chess-publisher will verify DGT compatibility by protocol response."; }
      } else if (dgtSpecific.Count > 0) { status="NoComPort"; summary="A DGT-related device is visible in Windows, but no COM port is exposed. Check/reinstall the official DGT e-Board driver."; }
      else if (packages.Count > 0) { status="DriverInstalledNoHardware"; summary="DGT e-Board/Rabbit driver package is installed, but no board/COM interface is currently connected."; }
      else { status="NoSerialDevice"; summary="No Windows COM port or DGT-related USB/serial device is currently visible, and no DGT e-Board/Rabbit package was found in the installed-program registry."; }
      if (!String.IsNullOrWhiteSpace(queryError)) summary += " Windows device details could not be fully queried: " + queryError;
      return new DgtWindowsDiagnostics { Status=status, Summary=(summary ?? "").Trim(), Ports=ports, Devices=devices.ToArray(), InstalledPackages=packages.ToArray(), OfficialDriverUrl="https://www.digitalgametechnology.com/support/software/software-downloads" };
    }

    private static void ScanUninstallRoot(RegistryKey baseKey, string path, List<DgtInstalledPackage> packages) {
      if (baseKey == null) return;
      using (var root = baseKey.OpenSubKey(path)) {
        if (root == null) return;
        foreach (var subName in root.GetSubKeyNames()) {
          try {
            using (var sub = root.OpenSubKey(subName)) {
              if (sub == null) continue;
              string name = Convert.ToString(sub.GetValue("DisplayName") ?? "");
              if (!(ContainsIgnoreCase(name,"DGT") && (ContainsIgnoreCase(name,"e-Board") || ContainsIgnoreCase(name,"eBoard") || ContainsIgnoreCase(name,"Rabbit")))) continue;
              packages.Add(new DgtInstalledPackage { Name=name, Version=Convert.ToString(sub.GetValue("DisplayVersion") ?? ""), Publisher=Convert.ToString(sub.GetValue("Publisher") ?? "") });
            }
          } catch {}
        }
      }
    }

    private static string SafeString(object value) { try { return Convert.ToString(value ?? "") ?? ""; } catch { return ""; } }
    private static bool ContainsIgnoreCase(string value, string part) { return !String.IsNullOrEmpty(value) && !String.IsNullOrEmpty(part) && value.IndexOf(part, StringComparison.OrdinalIgnoreCase) >= 0; }
    private static string ExtractComPort(string name) {
      if (String.IsNullOrWhiteSpace(name)) return "";
      int start = name.LastIndexOf("(COM", StringComparison.OrdinalIgnoreCase);
      if (start < 0) return "";
      int end = name.IndexOf(')', start);
      if (end <= start + 1) return "";
      return name.Substring(start + 1, end - start - 1).ToUpperInvariant();
    }

    public static DgtSnapshot ConnectAll(int expectedBoards) {
      lock (Sync) {
        DisconnectAllInternal();
        var warnings = new List<string>();
        var names = GetPortNames();
        int found = 0;
        foreach (var name in names) {
          if (expectedBoards > 0 && found >= expectedBoards) break;
          SerialPort port = null;
          try {
            port = CreatePort(name);
            port.Open();
            port.DiscardInBuffer();
            port.DiscardOutBuffer();

            var conn = TryConnectBus(port, expectedBoards > 0 ? Math.Max(1, expectedBoards - found) : 0);
            if (conn == null) {
              try { port.Close(); } catch {}
              try { port.Dispose(); } catch {}
              port = CreatePort(name);
              port.Open();
              port.DiscardInBuffer();
              port.DiscardOutBuffer();
              conn = TryConnectSingle(port);
            }

            if (conn != null && conn.Boards.Count > 0) {
              Connections[name] = conn;
              found += conn.Boards.Count;
              port = null; // owned by connection now
            }
          } catch (Exception ex) {
            warnings.Add(name + ": " + CleanError(ex.Message));
          } finally {
            if (port != null) {
              try { if (port.IsOpen) port.Close(); } catch {}
              try { port.Dispose(); } catch {}
            }
          }
        }
        RefreshAllInternal(warnings);
        return BuildSnapshot(names, warnings);
      }
    }

    public static DgtSnapshot RefreshAll() {
      lock (Sync) {
        var warnings = new List<string>();
        RefreshAllInternal(warnings);
        return BuildSnapshot(GetPortNames(), warnings);
      }
    }

    public static DgtSnapshot DisconnectAll() {
      lock (Sync) {
        DisconnectAllInternal();
        return BuildSnapshot(GetPortNames(), new List<string>());
      }
    }

    private static void RefreshAllInternal(List<string> warnings) {
      foreach (var entry in Connections.ToArray()) {
        var conn = entry.Value;
        if (conn == null || conn.Port == null || !conn.Port.IsOpen) continue;
        try {
          if (string.Equals(conn.Mode, "bus", StringComparison.OrdinalIgnoreCase)) RefreshBus(conn);
          else RefreshSingle(conn);
        } catch (Exception ex) {
          warnings.Add(entry.Key + ": refresh failed - " + CleanError(ex.Message));
          foreach (var b in conn.Boards.Values) b.Error = "Refresh failed: " + CleanError(ex.Message);
        }
      }
    }

    private static DgtConnection TryConnectBus(SerialPort port, int expectedRemaining) {
      // DGT serial e-Boards power up in bus mode. 0x4A explicitly returns a
      // board that was previously used in single-board mode to bus mode.
      WriteRaw(port, new byte[] { 0x4A });
      Thread.Sleep(80);
      var addresses = new HashSet<int>();
      int passes = expectedRemaining > 1 ? 3 : 2;
      for (int pass = 0; pass < passes; pass++) {
        SendBusCommand(port, 0x87, 0); // broadcast PING
        var frames = ReadBusFrames(port, 1250);
        foreach (var f in frames) {
          if (f.Type == 0x87 && f.Bytes.Length == 6 && ValidBusChecksum(f.Bytes)) {
            int address = f.Bytes[3] * 128 + f.Bytes[4];
            if (address > 0) addresses.Add(address);
          }
        }
        if (expectedRemaining > 0 && addresses.Count >= expectedRemaining) break;
      }
      if (addresses.Count == 0) return null;

      var conn = new DgtConnection { Port = port, Mode = "bus" };
      foreach (int address in addresses.OrderBy(x => x)) {
        conn.Addresses.Add(address);
        conn.Boards[address] = new DgtBoardInfo {
          Port = port.PortName,
          Mode = "Serial bus",
          Address = address,
          Serial = "Bus " + address.ToString("D5"),
          Version = "",
          Pieces = null,
          Error = ""
        };
      }
      return conn;
    }

    private static DgtConnection TryConnectSingle(SerialPort port) {
      WriteRaw(port, new byte[] { 0x40 }); // RESET/IDLE
      Thread.Sleep(60);
      port.DiscardInBuffer();
      WriteRaw(port, new byte[] { 0x55 }); // long serial number
      WriteRaw(port, new byte[] { 0x4D }); // firmware version
      WriteRaw(port, new byte[] { 0x42 }); // board dump
      var frames = ReadSingleFrames(port, 850);
      string serial = "";
      string version = "";
      int[] pieces = null;
      foreach (var f in frames) {
        if (f.Type == 0xA2 && f.Bytes.Length >= 13) serial = SafeAscii(f.Bytes, 3, 10).Trim();
        else if (f.Type == 0x91 && f.Bytes.Length >= 8 && String.IsNullOrWhiteSpace(serial)) serial = SafeAscii(f.Bytes, 3, Math.Min(5, f.Bytes.Length - 3)).Trim();
        else if (f.Type == 0x93 && f.Bytes.Length >= 5) version = f.Bytes[3].ToString() + "." + f.Bytes[4].ToString("D2");
        else if (f.Type == 0x86 && f.Bytes.Length >= 67) pieces = SlicePieces(f.Bytes, 3);
      }
      if (pieces == null && String.IsNullOrWhiteSpace(serial) && String.IsNullOrWhiteSpace(version)) return null;
      var conn = new DgtConnection { Port = port, Mode = "single" };
      conn.Addresses.Add(0);
      conn.Boards[0] = new DgtBoardInfo {
        Port = port.PortName,
        Mode = "Direct USB/serial",
        Address = 0,
        Serial = String.IsNullOrWhiteSpace(serial) ? port.PortName : serial,
        Version = version,
        Pieces = pieces,
        Error = pieces == null ? "Board responded, but no position dump was received." : ""
      };
      return conn;
    }

    private static void RefreshBus(DgtConnection conn) {
      foreach (int address in conn.Addresses.ToArray()) {
        var board = conn.Boards[address];
        try {
          conn.Port.DiscardInBuffer();
          SendBusCommand(conn.Port, 0x82, address); // SEND_BRD
          var frames = ReadBusFrames(conn.Port, 550);
          DgtFrame dump = frames.FirstOrDefault(f => f.Type == 0x83 && f.Bytes.Length >= 70 && ValidBusChecksum(f.Bytes) && (f.Bytes[3] * 128 + f.Bytes[4]) == address);
          if (dump != null) {
            board.Pieces = SlicePieces(dump.Bytes, 5);
            board.Error = "";
          } else {
            board.Error = "No board dump received.";
          }
        } catch (Exception ex) {
          board.Error = CleanError(ex.Message);
        }
      }
    }

    private static void RefreshSingle(DgtConnection conn) {
      var board = conn.Boards[0];
      conn.Port.DiscardInBuffer();
      WriteRaw(conn.Port, new byte[] { 0x42 });
      var frames = ReadSingleFrames(conn.Port, 550);
      var dump = frames.FirstOrDefault(f => f.Type == 0x86 && f.Bytes.Length >= 67);
      if (dump != null) {
        board.Pieces = SlicePieces(dump.Bytes, 3);
        board.Error = "";
      } else board.Error = "No board dump received.";
    }

    private static DgtSnapshot BuildSnapshot(string[] ports, List<string> warnings) {
      var boards = new List<DgtBoardInfo>();
      int number = 1;
      foreach (var conn in Connections.OrderBy(k => NaturalPortKey(k.Key)).Select(k => k.Value)) {
        foreach (var b in conn.Boards.Values.OrderBy(x => x.Address)) {
          b.Number = number++;
          boards.Add(b);
        }
      }
      return new DgtSnapshot {
        Connected = Connections.Count > 0,
        Ports = ports ?? new string[0],
        Boards = boards.ToArray(),
        Warnings = warnings == null ? new string[0] : warnings.ToArray()
      };
    }

    private static SerialPort CreatePort(string name) {
      var p = new SerialPort(name, 9600, Parity.None, 8, StopBits.One);
      p.Handshake = Handshake.None;
      p.ReadTimeout = 120;
      p.WriteTimeout = 500;
      p.DtrEnable = false;
      p.RtsEnable = false;
      return p;
    }

    private static void SendBusCommand(SerialPort port, byte command, int address) {
      byte hi = (byte)((address >> 7) & 0x7F);
      byte lo = (byte)(address & 0x7F);
      byte sum = (byte)((command + hi + lo) & 0x7F);
      WriteRaw(port, new byte[] { command, hi, lo, sum });
    }

    private static void WriteRaw(SerialPort port, byte[] bytes) {
      port.Write(bytes, 0, bytes.Length);
    }

    private static List<DgtFrame> ReadBusFrames(SerialPort port, int durationMs) {
      return ReadFrames(port, durationMs, true);
    }

    private static List<DgtFrame> ReadSingleFrames(SerialPort port, int durationMs) {
      return ReadFrames(port, durationMs, false);
    }

    private static List<DgtFrame> ReadFrames(SerialPort port, int durationMs, bool bus) {
      var result = new List<DgtFrame>();
      var buffer = new List<byte>();
      var until = DateTime.UtcNow.AddMilliseconds(durationMs);
      while (DateTime.UtcNow < until) {
        try {
          int n = port.BytesToRead;
          if (n > 0) {
            byte[] tmp = new byte[Math.Min(n, 4096)];
            int got = port.Read(tmp, 0, tmp.Length);
            for (int i = 0; i < got; i++) buffer.Add(tmp[i]);
            ParseFrames(buffer, result, bus);
          } else Thread.Sleep(12);
        } catch (TimeoutException) { }
      }
      ParseFrames(buffer, result, bus);
      return result;
    }

    private static void ParseFrames(List<byte> buffer, List<DgtFrame> result, bool bus) {
      while (buffer.Count >= 3) {
        int start = 0;
        while (start < buffer.Count && (buffer[start] & 0x80) == 0) start++;
        if (start > 0) buffer.RemoveRange(0, start);
        if (buffer.Count < 3) return;
        int len = buffer[1] * 128 + buffer[2];
        int min = bus ? 6 : 3;
        if (len < min || len > 16383) { buffer.RemoveAt(0); continue; }
        if (buffer.Count < len) return;
        byte[] frame = buffer.GetRange(0, len).ToArray();
        buffer.RemoveRange(0, len);
        if (bus && !ValidBusChecksum(frame)) continue;
        result.Add(new DgtFrame { Bytes = frame });
      }
    }

    private static bool ValidBusChecksum(byte[] frame) {
      if (frame == null || frame.Length < 6) return false;
      int sum = 0;
      for (int i = 0; i < frame.Length - 1; i++) sum += frame[i];
      return ((sum & 0x7F) == (frame[frame.Length - 1] & 0x7F));
    }

    private static int[] SlicePieces(byte[] frame, int start) {
      if (frame == null || frame.Length < start + 64) return null;
      var p = new int[64];
      for (int i = 0; i < 64; i++) p[i] = frame[start + i];
      return p;
    }

    private static string SafeAscii(byte[] data, int start, int count) {
      if (data == null || start < 0 || count <= 0 || start >= data.Length) return "";
      count = Math.Min(count, data.Length - start);
      return Encoding.ASCII.GetString(data, start, count).Replace("\0", "");
    }

    private static string NaturalPortKey(string name) {
      if (String.IsNullOrWhiteSpace(name)) return "ZZZZZZ";
      string digits = new string(name.Where(Char.IsDigit).ToArray());
      int n;
      if (Int32.TryParse(digits, out n)) return n.ToString("D8") + name;
      return "99999999" + name;
    }

    private static string CleanError(string message) {
      if (String.IsNullOrWhiteSpace(message)) return "Unknown DGT communication error.";
      return message.Replace("\r", " ").Replace("\n", " ").Trim();
    }

    private static void DisconnectAllInternal() {
      foreach (var conn in Connections.Values) {
        try { if (conn.Port != null && conn.Port.IsOpen) conn.Port.Close(); } catch {}
        try { if (conn.Port != null) conn.Port.Dispose(); } catch {}
      }
      Connections.Clear();
    }
  }
}
"@ -ReferencedAssemblies 'System.dll','System.Core.dll','System.Management.dll'
}

try {
  Initialize-ChessPublisherDgtBridge
  Write-WvLog 'DGT foundation bridge initialized (direct serial + tournament bus diagnostics).'
} catch {
  # DGT is optional. A serial/driver problem must never block tournament use.
  Write-WvLog ('DGT bridge initialization unavailable; ChessPublisher continues normally: ' + $_.Exception.Message)
}

function Reset-ChessPublisherCompatibilityFlags {
  # v1.03.27 / CMP-01: Windows Program Compatibility Assistant may have
  # persisted a legacy shim for an older manifest-less ChessPublisher.exe at
  # this exact path. The new launcher carries an explicit Windows 10/11
  # manifest, so remove only ChessPublisher's own stale per-user entries.
  try {
    $exePath = Join-Path $root 'ChessPublisher.exe'
    $keys = @(
      'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers',
      'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Compatibility Assistant\Store'
    )
    foreach($key in $keys) {
      if(Test-Path -LiteralPath $key) {
        Remove-ItemProperty -LiteralPath $key -Name $exePath -ErrorAction SilentlyContinue
      }
    }
    Write-WvLog 'CMP-01: stale ChessPublisher AppCompat flags cleared (if present).'
  } catch {
    Write-WvLog ('CMP-01: AppCompat cleanup unavailable; continuing: ' + $_.Exception.Message)
  }
}

function Hide-LauncherConsole {
  if($ShowConsole) { return }
  try {
    if(-not ('ChessPublisher.ConsoleWindow' -as [type])) {
      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace ChessPublisher {
  public static class ConsoleWindow {
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  }
}
"@
    }
    $hwnd = [ChessPublisher.ConsoleWindow]::GetConsoleWindow()
    if($hwnd -ne [IntPtr]::Zero) {
      [void][ChessPublisher.ConsoleWindow]::ShowWindow($hwnd, 0) # SW_HIDE
      Write-WvLog 'Launcher console hidden by native Win32 ShowWindow.'
    }
  } catch {
    # Console hiding is cosmetic only. Never block ChessPublisher startup for it.
    Write-WvLog ('Console hide unavailable; continuing normally: ' + $_.Exception.Message)
  }
}

function Enable-ChessPublisherDpiAwareness {
  # WebView 1.03.25 retains the 1.03.6 DPI hotfix. Windows PowerShell/WinForms can otherwise be
  # bitmap-scaled by Windows at 125%/150%, which makes the whole WebView look
  # slightly soft. Set both the process default (when Windows allows it) and
  # the current UI thread to Per-Monitor V2 before any WinForms/WebView HWND is
  # created. Older Windows versions fall back to Per-Monitor/System aware.
  try {
    if(-not ('ChessPublisher.DpiAwareness' -as [type])) {
      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace ChessPublisher {
  public static class DpiAwareness {
    [DllImport("user32.dll", SetLastError=true)]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll", SetLastError=true)]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
    [DllImport("shcore.dll", SetLastError=true)]
    private static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll", SetLastError=true)]
    private static extern bool SetProcessDPIAware();

    private static readonly IntPtr PER_MONITOR_AWARE_V2 = new IntPtr(-4);

    public static string Enable() {
      string processResult = "";
      try {
        processResult = SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)
          ? "Process=PerMonitorV2"
          : "ProcessAlreadyConfigured=" + Marshal.GetLastWin32Error();
      } catch (EntryPointNotFoundException) {
        try {
          int hr = SetProcessDpiAwareness(2); // PROCESS_PER_MONITOR_DPI_AWARE
          processResult = hr == 0 ? "Process=PerMonitor" : "ProcessDpiHr=0x" + hr.ToString("X8");
        } catch {
          try { processResult = SetProcessDPIAware() ? "Process=SystemAware" : "ProcessDpiFallbackFailed"; }
          catch { processResult = "ProcessDpiUnavailable"; }
        }
      } catch (DllNotFoundException) {
        try { processResult = SetProcessDPIAware() ? "Process=SystemAware" : "ProcessDpiFallbackFailed"; }
        catch { processResult = "ProcessDpiUnavailable"; }
      }

      string threadResult = "";
      try {
        IntPtr previous = SetThreadDpiAwarenessContext(PER_MONITOR_AWARE_V2);
        threadResult = previous != IntPtr.Zero ? "Thread=PerMonitorV2" : "ThreadDpiFailed=" + Marshal.GetLastWin32Error();
      } catch (EntryPointNotFoundException) { threadResult = "ThreadDpiUnavailable"; }
      catch (DllNotFoundException) { threadResult = "ThreadDpiUnavailable"; }

      return processResult + "; " + threadResult;
    }
  }
}
"@
    }
    $dpiResult = [ChessPublisher.DpiAwareness]::Enable()
    Write-WvLog ('DPI awareness: ' + $dpiResult)
  } catch {
    # DPI enhancement is cosmetic. Never block tournament operation if a
    # locked-down Windows installation refuses the awareness call.
    Write-WvLog ('DPI awareness setup unavailable; continuing: ' + $_.Exception.Message)
  }
}

function Initialize-ChessPublisherTaskbarIdentity {
  # WebView 1.03.25 retains the icon hotfix. The actual top-level window is owned by the
  # hidden PowerShell host, so Windows can otherwise group it under the
  # PowerShell taskbar icon even though Form.Icon is set. Give the host a
  # stable explicit AppUserModelID before creating the window, then force both
  # small and large WM_SETICON values after the form handle exists.
  try {
    if(-not ('ChessPublisher.TaskbarIdentity' -as [type])) {
      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace ChessPublisher {
  public static class TaskbarIdentity {
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appID);
    [DllImport("user32.dll", CharSet=CharSet.Auto)]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    public static int SetAppId(string appId) {
      return SetCurrentProcessExplicitAppUserModelID(appId);
    }

    public static void SetWindowIcon(IntPtr hwnd, IntPtr iconHandle) {
      const uint WM_SETICON = 0x0080;
      SendMessage(hwnd, WM_SETICON, new IntPtr(0), iconHandle); // ICON_SMALL
      SendMessage(hwnd, WM_SETICON, new IntPtr(1), iconHandle); // ICON_BIG
    }
  }
}
"@
    }
    $hr = [ChessPublisher.TaskbarIdentity]::SetAppId('ChessPublisher.Desktop')
    Write-WvLog ('Taskbar AppUserModelID configured; HRESULT=0x{0:X8}' -f ($hr -band 0xffffffff))
  } catch {
    # Icon/taskbar identity is cosmetic only. Never block tournament operation.
    Write-WvLog ('Taskbar identity setup unavailable; continuing: ' + $_.Exception.Message)
  }
}


function Open-ChessResultsUploadWindow([string]$Key, [int]$Language = 1) {
  $keyValue = ([string]$Key).Trim()
  if($keyValue -notmatch '^\d+$') {
    Show-WvMessage 'Chess-Results tournament key is invalid.' 'Chess-Results Upload' 'Error'
    return
  }
  if($Language -lt 0 -or $Language -gt 20) { $Language = 1 }

  try {
    # Get the owner-provided authenticated Admin entry URL.  We use it only in
    # a short-lived hidden WebView2 session so Chess-Results itself can create
    # the current UploadData.aspx sid/sid1/time values.
    $payloadJson = (@{ key = $keyValue; language = $Language } | ConvertTo-Json -Compress)
    $adminReply = Invoke-RestMethod -Method Post `
      -Uri ("http://127.0.0.1:{0}/chessresults/admin-link" -f $Port) `
      -ContentType 'application/json; charset=utf-8' `
      -Body $payloadJson `
      -TimeoutSec 15

    $adminUrl = [string]$adminReply.url
    if([string]::IsNullOrWhiteSpace($adminUrl)) { throw 'Chess-Results did not return an Admin access URL.' }

    # Heinz's owner link already contains two standalone encrypted credentials:
    # luser_sec (CreatorID) and tnr_sec (this tournament key).  Preserve those
    # credentials when entering UploadData.  v1.03.16 dropped them on its
    # same-session fallback, which could leave UploadData unauthenticated and
    # waiting forever for sid/sid1/time.
    $luserMatch = [regex]::Match($adminUrl, '(?i)(?:[?&])luser_sec=([^&]+)')
    $tnrSecMatch = [regex]::Match($adminUrl, '(?i)(?:[?&])tnr_sec=([^&]+)')
    if(-not $luserMatch.Success -or -not $tnrSecMatch.Success) {
      throw 'Chess-Results Admin access URL is missing its encrypted owner credentials.'
    }
    $luserSec = [string]$luserMatch.Groups[1].Value
    $tnrSec = [string]$tnrSecMatch.Groups[1].Value
    $secureUploadUrl = ('https://chess-results.com/UploadData.aspx?tnr={0}&source=0&lan={1}&luser_sec={2}&tnr_sec={3}' -f $keyValue,$Language,$luserSec,$tnrSec)

    $uploadForm = New-Object System.Windows.Forms.Form
    $uploadForm.Text = 'chess-publisher Chess-Results session resolver'
    $uploadForm.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $uploadForm.Location = New-Object System.Drawing.Point(-32000,-32000)
    $uploadForm.ClientSize = New-Object System.Drawing.Size(16,16)
    $uploadForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
    $uploadForm.ShowInTaskbar = $false
    $uploadForm.ShowIcon = $false

    $uploadWeb = New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $uploadWeb.Dock = [System.Windows.Forms.DockStyle]::Fill
    $uploadWeb.DefaultBackgroundColor = [System.Drawing.Color]::White

    $creation = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
    $userData = Join-Path $env:LOCALAPPDATA 'ChessPublisher\WebView2'
    New-Item -ItemType Directory -Path $userData -Force | Out-Null
    $creation.UserDataFolder = $userData
    $uploadWeb.CreationProperties = $creation

    $state = [pscustomobject]@{
      Key = $keyValue
      Language = $Language
      AdminUrl = $adminUrl
      Stage = 0
      Opened = $false
      Failed = $false
      SecureUploadUrl = $secureUploadUrl
    }
    $uploadWeb.Tag = $state
    $uploadForm.Controls.Add($uploadWeb)

    # Never print sid/sid1/time to ChessPublisher logs.  Validate the complete
    # short-lived URL and immediately hand it to the Windows default browser.
    $openResolved = {
      param([string]$Candidate)
      if($state.Opened -or [string]::IsNullOrWhiteSpace($Candidate)) { return $false }
      try {
        $uri = New-Object System.Uri(([string]$Candidate).Trim())
        $host = $uri.Host.ToLowerInvariant()
        if(-not ($host -eq 'chess-results.com' -or $host.EndsWith('.chess-results.com'))) { return $false }
        if($uri.AbsolutePath -notmatch '(?i)/UploadData\.aspx$') { return $false }
        $q = [string]$uri.Query
        if($q -notmatch ('(?i)(?:^|[?&])tnr=' + [regex]::Escape($state.Key) + '(?:&|$)')) { return $false }
        if($q -notmatch '(?i)(?:^|[?&])sid=[A-F0-9]{16,128}(?:&|$)') { return $false }
        if($q -notmatch '(?i)(?:^|[?&])sid1=[A-F0-9]{16,128}(?:&|$)') { return $false }
        if($q -notmatch '(?i)(?:^|[?&])time=\d{14}(?:&|$)') { return $false }

        $state.Opened = $true
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $uri.AbsoluteUri
        $psi.UseShellExecute = $true
        [void][System.Diagnostics.Process]::Start($psi)
        Write-WvLog "Chess-Results UploadData session resolved and handed to the default browser for TNR $($state.Key)."
        try { $uploadForm.BeginInvoke([Action]{ $uploadForm.Close() }) | Out-Null } catch { try { $uploadForm.Close() } catch {} }
        return $true
      } catch {
        return $false
      }
    }.GetNewClosure()


    # If Chess-Results accepts the owner-provided luser_sec/tnr_sec directly on
    # UploadData, the page is already portable to the normal browser even if it
    # does not rewrite the address to sid/sid1/time.  Only hand it off after the
    # hidden WebView has positively verified that the real upload form rendered.
    $openVerifiedSecure = {
      param([string]$Candidate)
      if($state.Opened -or [string]::IsNullOrWhiteSpace($Candidate)) { return $false }
      try {
        $uri = New-Object System.Uri(([string]$Candidate).Trim())
        $host = $uri.Host.ToLowerInvariant()
        if(-not ($host -eq 'chess-results.com' -or $host.EndsWith('.chess-results.com'))) { return $false }
        if($uri.AbsolutePath -notmatch '(?i)/UploadData\.aspx$') { return $false }
        $q = [string]$uri.Query
        if($q -notmatch ('(?i)(?:^|[?&])tnr=' + [regex]::Escape($state.Key) + '(?:&|$)')) { return $false }
        if($q -notmatch '(?i)(?:^|[?&])luser_sec=[A-F0-9]{16,128}(?:&|$)') { return $false }
        if($q -notmatch '(?i)(?:^|[?&])tnr_sec=[A-F0-9]{16,128}(?:&|$)') { return $false }

        $state.Opened = $true
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $uri.AbsoluteUri
        $psi.UseShellExecute = $true
        [void][System.Diagnostics.Process]::Start($psi)
        Write-WvLog "Chess-Results UploadData owner-authenticated page verified and handed to the default browser for TNR $($state.Key)."
        try { $uploadForm.BeginInvoke([Action]{ $uploadForm.Close() }) | Out-Null } catch { try { $uploadForm.Close() } catch {} }
        return $true
      } catch {
        return $false
      }
    }.GetNewClosure()

    $uploadWeb.add_CoreWebView2InitializationCompleted({
      param($sender,$e)
      if(-not $e.IsSuccess) {
        $state.Failed = $true
        $err = if($e.InitializationException){$e.InitializationException.Message}else{'Unknown WebView2 initialization error.'}
        Write-WvLog ('Chess-Results hidden session resolver initialization failed: ' + $err)
        try { $uploadForm.Close() } catch {}
        Show-WvMessage ("Chess-Results Upload session could not start:`r`n`r`n" + $err) 'Chess-Results Upload' 'Error'
        return
      }

      $core = $sender.CoreWebView2
      $core.Settings.AreDefaultContextMenusEnabled = $false
      $core.Settings.AreDevToolsEnabled = $false
      $core.Settings.IsStatusBarEnabled = $false
      $core.Settings.IsZoomControlEnabled = $false

      $core.add_NewWindowRequested({
        param($s,$a)
        try {
          $candidate = [string]$a.Uri
          if((& $openResolved $candidate)) {
            $a.Handled = $true
            return
          }
          if($candidate -match '(?i)/UploadData\.aspx') {
            # Keep incomplete UploadData navigation in the authenticated hidden
            # WebView until Chess-Results redirects to the standalone URL.
            $a.Handled = $true
            $core.Navigate($candidate)
          }
        } catch {
          Write-WvLog ('Chess-Results hidden new-window navigation failed: ' + $_.Exception.Message)
        }
      }.GetNewClosure())

      $webControl = $sender
      $navigationHandler = {
        param($navSender,$navArgs)
        try {
          $source = [string]$navSender.Source
          if((& $openResolved $source)) { return }
          if(-not $navArgs.IsSuccess) { return }

          $currentUri = $null
          try { $currentUri = New-Object System.Uri($source) } catch {}
          $isChessResults = $false
          $isAdmin = $false
          $isUpload = $false
          if($null -ne $currentUri) {
            $h = $currentUri.Host.ToLowerInvariant()
            $isChessResults = ($h -eq 'chess-results.com' -or $h.EndsWith('.chess-results.com'))
            $isAdmin = $isChessResults -and ($currentUri.AbsolutePath -match '(?i)/Stammdaten\.aspx$')
            $isUpload = $isChessResults -and ($currentUri.AbsolutePath -match '(?i)/UploadData\.aspx$')
          }

          if($isUpload) {
            # First see whether the page has already become the exact standalone
            # sid/sid1/time URL used by Swiss-Manager.
            if((& $openResolved $source)) { return }

            # Otherwise verify the actual admin upload form.  If it rendered
            # under luser_sec/tnr_sec, that URL itself is safe to hand to the
            # normal browser; no fabricated session token is needed.
            $verifyScript = @"
(() => {
  const fileInput = document.querySelector('input[type="file"]');
  const body = (document.body && document.body.innerText || '').toLowerCase();
  const uploadText = body.includes('you can upload') || body.includes('choose files') || body.includes('author / owner of the files');
  return !!fileInput && uploadText;
})()
"@
            try {
              $task = $navSender.ExecuteScriptAsync($verifyScript)
              $verifiedJson = $task.GetAwaiter().GetResult()
              if(([string]$verifiedJson).Trim().ToLowerInvariant() -eq 'true') {
                if((& $openVerifiedSecure $source)) { return }
              }
            } catch {
              Write-WvLog ('Chess-Results UploadData form verification warning: ' + $_.Exception.Message)
            }
          }

          if($state.Stage -eq 0 -and $isAdmin) {
            $state.Stage = 1
            # Click Chess-Results' own UploadData target if it exists.  If the
            # admin page does not expose one, enter UploadData while KEEPING the
            # encrypted owner credentials from the Admin link.  v1.03.16 used a
            # bare tnr/source/lan URL here and therefore lost authentication.
            $safeSecure = ([string]$state.SecureUploadUrl).Replace('\\','\\\\').Replace("'","\\'")
            $script = @"
(() => {
  const secure='$safeSecure';
  const textOf = el => ((el.innerText || el.value || el.title || el.getAttribute('aria-label') || '') + '').trim();
  const all = [...document.querySelectorAll('a,button,input,area')];
  let target = all.find(el => /UploadData\.aspx/i.test(
    (el.href || '') + ' ' + (el.formAction || '') + ' ' + (el.getAttribute('onclick') || '') + ' ' + (el.getAttribute('action') || '')
  ));
  if (!target) target = all.find(el => /\b(upload|upload data|hochladen|daten hochladen|import)\b/i.test(textOf(el)));
  const form = [...document.forms].find(f => /UploadData\.aspx/i.test(f.action || ''));
  if (target) { try { target.click(); return 'clicked'; } catch(e) {} }
  if (form) { try { form.submit(); return 'submitted'; } catch(e) {} }
  setTimeout(() => { window.location.href = secure; }, 250);
  return 'owner-auth-fallback';
})()
"@
            [void]$navSender.ExecuteScriptAsync($script)
            Write-WvLog "Chess-Results Admin entry loaded for TNR $($state.Key); requesting owner-authenticated UploadData handoff."
          }
        } catch {
          Write-WvLog ('Chess-Results hidden UploadData navigation failed: ' + $_.Exception.Message)
        }
      }.GetNewClosure()
      $core.add_NavigationCompleted($navigationHandler)

      Write-WvLog "Resolving Chess-Results UploadData session for TNR $($state.Key) in hidden WebView2."
      $core.Navigate([string]$state.AdminUrl)
    }.GetNewClosure())

    $timeout = New-Object System.Windows.Forms.Timer
    $timeout.Interval = 35000
    $timeout.add_Tick({
      $timeout.Stop()
      if(-not $state.Opened -and -not $state.Failed) {
        $state.Failed = $true
        Write-WvLog "Chess-Results UploadData session resolution timed out for TNR $($state.Key)."
        try { $uploadForm.Close() } catch {}
        Show-WvMessage 'Chess-Results did not return an authenticated Upload Data page in time. Please retry.' 'Chess-Results Upload' 'Error'
      }
    }.GetNewClosure())

    $uploadForm.add_FormClosed({
      try { $timeout.Stop(); $timeout.Dispose() } catch {}
      try {
        foreach($control in @($uploadForm.Controls)) { try { $control.Dispose() } catch {} }
      } catch {}
    }.GetNewClosure())

    $timeout.Start()
    [void]$uploadForm.Show($form)
    # v1.03.61: helper WebView2 controls do not initialize merely because a
    # WinForms Form is shown.  Explicitly start CoreWebView2 initialization;
    # the InitializationCompleted handler above then navigates to the private
    # owner Admin URL.  This avoids the blank helper window / timeout regression.
    [void]$uploadWeb.EnsureCoreWebView2Async($null)
  } catch {
    Write-WvLog ('Chess-Results UploadData browser handoff failed: ' + $_.Exception.Message)
    Show-WvMessage ("Could not open Chess-Results Upload Data in your default browser:`r`n`r`n" + $_.Exception.Message) 'Chess-Results Upload' 'Error'
  }
}

function Start-ChessResultsDeleteWindow([string]$Key, [string]$ClientId, [int]$Language, $MainCore, [string]$RequestId) {
  $keyValue = ([string]$Key).Trim()
  $clientValue = ([string]$ClientId).Trim()
  if($Language -lt 0 -or $Language -gt 20) { $Language = 1 }

  $sendResult = {
    param([bool]$Ok,[bool]$Deleted,[string]$ErrorText)
    try {
      $reply = @{
        type='cp:cr-delete-result'; requestId=$RequestId; ok=$Ok; deleted=$Deleted; key=$keyValue
        error=([string]$ErrorText)
      } | ConvertTo-Json -Compress -Depth 4
      $MainCore.PostWebMessageAsJson($reply)
    } catch { Write-WvLog ('Chess-Results delete result callback failed: ' + $_.Exception.Message) }
  }.GetNewClosure()

  try {
    if($keyValue -notmatch '^\d+$') { throw 'Chess-Results tournament key is invalid.' }
    if([string]::IsNullOrWhiteSpace($clientValue)) { throw 'Chess-Results local tournament identity is missing.' }
    if([string]::IsNullOrWhiteSpace($RequestId)) { throw 'Chess-Results delete request id is missing.' }

    $requestBody = @{ key=$keyValue; clientId=$clientValue } | ConvertTo-Json -Compress
    $authorization = Invoke-RestMethod -Method Post `
      -Uri ("http://127.0.0.1:{0}/chessresults/delete-authorize" -f $Port) `
      -ContentType 'application/json; charset=utf-8' -Body $requestBody -TimeoutSec 20

    if(-not [bool]$authorization.canDelete) {
      throw ([string]$authorization.reason)
    }

    # If it was already deleted externally, use the same server-verified Unlink
    # path and report success without opening/clicking anything remotely.
    if([bool]$authorization.alreadyDeleted) {
      $unlinkBody = @{ key=$keyValue; clientId=$clientValue; serverError='' } | ConvertTo-Json -Compress
      $unlink = Invoke-RestMethod -Method Post `
        -Uri ("http://127.0.0.1:{0}/chessresults/unlink" -f $Port) `
        -ContentType 'application/json; charset=utf-8' -Body $unlinkBody -TimeoutSec 20
      if(-not [bool]$unlink.canUnlink) { throw ([string]$unlink.reason) }
      Write-WvLog "Chess-Results DELETE: TNR $keyValue was already absent; local recovery mapping released."
      & $sendResult $true $true ''
      return
    }

    $adminUrl = [string]$authorization.adminUrl
    if([string]::IsNullOrWhiteSpace($adminUrl)) { throw 'Chess-Results did not return authenticated Admin access.' }

    $deleteForm = New-Object System.Windows.Forms.Form
    $deleteForm.Text = 'chess-publisher Chess-Results delete verifier'
    $deleteForm.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $deleteForm.Location = New-Object System.Drawing.Point(-32000,-32000)
    $deleteForm.ClientSize = New-Object System.Drawing.Size(16,16)
    $deleteForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
    $deleteForm.ShowInTaskbar = $false
    $deleteForm.ShowIcon = $false

    $deleteWeb = New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $deleteWeb.Dock = [System.Windows.Forms.DockStyle]::Fill
    $creation = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
    $userData = Join-Path $env:LOCALAPPDATA 'ChessPublisher\WebView2'
    New-Item -ItemType Directory -Path $userData -Force | Out-Null
    $creation.UserDataFolder = $userData
    $deleteWeb.CreationProperties = $creation

    $state = [pscustomobject]@{ Clicked=$false; Finished=$false; Polls=0; LastReason=''; Key=$keyValue }
    $deleteWeb.Tag = $state
    $deleteForm.Controls.Add($deleteWeb)

    $finish = {
      param([bool]$Ok,[bool]$Deleted,[string]$Message)
      if($state.Finished) { return }
      $state.Finished = $true
      if($Ok) { Write-WvLog "Chess-Results DELETE confirmed for TNR $($state.Key)." }
      else { Write-WvLog "Chess-Results DELETE not confirmed for TNR $($state.Key): $Message" }
      & $sendResult $Ok $Deleted $Message
      try { $deleteForm.BeginInvoke([Action]{ $deleteForm.Close() }) | Out-Null } catch { try { $deleteForm.Close() } catch {} }
    }.GetNewClosure()

    $pollTimer = New-Object System.Windows.Forms.Timer
    $pollTimer.Interval = 2000
    $pollTimer.add_Tick({
      if($state.Finished -or -not $state.Clicked) { return }
      $state.Polls++
      try {
        $unlinkBody = @{ key=$keyValue; clientId=$clientValue; serverError='' } | ConvertTo-Json -Compress
        $unlink = Invoke-RestMethod -Method Post `
          -Uri ("http://127.0.0.1:{0}/chessresults/unlink" -f $Port) `
          -ContentType 'application/json; charset=utf-8' -Body $unlinkBody -TimeoutSec 12
        if([bool]$unlink.canUnlink) {
          & $finish $true $true ''
          return
        }
        $state.LastReason = [string]$unlink.reason
      } catch { $state.LastReason = $_.Exception.Message }
      if($state.Polls -ge 12) {
        $msg = if([string]::IsNullOrWhiteSpace($state.LastReason)){'Chess-Results did not confirm that the tournament was deleted.'}{$state.LastReason}
        & $finish $false $false $msg
      }
    }.GetNewClosure())

    $timeoutTimer = New-Object System.Windows.Forms.Timer
    $timeoutTimer.Interval = 45000
    $timeoutTimer.add_Tick({
      $timeoutTimer.Stop()
      if(-not $state.Finished) { & $finish $false $false 'Chess-Results deletion timed out. The local TNR was kept.' }
    }.GetNewClosure())

    $deleteWeb.add_CoreWebView2InitializationCompleted({
      param($sender,$e)
      if(-not $e.IsSuccess) {
        $msg = if($e.InitializationException){$e.InitializationException.Message}else{'Hidden WebView2 initialization failed.'}
        & $finish $false $false $msg
        return
      }
      $core = $sender.CoreWebView2
      $core.Settings.AreDefaultContextMenusEnabled = $false
      $core.Settings.AreDevToolsEnabled = $false
      $core.Settings.IsStatusBarEnabled = $false
      $core.Settings.IsZoomControlEnabled = $false

      # Accept only a script dialog raised inside this short-lived, already
      # double-confirmed delete session (some Chess-Results builds use JS confirm).
      $core.add_ScriptDialogOpening({
        param($ds,$da)
        try { if($state.Clicked -and -not $state.Finished) { $da.Accept() } } catch {}
      }.GetNewClosure())

      $core.add_NavigationCompleted({
        param($navSender,$navArgs)
        if($state.Finished -or $state.Clicked -or -not $navArgs.IsSuccess) { return }
        try {
          $uri = New-Object System.Uri([string]$navSender.Source)
          $host = $uri.Host.ToLowerInvariant()
          if(-not ($host -eq 'chess-results.com' -or $host.EndsWith('.chess-results.com'))) { throw 'Authenticated Admin navigation left chess-results.com.' }
          if($uri.AbsolutePath -notmatch '(?i)/Stammdaten\.aspx$') { return }

          # Click ONLY an exact English "Delete Tournament" control.  Do not use
          # fuzzy matching, indexes or guessed ASP.NET field names: if the owner
          # page changes, deletion safely fails instead of clicking another action.
          $script = @"
(() => {
  const norm = s => String(s || '').replace(/\\s+/g,' ').trim().toLowerCase();
  const nodes = [...document.querySelectorAll('button,input[type="submit"],input[type="button"]')];
  const target = nodes.find(el => norm(el.tagName === 'INPUT' ? el.value : el.textContent) === 'delete tournament');
  if (!target) return 'not-found';
  target.click();
  return 'clicked';
})()
"@
          $state.Clicked = $true
          [void]$navSender.ExecuteScriptAsync($script)
          $pollTimer.Start()
          Write-WvLog "Chess-Results DELETE: exact owner-page Delete Tournament control requested for TNR $keyValue; waiting for server verification."
        } catch {
          & $finish $false $false $_.Exception.Message
        }
      }.GetNewClosure())

      Write-WvLog "Chess-Results DELETE: opening authenticated Admin page for locally owned TNR $keyValue."
      $core.Navigate($adminUrl)
    }.GetNewClosure())

    $deleteForm.add_FormClosed({
      try { $pollTimer.Stop(); $pollTimer.Dispose() } catch {}
      try { $timeoutTimer.Stop(); $timeoutTimer.Dispose() } catch {}
      try { foreach($control in @($deleteForm.Controls)) { try { $control.Dispose() } catch {} } } catch {}
    }.GetNewClosure())

    $timeoutTimer.Start()
    [void]$deleteForm.Show($form)
    # v1.03.61: explicitly initialize this short-lived helper WebView2.
    # Without EnsureCoreWebView2Async the form can remain white forever because
    # no Source is assigned until InitializationCompleted itself fires.
    [void]$deleteWeb.EnsureCoreWebView2Async($null)
  } catch {
    Write-WvLog ('Chess-Results DELETE setup failed: ' + $_.Exception.Message)
    & $sendResult $false $false $_.Exception.Message
  }
}

function Start-ChessResultsDeleteOtherWindow([string]$Key, [int]$Language, $MainCore, [string]$RequestId) {
  $keyValue = ([string]$Key).Trim()
  if($Language -lt 0 -or $Language -gt 20) { $Language = 1 }

  $sendResult = {
    param([bool]$Ok,[bool]$Deleted,[string]$ErrorText)
    try {
      $reply = @{
        type='cp:cr-delete-result'; requestId=$RequestId; ok=$Ok; deleted=$Deleted; key=$keyValue
        error=([string]$ErrorText); recovery=$true
      } | ConvertTo-Json -Compress -Depth 4
      $MainCore.PostWebMessageAsJson($reply)
    } catch { Write-WvLog ('Chess-Results delete-other result callback failed: ' + $_.Exception.Message) }
  }.GetNewClosure()

  try {
    if($keyValue -notmatch '^\d+$') { throw 'Chess-Results tournament key is invalid.' }
    if([string]::IsNullOrWhiteSpace($RequestId)) { throw 'Chess-Results delete-other request id is missing.' }

    # If the page is already absent, server-verified Unlink can safely release any
    # stale recovery record for this key even though it is not the active tournament.
    try {
      $preBody = @{ key=$keyValue; clientId=''; serverError='' } | ConvertTo-Json -Compress
      $pre = Invoke-RestMethod -Method Post `
        -Uri ("http://127.0.0.1:{0}/chessresults/unlink" -f $Port) `
        -ContentType 'application/json; charset=utf-8' -Body $preBody -TimeoutSec 15
      if([bool]$pre.canUnlink) {
        Write-WvLog "Chess-Results DELETE OTHER: TNR $keyValue is already absent; stale recovery entry (if any) released."
        & $sendResult $true $true ''
        return
      }
    } catch {
      Write-WvLog ('Chess-Results DELETE OTHER pre-check inconclusive for TNR ' + $keyValue + ': ' + $_.Exception.Message)
    }

    # Generate the owner-provided encrypted CreatorID/TNR Admin entry.  The
    # recovery flow does not trust the currently loaded tournament identity;
    # Chess-Results itself decides whether this CreatorID owns the requested TNR.
    $linkBody = @{ key=$keyValue; language=$Language } | ConvertTo-Json -Compress
    $adminReply = Invoke-RestMethod -Method Post `
      -Uri ("http://127.0.0.1:{0}/chessresults/admin-link" -f $Port) `
      -ContentType 'application/json; charset=utf-8' -Body $linkBody -TimeoutSec 15
    $adminUrl = [string]$adminReply.url
    if([string]::IsNullOrWhiteSpace($adminUrl)) { throw 'Chess-Results did not return encrypted Admin access.' }

    # v1.03.59: keep the official owner Admin page visible.  Earlier builds used
    # an off-screen 16x16 WebView and required one exact Stammdaten.aspx navigation
    # event.  Chess-Results may redirect/change the final page, which made the
    # verifier wait until timeout even though authentication itself was valid.
    # The visible owner window is both safer and more robust: automatic detection
    # still clicks the exact Delete Tournament control after the two app confirms,
    # while the official Chess-Results control remains available as a manual fallback.
    $deleteForm = New-Object System.Windows.Forms.Form
    $deleteForm.Text = "chess-publisher — Delete Chess-Results TNR $keyValue"
    $deleteForm.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterParent
    $deleteForm.ClientSize = New-Object System.Drawing.Size(1080,760)
    $deleteForm.MinimumSize = New-Object System.Drawing.Size(820,560)
    $deleteForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::Sizable
    $deleteForm.ShowInTaskbar = $false
    $deleteForm.ShowIcon = $false

    $topPanel = New-Object System.Windows.Forms.Panel
    $topPanel.Dock = [System.Windows.Forms.DockStyle]::Top
    $topPanel.Height = 62
    $topPanel.Padding = New-Object System.Windows.Forms.Padding(10,8,8,8)

    $statusLabel = New-Object System.Windows.Forms.Label
    $statusLabel.Dock = [System.Windows.Forms.DockStyle]::Fill
    $statusLabel.AutoEllipsis = $true
    $statusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $statusLabel.Text = "TNR $keyValue — opening the owner-authenticated Chess-Results Admin page. If automatic deletion does not trigger, click the official 'Delete tournament' button on the page. The active chess-publisher tournament is not changed."

    $closeButton = New-Object System.Windows.Forms.Button
    $closeButton.Dock = [System.Windows.Forms.DockStyle]::Right
    $closeButton.Width = 90
    $closeButton.Text = 'Close'

    $deleteWeb = New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $deleteWeb.Dock = [System.Windows.Forms.DockStyle]::Fill
    $deleteWeb.DefaultBackgroundColor = [System.Drawing.Color]::White
    $creation = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
    $userData = Join-Path $env:LOCALAPPDATA 'ChessPublisher\WebView2'
    New-Item -ItemType Directory -Path $userData -Force | Out-Null
    $creation.UserDataFolder = $userData
    $deleteWeb.CreationProperties = $creation

    $topPanel.Controls.Add($statusLabel)
    $topPanel.Controls.Add($closeButton)
    $deleteForm.Controls.Add($deleteWeb)
    $deleteForm.Controls.Add($topPanel)

    $state = [pscustomobject]@{
      Finished=$false; OwnerSeen=$false; AutoClickAttempted=$false; Polls=0
      LastReason=''; LastSource=''; Key=$keyValue
    }
    $deleteWeb.Tag = $state

    $finish = {
      param([bool]$Ok,[bool]$Deleted,[string]$Message)
      if($state.Finished) { return }
      $state.Finished = $true
      try { $pollTimer.Stop() } catch {}
      try { $timeoutTimer.Stop() } catch {}
      if($Ok) { Write-WvLog "Chess-Results DELETE OTHER confirmed for TNR $($state.Key)." }
      else { Write-WvLog "Chess-Results DELETE OTHER blocked/not confirmed for TNR $($state.Key): $Message" }
      & $sendResult $Ok $Deleted $Message
      try { $deleteForm.BeginInvoke([Action]{ $deleteForm.Close() }) | Out-Null } catch { try { $deleteForm.Close() } catch {} }
    }.GetNewClosure()

    # Poll the server from the moment the authenticated window opens.  This also
    # detects a manual click on the official Chess-Results delete control, so DOM
    # layout changes cannot strand the operation in a timeout-only state.
    $pollTimer = New-Object System.Windows.Forms.Timer
    $pollTimer.Interval = 3000
    $pollTimer.add_Tick({
      if($state.Finished) { return }
      $state.Polls++
      try {
        $unlinkBody = @{ key=$keyValue; clientId=''; serverError='' } | ConvertTo-Json -Compress
        $unlink = Invoke-RestMethod -Method Post `
          -Uri ("http://127.0.0.1:{0}/chessresults/unlink" -f $Port) `
          -ContentType 'application/json; charset=utf-8' -Body $unlinkBody -TimeoutSec 12
        if([bool]$unlink.canUnlink) {
          $statusLabel.Text = "TNR $keyValue deletion confirmed by Chess-Results. Closing…"
          & $finish $true $true ''
          return
        }
        $state.LastReason = [string]$unlink.reason
      } catch { $state.LastReason = $_.Exception.Message }
    }.GetNewClosure())

    $timeoutTimer = New-Object System.Windows.Forms.Timer
    $timeoutTimer.Interval = 150000
    $timeoutTimer.add_Tick({
      $timeoutTimer.Stop()
      if(-not $state.Finished) {
        $msg = if([string]::IsNullOrWhiteSpace($state.LastReason)){
          'Chess-Results did not confirm deletion within the owner Admin session. No active tournament data was changed.'
        } else {
          'Chess-Results did not confirm deletion: ' + $state.LastReason
        }
        & $finish $false $false $msg
      }
    }.GetNewClosure())

    $closeButton.add_Click({
      if(-not $state.Finished) {
        & $finish $false $false 'Owner Admin window closed before Chess-Results confirmed deletion. No active tournament data was changed.'
      }
    }.GetNewClosure())

    $deleteWeb.add_CoreWebView2InitializationCompleted({
      param($sender,$e)
      if(-not $e.IsSuccess) {
        $msg = if($e.InitializationException){$e.InitializationException.Message}else{'Chess-Results Admin WebView2 initialization failed.'}
        & $finish $false $false $msg
        return
      }
      $core = $sender.CoreWebView2
      $core.Settings.AreDefaultContextMenusEnabled = $false
      $core.Settings.AreDevToolsEnabled = $false
      $core.Settings.IsStatusBarEnabled = $true
      $core.Settings.IsZoomControlEnabled = $true

      # This WebView exists only after two explicit native delete confirmations and
      # is scoped to the requested owner Admin URL. Accept Chess-Results' own dialog
      # so both the automatic exact-control click and the visible manual fallback
      # can complete even if the site's DOM changes before our probe recognizes it.
      $core.add_ScriptDialogOpening({
        param($ds,$da)
        try { if(-not $state.Finished) { $da.Accept() } } catch {}
      }.GetNewClosure())

      # Keep Chess-Results new-window targets in this authenticated WebView so a
      # layout change cannot drop the owner credentials into an unauthenticated browser.
      $core.add_NewWindowRequested({
        param($nwSender,$nwArgs)
        try {
          $candidate = [string]$nwArgs.Uri
          if([string]::IsNullOrWhiteSpace($candidate)) { return }
          $u = New-Object System.Uri($candidate)
          $h = $u.Host.ToLowerInvariant()
          if($h -eq 'chess-results.com' -or $h.EndsWith('.chess-results.com')) {
            $nwArgs.Handled = $true
            $core.Navigate($candidate)
          }
        } catch { Write-WvLog ('Chess-Results DELETE OTHER new-window handling failed: ' + $_.Exception.Message) }
      }.GetNewClosure())

      $core.add_WebMessageReceived({
        param($ws,$wa)
        if($state.Finished) { return }
        try {
          $ownerMsg = $wa.WebMessageAsJson | ConvertFrom-Json
          if(([string]$ownerMsg.type) -ne 'cp:cr-other-owner-check') { return }
          if(-not [bool]$ownerMsg.found) { return }

          $state.OwnerSeen = $true
          $statusLabel.Text = "TNR $keyValue — CreatorID ownership verified by the official Chess-Results Admin page. Requesting the exact 'Delete tournament' control."
          if($state.AutoClickAttempted) { return }
          $state.AutoClickAttempted = $true

          $clickScript = @"
(() => {
  const norm = s => String(s || '').replace(/\\s+/g,' ').trim().toLowerCase();
  const label = el => norm(el.tagName === 'INPUT' ? (el.value || el.alt || el.title) : (el.textContent || el.title));
  const nodes = [...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')];
  const target = nodes.find(el => label(el) === 'delete tournament');
  if (!target) return 'lost';
  target.click();
  return 'clicked';
})()
"@
          [void]$ws.ExecuteScriptAsync($clickScript)
          Write-WvLog "Chess-Results DELETE OTHER: owner control found for TNR $keyValue; exact Delete Tournament control requested."
        } catch { Write-WvLog ('Chess-Results DELETE OTHER owner-control callback failed: ' + $_.Exception.Message) }
      }.GetNewClosure())

      $core.add_NavigationCompleted({
        param($navSender,$navArgs)
        if($state.Finished) { return }
        try {
          if(-not $navArgs.IsSuccess) {
            $statusLabel.Text = "TNR $keyValue — Chess-Results navigation failed. You may close this window and retry."
            return
          }
          $source = [string]$navSender.Source
          $state.LastSource = $source
          $uri = New-Object System.Uri($source)
          $host = $uri.Host.ToLowerInvariant()
          if(-not ($host -eq 'chess-results.com' -or $host.EndsWith('.chess-results.com'))) {
            & $finish $false $false 'Authenticated Admin navigation left chess-results.com; deletion was blocked.'
            return
          }

          # v1.03.59 intentionally probes every authenticated chess-results.com
          # destination rather than requiring the path to remain Stammdaten.aspx.
          $probeScript = @"
(() => {
  const norm = s => String(s || '').replace(/\\s+/g,' ').trim().toLowerCase();
  const label = el => norm(el.tagName === 'INPUT' ? (el.value || el.alt || el.title) : (el.textContent || el.title));
  const nodes = [...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')];
  const found = nodes.some(el => label(el) === 'delete tournament');
  window.chrome.webview.postMessage({type:'cp:cr-other-owner-check',found});
  return found ? 'owner-control-found' : 'owner-control-not-yet-found';
})()
"@
          [void]$navSender.ExecuteScriptAsync($probeScript)
          if(-not $state.OwnerSeen) {
            $statusLabel.Text = "TNR $keyValue — authenticated Chess-Results page loaded. Verifying owner controls… If the page shows 'Delete tournament', you may click it directly."
          }
        } catch {
          Write-WvLog ('Chess-Results DELETE OTHER navigation probe failed: ' + $_.Exception.Message)
        }
      }.GetNewClosure())

      Write-WvLog "Chess-Results DELETE OTHER: opening visible encrypted CreatorID/TNR Admin session for TNR $keyValue."
      $core.Navigate($adminUrl)
      $pollTimer.Start()
    }.GetNewClosure())

    $deleteForm.add_FormClosed({
      try { $pollTimer.Stop(); $pollTimer.Dispose() } catch {}
      try { $timeoutTimer.Stop(); $timeoutTimer.Dispose() } catch {}
      if(-not $state.Finished) {
        $state.Finished = $true
        & $sendResult $false $false 'Owner Admin window closed before deletion was confirmed. No active tournament data was changed.'
      }
      try { foreach($control in @($deleteForm.Controls)) { try { $control.Dispose() } catch {} } } catch {}
    }.GetNewClosure())

    $timeoutTimer.Start()
    [void]$deleteForm.Show($form)
    # v1.03.61: explicitly initialize the visible recovery WebView2.  The
    # previous build waited for InitializationCompleted but never triggered
    # initialization, producing an empty white Admin window.
    [void]$deleteWeb.EnsureCoreWebView2Async($null)
  } catch {
    Write-WvLog ('Chess-Results DELETE OTHER setup failed: ' + $_.Exception.Message)
    & $sendResult $false $false $_.Exception.Message
  }
}

function Show-WvMessage([string]$Text, [string]$Title='chess-publisher', [string]$Icon='Information') {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    $Text,
    $Title,
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::$Icon
  ) | Out-Null
}

function Get-EngineHealth {
  try {
    $r = Invoke-RestMethod -UseBasicParsing "http://127.0.0.1:$Port/health" -TimeoutSec 1
    $expected = [IO.Path]::GetFullPath($root).TrimEnd('\')
    $actual = [IO.Path]::GetFullPath([string]$r.root).TrimEnd('\')
    if ($r.ok -and $r.engine -and $r.serviceVersion -eq $serviceVersion -and $actual -ieq $expected) { return $r }
  } catch {}
  return $null
}

function Test-PortOccupied {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $async = $client.BeginConnect('127.0.0.1',$Port,$null,$null)
      if(-not $async.AsyncWaitHandle.WaitOne(350)) { return $false }
      $client.EndConnect($async)
      return $true
    } finally { $client.Close() }
  } catch { return $false }
}

function Stop-StaleEngine {
  if(Get-EngineHealth) { return }
  if(-not (Test-PortOccupied)) { return }

  # Ask any ChessPublisher-compatible service on the port to stop.  Do not
  # enumerate/kill arbitrary corporate processes; if the port remains busy,
  # fail safely with a clear diagnostic instead of bypassing policy.
  try {
    Invoke-WebRequest -UseBasicParsing -Method Post "http://127.0.0.1:$Port/shutdown" -TimeoutSec 1 | Out-Null
  } catch {}
  Start-Sleep -Milliseconds 800

  if(Test-PortOccupied) {
    throw "Port $Port is already in use by another process. Close the other chess-publisher instance or choose another port."
  }
}

function Wait-EngineReady([int]$Attempts = 30, [int]$DelayMs = 400) {
  for($i=0;$i -lt $Attempts;$i++) {
    Start-Sleep -Milliseconds $DelayMs
    $health = Get-EngineHealth
    if($health) { return $health }
  }
  return $null
}

function Start-EngineInProcess([string]$EngineScript) {
  Write-WvLog 'Universal launcher method 1: starting LocalEngine in an in-process STA PowerShell runspace.'

  $iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
  $rs = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace($iss)
  $rs.ApartmentState = [System.Threading.ApartmentState]::STA
  $rs.ThreadOptions = [System.Management.Automation.Runspaces.PSThreadOptions]::ReuseThread
  $rs.Open()
  try { $rs.SessionStateProxy.Path.SetLocation($root) } catch {}

  $ps = [System.Management.Automation.PowerShell]::Create()
  $ps.Runspace = $rs
  [void]$ps.AddCommand($EngineScript)
  [void]$ps.AddParameter('Port',$Port)
  $async = $ps.BeginInvoke()

  $script:engineRunspace = $rs
  $script:enginePowerShell = $ps
  $script:engineAsync = $async

  $health = Wait-EngineReady 25 350
  if($health) {
    $script:engineMode = 'in-process-runspace'
    Write-WvLog "LocalEngine $serviceVersion ready on port $Port using in-process runspace."
    return $true
  }

  $details = ''
  try {
    if($async.IsCompleted) {
      [void]$ps.EndInvoke($async)
    }
  } catch { $details = $_.Exception.Message }
  try {
    if($ps.Streams.Error.Count -gt 0) {
      $streamText = ($ps.Streams.Error | ForEach-Object { $_.ToString() }) -join '; '
      if($streamText) { $details = ($details + ' ' + $streamText).Trim() }
    }
  } catch {}

  try { $ps.Stop() } catch {}
  try { $ps.Dispose() } catch {}
  try { $rs.Close() } catch {}
  try { $rs.Dispose() } catch {}
  $script:engineRunspace = $null
  $script:enginePowerShell = $null
  $script:engineAsync = $null

  if(-not $details) { $details = 'engine health check did not become ready' }
  throw $details
}

function Start-EngineDirectProcess([string]$EngineScript) {
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
  try { if(-not $process.HasExited) { $process.Kill() } } catch {}
  throw 'LocalEngine child process did not become ready.'
}

function Start-EngineCmdFallback([string]$EngineScript) {
  Write-WvLog 'Universal launcher method 3: starting LocalEngine through cmd.exe START compatibility fallback.'
  $engineCommand = 'start "ChessPublisher Engine" /min powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Port {1}' -f $EngineScript,$Port
  & $env:ComSpec /D /S /C $engineCommand | Out-Null
  if($LASTEXITCODE -ne 0) { throw "cmd.exe could not launch LocalEngine (exit=$LASTEXITCODE)." }

  $health = Wait-EngineReady 25 350
  if($health) {
    $script:engineMode = 'cmd-start'
    Write-WvLog "LocalEngine $serviceVersion ready on port $Port using cmd.exe START fallback."
    return $true
  }
  throw 'LocalEngine did not become ready after cmd.exe START.'
}

function Start-ChessPublisherEngine {
  $health = Get-EngineHealth
  if($health) {
    $script:engineMode = 'reused'
    Write-WvLog "Reusing LocalEngine $serviceVersion on port $Port."
    return $false
  }

  Stop-StaleEngine

  $engineScript = Join-Path $root 'ChessPublisher-LocalEngine.ps1'
  $gacrux = Join-Path $root 'engine\gacrux\pairingchecker.exe'
  if(-not (Test-Path -LiteralPath $engineScript)) { throw 'ChessPublisher-LocalEngine.ps1 is missing.' }
  if(-not (Test-Path -LiteralPath $gacrux)) { throw 'engine\gacrux\pairingchecker.exe is missing.' }

  $tokens=$null; $errors=$null
  [System.Management.Automation.Language.Parser]::ParseFile($engineScript,[ref]$tokens,[ref]$errors) | Out-Null
  if(@($errors).Count -gt 0) {
    $detail = (@($errors) | ForEach-Object { $_.Message + ' at ' + $_.Extent.StartLineNumber + ':' + $_.Extent.StartColumnNumber }) -join [Environment]::NewLine
    throw "LocalEngine PowerShell parser error(s):`n$detail"
  }

  $failures = New-Object System.Collections.Generic.List[string]
  foreach($method in @('runspace','process')) {
    try {
      switch($method) {
        'runspace' { [void](Start-EngineInProcess $engineScript) }
        'process'  { [void](Start-EngineDirectProcess $engineScript) }
      }
      return $true
    } catch {
      $message = $_.Exception.Message
      $failures.Add("${method}: $message")
      Write-WvLog "LocalEngine startup method '$method' failed: $message"
      if(Get-EngineHealth) { return $true }
      if(Test-PortOccupied) {
        # A failed method may have started the service slightly late. Give it a
        # short grace period before trying a second process.
        $late = Wait-EngineReady 5 300
        if($late) {
          Write-WvLog "LocalEngine became ready during fallback grace period after '$method'."
          return $true
        }
      }
    }
  }

  throw ("LocalEngine could not be started by any supported method.`n" + ($failures -join [Environment]::NewLine))
}

function Stop-OwnedEngine {
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
    }
  } elseif($engineProcess) {
    try {
      if(-not $engineProcess.HasExited) {
        if(-not $engineProcess.WaitForExit(2500)) { $engineProcess.Kill() }
      }
    } catch {}
    try { $engineProcess.Dispose() } catch {}
  }
  Write-WvLog "LocalEngine shutdown completed (mode=$engineMode)."
}

function Ensure-WebView2Sdk {
  $sdkBase = if($env:LOCALAPPDATA){ Join-Path $env:LOCALAPPDATA 'ChessPublisher\WebView2SDK' } else { Join-Path $root 'webview2-sdk-cache' }
  $processArch = if([Environment]::Is64BitProcess){'x64'}else{'x86'}
  $sdkRoot = Join-Path (Join-Path $sdkBase $webView2SdkVersion) $processArch
  $coreDll = Join-Path $sdkRoot 'Microsoft.Web.WebView2.Core.dll'
  $winFormsDll = Join-Path $sdkRoot 'Microsoft.Web.WebView2.WinForms.dll'
  $loaderDll = Join-Path $sdkRoot 'WebView2Loader.dll'
  if((Test-Path $coreDll) -and (Test-Path $winFormsDll) -and (Test-Path $loaderDll)) {
    return @{Root=$sdkRoot;Core=$coreDll;WinForms=$winFormsDll;Loader=$loaderDll}
  }

  New-Item -ItemType Directory -Path $sdkRoot -Force | Out-Null
  $temp = Join-Path ([IO.Path]::GetTempPath()) ('ChessPublisher-WebView2-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $temp -Force | Out-Null
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $nupkg = Join-Path $temp 'Microsoft.Web.WebView2.nupkg'
    $zip = Join-Path $temp 'Microsoft.Web.WebView2.zip'
    $unpack = Join-Path $temp 'pkg'
    $url = "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$webView2SdkVersion"
    Write-WvLog "Downloading official Microsoft.Web.WebView2 SDK $webView2SdkVersion."
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $nupkg
    Copy-Item -LiteralPath $nupkg -Destination $zip -Force
    Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force

    $frameworkDir = @(
      (Join-Path $unpack 'lib\net462'),
      (Join-Path $unpack 'lib\net48'),
      (Join-Path $unpack 'lib\net45')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if(-not $frameworkDir) { throw 'Compatible .NET Framework WebView2 assemblies were not found in the Microsoft package.' }

    $arch = if([Environment]::Is64BitProcess){'win-x64'}else{'win-x86'}
    $nativeDir = Join-Path $unpack ("runtimes\$arch\native")
    Copy-Item -LiteralPath (Join-Path $frameworkDir 'Microsoft.Web.WebView2.Core.dll') -Destination $coreDll -Force
    Copy-Item -LiteralPath (Join-Path $frameworkDir 'Microsoft.Web.WebView2.WinForms.dll') -Destination $winFormsDll -Force
    Copy-Item -LiteralPath (Join-Path $nativeDir 'WebView2Loader.dll') -Destination $loaderDll -Force
    Write-WvLog "WebView2 SDK $webView2SdkVersion prepared."
  } finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
  return @{Root=$sdkRoot;Core=$coreDll;WinForms=$winFormsDll;Loader=$loaderDll}
}

try {
  if($env:OS -ne 'Windows_NT') { throw 'chess-publisher requires Windows.' }
  Set-Location -LiteralPath $root
  Write-WvLog "ChessPublisher WebView $webViewRelease launcher starting from $root"
  Write-WvLog ("Environment: Windows={0}; PowerShell={1}; Process64Bit={2}; OS64Bit={3}" -f [Environment]::OSVersion.VersionString,$PSVersionTable.PSVersion,[Environment]::Is64BitProcess,[Environment]::Is64BitOperatingSystem)
  Reset-ChessPublisherCompatibilityFlags
  Enable-ChessPublisherDpiAwareness
  Initialize-ChessPublisherTaskbarIdentity
  Hide-LauncherConsole

  # Prepare and validate the WebView host before starting the tournament engine.
  # This avoids a long first-run SDK download consuming LocalEngine's browser-heartbeat window.
  $sdk = Ensure-WebView2Sdk

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -Path $sdk.Core
  Add-Type -Path $sdk.WinForms
  $env:PATH = $sdk.Root + ';' + $env:PATH

  # WebView 1.03.25 retains the native Windows frame, DPI hotfix and explicit taskbar identity.


  try {
    $runtimeVersion = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::GetAvailableBrowserVersionString()
    Write-WvLog "WebView2 Runtime: $runtimeVersion"
  } catch {
    throw 'Microsoft Edge WebView2 Runtime is not installed. Install the Microsoft Edge WebView2 Evergreen Runtime and start ChessPublisher-WebView.bat again.'
  }

  $engineOwned = Start-ChessPublisherEngine
  $hostState = @{ AllowClose = $false }

  [System.Windows.Forms.Application]::EnableVisualStyles()
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'chess-publisher v1.04.01'
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
  # WebView 1.03.21 — retain the real Windows non-client frame. This gives one
  # normal application window with native minimize/maximize/close, snap,
  # taskbar behavior, DPI handling and edge/corner resizing.
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::Sizable
  $form.MinimizeBox = $true
  $form.MaximizeBox = $true
  $form.ControlBox = $true
  $form.ShowInTaskbar = $true
  $form.ClientSize = New-Object System.Drawing.Size(1210,790)
  $form.MinimumSize = New-Object System.Drawing.Size(900,640)
  $form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
  $form.BackColor = [System.Drawing.Color]::FromArgb(212,208,200)
  $form.KeyPreview = $true
  $iconFile = Join-Path $root 'ChessPublisher.ico'
  if(Test-Path -LiteralPath $iconFile) {
    try {
      $script:appIcon = New-Object System.Drawing.Icon($iconFile)
      $form.Icon = $script:appIcon
      try {
        $formHandle = $form.Handle
        if('ChessPublisher.TaskbarIdentity' -as [type]) {
          [ChessPublisher.TaskbarIdentity]::SetWindowIcon($formHandle,$script:appIcon.Handle)
        }
      } catch { Write-WvLog ('Explicit window icon assignment unavailable: ' + $_.Exception.Message) }
      Write-WvLog 'Application icon loaded for title bar/taskbar.'
    } catch { Write-WvLog ('Application icon could not be loaded: ' + $_.Exception.Message) }
  }
  $form.WindowState = [System.Windows.Forms.FormWindowState]::Maximized

  $web = New-Object Microsoft.Web.WebView2.WinForms.WebView2
  $web.Dock = [System.Windows.Forms.DockStyle]::Fill
  $web.DefaultBackgroundColor = [System.Drawing.Color]::FromArgb(0,139,139)
  $creation = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
  $userData = Join-Path $env:LOCALAPPDATA 'ChessPublisher\WebView2'
  New-Item -ItemType Directory -Path $userData -Force | Out-Null
  $creation.UserDataFolder = $userData
  $web.CreationProperties = $creation
  $form.Controls.Add($web)

  $adapterFile = Join-Path $root 'webview\WebViewAdapter.js'
  if(-not (Test-Path -LiteralPath $adapterFile)) { throw 'webview\WebViewAdapter.js is missing.' }
  $adapter = [System.IO.File]::ReadAllText($adapterFile,[System.Text.Encoding]::UTF8)
  $web.add_CoreWebView2InitializationCompleted({
    param($sender,$e)
    if(-not $e.IsSuccess) {
      Write-WvLog ('WebView2 initialization failed: ' + $e.InitializationException.Message)
      Show-WvMessage ('WebView2 initialization failed:`n`n' + $e.InitializationException.Message) 'chess-publisher' 'Error'
      $form.Close(); return
    }
    $core = $sender.CoreWebView2
    # v1.03.91 security/UI hardening: this is the ACTIVE main-window WebView2
    # initialization block. Older defensive assignments above were overridden
    # here by `$true`, which exposed Chromium's Save as / View source / Inspect
    # context menu. Keep the application surface non-browser-like.
    $core.Settings.AreDefaultContextMenusEnabled = $false
    $core.Settings.AreDevToolsEnabled = $false
    $core.Settings.IsStatusBarEnabled = $false
    $core.Settings.IsZoomControlEnabled = $true

    # v1.03.96: the main application WebView is a privileged local UI. It may
    # never navigate away from the exact LocalEngine origin. External links are
    # opened by the Windows shell only for explicitly permitted URI schemes.
    $allowedMainOrigin = "http://127.0.0.1:$Port"
    $core.add_NavigationStarting({
      param($navSender,$navArgs)
      try {
        $candidate = New-Object System.Uri([string]$navArgs.Uri)
        $isLocal = ($candidate.Scheme -eq 'http' -and $candidate.Host -eq '127.0.0.1' -and $candidate.Port -eq $Port)
        if(-not $isLocal) {
          $navArgs.Cancel = $true
          $scheme = $candidate.Scheme.ToLowerInvariant()
          if($scheme -in @('http','https','mailto')) {
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = $candidate.AbsoluteUri
            $psi.UseShellExecute = $true
            [void][System.Diagnostics.Process]::Start($psi)
          }
          Write-WvLog ('Blocked main WebView navigation outside LocalEngine: ' + [string]$navArgs.Uri)
        }
      } catch {
        $navArgs.Cancel = $true
        Write-WvLog ('Blocked malformed main WebView navigation: ' + [string]$navArgs.Uri)
      }
    }.GetNewClosure())

    $core.add_NewWindowRequested({
      param($s,$a)
      try {
        if($a.Uri) {
          $candidate = New-Object System.Uri([string]$a.Uri)
          $scheme = $candidate.Scheme.ToLowerInvariant()
          $a.Handled = $true
          if($scheme -notin @('http','https','mailto')) {
            Write-WvLog ('Blocked external link scheme: ' + $scheme)
            return
          }
          # Open permitted external links directly with the Windows shell.
          $linkPsi = New-Object System.Diagnostics.ProcessStartInfo
          $linkPsi.FileName = $candidate.AbsoluteUri
          $linkPsi.UseShellExecute = $true
          [void][System.Diagnostics.Process]::Start($linkPsi)
        }
      } catch {
        try { $a.Handled = $true } catch {}
        Write-WvLog ('External link failed: '+$_.Exception.Message)
      }
    }.GetNewClosure())

    $core.add_WebMessageReceived({
      param($s,$a)
      try {
        # Privileged native bridge messages are accepted only from the exact
        # LocalEngine origin. A future navigation/XSS mistake must not turn an
        # arbitrary web page into a DGT/PGN/TRF/file-system capability.
        $messageSource = New-Object System.Uri([string]$a.Source)
        if(-not ($messageSource.Scheme -eq 'http' -and $messageSource.Host -eq '127.0.0.1' -and $messageSource.Port -eq $Port)) {
          Write-WvLog ('Blocked WebMessage from untrusted source: ' + [string]$a.Source)
          return
        }
        $msg = $a.WebMessageAsJson | ConvertFrom-Json

        if(($msg -is [pscustomobject]) -and ([string]$msg.type -eq 'cp:cr-delete')) {
          $deleteRequestId = [string]$msg.requestId
          $deleteKey = [string]$msg.key
          $deleteClientId = [string]$msg.clientId
          $deleteLanguage = 1
          try { if($null -ne $msg.language) { $deleteLanguage = [int]$msg.language } } catch { $deleteLanguage = 1 }
          Start-ChessResultsDeleteWindow $deleteKey $deleteClientId $deleteLanguage $s $deleteRequestId
          return
        }

        if(($msg -is [pscustomobject]) -and ([string]$msg.type -eq 'cp:cr-delete-other')) {
          $deleteOtherRequestId = [string]$msg.requestId
          $deleteOtherKey = [string]$msg.key
          $deleteOtherLanguage = 1
          try { if($null -ne $msg.language) { $deleteOtherLanguage = [int]$msg.language } } catch { $deleteOtherLanguage = 1 }
          Start-ChessResultsDeleteOtherWindow $deleteOtherKey $deleteOtherLanguage $s $deleteOtherRequestId
          return
        }

        if(($msg -is [pscustomobject]) -and ([string]$msg.type -eq 'cp:dgt')) {
          $requestId = [string]$msg.requestId
          try {
            if([string]::IsNullOrWhiteSpace($requestId)) { throw 'DGT request id is missing.' }
            if(-not ('ChessPublisher.DgtBridge' -as [type])) { throw 'DGT hardware bridge is not available in this Windows session.' }
            $operation = [string]$msg.operation
            $expected = 0
            try { $expected = [Math]::Max(0,[int]$msg.expectedBoards) } catch { $expected = 0 }
            if(-not [ChessPublisher.DgtBridge]::BeginAsync($requestId,$operation,$expected)) { throw 'A DGT operation with this request id is already running.' }
            # v1.03.63: return immediately. Serial probing + WMI/registry diagnostics
            # run on a ThreadPool worker and are delivered by the UI polling timer.
          } catch {
            Write-WvLog ('DGT native operation could not be queued: ' + $_.Exception.Message)
            $result = @{ type='cp:dgt-result'; requestId=$requestId; ok=$false; error=$_.Exception.Message }
            $s.PostWebMessageAsJson(($result | ConvertTo-Json -Compress -Depth 4))
          }
          return
        }

        if(($msg -is [pscustomobject]) -and ([string]$msg.type -eq 'cp:pgn')) {
          $requestId = [string]$msg.requestId
          $result = $null
          try {
            if([string]::IsNullOrWhiteSpace($requestId)) { throw 'PGN request id is missing.' }
            $operation = [string]$msg.operation
            $pgnFolder = Get-WvTournamentPgnFolder ([string]$msg.tournamentName) ([string]$msg.tournamentFilePath)

            if($operation -eq 'ensure') {
              $result = @{ type='cp:pgn-result'; requestId=$requestId; ok=$true; operation=$operation; folder=$pgnFolder }
            }
            elseif($operation -eq 'write') {
              $fileName = Get-WvSafePgnFileName ([string]$msg.fileName)
              $target = Join-Path $pgnFolder $fileName
              $utf8 = New-Object System.Text.UTF8Encoding($false)
              [System.IO.File]::WriteAllText($target,[string]$msg.text,$utf8)
              Write-WvLog ("PGN export saved: $target")
              $result = @{ type='cp:pgn-result'; requestId=$requestId; ok=$true; operation=$operation; folder=$pgnFolder; path=$target }
            }
            else { throw "Unknown PGN operation '$operation'." }
          } catch {
            Write-WvLog ('PGN native operation failed: ' + $_.Exception.Message)
            $result = @{ type='cp:pgn-result'; requestId=$requestId; ok=$false; error=$_.Exception.Message }
          }
          $jsonResult = $result | ConvertTo-Json -Compress -Depth 8
          $s.PostWebMessageAsJson($jsonResult)
          return
        }

        if(($msg -is [pscustomobject]) -and ([string]$msg.type -eq 'cp:trf')) {
          $requestId = [string]$msg.requestId
          $result = $null
          try {
            if([string]::IsNullOrWhiteSpace($requestId)) { throw 'TRF request id is missing.' }
            $operation = [string]$msg.operation
            $trfFolder = Get-WvTournamentTrfFolder ([string]$msg.tournamentName) ([string]$msg.tournamentFilePath)

            if($operation -eq 'ensure') {
              $result = @{ type='cp:trf-result'; requestId=$requestId; ok=$true; path=$trfFolder; operation='ensure' }
            }
            elseif($operation -eq 'write') {
              $fileName = Get-WvSafeTrfFileName ([string]$msg.fileName)
              $target = Join-Path $trfFolder $fileName
              $part = "$target.part"
              [System.IO.File]::WriteAllText($part, [string]$msg.text, (New-Object System.Text.UTF8Encoding($false)))
              Move-Item -LiteralPath $part -Destination $target -Force
              Write-WvLog ("TRF export saved: $target")
              $result = @{ type='cp:trf-result'; requestId=$requestId; ok=$true; path=$target; folder=$trfFolder; operation='write' }
            }
            else { throw "Unknown TRF operation '$operation'." }
          } catch {
            Write-WvLog ('TRF native operation failed: ' + $_.Exception.Message)
            $result = @{ type='cp:trf-result'; requestId=$requestId; ok=$false; error=$_.Exception.Message }
          }
          $jsonResult = $result | ConvertTo-Json -Compress -Depth 4
          $s.PostWebMessageAsJson($jsonResult)
          return
        }

        switch -Regex ([string]$msg) {
          '^cp:cr-upload:(\d+):(\d+)$' {
            $uploadKey = [string]$Matches[1]
            $uploadLanguage = [int]$Matches[2]
            Open-ChessResultsUploadWindow $uploadKey $uploadLanguage
            break
          }
          '^cp:minimize$' { $form.WindowState=[System.Windows.Forms.FormWindowState]::Minimized; break }
          '^cp:maximize$' {
            if($form.WindowState -eq [System.Windows.Forms.FormWindowState]::Maximized){$form.WindowState=[System.Windows.Forms.FormWindowState]::Normal}
            else{$form.WindowState=[System.Windows.Forms.FormWindowState]::Maximized}
            break
          }
          '^cp:close$' { $hostState.AllowClose=$true; $form.Close(); break }
        }
      } catch { Write-WvLog ('Web message error: '+$_.Exception.Message) }
    })

    # v1.03.63 DGT async bridge: the WinForms/WebView UI thread only polls for
    # completed worker results. Slow COM protocol detection and Windows hardware
    # enumeration never execute inside WebMessageReceived.
    try {
      if($script:dgtAsyncTimer) { $script:dgtAsyncTimer.Stop(); $script:dgtAsyncTimer.Dispose() }
    } catch {}
    $script:dgtAsyncTimer = New-Object System.Windows.Forms.Timer
    $script:dgtAsyncTimer.Interval = 100
    $script:dgtAsyncTimer.add_Tick({
      try {
        if(-not ('ChessPublisher.DgtBridge' -as [type])) { return }
        $completed = @([ChessPublisher.DgtBridge]::TakeCompleted())
        foreach($item in $completed) {
          if($null -eq $item) { continue }
          $payload = @{ type='cp:dgt-result'; requestId=[string]$item.RequestId; operation=[string]$item.Operation; ok=[bool]$item.Ok }
          if([bool]$item.Ok) {
            $payload.snapshot = $item.Snapshot
            if($null -ne $item.Diagnostics) { $payload.diagnostics = $item.Diagnostics }
          } else {
            $payload.error = [string]$item.Error
            Write-WvLog ('DGT background operation failed: ' + [string]$item.Error)
          }
          if($web.CoreWebView2) { $web.CoreWebView2.PostWebMessageAsJson(($payload | ConvertTo-Json -Compress -Depth 12)) }
        }
      } catch { Write-WvLog ('DGT async result polling failed: ' + $_.Exception.Message) }
    })
    $script:dgtAsyncTimer.Start()

    $core.add_ProcessFailed({ param($s,$a) Write-WvLog ('WebView2 process failed: '+$a.ProcessFailedKind) })
  })

  $web.add_NavigationCompleted({
    param($sender,$e)
    if($e.IsSuccess) {
      try {
        $loaded = New-Object System.Uri([string]$sender.Source)
        if(-not ($loaded.Scheme -eq 'http' -and $loaded.Host -eq '127.0.0.1' -and $loaded.Port -eq $Port)) {
          Write-WvLog ('Adapter injection skipped for non-local source: ' + [string]$sender.Source)
          return
        }
        $sender.CoreWebView2.ExecuteScriptAsync($adapter) | Out-Null
      } catch { Write-WvLog ('Adapter injection failed: '+$_.Exception.Message) }
      Write-WvLog 'ChessPublisher page loaded in WebView2.'
    } else {
      Write-WvLog ('Navigation failed: '+$e.WebErrorStatus)
    }
  }.GetNewClosure())

  $form.add_FormClosing({
    param($sender,$e)
    if($hostState.AllowClose) { return }
    if($web.CoreWebView2) {
      $e.Cancel = $true
      try {
        $closeScript = @"
(async()=>{
  try {
    if(typeof requestNativeAppClose==='function'){
      await requestNativeAppClose();
      return;
    }
    if(typeof prepareCurrentTournamentForTransition==='function'){
      const ok=await prepareCurrentTournamentForTransition('Close chess-publisher','Save unsaved changes before closing chess-publisher?');
      if(!ok) return;
    }
    try{chrome.webview.postMessage('cp:close')}catch(_){}
  } catch(err) {
    try{console.error('Native close bridge:',err)}catch(_){}
  }
})()
"@
        $web.CoreWebView2.ExecuteScriptAsync($closeScript) | Out-Null
      } catch {
        Write-WvLog ('Close-save bridge failed: '+$_.Exception.Message)
        $hostState.AllowClose = $true
        $e.Cancel = $false
      }
    } else {
      $hostState.AllowClose = $true
    }
  })

  $form.add_FormClosed({
    try { if($script:dgtAsyncTimer) { $script:dgtAsyncTimer.Stop(); $script:dgtAsyncTimer.Dispose(); $script:dgtAsyncTimer=$null } } catch {}
    try { if('ChessPublisher.DgtBridge' -as [type]) { [void][ChessPublisher.DgtBridge]::DisconnectAll() } } catch {}
    Stop-OwnedEngine
  })

  $form.add_KeyDown({
    param($sender,$e)
    if($e.KeyCode -eq [System.Windows.Forms.Keys]::F11) {
      if($form.WindowState -eq [System.Windows.Forms.FormWindowState]::Maximized){$form.WindowState=[System.Windows.Forms.FormWindowState]::Normal}
      else{$form.WindowState=[System.Windows.Forms.FormWindowState]::Maximized}
      $e.Handled=$true
    }
  })

  $web.Source = [Uri]("http://127.0.0.1:$Port/")
  [System.Windows.Forms.Application]::Run($form)
  Write-WvLog 'ChessPublisher WebView closed.'
  try { if($script:appIcon) { $script:appIcon.Dispose(); $script:appIcon=$null } } catch {}
}
catch {
  Write-WvLog ('FATAL: '+$_.Exception.ToString())
  try { if('ChessPublisher.DgtBridge' -as [type]) { [void][ChessPublisher.DgtBridge]::DisconnectAll() } } catch {}
  Stop-OwnedEngine
  try { if($script:appIcon) { $script:appIcon.Dispose(); $script:appIcon=$null } } catch {}
  try { Show-WvMessage ("chess-publisher could not start.`n`n"+$_.Exception.Message+"`n`nSee ChessPublisher-WebView.log for details.") 'chess-publisher' 'Error' } catch {}
  exit 1
}
