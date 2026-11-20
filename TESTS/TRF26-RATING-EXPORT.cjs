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

// Exercise the same final-place policy as the Standings screen.
context.document.readyState = 'loading';
context.document.addEventListener = () => {};
context.getCurrentTournament = () => tournament;
vm.runInNewContext(html.match(/<script data-cp-bundled-source="ChessPublisher-Beta69-Compliance.js">([\s\S]*?)<\/script>/)[1], context);
const policy = context.window.cpBeta69;
const standings = {ties: [], players: [{id:1, score:2}, {id:2, score:2}, {id:3, score:1}]};
const key = policy.splitGroups(standings.players, [])[0].key;
for (const [mode, saved, expected, descriptor] of [
  ['same-place', {}, [1,1,3], ''],
  ['drawing-lots', {}, [1,1,3], ''],
  ['drawing-lots', {draws:{[key]:{values:{1:0.2,2:0.8}}}}, [2,1,3], 'OTHER_LOT'],
  ['manual-order', {manual:{[key]:['2','1']}}, [2,1,3], 'OTHER_MANUAL']
]) {
  tournament.finalTieResolution = {mode, ...saved};
  const {ranks, descriptors} = api.ratingRanks(standings, tournament, true);
  assert.deepEqual(standings.players.map(p => ranks.get(p.id)), expected);
  assert.equal(descriptors.join(','), descriptor);
  assert.equal(api.ratingRanks(standings, tournament, false).ranks.get(2), 1);
}
console.log('TRF26 final-place policy regression passed');
