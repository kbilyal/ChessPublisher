/* Chess-Publisher v1.06.00-beta.72 — Windows Integrated Rating Lists (dev22 architecture) */
(()=>{
'use strict';
const VERSION='1.06.00-beta.72';
const TYPES=['std','rapid','blitz'];
const LABELS={std:'Standard',rapid:'Rapid',blitz:'Blitz'};
const ACTIVE_KEY='rating-lists:active-generation:v3';
const GENERATION_PREFIX='rating-lists:generation:v3:';
const REPORT_KEY='ChessPublisher.RatingLists.LastUpdateReport.v3';
const TITLES=new Set(['GM','IM','WGM','WIM','FM','WFM','CM','WCM']);
const K_VALUES=new Set([10,20,40]);
let lastReport=null;
let ratingWorker=null;
let workerRequest=0;
const directorySearchCache=new Map();
const directorySearchInFlight=new Map();
let directorySearchCacheGeneration='';

function nowIso(){return new Date().toISOString();}
function periodKey(){return typeof currentFidePeriodKey==='function'?currentFidePeriodKey():(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;})();}
function normalizeName(value){
  let text=String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  try{text=text.replace(/[^\p{L}\p{N}]+/gu,' ');}catch(_){text=text.replace(/[^A-Z0-9]+/g,' ');}
  return text.replace(/\s+/g,' ').trim();
}
function nameTokens(value){return normalizeName(value).split(' ').filter(Boolean);}
function tokenPrefixMatch(name,query){
  const q=nameTokens(query); if(!q.length) return false;
  const tokens=nameTokens(name);
  return q.every(term=>tokens.some(token=>token.startsWith(term)));
}
function exactFideId(value){const id=String(value??'').trim();return /^\d{5,15}$/.test(id)?id:'';}
function cloneRow(row){return row?JSON.parse(JSON.stringify(row)):row;}
function cloneMap(source){const out=new Map();for(const [id,row] of source.entries()) out.set(String(id),cloneRow(row));return out;}
function emptyRow(id){return {fideId:String(id),name:'',fed:'FIDE',title:'',gender:'',birth:'-',std:0,rapid:0,blitz:0,stdK:0,rapidK:0,blitzK:0,stdPeriod:'',rapidPeriod:'',blitzPeriod:'',searchKey:'',normalizedName:''};}
function buildSearchFields(row){
  row.normalizedName=normalizeName(row.name||'');
  row.searchKey=normalizeName(`${row.name||''} ${row.fideId||''} ${row.fed||''}`);
  return row;
}
function parseFixedWidthLine(line,type,listPeriod){
  if(!line || line.length<20) return null;
  let base=null;
  try{ if(typeof normalizeFideListLine==='function') base=normalizeFideListLine(line); }catch(_){ }
  const fideId=String(base?.fideId||line.substring(0,15).trim());
  if(!/^\d{5,15}$/.test(fideId)) return null;
  const name=String(base?.name||line.substring(15,76).trim()).trim();
  if(!name) return null;
  const tail=line.substring(76).trim();
  const tokens=tail.split(/\s+/).filter(Boolean);
  let rating=Number(base?.rating)||0;
  let ratingIndex=-1;
  for(let i=0;i<tokens.length;i++){
    if(!/^\d+$/.test(tokens[i])) continue;
    const n=Number(tokens[i]);
    if(n>=100&&n<=3300){rating=n;ratingIndex=i;break;}
  }
  if(!(rating>=100&&rating<=3300)) return null;
  let fed=String(base?.fed||'FIDE').toUpperCase();
  if(!fed||fed==='FIDE'){
    const token=tokens.find(x=>/^[A-Z]{3}$/.test(x)&&!TITLES.has(x));
    if(token) fed=token;
  }
  let title='';
  const beforeRating=ratingIndex>=0?tokens.slice(0,ratingIndex):tokens;
  for(const token of beforeRating){const t=String(token).toUpperCase();if(TITLES.has(t)){title=t;break;}}
  let gender=String(base?.gender||'').toLowerCase();
  if(!gender){for(const token of beforeRating){const t=String(token).toUpperCase();if(t==='M'||t==='F'){gender=t.toLowerCase();break;}}}
  let birth=String(base?.birth||'-');
  if(!/^\d{4}$/.test(birth)){
    birth='-';
    for(let i=tokens.length-1;i>ratingIndex;i--){if(/^\d{4}$/.test(tokens[i])){const y=Number(tokens[i]);if(y>=1900&&y<=2035){birth=String(y);break;}}}
  }
  let k=0;
  const numericAfter=[];
  for(let i=Math.max(0,ratingIndex+1);i<tokens.length;i++){
    if(/^\d+$/.test(tokens[i])){
      const n=Number(tokens[i]);
      if(n>=1900&&n<=2035) break;
      numericAfter.push(n);
    }
  }
  if(numericAfter.length>=2 && K_VALUES.has(numericAfter[1])) k=numericAfter[1];
  else { for(let i=1;i<numericAfter.length;i++){if(K_VALUES.has(numericAfter[i])){k=numericAfter[i];break;}} }
  return {fideId,name,fed,title,gender,birth,rating,k,period:listPeriod,type};
}
async function parseListIntoMap(text,type,target,listPeriod,options={}){
  if(!TYPES.includes(type)) throw new Error(`Unsupported list type ${type}.`);
  const lines=String(text||'').split(/\r?\n/);
  const seen=new Set();
  let duplicates=0,parsed=0;
  const chunk=Number(options.chunkSize)||5000;
  for(let start=0;start<lines.length;start+=chunk){
    const end=Math.min(lines.length,start+chunk);
    for(let i=start;i<end;i++){
      const item=parseFixedWidthLine(lines[i],type,listPeriod);
      if(!item) continue;
      let row=target.get(item.fideId);
      if(!row){row=emptyRow(item.fideId);target.set(item.fideId,row);}
      row.name=item.name||row.name;
      row.fed=item.fed||row.fed||'FIDE';
      if(item.title) row.title=item.title;
      if(item.gender) row.gender=item.gender;
      if(item.birth&&item.birth!=='-') row.birth=item.birth;
      row[type]=item.rating;
      row[`${type}K`]=Number(item.k)||0;
      row[`${type}Period`]=listPeriod;
      buildSearchFields(row);
      if(seen.has(item.fideId)) duplicates++; else {seen.add(item.fideId);parsed++;}
    }
    if(options.progress) options.progress({type,parsed,percent:Math.round(end/Math.max(1,lines.length)*100)});
    if(!options.synchronous) await new Promise(resolve=>setTimeout(resolve,0));
  }
  return {type,parsed,duplicates,lines:lines.length};
}
function countsForMap(map){let std=0,rapid=0,blitz=0;for(const p of map.values()){if(Number(p.std)>0)std++;if(Number(p.rapid)>0)rapid++;if(Number(p.blitz)>0)blitz++;}return {std,rapid,blitz,unique:map.size};}
function minimumSafeCount(type,oldCounts,options={}){
  if(options.minimumRecords!=null) return Math.max(1,Number(options.minimumRecords)||1);
  const previous=Number(oldCounts?.[type])||0;
  return previous>=100?Math.max(1000,Math.floor(previous*0.25)):1000;
}
function validateGeneration(map,parseResults,oldCounts,options={}){
  if(!(map instanceof Map) || !map.size) throw new Error('Temporary rating-list index is empty.');
  const counts=countsForMap(map);
  for(const type of TYPES){
    const result=parseResults[type];
    if(!result) throw new Error(`${LABELS[type]} was not parsed.`);
    const minimum=minimumSafeCount(type,oldCounts,options);
    if(Number(result.parsed)<minimum) throw new Error(`${LABELS[type]} parsed only ${result.parsed} records; minimum safe count is ${minimum}.`);
    if(Number(counts[type])!==Number(result.parsed)) throw new Error(`${LABELS[type]} index count mismatch (${counts[type]} vs ${result.parsed}).`);
  }
  let sampled=0;
  for(const [id,row] of map.entries()){
    if(!/^\d{5,15}$/.test(String(id))) throw new Error(`Invalid FIDE ID in temporary index: ${id}.`);
    if(String(row.fideId)!==String(id)) throw new Error(`FIDE ID key mismatch for ${id}.`);
    if(!row.name) throw new Error(`Player ${id} has no name.`);
    sampled++; if(sampled>=5000) break;
  }
  return counts;
}
async function sha256Text(text){
  const bytes=new TextEncoder().encode(String(text||''));
  try{
    if(globalThis.crypto?.subtle){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return [...digest].map(x=>x.toString(16).padStart(2,'0')).join('');}
  }catch(_){ }
  return typeof fideHashBytes==='function'?fideHashBytes(bytes):`${bytes.length}`;
}
function generationId(period,checksums){
  const short=TYPES.map(t=>String(checksums[t]||'').replace(/[^a-f0-9]/gi,'').slice(0,8)).join('').slice(0,18)||String(Date.now());
  return `${period}-${short}-${Date.now().toString(36)}`;
}
function rowsFromMap(map){return [...map.values()].map(p=>({
  fideId:String(p.fideId||''),name:String(p.name||''),fed:String(p.fed||'FIDE'),title:String(p.title||''),gender:String(p.gender||''),birth:String(p.birth||'-'),
  std:Number(p.std)||0,rapid:Number(p.rapid)||0,blitz:Number(p.blitz)||0,stdK:Number(p.stdK)||0,rapidK:Number(p.rapidK)||0,blitzK:Number(p.blitzK)||0,
  stdPeriod:String(p.stdPeriod||''),rapidPeriod:String(p.rapidPeriod||''),blitzPeriod:String(p.blitzPeriod||''),searchKey:String(p.searchKey||''),normalizedName:String(p.normalizedName||'')
}));}
function mapFromRows(rows){const map=new Map();for(const raw of (Array.isArray(rows)?rows:[])){const id=String(raw?.fideId||'').trim();if(!/^\d{5,15}$/.test(id))continue;const row={...emptyRow(id),...raw,fideId:id};buildSearchFields(row);map.set(id,row);}return map;}
async function cacheGet(key){const db=await openFideCacheDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(FIDE_CACHE_STORE,'readonly');const req=tx.objectStore(FIDE_CACHE_STORE).get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error||new Error('Rating-list cache read failed.'));});}
async function cacheDelete(key){const db=await openFideCacheDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(FIDE_CACHE_STORE,'readwrite');tx.objectStore(FIDE_CACHE_STORE).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error('Rating-list cache cleanup failed.'));tx.onabort=()=>reject(tx.error||new Error('Rating-list cache cleanup aborted.'));});}
async function commitGeneration(snapshot,previousPointer=null){
  const db=await openFideCacheDb();
  const generationKey=GENERATION_PREFIX+snapshot.generationId;
  const pointer={schema:3,generationId:snapshot.generationId,generationKey,previousGenerationKey:previousPointer?.generationKey||'',activatedAt:nowIso(),periodKey:snapshot.meta?.periodKey||''};
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(FIDE_CACHE_STORE,'readwrite');
    const store=tx.objectStore(FIDE_CACHE_STORE);
    store.put(snapshot,generationKey);
    store.put(pointer,ACTIVE_KEY);
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error||new Error('Atomic rating-list generation swap failed.'));
    tx.onabort=()=>reject(tx.error||new Error('Atomic rating-list generation swap aborted.'));
  });
  // Retain the immediately previous complete generation for diagnosis/rollback; older generations may be cleaned later.
  return pointer;
}
function applyGeneration(snapshot){
  const map=mapFromRows(snapshot.rows);
  fideMainDb.clear();
  for(const [id,row] of map.entries()) fideMainDb.set(id,row);
  const normalized=typeof normalizeFideCacheMeta==='function'?normalizeFideCacheMeta(snapshot.meta):snapshot.meta;
  normalized.generationId=String(snapshot.generationId||'');
  normalized.schema=3;
  normalized.verified=!!snapshot.verified;
  normalized.totalPlayers=map.size;
  normalized.lastReport=snapshot.report||null;
  fideCacheMeta=normalized;
  syncWorker();
  try{const fastCounts={std:Number(normalized?.lists?.std?.parsedCount)||0,rapid:Number(normalized?.lists?.rapid?.parsedCount)||0,blitz:Number(normalized?.lists?.blitz?.parsedCount)||0,unique:map.size};updateFideCounts(fastCounts);refreshFidePeriodBadges();}catch(_){ }
  updatePanel();
  return map.size;
}
async function persistActiveGeneration(){
  const pointer=await cacheGet(ACTIVE_KEY);
  if(!pointer?.generationKey) return false;
  const current=await cacheGet(pointer.generationKey);
  if(!current) return false;
  current.rows=rowsFromMap(fideMainDb);
  current.meta={...JSON.parse(JSON.stringify(fideCacheMeta)),generationId:pointer.generationId};
  current.savedAt=nowIso();
  const db=await openFideCacheDb();
  await new Promise((resolve,reject)=>{const tx=db.transaction(FIDE_CACHE_STORE,'readwrite');tx.objectStore(FIDE_CACHE_STORE).put(current,pointer.generationKey);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error('Rating-list generation save failed.'));});
  return true;
}
const originalRestore=typeof restoreFideCache==='function'?restoreFideCache:null;
async function restoreGeneration(){
  try{
    const pointer=await cacheGet(ACTIVE_KEY);
    if(pointer?.generationKey){
      const snapshot=await cacheGet(pointer.generationKey);
      if(snapshot?.rows?.length){applyGeneration(snapshot);updateFideAutoStatus(`generation ${snapshot.generationId}`);return true;}
    }
  }catch(err){console.warn('Rating-list generation restore failed:',err);}
  // One-time migration from the pre-dev22 snapshot format.
  if(originalRestore){
    const restored=await originalRestore();
    if(restored&&fideMainDb.size){
      try{
        const meta={...JSON.parse(JSON.stringify(fideCacheMeta)),generationId:`legacy-${Date.now().toString(36)}`,schema:3,verified:true};
        const snapshot={schema:3,generationId:meta.generationId,savedAt:nowIso(),verified:true,meta,rows:rowsFromMap(fideMainDb),report:{status:'MIGRATED',updatedAt:nowIso()}};
        await commitGeneration(snapshot,null);
        fideCacheMeta={...meta,totalPlayers:fideMainDb.size};
        updatePanel();
      }catch(err){console.warn('Legacy rating-list cache migration warning:',err);}
    }
    return restored;
  }
  return false;
}
function reportText(report){
  if(!report) return 'No Rating Lists update report is available yet.';
  const lines=['Rating Lists Update'];
  for(const type of TYPES){const r=report.lists?.[type]||{};lines.push(`${LABELS[type]}: ${r.status||'UNKNOWN'}${r.count!=null?` — ${Number(r.count).toLocaleString('en-US')} records`:''}${r.period?` · ${r.period}`:''}`);}
  lines.push(`Unique indexed players: ${Number(report.uniquePlayers||0).toLocaleString('en-US')}`);
  lines.push(`Generation: ${report.generationId||report.periodKey||'—'}`);
  lines.push(`Status: ${report.status||'UNKNOWN'}`);
  if(report.previousGeneration) lines.push(`Previous generation: ${report.previousGeneration}`);
  if(report.error) lines.push(`Reason: ${report.error}`);
  if(report.updatedAt) lines.push(`Updated: ${report.updatedAt}`);
  return lines.join('\n');
}
function saveReport(report){lastReport=report;try{localStorage.setItem(REPORT_KEY,JSON.stringify(report));}catch(_){ }updatePanel();}
function loadReport(){if(lastReport)return lastReport;try{const raw=localStorage.getItem(REPORT_KEY);if(raw)lastReport=JSON.parse(raw);}catch(_){ }return lastReport;}
function rollbackReport(previousPointer,error,lists={}){
  const report={schema:3,status:'ROLLED BACK',updatedAt:nowIso(),generationId:'',previousGeneration:String(previousPointer?.generationId||fideCacheMeta?.generationId||''),uniquePlayers:fideMainDb.size,lists:{},error:String(error?.message||error||'Update failed.')};
  for(const type of TYPES) report.lists[type]={status:lists[type]?.status||'FAILED',count:lists[type]?.count??null,period:lists[type]?.period||periodKey(),checksum:lists[type]?.checksum||''};
  saveReport(report);return report;
}
async function fetchTextsFromWindowsLocalUpdater(){
  const response=await fetch('http://127.0.0.1:18765/fide-update',{method:'POST'});
  const update=await response.json().catch(()=>({}));
  if(!response.ok||!update.ok) throw new Error(update.error||'Windows local FIDE updater failed.');
  const out={};
  for(const type of TYPES){
    const r=await fetch(`http://127.0.0.1:18765/fide/${type}`,{cache:'no-store'});
    if(!r.ok) throw new Error(`${LABELS[type]} local list could not be read (HTTP ${r.status}).`);
    const text=await r.text();
    if(text.length<1000) throw new Error(`${LABELS[type]} local list is empty or incomplete.`);
    out[type]={text,source:'Windows local FIDE updater'};
  }
  return out;
}
async function fetchTextsDirect(){
  const out={};
  for(const type of TYPES){
    if(typeof fetchFideZip!=='function'||typeof extractFirstTextFromZip!=='function') throw new Error('FIDE network downloader is unavailable.');
    const d=await fetchFideZip(type);const text=await extractFirstTextFromZip(d.buffer);
    if(text.length<1000) throw new Error(`${LABELS[type]} downloaded list is empty or incomplete.`);
    out[type]={text,source:d.source||'FIDE download'};
  }
  return out;
}
async function acquireAllTexts(options={}){
  if(options.stagedTexts){const out={};for(const type of TYPES){const value=options.stagedTexts[type];if(typeof value==='string')out[type]={text:value,source:'test fixture'};else out[type]=value;}return out;}
  if(typeof isLocalEnginePage==='function'&&isLocalEnginePage()){
    try{return await fetchTextsFromWindowsLocalUpdater();}catch(err){if(options.noNetworkFallback)throw err;console.warn('Windows local rating-list updater unavailable, trying network staging:',err);}
  }
  return await fetchTextsDirect();
}
async function buildGenerationFromTexts(texts,options={}){
  const period=String(options.periodKey||periodKey());
  const temp=new Map();
  const oldCounts=countsForMap(fideMainDb);
  const parseResults={},checksums={},listReport={};
  for(const type of TYPES){
    const entry=texts?.[type];
    if(!entry||typeof entry.text!=='string') throw new Error(`${LABELS[type]} staged payload is missing.`);
    if(entry.text.length<50) throw new Error(`${LABELS[type]} staged payload is empty.`);
    checksums[type]=await sha256Text(entry.text);
    const result=await parseListIntoMap(entry.text,type,temp,period,{synchronous:!!options.synchronous,chunkSize:options.chunkSize,progress:({percent,parsed})=>{try{updateFideAutoStatus(`staging ${LABELS[type]} ${percent}% · ${parsed}`);}catch(_){}}});
    parseResults[type]=result;
    listReport[type]={status:'PASS',count:result.parsed,period,checksum:checksums[type],source:entry.source||'staged data'};
  }
  const counts=validateGeneration(temp,parseResults,oldCounts,options);
  const id=generationId(period,checksums);
  const meta={periodKey:period,updatedAt:nowIso(),source:'Integrated Rating Lists',generationId:id,schema:3,verified:true,lists:{}};
  for(const type of TYPES) meta.lists[type]={periodKey:period,hash:checksums[type],checksum:checksums[type],updatedAt:meta.updatedAt,source:listReport[type].source,parsedCount:parseResults[type].parsed,verified:true};
  const report={schema:3,status:'ACTIVE',updatedAt:meta.updatedAt,generationId:id,periodKey:period,uniquePlayers:counts.unique,lists:listReport};
  const snapshot={schema:3,generationId:id,savedAt:meta.updatedAt,verified:true,meta,rows:rowsFromMap(temp),report};
  return {snapshot,temp,report,counts,parseResults,checksums};
}
async function updateRatingLists(options={}){
  if(fideBackgroundUpdateRunning) return false;
  const previousPointer=await cacheGet(ACTIVE_KEY).catch(()=>null);
  const previousGeneration=String(previousPointer?.generationId||fideCacheMeta?.generationId||'');
  fideBackgroundUpdateRunning=true;fideImportInProgress=true;
  try{
    try{document.getElementById('btnAutoUpdateFide')?.setAttribute('disabled','disabled');}catch(_){ }
    updateFideAutoStatus('staging Standard / Rapid / Blitz…');
    const texts=await acquireAllTexts(options);
    const built=await buildGenerationFromTexts(texts,options);
    built.report.previousGeneration=previousGeneration;
    built.snapshot.report=built.report;
    updateFideAutoStatus('integrity verified · activating generation…');
    await commitGeneration(built.snapshot,previousPointer);
    // Only now may the live installation-local database change.
    applyGeneration(built.snapshot);
    saveReport(built.report);
    setStatus(`Rating Lists updated atomically · ${built.counts.unique.toLocaleString('en-US')} indexed players · ${built.snapshot.generationId}`);
    if(options.manual!==false){try{appAlert(reportText(built.report),'Integrated Rating Lists','info');}catch(_){ }}
    return true;
  }catch(err){
    console.error('Atomic Rating Lists update failed; previous generation preserved.',err);
    const report=rollbackReport(previousPointer,err);
    updateFideAutoStatus(`rollback · ${previousGeneration||'previous database'} kept`);
    setStatus(`Rating Lists update rolled back: ${report.error}`);
    if(options.manual!==false){try{appAlert(reportText(report),'Integrated Rating Lists','warning');}catch(_){ }}
    return false;
  }finally{
    fideImportInProgress=false;fideBackgroundUpdateRunning=false;
    try{document.getElementById('btnAutoUpdateFide')?.removeAttribute('disabled');}catch(_){ }
    updatePanel();
  }
}
async function manualAtomicImport(filesByType,options={}){
  const requested=TYPES.filter(t=>filesByType?.[t]);
  if(!requested.length) throw new Error('No recognized FIDE rating lists were selected.');
  const pointer=await cacheGet(ACTIVE_KEY).catch(()=>null);
  const current=pointer?.generationKey?await cacheGet(pointer.generationKey).catch(()=>null):null;
  const temp=current?.rows?.length?mapFromRows(current.rows):cloneMap(fideMainDb);
  const period=String(options.periodKey||periodKey());
  const parseResults={},checksums={},lists={};
  for(const type of requested){
    const file=filesByType[type];const text=typeof file==='string'?file:await file.text();
    const before=cloneMap(temp);for(const row of temp.values()){row[type]=0;row[`${type}K`]=0;row[`${type}Period`]='';}
    try{
      const result=await parseListIntoMap(text,type,temp,period,{synchronous:!!options.synchronous});
      const minimum=options.minimumRecords??(countsForMap(before)[type]>=100?Math.max(1000,Math.floor(countsForMap(before)[type]*0.25)):1000);
      if(result.parsed<minimum) throw new Error(`${LABELS[type]} parsed only ${result.parsed} records; minimum safe count is ${minimum}.`);
      parseResults[type]=result;checksums[type]=await sha256Text(text);lists[type]={status:'PASS',count:result.parsed,period,checksum:checksums[type],source:'Manual import'};
    }catch(err){throw new Error(`${LABELS[type]} manual import failed: ${err?.message||err}`);}
  }
  // Every requested list succeeded before any active-state change.
  const counts=countsForMap(temp);const id=generationId(period,{std:checksums.std||fideCacheMeta?.lists?.std?.hash,rapid:checksums.rapid||fideCacheMeta?.lists?.rapid?.hash,blitz:checksums.blitz||fideCacheMeta?.lists?.blitz?.hash});
  const oldMeta=JSON.parse(JSON.stringify(fideCacheMeta||{}));
  const meta=typeof normalizeFideCacheMeta==='function'?normalizeFideCacheMeta(oldMeta):oldMeta;meta.generationId=id;meta.schema=3;meta.verified=true;meta.updatedAt=nowIso();meta.periodKey=period;
  for(const type of requested) meta.lists[type]={periodKey:period,hash:checksums[type],checksum:checksums[type],updatedAt:meta.updatedAt,source:'Manual import',parsedCount:parseResults[type].parsed,verified:true};
  const report={schema:3,status:'ACTIVE',updatedAt:meta.updatedAt,generationId:id,periodKey:period,previousGeneration:String(pointer?.generationId||''),uniquePlayers:counts.unique,lists:{}};
  for(const type of TYPES) report.lists[type]=lists[type]||{status:'KEPT',count:counts[type],period:String(meta.lists?.[type]?.periodKey||''),checksum:String(meta.lists?.[type]?.hash||'')};
  const snapshot={schema:3,generationId:id,savedAt:meta.updatedAt,verified:true,meta,rows:rowsFromMap(temp),report};
  await commitGeneration(snapshot,pointer);applyGeneration(snapshot);saveReport(report);return {snapshot,report,counts};
}
async function safeSingleImport(event,type){
  const input=event?.target;const file=input?.files?.[0];if(!file)return;
  try{fideImportInProgress=true;const result=await manualAtomicImport({[type]:file});appAlert(reportText(result.report),'Integrated Rating Lists','info');}catch(err){rollbackReport(await cacheGet(ACTIVE_KEY).catch(()=>null),err);appAlert(`Rating list import rolled back.\n\n${err?.message||err}`,'Integrated Rating Lists','warning');}finally{fideImportInProgress=false;if(input)input.value='';updatePanel();}
}
async function safeAllImport(event){
  const input=event?.target;const files=[...(input?.files||[])];if(!files.length)return;
  const byType={};for(const file of files){const type=typeof detectRatingListType==='function'?detectRatingListType(file.name):null;if(type)byType[type]=file;}
  try{fideImportInProgress=true;const result=await manualAtomicImport(byType);appAlert(reportText(result.report),'Integrated Rating Lists','info');}catch(err){rollbackReport(await cacheGet(ACTIVE_KEY).catch(()=>null),err);appAlert(`Rating list import rolled back.\n\n${err?.message||err}`,'Integrated Rating Lists','warning');}finally{fideImportInProgress=false;if(input)input.value='';updatePanel();}
}
function snapshotPlayer(ref){
  const id=String(ref?.fideId||'').trim();const row=fideMainDb.get(id)||ref||{};
  return {generationId:String(fideCacheMeta?.generationId||''),periodKey:String(fideCacheMeta?.periodKey||''),std:Number(row.std)||0,rapid:Number(row.rapid)||0,blitz:Number(row.blitz)||0,stdK:Number(row.stdK)||0,rapidK:Number(row.rapidK)||0,blitzK:Number(row.blitzK)||0,stdPeriod:String(row.stdPeriod||fideCacheMeta?.lists?.std?.periodKey||''),rapidPeriod:String(row.rapidPeriod||fideCacheMeta?.lists?.rapid?.periodKey||''),blitzPeriod:String(row.blitzPeriod||fideCacheMeta?.lists?.blitz?.periodKey||'')};
}
function reviewChanges(tournament=typeof getCurrentTournament==='function'?getCurrentTournament():null){
  const changes=[];
  for(const p of (tournament?.players||[])){
    const id=exactFideId(p?.fideId);if(!id)continue;const ref=fideMainDb.get(id);if(!ref)continue;
    const old=p.ratingListSnapshot||{};const fields=[];
    for(const [type,label] of [['std','Standard'],['rapid','Rapid'],['blitz','Blitz']]){
      const before=Number(old[type]);const after=Number(ref[type])||0;
      if(Number.isFinite(before)&&before!==after) fields.push({type,label,before,after});
    }
    if(fields.length) changes.push({fideId:id,name:String(p.name||ref.name||id),fields});
  }
  return changes;
}
function ensureReviewModal(){
  if(document.getElementById('ratingListReviewModal'))return;
  const modal=document.createElement('div');modal.id='ratingListReviewModal';modal.className='modal-overlay';modal.style.display='none';
  modal.innerHTML=`<div class="modal-box" style="width:min(760px,92vw)"><div class="modal-titlebar">Review Player Updates</div><div style="padding:12px"><div id="ratingListReviewSummary" class="import-summary"></div><pre id="ratingListReviewBody" style="max-height:420px;overflow:auto;white-space:pre-wrap;background:#fafafa;border:1px solid #ddd;padding:10px"></pre><div class="modal-actions"><button onclick="cpBeta72RatingLists.closeReview()">Close</button><button class="primary" onclick="cpBeta72RatingLists.openApplyDialog()">Apply Selected Updates…</button></div></div></div>`;
  document.body.appendChild(modal);
}
function reviewPlayerUpdates(){
  const t=typeof getCurrentTournament==='function'?getCurrentTournament():null;if(!t){appAlert('No tournament is open.','Review Player Updates','warning');return [];}
  const changes=reviewChanges(t);ensureReviewModal();
  const lines=[];for(const item of changes){lines.push(`${item.name} · FIDE ${item.fideId}`);for(const f of item.fields)lines.push(`${f.label}: ${f.before} → ${f.after}`);lines.push('');}
  const body=document.getElementById('ratingListReviewBody');if(body)body.textContent=lines.join('\n')||'No stored rating-list snapshot differs from the active local generation.';
  const summary=document.getElementById('ratingListReviewSummary');if(summary)summary.textContent=`${changes.length} registered player(s) have reference-rating changes. Nothing has been applied.`;
  document.getElementById('ratingListReviewModal').style.display='flex';return changes;
}
function closeReview(){const el=document.getElementById('ratingListReviewModal');if(el)el.style.display='none';}
function openApplyDialog(){closeReview();if(typeof openRegisteredPlayersFideUpdateDialog==='function')openRegisteredPlayersFideUpdateDialog();}
function showLastReport(){const report=loadReport()||fideCacheMeta?.lastReport||null;appAlert(reportText(report),'Rating Lists Update Report',report?.status==='ROLLED BACK'?'warning':'info');}
function listStatus(type){const meta=fideCacheMeta?.lists?.[type]||{};const count=Number(meta.parsedCount)||0;return {status:meta.verified===false?'UNVERIFIED':meta.periodKey?'READY':'NOT LOADED',period:String(meta.periodKey||''),count,checksum:String(meta.checksum||meta.hash||''),updatedAt:String(meta.updatedAt||'')};}
function updatePanel(){
  if(typeof document==='undefined')return;
  for(const type of TYPES){const s=listStatus(type);const ids={std:'Std',rapid:'Rapid',blitz:'Blitz'}[type];const status=document.getElementById(`ratingLists${ids}Status`);const date=document.getElementById(`ratingLists${ids}Date`);const count=document.getElementById(`ratingLists${ids}Count`);if(status)status.textContent=s.status;if(date)date.textContent=s.period||'—';if(count)count.textContent=Number(s.count).toLocaleString('en-US');}
  const total=document.getElementById('ratingListsTotalPlayers');if(total)total.textContent=Number(fideCacheMeta?.totalPlayers||fideMainDb.size||0).toLocaleString('en-US');
  const generation=document.getElementById('ratingListsGeneration');if(generation)generation.textContent=String(fideCacheMeta?.generationId||'—');
  const updated=document.getElementById('ratingListsUpdatedAt');if(updated)updated.textContent=String(fideCacheMeta?.updatedAt||'—');
  const verified=document.getElementById('ratingListsVerified');if(verified)verified.textContent=fideCacheMeta?.verified?'Verified':'Not verified';
}
function installPanel(){
  const button=document.getElementById('btnAutoUpdateFide');if(button){button.textContent='Update Rating Lists';button.onclick=()=>updateRatingLists({manual:true});}
  const review=document.getElementById('btnUpdateRegisteredFromFide');if(review){review.textContent='Review Player Updates';review.onclick=reviewPlayerUpdates;}
  const cluster=button?.closest('.button-cluster');if(cluster){const title=cluster.querySelector('.button-cluster-title');if(title)title.textContent='Integrated Rating Lists';if(!document.getElementById('integratedRatingListsPanel')){const panel=document.createElement('div');panel.id='integratedRatingListsPanel';panel.className='rating-lists-integrated-panel';panel.innerHTML=`<div class="rating-lists-grid"><b>List</b><b>Status</b><b>Period</b><b>Players</b><span>Standard</span><span id="ratingListsStdStatus">—</span><span id="ratingListsStdDate">—</span><span id="ratingListsStdCount">0</span><span>Rapid</span><span id="ratingListsRapidStatus">—</span><span id="ratingListsRapidDate">—</span><span id="ratingListsRapidCount">0</span><span>Blitz</span><span id="ratingListsBlitzStatus">—</span><span id="ratingListsBlitzDate">—</span><span id="ratingListsBlitzCount">0</span></div><div class="toolbar" style="margin-top:6px"><button type="button" onclick="cpBeta72RatingLists.showLastReport()">View Last Update Report</button></div><div class="help" style="margin-top:5px">Updated: <span id="ratingListsUpdatedAt">—</span> · <span id="ratingListsVerified">Not verified</span><br>Total local indexed players: <b id="ratingListsTotalPlayers">0</b><br>Active generation: <code id="ratingListsGeneration">—</code></div>`;cluster.appendChild(panel);}}
  const local=[...document.querySelectorAll('.button-cluster-title')].find(el=>el.textContent.trim()==='Local Lists');if(local)local.textContent='Manual Rating List Import (Advanced)';
  const modalTitle=document.querySelector('#registeredFideUpdateModal .modal-titlebar');if(modalTitle)modalTitle.textContent='Review Player Updates — Apply Selected Fields';
  const testBtn=document.getElementById('registeredFideUpdateTest');if(testBtn)testBtn.textContent='Preview Changes';
  const applyBtn=document.getElementById('registeredFideUpdateApply');if(applyBtn)applyBtn.textContent='Apply Selected Updates';
  ensureReviewModal();updatePanel();
}
function installStyles(){
  if(document.getElementById('cp-beta72-rating-lists-style'))return;const style=document.createElement('style');style.id='cp-beta72-rating-lists-style';style.textContent=`.rating-lists-integrated-panel{margin-top:6px;padding-top:6px;border-top:1px solid rgba(0,0,0,.12)}.rating-lists-grid{display:grid;grid-template-columns:minmax(80px,1fr) minmax(72px,.8fr) minmax(70px,.8fr) minmax(70px,.8fr);gap:3px 8px;align-items:center;font-size:11px}.rating-lists-grid>b{font-size:10px;text-transform:uppercase;letter-spacing:.03em;opacity:.72}.rating-lists-grid>span:nth-child(4n+4){text-align:right;font-variant-numeric:tabular-nums}`;document.head.appendChild(style);
}
function clearDirectorySearchCache(){directorySearchCache.clear();directorySearchInFlight.clear();directorySearchCacheGeneration=String(fideCacheMeta?.generationId||'');}
function searchCacheKey(query,limit){return `${String(fideCacheMeta?.generationId||'')}|${normalizeName(query)}|${Math.max(1,Math.min(60,Number(limit)||60))}`;}
function rememberDirectorySearch(key,rows){directorySearchCache.set(key,(rows||[]).map(cloneRow));while(directorySearchCache.size>48){const first=directorySearchCache.keys().next().value;directorySearchCache.delete(first);}return rows;}
function mergeDirectoryWithMonthly(player){
  const id=String(player?.fideId||'').trim();const monthly=id?fideMainDb.get(id):null;
  if(!monthly)return buildSearchFields({...player,fideId:id||String(player?.fideId||''),fed:String(player?.fed||'FIDE').toUpperCase()});
  const merged={...player,...monthly};
  if(!monthly.name&&player?.name)merged.name=player.name;if(!monthly.fed&&player?.fed)merged.fed=player.fed;
  if((!monthly.birth||monthly.birth==='-')&&player?.birth)merged.birth=player.birth;
  if(!monthly.gender&&player?.gender)merged.gender=player.gender;
  if(!monthly.title&&player?.title)merged.title=player.title;
  return buildSearchFields(merged);
}
async function searchLocalAsync(query,limit=60,requestId=0){
  const raw=String(query||'').trim(),id=exactFideId(raw);if(id){const row=fideMainDb.get(id);return row?[cloneRow(row)]:[];}
  if(normalizeName(raw).length<2)return [];
  const out=[];let scanned=0;
  for(const row of fideMainDb.values()){
    if(requestId&&requestId!==latestSearchRequest)return [];
    if(tokenPrefixMatch(`${row.name||''} ${row.fed||''}`,raw)){out.push(cloneRow(row));if(out.length>=limit)break;}
    scanned++;if(scanned%4000===0&&typeof setTimeout==='function')await new Promise(resolve=>setTimeout(resolve,0));
  }
  return out;
}
async function searchDirectory(query,limit=60,{requestId=0,refresh=false}={}){
  const raw=String(query||'').trim();if(raw.length<2)return [];
  const id=exactFideId(raw);if(id){
    const monthly=fideMainDb.get(id);if(monthly)return [cloneRow(monthly)];
    if(typeof isLocalEnginePage==='function'&&isLocalEnginePage()){
      try{const response=await fetchLocalEngine('/fide/players-lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fideIds:[id]})},0);if(response.ok){const payload=await response.json().catch(()=>({}));return (Array.isArray(payload.players)?payload.players:[]).map(mergeDirectoryWithMonthly).slice(0,limit);}}catch(err){console.warn('FIDE exact player lookup unavailable:',err?.message||err);}
    }
    return [];
  }
  const generation=String(fideCacheMeta?.generationId||'');if(directorySearchCacheGeneration!==generation)clearDirectorySearchCache();
  const key=searchCacheKey(raw,limit);if(!refresh&&directorySearchCache.has(key))return directorySearchCache.get(key).map(cloneRow);
  if(directorySearchInFlight.has(key))return (await directorySearchInFlight.get(key)).map(cloneRow);
  const task=(async()=>{
    let rows=[];
    if(typeof isLocalEnginePage==='function'&&isLocalEnginePage()){
      try{
        const response=await fetchLocalEngine('/fide/players-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:raw,limit:Math.max(1,Math.min(60,Number(limit)||60))})},0);
        if(response.ok){const payload=await response.json().catch(()=>({}));rows=(Array.isArray(payload.players)?payload.players:[]).map(mergeDirectoryWithMonthly);}
      }catch(err){console.warn('FIDE directory search unavailable:',err?.message||err);}
    }
    if(!rows.length)rows=await searchLocalAsync(raw,limit,requestId);
    if(requestId&&requestId!==latestSearchRequest)return [];
    return rememberDirectorySearch(key,rows.slice(0,limit));
  })();directorySearchInFlight.set(key,task);
  try{return (await task).map(cloneRow);}finally{directorySearchInFlight.delete(key);}
}
function managerSnapshot(){return {generationId:String(fideCacheMeta?.generationId||''),updatedAt:String(fideCacheMeta?.updatedAt||''),verified:!!fideCacheMeta?.verified,totalPlayers:Number(fideCacheMeta?.totalPlayers||fideMainDb.size||0),lists:Object.fromEntries(TYPES.map(type=>[type,listStatus(type)]))};}
function installSearchWorker(){
  // beta.98-r7 performance correction: never clone the complete FIDE database
  // into a browser Worker. Windows searches the LocalEngine directory off the
  // UI thread; browser fallback scans in cooperative chunks.
  try{if(ratingWorker){try{ratingWorker.terminate();}catch(_){ }ratingWorker=null;}}catch(_){ }
  try{if(fideWorker){try{fideWorker.terminate();}catch(_){ }fideWorker=null;}}catch(_){ }
  workerRequest=0;clearDirectorySearchCache();return true;
}
function syncWorker(){clearDirectorySearchCache();return false;}
function searchLocal(query,limit=60){
  const raw=String(query||'').trim();const id=exactFideId(raw);if(id){const row=fideMainDb.get(id);return row?[row]:[];}
  if(normalizeName(raw).length<2)return [];
  const out=[];for(const row of fideMainDb.values()){if(tokenPrefixMatch(`${row.name||''} ${row.fed||''}`,raw)){out.push(row);if(out.length>=limit)break;}}return out;
}
function queueSearch(){
  clearTimeout(fideSearchTimer);const rawNow=String(document.getElementById('fideSearch')?.value||'').trim();
  if(normalizeName(rawNow).length<2&&!exactFideId(rawNow)){latestSearchRequest++;renderFideResults([]);return;}
  fideSearchTimer=setTimeout(async()=>{
    const raw=String(document.getElementById('fideSearch')?.value||'').trim();latestSearchRequest++;const requestId=latestSearchRequest;
    if(normalizeName(raw).length<2&&!exactFideId(raw)){renderFideResults([]);return;}
    try{const rows=await searchDirectory(raw,60,{requestId});if(requestId!==latestSearchRequest)return;renderFideResults(rows);}catch(err){console.warn('Rating Lists search failed:',err);if(requestId===latestSearchRequest)renderFideResults([]);}
  },240);
}
function install(){
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;document.title=`Chess-Publisher v${VERSION.replace(/^v/,'')}`;}catch(_){ }
  installStyles();installPanel();installSearchWorker();loadReport();updatePanel();
}
// Replace only the rating-list infrastructure entry points; tournament/pairing/TRF/TB cores stay untouched.
try{restoreFideCache=restoreGeneration;}catch(_){ }
try{writeFideCacheSnapshot=persistActiveGeneration;}catch(_){ }
try{saveFideCacheSafe=async()=>{try{return await persistActiveGeneration();}catch(err){console.warn('Rating Lists save warning:',err);return false;}};}catch(_){ }
try{updateFideDatabaseNow=updateRatingLists;}catch(_){ }
try{downloadAndUpdateFideDatabases=()=>updateRatingLists({manual:true});}catch(_){ }
try{importSingleRatingList=safeSingleImport;}catch(_){ }
try{importAllRatingLists=safeAllImport;}catch(_){ }
try{queueFideSearch=queueSearch;}catch(_){ }
try{syncFideSearchWorker=syncWorker;}catch(_){ }

window.cpBeta72RatingLists={VERSION,normalizeName,nameTokens,tokenPrefixMatch,exactFideId,parseFixedWidthLine,parseListIntoMap,countsForMap,validateGeneration,buildGenerationFromTexts,commitGeneration,updateRatingLists,manualAtomicImport,restoreGeneration,persistActiveGeneration,searchLocal,searchLocalAsync,searchDirectory,managerSnapshot,clearDirectorySearchCache,snapshotPlayer,reviewChanges,reviewPlayerUpdates,closeReview,openApplyDialog,showLastReport,reportText,get lastReport(){return loadReport();},get activeGeneration(){return String(fideCacheMeta?.generationId||'');}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
