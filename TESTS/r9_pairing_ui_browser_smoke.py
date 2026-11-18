from playwright.sync_api import sync_playwright
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'ChessPublisher.html').read_text(encoding='utf-8')
out=ROOT/'BETA98-R9-PAIRING-UI-BAKU.png'
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={"width":1440,"height":900})
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(html, wait_until='load', timeout=30000)
    page.wait_for_timeout(1000)
    # Install a controlled Baku tournament directly in the existing app model.
    result=page.evaluate("""()=>{
      const t=cpApplyNewTournamentKind(createEmptyTournament(),'baku');
      t.settings.name='R9 Baku UI Test';
      t.settings.rounds='7';
      data.tournaments=data.tournaments||{};
      data.tournaments['R9 Baku UI Test']=t;
      data.currentTournament='R9 Baku UI Test';
      normalizeData();
      loadAllFields();
      cpBeta98R9.ensureAccelerationControl();
      cpBeta98R9.syncAccelerationUi();
      return {pairing:t.settings.pairingSystem,accel:t.settings.accelerationMethod,rounds:t.settings.rounds};
    }""")
    page.wait_for_timeout(150)
    page.evaluate("showTab('main',document.getElementById('tabMain'))")
    page.wait_for_timeout(120)
    print('version',page.locator('html').get_attribute('data-chesspublisher-version'))
    print('model',result)
    print('pairing_value',page.locator('#pairingSystem').input_value())
    print('accel_value',page.locator('#cpAccelerationMethod').input_value())
    print('accel_badge',page.locator('#cpR9AccelerationBadge').inner_text())
    print('accel_disabled',page.locator('#cpAccelerationMethod').is_disabled())
    # Validate the pairing result palette polish and dynamic busy button without calling protected pairing logic.
    page.evaluate("showTab('pairings',document.getElementById('tabPairings'))")
    page.wait_for_timeout(100)
    print('pairing_heading',page.locator('#cpR9PairingActionsHeading').inner_text())
    print('resort_text',page.locator('#pairingsResortStartingListBtn').inner_text())
    print('actions_columns',page.locator('#pairings .pairing-generate-actions').evaluate("e=>getComputedStyle(e).gridTemplateColumns"))
    page.evaluate("cpBeta98R9.setPairingBusyState(true,1)")
    page.wait_for_timeout(450)
    print('busy_text',page.locator('#btnGenerateGacrux').inner_text())
    print('busy_aria',page.locator('#btnGenerateGacrux').get_attribute('aria-busy'))
    print('busy_class',page.locator('#btnGenerateGacrux').evaluate("e=>e.classList.contains('cp-pairing-busy')"))
    page.evaluate("cpBeta98R9.setPairingBusyState(false,1)")
    page.wait_for_timeout(80)
    print('idle_text',page.locator('#btnGenerateGacrux').inner_text())
    # Screenshot setup because the reported defect was Baku visibility.
    page.evaluate("showTab('main',document.getElementById('tabMain')); const cs=document.getElementById('createScreen'); if(cs) cs.style.display='none';")
    page.wait_for_timeout(120)
    page.locator('#main').screenshot(path=str(out))
    print('screenshot',out)
    print('pageerrors',errors[:5])
    browser.close()
