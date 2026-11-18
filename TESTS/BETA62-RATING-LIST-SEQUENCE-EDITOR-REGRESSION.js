'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'ChessPublisher.html'),'utf8');
const src=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta62-Compliance.js'),'utf8');
let pass=0,fail=0,n=0;function check(v,m){n++;if(v){console.log(`PASS ${String(n).padStart(2,'0')} ${m}`);pass++;}else{console.error(`FAIL ${String(n).padStart(2,'0')} ${m}`);fail++;}}
check(/data-chesspublisher-version="1\.06\.00-beta\.(?:6[2-9]|[7-9]\d|\d{3,})(?:-r\d+)?"/.test(html),'HTML self-identifies beta62 or newer');
check(/ChessPublisher-Beta62-Compliance\.js/.test(html),'HTML loads beta62 module');
check(html.indexOf('ChessPublisher-Beta62-Compliance.js')>html.indexOf('ChessPublisher-Beta61-Compliance.js'),'beta62 loads after beta61');
check(/Rating List Sequence/.test(src),'finished Rating List Sequence control exists');
check(/Available rating lists/.test(src),'available-list panel exists');
check(/data-action=\\?"add\\?"/.test(src),'Add control exists');
check(/data-action=\\?"remove\\?"/.test(src),'Remove/exclude control exists');
check(/data-action=\\?"up\\?"/.test(src)&&/data-action=\\?"down\\?"/.test(src),'reorder controls exist');
check(/Use Default/.test(src),'restore-default control exists');

