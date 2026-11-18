from playwright.sync_api import sync_playwright
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'ChessPublisher.html').read_text(encoding='utf-8')
out=ROOT/'BETA98-R11-LATE-ENTRY-UX.png'
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={"width":1440,"height":900})
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(html, wait_until='load', timeout=30000)
    page.wait_for_timeout(900)
    model=page.evaluate("""()=>{
      const t=createEmptyTournament();
      t.settings.name='R11 Late Entry Test';
      t.settings.format='Individual Swiss';
      t.settings.pairingSystem='FIDE Dutch System';
      t.settings.rounds='7';
      t.settings.tournamentRatingType='Rapid';
      t.players=[
        {name:'Player One',rating:2100,fed:'BUL',fideId:'9900001',birth:'1990',gender:'m',attendance:'present',localKey:'p1',joinedFromRound:1,pairingNumber:1},
        {name:'Player Two',rating:2000,fed:'BUL',fideId:'9900002',birth:'1991',gender:'m',attendance:'present',localKey:'p2',joinedFromRound:1,pairingNumber:2},
        {name:'Waiting Player',rating:1900,fed:'BUL',fideId:'9900003',birth:'1992',gender:'m',attendance:'absent',localKey:'p3',joinedFromRound:1,pairingNumber:3}
      ];
      t.pairings=t.pairings||{};t.pairings.liveBoards={'1':[{board:1,whiteKey:'p1',blackKey:'p2',result:'1:0'}]};
      t.pairings.engine=t.pairings.engine||{};
      data.tournaments=data.tournaments||{};data.tournaments['R11 Late Entry Test']=t;data.currentTournament='R11 Late Entry Test';
      normalizeData();loadAllFields();showTab('registration',document.getElementById('tabRegistration'));
      const cs=document.getElementById('createScreen');if(cs)cs.style.display='none';
      cpBeta98R11.refreshLateEntryUi();
      return {latest:getLatestGeneratedRoundForTournament(t),format:t.settings.format,pairing:t.settings.pairingSystem};
    }""")
    page.wait_for_timeout(180)
    print('version',page.locator('html').get_attribute('data-chesspublisher-version'))
    print('model',model)
    print('bar_display',page.locator('#cpR11LateEntryBar').evaluate("e=>getComputedStyle(e).display"))
    print('manual_label',page.locator('#manualAddPlayerBtn').inner_text())
    print('no_selection_disabled',page.locator('#setLateEntryBtn').is_disabled())
    print('no_selection_hint',page.locator('#cpR11LateEntryHint').inner_text())
    page.evaluate("selectedPlayerIndexes.clear();selectedPlayerIndexes.add(2);renderRegistered();cpBeta98R11.refreshLateEntryUi();")
    page.wait_for_timeout(80)
    print('eligible_disabled',page.locator('#setLateEntryBtn').is_disabled())
    print('eligible_label',page.locator('#setLateEntryBtn').inner_text())
    print('eligible_hint',page.locator('#cpR11LateEntryHint').inner_text())
    page.evaluate("selectedPlayerIndexes.clear();selectedPlayerIndexes.add(0);renderRegistered();cpBeta98R11.refreshLateEntryUi();")
    page.wait_for_timeout(80)
    print('paired_disabled',page.locator('#setLateEntryBtn').is_disabled())
    print('paired_hint',page.locator('#cpR11LateEntryHint').inner_text())
    page.evaluate("document.getElementById('ratingModal').style.display='flex'; cpBeta98R11.updateModalButton();")
    page.wait_for_timeout(80)
    print('modal_add_label',page.locator('#ratingModalAddButton').inner_text())
    page.evaluate("document.getElementById('ratingModal').style.display='none'; window.appAlert=async()=>true; window.cpPersistCriticalMutation=async()=>true;")
    page.fill('#manualName','Late New Player')
    page.fill('#manualRating','1750')
    page.fill('#manualFide','9900011')
    page.fill('#manualBirth','1994')
    page.click('#manualAddPlayerBtn')
    page.wait_for_timeout(300)
    added=page.evaluate("""()=>{const t=getCurrentTournament(),i=t.players.length-1,p=t.players[i];return {name:p.name,join:getPlayerJoinRound(p),attendance:getPlayerAttendance(p),selected:selectedPlayerIndexes.has(i),needsResort:!!t.pairings.engine.needsResort,lateButton:document.getElementById('setLateEntryBtn')?.textContent};}""")
    print('actual_add',added)
    page.evaluate("selectedPlayerIndexes.clear();selectedPlayerIndexes.add(2);renderRegistered();cpBeta98R11.refreshLateEntryUi();")
    page.wait_for_timeout(80)
    page.locator('#registration').screenshot(path=str(out))
    print('screenshot',out)
    print('pageerrors',errors[:5])
    browser.close()
