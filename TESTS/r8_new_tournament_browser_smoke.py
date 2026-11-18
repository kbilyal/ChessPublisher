from playwright.sync_api import sync_playwright
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'ChessPublisher.html').read_text(encoding='utf-8')
out=ROOT/'BETA98-R8-NEW-TOURNAMENT-UI.png'
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={"width":1280,"height":820})
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(html, wait_until='load', timeout=30000)
    page.wait_for_timeout(900)
    page.evaluate("openNewTournamentDialog('new')")
    page.wait_for_timeout(250)
    print('version',page.locator('html').get_attribute('data-chesspublisher-version'))
    print('cards',page.locator('#cpNewTournamentChoiceGrid .cp-new-tournament-choice').count())
    print('default_kind',page.evaluate('cpNewTournamentKind'))
    print('swiss_selected',page.locator('#cpNewSwissChoice').evaluate("e=>e.classList.contains('cp-selected')"))
    print('create_visible',page.locator('#cpNewTournamentCreatePanel').evaluate("e=>getComputedStyle(e).display"))
    page.locator('#cpNewBakuChoice').click(); page.wait_for_timeout(100)
    print('baku_kind',page.evaluate('cpNewTournamentKind'))
    print('baku_selected',page.locator('#cpNewBakuChoice').get_attribute('aria-checked'))
    print('baku_title',page.locator('#cpNewTournamentKindTitle').inner_text())
    result=page.evaluate("""()=>{const t=cpApplyNewTournamentKind(createEmptyTournament(),'baku');return {format:t.settings.tournamentFormat,pairing:t.settings.pairingSystem,accel:t.settings.accelerationMethod,keys:t.pairings.engine.bakuGroupKeys.length}}""")
    print('baku_model',result)
    page.locator('#cpNewRoundRobinChoice').click(); page.wait_for_timeout(80)
    rr=page.evaluate("""()=>{const t=cpApplyNewTournamentKind(createEmptyTournament(),'round-robin');return {format:t.settings.tournamentFormat,pairing:t.settings.pairingSystem,accel:t.settings.accelerationMethod}}""")
    print('rr_model',rr)
    page.locator('#cpNewBakuChoice').click(); page.wait_for_timeout(80)
    page.locator('#createScreen .cp-new-tournament-window').screenshot(path=str(out))
    print('screenshot',out)
    print('pageerrors',errors[:5])
    browser.close()
