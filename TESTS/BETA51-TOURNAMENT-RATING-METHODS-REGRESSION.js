'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta51-Compliance.js'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'ChessPublisher.html'),'utf8');
let pass=0,fail=0;function check(v,m){if(v){console.log('PASS - '+m);pass++;}else{console.error('FAIL - '+m);fail++;}}
const vmn=Number((html.match(/data-chesspublisher-version="1\.06\.00-beta\.(\d+)(?:-r\d+)?"/)||[])[1]||0);check(vmn>=51,'beta.51-or-newer branding is visible at document level');
check(/Tournament Rating Method/.test(html),'setup exposes Tournament Rating Method');
for(const value of ['fide','national','fide-national','national-fide','hbfn','other'])check(new RegExp(`option value="${value}"`).test(html),`setup contains ${value} method`);
check(/editPlayerNationalRating/.test(html),'Edit Player exposes National Rating');
check(/editPlayerTournamentRating/.test(html),'Edit Player exposes Manual Tournament Rating');
check(/oldRankData\.nationalRating/.test(html)&&/oldRankData\.tournamentManualRating/.test(html),'rating-field changes trigger TPN Resort workflow');
check(/window\.cpBeta51\?\.trf172Records/.test(html),'TRF26 tournament records call beta.51 Record-172 helper');
check(/window\.cpBeta51\?\.nrsRecords/.test(html),'TRF26 export calls beta.51 NRS helper');
check(/meta\.initialRatingSource/.test(html),'complete TRF import applies imported Tournament Rating method');

function ctxFor(settings={initialRatingSource:'fide'},players=[]){
 const tournament={settings:{country:'BUL',...settings},players};
 const ctx={console,JSON,Number,String,Math,Date,Set,Map,Promise,window:null,document:undefined,
   getCurrentTournament:()=>tournament,
   initialRankStrength:(p,source)=>{const f=+p.rating||0,n=+p.nationalRating||0;if(source==='national')return n;if(source==='national-fide')return n||f;if(source==='fide-national')return f||n;return f;},
   parseTRF26Tournament:(text)=>({players:[{pairingNumber:1,name:'A',rating:2100},{pairingNumber:2,name:'B',rating:2000}],meta:{},sourceText:text})
 };
 ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(src,ctx);return {ctx,tournament};
}
let x=ctxFor({},[]);const p={rating:2200,nationalRating:2300,tournamentManualRating:2400};
check(x.ctx.cpBeta51.methodValue(p,'fide')===2200,'FIDE method uses FIDE rating');
check(x.ctx.cpBeta51.methodValue(p,'national')===2300,'NRO method uses National Rating');
check(x.ctx.cpBeta51.methodValue({rating:0,nationalRating:2300},'fide-national')===2300,'FIDON falls back to National Rating');
check(x.ctx.cpBeta51.methodValue({rating:2200,nationalRating:2300},'fide-national')===2200,'FIDON prefers FIDE rating');
check(x.ctx.cpBeta51.methodValue({rating:2200,nationalRating:2300},'national-fide')===2300,'NIDOF prefers National Rating');
check(x.ctx.cpBeta51.methodValue({rating:2200,nationalRating:0},'national-fide')===2200,'NIDOF falls back to FIDE rating');
check(x.ctx.cpBeta51.methodValue(p,'hbfn')===2400,'VCL HBFN selection includes the highest available manual Tournament Rating');
check(x.ctx.cpBeta51.methodValue(p,'other')===2400,'OTHER uses Manual Tournament Rating');

x=ctxFor({initialRatingSource:'hbfn'},[{rating:2200,nationalRating:2300,tournamentManualRating:0,fed:'BUL',pairingNumber:1}]);
check(x.ctx.cpBeta51.methodCode(x.tournament)==='HBFN','HBFN exports HBFN when manual value does not alter official FIDE/National maximum');
check(x.ctx.cpBeta51.trf172Records(x.tournament)[0]==='172 BUL HBFN','HBFN Record 172 is fixed and federation-scoped');
x=ctxFor({initialRatingSource:'hbfn'},[{rating:2200,nationalRating:2300,tournamentManualRating:2400,fed:'BUL',pairingNumber:1}]);
check(x.ctx.cpBeta51.methodCode(x.tournament)==='OTHER','manual value affecting HBFN ranking is exported as TRF26 OTHER rather than mislabelled HBFN');
check(x.ctx.cpBeta51.trf172Records(x.tournament)[0]==='172 BUL OTHER','Record 172 truthfully uses OTHER when manual Tournament Rating drives the method');
x=ctxFor({initialRatingSource:'fide'},[{rating:2200,nationalRating:2300,fed:'BUL',pairingNumber:1}]);
check(x.ctx.cpBeta51.trf172Records(x.tournament).length===0,'Record 172 is omitted when NRS does not influence ranking');

x=ctxFor({initialRatingSource:'national'},[{rating:2200,nationalRating:2314,fed:'BUL',pairingNumber:1},{rating:2100,nationalRating:0,fed:'GRE',pairingNumber:2}]);
const nrs=x.ctx.cpBeta51.nrsRecords([{id:1},{id:2}],x.tournament);
check(nrs.length===1,'NRS export includes only players with a National Rating');
check(nrs[0].slice(0,3)==='BUL','NRS record starts with rating federation');
check(nrs[0].slice(4,8).trim()==='1','NRS record preserves Starting Rank number');
check(nrs[0].slice(48,52).trim()==='2314','NRS record writes National Rating in columns 49-52');

x=ctxFor({initialRatingSource:'fide'},[]);
let parsed=x.ctx.cpBeta51.parse172AndNrs('172 BUL NIDOF\nBUL    1                                        2314\n001 dummy', {players:[{pairingNumber:1}],meta:{}});
check(parsed.meta.initialRatingSource==='national-fide','TRF26 NIDOF imports to National-then-FIDE method');
check(parsed.players[0].nationalRating===2314&&parsed.players[0].nationalRatingFed==='BUL','NRS import restores National Rating and source federation');
parsed=x.ctx.cpBeta51.parse172AndNrs('172 BUL FIDON\n001 dummy',{players:[{pairingNumber:1}],meta:{}});
check(parsed.meta.initialRatingSource==='fide-national','TRF26 FIDON imports to FIDE-then-National method');

console.log(`SUMMARY PASS=${pass} FAIL=${fail}`);process.exit(fail?1:0);
