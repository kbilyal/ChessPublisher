"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const html = readFileSync(join(__dirname, "..", "ChessPublisher.html"), "utf8");
const parser = html.slice(html.indexOf("function cpDetectTournamentTypeFromTimeControl"), html.indexOf("function cpGetEffectiveTimeControlFromUI"));
const script = html.match(/<script id="cpFideEligibilityScript">([\s\S]*?)<\/script>/)[1];
const context = {window: {}, document: {addEventListener() {}}};
runInNewContext(parser + script, context);
const {assess, assessNorm, ratingCategories} = context.window.cpFideEligibility;

function report(timeControl, rounds, review, startDate = "2026-11-15", ok = true) {
  const dateTimes = Array.from({length: rounds}, (_, i) => startDate + "T" + String(i + 8).padStart(2, "0") + ":00");
  return assess({settings: {timeControl, startDate, fideRated: "Yes"}, schedule: {ok, dateTimes}, review});
}

test("60+30 permits two rounds in a norm event and rejects three", () => {
  const two = report("60+30", 2, {purpose: "norm"});
  assert.equal(two.rating, "eligible");
  assert.equal(two.norm, "eligible");
  const three = report("60+30", 3, {purpose: "norm"});
  assert.equal(three.rating, "ineligible");
  assert.equal(three.norm, "ineligible");
});

test("rating-only accepts exactly 12 hours and rejects more", () => {
  const exact = report("60+30", 4, {purpose: "rating"});
  assert.equal(exact.daily[0].rounds, 4);
  assert.equal(exact.daily[0].playingMinutes, 720);
  assert.equal(exact.rating, "eligible");
  assert.equal(exact.norm, "not-applicable");
  assert.equal(report("60+30", 5, {purpose: "rating"}).rating, "ineligible");
  const days = assess({
    settings: {timeControl: "60+30", startDate: "2026-11-15", fideRated: "Yes"},
    schedule: {ok: true, dateTimes: ["2026-11-15T09:00", "2026-11-15T13:00", "2026-11-16T09:00"]},
    review: {purpose: "norm"}
  });
  assert.equal(days.norm, "eligible");
});

const capped = {purpose: "norm", route: "rating-cap", ratingDate: "2026-11-01"};

for (const [highest, expected] of [[2399, "eligible"], [2400, "manual-review"], [2401, "manual-review"]]) {
  test("45+30 non-Circuit threshold at " + highest, () => {
    const value = report("45+30", 2, {...capped, highest});
    assert.equal(value.rating, expected);
    assert.equal(value.evidence.highest, highest);
    if (highest === 2400) assert.match(value.reasons.join(" "), /QC clarification/);
  });
}

test("45+30 Circuit route uses final-lineup confirmation and evidence", () => {
  const review = {purpose: "norm", route: "circuit", highest: 2600, circuit: "confirmed", reference: "Circuit record"};
  assert.equal(report("45+30", 2, review).rating, "eligible");
  assert.equal(report("45+30", 2, {...review, reference: ""}).rating, "manual-review");
  assert.equal(report("45+30", 2, {...review, circuit: "failed", highest: 2399}).rating, "ineligible");
  assert.equal(report("45+30", 2, {...review, route: "qc"}).rating, "manual-review");
});

test("incomplete schedule, historical event or missing rating evidence requires review", () => {
  assert.equal(report("60+30", 2, {purpose: "norm"}, "2026-11-15", false).rating, "manual-review");
  assert.equal(report("60+30", 2, {purpose: "norm"}, "2026-11-12").rating, "manual-review");
  assert.equal(report("45+30", 2, capped).rating, "manual-review");
  assert.equal(report("45+30", 2, {...capped, highest: 2399, ratingDate: "2026-11-16"}).rating, "manual-review");
  assert.equal(report("90+30", 2, {purpose: "norm"}).rating, "not-applicable");
});

test("one shortened-control norm may count per title, independently of rating", () => {
  const value = report("45+30", 2, {...capped, highest: 2399});
  assert.equal(value.rating, "eligible");
  assert.equal(assessNorm(value, 0, "verified title history"), "eligible");
  assert.equal(assessNorm(value, 1, "previous norm"), "ineligible");
  assert.equal(assessNorm(value, "", "unverified"), "manual-review");
  assert.equal(assessNorm(value, 0, ""), "manual-review");
});

test("Freestyle is reserved outside the active calculator and selectors", () => {
  assert.equal(ratingCategories.freestyle.available, false);
  assert.ok(["standard", "rapid", "blitz"].every(category => ratingCategories[category].available));
  assert.doesNotMatch(html, /<option[^>]*>\s*Freestyle\s*<\/option>/i);
});

const match = {
  eventTitle: "Sofia: Ana Ivanova vs Boris Petrov",
  players: [{name: "Ivanova, Ana"}, {name: "Petrov, Boris"}],
  review: {approval: "QC reference", history: "confirmed", historyReference: "Rated histories verified"}
};

for (const [category, limit] of [["Standard", 4], ["Rapid", 8], ["Blitz", 12]]) {
  test(category + " individual match accepts only the first " + limit + " games", () => {
    const games = Array.from({length: limit + 1}, (_, i) => ({round: i + 1, result: "1-0"}));
    const report = context.window.cpFideEligibility.assessMatch({...match, category, games});
    assert.equal(report.status, "eligible");
    assert.equal(report.games.length, games.length);
    assert.equal(report.games[limit - 1].status, "eligible");
    assert.equal(report.games[limit].status, "ineligible");
    assert.equal(Object.hasOwn(games[0], "status"), false);
  });
}

test("match review requires verified history and a named event title", () => {
  const assessMatch = context.window.cpFideEligibility.assessMatch;
  const category = "Standard";
  const unknown = assessMatch({...match, category, review: {approval: "QC reference"}});
  assert.equal(unknown.status, "manual-review");
  assert.match(unknown.reasons.join(" "), /could not be verified locally/);
  assert.equal(assessMatch({...match, category, review: {...match.review, history: "consecutive"}}).status, "ineligible");
  assert.equal(assessMatch({...match, category, eventTitle: "Ana Ivanovab vs Boris Petrov"}).status, "ineligible");
  assert.equal(assessMatch({...match, category, review: {...match.review, approval: ""}}).status, "manual-review");
});

test("documented official and national-title exemptions lift game and history limits", () => {
  const assessMatch = context.window.cpFideEligibility.assessMatch;
  const category = "Standard";
  const games = Array.from({length: 5}, (_, i) => ({round: i + 1, result: "1-0"}));
  const official = assessMatch({...match, category, games, review: {exemption: "fide", exemptionReference: "FIDE event"}});
  assert.equal(official.games[4].status, "eligible");
  const national = assessMatch({
    ...match, category, games,
    review: {exemption: "national", exemptionReference: "National-title exemption", approval: "QC reference"}
  });
  assert.equal(national.games[4].status, "eligible");
  const pending = assessMatch({...match, category, games, review: {exemption: "national", approval: "QC reference"}});
  assert.equal(pending.status, "manual-review");
  assert.equal(pending.games[4].status, "ineligible");
});
