from playwright.sync_api import sync_playwright
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'ChessPublisher.html').read_text(encoding='utf-8')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={"width":1440,"height":900})
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_content(html,wait_until='domcontentloaded',timeout=90000)
    page.wait_for_timeout(900)
    page.evaluate("""()=>{
      const t=createEmptyTournament();
      t.settings.name='R12 Late Entry Double Click';
      t.settings.format='Individual Swiss';
      t.settings.tournamentFormat='Individual Swiss';
      t.settings.pairingSystem='FIDE Dutch System';
      t.settings.rounds='7';
      t.settings.tournamentRatingType='Rapid';
      t.players=[
        {name:'Player One',rating:2100,fed:'BUL',fideId:'9900001',birth:'1990',gender:'m',attendance:'present',localKey:'p1',joinedFromRound:1,pairingNumber:1},
        {name:'Player Two',rating:2000,fed:'BUL',fideId:'9900002',birth:'1991',gender:'m',attendance:'present',localKey:'p2',joinedFromRound:1,pairingNumber:2}
      ];
      t.pairings=t.pairings||{};t.pairings.liveBoards={'1':[{board:1,whiteKey:'p1',blackKey:'p2',result:'1:0'}]};t.pairings.engine=t.pairings.engine||{};
      data.tournaments=data.tournaments||{};data.tournaments[t.settings.name]=t;data.currentTournament=t.settings.name;
      normalizeData();loadAllFields();showTab('registration',document.getElementById('tabRegistration'));
      const cs=document.getElementById('createScreen');if(cs)cs.style.display='none';
      window.__r12Confirms=[];window.__r12Alerts=[];
      window.appConfirm=async(msg,title)=>{window.__r12Confirms.push({msg,title});return true;};
      window.appAlert=async(msg,title)=>{window.__r12Alerts.push({msg,title});return true;};
      window.cpPersistCriticalMutation=async()=>true;
      cpBeta98R12.hideLegacyLateBar();
      const src={name:'Late Test Player',fed:'BUL',fideId:'9900011',birth:'1994',gender:'m',std:1800,rapid:1910,blitz:1750,title:''};
      cpBeta98R7.unifiedSearch=async()=>[src];document.getElementById('fideSearch').value='late test player';
      renderFideResults([{name:'Late Test Player',fed:'BUL',fideId:'9900011',birth:'1994',gender:'m',std:1800,rapid:1910,blitz:1750,title:''}]);
    }""")
    page.wait_for_timeout(120)
    bar_display=page.locator('#cpR11LateEntryBar').evaluate("e=>getComputedStyle(e).display") if page.locator('#cpR11LateEntryBar').count() else 'missing'
    before=page.evaluate("getCurrentTournament().players.length")
    page.locator('#fideResults .fide-item').dblclick()
    page.wait_for_timeout(450)
    after=page.evaluate("getCurrentTournament().players.length")
    added=page.evaluate("""()=>{const t=getCurrentTournament(),p=t.players[t.players.length-1];return {name:p.name,rating:p.rating,join:getPlayerJoinRound(p),attendance:getPlayerAttendance(p),needsResort:!!t.pairings.engine.needsResort,confirms:window.__r12Confirms,alerts:window.__r12Alerts,modal:document.getElementById('ratingModal').style.display};}""")
    print('version',page.locator('html').get_attribute('data-chesspublisher-version'))
    print('bar_display',bar_display)
    print('counts',before,after)
    print('added',added)
    # cancellation path
    page.evaluate("""()=>{window.appConfirm=async(msg,title)=>{window.__r12Confirms.push({msg,title,cancel:true});return false;};const src={name:'Cancel Late Player',fed:'BUL',fideId:'9900012',birth:'1995',gender:'m',std:1700,rapid:1710,blitz:1650,title:''};cpBeta98R7.unifiedSearch=async()=>[src];document.getElementById('fideSearch').value='cancel late player';renderFideResults([{name:'Cancel Late Player',fed:'BUL',fideId:'9900012',birth:'1995',gender:'m',std:1700,rapid:1710,blitz:1650,title:''}]);}""")
    before_cancel=page.evaluate("getCurrentTournament().players.length")
    page.locator('#fideResults .fide-item').dblclick();page.wait_for_timeout(220)
    after_cancel=page.evaluate("getCurrentTournament().players.length")
    print('cancel_counts',before_cancel,after_cancel)
    print('pageerrors',errors[:5])
    assert bar_display=='none'
    assert after==before+1
    assert added['name']=='Late Test Player'
    assert added['rating']==1910
    assert added['join']==2
    assert added['attendance']=='present'
    assert added['needsResort'] is True
    assert len(added['confirms'])>=1 and ('0 точки' in added['confirms'][0]['msg'] or '0 points' in added['confirms'][0]['msg'])
    assert after_cancel==before_cancel
    assert not errors
    browser.close()
