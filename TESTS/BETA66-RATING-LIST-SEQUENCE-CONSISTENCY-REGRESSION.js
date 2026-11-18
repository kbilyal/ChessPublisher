const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('ChessPublisher.html','utf8'),js=fs.readFileSync('ChessPublisher-Beta66-Compliance.js','utf8');let pass=0,fail=0;
function check(c,m){try{assert.ok(c);console.log(`PASS ${String(++pass).padStart(2,'0')} ${m}`);}catch(e){fail++;console.log(`FAIL ${m}`);}}
check(/data-chesspublisher-version="1\.06\.00-beta\.(?:6[6-9]|[7-9]\d|\d{3,})(?:-r\d+)?"/.test(html),'HTML self-identifies beta66 or newer');
check(/ChessPublisher-Beta66-Compliance\.js/.test(html),'HTML loads beta66 module');
check(html.indexOf('ChessPublisher-Beta66-Compliance.js')>html.indexOf('ChessPublisher-Beta65-Compliance.js'),'beta66 loads after beta65');
check(/current=n\(p\?\.rating\)/.test(js),'consistency check compares Tournament Rating');
check(/No player data was changed/.test(js),'user-facing check is explicitly preview-only');
check(/verifyBeforeRequestedConsistency/.test(js),'sequence consistency verifies required FIDE lists first');
check(/consistencyTarget/.test(js),'sequence consistency uses date-effective rating period');
(async()=>{
 const els={};function el(id){return els[id]||(els[id]={id,children:[],appendChild(x){this.children.push(x);els[x.id]=x;},addEventListener(){},querySelector(){return this;},className:'',textContent:'',disabled:false});}
 const document={readyState:'complete',documentElement:{dataset:{}},title:'Chess-Publisher v1.06.00-beta.65',getElementById:id=>els[id]||null,createElement:tag=>({tagName:tag.toUpperCase(),children:[],appendChild(x){this.children.push(x);if(x.id)els[x.id]=x;},addEventListener(){},className:'',textContent:'',disabled:false}),addEventListener:()=>{}};els.ratingListSequenceControl=el('ratingListSequenceControl');
 const ratings={std:new Map([['10001',2200],['10002',2100],['10003',2000],['10004',0]]),rapid:new Map([['10001',0],['10002',2150],['10003',0],['10004',0]]),blitz:new Map([['10001',2250],['10002',0],['10003',2050],['10004',0]])};
 let verified=[];const window={document,data:{currentTournament:'Test'},cpBeta59:{cleanSequence:a=>a.slice(),syncTournament:()=>{}},cpBeta54:{verifyBeforeRequestedConsistency:async(t,o)=>verified.push(o.type)},cpBeta53:{consistencyTarget:()=>({periodKey:'2026-09',reason:'Tournament Start Date'}),loadRatings:async type=>({ratings:ratings[type],sourceUrl:`fide/${type}`,from:'official-archive'})},saveRegisteredFideUpdateReport:async()=>({opened:false}),setStatus:()=>{},appAlert:()=>{}};
 const ctx={window,document,console,Date};Object.assign(ctx,window);vm.createContext(ctx);vm.runInContext(js,ctx);Object.assign(ctx,window);const api=window.cpBeta66;
 check(api.VERSION==='1.06.00-beta.66','runtime API version is beta66');
 check(document.documentElement.dataset.chesspublisherVersion==='1.06.00-beta.66','install publishes beta66 version');
 check(!!els.ratingListSequenceCheck&&!!els.ratingListSequenceConsistencyStatus,'Rating List Sequence UI exposes dedicated consistency action/status');
 const maps=ratings;
 let r=api.resolveFromMaps('10001',['fide-standard','fide-rapid'],maps);check(r.rating===2200&&r.listId==='fide-standard','Standard sequence uses first available list');
 r=api.resolveFromMaps('10001',['effective-rapid','fide-blitz'],maps);check(r.rating===2200&&r.sourceType==='std'&&r.fallback,'Effective Rapid uses exact-period Standard fallback');
 r=api.resolveFromMaps('10003',['effective-rapid','fide-blitz'],maps);check(r.rating===2000&&r.listId==='effective-rapid'&&r.fallback,'Effective Rapid fallback wins before later Blitz list');
 r=api.resolveFromMaps('10004',['effective-rapid','fide-blitz'],maps);check(r.rating===0&&!r.listId,'sequence returns no rating when every list is empty');
 check(api.requiredRawTypes(['effective-rapid','fide-blitz']).join('|')==='rapid|std|blitz','effective sequence loads all required raw list types once');
 const t={name:'Test',settings:{ratingListSequence:['effective-rapid','fide-blitz']},players:[
  {name:'A',fideId:'10001',rating:2200,officialRating:1999},
  {name:'B',fideId:'10002',rating:2100,officialRating:2150},
  {name:'C',fideId:'10003',rating:2000,officialRating:1800},
  {name:'D',fideId:'10004',rating:1700,officialRating:1700},
  {name:'No ID',fideId:'-',rating:1500,officialRating:1500}
 ]};
 const before=JSON.stringify(t);const out=await api.checkTournament(t,new Date('2026-09-08T00:00:00Z'));
 check(out.periodKey==='2026-09'&&out.periodReason==='Tournament Start Date','check uses date-effective target period');
 check(verified.join('|')==='rapid|std|blitz','all raw lists required by sequence are verified before comparison');
 check(out.matches.length===2&&out.differences.length===1,'check identifies Tournament Rating matches and differences');
 check(out.differences[0].name==='B'&&out.differences[0].expectedRating===2150,'difference uses sequence-assigned rating, not stored Official Rating');
 check(out.unresolved.length===1&&out.unresolved[0].name==='D','players with no sequence rating are reported separately');
 check(out.noFideId.length===1,'players without valid FIDE ID are reported separately');
 check(JSON.stringify(t)===before,'sequence consistency check never mutates tournament/player data');
 const report=api.reportText(t,out);check(/Tournament Rating 2100 → 2150/.test(report)&&/Effective Rapid/.test(report),'TXT report shows current/expected Tournament Rating and source list');
 check(/Rating List Sequence consistency/.test(js),'UI/status terminology names the formal consistency check');
 check(!/experimental|pending implementation|debug only/i.test(js),'module has no unfinished engineering wording');
 check(!/buildPairingEngineTRF\s*=|buildTRF26\s*=|calculateTieBreaks\s*=|requestLocalGacruxPairs\s*=/.test(js),'beta66 does not redefine protected pairing/TRF core');
 console.log(`BETA66 RESULT: ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
