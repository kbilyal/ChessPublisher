/* Chess-Publisher v1.06.00-beta.98-r5 — FIDE TEC Q117 Custom Rating Lists operational model */
(()=>{
'use strict';
const VERSION='1.06.00-beta.98-r5';
const SCHEMA=2;
const KIND='custom-rating-list';
const TYPE_B_KIND='type-b-rating-list';
const CLASS='Type-B';
const CATALOG_KEY='rating-lists:custom:catalog:v2';
const DATA_PREFIX='rating-lists:custom:data:v2:';
const CATALOG_LS_KEY='ChessPublisher.CustomRatingLists.Catalog.v2';
const LEGACY_LISTS_KEY='customRatingListsV1';
const LEGACY_DATA_KEY='customRatingListDataV1';
const REFS_KEY='ratingListLibraryRefsV2';
const SEQUENCE_SHADOW_KEY='q117RatingListSequenceV1';
const MIGRATION_KEY='customRatingLibraryMigrationV2';
const CATEGORIES=['national','regional','club','historical','other'];
const CATEGORY_LABELS={national:'National',regional:'Regional',club:'Club',historical:'Historical',other:'Other'};
const RATING_TYPES=['general','std','rapid','blitz'];
const RATING_LABELS={general:'General / Tournament',std:'Standard',rapid:'Rapid',blitz:'Blitz'};
const OFFICIAL_LABELS={
  'fide-standard':'FIDE Standard','fide-rapid':'FIDE Rapid','fide-blitz':'FIDE Blitz',
  'effective-rapid':'Effective Rapid','effective-blitz':'Effective Blitz'
};
let installed=false,libraryLoaded=false,typeBCatalogLoaded=false,sequenceDraft=[],lastPendingPlayer=null,lastEditingIndex=null,pendingReplaceId='',pendingInstallRefId='';
let uiSearchToken=0,uiSearchTimer=null,uiSearchQuery='',uiSearchExternal=[],uiSearchBase=[],uiSearchBaseQuery='';
let memoryCatalog=[],typeBCatalog=[];
const memoryData=new Map(),typeBData=new Map(),originals={};
let externalSearchIndexVersion=1,externalSearchIndexBuiltVersion=0,externalSearchIndexPromise=null,externalSearchEntries=[],externalSearchBuckets2=new Map(),externalSearchBuckets3=new Map();
function invalidateExternalSearchIndex(){externalSearchIndexVersion++;externalSearchIndexBuiltVersion=0;externalSearchIndexPromise=null;return externalSearchIndexVersion;}
function nowIso(){return new Date().toISOString();}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function text(v){return String(v??'').trim();}
function n(v){const x=Math.trunc(Number(v)||0);return Math.max(0,Math.min(4000,x));}
function currentTournament(){try{return window.getCurrentTournament?.()||null;}catch(_){return null;}}
function allTournaments(){try{return Object.values(window.data?.tournaments||{}).filter(Boolean);}catch(_){return [];}}
function slug(v){const s=text(v).toLowerCase();let normalized=s;try{normalized=s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');}catch(_){ }return normalized.replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,42)||'list';}
function stableId(label='custom'){
  let token='';try{token=window.crypto?.randomUUID?.()||'';}catch(_){ }
  if(!token)token=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
  return `custom-${slug(label)}-${token}`.slice(0,118);
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function category(v){const x=text(v).toLowerCase();return CATEGORIES.includes(x)?x:'other';}
function ratingType(v){const x=text(v).toLowerCase();return RATING_TYPES.includes(x)?x:'general';}
function normalizeGender(v){const x=text(v).toLowerCase();if(x==='m'||x==='male')return 'm';if(x==='f'||x==='female'||x==='w'||x==='woman')return 'f';return '';}
function validFideId(v){return /^\d{5,15}$/.test(text(v));}
function identityKey(value){
  if(value&&typeof value==='object'){
    const fid=text(value.fideId);if(validFideId(fid))return fid;
    return text(value.playerId||value.customPlayerId||value.id);
  }
  return text(value);
}
function normalizeBirth(v){
  const raw=text(v);if(!raw||raw==='-')return '-';
  if(/^(?:19\d{2}|20[0-3]\d)$/.test(raw))return raw;
  let m=raw.match(/^((?:19|20)\d{2})[-./](\d{1,2})[-./](\d{1,2})$/);
  if(m){const y=m[1],mo=String(Number(m[2])).padStart(2,'0'),d=String(Number(m[3])).padStart(2,'0');if(validCalendarDate(y,mo,d))return `${y}-${mo}-${d}`;}
  m=raw.match(/^(\d{1,2})[-./](\d{1,2})[-./]((?:19|20)\d{2})$/);
  if(m){const y=m[3],mo=String(Number(m[2])).padStart(2,'0'),d=String(Number(m[1])).padStart(2,'0');if(validCalendarDate(y,mo,d))return `${y}-${mo}-${d}`;}
  return raw;
}
function validCalendarDate(y,m,d){const dt=new Date(`${y}-${m}-${d}T00:00:00Z`);return Number.isFinite(dt.getTime())&&dt.getUTCFullYear()===Number(y)&&dt.getUTCMonth()+1===Number(m)&&dt.getUTCDate()===Number(d);}
function canonicalPersonName(v){let s=text(v).toLowerCase();try{s=s.normalize('NFKC');}catch(_){ }return s.replace(/\s+/g,' ').trim();}
function fullBirthKey(v){const b=normalizeBirth(v);return /^\d{4}-\d{2}-\d{2}$/.test(b)?b:'';}
function bioIdentityKey(row){const name=canonicalPersonName(row?.name),fed=text(row?.fed||row?.federation).toUpperCase(),birth=fullBirthKey(row?.birth||row?.dob||row?.birthDate);return name&&fed&&birth?`bio:${name}|${fed}|${birth}`:'';}
function samePlayerIdentity(a,b){
  const af=text(a?.fideId),bf=text(b?.fideId),av=validFideId(af),bv=validFideId(bf);
  if(av&&bv)return af===bf?{same:true,reason:'fide-id'}:{same:false,reason:'fide-id-conflict'};
  const ak=bioIdentityKey(a),bk=bioIdentityKey(b);return ak&&bk&&ak===bk?{same:true,reason:'name-fed-dob'}:{same:false,reason:''};
}
function rowSearchKey(row){return `${text(row?.name)} ${text(row?.fideId)} ${text(row?.playerId)} ${text(row?.fed)} ${text(row?.title)} ${text(row?.birth)}`.toLowerCase();}
function normalizeRow(row={}){
  const rawId=text(row.fideId||row.playerId||row.id),fideId=validFideId(rawId)?rawId:'';
  const playerId=rawId||fideId;if(!playerId)return null;
  const birth=normalizeBirth(row.birth||row.birthYear||row.dob||row.birthDate);
  const out={playerId,fideId,name:text(row.name),fed:text(row.fed||row.federation).toUpperCase(),title:text(row.title).toUpperCase(),birth,gender:normalizeGender(row.gender||row.sex),rating:n(row.rating)};
  out.searchKey=rowSearchKey(out);return out;
}
function normalizeDescriptor(d={}){
  const id=text(d.id).toLowerCase();if(!id)return null;
  const rt=ratingType(d.ratingType),cat=category(d.category);
  return {schemaVersion:SCHEMA,kind:KIND,id,label:text(d.label)||'Custom Rating List',category:cat,categoryLabel:CATEGORY_LABELS[cat],ratingType:rt,ratingTypeLabel:RATING_LABELS[rt],listClass:CLASS,originalSourceKnown:false,originalSourceAuthority:'Unknown / not asserted by THP',provenanceMode:'user-imported-custom-unknown-source',sourceDescription:text(d.sourceDescription),sourceFileName:text(d.sourceFileName),importedAt:text(d.importedAt)||nowIso(),updatedAt:text(d.updatedAt)||text(d.importedAt)||nowIso(),recordCount:Math.max(0,Number(d.recordCount)||0),storageScope:'application-library'};
}
function normalizeTypeBDescriptor(d={}){
  const id=text(d.id).toLowerCase();if(!id)return null;const rt=ratingType(d.ratingType);
  return {schemaVersion:SCHEMA,kind:TYPE_B_KIND,id,label:text(d.label)||'Type-B Rating List',category:'other',categoryLabel:'Other',ratingType:rt==='general'?'std':rt,ratingTypeLabel:RATING_LABELS[rt==='general'?'std':rt],listClass:'Type-B',originalSourceKnown:false,originalSourceAuthority:text(d.originalSourceAuthority)||'Unknown / not asserted by THP',sourceDescription:text(d.sourceDescription),sourceFileName:text(d.sourceFileName),importedAt:text(d.importedAt),updatedAt:text(d.updatedAt||d.importedAt),recordCount:Math.max(0,Number(d.recordCount)||0),storageScope:'application-library'};
}
function normalizeRef(d={}){
  const id=text(d.id).toLowerCase();if(!id)return null;const kind=d.kind===TYPE_B_KIND?TYPE_B_KIND:KIND,rt=ratingType(d.ratingType),cat=category(d.category);
  return {schemaVersion:SCHEMA,id,kind,label:text(d.label)||id,listClass:'Type-B',ratingType:kind===TYPE_B_KIND&&rt==='general'?'std':rt,ratingTypeLabel:text(d.ratingTypeLabel)||RATING_LABELS[rt],category:cat,categoryLabel:text(d.categoryLabel)||CATEGORY_LABELS[cat],originalSourceKnown:false,sourceDescription:text(d.sourceDescription),sourceFileName:text(d.sourceFileName),recordCount:Math.max(0,Number(d.recordCount)||0),deleted:!!d.deleted,deletedAt:text(d.deletedAt)};
}
async function idbGet(key){
  if(typeof openFideCacheDb!=='function'||typeof FIDE_CACHE_STORE==='undefined')return null;
  try{const db=await openFideCacheDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(FIDE_CACHE_STORE,'readonly'),req=tx.objectStore(FIDE_CACHE_STORE).get(key);req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error||new Error('Custom rating library read failed.'));});}catch(_){return null;}
}
async function idbPut(key,value){
  if(typeof openFideCacheDb!=='function'||typeof FIDE_CACHE_STORE==='undefined')return false;
  try{const db=await openFideCacheDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(FIDE_CACHE_STORE,'readwrite');tx.objectStore(FIDE_CACHE_STORE).put(value,key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error('Custom rating library write failed.'));tx.onabort=()=>reject(tx.error||new Error('Custom rating library write aborted.'));});}catch(_){return false;}
}
async function idbDelete(key){
  if(typeof openFideCacheDb!=='function'||typeof FIDE_CACHE_STORE==='undefined')return false;
  try{const db=await openFideCacheDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(FIDE_CACHE_STORE,'readwrite');tx.objectStore(FIDE_CACHE_STORE).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error('Custom rating library delete failed.'));tx.onabort=()=>reject(tx.error||new Error('Custom rating library delete aborted.'));});}catch(_){return false;}
}
function localStorageGet(key){try{return typeof localStorage!=='undefined'?localStorage.getItem(key):null;}catch(_){return null;}}
function localStorageSet(key,value){try{if(typeof localStorage!=='undefined')localStorage.setItem(key,value);return true;}catch(_){return false;}}
async function loadLibrary({hydrate=false,force=false}={}){
  if(!libraryLoaded||force){
    let raw=await idbGet(CATALOG_KEY);
    if(!raw){try{raw=JSON.parse(localStorageGet(CATALOG_LS_KEY)||'null');}catch(_){raw=null;}}
    const seen=new Set(),out=[];for(const x of Array.isArray(raw)?raw:memoryCatalog){const d=normalizeDescriptor(x);if(d&&!seen.has(d.id)){seen.add(d.id);out.push(d);}}
    memoryCatalog=out;libraryLoaded=true;
  }
  if(hydrate)for(const d of memoryCatalog)await getCustomData(d.id);
  return clone(memoryCatalog);
}
async function saveCatalog(){
  const clean=[];const seen=new Set();for(const x of memoryCatalog){const d=normalizeDescriptor(x);if(d&&!seen.has(d.id)){seen.add(d.id);clean.push(d);}}memoryCatalog=clean;
  await idbPut(CATALOG_KEY,clean);localStorageSet(CATALOG_LS_KEY,JSON.stringify(clean.map(x=>({...x}))));return true;
}
async function putCustomData(id,rows){id=text(id).toLowerCase();const clean=Array.isArray(rows)?rows.map(normalizeRow).filter(Boolean):[];memoryData.set(id,clean);invalidateExternalSearchIndex();await idbPut(DATA_PREFIX+id,{schemaVersion:SCHEMA,id,rows:clean,savedAt:nowIso()});return clean;}
async function getCustomData(id){id=text(id).toLowerCase();if(memoryData.has(id))return memoryData.get(id);const raw=await idbGet(DATA_PREFIX+id),rows=Array.isArray(raw?.rows)?raw.rows.map(normalizeRow).filter(Boolean):[];memoryData.set(id,rows);return rows;}
async function deleteCustomData(id){id=text(id).toLowerCase();memoryData.delete(id);invalidateExternalSearchIndex();await idbDelete(DATA_PREFIX+id);return true;}
function ensureRefs(t=currentTournament()){
  if(!t||typeof t!=='object')return [];
  if(!t.settings||typeof t.settings!=='object'||Array.isArray(t.settings))t.settings={};
  const seen=new Set(),out=[];for(const raw of Array.isArray(t.settings[REFS_KEY])?t.settings[REFS_KEY]:[]){const r=normalizeRef(raw);if(r&&!seen.has(r.id)){seen.add(r.id);out.push(r);}}
  t.settings[REFS_KEY]=out;return out;
}
function refDescriptor(id,t=currentTournament()){id=text(id).toLowerCase();return clone(ensureRefs(t).find(x=>x.id===id)||null);}
function rememberRef(t,d){if(!t||!d)return null;const refs=ensureRefs(t),ref=normalizeRef(d),i=refs.findIndex(x=>x.id===ref.id);if(i>=0)refs[i]={...refs[i],...ref,deleted:false,deletedAt:''};else refs.push(ref);t.settings[REFS_KEY]=refs;return ref;}
function markDeletedRef(t,d){if(!t||!d)return null;const refs=ensureRefs(t),ref=normalizeRef({...d,deleted:true,deletedAt:nowIso()}),i=refs.findIndex(x=>x.id===ref.id);if(i>=0)refs[i]={...refs[i],...ref};else refs.push(ref);t.settings[REFS_KEY]=refs;return ref;}
function customCatalog(){return clone(memoryCatalog);}
function installedCustomDescriptor(id){id=text(id).toLowerCase();return clone(memoryCatalog.find(x=>x.id===id)||null);}
function installedTypeBDescriptor(id){id=text(id).toLowerCase();return clone(typeBCatalog.find(x=>x.id===id)||null);}
function descriptor(id,t=currentTournament()){return installedCustomDescriptor(id)||refDescriptor(id,t);}
function externalDescriptor(id,t=currentTournament()){return installedCustomDescriptor(id)||installedTypeBDescriptor(id)||refDescriptor(id,t);}
function isCustomId(id,t=currentTournament()){const d=installedCustomDescriptor(id)||refDescriptor(id,t);return !!d&&d.kind!==TYPE_B_KIND;}
function isTypeBId(id,t=currentTournament()){const d=installedTypeBDescriptor(id)||refDescriptor(id,t);return !!d&&d.kind===TYPE_B_KIND;}
function isExternalId(id,t=currentTournament()){return isCustomId(id,t)||isTypeBId(id,t);}
function rowsFor(id){return clone(memoryData.get(text(id).toLowerCase())||[]);}
async function rowsForAsync(id){return clone(await getCustomData(id));}
async function refreshTypeBCatalog({hydrate=false,force=false}={}){
  if(!typeBCatalogLoaded||force){let raw=[];try{raw=await window.cpBeta81?.listCatalog?.()||[];}catch(_){raw=[];}const seen=new Set(),out=[];for(const x of raw){const d=normalizeTypeBDescriptor(x);if(d&&!seen.has(d.id)){seen.add(d.id);out.push(d);}}typeBCatalog=out;typeBCatalogLoaded=true;}
  if(hydrate)for(const d of typeBCatalog)await getTypeBData(d.id);
  return clone(typeBCatalog);
}
async function getTypeBData(id){id=text(id).toLowerCase();if(typeBData.has(id))return typeBData.get(id);let raw=[];try{raw=await window.cpBeta81?.getData?.(id)||[];}catch(_){raw=[];}const rows=Array.isArray(raw)?raw.map(normalizeRow).filter(Boolean):[];typeBData.set(id,rows);return rows;}
function externalRowsSync(id){id=text(id).toLowerCase();if(memoryData.has(id))return memoryData.get(id);if(typeBData.has(id))return typeBData.get(id);return [];}
async function externalRowsAsync(id){id=text(id).toLowerCase();if(installedCustomDescriptor(id))return await getCustomData(id);if(installedTypeBDescriptor(id))return await getTypeBData(id);return [];}
function knownOfficial(id){return Object.prototype.hasOwnProperty.call(OFFICIAL_LABELS,text(id).toLowerCase());}
function cleanSequence(value,t=currentTournament()){
  const seen=new Set(),out=[];for(const raw of Array.isArray(value)?value:[]){const id=text(raw).toLowerCase();if(!id||seen.has(id))continue;if(knownOfficial(id)||isExternalId(id,t)){seen.add(id);out.push(id);}}return out;
}
function label(id,t=currentTournament()){
  id=text(id).toLowerCase();if(OFFICIAL_LABELS[id])return OFFICIAL_LABELS[id];const d=externalDescriptor(id,t);if(!d)return id;const suffix=d.kind===TYPE_B_KIND?'Type-B':'Custom';return `${d.label} [${suffix}]${d.deleted?' · deleted':''}`;
}
function defaultSequence(t=currentTournament()){try{return window.cpBeta59?.defaultSequenceFor?.(t?.settings?.tournamentRatingType)||[];}catch(_){return [];}}
function syncRefsFromSequence(t=currentTournament()){
  if(!t?.settings)return [];
  const ids=new Set([...(t.settings.ratingListSequence||[]),...(t.settings[SEQUENCE_SHADOW_KEY]||[])]);for(const id of ids){const d=installedCustomDescriptor(id)||installedTypeBDescriptor(id);if(d)rememberRef(t,d);}return ensureRefs(t);
}
function setSequence(t,sequence,{mode='custom',persist=true}={}){
  if(!t?.settings)return [];
  let next=mode==='default'?cleanSequence(defaultSequence(t),t):cleanSequence(sequence,t);
  if(mode!=='default'&&!next.length&&String(t.settings.tournamentRatingType||'').toLowerCase()!=='unrated'){next=cleanSequence(defaultSequence(t),t);mode='default';}
  t.settings.ratingListSequence=next.slice();t.settings.ratingListSequenceMode=mode==='default'?'default':'custom';t.settings[SEQUENCE_SHADOW_KEY]=next.slice();t.settings.ratingListSequenceEstablishedBy=mode==='default'?'default':'q117-rating-library';
  if(window.cpBeta59?.normalizedRatingType)t.settings.ratingListSequenceRatingType=window.cpBeta59.normalizedRatingType(t.settings.tournamentRatingType);
  syncRefsFromSequence(t);if(persist)try{window.saveData?.();}catch(_){ }refreshSequenceSummary(t);return next.slice();
}
function restoreSequenceFromShadow(t=currentTournament(),{persist=false}={}){
  if(!t?.settings)return [];ensureRefs(t);if(!Array.isArray(t.settings[SEQUENCE_SHADOW_KEY]))t.settings[SEQUENCE_SHADOW_KEY]=Array.isArray(t.settings.ratingListSequence)?t.settings.ratingListSequence.slice():[];
  if(t.settings.ratingListSequenceMode==='default')return setSequence(t,defaultSequence(t),{mode:'default',persist});
  const shadow=cleanSequence(t.settings[SEQUENCE_SHADOW_KEY],t),current=cleanSequence(t.settings.ratingListSequence,t),next=shadow.length?shadow:current;t.settings.ratingListSequence=next.slice();t.settings[SEQUENCE_SHADOW_KEY]=next.slice();syncRefsFromSequence(t);if(persist)try{window.saveData?.();}catch(_){ }return next;
}
function restoreAllShadows(){for(const t of allTournaments())restoreSequenceFromShadow(t,{persist:false});refreshSequenceSummary();}
function splitDelimited(line,delim){const out=[];let cur='',quote=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quote&&line[i+1]==='"'){cur+='"';i++;}else quote=!quote;}else if(c===delim&&!quote){out.push(cur);cur='';}else cur+=c;}out.push(cur);return out.map(x=>x.trim());}
function normHeader(v){return text(v).toLowerCase().replace(/[^a-z0-9]+/g,'');}
function detectDelimiter(line){const options=['\t',';','|',','];let best='',count=0;for(const d of options){const x=line.split(d).length-1;if(x>count){count=x;best=d;}}return count?best:'';}
function parseDelimited(textValue){
  const lines=String(textValue||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(!lines.length)return [];
  const delim=detectDelimiter(lines[0]);if(!delim)return [];
  const first=splitDelimited(lines[0],delim),heads=first.map(normHeader);
  const aliases={id:new Set(['fideid','fide','playerid','id','code']),rating:new Set(['rating','elo','rtg','tournamentrating']),name:new Set(['name','player','playername','fullname']),fed:new Set(['fed','federation','country']),title:new Set(['title','fidetitle']),birth:new Set(['birth','birthyear','yearofbirth','dob']),gender:new Set(['gender','sex'])};
  const find=a=>heads.findIndex(h=>a.has(h));let idI=find(aliases.id),ratingI=find(aliases.rating),nameI=find(aliases.name),fedI=find(aliases.fed),titleI=find(aliases.title),birthI=find(aliases.birth),genderI=find(aliases.gender),start=1;
  if(idI<0||ratingI<0){idI=0;ratingI=first.length>2?2:1;nameI=first.length>2?1:-1;fedI=first.length>3?3:-1;titleI=birthI=genderI=-1;start=0;}
  const rows=[];for(let i=start;i<lines.length;i++){const cells=splitDelimited(lines[i],delim),id=text(cells[idI]),rawRating=cells[ratingI];if(!id||!Number.isFinite(Number(rawRating)))continue;rows.push(normalizeRow({playerId:id,fideId:id,name:nameI>=0?cells[nameI]:'',fed:fedI>=0?cells[fedI]:'',title:titleI>=0?cells[titleI]:'',birth:birthI>=0?cells[birthI]:'-',gender:genderI>=0?cells[genderI]:'',rating:rawRating}));}return rows.filter(Boolean);
}
function parseFixed(textValue,rt){
  if(!['std','rapid','blitz'].includes(rt))return [];const parser=window.cpBeta72RatingLists?.parseFixedWidthLine;if(typeof parser!=='function')return [];
  const rows=[];for(const line of String(textValue||'').split(/\r?\n/)){const x=parser(line,rt,'');if(!x)continue;rows.push(normalizeRow({fideId:x.fideId,name:x.name,fed:x.fed,title:x.title,birth:x.birth,gender:x.gender,rating:x.rating}));}return rows.filter(Boolean);
}
function parseCustomRows(textValue,options={}){const rt=ratingType(options.ratingType);let rows=parseDelimited(textValue);if(!rows.length)rows=parseFixed(textValue,rt);const map=new Map();for(const row of rows){if(row)map.set(row.playerId,row);}if(!map.size)throw new Error('No valid custom rating records were found. Use CSV/TSV/semicolon/pipe data with Player/FIDE ID and Rating columns, or a FIDE fixed-width list.');return [...map.values()];}
async function importCustomList(options={}){
  await loadLibrary();const listLabel=text(options.label||options.fileName)||'Custom Rating List',id=(text(options.id)||stableId(listLabel)).toLowerCase();if(memoryCatalog.some(x=>x.id===id))throw new Error(`Custom Rating List ID already exists: ${id}`);
  const rt=ratingType(options.ratingType),rows=parseCustomRows(options.text,{ratingType:rt}),cat=category(options.category),d=normalizeDescriptor({id,label:listLabel,category:cat,ratingType:rt,sourceDescription:options.sourceDescription,sourceFileName:options.fileName,importedAt:nowIso(),updatedAt:nowIso(),recordCount:rows.length});
  await putCustomData(id,rows);memoryCatalog.push(d);await saveCatalog();refreshCustomUi();return clone(d);
}
async function updateCustomList(id,options={}){
  await loadLibrary();id=text(id).toLowerCase();const i=memoryCatalog.findIndex(x=>x.id===id),old=memoryCatalog[i];if(!old)throw new Error(`Custom Rating List not found: ${id}`);
  const rt=ratingType(options.ratingType||old.ratingType),rows=options.text==null?await getCustomData(id):parseCustomRows(options.text,{ratingType:rt}),cat=category(options.category||old.category),d=normalizeDescriptor({...old,id,label:text(options.label)||old.label,category:cat,ratingType:rt,sourceDescription:options.sourceDescription===undefined?old.sourceDescription:options.sourceDescription,sourceFileName:text(options.fileName)||old.sourceFileName,updatedAt:nowIso(),recordCount:rows.length});
  await putCustomData(id,rows);memoryCatalog[i]=d;await saveCatalog();for(const t of allTournaments())if(refDescriptor(id,t))rememberRef(t,d);try{window.saveData?.();}catch(_){ }refreshCustomUi();return clone(d);
}
function playerLookup(id,playerId){const key=text(playerId),rows=memoryData.get(text(id).toLowerCase())||[];const row=rows.find(x=>text(x.fideId)===key||text(x.playerId)===key);return row?clone(row):null;}
async function playerLookupAsync(id,playerId){await getCustomData(id);return playerLookup(id,playerId);}
function customRating(id,playerId){const row=playerLookup(id,playerId);return row?{...row,list:installedCustomDescriptor(id)}:null;}
function officialResolution(player,id){id=text(id).toLowerCase();const std=n(player?.std),rapid=n(player?.rapid),blitz=n(player?.blitz);if(id==='fide-standard')return {rating:std,sourceType:'std',fallback:false};if(id==='fide-rapid')return {rating:rapid,sourceType:'rapid',fallback:false};if(id==='fide-blitz')return {rating:blitz,sourceType:'blitz',fallback:false};if(id==='effective-rapid')return rapid>0?{rating:rapid,sourceType:'rapid',fallback:false}:{rating:std,sourceType:'std',fallback:std>0};if(id==='effective-blitz')return blitz>0?{rating:blitz,sourceType:'blitz',fallback:false}:{rating:std,sourceType:'std',fallback:std>0};return {rating:0,sourceType:null,fallback:false};}
function externalRating(id,playerOrId,t=currentTournament()){
  id=text(id).toLowerCase();const d=externalDescriptor(id,t);if(!d)return null;const rows=externalRowsSync(id);let row=null;
  if(playerOrId&&typeof playerOrId==='object'){const fid=text(playerOrId.fideId);if(validFideId(fid))row=rows.find(x=>text(x.fideId)===fid)||null;if(!row)row=rows.find(x=>samePlayerIdentity(x,playerOrId).same)||null;if(!row){const key=text(playerOrId.playerId||playerOrId.customPlayerId);if(key)row=rows.find(x=>text(x.playerId)===key)||null;}}
  else{const key=text(playerOrId);row=rows.find(x=>text(x.fideId)===key||text(x.playerId)===key)||null;}
  return row?{...clone(row),list:d}:null;
}
function resolutionFromExternalHit(player,listId,t=currentTournament()){
  listId=text(listId).toLowerCase();const d=externalDescriptor(listId,t);if(!d)return null;const direct=(Array.isArray(player?.__cpRatingListHits)?player.__cpRatingListHits:[]).find(h=>text(h.listId).toLowerCase()===listId);
  const hit=direct?{rating:n(direct.rating),rowPlayerId:text(direct.playerId),rowFideId:text(direct.fideId)}:externalRating(listId,player,t);const rating=n(hit?.rating);if(!rating)return null;
  return {rating,listId:d.id,label:d.label,kind:d.kind||KIND,listClass:'Type-B',originalSourceKnown:false,sourceType:['std','rapid','blitz'].includes(d.ratingType)?d.ratingType:'custom',fallback:false,category:d.category,row:direct||hit};
}
function resolveSequenceForPlayer(player,t=currentTournament()){
  const seq=restoreSequenceFromShadow(t,{persist:false});
  for(const listId of seq){
    if(isExternalId(listId,t)){const resolved=resolutionFromExternalHit(player,listId,t);if(resolved)return resolved;continue;}
    const r=officialResolution(player,listId);if(n(r.rating)>0)return {rating:n(r.rating),listId,label:OFFICIAL_LABELS[listId]||listId,kind:'official-rating-list',listClass:listId.startsWith('effective-')?'Derived':'Type-A',originalSourceKnown:true,...r};
  }
  return {rating:0,listId:'',label:'No rating found in sequence',kind:'none',sourceType:null,fallback:false};
}
function attachTournamentProvenance(player,resolution,{manualOverride=false,selectedBy='rating-list-sequence'}={}){
  if(!player||!resolution)return null;try{window.cpBeta52?.ensure?.(player);window.cpBeta57?.syncTournamentProvenance?.(player);}catch(_){ }
  const prov=(player.ratingProvenance&&typeof player.ratingProvenance==='object')?player.ratingProvenance:(player.ratingProvenance={}),old=(prov.tournament&&typeof prov.tournament==='object')?prov.tournament:{},history=Array.isArray(old.history)?old.history.slice():[];
  if(old.sourceListId&&old.sourceListId!==resolution.listId)history.push({action:'rating-sequence-source-change',sourceListId:old.sourceListId,sourceValue:old.sourceValue,currentValue:old.currentValue,at:nowIso()});
  prov.version=Math.max(3,Number(prov.version)||0);const external=resolution.kind===KIND||resolution.kind===TYPE_B_KIND;
  prov.tournament={...old,currentValue:n(player.rating),role:'tournament-operations',sourceKind:resolution.kind,sourceListId:text(resolution.listId),sourceListLabel:text(resolution.label),sourceListClass:text(resolution.listClass),sourceValue:n(resolution.rating),sourceKnown:resolution.originalSourceKnown===true,customListId:resolution.kind===KIND?text(resolution.listId):'',typeBListId:resolution.kind===TYPE_B_KIND?text(resolution.listId):'',customCategory:text(resolution.category),manualOverride:!!manualOverride,selectedBy:text(selectedBy)||'rating-list-sequence',selectedAt:nowIso(),history:history.slice(-30)};
  if(external){prov.tournament.sourceListDeleted=false;prov.tournament.sourceListDeletedAt='';}
  player.ratingProvenance=prov;return prov.tournament;
}
function markExternalManualOverride(player,beforeRating){const rec=player?.ratingProvenance?.tournament;if(!rec||![KIND,TYPE_B_KIND].includes(rec.sourceKind)||n(beforeRating)===n(player.rating))return false;rec.history=Array.isArray(rec.history)?rec.history:[];rec.history.push({action:'manual-tournament-rating-edit',value:n(beforeRating),sourceListId:rec.sourceListId,sourceValue:rec.sourceValue,at:nowIso()});if(rec.history.length>30)rec.history=rec.history.slice(-30);rec.currentValue=n(player.rating);rec.manualOverride=true;rec.modifiedAt=nowIso();return true;}
const markCustomManualOverride=markExternalManualOverride;
function removeExternalReferenceFromTournament(id,d,t){
  if(!t?.settings)return false;id=text(id).toLowerCase();const raw=[...(Array.isArray(t.settings[SEQUENCE_SHADOW_KEY])?t.settings[SEQUENCE_SHADOW_KEY]:[]),...(Array.isArray(t.settings.ratingListSequence)?t.settings.ratingListSequence:[])],had=raw.some(x=>text(x).toLowerCase()===id);
  const filtered=raw.filter(x=>text(x).toLowerCase()!==id),unique=[];const seen=new Set();for(const x of filtered){const k=text(x).toLowerCase();if(k&&!seen.has(k)){seen.add(k);unique.push(k);}}
  if(had){if(!unique.length&&String(t.settings.tournamentRatingType||'').toLowerCase()!=='unrated')setSequence(t,defaultSequence(t),{mode:'default',persist:false});else setSequence(t,unique,{mode:'custom',persist:false});}
  const usesProv=(t.players||[]).some(p=>p?.ratingProvenance?.tournament?.sourceListId===id);if(usesProv)markDeletedRef(t,d);else t.settings[REFS_KEY]=ensureRefs(t).filter(x=>x.id!==id);
  for(const p of t.players||[]){const rec=p?.ratingProvenance?.tournament;if(rec?.sourceListId===id){rec.sourceListDeleted=true;rec.sourceListDeletedAt=nowIso();rec.sourceListLabel=rec.sourceListLabel||d?.label||id;rec.sourceValue=rec.sourceValue??n(p.rating);}}
  return had||usesProv;
}
async function deleteCustomList(id){
  await loadLibrary();id=text(id).toLowerCase();const d=installedCustomDescriptor(id);if(!d)return false;memoryCatalog=memoryCatalog.filter(x=>x.id!==id);await saveCatalog();await deleteCustomData(id);for(const t of allTournaments())removeExternalReferenceFromTournament(id,d,t);try{window.saveData?.();}catch(_){ }refreshCustomUi();refreshSequenceSummary();return true;
}
async function fullCatalogue(){await loadLibrary();await refreshTypeBCatalog();const official=window.cpBeta65?.officialLists?.()||[];return [...official,...typeBCatalog.map(clone),...memoryCatalog.map(clone)];}
function remapTournamentListId(t,oldId,newId,d){
  if(!t?.settings)return;for(const key of ['ratingListSequence',SEQUENCE_SHADOW_KEY])if(Array.isArray(t.settings[key]))t.settings[key]=t.settings[key].map(x=>text(x).toLowerCase()===oldId?newId:x);
  for(const p of t.players||[]){const rec=p?.ratingProvenance?.tournament;if(rec?.sourceListId===oldId&&rec?.sourceKind===KIND){rec.sourceListId=newId;rec.customListId=newId;rec.sourceListLabel=rec.sourceListLabel||d?.label||newId;}}
}
function rowsEquivalent(a,b){const aa=(a||[]).map(normalizeRow).filter(Boolean),bb=(b||[]).map(normalizeRow).filter(Boolean);if(aa.length!==bb.length)return false;const map=new Map(aa.map(x=>[x.playerId,`${x.rating}|${x.name}|${x.fed}|${x.title}`]));return bb.every(x=>map.get(x.playerId)===`${x.rating}|${x.name}|${x.fed}|${x.title}`);}
async function migrateLegacyTournamentStores(){
  await loadLibrary();let changed=false,catalogChanged=false;
  for(const t of allTournaments()){
    if(!t?.settings)continue;const legacyLists=Array.isArray(t.settings[LEGACY_LISTS_KEY])?t.settings[LEGACY_LISTS_KEY]:[],legacyData=(t.settings[LEGACY_DATA_KEY]&&typeof t.settings[LEGACY_DATA_KEY]==='object')?t.settings[LEGACY_DATA_KEY]:{};
    if(!legacyLists.length&&!t.settings[LEGACY_DATA_KEY])continue;
    for(const raw of legacyLists){let d=normalizeDescriptor(raw);if(!d)continue;const rows=Array.isArray(legacyData[d.id])?legacyData[d.id].map(normalizeRow).filter(Boolean):[],existing=installedCustomDescriptor(d.id);let id=d.id;
      if(existing){const exRows=await getCustomData(id);if(!rowsEquivalent(exRows,rows)){id=stableId(d.label).toLowerCase();d=normalizeDescriptor({...d,id,updatedAt:nowIso()});remapTournamentListId(t,raw.id.toLowerCase(),id,d);}}
      if(!installedCustomDescriptor(id)){d=normalizeDescriptor({...d,id,recordCount:rows.length});memoryCatalog.push(d);await putCustomData(id,rows);catalogChanged=true;}rememberRef(t,installedCustomDescriptor(id)||d);
    }
    delete t.settings[LEGACY_LISTS_KEY];delete t.settings[LEGACY_DATA_KEY];t.settings[MIGRATION_KEY]={version:2,migratedAt:nowIso(),storage:'application-library'};changed=true;
  }
  if(catalogChanged)await saveCatalog();if(changed)try{window.saveData?.();}catch(_){ }return changed;
}
async function preloadSequenceData(t=currentTournament()){
  await loadLibrary();await refreshTypeBCatalog();const seq=restoreSequenceFromShadow(t,{persist:false});for(const id of seq){if(installedCustomDescriptor(id))await getCustomData(id);else if(installedTypeBDescriptor(id))await getTypeBData(id);}return seq;
}
function refreshSequenceSummary(t=currentTournament()){
  try{restoreSequenceFromShadow(t,{persist:false});const el=document.getElementById('ratingListSequenceSummary'),mode=document.getElementById('ratingListSequenceMode'),seq=cleanSequence(t?.settings?.ratingListSequence,t);if(el)el.textContent=seq.length?seq.map(id=>label(id,t)).join(' → '):'No rating list';if(mode){const m=t?.settings?.ratingListSequenceMode==='custom'?'Custom':'Default';mode.textContent=m;mode.className='badge '+(m==='Custom'?'warning':'');}}catch(_){ }
}
function wrapBeta59(){
  const api=window.cpBeta59;if(!api||api.__cpQ117R1Wrapped)return false;originals.beta59={cleanSequence:api.cleanSequence,markCustom:api.markCustom,restoreDefault:api.restoreDefault,syncTournament:api.syncTournament,ensureSettings:api.ensureSettings,currentSequence:api.currentSequence,sequenceLabels:api.sequenceLabels};
  api.cleanSequence=v=>cleanSequence(v,currentTournament());api.sequenceLabels=v=>cleanSequence(v,currentTournament()).map(id=>label(id,currentTournament()));api.markCustom=(t,seq,opt={})=>setSequence(t,seq,{mode:'custom',persist:opt.persist!==false});api.restoreDefault=(t,opt={})=>setSequence(t,defaultSequence(t),{mode:'default',persist:opt.persist!==false});api.syncTournament=(t,opt={})=>{const before=JSON.stringify(t?.settings?.ratingListSequence||[]),next=t?.settings?.ratingListSequenceMode==='default'?setSequence(t,defaultSequence(t),{mode:'default',persist:false}):restoreSequenceFromShadow(t,{persist:false}),changed=before!==JSON.stringify(next);if(changed&&opt.persist)try{window.saveData?.();}catch(_){ }return {changed,sequence:next.slice(),mode:t?.settings?.ratingListSequenceMode||'default'};};api.ensureSettings=(s,opt={})=>{const t=allTournaments().find(x=>x.settings===s)||currentTournament();return api.syncTournament(t,{persist:false});};api.currentSequence=()=>cleanSequence(currentTournament()?.settings?.ratingListSequence,currentTournament());api.__cpQ117R1Wrapped=true;return true;
}
function wrapPreserving(name,after){const original=window[name];if(typeof original!=='function'||original.__cpQ117R1Wrapped)return false;const wrapped=function(){const r=original.apply(this,arguments);const done=()=>{restoreAllShadows();syncRefsFromSequence();after?.();return r;};if(r&&typeof r.then==='function')return r.finally(()=>{restoreAllShadows();syncRefsFromSequence();after?.();});return done();};wrapped.__cpQ117R1Wrapped=true;wrapped.__cpQ117R1Original=original;window[name]=wrapped;return true;}
function sequenceAvailableIds(){return [...Object.keys(OFFICIAL_LABELS),...typeBCatalog.map(x=>x.id),...memoryCatalog.map(x=>x.id)];}
async function sequenceOpen(){const t=currentTournament();if(!t)return false;await loadLibrary();await refreshTypeBCatalog();await preloadSequenceData(t);sequenceDraft=restoreSequenceFromShadow(t,{persist:false}).slice();renderSequenceEditor();const m=document.getElementById('ratingListSequenceModal');if(m){m.style.display='flex';m.setAttribute('aria-hidden','false');}return true;}
function sequenceClose(){const m=document.getElementById('ratingListSequenceModal');if(m){m.style.display='none';m.setAttribute('aria-hidden','true');}return true;}
function listBadge(id,t){if(knownOfficial(id))return '';const d=externalDescriptor(id,t),installed=!!(installedCustomDescriptor(id)||installedTypeBDescriptor(id)),kind=d?.kind===TYPE_B_KIND?'Type-B':'Custom';return ` <span class="badge ${installed?'warning':'danger'}">${kind}${installed?'':' · Not installed'}</span>`;}
function renderSequenceEditor(){
  const t=currentTournament(),active=document.getElementById('ratingListSequenceActive'),available=document.getElementById('ratingListSequenceAvailable');if(!active||!available)return;
  active.innerHTML='';if(!sequenceDraft.length)active.innerHTML='<div class="help">No rating list selected.</div>';sequenceDraft.forEach((id,i)=>{const row=document.createElement('div');row.className='cp-rating-sequence-row';row.innerHTML=`<span><b>${i+1}.</b> ${esc(label(id,t))}${listBadge(id,t)}</span><span class="cp-rating-sequence-actions"><button type="button" data-q117-action="up" data-index="${i}" ${i===0?'disabled':''}>↑</button><button type="button" data-q117-action="down" data-index="${i}" ${i===sequenceDraft.length-1?'disabled':''}>↓</button><button type="button" data-q117-action="remove" data-index="${i}">Remove</button></span>`;active.appendChild(row);});
  available.innerHTML='';const used=new Set(sequenceDraft),ids=sequenceAvailableIds().filter(id=>!used.has(id));if(!ids.length)available.innerHTML='<div class="help">All installed rating lists are in the sequence.</div>';ids.forEach(id=>{const row=document.createElement('div');row.className='cp-rating-sequence-row';row.innerHTML=`<span>${esc(label(id,t))}${listBadge(id,t)}</span><button type="button" data-q117-action="add" data-id="${esc(id)}">Add</button>`;available.appendChild(row);});
}
function sequenceClick(event){const b=event.target?.closest?.('button[data-q117-action]');if(!b)return;const action=b.dataset.q117Action,i=Number(b.dataset.index);if(action==='add'){const id=text(b.dataset.id).toLowerCase();if(sequenceAvailableIds().includes(id)&&!sequenceDraft.includes(id))sequenceDraft.push(id);}else if(action==='remove'&&Number.isInteger(i))sequenceDraft.splice(i,1);else if((action==='up'||action==='down')&&Number.isInteger(i)){const j=i+(action==='up'?-1:1);if(j>=0&&j<sequenceDraft.length)[sequenceDraft[i],sequenceDraft[j]]=[sequenceDraft[j],sequenceDraft[i]];}renderSequenceEditor();}
async function sequenceSave(){const t=currentTournament();if(!t)return false;if(!sequenceDraft.length&&String(t.settings?.tournamentRatingType||'').toLowerCase()!=='unrated'){window.appAlert?.('A rated tournament must keep at least one rating list in the sequence.','Rating List Sequence','warning');return false;}setSequence(t,sequenceDraft,{mode:'custom',persist:true});await preloadSequenceData(t);sequenceClose();return true;}
function installSequenceUi(){
  if(typeof document==='undefined')return false;const modal=document.getElementById('ratingListSequenceModal'),manage=document.getElementById('ratingListSequenceManage');if(!modal||!manage)return false;
  modal.innerHTML='<div class="modal-window" style="width:860px;max-width:95vw"><div class="modal-titlebar">Rating List Sequence</div><div class="modal-body"><div class="cp-rating-sequence-head"><span>Ratings are resolved from top to bottom. Official, Type-B and Custom lists may be mixed. Missing local library data falls through safely to the next list.</span><span class="badge warning">Q117</span></div><div class="cp-rating-sequence-columns"><div class="groupbox"><div class="group-title">Sequence</div><div id="ratingListSequenceActive"></div></div><div class="groupbox"><div class="group-title">Available installed rating lists</div><div id="ratingListSequenceAvailable"></div></div></div></div><div class="modal-bottom"><button id="ratingListSequenceDefault" type="button">Use Default</button><span style="flex:1"></span><button id="ratingListSequenceCancel" type="button">Cancel</button><button id="ratingListSequenceSave" type="button" class="primary">Save</button></div></div>';
  const fresh=manage.cloneNode(true);manage.replaceWith(fresh);fresh.addEventListener('click',()=>{sequenceOpen().catch(err=>window.appAlert?.(String(err?.message||err),'Rating List Sequence','warning'));});document.getElementById('ratingListSequenceActive')?.addEventListener('click',sequenceClick);document.getElementById('ratingListSequenceAvailable')?.addEventListener('click',sequenceClick);document.getElementById('ratingListSequenceCancel')?.addEventListener('click',sequenceClose);document.getElementById('ratingListSequenceSave')?.addEventListener('click',()=>{sequenceSave().catch(err=>window.appAlert?.(String(err?.message||err),'Rating List Sequence','warning'));});document.getElementById('ratingListSequenceDefault')?.addEventListener('click',()=>{sequenceDraft=cleanSequence(defaultSequence(),currentTournament());renderSequenceEditor();});
  const api=window.cpBeta62;if(api){api.clean=v=>cleanSequence(v,currentTournament());api.label=id=>label(id,currentTournament());api.availableIds=seq=>sequenceAvailableIds().filter(id=>!new Set(cleanSequence(seq,currentTournament())).has(id));api.add=(seq,id)=>cleanSequence([...(seq||[]),id],currentTournament());api.openEditor=sequenceOpen;api.closeEditor=sequenceClose;api.renderEditor=renderSequenceEditor;api.sequenceText=seq=>cleanSequence(seq,currentTournament()).map(id=>label(id,currentTournament())).join(' → ');api.refreshSummary=refreshSequenceSummary;api.__cpQ117R1Wrapped=true;}refreshSequenceSummary();return true;
}
function tournamentsUsing(id){id=text(id).toLowerCase();return allTournaments().filter(t=>[...(t?.settings?.ratingListSequence||[]),...(t?.settings?.[SEQUENCE_SHADOW_KEY]||[])].some(x=>text(x).toLowerCase()===id)).length;}
function customManagerModal(){
  let m=document.getElementById('cpCustomRatingManager');if(m)return m;m=document.createElement('div');m.id='cpCustomRatingManager';m.className='modal-overlay';m.style.display='none';
  m.innerHTML='<div class="modal-window" style="width:940px;max-width:96vw"><div class="modal-titlebar">Custom Rating List Library</div><div class="modal-body"><div class="help" style="margin-bottom:8px"><b>Library-wide:</b> importing a list never registers tournament participants. The list is reused by every tournament and appears in Player Search and Rating List Sequence.</div><div id="cpCustomListRows"></div><div class="groupbox" style="margin-top:10px"><div class="group-title">Library lookup</div><div style="display:flex;gap:6px;flex-wrap:wrap"><select id="cpCustomLookupList"></select><input id="cpCustomLookupId" placeholder="Player name / FIDE ID / Player ID" style="min-width:240px"><button id="cpCustomLookupBtn" type="button">Search</button></div><div id="cpCustomLookupResult" class="help" style="margin-top:6px">—</div></div><input id="cpCustomReplaceFile" type="file" accept=".csv,.tsv,.txt,.lst,text/plain" class="hidden"></div><div class="modal-bottom"><button id="cpCustomManagerClose" type="button">Close</button></div></div>';
  document.body.appendChild(m);m.querySelector('#cpCustomManagerClose')?.addEventListener('click',()=>{m.style.display='none';});m.querySelector('#cpCustomListRows')?.addEventListener('click',customManagerClick);m.querySelector('#cpCustomLookupBtn')?.addEventListener('click',()=>customUiLookup().catch(err=>window.appAlert?.(String(err?.message||err),'Custom Rating Lists','warning')));m.querySelector('#cpCustomLookupResult')?.addEventListener('click',customLookupResultClick);m.querySelector('#cpCustomReplaceFile')?.addEventListener('change',customUiReplace);return m;
}
async function renderCustomManager(){
  await loadLibrary();const t=currentTournament(),m=customManagerModal(),list=customCatalog(),rows=m.querySelector('#cpCustomListRows');rows.innerHTML='';if(!list.length)rows.innerHTML='<div class="help">No Custom Rating Lists installed in the application library.</div>';
  for(const d of list){const used=tournamentsUsing(d.id),row=document.createElement('div');row.className='cp-rating-sequence-row';row.innerHTML=`<span><b>${esc(d.label)}</b><br><span class="help">${esc(d.categoryLabel)} · ${esc(d.ratingTypeLabel)} · ${d.recordCount.toLocaleString('en-US')} players · used by ${used} tournament${used===1?'':'s'} · <code>${esc(d.id)}</code></span></span><span class="cp-rating-sequence-actions"><button data-custom-action="main" data-id="${esc(d.id)}" ${t?'':'disabled'}>Set Main</button><button data-custom-action="add" data-id="${esc(d.id)}" ${t?'':'disabled'}>Add to Sequence</button><button data-custom-action="replace" data-id="${esc(d.id)}">Replace Data</button><button data-custom-action="delete" data-id="${esc(d.id)}">Delete</button></span>`;rows.appendChild(row);}
  const missing=ensureRefs(t).filter(r=>r.kind===KIND&&!r.deleted&&!installedCustomDescriptor(r.id));if(missing.length){const h=document.createElement('div');h.className='groupbox';h.style.marginTop='10px';h.innerHTML='<div class="group-title">Referenced by this tournament but not installed locally</div>';for(const d of missing){const row=document.createElement('div');row.className='cp-rating-sequence-row';row.innerHTML=`<span><b>${esc(d.label)}</b><br><span class="help"><code>${esc(d.id)}</code> · sequence will fall through until data is installed</span></span><button data-custom-action="install-ref" data-id="${esc(d.id)}">Install Data</button>`;h.appendChild(row);}rows.appendChild(h);}
  const sel=m.querySelector('#cpCustomLookupList');sel.innerHTML=list.map(d=>`<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('');m.querySelector('#cpCustomLookupResult').textContent='—';m._lookupRows=[];
}
async function openCustomManager(){await renderCustomManager();customManagerModal().style.display='flex';}
async function customManagerClick(event){
  const b=event.target?.closest?.('button[data-custom-action]');if(!b)return;const id=text(b.dataset.id).toLowerCase(),action=b.dataset.customAction,t=currentTournament();
  if(action==='main'||action==='add'){if(!t){window.appAlert?.('Open a tournament before adding a rating list to its sequence.','Custom Rating Lists','info');return;}const seq=restoreSequenceFromShadow(t,{persist:false}).filter(x=>action==='main'?x!==id:true);setSequence(t,action==='main'?[id,...seq]:seq.includes(id)?seq:[...seq,id],{mode:'custom',persist:true});await preloadSequenceData(t);await renderCustomManager();}
  else if(action==='replace'){pendingReplaceId=id;pendingInstallRefId='';document.getElementById('cpCustomReplaceFile')?.click();}
  else if(action==='install-ref'){pendingInstallRefId=id;pendingReplaceId='';document.getElementById('cpCustomReplaceFile')?.click();}
  else if(action==='delete'){const d=installedCustomDescriptor(id),used=tournamentsUsing(id);let ok=true;if(typeof window.appConfirm==='function')ok=await window.appConfirm(`Delete Custom Rating List “${d?.label||id}” from the application library?\n\nUsed by ${used} tournament${used===1?'':'s'}. Sequence references will be removed safely. Existing player provenance keeps the source list ID and source value.`, 'Delete Custom Rating List','question');if(ok){await deleteCustomList(id);await renderCustomManager();}}
}
async function customUiReplace(event){
  const file=event.target?.files?.[0],replaceId=pendingReplaceId,installId=pendingInstallRefId;pendingReplaceId='';pendingInstallRefId='';if(!file)return;
  try{if(replaceId){const d=await updateCustomList(replaceId,{text:await file.text(),fileName:file.name});window.appAlert?.(`Updated ${d.label}: ${d.recordCount.toLocaleString('en-US')} records. Stable ID preserved.`, 'Custom Rating Lists','info');}
    else if(installId){const ref=refDescriptor(installId,currentTournament());if(!ref)throw new Error('The referenced Custom Rating List is no longer available in this tournament.');const d=await importCustomList({id:ref.id,label:ref.label,category:ref.category,ratingType:ref.ratingType,sourceDescription:ref.sourceDescription,text:await file.text(),fileName:file.name});for(const t of allTournaments())if(refDescriptor(d.id,t))rememberRef(t,d);window.appAlert?.(`Installed ${d.label}: ${d.recordCount.toLocaleString('en-US')} records. Existing tournament reference ID was preserved.`, 'Custom Rating Lists','info');}await renderCustomManager();}
  catch(err){window.appAlert?.(String(err?.message||err),'Custom Rating Lists','warning');}finally{event.target.value='';}
}
function searchIndexTokens(value){let s=text(value).toLowerCase();try{s=s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');}catch(_){ }try{s=s.replace(/[^\p{L}\p{N}]+/gu,' ');}catch(_){s=s.replace(/[^a-z0-9]+/g,' ');}return s.replace(/\s+/g,' ').trim().split(' ').filter(Boolean);}
function addSearchBucket(map,key,index){if(!key)return;let arr=map.get(key);if(!arr){arr=[];map.set(key,arr);}arr.push(index);}
async function rebuildExternalSearchIndex(){
  const buildVersion=externalSearchIndexVersion;await loadLibrary();await refreshTypeBCatalog();
  const entries=[],b2=new Map(),b3=new Map(),lists=[...memoryCatalog,...typeBCatalog];let processed=0;
  for(const list of lists){const rows=await externalRowsAsync(list.id);for(const row of rows){const tokens=[...new Set(searchIndexTokens(`${row.name||''} ${row.fideId||''} ${row.playerId||''} ${row.fed||''} ${row.title||''} ${row.birth||''}`))],index=entries.length;entries.push({listId:list.id,tokens,row});for(const token of tokens){if(token.length>=2)addSearchBucket(b2,token.slice(0,2),index);if(token.length>=3)addSearchBucket(b3,token.slice(0,3),index);}processed++;if(processed%2500===0&&typeof setTimeout==='function')await new Promise(resolve=>setTimeout(resolve,0));}}
  if(buildVersion!==externalSearchIndexVersion)return rebuildExternalSearchIndex();externalSearchEntries=entries;externalSearchBuckets2=b2;externalSearchBuckets3=b3;externalSearchIndexBuiltVersion=buildVersion;externalSearchIndexPromise=null;return {version:buildVersion,entries:entries.length,buckets2:b2.size,buckets3:b3.size};
}
async function ensureExternalSearchIndex(){if(externalSearchIndexBuiltVersion===externalSearchIndexVersion)return {version:externalSearchIndexVersion,entries:externalSearchEntries.length};if(!externalSearchIndexPromise)externalSearchIndexPromise=rebuildExternalSearchIndex().catch(err=>{externalSearchIndexPromise=null;throw err;});return await externalSearchIndexPromise;}
function externalSearchCandidates(terms){let best=null;for(const term of terms){const arr=term.length>=3?externalSearchBuckets3.get(term.slice(0,3)):term.length>=2?externalSearchBuckets2.get(term.slice(0,2)):null;if(arr&&(!best||arr.length<best.length))best=arr;}return best||[];}
function externalSearchScore(entry,terms,order){let score=0;for(const term of terms){if(entry.tokens.some(t=>t===term))score+=40;else if(entry.tokens.some(t=>t.startsWith(term)))score+=20;}score-=Math.min(999,order.get(entry.listId)??999);score+=Math.min(4000,n(entry.row?.rating))/10000;return score;}
function externalSearchIndexStats(){return {version:externalSearchIndexVersion,builtVersion:externalSearchIndexBuiltVersion,entries:externalSearchEntries.length,buckets2:externalSearchBuckets2.size,buckets3:externalSearchBuckets3.size};}
async function searchOneExternalList(id,query,limit=20){const d=externalDescriptor(id,currentTournament());if(!d)return [];const rows=await externalRowsAsync(id),q=text(query).toLowerCase(),terms=q.split(/[\s,]+/).filter(Boolean);if(!terms.length)return [];const out=[];for(const row of rows){const key=row.searchKey||rowSearchKey(row);if(terms.every(x=>key.includes(x))){out.push({...clone(row),list:d});if(out.length>=limit)break;}}return out;}
async function customUiLookup(){const m=customManagerModal(),id=m.querySelector('#cpCustomLookupList')?.value,q=text(m.querySelector('#cpCustomLookupId')?.value),out=m.querySelector('#cpCustomLookupResult');if(q.length<2){out.textContent='Type at least 2 characters.';return;}const rows=await searchOneExternalList(id,q,20);m._lookupRows=rows;if(!rows.length){out.textContent='No matching player in this list.';return;}out.innerHTML=rows.map((r,i)=>`<div class="cp-custom-lookup-row"><span><b>${esc(r.name||r.playerId)}</b> · ${esc(r.fed||'-')} · Rating ${n(r.rating)} · ${esc(r.fideId||r.playerId)}</span><button type="button" data-custom-lookup-add="${i}">Add Player</button></div>`).join('');}
function hitFromRow(row,list){return {listId:list.id,label:list.label,kind:list.kind,rating:n(row.rating),ratingType:list.ratingType,listClass:list.listClass,category:list.category,playerId:text(row.playerId),fideId:text(row.fideId),birth:normalizeBirth(row.birth)};}
function mergeRatingHits(a,b){const seen=new Set(),out=[];for(const h of [...(a||[]),...(b||[])]){const k=`${text(h.listId).toLowerCase()}:${n(h.rating)}:${text(h.playerId)}:${text(h.fideId)}`;if(!seen.has(k)){seen.add(k);out.push(h);}}return out;}
function mergeIdentityPlayer(dst,src,reason=''){dst.__cpRatingListHits=mergeRatingHits(dst.__cpRatingListHits,src.__cpRatingListHits);if(!validFideId(dst.fideId)&&validFideId(src.fideId))dst.fideId=src.fideId;if(!dst.playerId)dst.playerId=src.playerId;if((!dst.birth||dst.birth==='-')&&src.birth)dst.birth=src.birth;if(!dst.fed&&src.fed)dst.fed=src.fed;if(!dst.name&&src.name)dst.name=src.name;if(reason){dst.__cpIdentityMerged=true;dst.__cpIdentityMatch=reason;}return dst;}
function makeSearchPlayer(row,hits=[]){
  const fid=validFideId(row.fideId)?row.fideId:'',base=(()=>{try{return fid&&typeof fideMainDb!=='undefined'?fideMainDb.get(fid)||null:null;}catch(_){return null;}})();const p=base?{...base}:{fideId:fid||'-',name:row.name||`Player ${row.playerId}`,fed:row.fed||'FIDE',title:row.title||'',birth:normalizeBirth(row.birth)||'-',gender:row.gender||'',std:0,rapid:0,blitz:0};p.playerId=row.playerId;p.__cpRatingListHits=hits;p.searchKey=(p.searchKey||row.searchKey||rowSearchKey(row));return p;
}
function addExternalPlayerToSearch(row,list){return makeSearchPlayer(row,[hitFromRow(row,list)]);}
async function searchExternalPlayers(query,limit=60,options={}){
  const q=text(query).toLowerCase(),terms=searchIndexTokens(q);if(q.length<2||!terms.length)return [];
  const allowedRaw=options?.allowedListIds;const allowed=allowedRaw==null?null:new Set([...(allowedRaw instanceof Set?allowedRaw:Array.isArray(allowedRaw)?allowedRaw:[])].map(x=>text(x).toLowerCase()).filter(Boolean));
  if(allowed&&allowed.size===0)return [];
  await ensureExternalSearchIndex();const t=currentTournament(),seq=restoreSequenceFromShadow(t,{persist:false}),order=new Map(seq.map((id,i)=>[id,i])),descriptors=new Map([...memoryCatalog,...typeBCatalog].filter(d=>!allowed||allowed.has(d.id)).map(d=>[d.id,d]));
  const matches=[];for(const index of externalSearchCandidates(terms)){const entry=externalSearchEntries[index];if(!entry||!descriptors.has(entry.listId)||!terms.every(term=>entry.tokens.some(token=>token.startsWith(term))))continue;matches.push({entry,score:externalSearchScore(entry,terms,order)});if(matches.length>=Math.max(240,limit*6))break;}
  matches.sort((a,b)=>b.score-a.score||String(a.entry.row?.name||'').localeCompare(String(b.entry.row?.name||'')));
  const out=[];for(const match of matches){const list=descriptors.get(match.entry.listId);if(!list)continue;const candidate=addExternalPlayerToSearch(match.entry.row,list);let existing=null,reason='';for(const p of out){const identity=samePlayerIdentity(p,candidate);if(identity.same){existing=p;reason=identity.reason;break;}}if(existing)mergeIdentityPlayer(existing,candidate,reason);else out.push(candidate);if(out.length>=limit)break;}
  return out.slice(0,limit);
}
function mergeSearchPlayers(base,external){const out=(Array.isArray(base)?base:[]).map(p=>p);for(const p of external||[]){let existing=null,reason='';for(const q of out){const match=samePlayerIdentity(q,p);if(match.same){existing=q;reason=match.reason;break;}}if(existing)mergeIdentityPlayer(existing,p,reason);else out.push(p);}return out.slice(0,60);}
function customLookupResultClick(event){const b=event.target?.closest?.('button[data-custom-lookup-add]');if(!b)return;const m=customManagerModal(),row=m._lookupRows?.[Number(b.dataset.customLookupAdd)];if(!row)return;m.style.display='none';window.openRatingModal?.(makeSearchPlayer(row,[{listId:row.list.id,label:row.list.label,kind:row.list.kind,rating:n(row.rating),ratingType:row.list.ratingType,listClass:row.list.listClass,category:row.list.category}]));}
async function uiImportCustom(){
  const file=document.getElementById('cpCustomFile')?.files?.[0];if(!file){window.appAlert?.('Choose a Custom Rating List file first.','Custom Rating Lists','warning');return;}
  try{const d=await importCustomList({text:await file.text(),fileName:file.name,label:document.getElementById('cpCustomLabel')?.value||file.name,category:document.getElementById('cpCustomCategory')?.value,ratingType:document.getElementById('cpCustomRatingType')?.value,sourceDescription:document.getElementById('cpCustomSource')?.value});window.appAlert?.(`Imported ${d.recordCount.toLocaleString('en-US')} records into the application rating-list library.\n\n0 tournament participants were added.\nThe list is now available in Player Search and Rating List Sequence.\n\nStable ID: ${d.id}\nClass: Type-B`, 'Custom Rating Lists','info');document.getElementById('cpCustomFile').value='';const modal=document.getElementById('cpCustomImportModal');if(modal)modal.style.display='none';refreshCustomUi();}
  catch(err){window.appAlert?.(String(err?.message||err),'Custom Rating Lists','warning');}
}
function customImportModal(){
  let m=document.getElementById('cpCustomImportModal');if(m)return m;m=document.createElement('div');m.id='cpCustomImportModal';m.className='modal-overlay';m.style.display='none';
  m.innerHTML='<div class="modal-window" style="width:760px;max-width:95vw"><div class="modal-titlebar">Import Rating List</div><div class="modal-body"><div class="help" style="margin-bottom:8px"><b>This imports a searchable rating library only.</b> It will not add participants to the current tournament.</div><div class="groupbox"><div class="group-title">Rating list details</div><div style="display:grid;grid-template-columns:160px 1fr;gap:8px;align-items:center"><label for="cpCustomLabel">List name</label><input id="cpCustomLabel" type="text" placeholder="e.g. Bulgarian National Rating"><label for="cpCustomCategory">Category</label><select id="cpCustomCategory"><option value="national">National</option><option value="regional">Regional</option><option value="club">Club</option><option value="historical">Historical</option><option value="other">Other</option></select><label for="cpCustomRatingType">Rating type</label><select id="cpCustomRatingType"><option value="general">General / Tournament</option><option value="std">Standard</option><option value="rapid">Rapid</option><option value="blitz">Blitz</option></select><label for="cpCustomSource">Source</label><input id="cpCustomSource" type="text" placeholder="Source description (optional)"><label for="cpCustomFile">File</label><input id="cpCustomFile" type="file" accept=".csv,.tsv,.txt,.lst,text/plain"></div></div></div><div class="modal-bottom"><button id="cpCustomImportCancel" type="button">Cancel</button><button id="cpCustomImport" type="button" class="primary">Import to Library</button></div></div>';
  document.body.appendChild(m);m.querySelector('#cpCustomImportCancel')?.addEventListener('click',()=>{m.style.display='none';});m.querySelector('#cpCustomImport')?.addEventListener('click',()=>uiImportCustom().catch?.(()=>{}));m.querySelector('#cpCustomFile')?.addEventListener('change',e=>{try{const f=e.target?.files?.[0],label=m.querySelector('#cpCustomLabel');if(f&&label&&!String(label.value||'').trim())label.value=String(f.name||'Rating List').replace(/\.[^.]+$/,'');}catch(_){}});return m;
}
function openImportDialog(options={}){const m=customImportModal();m.style.display='flex';const file=m.querySelector('#cpCustomFile');const label=m.querySelector('#cpCustomLabel');if(options.pickFile!==false&&file){try{file.click();}catch(_){if(label&&!label.value)label.focus();}}else if(label&&!label.value)label.focus();return Promise.resolve(loadLibrary()).then(()=>{refreshCustomUi();return true;}).catch(err=>{console.warn('Rating List Library load warning:',err);refreshCustomUi();return true;});}
function ensureRatingListLibraryHome(){
  if(typeof document==='undefined')return null;let home=document.getElementById('cpRatingListLibraryHome');if(home)return home;const registration=document.getElementById('registration');if(!registration)return null;const groups=[...registration.querySelectorAll(':scope > .groupbox')],anchor=groups[0]||null;home=document.createElement('div');home.className='groupbox';home.id='cpRatingListLibraryHome';home.innerHTML='<div class="group-title">Rating List Library</div><div class="toolbar"><button class="primary" id="cpRatingListImportButton" type="button">Import Rating List…</button><button id="cpRatingListManageButton" type="button">Manage Rating Lists</button><span id="cpRatingListLibraryStatus" class="badge">Rating lists: loading…</span></div><div class="help" style="margin-top:5px"><b>Rating lists are a searchable library — they do not register tournament participants.</b> Import a list here, then search the Add Player field below and add only the selected player.</div>';if(anchor)anchor.insertAdjacentElement('afterend',home);else registration.prepend(home);home.querySelector('#cpRatingListImportButton')?.addEventListener('click',()=>openImportDialog().catch(err=>window.appAlert?.(String(err?.message||err),'Custom Rating Lists','warning')));home.querySelector('#cpRatingListManageButton')?.addEventListener('click',()=>openCustomManager().catch(err=>window.appAlert?.(String(err?.message||err),'Custom Rating Lists','warning')));return home;
}
function installCustomUi(){if(typeof document==='undefined')return false;return !!ensureRatingListLibraryHome();}
function refreshCustomUi(){try{installCustomUi();const input=document.getElementById('fideSearch');if(input)input.placeholder='Search player (FIDE + imported rating lists)...';const status=document.getElementById('cpRatingListLibraryStatus');if(status){const custom=memoryCatalog.length,typeB=typeBCatalog.length,total=custom+typeB;status.textContent=total?`Rating lists: ${total} (${custom} custom${typeB?`, ${typeB} Type-B`:''})`:'Rating lists: none imported';}if(document.getElementById('cpCustomRatingManager')?.style.display==='flex')renderCustomManager().catch(()=>{});refreshSequenceSummary();}catch(_){ }}
function decorateSearchResults(players){
  try{const box=document.getElementById('fideResults'),items=[...box.querySelectorAll('.fide-item')];(players||[]).forEach((p,i)=>{const item=items[i];if(!item)return;const hits=Array.isArray(p.__cpRatingListHits)?p.__cpRatingListHits:[];if(p.__cpIdentityMerged){const div=document.createElement('div');div.className='fide-info cp-identity-merged';div.textContent=p.__cpIdentityMatch==='name-fed-dob'?'Same player matched by Name + Federation + Date of Birth.':'Same player matched by FIDE ID.';item.appendChild(div);}if(hits.length){const div=document.createElement('div');div.className='fide-info cp-external-rating-hits';div.textContent='Imported lists: '+hits.slice(0,4).map(h=>`${h.label}: ${h.rating}`).join(' • ')+(hits.length>4?` • +${hits.length-4} more`:'');item.appendChild(div);}const seq=currentTournament()?.settings?.ratingListSequence||[];if(seq.some(id=>isExternalId(id,currentTournament()))){item.querySelector('.cp-rating-sequence-fallback')?.remove();const res=resolveSequenceForPlayer(p,currentTournament());if(res.rating>0){const div=document.createElement('div');div.className='fide-info cp-rating-sequence-fallback';div.textContent=`↳ Selected by sequence: ${res.rating} · ${res.label}`;item.appendChild(div);}}});}catch(_){ }
}
function currentUiSearchQuery(){try{return text(document.getElementById('fideSearch')?.value).toLowerCase();}catch(_){return '';}}
function renderMergedUiSearch(){
  const q=currentUiSearchQuery();if(q.length<2||q!==uiSearchQuery)return false;const base=uiSearchBaseQuery===q?uiSearchBase:[],merged=mergeSearchPlayers(base,uiSearchExternal);if(typeof originals.renderFideResults!=='function')return false;originals.renderFideResults.call(window,merged);decorateSearchResults(merged);return true;
}
function scheduleExternalUiSearch(){
  const q=currentUiSearchQuery(),token=++uiSearchToken;uiSearchQuery=q;uiSearchExternal=[];if(uiSearchTimer){clearTimeout(uiSearchTimer);uiSearchTimer=null;}if(q.length<2){uiSearchBase=[];uiSearchBaseQuery=q;return token;}
  uiSearchTimer=setTimeout(async()=>{try{const ext=await searchExternalPlayers(q,60);if(token!==uiSearchToken||currentUiSearchQuery()!==q)return;uiSearchExternal=ext;renderMergedUiSearch();}catch(err){console.warn('Imported rating-list UI search warning:',err);}},180);return token;
}
function installSearchIntegration(){
  if(typeof window.renderFideResults==='function'&&!window.renderFideResults.__cpQ117R2Wrapped){
    originals.renderFideResults=window.renderFideResults;const wrapped=function(players){const q=currentUiSearchQuery();uiSearchBase=Array.isArray(players)?players.slice():[];uiSearchBaseQuery=q;const merged=q.length>=2&&uiSearchQuery===q?mergeSearchPlayers(uiSearchBase,uiSearchExternal):uiSearchBase,r=originals.renderFideResults.call(this,merged);decorateSearchResults(merged);return r;};wrapped.__cpQ117R2Wrapped=true;wrapped.__cpQ117R2Original=originals.renderFideResults;window.renderFideResults=wrapped;
  }
  if(typeof window.queueFideSearch==='function'&&!window.queueFideSearch.__cpQ117R2Wrapped){
    originals.queueFideSearch=window.queueFideSearch;const wrapped=function(){scheduleExternalUiSearch();return originals.queueFideSearch.apply(this,arguments);};wrapped.__cpQ117R2Wrapped=true;wrapped.__cpQ117R2Original=originals.queueFideSearch;window.queueFideSearch=wrapped;
  }
  refreshCustomUi();return !!window.queueFideSearch?.__cpQ117R2Wrapped;
}
function officialEventType(){try{return window.getTournamentPreferredRatingListType?.()||'std';}catch(_){return 'std';}}
function installRatingModalSequence(){
  if(typeof window.openRatingModal!=='function'||window.openRatingModal.__cpQ117R2Wrapped)return false;originals.openRatingModal=window.openRatingModal;const wrapped=function(player){
    const localId=!validFideId(player?.fideId)?text(player?.playerId):'';if(localId&&currentTournament()?.players?.some(p=>text(p.playerId||p.customPlayerId)===localId)){window.appAlert?.('Player already registered.','Add Player','warning');return;}
    lastPendingPlayer=player;const r=originals.openRatingModal.apply(this,arguments);try{const body=document.querySelector('#ratingModal .modal-body'),std=document.getElementById('ratingStdRadio')?.closest?.('.rating-row');let row=document.getElementById('ratingSequenceRow');if(!row){row=document.createElement('div');row.id='ratingSequenceRow';row.className='rating-row';row.innerHTML='<input id="ratingSequenceRadio" type="radio" name="ratingChoice" value="sequence"><label>Rating List Sequence</label><div id="ratingSequenceValue">0</div>';if(body)body.insertBefore(row,std||body.children[1]||null);}document.querySelectorAll('.cp-external-rating-choice,.cp-rating-source-note').forEach(x=>x.remove());const res=resolveSequenceForPlayer(player,currentTournament()),value=document.getElementById('ratingSequenceValue'),radio=document.getElementById('ratingSequenceRadio');if(value)value.textContent=res.rating>0?`${res.rating} · ${res.label} (recommended)`:'No rating found';if(radio){radio.disabled=res.rating<=0;if(res.rating>0)radio.checked=true;}const hits=mergeRatingHits([],player?.__cpRatingListHits||[]);if(body&&hits.length>1){const note=document.createElement('div');note.className='fide-info cp-rating-source-note';note.textContent='Same player exists in multiple rating lists. Sequence is recommended; choose a specific source below only if needed.';body.insertBefore(note,std||null);}for(const hit of hits){const d=externalDescriptor(hit.listId,currentTournament());if(!d||n(hit.rating)<=0)continue;const x=document.createElement('div');x.className='rating-row cp-external-rating-choice';x.innerHTML=`<input type="radio" name="ratingChoice" value="external:${esc(d.id)}"><label>${esc(d.label)}</label><div>${n(hit.rating)} · ${esc(d.listClass||'Type-B')}</div>`;if(body)body.insertBefore(x,std||null);}}catch(_){ }return r;};wrapped.__cpQ117R2Wrapped=true;wrapped.__cpQ117R2Original=originals.openRatingModal;window.openRatingModal=wrapped;
  if(typeof window.confirmRatingSelection==='function'&&!window.confirmRatingSelection.__cpQ117R2Wrapped){originals.confirmRatingSelection=window.confirmRatingSelection;const confirm=async function(){
    const choice=document.querySelector("input[name='ratingChoice']:checked")?.value;if(choice!=='sequence'&&!String(choice||'').startsWith('external:'))return originals.confirmRatingSelection.apply(this,arguments);const pending=lastPendingPlayer,res=choice==='sequence'?resolveSequenceForPlayer(pending,currentTournament()):resolutionFromExternalHit(pending,String(choice).slice(9),currentTournament());if(!pending||!res||res.rating<=0){window.appAlert?.('No rating is available from the selected rating source.','Add Player','warning');return;}
    const selectedBy=choice==='sequence'?'rating-list-sequence':'explicit-rating-list-selection',eventType=officialEventType(),base=['std','rapid','blitz'].includes(res.sourceType)?res.sourceType:eventType,real=document.getElementById(base==='rapid'?'ratingRapidRadio':base==='blitz'?'ratingBlitzRadio':'ratingStdRadio'),before=(currentTournament()?.players||[]).length,fid=text(pending.fideId),localId=!validFideId(fid)?text(pending.playerId):'',oldBase=Number(pending[base])||0,trueOfficial=Number(pending[eventType])||0;
    if(real)real.checked=true;pending[base]=n(res.rating);
    try{await originals.confirmRatingSelection.apply(this,arguments);}finally{pending[base]=oldBase;}
    const players=currentTournament()?.players||[];let added=validFideId(fid)?[...players].reverse().find(p=>text(p.fideId)===fid):players[before];if(!added||players.length<=before)return;
    added.rating=n(res.rating);added.ratingSource=res.kind===TYPE_B_KIND?'type-b':'custom';added.effectiveRatingSource=res.sourceType||'custom';added.effectiveRatingFallback=false;if(localId){added.playerId=localId;added.customPlayerId=localId;}
    try{if(window.cpBeta57?.assignOfficialRating)window.cpBeta57.assignOfficialRating(added,trueOfficial,{sourceType:eventType,reason:selectedBy});else added.officialRating=trueOfficial;}catch(_){added.officialRating=trueOfficial;}
    attachTournamentProvenance(added,res,{manualOverride:false,selectedBy});try{window.cpBeta57?.syncTournamentProvenance?.(added);}catch(_){ }attachTournamentProvenance(added,res,{manualOverride:false,selectedBy});try{window.saveData?.();if(typeof window.cpPersistCriticalMutation==='function')await window.cpPersistCriticalMutation(selectedBy==='rating-list-sequence'?'Rating List Sequence Tournament Rating':'Explicit Rating List Selection');}catch(_){ }try{window.renderRegistered?.();window.updatePlayerCount?.();}catch(_){ }
  };confirm.__cpQ117R2Wrapped=true;confirm.__cpQ117R2Original=originals.confirmRatingSelection;window.confirmRatingSelection=confirm;}
  return true;
}
function installManualOverrideGuard(){
  if(typeof window.openEditPlayerModal==='function'&&!window.openEditPlayerModal.__cpQ117R1EditWrapped){const original=window.openEditPlayerModal;const wrapped=function(index){lastEditingIndex=Number(index);const r=original.apply(this,arguments);try{const p=currentTournament()?.players?.[lastEditingIndex],el=document.getElementById('editPlayerRatingSources'),rec=p?.ratingProvenance?.tournament;if(el&&[KIND,TYPE_B_KIND].includes(rec?.sourceKind))el.textContent+=`  |  Imported Tournament source: ${rec.sourceListLabel||rec.sourceListId} (${rec.sourceValue})${rec.manualOverride?' · edited manually':''}${rec.sourceListDeleted?' · source list deleted locally':''}`;}catch(_){ }return r;};wrapped.__cpQ117R1EditWrapped=true;wrapped.__cpQ117R1Original=original;window.openEditPlayerModal=wrapped;}
  if(typeof window.saveEditedPlayer==='function'&&!window.saveEditedPlayer.__cpQ117R1Wrapped){const original=window.saveEditedPlayer;const wrapped=async function(){const p=currentTournament()?.players?.[lastEditingIndex],before=n(p?.rating),hadExternal=[KIND,TYPE_B_KIND].includes(p?.ratingProvenance?.tournament?.sourceKind);const r=await original.apply(this,arguments);if(hadExternal&&p&&markExternalManualOverride(p,before)){try{window.saveData?.();if(typeof window.cpPersistCriticalMutation==='function')await window.cpPersistCriticalMutation('Imported Rating Provenance');}catch(_){ }}return r;};wrapped.__cpQ117R1Wrapped=true;wrapped.__cpQ117R1Original=original;window.saveEditedPlayer=wrapped;}
}
function installConsistencyGuard(){const api=window.cpBeta66;if(!api||api.__cpQ117R1Wrapped)return false;const originalRun=api.runCurrent;const guarded=async function(){const t=currentTournament(),seq=restoreSequenceFromShadow(t,{persist:false});if(seq.some(id=>isExternalId(id,t))){const msg='This Rating List Sequence contains imported Type-B/Custom Rating Lists. Automatic official-list consistency checking is not applied to those external lists. Remove them temporarily to run the official FIDE-list consistency check.';window.appAlert?.(msg,'Rating List Sequence','info');return {skipped:true,reason:'external-rating-list-consistency-not-required'};}return originalRun?.();};api.runCurrent=guarded;api.__cpQ117R1Wrapped=true;const btn=document.getElementById('ratingListSequenceCheck');if(btn){const fresh=btn.cloneNode(true);btn.replaceWith(fresh);fresh.addEventListener('click',guarded);}return true;}
function wrapTypeBApi(){
  const api=window.cpBeta81;if(!api||api.__cpQ117R1Wrapped)return false;
  for(const name of ['importTypeB','importOfficialAsTypeB']){const original=api[name];if(typeof original!=='function')continue;api[name]=async function(){const r=await original.apply(this,arguments);typeBCatalogLoaded=false;await refreshTypeBCatalog({force:true});invalidateExternalSearchIndex();refreshCustomUi();return r;};}
  if(typeof api.deleteList==='function'){const original=api.deleteList;api.deleteList=async function(id){await refreshTypeBCatalog();const d=installedTypeBDescriptor(id)||refDescriptor(id,currentTournament());const r=await original.apply(this,arguments);typeBData.delete(text(id).toLowerCase());typeBCatalogLoaded=false;await refreshTypeBCatalog({force:true});invalidateExternalSearchIndex();if(d)for(const t of allTournaments())removeExternalReferenceFromTournament(id,d,t);try{window.saveData?.();}catch(_){ }refreshCustomUi();return r;};}
  api.__cpQ117R1Wrapped=true;return true;
}
function installStyles(){if(typeof document==='undefined'||document.getElementById('cpQ117R1Style'))return;const s=document.createElement('style');s.id='cpQ117R1Style';s.textContent='.cp-external-rating-hits{color:#245a8d;font-weight:600}.cp-custom-lookup-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid #e2e7ec}.cp-custom-lookup-row:last-child{border-bottom:0}.cp-identity-merged{color:#376b3c;font-weight:600}.cp-rating-source-note{margin:4px 0 7px;font-weight:600}';document.head.appendChild(s);}
function install(){
  if(installed)return;installed=true;wrapBeta59();wrapTypeBApi();wrapPreserving('saveAll',refreshSequenceSummary);wrapPreserving('loadAllFields',()=>{restoreSequenceFromShadow();refreshSequenceSummary();refreshCustomUi();preloadSequenceData().catch(()=>{});});wrapPreserving('changeTournament',()=>{restoreSequenceFromShadow();refreshSequenceSummary();refreshCustomUi();preloadSequenceData().catch(()=>{});});wrapPreserving('tournamentRatingTypeChanged',()=>{restoreSequenceFromShadow();refreshSequenceSummary();});installSequenceUi();installCustomUi();installSearchIntegration();installRatingModalSequence();installManualOverrideGuard();installConsistencyGuard();installStyles();
  Promise.resolve().then(async()=>{await loadLibrary();await migrateLegacyTournamentStores();await refreshTypeBCatalog();restoreAllShadows();await preloadSequenceData();refreshCustomUi();}).catch(err=>console.warn('Rating-list library startup warning:',err));
  const timer=setInterval(()=>{installSequenceUi();installCustomUi();installSearchIntegration();installRatingModalSequence();installManualOverrideGuard();installConsistencyGuard();wrapTypeBApi();},300);setTimeout(()=>clearInterval(timer),5000);
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+(?:-r\d+)?/i,`v${VERSION}`);}catch(_){ }try{const ver=document.getElementById('appVersion');if(ver)ver.textContent=`v${VERSION}`;}catch(_){ }try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }refreshSequenceSummary();
}
window.cpBeta98={VERSION,SCHEMA,KIND,TYPE_B_KIND,CLASS,CATALOG_KEY,DATA_PREFIX,REFS_KEY,SEQUENCE_SHADOW_KEY,CATEGORIES,CATEGORY_LABELS,RATING_TYPES,RATING_LABELS,loadLibrary,customCatalog,descriptor,externalDescriptor,rowsFor,rowsForAsync,isCustomId,isTypeBId,isExternalId,cleanSequence,label,setSequence,restoreSequenceFromShadow,parseCustomRows,importCustomList,updateCustomList,deleteCustomList,playerLookup,playerLookupAsync,customRating,externalRating,resolveSequenceForPlayer,attachTournamentProvenance,markCustomManualOverride,markExternalManualOverride,fullCatalogue,migrateLegacyTournamentStores,searchExternalPlayers,externalSearchIndexStats,rebuildExternalSearchIndex,invalidateExternalSearchIndex,mergeSearchPlayers,samePlayerIdentity,bioIdentityKey,resolutionFromExternalHit,preloadSequenceData,refreshTypeBCatalog,refreshSequenceSummary,installSequenceUi,installCustomUi,openCustomManager,openImportDialog,installSearchIntegration,scheduleExternalUiSearch,install};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else if(typeof document!=='undefined')install();
})();
