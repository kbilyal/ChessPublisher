from playwright.sync_api import sync_playwright
from pathlib import Path
r7=Path('/mnt/data/beta98_r7_work/ChessPublisher-Beta98-R7-Rating-List-Engine.js').read_text()
# Minimal DOM + API harness that exercises the exact browser module, without booting unrelated tournament subsystems.
html=f'''<!doctype html><html><head></head><body>
<div id="cpRatingListLibraryStatus"></div>
<input id="fideSearch" oninput="queueFideSearch()"><div id="fideResults"></div>
<script>
window.data={{currentTournament:'T',tournaments:{{T:{{settings:{{ratingListSequence:['fide-standard'],ratingListSequenceMode:'custom'}},players:[]}}}}}};
window.getCurrentTournament=()=>window.data.tournaments.T;
window.renderFideResults=(players)=>{{const box=document.getElementById('fideResults');box.innerHTML='';for(const p of players){{const d=document.createElement('div');d.className='fide-item';d.innerHTML='<div class="fide-name">'+p.name+'</div><div class="fide-info">'+(p.fideId||'')+'</div>';d.ondblclick=()=>window.openRatingModal?.(p);box.appendChild(d);}}}};
window.openRatingModal=(p)=>{{window.__lastOpened=p}};
window.cpBeta72RatingLists={{
  async searchDirectory(q){{window.__officialSearchCalls=(window.__officialSearchCalls||0)+1;return [{{fideId:'1503014',name:'Carlsen, Magnus',fed:'NOR',std:2839,rapid:2825,blitz:2881,birth:'1990'}},{{fideId:'9999999',name:'Unrated Test',fed:'BUL',std:0,rapid:0,blitz:0,birth:'2000'}}].filter(p=>p.name.toLowerCase().includes(String(q).toLowerCase())||p.fideId===String(q));}},
  managerSnapshot(){{return {{totalPlayers:786000,lists:{{std:{{status:'READY',period:'2026-09',count:320000}},rapid:{{status:'READY',period:'2026-09',count:280000}},blitz:{{status:'READY',period:'2026-09',count:260000}}}}}}}},
  clearDirectorySearchCache(){{}}, async updateRatingLists(){{}}
}};
window.cpBeta98={{
  async fullCatalogue(){{return [{{id:'fide-standard'}},{{id:'fide-rapid'}},{{id:'fide-blitz'}},{{id:'custom-national',label:'Bulgarian National',kind:'custom-rating-list',ratingTypeLabel:'General',recordCount:50000}}]}},
  async searchExternalPlayers(q,l,o){{window.__externalSearchCalls=(window.__externalSearchCalls||0)+1;if(!o?.allowedListIds?.includes('custom-national'))return [];return String(q).toLowerCase().includes('ivan')?[{{fideId:'9000001',name:'Ivan Petrov',fed:'BUL',std:0,rapid:0,blitz:0,__cpRatingListHits:[{{listId:'custom-national',label:'Bulgarian National',rating:2150}}]}}]:[];}},
  mergeSearchPlayers(a,b){{return [...a,...b]}},restoreSequenceFromShadow(){{return ['fide-standard']}},setSequence(t,s){{t.settings.ratingListSequence=s}},async preloadSequenceData(){{}},
  async updateCustomList(){{}},async deleteCustomList(){{}},invalidateExternalSearchIndex(){{}},refreshTypeBCatalog(){{}},openCustomManager(){{}}
}};
window.cpBeta81={{}};
</script><script>{r7}</script></body></html>'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page()
    page.set_content(html, wait_until='load', timeout=20000)
    # Focus must do no search work.
    page.locator('#fideSearch').focus(); page.wait_for_timeout(250)
    print('focus_calls', page.evaluate('[window.__officialSearchCalls||0,window.__externalSearchCalls||0]'))
    # Normal FIDE search.
    page.fill('#fideSearch','carlsen'); page.wait_for_timeout(700)
    print('fide_count', page.locator('#fideResults .fide-item').count())
    print('fide_text', page.locator('#fideResults').inner_text().replace('\n',' | '))
    # Imported list search.
    page.fill('#fideSearch','ivan'); page.wait_for_timeout(700)
    print('custom_count', page.locator('#fideResults .fide-item').count())
    print('custom_text', page.locator('#fideResults').inner_text().replace('\n',' | '))
    # Manager has official + custom and selection controls.
    page.evaluate('window.cpBeta98R7.openManager()'); page.wait_for_timeout(150)
    mgr=page.locator('#cpR7RatingListManager').inner_text()
    print('manager_sources', all(x in mgr for x in ['FIDE Player Directory','FIDE Standard','FIDE Rapid','FIDE Blitz','Bulgarian National']))
    print('search_checkboxes', page.locator('#cpR7RatingListManager input[data-r7-search]').count())
    browser.close()
