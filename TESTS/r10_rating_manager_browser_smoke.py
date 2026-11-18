from playwright.sync_api import sync_playwright
from pathlib import Path
html=Path('/mnt/data/beta98_r10_work/ChessPublisher.html').read_text(encoding='utf-8')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={"width":1500,"height":1000})
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(html, wait_until='load', timeout=30000)
    page.wait_for_timeout(1200)
    print('version', page.locator('html').get_attribute('data-chesspublisher-version'))
    print('r10api', page.evaluate("typeof window.cpBeta98R10==='object'"))
    page.evaluate("""
      window.getCurrentTournament=()=>({settings:{tournamentRatingType:'Rapid'},players:[]});
      window.cpBeta72RatingLists.managerSnapshot=()=>({totalPlayers:785986,lists:{std:{status:'READY',period:'2026-09',count:566829},rapid:{status:'READY',period:'2026-09',count:473538},blitz:{status:'READY',period:'2026-09',count:314681}}});
      window.cpBeta98.fullCatalogue=async()=>[
        {id:'custom-national',label:'National Test',kind:'custom-rating-list',ratingTypeLabel:'General / Tournament',recordCount:11},
        {id:'type-b-regional',label:'Regional Type-B',kind:'type-b-rating-list',ratingTypeLabel:'General / Tournament',recordCount:8}
      ];
    """)
    page.evaluate("window.cpBeta98R10.openManager()")
    page.wait_for_timeout(200)
    mgr=page.locator('#cpR10RatingListManager')
    txt=mgr.inner_text()
    print('visible', mgr.evaluate("e=>getComputedStyle(e).display"))
    print('main_rapid', 'Main tournament rating source: FIDE Rapid' in txt)
    print('no_effective', 'Effective Rapid' not in txt and 'Effective Blitz' not in txt)
    print('no_manual_priority', 'Set Main' not in txt and 'Add to Sequence' not in txt and 'Rating Priority' not in txt)
    print('official_rows', all(x in txt for x in ['FIDE Player Directory','FIDE Standard','FIDE Rapid','FIDE Blitz']))
    print('imported_rows', all(x in txt for x in ['National Test','Regional Type-B']))
    # focus alone must not call search
    page.evaluate("window.__r10SearchCalls=0; window.cpBeta98R7.unifiedSearch=async()=>{window.__r10SearchCalls++; return [{fideId:'1503014',name:'Carlsen, Magnus',fed:'NOR',std:2839,rapid:2825,blitz:2881,__cpOfficialRatingHits:[{label:'FIDE Rapid',rating:2825}]}];};")
    baseline=page.evaluate('window.__r10SearchCalls')
    page.locator('#cpR10ManagerSearch').focus(); page.wait_for_timeout(350)
    print('focus_delta', page.evaluate('window.__r10SearchCalls')-baseline)
    page.fill('#cpR10ManagerSearch','c'); page.wait_for_timeout(350)
    print('onechar_delta', page.evaluate('window.__r10SearchCalls')-baseline)
    page.fill('#cpR10ManagerSearch','carlsen'); page.wait_for_timeout(500)
    print('search_calls', page.evaluate('window.__r10SearchCalls'))
    print('search_result', 'Carlsen, Magnus' in page.locator('#cpR10ManagerResults').inner_text())
    # Add Player modal simplification can be tested directly without participant mutation.
    page.evaluate("""
      const body=document.querySelector('#ratingModal .modal-body');
      const row=document.createElement('div');row.id='ratingSequenceRow';row.className='rating-row';row.textContent='Rating List Sequence';body.appendChild(row);
      window.cpBeta98R10.simplifyAddPlayerModal();
    """)
    print('sequence_removed', page.locator('#ratingSequenceRow').count()==0)
    print('rapid_label', page.locator('#ratingRapidRadio').locator('xpath=..').locator('label').inner_text())
    print('blitz_label', page.locator('#ratingBlitzRadio').locator('xpath=..').locator('label').inner_text())
    print('note', page.locator('#cpR10RatingChoiceNote').inner_text())
    # screenshot evidence
    page.screenshot(path='/mnt/data/BETA98-R10-RATING-LIST-MANAGER.png', full_page=True)
    print('pageerrors', errors[:5])
    browser.close()
