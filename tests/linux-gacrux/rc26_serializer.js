#!/usr/bin/env node
'use strict';

const fs = require('fs');
const vm = require('vm');

function die(message) {
  console.error(message);
  process.exit(2);
}

function extractFunction(text, name, occurrence = -1) {
  const rx = new RegExp('function\\s+' + name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '\\s*\\(', 'g');
  const matches = [...text.matchAll(rx)];
  if (!matches.length) throw new Error(`Missing production function ${name}`);
  const m = matches[occurrence < 0 ? matches.length - 1 : occurrence];
  let i = m.index + m[0].length;
  let par = 1, quote = null, esc = false;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) quote = null;
    } else {
      if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(') par++;
      else if (c === ')' && --par === 0) break;
    }
    i++;
  }
  const b = text.indexOf('{', i);
  if (b < 0) throw new Error(`Unclosed production function ${name}`);
  let depth = 0; quote = null; esc = false;
  for (let j = b; j < text.length; j++) {
    const c = text[j];
    if (quote) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(m.index, j + 1);
  }
  throw new Error(`Unclosed production function ${name}`);
}

function loadProductionSerializer(sourcePath, fixture) {
  const raw = fs.readFileSync(sourcePath, 'utf8');
  const required = [
    'normalizePlayerTitle',
    'cpTRFNormalizeResult',
    'cpTRFPlayerKeyAliases',
    'cpTRFBuildPlayerMaps',
    'cpTRFResolveBoardPlayer',
    'cpTRFPointsForCode',
    'tournamentState',
    'bbpAscii',
    'bbpRoundField',
    'pairingEngineScoreFromHistory',
    'cpTRFValidateCompletedHistory',
    'buildPairingEngineTRF',
  ];
  const source = /<html|<script/i.test(raw) ? required.map(n => extractFunction(raw, n)).join('\n\n') : raw;

  const tournament = fixture.tournament;
  const completed = Number(fixture.completed || 0);
  const topColor = String(fixture.topColor || 'w').toLowerCase() === 'b' ? 'b' : 'w';

  const sandbox = {
    console,
    data: { currentTournament: fixture.name || 'Linux Gacrux RC26 Fixture' },
    getCurrentTournament: () => tournament,
    ensurePairingNumbers: () => {},
    playerKey: (p, i) => String(p?.localKey || p?.key || `p-${Number(i) + 1}`),
    getPlayerJoinRound: p => {
      const n = Number.parseInt(p?.joinedFromRound, 10);
      return Number.isInteger(n) && n > 0 ? n : 1;
    },
    getPabPoints: () => {
      const n = Number(tournament?.regulations?.pabPoints);
      return Number.isFinite(n) ? n : 1;
    },
    getCompletedRounds: () => completed,
    getLatestGeneratedRound: () => completed,
    getPairingHistoryIntegrity: () => ({ ok: true, message: '' }),
    getInitialTopColorForEngine: () => topColor,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'ChessPublisher.html#production-pairing-serializer' });
  if (typeof sandbox.buildPairingEngineTRF !== 'function') throw new Error('Production buildPairingEngineTRF was not loaded');
  return sandbox;
}

function validateSerializerOutput(trf, completed) {
  if (!trf.endsWith('\r\n')) throw new Error('TRF must end with CRLF');
  const lines = trf.split(/\r\n/).filter(Boolean);
  for (const required of ['012 ', '142 ', '152 ', '192 FIDE_DUTCH_2025']) {
    if (!lines.some(x => x.startsWith(required))) throw new Error(`Missing production TRF header ${required.trim()}`);
  }
  const players = lines.filter(x => x.startsWith('001'));
  if (!players.length) throw new Error('No 001 player records generated');
  const minimum = 91 + completed * 10;
  for (const line of players) {
    if (line.length < minimum) throw new Error(`001 record too short: ${line.length} < ${minimum}`);
  }
}

function main() {
  if (process.argv.length !== 5) {
    die('Usage: node rc26_serializer.js <ChessPublisher.html|production-fragment.js> <fixture.json> <out.trf>');
  }
  const [, , sourcePath, fixturePath, outPath] = process.argv;
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const sandbox = loadProductionSerializer(sourcePath, fixture);
  const trf = sandbox.buildPairingEngineTRF(fixture.topColor || 'w');
  validateSerializerOutput(trf, Number(fixture.completed || 0));
  fs.writeFileSync(outPath, trf, 'ascii');
  process.stdout.write(JSON.stringify({
    ok: true,
    version: '1.05.00-RC26',
    completed: Number(fixture.completed || 0),
    bytes: Buffer.byteLength(trf, 'ascii'),
    playerRecords: trf.split(/\r\n/).filter(x => x.startsWith('001')).length,
  }) + '\n');
}

try { main(); } catch (e) { die(e && e.stack ? e.stack : String(e)); }
