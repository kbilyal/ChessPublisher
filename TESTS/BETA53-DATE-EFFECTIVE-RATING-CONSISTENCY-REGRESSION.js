const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'ChessPublisher-Beta53-Compliance.js'),'utf8');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
let pass=0,fail=0;
function ok(cond,name){if(cond){pass++;console.log('PASS',name);}else{fail++;console.error('FAIL',name);}}
function eq(a,b,name){ok(a===b,`${name} (${JSON.stringify(a)} === ${JSON.stringify(b)})`);}
async function rejects(fn,pattern,name){try{await fn();ok(false,name);}catch(e){ok(pattern.test(String(e&&e.message||e)),name);}}

function makeContext({period='2026-09',currentRatings={},fetchImpl=null}={}){
  const elements=new Map();
  const ctx={
    console, Map, Set, Date, Intl, TextEncoder, TextDecoder,
    setTimeout, clearTimeout,
    document:{
      readyState:'complete',
      documentElement:{dataset:{}},
      getElementById(id){return elements.get(id)||null;}
    },
    getCurrentTournament(){return {settings:{startDate:'2026-09-01T09:00',endDate:'2026-09-05T18:00'},players:[]};},
    fideCacheMeta:{lists:{std:{periodKey:period},rapid:{periodKey:period},blitz:{periodKey:period}}},
    fideMainDb:new Map(Object.entries(currentRatings)),
    normalizeFideListLine(line){
      const id=String(line).substring(0,15).trim();
      const m=String(line).match(/\|(\d+)\s*$/);
      return /^\d{5,15}$/.test(id)?{fideId:id,rating:m?Number(m[1]):0}:null;
    },
    extractFirstTextFromZip:async()=>ctx.__zipText||'',
    fetch:fetchImpl||(async()=>{ctx.__fetchCount=(ctx.__fetchCount||0)+1; return {ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0)};}),
    window:null
  };
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(js,ctx,{filename:'ChessPublisher-Beta53-Compliance.js'});
  return {ctx,api:ctx.cpBeta53,elements};
}

