'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(require('path').join(__dirname,'..','ChessPublisher-Beta61-Compliance.js'),'utf8');
let pass=0,fail=0;function check(name,fn){try{fn();pass++;console.log('PASS',name)}catch(e){fail++;console.error('FAIL',name,e.message)}}
const tournament={settings:{rounds:7,accelerationMethod:'BAKU'},players:[{pairingNumber:1},{pairingNumber:2}],fideCompliance:{events:[
 {at:'2026-09-08T10:00:00.000Z',round:2,category:'PIBE',message:'Manual pairing alteration recorded.',trf:true},
 {at:'2026-09-08T10:01:00.000Z',round:3,category:'Game Adjournment',message:'Board 1 adjourned.',trf:true},
 {at:'2026-09-08T10:02:00.000Z',round:4,category:'Hidden',message:'Not for TRF.',trf:false}
]}};
let saved=null;
const descriptors=new Map([['Buchholz Cut 1','BH/C1'],['Sonneborn-Berger','SB']]);
const ctx={console,window:null,document:{readyState:'complete',documentElement:{dataset:{}},title:'Chess-Publisher v1.06.00-beta.60',getElementById:()=>null,addEventListener:()=>{}},getCurrentTournament:()=>tournament,
 cpEnsureFideCompliance:()=>tournament.fideCompliance,cpComplianceEventComment:e=>`### R${e.round} ${String(e.category).toUpperCase()}: ${e.message}`,
 cpBeta44:{addBakuRecords:text=>String(text).replace('192 FIDE_DUTCH_2025','192 FIDE_DUTCH_2025_BAKU').replace('001    1','250       1.0   1   1    1    2\r\n001    1')},
 cpBeta45:{unusualAdjustments:()=>[{round:2,pairNo:1,delta:-.5}],blankAatLine:(d,r,p)=>`299   ${Number(d).toFixed(1)} ${r} ${p}`},
 cpBeta46:{descriptors},getSelectedTieBreaksInPriority:()=>['Buchholz Cut 1','Sonneborn-Berger'],
 cpSaveTextToTournamentTRF:async(name,text)=>{saved={name,text};return {path:name}},buildTRF26:()=>({text:'012 Test\r\n192 FIDE_DUTCH_2025\r\n212 PTS,OLD\r\n001    1\r\n001    2\r\n',toRound:3})};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(src,ctx);const api=ctx.cpBeta61;
