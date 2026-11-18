/* Chess-Publisher v1.06.00-beta.98-r7 — Unified Rating List Manager + non-blocking search engine
   Operational correction for the real arbiter workflow:
   - one manager for official FIDE, Type-B and Custom lists;
   - per-list search scope + sequence controls;
   - no full FIDE database clone on focus/search;
   - async FIDE directory lookup + cached, indexed imported-list lookup;
   - identity merge happens only on the bounded candidate set.
   Protected pairing/TRF/BBP/Tie-Break/Chess-Results/SYNC cores are untouched. */
(()=>{
'use strict';
const VERSION='1.06.00-beta.98-r7';
const CONFIG_KEY='ChessPublisher.RatingListEngine.SearchConfig.v1';
const OFFICIAL=[
  {id:'fide-standard',type:'std',label:'FIDE Standard',kind:'official'},
  {id:'fide-rapid',type:'rapid',label:'FIDE Rapid',kind:'official'},
  {id:'fide-blitz',type:'blitz',label:'FIDE Blitz',kind:'official'}
];
const DERIVED=[
  {id:'effective-rapid',label:'Effective Rapid',kind:'derived'},
  {id:'effective-blitz',label:'Effective Blitz',kind:'derived'}
];
let installed=false,managerSearchTimer=null,mainSearchTimer=null,searchToken=0,managerRows=[],replaceListId='',unifiedCache=new Map();
const originals={};
function txt(v){return String(v??'').trim();}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function currentTournament(){try{return window.getCurrentTournament?.()||null;}catch(_){return null;}}
function norm(v){let s=txt(v).toLowerCase();try{s=s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');}catch(_){ }try{s=s.replace(/[^\p{L}\p{N}]+/gu,' ');}catch(_){s=s.replace(/[^a-z0-9]+/g,' ');}return s.replace(/\s+/g,' ').trim();}
function exactId(v){const s=txt(v);return /^\d{5,15}$/.test(s)?s:'';}
function defaultConfig(){return {directory:true,disabledSearchIds:[],minNameChars:2,maxResults:60};}
function readConfig(){
  let c=defaultConfig();try{const raw=JSON.parse(localStorage.getItem(CONFIG_KEY)||'null');if(raw&&typeof raw==='object')c={...c,...raw};}catch(_){ }
  c.directory=c.directory!==false;c.disabledSearchIds=[...new Set((Array.isArray(c.disabledSearchIds)?c.disabledSearchIds:[]).map(x=>txt(x).toLowerCase()).filter(Boolean))];c.minNameChars=Math.max(2,Math.min(4,Number(c.minNameChars)||2));c.maxResults=Math.max(10,Math.min(60,Number(c.maxResults)||60));return c;
}
function saveConfig(c){const clean={...defaultConfig(),...c,disabledSearchIds:[...new Set((c.disabledSearchIds||[]).map(x=>txt(x).toLowerCase()).filter(Boolean))]};try{localStorage.setItem(CONFIG_KEY,JSON.stringify(clean));}catch(_){ }unifiedCache.clear();return clean;}
function searchEnabled(id,c=readConfig()){id=txt(id).toLowerCase();return !c.disabledSearchIds.includes(id);}
function setSearchEnabled(id,enabled){const c=readConfig(),set=new Set(c.disabledSearchIds);id=txt(id).toLowerCase();if(enabled)set.delete(id);else set.add(id);c.disabledSearchIds=[...set];saveConfig(c);return enabled;}
function configFingerprint(c=readConfig()){return `${c.directory?'D1':'D0'}|${c.disabledSearchIds.slice().sort().join(',')}|${c.maxResults}`;}
function cachePut(key,rows){unifiedCache.set(key,clone(rows));while(unifiedCache.size>32){const first=unifiedCache.keys().next().value;unifiedCache.delete(first);}return rows;}
async function externalCatalogue(){
  const out=[];try{const all=await window.cpBeta98?.fullCatalogue?.()||[];for(const d of all){if(!d?.id||String(d.id).startsWith('fide-')||String(d.id).startsWith('effective-'))continue;out.push(d);}}catch(_){ }
  return out;
}
function officialSnapshot(){try{return window.cpBeta72RatingLists?.managerSnapshot?.()||{lists:{},totalPlayers:0,generationId:'',updatedAt:'',verified:false};}catch(_){return {lists:{},totalPlayers:0};}}
function sequence(){try{return window.cpBeta98?.restoreSequenceFromShadow?.(currentTournament(),{persist:false})||[];}catch(_){return currentTournament()?.settings?.ratingListSequence||[];}}
async function setSequenceList(id,main=false){const t=currentTournament();if(!t){window.appAlert?.('Open a tournament before changing Rating List Sequence.','Rating List Manager','info');return false;}const cur=sequence().filter(x=>!main||x!==id),next=main?[id,...cur]:cur.includes(id)?cur:[...cur,id];window.cpBeta98?.setSequence?.(t,next,{mode:'custom',persist:true});try{await window.cpBeta98?.preloadSequenceData?.(t);}catch(_){ }return true;}
function activeExternalIds(c,cat){return cat.filter(d=>searchEnabled(d.id,c)).map(d=>String(d.id).toLowerCase());}
function officialSourceHits(p,c){const hits=[];for(const d of OFFICIAL){const rating=Math.max(0,Math.trunc(Number(p?.[d.type])||0));if(searchEnabled(d.id,c)&&rating>0)hits.push({id:d.id,label:d.label,rating,type:d.type});}return hits;}
function officialPlayerAllowed(p,c){const active=officialSourceHits(p,c);if(active.length>0)return true;const anyOfficial=Math.max(Number(p?.std)||0,Number(p?.rapid)||0,Number(p?.blitz)||0)>0;return c.directory&&!anyOfficial;}
function playerMatchesQuery(p,q){const id=exactId(q);if(id)return txt(p?.fideId)===id||txt(p?.playerId)===id;const terms=norm(q).split(' ').filter(Boolean);if(!terms.length)return false;const tokens=norm(`${p?.name||''} ${p?.fed||''} ${p?.fideId||''} ${p?.playerId||''}`).split(' ').filter(Boolean);return terms.every(term=>tokens.some(token=>token.startsWith(term)));}
function scorePlayer(p,q){
  const id=exactId(q),pid=txt(p?.fideId),name=norm(p?.name),nq=norm(q),terms=nq.split(' ').filter(Boolean);let score=0;
  if(id&&pid===id)score+=1000000;if(name===nq)score+=200000;if(name.startsWith(nq))score+=100000;
  const tokens=name.split(' ');for(const t of terms){if(tokens.some(x=>x===t))score+=30000;else if(tokens.some(x=>x.startsWith(t)))score+=12000;}
  score+=Math.max(Number(p?.std)||0,Number(p?.rapid)||0,Number(p?.blitz)||0);
  return score;
}
function mergePlayers(official,external){try{return window.cpBeta98?.mergeSearchPlayers?.(official,external)||[...(official||[]),...(external||[])];}catch(_){return [...(official||[]),...(external||[])];}}
async function unifiedSearch(query,limit=60,{token=0}={}){
  const q=txt(query),c=readConfig(),nameQ=norm(q),id=exactId(q);if(!id&&nameQ.length<c.minNameChars)return [];
  const cat=await externalCatalogue(),extIds=activeExternalIds(c,cat),key=`${configFingerprint(c)}|${nameQ}|${limit}`;
  if(unifiedCache.has(key))return clone(unifiedCache.get(key));
  const officialWanted=c.directory||OFFICIAL.some(d=>searchEnabled(d.id,c));
  const officialPromise=officialWanted&&window.cpBeta72RatingLists?.searchDirectory?window.cpBeta72RatingLists.searchDirectory(q,Math.min(60,limit),{requestId:0}):Promise.resolve([]);
  const externalPromise=extIds.length&&window.cpBeta98?.searchExternalPlayers?window.cpBeta98.searchExternalPlayers(q,Math.min(60,limit),{allowedListIds:extIds}):Promise.resolve([]);
  const [officialRaw,external]=await Promise.all([officialPromise,externalPromise]);if(token&&token!==searchToken)return [];
  const official=(officialRaw||[]).filter(p=>playerMatchesQuery(p,q)&&officialPlayerAllowed(p,c)).map(p=>{const x={...p};x.__cpOfficialRatingHits=officialSourceHits(x,c);return x;});
  const merged=mergePlayers(official,external||[]);for(const p of merged){p.__cpOfficialRatingHits=officialSourceHits(p,c);}
  merged.sort((a,b)=>scorePlayer(b,q)-scorePlayer(a,q)||String(a.name||'').localeCompare(String(b.name||'')));
  return cachePut(key,merged.slice(0,Math.max(1,Math.min(60,limit))));
}
function baseRender(){let fn=window.renderFideResults;while(fn&&fn.__cpQ117R2Original)fn=fn.__cpQ117R2Original;return typeof fn==='function'?fn:window.renderFideResults;}
function decorateUnifiedResults(players){
  try{const box=document.getElementById('fideResults'),items=[...box.querySelectorAll('.fide-item')];(players||[]).forEach((p,i)=>{const item=items[i];if(!item)return;const official=Array.isArray(p.__cpOfficialRatingHits)?p.__cpOfficialRatingHits:[],external=Array.isArray(p.__cpRatingListHits)?p.__cpRatingListHits:[],sources=[...official.map(h=>`${h.label}: ${h.rating}`),...external.slice(0,4).map(h=>`${h.label}: ${h.rating}`)];if(sources.length){const old=item.querySelector('.cp-r7-rating-sources');if(old)old.remove();const d=document.createElement('div');d.className='fide-info cp-r7-rating-sources';d.textContent=`Rating sources: ${sources.join(' • ')}`;item.appendChild(d);}});}catch(_){ }
}
function renderUnifiedResults(players){const fn=baseRender();if(typeof fn==='function')fn.call(window,players||[]);decorateUnifiedResults(players||[]);}
function renderSearchMessage(textValue){const box=document.getElementById('fideResults');if(box)box.innerHTML=`<div class="help" style="padding:8px">${esc(textValue)}</div>`;}
function queueUnifiedSearch(){
  if(mainSearchTimer){clearTimeout(mainSearchTimer);mainSearchTimer=null;}const input=document.getElementById('fideSearch'),q=txt(input?.value),c=readConfig(),id=exactId(q),normalized=norm(q);const token=++searchToken;
  if(!id&&normalized.length<c.minNameChars){renderUnifiedResults([]);return token;}
  const delay=id?80:(normalized.length===2?360:220);renderSearchMessage('Searching selected rating lists…');
  mainSearchTimer=setTimeout(async()=>{try{const rows=await unifiedSearch(q,c.maxResults,{token});if(token!==searchToken||txt(input?.value)!==q)return;renderUnifiedResults(rows);if(!rows.length)renderSearchMessage('No player found in the selected searchable rating lists.');}catch(err){console.warn('Unified rating-list search failed:',err);if(token===searchToken)renderSearchMessage('Rating-list search could not be completed.');}},delay);return token;
}
function managerModal(){
  let m=document.getElementById('cpR7RatingListManager');if(m)return m;m=document.createElement('div');m.id='cpR7RatingListManager';m.className='modal-overlay';m.style.display='none';
  m.innerHTML=`<div class="modal-window" style="width:min(1100px,97vw);max-height:92vh"><div class="modal-titlebar">Rating List Manager</div><div class="modal-body" style="overflow:auto"><div class="help"><b>One place for all rating sources.</b> “Search” controls which lists participate in Add Player lookup. “Set Main / Add to Sequence” controls Tournament Rating resolution. Importing a list never adds tournament participants.</div><div id="cpR7OfficialLists" class="groupbox" style="margin-top:8px"><div class="group-title">Official FIDE sources</div></div><div id="cpR7ImportedLists" class="groupbox" style="margin-top:8px"><div class="group-title">Imported Rating Lists</div></div><div class="groupbox" style="margin-top:8px"><div class="group-title">Search players in selected lists</div><div style="display:flex;gap:6px;align-items:center"><input id="cpR7ManagerSearch" class="wide" placeholder="Name or FIDE / Player ID — search starts after typing"><button id="cpR7ManagerSearchBtn" type="button">Search</button></div><div id="cpR7ManagerSearchStatus" class="help" style="margin-top:5px">Clicking/focusing this field does not load or scan any rating list.</div><div id="cpR7ManagerResults" style="margin-top:6px"></div></div><input id="cpR7ReplaceFile" type="file" accept=".csv,.tsv,.txt,.lst,text/plain" class="hidden"></div><div class="modal-bottom"><button id="cpR7UpdateFide" type="button">Update FIDE Rating Lists</button><span style="flex:1"></span><button id="cpR7ManagerClose" type="button">Close</button></div></div>`;
  document.body.appendChild(m);m.querySelector('#cpR7ManagerClose')?.addEventListener('click',()=>{m.style.display='none';});m.querySelector('#cpR7UpdateFide')?.addEventListener('click',async()=>{try{await window.cpBeta72RatingLists?.updateRatingLists?.({manual:true});unifiedCache.clear();await renderManager();}catch(err){window.appAlert?.(String(err?.message||err),'Rating List Manager','warning');}});m.querySelector('#cpR7ManagerSearchBtn')?.addEventListener('click',managerSearch);m.querySelector('#cpR7ManagerSearch')?.addEventListener('input',()=>{if(managerSearchTimer)clearTimeout(managerSearchTimer);const q=txt(m.querySelector('#cpR7ManagerSearch')?.value);if(q.length<2){renderManagerResults([],'Type at least 2 characters.');return;}managerSearchTimer=setTimeout(managerSearch,300);});m.querySelector('#cpR7OfficialLists')?.addEventListener('click',managerAction);m.querySelector('#cpR7ImportedLists')?.addEventListener('click',managerAction);m.querySelector('#cpR7OfficialLists')?.addEventListener('change',managerToggle);m.querySelector('#cpR7ImportedLists')?.addEventListener('change',managerToggle);m.querySelector('#cpR7ManagerResults')?.addEventListener('click',managerResultAction);m.querySelector('#cpR7ReplaceFile')?.addEventListener('change',replaceImportedData);return m;
}
function rowHtml({id,label,status='',detail='',searchable=true,sequenceable=true,replaceable=false,deletable=false,directory=false},c,seq){
  const checked=directory?c.directory:searchEnabled(id,c),inSeq=seq.includes(id),main=seq[0]===id;
  const searchControl=searchable?`<label style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" data-r7-search="${esc(id)}" ${checked?'checked':''}> Search</label>`:'<span class="help">Sequence only</span>';
  return `<div class="cp-rating-sequence-row cp-r7-list-row" data-list-id="${esc(id)}" style="align-items:center"><span style="min-width:260px"><b>${esc(label)}</b> ${status?`<span class="badge">${esc(status)}</span>`:''}<br><span class="help">${esc(detail)}</span></span><span class="cp-rating-sequence-actions" style="align-items:center">${searchControl}${sequenceable?`<button data-r7-action="main" data-id="${esc(id)}" ${main?'disabled':''}>${main?'Main':'Set Main'}</button><button data-r7-action="add" data-id="${esc(id)}" ${inSeq?'disabled':''}>${inSeq?'In Sequence':'Add to Sequence'}</button>`:''}${replaceable?`<button data-r7-action="replace" data-id="${esc(id)}">Replace Data</button>`:''}${deletable?`<button data-r7-action="delete" data-id="${esc(id)}">Delete</button>`:''}</span></div>`;
}
async function renderManager(){
  const m=managerModal(),c=readConfig(),seq=sequence(),snap=officialSnapshot(),off=m.querySelector('#cpR7OfficialLists'),imp=m.querySelector('#cpR7ImportedLists');
  const dirDetail=`Include unrated FIDE identities in search · rated players are controlled by the Standard / Rapid / Blitz Search checkboxes · ${Number(snap.totalPlayers||0).toLocaleString('en-US')} locally indexed identities/ratings available`;
  let html=rowHtml({id:'fide-directory',label:'FIDE Player Directory',status:'Identity',detail:dirDetail,sequenceable:false,directory:true},c,seq);
  for(const d of OFFICIAL){const st=snap.lists?.[d.type]||{};html+=rowHtml({id:d.id,label:d.label,status:st.status||'NOT LOADED',detail:`Official Type-A · period ${st.period||'—'} · ${Number(st.count||0).toLocaleString('en-US')} rated players`,sequenceable:true},c,seq);}for(const d of DERIVED)html+=rowHtml({id:d.id,label:d.label,status:'Derived',detail:'Sequence source; uses FIDE Standard fallback according to existing rating rules.',searchable:false,sequenceable:true},c,seq);off.innerHTML='<div class="group-title">Official FIDE sources</div>'+html;
  const cat=await externalCatalogue();if(!cat.length)imp.innerHTML='<div class="group-title">Imported Rating Lists</div><div class="help">No Custom or Type-B lists installed. Use Import Rating List… in Lists & Players.</div>';else{let x='<div class="group-title">Imported Rating Lists</div>';for(const d of cat){const kind=d.kind==='type-b-rating-list'?'Type-B':'Custom',replaceable=d.kind!=='type-b-rating-list';x+=rowHtml({id:d.id,label:d.label,status:kind,detail:`${d.ratingTypeLabel||d.ratingType||'General'} · ${Number(d.recordCount||0).toLocaleString('en-US')} players · ${d.id}`,sequenceable:true,replaceable,deletable:true},c,seq);}imp.innerHTML=x;}updateHomeStatus();return true;
}
async function openManager(){await renderManager();managerModal().style.display='flex';return true;}
function managerToggle(event){const el=event.target?.closest?.('input[data-r7-search]');if(!el)return;const id=txt(el.dataset.r7Search).toLowerCase(),c=readConfig();if(id==='fide-directory'){c.directory=!!el.checked;saveConfig(c);}else setSearchEnabled(id,!!el.checked);updateHomeStatus();}
async function managerAction(event){const b=event.target?.closest?.('button[data-r7-action]');if(!b)return;const action=b.dataset.r7Action,id=txt(b.dataset.id).toLowerCase();if(action==='main'||action==='add'){await setSequenceList(id,action==='main');await renderManager();return;}if(action==='replace'){replaceListId=id;managerModal().querySelector('#cpR7ReplaceFile')?.click();return;}if(action==='delete'){let ok=true;if(typeof window.appConfirm==='function')ok=await window.appConfirm(`Delete rating list “${id}” from the local library? Existing tournament player provenance is preserved.`, 'Rating List Manager','question');if(!ok)return;try{const d=(await externalCatalogue()).find(x=>x.id===id);if(d?.kind==='type-b-rating-list')await window.cpBeta81?.deleteList?.(id);else await window.cpBeta98?.deleteCustomList?.(id);setSearchEnabled(id,true);window.cpBeta98?.invalidateExternalSearchIndex?.();unifiedCache.clear();await renderManager();}catch(err){window.appAlert?.(String(err?.message||err),'Rating List Manager','warning');}}
}
async function replaceImportedData(event){const file=event.target?.files?.[0],id=replaceListId;replaceListId='';event.target.value='';if(!file||!id)return;try{const d=await window.cpBeta98?.updateCustomList?.(id,{text:await file.text(),fileName:file.name});window.cpBeta98?.invalidateExternalSearchIndex?.();unifiedCache.clear();window.appAlert?.(`Updated ${d?.label||id}: ${Number(d?.recordCount||0).toLocaleString('en-US')} records. Stable ID preserved.`,'Rating List Manager','info');await renderManager();}catch(err){window.appAlert?.(String(err?.message||err),'Rating List Manager','warning');}}
function sourceSummary(p){const official=(p.__cpOfficialRatingHits||[]).map(h=>`${h.label} ${h.rating}`),ext=(p.__cpRatingListHits||[]).map(h=>`${h.label} ${h.rating}`);return [...official,...ext].join(' • ')||'FIDE identity only / no enabled rating source';}
function renderManagerResults(rows,status=''){
  managerRows=rows||[];const m=managerModal(),out=m.querySelector('#cpR7ManagerResults'),st=m.querySelector('#cpR7ManagerSearchStatus');if(st)st.textContent=status||(managerRows.length?`${managerRows.length} matching player(s).`:'No matching player.');if(!managerRows.length){out.innerHTML='';return;}out.innerHTML=managerRows.map((p,i)=>`<div class="cp-custom-lookup-row"><span><b>${esc(p.name||p.fideId||p.playerId)}</b> · ${esc(p.fed||'-')} · ID ${esc(p.fideId||p.playerId||'-')}<br><span class="help">${esc(sourceSummary(p))}</span></span><button type="button" data-r7-add-player="${i}">Add Player</button></div>`).join('');
}
async function managerSearch(){const m=managerModal(),q=txt(m.querySelector('#cpR7ManagerSearch')?.value),c=readConfig();if(!exactId(q)&&norm(q).length<c.minNameChars){renderManagerResults([],'Type at least 2 characters.');return;}renderManagerResults([],'Searching selected rating lists…');const token=++searchToken;try{const rows=await unifiedSearch(q,c.maxResults,{token});if(token!==searchToken)return;renderManagerResults(rows);}catch(err){renderManagerResults([],`Search failed: ${String(err?.message||err)}`);}}
function managerResultAction(event){const b=event.target?.closest?.('button[data-r7-add-player]');if(!b)return;const p=managerRows[Number(b.dataset.r7AddPlayer)];if(p)window.openRatingModal?.(p);}
function updateHomeStatus(){try{const c=readConfig(),el=document.getElementById('cpRatingListLibraryStatus');if(!el)return;externalCatalogue().then(cat=>{const enabled=cat.filter(d=>searchEnabled(d.id,c)).length,off=OFFICIAL.filter(d=>searchEnabled(d.id,c)).length;el.textContent=`Search sources: FIDE ${off}/3${c.directory?' + Directory':''} · Imported ${enabled}/${cat.length}`;}).catch(()=>{});}catch(_){ }}
function installManagerOverride(){if(!window.cpBeta98)return false;if(!originals.openCustomManager)originals.openCustomManager=window.cpBeta98.openCustomManager;window.cpBeta98.openCustomManager=openManager;return true;}
function installSearchOverride(){
  if(!originals.queueFideSearch)originals.queueFideSearch=window.queueFideSearch;window.queueFideSearch=queueUnifiedSearch;
  const input=document.getElementById('fideSearch');if(input){input.placeholder='Search player — selected FIDE + imported rating lists';input.title='Search begins only after typing. Clicking/focusing this field performs no database scan.';}
  return true;
}
function wrapLibraryMutations(){
  const api=window.cpBeta98;if(api&&!api.__cpR7MutationWrapped){for(const name of ['importCustomList','updateCustomList','deleteCustomList']){const original=api[name];if(typeof original!=='function')continue;api[name]=async function(){const r=await original.apply(this,arguments);unifiedCache.clear();updateHomeStatus();return r;};}api.__cpR7MutationWrapped=true;}
  const b=window.cpBeta81;if(b&&!b.__cpR7MutationWrapped){for(const name of ['importTypeB','importOfficialAsTypeB','deleteList']){const original=b[name];if(typeof original!=='function')continue;b[name]=async function(){const r=await original.apply(this,arguments);try{window.cpBeta98?.refreshTypeBCatalog?.({force:true});window.cpBeta98?.invalidateExternalSearchIndex?.();}catch(_){ }unifiedCache.clear();updateHomeStatus();return r;};}b.__cpR7MutationWrapped=true;}
  return true;
}
function installStyles(){if(document.getElementById('cp-r7-rating-engine-style'))return;const s=document.createElement('style');s.id='cp-r7-rating-engine-style';s.textContent='.cp-r7-list-row{border-bottom:1px solid rgba(0,0,0,.08);padding:6px 0}.cp-r7-list-row:last-child{border-bottom:0}.cp-r7-rating-sources{font-weight:600}.cp-r7-list-row input[type=checkbox]{width:auto}';document.head.appendChild(s);}
function install(){if(installed)return true;installed=true;installStyles();wrapLibraryMutations();installManagerOverride();installSearchOverride();updateHomeStatus();try{window.cpBeta72RatingLists?.clearDirectorySearchCache?.();}catch(_){ }try{document.documentElement.dataset.chesspublisherVersion=VERSION;document.title=`Chess-Publisher v${VERSION}`;const w=document.getElementById('windowDocumentTitle');if(w)w.textContent=`Chess-Publisher v${VERSION} — Tournament Manager & Publisher`;const v=document.getElementById('appVersion');if(v)v.textContent=`v${VERSION}`;}catch(_){ }return true;}
window.cpBeta98R7={VERSION,CONFIG_KEY,readConfig,saveConfig,searchEnabled,setSearchEnabled,externalCatalogue,officialSnapshot,unifiedSearch,queueUnifiedSearch,openManager,renderManager,updateHomeStatus,install};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