(async()=>{
  const {ctx,api,elements}=makeContext();
  eq(api.VERSION,'1.06.00-beta.53','beta53 version');
  eq(api.periodKeyFromDate('2026-07-14T10:00'),'2026-07','period key from local datetime');
  eq(api.periodKeyFromDate(new Date(2025,0,31)),'2025-01','period key from Date');

  let t={settings:{startDate:'2026-07-10T10:00',endDate:'2026-07-20T18:00'}};
  let target=api.consistencyTarget(t,new Date(2026,8,8));
  eq(target.periodKey,'2026-07','short event uses start month');
  eq(target.reason,'tournament start date','short event reason');
  ok(!target.longEvent,'short event flag');

  t={settings:{startDate:'2026-07-01T00:00',endDate:'2026-07-31T00:00'}};
  target=api.consistencyTarget(t,new Date(2026,8,8));
  eq(target.periodKey,'2026-07','exactly 30 days still uses start month');
  ok(!target.longEvent,'exactly 30 days is not long');

  t={settings:{startDate:'2026-07-01T00:00',endDate:'2026-08-01T00:01'}};
  target=api.consistencyTarget(t,new Date(2026,8,8,12));
  eq(target.periodKey,'2026-09','over 30 days uses check month');
  eq(target.reason,'date of check','long event reason');
  ok(target.longEvent,'long event flag');

  try{api.consistencyTarget({settings:{}},new Date());ok(false,'missing start fails');}catch(e){ok(/Start Date/.test(e.message),'missing start fails');}
  try{api.consistencyTarget({settings:{startDate:'2026-09-10',endDate:'2026-09-01'}},new Date());ok(false,'end before start fails');}catch(e){ok(/End Date/.test(e.message),'end before start fails');}

  eq(api.historicalZipUrl('std','2026-07'),'https://ratings.fide.com/download/standard_jul26frl.zip','standard archive URL');
  eq(api.historicalZipUrl('rapid','2025-09'),'https://ratings.fide.com/download/rapid_sep25frl.zip','rapid archive URL');
  eq(api.historicalZipUrl('blitz','2024-01'),'https://ratings.fide.com/download/blitz_jan24frl.zip','blitz archive URL');
  eq(api.cacheKey('std','2026-07'),'history:2026-07:std','historical cache key');

  const lines='12345678       Player A |2100\n87654321       Player B |1900\n11111111       Other |2500';
  const parsed=api.parseTargetRatings(lines,['12345678','87654321','99999999']);
  eq(parsed.get('12345678'),2100,'parser gets first requested rating');
  eq(parsed.get('87654321'),1900,'parser gets second requested rating');
  eq(parsed.get('99999999'),0,'parser keeps absent requested player unrated');
  ok(!parsed.has('11111111'),'parser ignores non-requested player');

  ok(api.cacheCovers({version:1,queriedIds:['10001','10002']},['10001','10002']),'cache covers all IDs');
  ok(!api.cacheCovers({version:1,queriedIds:['10001']},['10001','10002']),'partial cache does not cover request');
  const snapMap=api.mapFromSnapshot({ratings:{'10001':2200,'10002':0}},['10001','10002']);
  eq(snapMap.get('10001'),2200,'snapshot map rating');
  eq(snapMap.get('10002'),0,'snapshot map unrated');

  // Current-period optimization: no network, values from current cache.
  const current=makeContext({period:'2026-09',currentRatings:{'12345678':{std:2222,name:'Current'}}});
  current.ctx.__fetchCount=0;
  let loaded=await current.api.loadRatings('std','2026-09',['12345678']);
  eq(loaded.from,'current-cache','current period uses current FIDE cache');
  eq(loaded.ratings.get('12345678'),2222,'current cache rating used');
  eq(current.ctx.__fetchCount,0,'current period does not fetch archive');

  // Historical period must fetch archive even when a current rating exists.
  const historical=makeContext({period:'2026-09',currentRatings:{'12345678':{std:2500,name:'Current'}},fetchImpl:async url=>{
    historical.ctx.__fetchCount=(historical.ctx.__fetchCount||0)+1;
    historical.ctx.__lastUrl=url;
    historical.ctx.__zipText='12345678       Historical |2100';
    return {ok:true,status:200,arrayBuffer:async()=>new ArrayBuffer(4)};
  }});
  loaded=await historical.api.loadRatings('std','2026-07',['12345678']);
  eq(loaded.from,'official-archive','historical period uses official archive');
  eq(loaded.ratings.get('12345678'),2100,'historical archive rating overrides current for check');
  eq(historical.ctx.fideMainDb.get('12345678').std,2500,'historical lookup does not mutate current cache');
  ok(/standard_jul26frl\.zip$/.test(historical.ctx.__lastUrl),'historical fetch uses target month URL');

  // Fail closed: current data exists but requested historical list is unavailable.
  const unavailable=makeContext({period:'2026-09',currentRatings:{'12345678':{std:2500}},fetchImpl:async()=>({ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0)})});
  await rejects(()=>unavailable.api.loadRatings('std','2026-07',['12345678']),/not run with a different list|unavailable/, 'historical failure does not fall back to current list');

  // Apply overlay clones lookup references and keeps current metadata for non-rating fields.
  const applied=makeContext({period:'2026-09',currentRatings:{'12345678':{std:2500}},fetchImpl:async()=>{
    applied.ctx.__zipText='12345678       Historical |2050';
    return {ok:true,status:200,arrayBuffer:async()=>new ArrayBuffer(2)};
  }});
  const originalRef={fideId:'12345678',name:'Player A',fed:'BUL',std:2500,title:'FM'};
  const lookup={byId:new Map([['12345678',originalRef]]),source:'current'};
  await applied.api.applyDateEffectiveRatings({settings:{startDate:'2026-07-03T10:00',endDate:'2026-07-08T10:00'},players:[]},lookup,{rating:true,type:'std'},['12345678'],new Date(2026,8,8));
  eq(lookup.byId.get('12345678').std,2050,'date-effective overlay sets historical rating');
  eq(lookup.byId.get('12345678').title,'FM','date-effective overlay preserves directory metadata');
  eq(originalRef.std,2500,'date-effective overlay clones source ref');
  eq(lookup.ratingPeriodKey,'2026-07','lookup records effective period');
  eq(lookup.ratingPeriodReason,'tournament start date','lookup records reason');
  ok(/FIDE Standard Jul 2026/.test(lookup.source),'lookup source names effective FIDE list');
  eq(applied.api.provenanceSource('std'),'FIDE Standard 2026-07','provenance source includes effective period');

  // Long event picks date-of-check period in apply path.
  const longCtx=makeContext({period:'2026-09',currentRatings:{'12345678':{std:2300,name:'P'}}});
  const longLookup={byId:new Map([['12345678',{fideId:'12345678',std:2300}]])};
  await longCtx.api.applyDateEffectiveRatings({settings:{startDate:'2026-07-01',endDate:'2026-08-15'},players:[]},longLookup,{rating:true,type:'std'},['12345678'],new Date(2026,8,8));
  eq(longLookup.ratingPeriodKey,'2026-09','long event apply uses date-of-check month');
  eq(longLookup.ratingPeriodReason,'date of check','long event apply reason');

  // No rating selection leaves ordinary lookup untouched and avoids target-date requirement.
  const noRatingLookup={byId:new Map()};
  const same=await api.applyDateEffectiveRatings({settings:{}},noRatingLookup,{rating:false,type:'std'},['12345678']);
  ok(same===noRatingLookup,'non-rating check does not require rating-list period');

  // Concise modal status.
  const statusEl={textContent:''}; elements.set('registeredFideEffectivePeriod',statusEl);
  api.renderConsistencyPeriod({settings:{startDate:'2026-07-01',endDate:'2026-07-10'}});
  ok(/^Consistency list: Jul 2026 · tournament start date$/.test(statusEl.textContent),'modal shows concise effective period');

  // Product integration markers/order.
  ok(html.includes('ChessPublisher-Beta53-Compliance.js'),'HTML loads beta53 layer');
  ok(html.includes('id="registeredFideEffectivePeriod"'),'HTML contains concise effective-period UI');
  const lookupIdx=html.indexOf('const lookup=await lookupRegisteredPlayersInFideDirectory(registeredIds);');
  const overlayIdx=html.indexOf('cpBeta53.applyDateEffectiveRatings',lookupIdx);
  const evalIdx=html.indexOf('evaluateRegisteredFideUpdate(t,lookup,options,applyChanges)',lookupIdx);
  ok(lookupIdx>=0&&overlayIdx>lookupIdx&&evalIdx>overlayIdx,'date-effective overlay runs before consistency evaluation');
  ok(html.includes('cpBeta53.provenanceSource(type)'),'consistency update records effective list in provenance');
  ok(html.includes('cpBeta53.renderConsistencyPeriod(t)'),'dialog renders effective-period status');
  ok(!/experimental date-effective|pending historical/i.test(html),'no unfinished beta53 UI wording');

  console.log(`\nBETA53 RESULT: ${pass} PASS / ${fail} FAIL`);
  process.exitCode=fail?1:0;
})().catch(err=>{console.error(err);process.exitCode=1;});
