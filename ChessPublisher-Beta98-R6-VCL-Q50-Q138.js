/* Chess-Publisher v1.06.00-beta.98-r6 — FIDE TEC VCL Q50 + Q138 operational controls
   Additive UI/reporting layer only. Does not modify pairing, TRF parser/export core,
   rating calculations, BBP, tie-break formulae, Chess-Results or protected SYNC logic. */
(()=>{
'use strict';
const VERSION='1.06.00-beta.98-r6';
const POLICY_KEY='ChessPublisherRatingConsistencyPolicy_v1';
const TRF26_ONLY_RECORDS=['152','172','192','202','212','222','240'];
let installed=false;

function currentTournament(){try{return window.getCurrentTournament?.()||null;}catch(_){return null;}}
function currentTournamentName(){try{return String(window.data?.currentTournament||'');}catch(_){return '';}}
function readPolicy(){
  try{
    const raw=localStorage.getItem(POLICY_KEY);
    if(raw===null||raw==='') return {enabled:true,source:'default'};
    try{
      const obj=JSON.parse(raw);
      if(obj&&typeof obj.enabled==='boolean') return {enabled:obj.enabled,source:'stored',changedAt:String(obj.changedAt||'')};
    }catch(_){ }
    const token=String(raw).trim().toLowerCase();
    return {enabled:!['0','false','off','disabled','no'].includes(token),source:'legacy'};
  }catch(_){return {enabled:true,source:'fallback'};}
}
function policyEnabled(){return readPolicy().enabled!==false;}
function writePolicy(enabled){
  const value={enabled:!!enabled,changedAt:new Date().toISOString()};
  try{localStorage.setItem(POLICY_KEY,JSON.stringify(value));}catch(_){ }
  return value;
}
function policyStatusText(){return policyEnabled()?'Consistency checks are enabled. Automatic first-opportunity checks remain active after official FIDE list updates.':'Consistency checks are disabled by user policy. Automatic and manual consistency checks will not run until re-enabled.';}
function renderPolicyUi(){
  const box=document.getElementById('ratingListSequenceControl');
  if(!box)return false;
  const summary=box.querySelector?.('.cp-rating-sequence-summary')||box;
  let toggle=document.getElementById('ratingConsistencyPolicyToggle');
  if(!toggle){
    toggle=document.createElement('button');
    toggle.id='ratingConsistencyPolicyToggle';toggle.type='button';
    toggle.title='FIDE TEC VCL Q138 — enable or disable rating consistency checks';
    summary.appendChild(toggle);
    toggle.addEventListener('click',async()=>{
      const next=!policyEnabled();writePolicy(next);renderPolicyUi();
      try{window.setStatus?.(policyStatusText());}catch(_){ }
      if(next){try{await window.cpBeta56?.tryAutomaticConsistency?.('policy-enabled');}catch(_){ }}
    });
  }
  const enabled=policyEnabled();
  toggle.textContent=`Consistency checks: ${enabled?'ON':'OFF'}`;
  toggle.setAttribute('aria-pressed',enabled?'true':'false');
  let status=document.getElementById('ratingConsistencyPolicyStatus');
  if(!status){status=document.createElement('div');status.id='ratingConsistencyPolicyStatus';status.className='help';box.appendChild(status);}
  status.textContent=policyStatusText();
  const check=document.getElementById('ratingListSequenceCheck');
  if(check){check.disabled=!enabled;check.title=enabled?'Run Rating List Sequence consistency check':'Consistency checks are disabled by user policy';}
  return true;
}
function wrapManualConsistency(){
  const api=window.cpBeta66;if(!api||api.__cpQ138Wrapped)return false;
  const original=api.runCurrent;
  const guarded=async function(){
    if(!policyEnabled()){
      const msg='Rating consistency checks are disabled. Turn “Consistency checks” ON in Tournament Setup → Rating List Sequence to run this check.';
      try{window.appAlert?.(msg,'Rating List Sequence','info');}catch(_){ }
      try{const s=document.getElementById('ratingListSequenceConsistencyStatus');if(s)s.textContent=msg;}catch(_){ }
      return {skipped:true,reason:'consistency-policy-disabled'};
    }
    return original?.apply(this,arguments);
  };
  api.runCurrent=guarded;api.__cpQ138Wrapped=true;api.__cpQ138Original=original;
  const old=document.getElementById('ratingListSequenceCheck');
  if(old){const fresh=old.cloneNode(true);old.replaceWith(fresh);fresh.addEventListener('click',guarded);}
  renderPolicyUi();
  return true;
}
function detectTrfVersion(text){
  const src=String(text||'').replace(/^\uFEFF/,'');
  return /^(?:152|162|172|192|202|212|222|240)\s+/m.test(src)?26:16;
}
function trf16AdjustmentLines(t,{mode='tournament',fileName=''}={}){
  const pab=Number(t?.regulations?.pabPoints);
  const pabText=Number.isFinite(pab)?pab.toFixed(1):'1.0';
  const lines=[
    'TRF16 → TRF26 COMPATIBILITY ADJUSTMENT REPORT',
    fileName?`Source file: ${fileName}`:'Source format: TRF16',
    `Import mode: ${mode==='players'?'players only':'complete tournament'}`,
    '',
    'Adjustments / limitations disclosed to the user:',
    `• Source is retained as TRF16 provenance; it is not silently relabelled as TRF26.`,
    `• TRF16 has no TRF26 Record 162 scoring/PAB metadata. Chess-Publisher therefore keeps standard game scoring (1 / 0.5 / 0) and PAB ${pabText} point(s) unless the arbiter changes it explicitly.`,
    `• TRF26-only extension records ${TRF26_ONLY_RECORDS.join(', ')} are not invented when absent from TRF16; unavailable extension metadata remains unset/default.`,
    `• Player, round, result and ordinary tournament fields are imported only when present in the source; missing TRF16 data is not fabricated.`
  ];
  if(mode==='players') lines.push('• Players-only import intentionally merges player records only; tournament metadata, pairings and round history are not imported.');
  else lines.push('• The imported tournament keeps trfVersion=16 in its import provenance so later workflows can distinguish the legacy source.');
  lines.push('','No hidden compatibility adjustment is applied outside the items listed above.');
  return lines;
}
function reportText(t,options){return trf16AdjustmentLines(t,options).join('\n');}
async function showTrf16Report(t,options){
  const text=reportText(t,options);
  try{window.setStatus?.('TRF16 import completed with a compatibility-adjustment report.');}catch(_){ }
  try{window.cpLogComplianceEvent?.({type:'TRF16_IMPORT_ADJUSTMENTS',category:'TRF IMPORT',level:0,message:text.replace(/\n+/g,' | '),trf:false});}catch(_){ }
  try{await window.appAlert?.(text,'TRF16 Import Adjustments','info');}catch(_){ }
  return text;
}
function wrapTournamentImport(){
  const original=window.importTournamentMenuFile;
  if(typeof original!=='function'||original.__cpQ50Wrapped)return false;
  const wrapped=async function(event){
    const before=currentTournamentName();
    const file=event?.target?.files?.[0]||null;
    let version=null;
    if(file&&/\.(?:trf|trfx|txt)$/i.test(String(file.name||''))){try{version=detectTrfVersion(await file.text());}catch(_){ }}
    const result=await original.apply(this,arguments);
    const after=currentTournamentName(),t=currentTournament();
    if(version===16&&after&&after!==before&&Number(t?.pairings?.trfImportMeta?.trfVersion)===16){
      await showTrf16Report(t,{mode:'tournament',fileName:String(file?.name||'')});
    }
    return result;
  };
  wrapped.__cpQ50Wrapped=true;wrapped.__cpQ50Original=original;window.importTournamentMenuFile=wrapped;return true;
}
function wrapPlayersImport(){
  const original=window.importPlayersMenuFile;
  if(typeof original!=='function'||original.__cpQ50Wrapped)return false;
  const wrapped=async function(event){
    const file=event?.target?.files?.[0]||null;
    let version=null;
    if(file&&/\.(?:trf|trfx|txt)$/i.test(String(file.name||''))){try{version=detectTrfVersion(await file.text());}catch(_){ }}
    const beforeCount=Number(currentTournament()?.players?.length)||0;
    const result=await original.apply(this,arguments);
    const t=currentTournament(),afterCount=Number(t?.players?.length)||0;
    if(version===16&&t&&afterCount>=beforeCount){await showTrf16Report(t,{mode:'players',fileName:String(file?.name||'')});}
    return result;
  };
  wrapped.__cpQ50Wrapped=true;wrapped.__cpQ50Original=original;window.importPlayersMenuFile=wrapped;return true;
}
function install(){
  if(installed)return;installed=true;
  wrapManualConsistency();wrapTournamentImport();wrapPlayersImport();renderPolicyUi();
  try{document.documentElement.dataset.chesspublisherVersion=VERSION;document.title=`Chess-Publisher v${VERSION}`;const w=document.getElementById('windowDocumentTitle');if(w)w.textContent=`Chess-Publisher v${VERSION} — Tournament Manager & Publisher`;const v=document.getElementById('appVersion');if(v)v.textContent=`v${VERSION}`;}catch(_){ }
}
window.cpBeta98R6={VERSION,POLICY_KEY,TRF26_ONLY_RECORDS,readPolicy,policyEnabled,writePolicy,policyStatusText,renderPolicyUi,wrapManualConsistency,detectTrfVersion,trf16AdjustmentLines,reportText,showTrf16Report,wrapTournamentImport,wrapPlayersImport,install};
if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