class El{constructor(tag='div'){this.tagName=tag.toUpperCase();this.id='';this.className='';this.style={};this.dataset={};this.children=[];this.textContent='';this.innerHTML='';this.disabled=false;}appendChild(x){this.children.push(x);return x;}insertAdjacentElement(_p,x){this.children.push(x);return x;}setAttribute(){}addEventListener(){}closest(){return null;}}
const anchor=new El('div'),body=new El('body'),head=new El('head');
const document={readyState:'complete',documentElement:{dataset:{}},title:'Chess-Publisher v1.06.00-beta.61',body,head,createElement:t=>new El(t),querySelector:q=>q==='.pairing-essentials-box'?anchor:null,getElementById:()=>null,addEventListener(){}};
let current={settings:{tournamentRatingType:'Standard',ratingListSequence:['fide-standard','fide-rapid','fide-blitz'],ratingListSequenceMode:'default'}};
let markCalls=0,restoreCalls=0,saves=0,alerts=0;
const IDS={STANDARD:'fide-standard',RAPID:'fide-rapid',BLITZ:'fide-blitz',EFFECTIVE_RAPID:'effective-rapid',EFFECTIVE_BLITZ:'effective-blitz'};
const LABELS={'fide-standard':'FIDE Standard','fide-rapid':'FIDE Rapid','fide-blitz':'FIDE Blitz','effective-rapid':'Effective Rapid','effective-blitz':'Effective Blitz'};
function cleanSequence(v){const allowed=new Set(Object.values(IDS)),seen=new Set(),out=[];for(const raw of Array.isArray(v)?v:[]){const id=String(raw||'').trim().toLowerCase();if(allowed.has(id)&&!seen.has(id)){seen.add(id);out.push(id);}}return out;}
function normalizedRatingType(v){const s=String(v||'').toLowerCase();return s==='standard'?'Standard':s==='rapid'?'Rapid':s==='blitz'?'Blitz':'Unrated';}
function defaultSequenceFor(v){v=normalizedRatingType(v);return v==='Standard'?[IDS.STANDARD,IDS.RAPID,IDS.BLITZ]:v==='Rapid'?[IDS.EFFECTIVE_RAPID,IDS.BLITZ]:v==='Blitz'?[IDS.EFFECTIVE_BLITZ,IDS.RAPID]:[];}
const cpBeta59={IDS,LABELS,cleanSequence,normalizedRatingType,defaultSequenceFor,syncTournament(t){if(t?.settings?.ratingListSequenceMode==='default')t.settings.ratingListSequence=defaultSequenceFor(t.settings.tournamentRatingType);return {sequence:t?.settings?.ratingListSequence||[]};},markCustom(t,seq){markCalls++;t.settings.ratingListSequence=cleanSequence(seq);t.settings.ratingListSequenceMode='custom';saves++;},restoreDefault(t){restoreCalls++;t.settings.ratingListSequence=defaultSequenceFor(t.settings.tournamentRatingType);t.settings.ratingListSequenceMode='default';saves++;}};
const ctx={console,JSON,Number,String,Math,Date,Array,Object,Promise,Set,Map,document,window:null,cpBeta59,getCurrentTournament(){return current;},loadAllFields(){return true;},changeTournament(){return true;},tournamentRatingTypeChanged(){return true;},appAlert:async()=>{alerts++;},alert(){alerts++;}};ctx.window=ctx;ctx.globalThis=ctx;
vm.createContext(ctx);vm.runInContext(src,ctx);const api=ctx.cpBeta62;
check(api.VERSION==='1.06.00-beta.62','runtime API version is beta62');
check(document.documentElement.dataset.chesspublisherVersion==='1.06.00-beta.62','install publishes beta62 version');
check(api.ALL.length===5&&new Set(api.ALL).size===5,'five supported rating-list identifiers exposed');
check(api.label('effective-rapid')==='Effective Rapid','Effective Rapid label retained');
check(api.defaultFor(current).join('|')==='fide-standard|fide-rapid|fide-blitz','Standard default delegated from beta59');
check(api.sequenceText(['fide-standard','fide-blitz'])==='FIDE Standard → FIDE Blitz','user-facing sequence summary is ordered');
check(api.clean(['FIDE-STANDARD','bad','fide-standard','fide-blitz']).join('|')==='fide-standard|fide-blitz','sequence cleanup rejects unknowns and duplicates');
check(api.add(['fide-standard'],'fide-blitz').join('|')==='fide-standard|fide-blitz','Add appends an available list');
check(api.add(['fide-standard'],'fide-standard').length===1,'Add does not duplicate a list');
check(api.remove(['fide-standard','fide-rapid','fide-blitz'],1).join('|')==='fide-standard|fide-blitz','Remove excludes selected list');
check(api.move(['fide-standard','fide-rapid','fide-blitz'],2,-1).join('|')==='fide-standard|fide-blitz|fide-rapid','Move Up reorders sequence');
check(api.move(['fide-standard','fide-rapid','fide-blitz'],0,1).join('|')==='fide-rapid|fide-standard|fide-blitz','Move Down reorders sequence');
check(api.move(['fide-standard'],0,-1).join('|')==='fide-standard','out-of-range move is harmless');
check(api.availableIds(['fide-standard','fide-blitz']).join('|')==='fide-rapid|effective-rapid|effective-blitz','available list excludes active identifiers');
check(api.validate([],current).ok===false,'rated tournament cannot save an empty sequence');
current={settings:{tournamentRatingType:'Unrated',ratingListSequence:[],ratingListSequenceMode:'default'}};
check(api.validate([],current).ok===true,'Unrated tournament may keep an empty sequence');
current={settings:{tournamentRatingType:'Rapid',ratingListSequence:['effective-rapid','fide-blitz'],ratingListSequenceMode:'default'}};
api.setDraft(['fide-standard','fide-blitz'],'custom');
check(api.draftSnapshot().mode==='custom','editing switches to custom draft mode');
check(api.draftSnapshot().sequence.join('|')==='fide-standard|fide-blitz','custom draft keeps requested order');
(async()=>{
  let ok=await api.saveDraft();
  check(ok===true,'valid custom sequence saves');
  check(markCalls===1&&current.settings.ratingListSequenceMode==='custom','save persists custom mode through beta59');
  check(current.settings.ratingListSequence.join('|')==='fide-standard|fide-blitz','saved custom order persists');
  api.useDefaultDraft();
  check(api.draftSnapshot().mode==='default','Use Default marks draft as default');
  check(api.draftSnapshot().sequence.join('|')==='effective-rapid|fide-blitz','Use Default restores Rapid canonical sequence');
  ok=await api.saveDraft();
  check(ok===true&&restoreCalls===1,'default draft saves through restoreDefault');
  check(current.settings.ratingListSequenceMode==='default','default mode persists');
  api.setDraft(['effective-rapid','fide-blitz'],'custom');
  await api.saveDraft();
  check(restoreCalls===2,'custom draft equal to canonical default is normalized back to default mode');
  current={settings:{tournamentRatingType:'Blitz',ratingListSequence:['effective-blitz','fide-rapid'],ratingListSequenceMode:'default'}};
  api.setDraft([],'custom');ok=await api.saveDraft();
  check(ok===false&&alerts===1,'empty rated sequence is blocked with user warning');
  check(saves>=2,'accepted sequence changes are persisted');
  check(/wrapRefresh\('loadAllFields'\)/.test(src)&&/wrapRefresh\('changeTournament'\)/.test(src),'summary refresh follows load and tournament switch');
  check(/wrapRefresh\('tournamentRatingTypeChanged'\)/.test(src),'summary follows rating-type changes');
  check(!/experimental|temporary hack|pending implementation|debug/i.test(src),'user-facing module has no unfinished engineering wording');
  check(!/pairingchecker|buildPairingEngineTRF|cpBuildCanonicalTRF|Chess-Results protocol/i.test(src),'beta62 does not redefine protected pairing/TRF core');
  console.log(`BETA62 RESULT: ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
})();
