const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
const beta70=fs.readFileSync(path.join(root,'ChessPublisher-Beta70-Compliance.js'),'utf8');
const beta73=fs.readFileSync(path.join(root,'ChessPublisher-Beta73-Compliance.js'),'utf8');
const cloudAdapter=fs.readFileSync(path.join(root,'webview','CloudWorkspaceAdapter.js'),'utf8');
let pass=0,fail=0;function ok(name,cond){if(cond){pass++;console.log('PASS',name);}else{fail++;console.error('FAIL',name);}}function eq(name,a,b){ok(name,JSON.stringify(a)===JSON.stringify(b));if(JSON.stringify(a)!==JSON.stringify(b))console.error(' expected',b,'got',a);}
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
ok('HTML branded beta.73 or newer cumulative',/data-chesspublisher-version="1\.06\.00-beta\.(?:7[3-9]|[89]\d|[1-9]\d{2,})(?:-r\d+)?"/.test(html));
ok('beta.73 loads after beta.72',html.indexOf('ChessPublisher-Beta73-Compliance.js')>html.indexOf('ChessPublisher-Beta72-RatingLists.js'));
ok('beta.73 module syntax contains all three policies',/FIDE_FIRST/.test(beta73)&&/ROUND_EFFECTIVE/.test(beta73)&&/USER_SELECTED/.test(beta73));
ok('protected beta.46 source byte-identical to beta.72 parent',sha('ChessPublisher-Beta46-Compliance.js')==='edb372fae5573157af0747ba080d6055db38a6854dc5cda1d233594bee53c649');
ok('beta.70 calculation source is parent-exact or approved r5 UI-layout-only variant',new Set(['a314d09146aaf9d9b1bc13b2aad6e5f41ab97443c8ac00107ad98c2f7a655409','ecd5d2fe5bf8db1c3c5d7310a2827cd551712d456757dde62d49794e87f36c58']).has(sha('ChessPublisher-Beta70-Compliance.js'))&&/function ratingForRound\(p,roundNo\)\{const n=Math\.max\(1,Number\(roundNo\)\|\|1\),h=ensurePlayerHistory\(p\)\.find/.test(beta70));
ok('protected LocalEngine is beta.72 parent, beta.96 Windows SYNC transport hotfix, or beta.98-r13 Gacrux 1.11.65 candidate',new Set(['618949e74eadc4576f010f172842d220ca690f09577ff633443a1e5121cbed03','71113c2763ebfd438eab3dd3d4c1d8f11f630c59d67224c2d97e4568c8db3550','4236ee37b72f4ed7ccb7f760d5d62a63ec1386b217ee08400f18c39ca534b788','cebe72b54d2bd41eb331f5e892a17b48429684538ad54139a90e89e8f000639e']).has(sha('ChessPublisher-LocalEngine.ps1')));
ok('Cloud adapter retains installation-secret sanitizer after approved schema-7 compatibility update',
  /INSTALLATION_LOCAL_KEYS/.test(cloudAdapter)&&/sanitizePortableValue/.test(cloudAdapter));
ok('Cloud adapter uses explicit fingerprint content schema 7',
  /FINGERPRINT_CONTENT_SCHEMA\s*=\s*7/.test(cloudAdapter)&&/fingerprintContentSchema/.test(cloudAdapter));

let tournament={settings:{rounds:3,startDate:'2026-09-01',endDate:'2026-10-15'},regulations:{tieBreaks:["Average Rating of Opponents (ARO) [80]","Performance Tie-Break (TPR) [88]","Performance Tie-Break (PTP) [88]","Performance Tie-Break (APRO) [88]","Performance Tie-Break (APPO) [88]","Rating (RTNG) [80]"]},players:[]};
let baseCalcCalls=0;
const document={readyState:'complete',documentElement:{dataset:{}},title:'',getElementById:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},remove(){},querySelector(){return null;},querySelectorAll(){return[];}}),addEventListener(){}};
const ctx={console,Date,Map,Set,Math,Number,String,Array,Object,JSON,Promise,document,window:null,globalThis:null,getCurrentTournament:()=>tournament,saveData(){},getTournamentTieBreakPriority:t=>t?.regulations?.tieBreaks||[],getSelectedTieBreaksInPriority:()=>tournament.regulations.tieBreaks,tieBreakId:t=>Number(String(t).match(/\[(\d+)\]\s*$/)?.[1]||0),getTieBreakOptions:tie=>({unratedRating:1400,aroDiscardBest:0,aroDiscardWorst:0}),fidePointsFromRound:g=>Number(g?.points)||0,fideRoundedAverage:a=>a.length?Math.floor(a.reduce((s,x)=>s+Number(x),0)/a.length+.5+1e-12):0,fidePerformanceDifference:()=>0,fidePerfectTournamentPerformance:games=>games.length?Math.floor(games.reduce((s,g)=>s+g.opponentRating,0)/games.length+.5)+50:0,calculateNumberedTieBreakData(players){baseCalcCalls++;for(const p of players){p.aro=-1;p.tpr=-2;p.ptp=-3;p.apro=-4;p.appo=-5;p.cp46Rtng=Number(p.rating)||0;}return players;},standingTieBreakValue:(_p,tie)=>String(tie).includes('Buchholz')?777:-777};ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(beta70,ctx,{filename:'ChessPublisher-Beta70-Compliance.js'});Object.assign(ctx,ctx.window);vm.runInContext(beta73,ctx,{filename:'ChessPublisher-Beta73-Compliance.js'});Object.assign(ctx,ctx.window);const api=ctx.cpBeta73;
ok('beta.73 runtime API installed',api?.VERSION==='1.06.00-beta.73');
ok('beta.73 consumes beta.70 ratingForRound adapter',/window\.cpBeta70.*ratingForRound/.test(beta73));
ok('beta.73 wraps public calculator seam instead of redefining protected source',/oldCalc=window\.calculateNumberedTieBreakData/.test(beta73)&&!/function calculateNumberedTieBreakData\s*\(/.test(beta73));

function hist(a,b){return [{id:'first',rating:a,fromRound:1,toRound:1,source:'FIDE Sep'},{id:'second',rating:b,fromRound:2,toRound:3,source:'FIDE Oct'}];}
const A={id:1,fideId:'1001',name:'Alpha',rating:1700,rounds:[{opp:2,played:true,points:1},{opp:3,played:true,points:.5},{opp:4,played:true,points:0}]};
const B={id:2,fideId:'1002',name:'Beta',rating:1900,officialRating:1900,longEventRatingHistory:hist(1800,1900),rounds:[{opp:1,played:true,points:0}]};
const C={id:3,fideId:'1003',name:'Gamma',rating:2100,officialRating:2100,longEventRatingHistory:hist(2000,2100),rounds:[null,{opp:1,played:true,points:.5}]};
const D={id:4,fideId:'1004',name:'Delta',rating:2300,officialRating:2300,longEventRatingHistory:hist(2200,2300),rounds:[null,null,{opp:1,played:true,points:1}]};
const players=[A,B,C,D];tournament.players=players;const byId=new Map(players.map(p=>[p.id,p]));
ctx.calculateNumberedTieBreakData(players,byId,3);
ok('base calculator still executes exactly once',baseCalcCalls===1);
eq('Q215 default FIDE_FIRST ARO uses first ratings',A.aro,2000);
eq('Q215 default FIDE_FIRST TPR uses first ratings',ctx.standingTieBreakValue(A,'Performance Tie-Break (TPR) [88]'),2000);
eq('Q215 default FIDE_FIRST PTP consumes first-rating game rows',ctx.standingTieBreakValue(A,'Performance Tie-Break (PTP) [88]'),2050);
eq('Q215 RTNG uses first rating for multi-rating player',ctx.standingTieBreakValue(B,'Rating (RTNG) [80]'),1800);
eq('RTNG/R reverses the policy-derived rating',ctx.standingTieBreakValue(B,'Reverse Rating (RTNG/R) [80]'),-1800);
eq('non Article-10 tie-break delegates untouched',ctx.standingTieBreakValue(A,'Buchholz Tie-Break (2023) [84]'),777);
ok('policy calculation does not mutate stored player rating',B.rating===1900&&C.rating===2100&&D.rating===2300);

tournament.tieBreakRatingPolicy={mode:'ROUND_EFFECTIVE',selections:{}};ctx.calculateNumberedTieBreakData(players,byId,3);
eq('Q214 ROUND_EFFECTIVE ARO uses opponent rating valid in each encounter round',A.aro,2067);
eq('Q214 ROUND_EFFECTIVE TPR follows per-round ARO input',ctx.standingTieBreakValue(A,'Performance Tie-Break (TPR) [88]'),2067);
eq('Q214 ROUND_EFFECTIVE PTP receives per-round opponent ratings',ctx.standingTieBreakValue(A,'Performance Tie-Break (PTP) [88]'),2117);
eq('ROUND_EFFECTIVE RTNG uses rating valid at current standings round',ctx.standingTieBreakValue(B,'Rating (RTNG) [80]'),1900);

const selections={};for(const p of [B,C,D])selections[api.playerKey(p)]=api.periodKey(api.historyOf(p)[1].rec,api.historyOf(p)[1].index);tournament.tieBreakRatingPolicy={mode:'USER_SELECTED',selections};ctx.calculateNumberedTieBreakData(players,byId,3);
eq('Q216 USER_SELECTED ARO uses explicit selected periods',A.aro,2100);
eq('Q216 USER_SELECTED RTNG uses explicit selected period',ctx.standingTieBreakValue(C,'Rating (RTNG) [80]'),2100);
ok('Q216 USER_SELECTED validates complete multi-player selections',api.validateConfig(tournament,players).ok===true);
ok('policy state and derived caches remain JSON-serializable without beta73 player payload fields',(()=>{try{JSON.stringify(tournament);return players.every(p=>!Object.keys(p).some(k=>/beta73|cp73/i.test(k)));}catch(_){return false;}})());
ok('tieBreakRatingPolicy remains portable through generic Cloud sanitizer',/function sanitizePortableValue\(value\)/.test(cloudAdapter)&&!/PRIVATE_RUNTIME_KEYS[\s\S]{0,600}tieBreakRatingPolicy/i.test(cloudAdapter));
const before=JSON.stringify(players);delete tournament.tieBreakRatingPolicy.selections['1003'];let blocked=false;try{ctx.calculateNumberedTieBreakData(players,byId,3);}catch(e){blocked=/explicit valid rating selection/.test(String(e.message));}
ok('Q216 missing selection blocks calculation instead of silent fallback',blocked);
ok('failed USER_SELECTED validation does not mutate player source data',JSON.stringify(players)===before);
tournament.tieBreakRatingPolicy.selections['1003']='stale-period';blocked=false;try{ctx.calculateNumberedTieBreakData(players,byId,3);}catch(e){blocked=true;}ok('Q216 stale selection is rejected',blocked);

tournament.tieBreakRatingPolicy={mode:'FIDE_FIRST',selections:{}};const ordinary={id:9,fideId:'1009',name:'Ordinary',rating:1666,officialRating:1777,rounds:[]};eq('ordinary single-rating fallback preserves Tournament Rating semantics',api.resolveRating(ordinary,{mode:'FIDE_FIRST'}).rating,1666);
ok('source UI includes FIDE default explanation',/FIDE C\.07:10 default: use the first rating/.test(beta73));
ok('source UI includes all three policy choices',/FIDE default — First rating/.test(beta73)&&/Rating valid for each round/.test(beta73)&&/Explicit rating selection per player/.test(beta73));
ok('settings save validates before persisting USER_SELECTED',/validateConfig\(t,t\?\.players/.test(beta73)&&/Select a valid rating period for every multi-rating player/.test(beta73));
console.log(`BETA73 TEC Q214-Q216 RESULT: ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
