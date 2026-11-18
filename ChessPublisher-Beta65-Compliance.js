/* Chess-Publisher v1.06.00-beta.65 — Type-A Rating Lists */
(()=>{
'use strict';
const VERSION='1.06.00-beta.65';
const CLASS='Type-A';
const TYPES=['std','rapid','blitz'];
const IDS={std:'fide-standard',rapid:'fide-rapid',blitz:'fide-blitz'};
const LABELS={std:'FIDE Standard',rapid:'FIDE Rapid',blitz:'FIDE Blitz'};
const CANONICAL={
  std:'https://ratings.fide.com/download/standard_rating_list.zip',
  rapid:'https://ratings.fide.com/download/rapid_rating_list.zip',
  blitz:'https://ratings.fide.com/download/blitz_rating_list.zip'
};
let installed=false;
function validType(value){
  const s=String(value||'').trim().toLowerCase();
  if(TYPES.includes(s))return s;
  if(/\bstandard\b/.test(s))return 'std';
  if(/\brapid\b/.test(s))return 'rapid';
  if(/\bblitz\b/.test(s))return 'blitz';
  return '';
}
function periodFrom(value){const m=String(value||'').match(/\b(20\d{2}-(?:0[1-9]|1[0-2]))\b/);return m?m[1]:'';}
function metaFor(type){
  type=validType(type);
  try{return type&&typeof fideCacheMeta!=='undefined'&&fideCacheMeta?.lists?.[type]?fideCacheMeta.lists[type]:{};}catch(_){return {};}
}
function transport(meta={}){
  const source=String(meta.source||'').trim();
  if(!source)return {kind:'',label:'',url:''};
  if(/github mirror/i.test(source))return {kind:'mirror',label:source,url:(typeof FIDE_MIRROR_URLS!=='undefined'?FIDE_MIRROR_URLS:null)?.[meta.type]||''};
  if(/fide official/i.test(source))return {kind:'official-server',label:source,url:(typeof FIDE_OFFICIAL_URLS!=='undefined'?FIDE_OFFICIAL_URLS:null)?.[meta.type]||''};
  if(/local fide updater/i.test(source))return {kind:'local-updater',label:source,url:CANONICAL[meta.type]||''};
  if(/manual import/i.test(source))return {kind:'manual-import',label:source,url:''};
  return {kind:'known-transport',label:source,url:String(meta.sourceUrl||'')};
}
function descriptor(type,options={}){
  type=validType(type);if(!type)return null;
  const current=metaFor(type);
  const periodKey=String(options.periodKey||periodFrom(options.sourceType)||current.periodKey||'');
  const sourceKind=String(options.sourceKind||'').trim();
  const sourceUrl=String(options.sourceUrl||'').trim();
  const currentMeta={...current,type};
  const tr=transport(currentMeta);
  const historical=/official-archive|historical-cache/i.test(sourceKind)||(/ratings\.fide\.com\/download\//i.test(sourceUrl)&&!!periodKey);
  const instanceUrl=sourceUrl||tr.url||CANONICAL[type];
  return {
    schemaVersion:1,
    id:IDS[type],
    listClass:CLASS,
    type,
    label:LABELS[type],
    authority:'FIDE',
    originalSourceKnown:true,
    originalSourceAuthority:'FIDE Rating Server',
    originalSourceUrl:historical&&sourceUrl?sourceUrl:CANONICAL[type],
    periodKey,
    loaded:!!String(current.periodKey||'')||historical,
    cacheHash:String(current.hash||''),
    cacheUpdatedAt:String(current.updatedAt||''),
    transportKind:sourceKind||tr.kind,
    transportLabel:String(options.transportLabel||tr.label||''),
    transportUrl:instanceUrl,
    historical:!!historical
  };
}
function officialLists(){return TYPES.map(type=>descriptor(type));}
function byId(id){id=String(id||'').trim().toLowerCase();const type=TYPES.find(t=>IDS[t]===id);return type?descriptor(type):null;}
function describeLookup(lookup){
  if(!lookup||typeof lookup!=='object')return null;
  const type=validType(lookup.ratingListType||lookup.type||lookup.effectiveRatingList?.type);
  if(!type)return null;
  return descriptor(type,{periodKey:lookup.ratingPeriodKey||lookup.effectiveRatingList?.periodKey||'',sourceUrl:lookup.ratingSourceUrl||'',sourceKind:lookup.ratingSourceKind||''});
}
function attachProvenance(player,type,options={}){
  type=validType(type);if(!player||typeof player!=='object'||!type)return null;
  try{window.cpBeta52?.ensure?.(player);}catch(_){ }
  const prov=(player.ratingProvenance&&typeof player.ratingProvenance==='object')?player.ratingProvenance:(player.ratingProvenance={});
  const rec=(prov.fide&&typeof prov.fide==='object')?prov.fide:(prov.fide={history:[]});
  const periodKey=String(options.periodKey||periodFrom(options.sourceType)||((window.cpBeta53?.lastContext?.type===type)?window.cpBeta53.lastContext.periodKey:'')||metaFor(type).periodKey||'');
  const d=descriptor(type,{...options,periodKey});
  rec.ratingListClass=CLASS;
  rec.ratingListId=d.id;
  rec.ratingListPeriodKey=d.periodKey;
  rec.originalSourceAuthority=d.originalSourceAuthority;
  rec.originalSourceUrl=d.originalSourceUrl;
  rec.sourceKnown=true;
  rec.typeAList={schemaVersion:1,id:d.id,listClass:CLASS,type:d.type,label:d.label,authority:d.authority,originalSourceKnown:true,originalSourceAuthority:d.originalSourceAuthority,originalSourceUrl:d.originalSourceUrl,periodKey:d.periodKey};
  prov.version=Math.max(3,Number(prov.version)||0);
  player.ratingProvenance=prov;
  return rec.typeAList;
}
function wrapAssignments(){
  const b57=window.cpBeta57;
  if(b57&&typeof b57.assignOfficialRating==='function'&&!b57.assignOfficialRating.__cpBeta65Wrapped){
    const original=b57.assignOfficialRating;
    const wrapped=function(player,value,options={}){const out=original.apply(this,arguments);const type=validType(options?.sourceType);if(type&&!options?.manual)attachProvenance(player,type,{sourceType:options.sourceType});return out;};
    wrapped.__cpBeta65Wrapped=true;wrapped.__cpBeta65Original=original;b57.assignOfficialRating=wrapped;
  }
  const b52=window.cpBeta52;
  if(b52&&typeof b52.assignOfficialFideRating==='function'&&!b52.assignOfficialFideRating.__cpBeta65Wrapped){
    const original=b52.assignOfficialFideRating;
    const wrapped=function(player,type,value,reason){const out=original.apply(this,arguments);const t=validType(type);if(t)attachProvenance(player,t,{sourceType:type});return out;};
    wrapped.__cpBeta65Wrapped=true;wrapped.__cpBeta65Original=original;b52.assignOfficialFideRating=wrapped;
  }
}
function wrapDateEffectiveLookup(){
  const api=window.cpBeta53;
  if(!api||typeof api.applyDateEffectiveRatings!=='function'||api.applyDateEffectiveRatings.__cpBeta65Wrapped)return false;
  const original=api.applyDateEffectiveRatings;
  const wrapped=async function(){const lookup=await original.apply(this,arguments);const d=describeLookup(lookup);if(d)lookup.typeAList=d;return lookup;};
  wrapped.__cpBeta65Wrapped=true;wrapped.__cpBeta65Original=original;api.applyDateEffectiveRatings=wrapped;return true;
}
function migrateExistingPlayers(){
  try{
    for(const t of Object.values(window.data?.tournaments||{}))for(const p of t?.players||[]){
      const rec=p?.ratingProvenance?.fide;if(!rec?.sourceKnown||rec?.typeAList)continue;
      const type=validType(rec.sourceList||p.ratingSource||p.officialRatingSource);if(type)attachProvenance(p,type,{sourceType:rec.sourceList||p.ratingSource||p.officialRatingSource});
    }
  }catch(_){ }
}
function install(){
  if(installed)return;installed=true;
  wrapAssignments();wrapDateEffectiveLookup();migrateExistingPlayers();
  try{document.title=document.title.replace(/v1\.06\.00-beta\.\d+/i,`v${VERSION}`);}catch(_){ }
  try{const ver=document.getElementById('appVersion');if(ver)ver.textContent=`v${VERSION}`;}catch(_){ }
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;}catch(_){ }
}
window.cpBeta65={VERSION,CLASS,TYPES,IDS,LABELS,CANONICAL,validType,periodFrom,descriptor,officialLists,byId,describeLookup,attachProvenance,wrapAssignments,wrapDateEffectiveLookup,migrateExistingPlayers,install};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
