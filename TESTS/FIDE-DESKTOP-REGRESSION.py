from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def trf06_fixture():
    # TEC Annexure B column positions, including literal CR record delimiters.
    def player(start_rank, sex, name, rating, fide_id, points, rank, opponent, color, result):
        return (
            f"001 {start_rank:4} {sex}    {name:<33} {rating:4} BUL {fide_id:>11}"
            f" 1990/01/01 {points:4.1f} {rank:4}  {opponent:04} {color} {result}"
        )

    return "\r".join([
        "012 TRF06 regression", "022 Sofia", "032 BUL", "042 2006/06/01", "052 2006/06/01",
        "062 2", "072 2", "092 Individual Swiss", "102 Chief Arbiter", "122 60+30",
        "132" + " " * 88 + "06/06/01",
        player(1, "w", "Ivanova, Ana", 2200, "29900001", 1, 1, 2, "w", "1"),
        player(2, "m", "Petrov, Boris", 2100, "29900002", 0, 2, 1, "b", "0"), "",
    ])


def open_desktop(page):
    page.goto((ROOT / "ChessPublisher.html").as_uri(), wait_until="load")
    page.wait_for_function("document.documentElement.dataset.chesspublisherVersion.endsWith('-r15')")
    page.evaluate("""() => {
      populateStaticMenus();
      populateFederationMenus();
      const name = 'Ana Ivanova vs Boris Petrov';
      const t = createEmptyTournament();
      Object.assign(t.settings, {
        rounds:'2', lastSwissRounds:'2', timeControl:'60+30', timeControlPreset:'60+30',
        tournamentRatingType:'Standard', fideRated:'Yes', country:'BUL', city:'Sofia',
        chiefArbiter:'Chief Arbiter', startDate:'2026-11-15T08:00', endDate:'2026-11-15T18:00'
      });
      t.players = [
        {name:'Ivanova, Ana',rating:2200,officialRating:2200,localKey:'p1',fideId:'29900001',birth:'1990',fed:'BUL',gender:'f',attendance:'present',pairingNumber:1,joinedFromRound:1},
        {name:'Petrov, Boris',rating:2100,officialRating:2100,localKey:'p2',fideId:'29900002',birth:'1991',fed:'BUL',gender:'m',attendance:'present',pairingNumber:2,joinedFromRound:1}
      ];
      t.schedule.rows = [{event:'Round 1',dateTime:'2026-11-15T09:00'},{event:'Round 2',dateTime:'2026-11-15T13:00'}];
      data.tournaments = {[name]:t};
      data.currentTournament = name;
      normalizeData();
      loadAllFields();
      t.pairings.round = '2';
      t.pairings.engine.lastGeneratedRound = 2;
      const [a,b] = t.players.map(playerKey);
      t.pairings.liveBoards = {
        '1': [{board:1,whiteKey:a,blackKey:b,result:'1-0'}],
        '2': [{board:1,whiteKey:b,blackKey:a,result:'1/2-1/2'}]
      };
    }""")


def eligibility(page):
    page.evaluate("document.getElementById('cpFideEligibility').open = true")
    page.wait_for_function("document.getElementById('cpEligibilityResult').textContent.includes('Standard rating:')")
    data = page.evaluate("""() => {
      const t = getCurrentTournament();
      const before = JSON.stringify(t.pairings.liveBoards);
      const fast = document.getElementById('cpFastStandard');
      fast.elements.purpose.value = 'norm';
      fast.requestSubmit();
      const norm = document.getElementById('cpShortenedNorm');
      norm.elements.fideId.value = '29900001';
      norm.elements.title.value = 'GM';
      norm.elements.prior.value = '1';
      norm.elements.reference.value = 'Prior title norm record';
      norm.requestSubmit();
      const match = document.getElementById('cpFideMatchReview');
      match.elements.approval.value = 'QC review record';
      match.requestSubmit();
      return {audit: JSON.parse(JSON.stringify(t.fideCompliance)), untouched: before === JSON.stringify(t.pairings.liveBoards)};
    }""")
    audit = data["audit"]
    assert audit["fastStandard"]["rating"] == "eligible", audit
    assert audit["fastStandard"]["daily"][0]["playingMinutes"] == 360, audit
    assert audit["shortenedNormHistory"][0]["status"] == "ineligible", audit
    assert audit["individualMatch"]["status"] == "manual-review", audit
    assert len(audit["individualMatch"]["games"]) == 2, audit
    assert all(entry["trf"] is False for entry in audit["events"][-3:]), audit
    assert [entry["evidence"]["status"] for entry in audit["events"][-2:]] == ["ineligible", "manual-review"], audit
    assert data["untouched"], data
    print("PASS Fast Standard, shortened norms and match audit through actual Setup forms")


def round_trip(page):
    results = page.evaluate("""() => {
      const api = window.__cpTrfCompliance;
      const io = window.__cpImportInterop;
      const tournament = getCurrentTournament();
      cpLogComplianceEvent({category:'TEST AUDIT', message:'Round-trip audit marker', trf:true});
      return [26, 16].map(version => {
        const check = api.validate(version, 2, {strict:true, syncUi:false});
        if (check.errors.length) throw new Error(check.errors.join('; '));
        const text = api.build(version, 2, {strict:true, prevalidated:check}).text;
        const parsed = io.parseTRF(text);
        const restored = io.buildTournament(parsed);
        return {
          version, detected: parsed.trfVersion, players: restored.tournament.players.map(p => p.fideId),
          results: [1,2].map(n => restored.tournament.pairings.liveBoards[n][0].result),
          tieBreak: /^212 /m.test(text),
          audit: cpInjectComplianceCommentsIntoTRF(text).includes('TEST AUDIT: Round-trip audit marker'),
          sourceResults: [1,2].map(n => tournament.pairings.liveBoards[n][0].result)
        };
      });
    }""")
    for result in results:
        assert result["version"] == result["detected"], result
        assert result["players"] == ["29900001", "29900002"], result
        actual = [value.replace(" ", "") for value in result["results"]]
        assert actual[0] == "1-0" and actual[1] in ("½-½", "1/2-1/2"), result
        assert result["audit"], result
        assert result["version"] != 26 or result["tieBreak"], result
        print(f"PASS TRF{result['version']} export/import round-trip (players, pairings and results)")


def legacy_round_trip(page):
    result = page.evaluate("""text => {
      const io = window.__cpImportInterop;
      const parsed = io.parseTRF(text);
      const restored = io.buildTournament(parsed).tournament;
      return {
        version: parsed.trfVersion, players: restored.players.map(p => ({fideId:p.fideId, name:p.name})),
        result: restored.pairings.liveBoards['1'][0].result, roundDates: parsed.meta.roundDates
      };
    }""", trf06_fixture())
    assert result["version"] == 16, result  # Legacy records shared by TRF06/TRF16.
    assert [p["fideId"] for p in result["players"]] == ["29900001", "29900002"], result
    assert result["roundDates"] == ["06/06/01"] and result["result"].replace(" ", "") == "1-0", result
    print("PASS TRF06 CR-delimited import (headers, players, round date and result)")


if __name__ == "__main__":
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        open_desktop(page)
        eligibility(page)
        round_trip(page)
        legacy_round_trip(page)
        assert not errors, errors
