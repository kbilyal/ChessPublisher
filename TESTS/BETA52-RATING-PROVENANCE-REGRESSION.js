'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta52-Compliance.js'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'ChessPublisher.html'),'utf8');
let pass=0,fail=0;function check(v,m){if(v){console.log('PASS - '+m);pass++;}else{console.error('FAIL - '+m);fail++;}}
const htmlVersionMatch=html.match(/data-chesspublisher-version=\"1\.06\.00-beta\.(\d+)(?:-r\d+)?\"/);
check(!!htmlVersionMatch&&Number(htmlVersionMatch[1])>=52,'beta.52 or newer branding is visible');
check(/editPlayerRatingSources/.test(html),'Edit Player exposes concise Rating Sources status');
check(/ChessPublisher-Beta52-Compliance\.js/.test(html),'beta.52 compliance layer is loaded');
check(/initializeManualPlayer\(player\)/.test(html),'manual add initializes no-source provenance');
check(/initializeOfficialPlayer\(player,type\)/.test(html),'FIDE database add initializes official-list provenance');
check(/captureManualEdit\(p,oldRankData\)/.test(html),'Edit Player captures manual override without losing source');
check(/assignOfficialFideRating\(p,(?:type|window\.cpBeta53\?window\.cpBeta53\.provenanceSource\(type\):type),newValue,"consistency-update"\)/.test(html),'official consistency update refreshes provenance');
check(/renderEditSourcesForPlayer\(p\)/.test(html),'player editor renders stored source provenance');
check(/assignNationalImport/.test(fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta51-Compliance.js'),'utf8')),'NRS import records national source provenance');

const fakeEl={textContent:'',dataset:{}};
const document={readyState:'complete',documentElement:{dataset:{}},getElementById:(id)=>id==='editPlayerRatingSources'?fakeEl:null};
const ctx={console,JSON,Number,String,Math,Date,Array,Object,Promise,document,window:null,data:{tournaments:{}},getCurrentTournament:()=>null};ctx.window=ctx;ctx.globalThis=ctx;
vm.createContext(ctx);vm.runInContext(src,ctx);
const api=ctx.cpBeta52;
check(!!api&&api.VERSION==='1.06.00-beta.52','runtime API exposes beta.52 version');

let p={name:'Manual',rating:1800,nationalRating:0,tournamentManualRating:0,fideId:'-',source:'Manual'};
api.initializeManualPlayer(p);
check(p.ratingProvenance.fide.sourceList===null,'manual FIDE rating retains explicit no-source state');
check(p.ratingProvenance.fide.entryMethod==='manual','manual FIDE rating records manual entry method');
check(p.ratingProvenance.fide.sourceValue===null&&p.ratingProvenance.fide.currentValue===1800,'manual value has no invented source rating');

p={name:'Official',rating:2200,nationalRating:0,tournamentManualRating:0,fideId:'1234567',ratingSource:'std'};
api.initializeOfficialPlayer(p,'std');
let r=p.ratingProvenance.fide;
check(r.sourceList==='FIDE Standard'&&r.sourceValue===2200,'official Standard rating stores source list and source value');
check(r.currentValue===2200&&!r.manualOverride&&r.sourceKnown,'official rating begins as unmodified sourced value');

const before={rating:2200,nationalRating:0,tournamentManualRating:0};p.rating=2250;api.captureManualEdit(p,before);r=p.ratingProvenance.fide;
check(r.sourceList==='FIDE Standard'&&r.sourceValue===2200,'manual edit preserves original FIDE source list and source value');
check(r.currentValue===2250&&r.manualOverride,'manual edit records current value and override flag');
check(r.history.some(x=>x.action==='manual-edit'&&x.value===2200),'manual edit is retained in provenance history');

const before2={rating:2250,nationalRating:0,tournamentManualRating:0};p.rating=2275;api.captureManualEdit(p,before2);r=p.ratingProvenance.fide;
check(r.sourceList==='FIDE Standard'&&r.sourceValue===2200&&r.currentValue===2275,'subsequent manual edit still retains original source');

api.assignOfficialFideRating(p,'rapid',2300,'consistency-update');r=p.ratingProvenance.fide;
check(r.sourceList==='FIDE Rapid'&&r.sourceValue===2300&&r.currentValue===2300,'new official assignment records the new source list/value');
check(!r.manualOverride&&r.entryMethod==='official-list','official refresh clears manual-override state for current assignment');
check(r.history.length>=2,'previous provenance states remain in history after official refresh');

p.nationalRating=2100;api.assignNationalImport(p,2100,'BUL');let nr=p.ratingProvenance.national;
check(nr.sourceList==='NRS:BUL'&&nr.sourceValue===2100&&nr.sourceKnown,'NRS import retains national source federation');
const b3={rating:p.rating,nationalRating:2100,tournamentManualRating:0};p.nationalRating=2150;api.captureManualEdit(p,b3);nr=p.ratingProvenance.national;
check(nr.sourceList==='NRS:BUL'&&nr.sourceValue===2100&&nr.currentValue===2150&&nr.manualOverride,'manual national edit preserves NRS source');

const b4={rating:p.rating,nationalRating:p.nationalRating,tournamentManualRating:0};p.tournamentManualRating=2400;api.captureManualEdit(p,b4);const mr=p.ratingProvenance.manualTournament;
check(mr.sourceList===null&&mr.sourceValue===null&&mr.entryMethod==='manual','Manual Tournament Rating explicitly has no source list');
check(mr.currentValue===2400&&mr.manualOverride,'Manual Tournament Rating current value is retained');

const imported={rating:2000,nationalRating:0,tournamentManualRating:0,fideId:'7654321',source:'TRF26'};api.ensureImported(imported);
check(imported.ratingProvenance.fide.entryMethod==='imported-unknown','imported rating without source is distinct from a manual rating');
check(imported.ratingProvenance.fide.sourceList===null&&!imported.ratingProvenance.fide.sourceKnown,'unknown imported source is not fabricated');

const stored={rating:1990,fideId:'1111111',ratingProvenance:{fide:{sourceList:'FIDE Blitz',sourceValue:1980,currentValue:1990,entryMethod:'official-list',sourceKnown:true,manualOverride:true,history:[]}}};api.ensure(stored);
check(stored.ratingProvenance.fide.sourceList==='FIDE Blitz'&&stored.ratingProvenance.fide.sourceValue===1980,'existing stored provenance survives normalization');

api.renderEditSourcesForPlayer(p);
check(/FIDE: FIDE Rapid/.test(fakeEl.textContent)&&/National: NRS:BUL/.test(fakeEl.textContent)&&/Tournament: Manual \/ no source/.test(fakeEl.textContent),'Edit Player source summary is concise and accurate');
check(!/experimental|pending|diagnostic/i.test(fakeEl.textContent),'source summary contains no unfinished engineering wording');

console.log(`SUMMARY PASS=${pass} FAIL=${fail}`);process.exit(fail?1:0);
