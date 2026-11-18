const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const moduleText=fs.readFileSync(path.join(root,'ChessPublisher-Beta72-RatingLists.js'),'utf8');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
const updater=fs.readFileSync(path.join(root,'FIDE-Update.ps1'),'utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){console.log('PASS',name);pass++;}else{console.error('FAIL',name);fail++;}}
function eq(name,a,b){ok(name,JSON.stringify(a)===JSON.stringify(b));if(JSON.stringify(a)!==JSON.stringify(b))console.error(' expected',b,'got',a);}
const idbStore=new Map();
function fakeDb(){return {transaction(_store,mode){const ops=[];const tx={};const store={get(key){const req={};setTimeout(()=>{req.result=idbStore.get(key)||null;req.onsuccess&&req.onsuccess();},0);return req;},put(value,key){ops.push(['put',key,JSON.parse(JSON.stringify(value))]);},delete(key){ops.push(['delete',key]);}};tx.objectStore=()=>store;setTimeout(()=>{try{if(mode==='readwrite'){for(const op of ops){if(op[0]==='put')idbStore.set(op[1],op[2]);else idbStore.delete(op[1]);}}tx.oncomplete&&tx.oncomplete();}catch(e){tx.error=e;tx.onerror&&tx.onerror();}},0);return tx;}};}
const localStore=new Map();
const document={readyState:'loading',addEventListener(){},getElementById(){return null;},querySelector(){return null;},querySelectorAll(){return[];},createElement(){return {style:{},appendChild(){},set innerHTML(v){this._html=v},get innerHTML(){return this._html||''}};},body:{appendChild(){}},head:{appendChild(){}},documentElement:{dataset:{}}};
const context={console,Map,Set,Date,JSON,Math,Number,String,Array,Object,Promise,TextEncoder,Intl,setTimeout,clearTimeout,crypto:crypto.webcrypto,document,window:null,globalThis:null,localStorage:{getItem:k=>localStore.get(k)||null,setItem:(k,v)=>localStore.set(k,String(v))},fideMainDb:new Map(),fideCacheMeta:{periodKey:'',updatedAt:'',source:'',lists:{std:{},rapid:{},blitz:{}}},fideBackgroundUpdateRunning:false,fideImportInProgress:false,FIDE_CACHE_STORE:'cache',openFideCacheDb:async()=>fakeDb(),normalizeFideCacheMeta:m=>JSON.parse(JSON.stringify(m||{})),currentFidePeriodKey:()=> '2026-09',fideHashBytes:b=>`${b.length}:fallback`,updateFideAutoStatus(){},setStatus(){},appAlert(){},updateFideCounts(){},refreshFidePeriodBadges(){},renderFideSearchWithLegacy(){},renderFideResults(){},latestSearchRequest:0,fideSearchTimer:null,getCurrentTournament:()=>null};
context.window=context;context.globalThis=context;
vm.createContext(context);vm.runInContext(moduleText,context,{filename:'ChessPublisher-Beta72-RatingLists.js'});
const api=context.cpBeta72RatingLists;
function row(id,name,fed,sex,title,rating,games,k,birth){return String(id).padEnd(15)+String(name).padEnd(61)+`${fed} ${sex} ${title||'-'} ${rating} ${games} ${k} ${birth}`;}
function list(type,ratings){return ['ID Name'.padEnd(100),...ratings.map(r=>row(...r))].join('\n');}
const stdA=list('std',[[1000001,'José García','ESP','M','GM',1802,12,20,1989],[1000002,'Bilyal, Kyamran','BUL','M','',1817,8,20,1988]]);
const rapidA=list('rapid',[[1000001,'JOSE GARCIA','ESP','M','GM',1775,6,20,1989],[1000002,'Bilyal, Kyamran','BUL','M','',1790,7,20,1988]]);
const blitzA=list('blitz',[[1000001,'Jose-Garcia','ESP','M','GM',1750,5,20,1989],[1000002,'Bilyal Kyamran','BUL','M','',1760,5,20,1988]]);
const stdB=list('std',[[1000001,'José García','ESP','M','GM',1810,13,20,1989],[1000002,'Bilyal, Kyamran','BUL','M','',1825,9,20,1988]]);
const rapidB=list('rapid',[[1000001,'JOSE GARCIA','ESP','M','GM',1788,7,20,1989],[1000002,'Bilyal, Kyamran','BUL','M','',1800,8,20,1988]]);
const blitzB=list('blitz',[[1000001,'Jose-Garcia','ESP','M','GM',1765,6,20,1989],[1000002,'Bilyal Kyamran','BUL','M','',1770,6,20,1988]]);
(async()=>{
  ok('HTML branded beta.72 or newer, or stable 1.06.00',html.includes('data-chesspublisher-version="1.06.00"')||/data-chesspublisher-version="1\.06\.00-beta\.(?:7[2-9]|[89][0-9]|[1-9][0-9]{2,})(?:-r\d+)?"/.test(html));
  ok('beta.72 module loaded after beta.70',html.indexOf('ChessPublisher-Beta72-RatingLists.js')>html.indexOf('ChessPublisher-Beta70-Compliance.js'));
  ok('Integrated Rating Lists UI strings present',/Integrated Rating Lists/.test(moduleText)&&/Update Rating Lists/.test(moduleText)&&/View Last Update Report/.test(moduleText));
  ok('Review Player Updates explicit command present',/Review Player Updates/.test(moduleText)&&/Nothing has been applied/.test(moduleText));
  ok('rating lists copied into player snapshot on add',/ratingListSnapshot:window\.cpBeta72RatingLists/.test(html));
  ok('installation-local generation keys are outside tournament data',/rating-lists:active-generation:v3/.test(moduleText)&&!/data\.tournaments.*rating-lists:active-generation/.test(moduleText));
  eq('name normalization removes accents/punctuation',api.normalizeName('José,   García'),api.normalizeName('jose-garcia'));
  ok('deterministic token-prefix name matching',api.tokenPrefixMatch('José García','jose gar')&&!api.tokenPrefixMatch('José García','ose arc'));
  ok('exact numeric FIDE ID recognized',api.exactFideId('1000001')==='1000001'&&api.exactFideId('10000x1')==='');
  const parsed=api.parseFixedWidthLine(row(1000001,'José García','ESP','M','GM',1802,12,20,1989),'std','2026-09');
  ok('Standard parser extracts FIDE ID/name/fed/title/sex/birth/rating/K',parsed.fideId==='1000001'&&parsed.name==='José García'&&parsed.fed==='ESP'&&parsed.title==='GM'&&parsed.gender==='m'&&parsed.birth==='1989'&&parsed.rating===1802&&parsed.k===20);
  const built=await api.buildGenerationFromTexts({std:{text:stdA,source:'fixture'},rapid:{text:rapidA,source:'fixture'},blitz:{text:blitzA,source:'fixture'}},{minimumRecords:1,synchronous:true,periodKey:'2026-09'});
  eq('Standard/Rapid/Blitz parser counts',built.counts,{std:2,rapid:2,blitz:2,unique:2});
  const jose=built.temp.get('1000001');
  ok('one logical player record combines all three ratings',jose.std===1802&&jose.rapid===1775&&jose.blitz===1750&&jose.stdK===20&&jose.rapidK===20&&jose.blitzK===20);
  ok('source/list period metadata stored per logical record',jose.stdPeriod==='2026-09'&&jose.rapidPeriod==='2026-09'&&jose.blitzPeriod==='2026-09');
  ok('generation report has human-readable PASS rows',built.report.lists.std.status==='PASS'&&built.report.lists.rapid.status==='PASS'&&built.report.lists.blitz.status==='PASS');

  const first=await api.updateRatingLists({manual:false,stagedTexts:{std:{text:stdA,source:'fixture'},rapid:{text:rapidA,source:'fixture'},blitz:{text:blitzA,source:'fixture'}},minimumRecords:1,synchronous:true,periodKey:'2026-09'});
  ok('atomic generation initial activation succeeds',first===true&&context.fideMainDb.get('1000001').std===1802);
  const pointer1=idbStore.get('rating-lists:active-generation:v3');
  ok('active generation pointer written',!!pointer1?.generationKey&&!!idbStore.get(pointer1.generationKey));
  const tournament={players:[{fideId:'1000002',name:'Bilyal, Kyamran',rating:1817,pairingNumber:7,ratingListSnapshot:api.snapshotPlayer(context.fideMainDb.get('1000002'))}],pairings:{liveBoards:{1:{white:'1000002',black:'1000001'}}}};
  const tournamentBefore=JSON.parse(JSON.stringify(tournament));

  const failed=await api.updateRatingLists({manual:false,stagedTexts:{std:{text:stdB,source:'fixture'},rapid:{text:'BROKEN',source:'fixture'},blitz:{text:blitzB,source:'fixture'}},minimumRecords:1,synchronous:true,periodKey:'2026-09'});
  ok('incomplete-download/parse failure returns rollback',failed===false&&api.lastReport.status==='ROLLED BACK');
  const pointerAfterFail=idbStore.get('rating-lists:active-generation:v3');
  ok('previous DB generation preserved on failure',pointerAfterFail.generationId===pointer1.generationId&&context.fideMainDb.get('1000001').std===1802&&context.fideMainDb.get('1000001').rapid===1775);
  eq('tournament players unchanged after failed list update',tournament,tournamentBefore);

  const second=await api.updateRatingLists({manual:false,stagedTexts:{std:{text:stdB,source:'fixture'},rapid:{text:rapidB,source:'fixture'},blitz:{text:blitzB,source:'fixture'}},minimumRecords:1,synchronous:true,periodKey:'2026-09'});
  ok('complete new generation activates only after full success',second===true&&context.fideMainDb.get('1000001').std===1810&&context.fideMainDb.get('1000001').rapid===1788&&context.fideMainDb.get('1000001').blitz===1765);
  const pointer2=idbStore.get('rating-lists:active-generation:v3');
  ok('atomic generation pointer changed after successful swap',pointer2.generationId!==pointer1.generationId&&pointer2.previousGenerationKey===pointer1.generationKey);
  ok('previous complete generation remains available after swap',!!idbStore.get(pointer1.generationKey));
  eq('tournament player object still unchanged after successful list update',tournament,tournamentBefore);
  const changes=api.reviewChanges(tournament);
  ok('explicit Review Player Updates detects rating changes without applying',changes.length===1&&changes[0].fields.some(f=>f.type==='std'&&f.before===1817&&f.after===1825)&&tournament.players[0].rating===1817&&tournament.players[0].pairingNumber===7);
  ok('exact FIDE ID lookup is direct and immediate',api.searchLocal('1000001').length===1&&api.searchLocal('1000001')[0].fideId==='1000001');
  ok('normalized name variants match same player',api.searchLocal('JOSE GARCIA')[0]?.fideId==='1000001'&&api.searchLocal('jose-gar')[0]?.fideId==='1000001'&&api.searchLocal('Jose, Gar')[0]?.fideId==='1000001');
  ok('unsafe substring fuzzy guess is not used',api.searchLocal('ose arc').length===0);
  ok('update report exposes ACTIVE generation and unique count',api.lastReport.status==='ACTIVE'&&api.lastReport.uniquePlayers===2&&/Generation:/.test(api.reportText(api.lastReport)));

  ok('Windows updater stages complete generation before promotion',/\.staging-/.test(updater)&&/Get-StagedFideFile/.test(updater)&&/Promote-StagedGeneration/.test(updater));
  ok('Windows updater rollback preserves prior sources',/ROLLED BACK \/ NOT ACTIVATED/.test(updater)&&/previous complete local source files/.test(updater));
  ok('Fluidity v2 fixed Result Desk retained',/cp-windows-fluidity-v2/.test(html)&&/#pairings \.result-palette/.test(html)&&/overflow:visible!important/.test(html));
  ok('Fluidity v2 Chess-Results tab protection retained',/Keep every primary tab visible/.test(html)&&/Chess-Results/.test(html));
  ok('no F8 production test panel added',!/F8 Fluidity ON\/OFF/.test(html));
  ok('protected pairing/TRF/TB functions are not redefined by rating module',!/(generatePairingWithGacrux\s*=|exportTRF16\s*=|exportTRF26\s*=|calculateTieBreak|bbpPairings)/.test(moduleText));
  console.log(`BETA72 WINDOWS INTEGRATED RATING LISTS RESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail?1:0);
})().catch(err=>{console.error(err);process.exit(2);});