check('01 API version beta61',()=>assert.equal(api.VERSION,'1.06.00-beta.61'));
check('02 install publishes beta61 version',()=>assert.equal(ctx.document.documentElement.dataset.chesspublisherVersion,'1.06.00-beta.61'));
check('03 rating TRF16 recognized',()=>assert(api.ratingFileName('X_FIDE_Rating_TRF16_R1-R3.TXT')));
check('04 rating TRF26 recognized',()=>assert(api.ratingFileName('X_FIDE_Rating_TRF26_R1-R3.TXT')));
check('05 ITDX not rating file',()=>assert(!api.ratingFileName('X_ITDX_TRF26_R1-R3.TXT')));
check('06 starting list not rating file',()=>assert(!api.ratingFileName('X_TRF26_Starting_List.TXT')));
check('07 range parsed from filename',()=>assert.deepEqual(api.rangeFromName('X_FIDE_Rating_TRF26_R2-R5.TXT'),{fromRound:2,toRound:5}));
check('08 default range safe',()=>assert.equal(api.rangeFromName('X.txt').toRound,999));
let x=api.ensureBaku('192 FIDE_DUTCH_2025\r\n001    1\r\n');
check('09 Baku type retained in final TRF',()=>assert(x.includes('192 FIDE_DUTCH_2025_BAKU')));
check('10 Baku 250 reaches final TRF',()=>assert(/^250\s/m.test(x)));
x=api.ensureUnusual299('012 T\r\n001    1\r\n',{fromRound:1,toRound:3});
check('11 unusual result Record 299 reaches rating TRF',()=>assert(/^299\s+-0\.5 2 1$/m.test(x)));
const x2=api.ensureUnusual299(x,{fromRound:1,toRound:3});
check('12 Record 299 deduplicated',()=>assert.equal((x2.match(/^299\s/gm)||[]).length,1));
check('13 out-of-range unusual adjustment omitted',()=>assert(!api.ensureUnusual299('012 T\r\n',{fromRound:3,toRound:3}).includes('299')));
check('14 canonical tie-break 212 generated',()=>assert.equal(api.tieBreak212(),'212 PTS,BH/C1,SB'));
x=api.ensure212('012 T\r\n212 PTS,OLD\r\n001    1\r\n');
check('15 existing 212 replaced',()=>assert(x.includes('212 PTS,BH/C1,SB')&&!x.includes('PTS,OLD')));
x=api.ensure212('012 T\r\n001    1\r\n');
check('16 missing 212 inserted',()=>assert(x.indexOf('212 PTS')<x.indexOf('001    1')));
let comments=api.generalComplianceComments({fromRound:1,toRound:3});
check('17 TRF-visible compliance events collected',()=>assert.equal(comments.length,2));
check('18 PIBE comment collected',()=>assert(comments.some(s=>/PIBE/.test(s))));
check('19 adjournment comment collected',()=>assert(comments.some(s=>/ADJOURNMENT/.test(s))));
check('20 trf:false event omitted',()=>assert(!comments.some(s=>/Hidden/i.test(s))));
comments=api.generalComplianceComments({fromRound:3,toRound:3});
check('21 compliance comments range-filtered',()=>assert.equal(comments.length,1)&&/ADJOURNMENT/.test(comments[0]));
x=api.ensureComplianceComments('012 T\r\n',{fromRound:1,toRound:3});
check('22 comments appended to TRF',()=>assert(x.includes('### R2 PIBE')&&x.includes('### R3 GAME ADJOURNMENT')));
const x3=api.ensureComplianceComments(x,{fromRound:1,toRound:3});
check('23 compliance comments deduplicated',()=>assert.equal((x3.match(/^### R2 PIBE/gm)||[]).length,1));
x=api.postProcessRatingTRF('012 Test\r\n192 FIDE_DUTCH_2025\r\n212 PTS,OLD\r\n001    1\r\n001    2\r\n',{fromRound:1,toRound:3,includeLegacyPostProcessors:true});
check('24 postprocess has Baku 250',()=>assert(/^250\s/m.test(x)));
check('25 postprocess has unusual 299',()=>assert(/^299\s/m.test(x)));
check('26 postprocess has current 212',()=>assert(x.includes('212 PTS,BH/C1,SB')));
check('27 postprocess has PIBE audit',()=>assert(x.includes('### R2 PIBE')));
check('28 postprocess has adjournment audit',()=>assert(x.includes('### R3 GAME ADJOURNMENT')));
check('29 postprocess preserves 001 records',()=>assert.equal((x.match(/^001/gm)||[]).length,2));
check('30 postprocess does not mutate source string',()=>{const s='012 X\r\n';api.postProcessRatingTRF(s,{includeLegacyPostProcessors:true});assert.equal(s,'012 X\r\n')});
check('31 save wrapper installed after beta60',()=>assert(ctx.cpSaveTextToTournamentTRF.__cpBeta61Wrapped));
check('32 build wrapper installed after beta60',()=>assert(ctx.buildTRF26.__cpBeta61Wrapped));
(async()=>{
 await ctx.cpSaveTextToTournamentTRF('T_FIDE_Rating_TRF26_R1-R3.TXT','012 Test\r\n192 FIDE_DUTCH_2025\r\n212 PTS,OLD\r\n001    1\r\n001    2\r\n');
 check('33 modern save path receives 250',()=>assert(/^250\s/m.test(saved.text)));
 check('34 modern save path receives 299',()=>assert(/^299\s/m.test(saved.text)));
 check('35 modern save path receives 212',()=>assert(saved.text.includes('212 PTS,BH/C1,SB')));
 check('36 modern save path receives compliance comments',()=>assert(saved.text.includes('### R2 PIBE')));
 await ctx.cpSaveTextToTournamentTRF('T_ITDX_TRF26_R1-R3.TXT','012 Raw\r\n');
 check('37 non-rating save remains untouched',()=>assert.equal(saved.text,'012 Raw\r\n'));
 const b=ctx.buildTRF26({fromRound:1,toRound:3});
 check('38 direct build has Baku 250',()=>assert(/^250\s/m.test(b.text)));
 check('39 direct build has compliance comments',()=>assert(b.text.includes('### R2 PIBE')));
 check('40 direct build does not duplicate legacy 299',()=>assert.equal((b.text.match(/^299\s/gm)||[]).length,0));
 check('41 direct build marks completeness postprocess',()=>assert.equal(b.trfCompletenessPostProcessed,true));
 check('42 direct build keeps 212 produced upstream',()=>assert(b.text.includes('212 PTS,OLD')));
 // Static integration checks.
 const html=fs.readFileSync(require('path').join(__dirname,'..','ChessPublisher.html'),'utf8');
 check('43 HTML loads beta61 module after beta60',()=>assert(html.indexOf('ChessPublisher-Beta61-Compliance.js')>html.indexOf('ChessPublisher-Beta60-Compliance.js')));
 check('44 HTML self-identifies beta61 or stable',()=>assert(html.includes('data-chesspublisher-version="1.06.00"')||/data-chesspublisher-version="1\.06\.00-beta\.(?:61|6[2-9]|[7-9]\d|\d{3,})(?:-r\d+)?"/.test(html)));
 check('45 beta61 contains no unfinished engineering wording',()=>assert(!/experimental|temporary hack|pending implementation/i.test(src)));
 check('46 protected fixed-width core is not redefined',()=>assert(!/function cpBuildFideTRF\s*\(/.test(src)&&!/function trf26SetField\s*\(/.test(src)));
 check('47 pairing-engine builder is not overridden',()=>assert(!/buildPairingEngineTRF\s*=/.test(src)));
 check('48 ITDX exporter is not overridden',()=>assert(!/exportITDX\s*=/.test(src)));
 check('49 beta60 corrections remain upstream of beta61 save wrapper',()=>assert(ctx.cpSaveTextToTournamentTRF.__cpBeta61Original));
 console.log(`RESULT ${pass} PASS ${fail} FAIL`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1});
