'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'ChessPublisher.html'),'utf8');
const src52=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta52-Compliance.js'),'utf8');
const src57=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta57-Compliance.js'),'utf8');
let pass=0,fail=0;function check(v,m){if(v){console.log('PASS '+m);pass++;}else{console.error('FAIL '+m);fail++;}}

check(/ChessPublisher-Beta57-Compliance\.js/.test(html),'HTML loads beta57 compliance layer');
check(html.indexOf('ChessPublisher-Beta57-Compliance.js')>html.indexOf('ChessPublisher-Beta56-Compliance.js'),'beta57 loads after beta56');
check(/profile==="rating" && window\.cpBeta57\?\.officialRatingForReporting/.test(html),'FIDE rating profile selects Official Rating');
check(/: \(Number\(p\.rating\)\|\|0\)/.test(html),'non-rating TRF profiles retain Tournament Rating');
check(/add\("072"[\s\S]*cpBeta57\?\.officialRatingForReporting/.test(html),'TRF rated-player count uses Official Rating for rating report');
check(/initialRankStrength\(player,source="fide"\)[\s\S]*player\?\.rating/.test(html),'initial ranking continues to use Tournament Rating');
check(/buildPairingEngineTRF[\s\S]*Number\(player\.rating\)/.test(html),'pairing-engine TRF continues to use Tournament Rating');
check(/captureOfficialManualEdit\(p,oldOfficial,officialValue\)/.test(html),'Edit Player saves Official Rating separately');
check(!/rankDataChanged[^;]+officialRating/.test(html),'Official Rating change does not trigger Starting Rank Resort');

const document={readyState:'complete',documentElement:{dataset:{}},getElementById:()=>null,title:'Chess-Publisher v1.06.00-beta.56'};
const tournament={settings:{initialRatingSource:'fide'},players:[]};
const ctx={console,JSON,Number,String,Math,Date,Array,Object,Promise,Set,Map,document,window:null,data:{currentTournament:'Test',tournaments:{Test:tournament}},getCurrentTournament:()=>tournament,getLanguage:()=> 'en',normalizePlayerGender:v=>String(v||'').toLowerCase(),evaluateRegisteredFideUpdate:()=>({changes:[]})};ctx.window=ctx;ctx.globalThis=ctx;
vm.createContext(ctx);vm.runInContext(src52,ctx);vm.runInContext(src57,ctx);
const api=ctx.cpBeta57;
check(api&&api.VERSION==='1.06.00-beta.57','runtime API version is beta57');

let p={name:'Legacy sourced',rating:2250,fideId:'1234567',ratingProvenance:{version:1,fide:{sourceList:'FIDE Standard',sourceValue:2200,currentValue:2250,entryMethod:'official-list',sourceKnown:true,manualOverride:true,history:[]}}};
api.migratePlayer(p);
check(p.officialRating===2200,'migration recovers known Official Rating from retained source value');
check(p.rating===2250,'migration preserves distinct Tournament Rating');
check(p.ratingProvenance.fide.currentValue===2200,'FIDE provenance current value follows Official Rating');
check(p.ratingProvenance.tournament.currentValue===2250,'Tournament provenance records operational rating');
check(p.ratingProvenance.tournament.synchronizedWithOfficial===false,'provenance marks split ratings as unsynchronized');

p={name:'Legacy unknown',rating:1980,fideId:'7654321'};api.migratePlayer(p);
check(p.officialRating===1980,'unknown legacy player migrates losslessly with coincident ratings');

p={name:'Official add',rating:2100,fideId:'2222222',ratingSource:'std'};
ctx.cpBeta52.initializeOfficialPlayer(p,'std');
check(p.officialRating===2100&&p.rating===2100,'new FIDE player starts with coincident Official and Tournament Ratings');

const beforeTournament=p.rating;
ctx.cpBeta52.assignOfficialFideRating(p,'rapid',2150,'consistency-update');
check(p.officialRating===2150,'official assignment changes Official Rating');
check(p.rating===beforeTournament,'official assignment does not change Tournament Rating');
check(p.ratingProvenance.fide.sourceList==='FIDE Rapid'&&p.ratingProvenance.fide.currentValue===2150,'official provenance follows refreshed list/value');

const oldOfficial=p.officialRating;
api.captureOfficialManualEdit(p,oldOfficial,2175);
check(p.officialRating===2175&&p.rating===beforeTournament,'manual Official Rating edit remains separate from Tournament Rating');
check(p.ratingProvenance.fide.manualOverride===true,'manual Official Rating edit is recorded as override');

const updatePlayer={name:'Update target',rating:2300,officialRating:2200,fideId:'3333333',fed:'BUL',title:'',birth:'1990',gender:'m'};
tournament.players=[updatePlayer];
const lookup={byId:new Map([['3333333',{std:2250,stdAvailable:true,name:'Update target',fed:'BUL',birth:'1990',gender:'m'}]])};
const options={type:'std',name:false,rating:true,k:false,title:false,birth:false,sex:false,fed:false,setZero:false};
let result=ctx.evaluateRegisteredFideUpdate(tournament,lookup,options,false);
check(result.changes.length===1,'consistency test detects Official Rating difference');
check(/Official Rating: 2200 → 2250/.test(result.changes[0].details[0]),'consistency detail explicitly identifies Official Rating');
check(updatePlayer.officialRating===2200&&updatePlayer.rating===2300,'non-mutating consistency test changes neither rating');
result=ctx.evaluateRegisteredFideUpdate(tournament,lookup,options,true);
check(updatePlayer.officialRating===2250,'registered-player update applies Official Rating');
check(updatePlayer.rating===2300,'registered-player update leaves Tournament Rating unchanged');
check(updatePlayer.officialRatingSource==='std','official update records selected FIDE list type separately');

const noOfficial={name:'No explicit official',rating:1875};
check(api.officialRatingForReporting(noOfficial)===1875,'reporting helper falls back losslessly for pre-beta57 objects');
noOfficial.officialRating=0;
check(api.officialRatingForReporting(noOfficial)===0,'explicit unrated Official Rating is not replaced by Tournament Rating');

check(/Official Rating \(FIDE report\)/.test(src57),'player editor uses professional Official Rating label');
check(/Tournament Rating \(operations\)/.test(src57),'player editor identifies operational Tournament Rating');
check(!/experimental|pending implementation|temporary hack/i.test(src57),'beta57 user-facing wording contains no unfinished engineering text');
console.log(`BETA57 RESULT: ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
