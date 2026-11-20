'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const shell = process.argv[2] || path.join(__dirname, '..', 'ChessPublisher.html');
const html = fs.readFileSync(shell, 'utf8');
const code = html.match(/<script id="cpFideTrfCompliancePatch">([\s\S]*?)<\/script>/)[1];
const tournament = {settings: {rounds: 1}, players: [], schedule: {rows: []},
  pairings: {trfImportMeta: {roundDates: ['2026/11/19']}}};
let pab = 1;
const context = {window: {}, data: {currentTournament: 'Fixture'}, getPabPoints: () => pab,
  document: {documentElement: {dataset: {}}}, trf26EncodedTimeControl: () => '5400+30'};
vm.runInNewContext(code, context);
const api = context.window.__cpTrfCompliance;
function report() {
  const headers = api.tournamentLines(26, tournament, 1, {}, true, 'rating');
  const player = api.build001({id: 1, name: 'Example', reportPoints: pab,
    rounds: [{result: 'U', kind: 'pab'}]}, 1, 1);
  return [...headers, player, ''].join('\r\n');
}
for (pab of [1, 0.5, 0]) {
  const text = report();
  const record = text.split('\r\n').find(l => l.startsWith('162 '));
  assert.equal(record, pab === 1 ? undefined : '162  P ' + pab.toFixed(1));
  assert.deepEqual(Array.from(api.strictExchangeCheck(text, {throughRound: 1}).errors), []);
}
for (const invalid of ['', '2026/02/30']) {
  tournament.pairings.trfImportMeta.roundDates = [invalid];
  assert.ok(api.strictExchangeCheck(report(), {throughRound: 1}).errors.some(e => e.includes('132')));
}
console.log('TRF26 rating export regression passed');
