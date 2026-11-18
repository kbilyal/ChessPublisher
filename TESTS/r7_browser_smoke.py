from playwright.sync_api import sync_playwright
from pathlib import Path
html=Path('/mnt/data/beta98_r7_work/ChessPublisher.html').read_text(encoding='utf-8')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page()
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(html, wait_until='load', timeout=30000)
    page.wait_for_timeout(1500)
    print('version', page.locator('html').get_attribute('data-chesspublisher-version'))
    print('r7api', page.evaluate("typeof window.cpBeta98R7==='object'"))
    print('queue', page.evaluate("window.queueFideSearch===window.cpBeta98R7?.queueUnifiedSearch"))
    # no focus search side effects: token should not change when focus field only
    before=page.evaluate("window.cpBeta98R7?1:0")
    page.locator('#fideSearch').focus()
    page.wait_for_timeout(250)
    print('focused', page.evaluate("document.activeElement?.id"))
    # Inject bounded search stubs to exercise actual Add Player field and manager UI
    page.evaluate("""
      window.cpBeta72RatingLists.searchDirectory=async(q)=>[
        {fideId:'1503014',name:'Carlsen, Magnus',fed:'NOR',std:2839,rapid:2825,blitz:2881,birth:'1990'}
      ];
      const oldFull=window.cpBeta98.fullCatalogue;
      const oldExt=window.cpBeta98.searchExternalPlayers;
      window.cpBeta98.fullCatalogue=async()=>[
        {id:'fide-standard'},{id:'fide-rapid'},{id:'fide-blitz'},
        {id:'custom-national',label:'National Test',kind:'custom-rating-list',ratingTypeLabel:'General',recordCount:2}
      ];
      window.cpBeta98.searchExternalPlayers=async(q,l,o)=> o?.allowedListIds?.includes('custom-national') ? [
        {fideId:'1503014',name:'Carlsen, Magnus',fed:'NOR',std:2839,rapid:2825,blitz:2881,__cpRatingListHits:[{listId:'custom-national',label:'National Test',rating:2900}]}
      ] : [];
    """)
    page.fill('#fideSearch','carlsen')
    page.wait_for_timeout(900)
    items=page.locator('#fideResults .fide-item').count()
    text=page.locator('#fideResults').inner_text()
    print('items',items)
    print('searchtext',text[:400].replace('\n',' | '))
    # Open real unified manager via public API
    page.evaluate("window.cpBeta98R7.openManager()")
    page.wait_for_timeout(300)
    print('manager_visible', page.locator('#cpR7RatingListManager').evaluate("e=>getComputedStyle(e).display"))
    mgr=page.locator('#cpR7RatingListManager').inner_text()
    print('has_official', all(x in mgr for x in ['FIDE Standard','FIDE Rapid','FIDE Blitz','FIDE Player Directory','National Test']))
    print('pageerrors', errors[:5])
    browser.close()
