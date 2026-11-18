/* Chess-Publisher v1.06.00-beta.81 — Type-B Rating Lists (TEC Q120/Q122) */
(()=>{
'use strict';
const VERSION='1.06.00-beta.81';
const CLASS='Type-B';
const SCHEMA=1;
const CATALOG_KEY='rating-lists:type-b:catalog:v1';
const DATA_PREFIX='rating-lists:type-b:data:v1:';
const TYPES=['std','rapid','blitz'];
const LABELS={std:'Standard',rapid:'Rapid',blitz:'Blitz'};
let memoryCatalog=[];
const memoryData=new Map();

function nowIso(){return new Date().toISOString();}
function validType(v){
  const s=String(v||'').trim().toLowerCase();
  if(TYPES.includes(s)) return s;
  if(/standard/.test(s)) return 'std';
  if(/rapid/.test(s)) return 'rapid';
  if(/blitz/.test(s)) return 'blitz';
  return '';
}
function cleanId(v){return String(v||'').trim().replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);}
function generatedId(type,label){return `type-b-${type}-${cleanId(label)||'list'}-${Date.now().toString(36)}`;}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function normalizeCatalog(value){return (Array.isArray(value)?value:[]).filter(x=>x&&x.listClass===CLASS&&x.id).map(x=>({...x,schemaVersion:SCHEMA,listClass:CLASS,originalSourceKnown:false}));}
async function idbGet(key){
  if(typeof openFideCacheDb!=='function'||typeof FIDE_CACHE_STORE==='undefined') return null;
  const db=await openFideCacheDb();
  return await new Promise((resolve,reject)=>{const tx=db.transaction(FIDE_CACHE_STORE,'readonly');const req=tx.objectStore(FIDE_CACHE_STORE).get(key);req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error||new Error('Type-B cache read failed.'));});
}
async function idbPut(key,value){
  if(typeof openFideCacheDb!=='function'||typeof FIDE_CACHE_STORE==='undefined') return false;
  const db=await openFideCacheDb();
  return await new Promise((resolve,reject)=>{const tx=db.transaction(FIDE_CACHE_STORE,'readwrite');tx.objectStore(FIDE_CACHE_STORE).put(value,key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error('Type-B cache write failed.'));tx.onabort=()=>reject(tx.error||new Error('Type-B cache write aborted.'));});
}
async function idbDelete(key){
  if(typeof openFideCacheDb!=='function'||typeof FIDE_CACHE_STORE==='undefined') return false;
  const db=await openFideCacheDb();
  return await new Promise((resolve,reject)=>{const tx=db.transaction(FIDE_CACHE_STORE,'readwrite');tx.objectStore(FIDE_CACHE_STORE).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error('Type-B cache delete failed.'));});
}
async function loadCatalog(){
  try{const x=await idbGet(CATALOG_KEY);if(x){memoryCatalog=normalizeCatalog(x);return clone(memoryCatalog);}}catch(err){console.warn('Type-B catalogue restore warning:',err);}
  try{const raw=localStorage.getItem('ChessPublisher.TypeBRatingLists.Catalog.v1');if(raw){memoryCatalog=normalizeCatalog(JSON.parse(raw));return clone(memoryCatalog);}}catch(_){ }
  return clone(memoryCatalog);
}
async function saveCatalog(catalog){
  memoryCatalog=normalizeCatalog(catalog);
  let stored=false;
  try{stored=await idbPut(CATALOG_KEY,memoryCatalog);}catch(err){console.warn('Type-B catalogue IndexedDB warning:',err);}
  try{localStorage.setItem('ChessPublisher.TypeBRatingLists.Catalog.v1',JSON.stringify(memoryCatalog.map(({recordCount,...m})=>({...m,recordCount:Number(recordCount)||0}))));}catch(_){ }
  return stored||true;
}
async function putData(id,rows){
  memoryData.set(id,clone(rows));
  try{if(await idbPut(DATA_PREFIX+id,{schemaVersion:SCHEMA,id,rows:clone(rows),savedAt:nowIso()}))return true;}catch(err){console.warn('Type-B data IndexedDB warning:',err);}
  return true;
}
async function getData(id){
  try{const x=await idbGet(DATA_PREFIX+id);if(x?.rows)return clone(x.rows);}catch(err){console.warn('Type-B data restore warning:',err);}
  return clone(memoryData.get(id)||[]);
}
function parseRows(text,type){
  type=validType(type);if(!type)throw new Error('Select Standard, Rapid or Blitz for the Type-B list.');
  const parser=window.cpBeta72RatingLists?.parseFixedWidthLine;
  if(typeof parser!=='function')throw new Error('Integrated Rating Lists parser is unavailable.');
  const map=new Map();
  const lines=String(text||'').split(/\r?\n/);
  for(const line of lines){
    const item=parser(line,type,'');if(!item)continue;
    map.set(String(item.fideId),{fideId:String(item.fideId),name:String(item.name||''),fed:String(item.fed||''),title:String(item.title||''),rating:Number(item.rating)||0,k:Number(item.k)||0});
  }
  if(!map.size)throw new Error('No valid FIDE-format rating records were found in the selected file.');
  return [...map.values()];
}
async function importTypeB(options={}){
  const type=validType(options.ratingType);if(!type)throw new Error('Type-B rating type is required.');
  const label=String(options.label||options.fileName||`Type-B ${LABELS[type]}`).trim()||`Type-B ${LABELS[type]}`;
  const rows=parseRows(options.text,type);
  let catalog=await loadCatalog();
  const id=String(options.id||generatedId(type,label));
  if(catalog.some(x=>x.id===id))throw new Error(`Type-B list ID already exists: ${id}`);
  const descriptor={
    schemaVersion:SCHEMA,id,label,listClass:CLASS,ratingType:type,ratingTypeLabel:LABELS[type],
    originalSourceKnown:false,originalSourceAuthority:'Unknown / not asserted by THP',originalSourceUrl:'',
    provenanceMode:'user-imported-unknown-source',sourceFileName:String(options.fileName||''),
    periodKey:String(options.periodKey||''),importedAt:nowIso(),recordCount:rows.length
  };
  await putData(id,rows);
  catalog.push(descriptor);await saveCatalog(catalog);updateUi();
  return clone(descriptor);
}
async function importOfficialAsTypeB(type,text,options={}){
  // Q122: an official FIDE list file may deliberately be imported as Type-B.
  // The THP does not claim/derive original-source provenance in this mode.
  return importTypeB({...options,ratingType:type,text,label:options.label||`Imported ${LABELS[validType(type)]||type} (Type-B)`});
}
async function deleteList(id){
  id=String(id||'');let catalog=await loadCatalog();catalog=catalog.filter(x=>x.id!==id);await saveCatalog(catalog);memoryData.delete(id);try{await idbDelete(DATA_PREFIX+id);}catch(_){ }updateUi();return true;
}
async function findRating(id,fideId){const rows=await getData(String(id||''));const key=String(fideId||'').trim();const r=rows.find(x=>String(x.fideId)===key);return r?clone(r):null;}
async function describe(id){const catalog=await loadCatalog();return clone(catalog.find(x=>x.id===String(id||''))||null);}
async function listCatalog(){return await loadCatalog();}
async function fileText(file){if(!file)throw new Error('Choose a rating-list file.');return await file.text();}
async function uiImport(){
  const type=document.getElementById('cpTypeBRatingType')?.value||'';
  const input=document.getElementById('cpTypeBFile');const file=input?.files?.[0];
  if(!file){appAlert?.('Choose a FIDE-format rating-list text file first.','Type-B Rating Lists','warning');return;}
  const label=(document.getElementById('cpTypeBLabel')?.value||file.name||'').trim();
  try{const d=await importTypeB({ratingType:type,text:await fileText(file),fileName:file.name,label});appAlert?.(`Imported ${d.recordCount.toLocaleString('en-US')} records as ${d.label}.\n\nClass: Type-B\nOriginal source: unknown to THP`,'Type-B Rating Lists','info');if(input)input.value='';}
  catch(err){appAlert?.(String(err?.message||err),'Type-B Rating Lists','warning');}
}
async function uiManage(){const list=await listCatalog();const text=list.length?list.map(x=>`${x.label} · ${x.ratingTypeLabel} · ${x.recordCount.toLocaleString('en-US')} players · ${x.id}`).join('\n'):'No Type-B Rating Lists have been imported.';appAlert?.(text,'Type-B Rating Lists','info');}
function installUi(){
  const panel=document.getElementById('integratedRatingListsPanel');if(!panel||document.getElementById('cpTypeBPanel'))return false;
  const box=document.createElement('div');box.id='cpTypeBPanel';box.className='help';box.style.marginTop='8px';box.style.paddingTop='8px';box.style.borderTop='1px solid var(--border,#d0d0d0)';
  box.innerHTML=`<details id="cpTypeBAdvanced"><summary style="cursor:pointer;font-weight:700">Advanced Type-B FIDE-format import</summary><div style="margin-top:6px"><div class="help" style="margin-bottom:5px"><b>Advanced only:</b> this accepts FIDE fixed-width rating-list text files. For normal CSV/TSV national, regional or club lists use <b>Import Rating List…</b> in Rating List Library below.</div><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><select id="cpTypeBRatingType" aria-label="Type-B rating type"><option value="std">Standard</option><option value="rapid">Rapid</option><option value="blitz">Blitz</option></select><input id="cpTypeBLabel" type="text" placeholder="List label (optional)" style="min-width:180px"><input id="cpTypeBFile" type="file" accept=".txt,.lst,.trf,text/plain"><button id="cpTypeBImport" type="button">Import Type-B</button><button id="cpTypeBManage" type="button">View Type-B Lists</button></div><div style="margin-top:4px">Type-B means the original source is <b>not known/asserted by Chess-Publisher</b>.</div></div></details>`;
  panel.appendChild(box);
  document.getElementById('cpTypeBImport')?.addEventListener('click',uiImport);
  document.getElementById('cpTypeBManage')?.addEventListener('click',uiManage);
  return true;
}
function updateUi(){try{installUi();}catch(_){ }}
function install(){
  updateUi();
  const timer=setInterval(()=>{if(installUi())clearInterval(timer);},250);setTimeout(()=>clearInterval(timer),10000);
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){ }
  try{const ver=document.getElementById('appVersion');if(ver)ver.textContent=`v${VERSION}`;}catch(_){ }
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }
}
window.cpBeta81={VERSION,CLASS,SCHEMA,CATALOG_KEY,DATA_PREFIX,TYPES,LABELS,validType,parseRows,importTypeB,importOfficialAsTypeB,deleteList,findRating,describe,listCatalog,getData,installUi,install};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else if(typeof document!=='undefined')install();
})();
