/* Chess-Publisher v1.06.00-beta.53 — Date-Effective Rating Consistency */
(()=>{
'use strict';
const VERSION='1.06.00-beta.53';
const DAY_MS=86400000;
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const LABELS={std:'Standard',rapid:'Rapid',blitz:'Blitz'};
const PREFIX={std:'standard',rapid:'rapid',blitz:'blitz'};
let lastContext=null;

function validType(type){
  type=String(type||'').toLowerCase();
  if(!Object.prototype.hasOwnProperty.call(PREFIX,type)) throw new Error(`Unsupported FIDE rating list type: ${type||'-'}.`);
  return type;
}
function localDate(value){
  const text=String(value||'').trim();
  if(!text) return null;
  const m=text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if(!m) return null;
  const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]||0),Number(m[5]||0),Number(m[6]||0),0);
  if(Number.isNaN(d.getTime()) || d.getFullYear()!==Number(m[1]) || d.getMonth()!==Number(m[2])-1 || d.getDate()!==Number(m[3])) return null;
  return d;
}
function periodKeyFromDate(value){
  const d=value instanceof Date?value:localDate(value);
  if(!(d instanceof Date)||Number.isNaN(d.getTime())) throw new Error('A valid date is required to select the FIDE rating-list period.');
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function periodLabel(periodKey){
  const m=String(periodKey||'').match(/^(\d{4})-(\d{2})$/);
  if(!m) return String(periodKey||'');
  const d=new Date(Number(m[1]),Number(m[2])-1,1);
  return new Intl.DateTimeFormat('en',{month:'short',year:'numeric'}).format(d);
}
function consistencyTarget(tournament,checkDate=new Date()){
  const s=tournament?.settings||{};
  const start=localDate(s.startDate);
  if(!start) throw new Error('Tournament Start Date is required for a date-effective FIDE consistency check.');
  const end=localDate(s.endDate);
  let durationDays=0;
  if(end){
    if(end.getTime()<start.getTime()) throw new Error('Tournament End Date cannot be earlier than Start Date.');
    durationDays=(end.getTime()-start.getTime())/DAY_MS;
  }
  const longEvent=!!end && durationDays>30;
  const effectiveDate=longEvent?(checkDate instanceof Date?checkDate:new Date(checkDate)):start;
  if(Number.isNaN(effectiveDate.getTime())) throw new Error('The consistency-check date is invalid.');
  return {
    periodKey:periodKeyFromDate(effectiveDate),
    reason:longEvent?'date of check':'tournament start date',
    longEvent,
    durationDays,
    effectiveDate
  };
}
function historicalZipUrl(type,periodKey){
  type=validType(type);
  const m=String(periodKey||'').match(/^(\d{4})-(\d{2})$/);
  if(!m) throw new Error(`Invalid FIDE rating-list period: ${periodKey||'-'}.`);
  const month=Number(m[2]);
  if(month<1||month>12) throw new Error(`Invalid FIDE rating-list month: ${periodKey}.`);
  const yy=String(Number(m[1])%100).padStart(2,'0');
  return `https://ratings.fide.com/download/${PREFIX[type]}_${MONTHS[month-1]}${yy}frl.zip`;
}
function cacheKey(type,periodKey){return `history:${periodKey}:${validType(type)}`;}
function normalizeIds(ids){return [...new Set((ids||[]).map(x=>String(x||'').trim()).filter(x=>/^\d{5,15}$/.test(x)))];}
function parseTargetRatings(text,ids){
  const wanted=new Set(normalizeIds(ids));
  const result=new Map();
  for(const id of wanted) result.set(id,0);
  for(const line of String(text||'').split(/\r?\n/)){
    const id=String(line||'').substring(0,15).trim();
    if(!wanted.has(id)) continue;
    const row=typeof normalizeFideListLine==='function'?normalizeFideListLine(line):null;
    if(row&&String(row.fideId)===id) result.set(id,Number(row.rating)||0);
  }
  return result;
}
async function historyCacheGet(type,periodKey){
  if(typeof openFideCacheDb!=='function') return null;
  const db=await openFideCacheDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('cache','readonly');
    const req=tx.objectStore('cache').get(cacheKey(type,periodKey));
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error||new Error('Historical FIDE cache read failed.'));
  });
}
async function historyCachePut(type,periodKey,ratings,ids,sourceUrl){
  if(typeof openFideCacheDb!=='function') return false;
  const db=await openFideCacheDb();
  const obj={};
  for(const [id,rating] of ratings) obj[id]=Number(rating)||0;
  const snapshot={
    version:1,type:validType(type),periodKey,
    queriedIds:normalizeIds(ids),ratings:obj,
    sourceUrl:String(sourceUrl||''),fetchedAt:new Date().toISOString()
  };
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('cache','readwrite');
    tx.objectStore('cache').put(snapshot,cacheKey(type,periodKey));
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error||new Error('Historical FIDE cache save failed.'));
    tx.onabort=()=>reject(tx.error||new Error('Historical FIDE cache save aborted.'));
  });
}
function cacheCovers(snapshot,ids){
  if(!snapshot||Number(snapshot.version)!==1) return false;
  const have=new Set(Array.isArray(snapshot.queriedIds)?snapshot.queriedIds.map(String):[]);
  return normalizeIds(ids).every(id=>have.has(id));
}
function mapFromSnapshot(snapshot,ids){
  const map=new Map();
  const ratings=snapshot?.ratings&&typeof snapshot.ratings==='object'?snapshot.ratings:{};
  for(const id of normalizeIds(ids)) map.set(id,Number(ratings[id])||0);
  return map;
}
function currentCachePeriod(type){
  return String((typeof fideCacheMeta!=='undefined'?fideCacheMeta:null)?.lists?.[validType(type)]?.periodKey||'');
}
function currentCacheRatings(type,ids){
  type=validType(type);
  const db=(typeof fideMainDb!=='undefined'?fideMainDb:null);
  if(!(db instanceof Map) || !db.size) return null;
  const map=new Map();
  for(const id of normalizeIds(ids)) map.set(id,Number(db.get(id)?.[type])||0);
  return map;
}
async function loadRatings(type,periodKey,ids){
  type=validType(type); ids=normalizeIds(ids);
  if(!ids.length) return {ratings:new Map(),sourceUrl:'',from:'empty'};

  if(currentCachePeriod(type)===periodKey){
    const current=currentCacheRatings(type,ids);
    if(current) return {ratings:current,sourceUrl:'current FIDE cache',from:'current-cache'};
  }

  try{
    const cached=await historyCacheGet(type,periodKey);
    if(cacheCovers(cached,ids)) return {ratings:mapFromSnapshot(cached,ids),sourceUrl:String(cached.sourceUrl||''),from:'historical-cache'};
  }catch(err){ console.warn('Historical FIDE cache read warning:',err); }

  const url=historicalZipUrl(type,periodKey);
  let response;
  try{
    response=await fetch(url,{method:'GET',cache:'no-store',mode:'cors'});
  }catch(err){
    throw new Error(`The required FIDE ${LABELS[type]} list for ${periodLabel(periodKey)} could not be downloaded. The consistency check was not run with a different list.`);
  }
  if(!response.ok) throw new Error(`The required FIDE ${LABELS[type]} list for ${periodLabel(periodKey)} is unavailable (HTTP ${response.status}). The consistency check was not run with a different list.`);
  if(typeof extractFirstTextFromZip!=='function') throw new Error('FIDE ZIP reader is unavailable.');
  const text=await extractFirstTextFromZip(await response.arrayBuffer());
  const ratings=parseTargetRatings(text,ids);
  try{ await historyCachePut(type,periodKey,ratings,ids,url); }catch(err){ console.warn('Historical FIDE cache save warning:',err); }
  return {ratings,sourceUrl:url,from:'official-archive'};
}
function tournamentPlayerFallback(t,id){
  const p=(t?.players||[]).find(x=>String(x?.fideId||'').trim()===id)||{};
  return {fideId:id,name:String(p.name||'').trim(),fed:String(p.fed||'FIDE').trim().toUpperCase()||'FIDE',birth:String(p.birth||'-'),gender:String(p.gender||'')};
}
async function applyDateEffectiveRatings(t,lookup,options,ids,checkDate=new Date()){
  if(!options?.rating) return lookup;
  const type=validType(options.type||'std');
  const target=consistencyTarget(t,checkDate);
  const loaded=await loadRatings(type,target.periodKey,ids);
  const original=lookup?.byId instanceof Map?lookup.byId:new Map();
  const byId=new Map();
  const availableField=type+'Available';
  for(const id of normalizeIds(ids)){
    const base=original.get(id)||tournamentPlayerFallback(t,id);
    const ref={...base};
    const rating=Number(loaded.ratings.get(id))||0;
    ref[type]=rating;
    ref[availableField]=rating>0;
    byId.set(id,ref);
  }
  lookup.byId=byId;
  lookup.ratingPeriodKey=target.periodKey;
  lookup.ratingPeriodReason=target.reason;
  lookup.ratingListType=type;
  lookup.ratingSourceUrl=loaded.sourceUrl;
  lookup.ratingSourceKind=loaded.from;
  lookup.source=`FIDE ${LABELS[type]} ${periodLabel(target.periodKey)} · ${target.reason}`;
  lastContext={type,...target,source:lookup.source,sourceUrl:loaded.sourceUrl,from:loaded.from};
  return lookup;
}
function provenanceSource(type){
  type=validType(type);
  if(lastContext&&lastContext.type===type&&lastContext.periodKey) return `FIDE ${LABELS[type]} ${lastContext.periodKey}`;
  return type;
}
function renderConsistencyPeriod(t=getCurrentTournament?.()){
  const el=document.getElementById('registeredFideEffectivePeriod');
  if(!el) return;
  try{
    const target=consistencyTarget(t,new Date());
    el.textContent=`Consistency list: ${periodLabel(target.periodKey)} · ${target.reason}`;
  }catch(err){
    el.textContent='Consistency list: tournament Start Date required';
  }
}
function install(){
  try{
    for(const id of ['registeredFideUpdateStd','registeredFideUpdateRapid','registeredFideUpdateBlitz']){
      document.getElementById(id)?.addEventListener('change',()=>renderConsistencyPeriod());
    }
    renderConsistencyPeriod();
    document.documentElement.dataset.chesspublisherVersion=VERSION;
  }catch(err){console.warn('beta.53 install warning',err);}
}
window.cpBeta53={VERSION,periodKeyFromDate,periodLabel,consistencyTarget,historicalZipUrl,cacheKey,parseTargetRatings,cacheCovers,mapFromSnapshot,loadRatings,applyDateEffectiveRatings,provenanceSource,renderConsistencyPeriod,get lastContext(){return lastContext;}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
