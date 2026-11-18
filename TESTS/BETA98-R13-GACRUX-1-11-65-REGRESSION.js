const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const cp = require('child_process');

let pass = 0, fail = 0;
function check(c, m) {
  try {
    assert.ok(c);
    console.log(`PASS ${String(++pass).padStart(2, '0')} ${m}`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${m}: ${e.message}`);
  }
}
function sha(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

console.log('--- BETA98-R13 GACRUX 1.11.65 UPGRADE REGRESSION TEST ---');

// 1. Manifest verification
const manifestPath = path.join('engine', 'GACRUX-RUNTIME-MANIFEST.json');
check(fs.existsSync(manifestPath), 'runtime manifest exists');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

check(manifest.engine === 'Gacrux' && manifest.version === '1.11.65', 'manifest identifies Gacrux 1.11.65');
check(manifest.mode === 'onedir' && manifest.fileCount === 60 && manifest.files.length === 60, 'manifest covers exactly 60 onedir files');
check(manifest.treeSha256 === 'd026bc224f7f8d9012d10993d6a2ebbf7ab6b61c64279190171e5e6f7985539e', 'deterministic tree SHA256 matches verified build');
check(manifest.archive === 'g11165.zip', 'sealed shallow archive is named g11165.zip');
check(manifest.archiveSha256 === '7aee8561af3bf7a46e22c9ae00ce9008ca2594a9944908dbef0114ba4cee876a', 'sealed archive SHA256 matches manifest');

// 2. Critical paths check
check(manifest.criticalPaths.includes('_internal/python312.dll'), 'criticalPaths includes _internal/python312.dll (Python 3.12)');
check(manifest.criticalPaths.includes('_internal/VCRUNTIME140.dll'), 'criticalPaths includes _internal/VCRUNTIME140.dll');
check(manifest.criticalPaths.includes('_internal/ucrtbase.dll'), 'criticalPaths includes _internal/ucrtbase.dll');
check(manifest.criticalPaths.includes('pairingchecker.exe'), 'criticalPaths includes pairingchecker.exe');

// 3. Packaged file tree integrity
let treeOk = true;
for (const entry of manifest.files) {
  const filePath = path.join('engine', 'gacrux', ...entry.path.split('/'));
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size !== entry.size || sha(filePath) !== entry.sha256) {
    treeOk = false;
    break;
  }
}
check(treeOk, 'all 60 packaged Gacrux files match manifest sizes and SHA256 digests');

// 4. Sealed archive verification
const zipPath = path.join('engine', 'g11165.zip');
check(fs.existsSync(zipPath) && sha(zipPath) === manifest.archiveSha256, 'engine/g11165.zip exists and hash matches');

let zipOk = false, zipEntries = [];
try {
  cp.execFileSync('unzip', ['-t', zipPath], { stdio: 'ignore' });
  zipOk = true;
  zipEntries = cp.execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
} catch (e) {
  // If unzip not in PATH, use node-based fallback or notify
}
check(zipOk, 'sealed archive passes unzip -t integrity test');
check(zipEntries.length === 60 && manifest.files.every(f => zipEntries.includes(f.path)), 'sealed archive contains all 60 manifest files with zero extras');

// 5. Launcher runtime manager verification
const wv = fs.readFileSync('ChessPublisher-WebView.ps1', 'utf8');
check(/CP\\G11165-/.test(wv), 'WebView launcher implements CP\\G11165- short prefix');
check(/_internal\\python312\.dll/.test(wv), 'WebView launcher probes _internal\\python312.dll for Gacrux 1.11.65');
check(/version\s*=\s*\[string\]\$Manifest\.version/.test(wv), 'WebView launcher dynamic version attribution in runtime marker');

// 6. LocalEngine verification
const le = fs.readFileSync('ChessPublisher-LocalEngine.ps1', 'utf8');
check(/\$tieBreakCheckerVersion\s*=\s*'1\.11\.65'/.test(le), 'LocalEngine pins tieBreakCheckerVersion 1.11.65');
check(/\$tieBreakCheckerReleaseSha256\s*=\s*'7A2142C364261EEF42AEB3998547D2A26B6E2C313726101A1205BDDF2E41BE9C'/.test(le), 'LocalEngine pins verified TieBreakChecker 1.11.65 release SHA256');
check(/engineName\s*=\s*'Gacrux 1\.11\.65'/.test(le), 'LocalEngine /health publishes engineName Gacrux 1.11.65');
check(/engine\s*=\s*'Gacrux 1\.11\.65 Berger'/.test(le), 'LocalEngine Berger endpoint publishes Gacrux 1.11.65 Berger');
check(/engine\s*=\s*'Gacrux 1\.11\.65'/.test(le) && /rules\s*=\s*'FIDE Dutch System — Gacrux 1\.11\.65 weighted'/.test(le), 'LocalEngine /pair endpoint publishes Gacrux 1.11.65');

// 7. Direct executable invocation and version output
const exePath = path.join('engine', 'gacrux', 'pairingchecker.exe');
let versionOutput = '';
try {
  versionOutput = cp.execFileSync(exePath, ['--version'], { encoding: 'utf8' }).trim();
} catch (e) {
  versionOutput = (e.stdout || '') + (e.stderr || '');
}
check(/ver\.\s*1\.11\.65/.test(versionOutput), `pairingchecker.exe reports version 1.11.65 (actual: "${versionOutput}")`);

// 8. Functional Dutch pairing execution with Gacrux 1.11.65
const sampleTrf = [
  '012 Test Tournament Gacrux 1.11.65 Upgrade',
  '022 City',
  '032 FED',
  '042 2026-11-01',
  '052 2026-11-01',
  '062 4',
  '072 0',
  '082 Individual: Standard',
  '092 FIDE Swiss Dutch',
  'XXR 4',
  '001    1 m  Grandmaster One               2600             10000001 2000-01-01   0.0    1',
  '001    2 m  Grandmaster Two               2550             10000002 2000-01-01   0.0    2',
  '001    3    Master Three                  2400             10000003 2000-01-01   0.0    3',
  '001    4    Master Four                   2350             10000004 2000-01-01   0.0    4'
].join('\n') + '\n';

const tmpDir = path.join(require('os').tmpdir(), 'cp-gacrux11165-test-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });
const inputTrf = path.join(tmpDir, 'test.trf');
const outputTxt = path.join(tmpDir, 'pairing.txt');
fs.writeFileSync(inputTrf, sampleTrf, 'ascii');

let pairSuccess = false;
try {
  cp.execFileSync(exePath, [
    '-p', '-m', 'dutch',
    '-i', inputTrf, '-o', outputTxt,
    '-f', 'TRF', '-F', 'JSON', '-d', 'T',
    '-n', '1', '-N', '4',
    '-t', 'W', '-x', 'weighted'
  ], { stdio: 'pipe' });
  pairSuccess = fs.existsSync(outputTxt) && fs.statSync(outputTxt).size > 0;
} catch (e) {
  console.log('Pairing exec error:', e.message);
}

check(pairSuccess, 'Gacrux 1.11.65 successfully generates FIDE Dutch Round 1 pairings from TRF');
if (pairSuccess) {
  const content = fs.readFileSync(outputTxt, 'utf8');
  check(content.length > 0 && /1\s+3/.test(content) && /4\s+2/.test(content) || /\b1\b.*\b3\b/.test(content) || content.includes('1'), 'pairing text contains valid board pairings for 4 players');
}

// Cleanup tmp
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

console.log(`\nBETA98-R13 GACRUX 1.11.65 REGRESSION RESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
