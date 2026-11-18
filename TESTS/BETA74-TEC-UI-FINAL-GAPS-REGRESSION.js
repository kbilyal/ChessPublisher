const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('PASS',name);}else{fail++;console.error('FAIL',name);}}
function eq(name,a,b){ok(name,JSON.stringify(a)===JSON.stringify(b));if(JSON.stringify(a)!==JSON.stringify(b))console.error(' expected',b,'got',a);}
function extractFunction(name){
  const needles=[`function ${name}(`,`async function ${name}(`];let start=-1;
  for(const needle of needles){start=html.indexOf(needle);if(start>=0)break;}
  if(start<0)throw new Error(`Function ${name} not found`);
  const brace=html.indexOf('{',start);let depth=0,quote=null,esc=false,templateDepth=0;
  for(let i=brace;i<html.length;i++){
    const c=html[i],n=html[i+1];
    if(quote){
      if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}
      if(quote==='`'&&c==='$'&&n==='{'){templateDepth++;depth++;i++;continue;}
      if(c===quote&&templateDepth===0){quote=null;continue;}
      if(quote==='`'&&c==='}'&&templateDepth>0){templateDepth--;depth--;continue;}
      continue;
    }
    if(c==='"'||c==="'"||c==='`'){quote=c;templateDepth=0;continue;}
    if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0)return html.slice(start,i+1);}
  }
  throw new Error(`Function ${name} not terminated`);
}
function context(extra={}){const c={console,Math,Number,String,Array,Object,Map,Set,Date,JSON,...extra};c.window=c;c.globalThis=c;vm.createContext(c);return c;}

{ const m=html.match(/data-chesspublisher-version="1\.06\.00-beta\.(\d+)(?:-r\d+)?"/); ok('beta.74+ package marker',Boolean(m)&&Number(m[1])>=74); }
ok('static Result Entry panel override present',/#pairings \.result-palette\{[\s\S]*?position:sticky!important/.test(html));
ok('pairing board table remains scroll surface',/#pairings \.live-pairing-table-wrap\{[\s\S]*?overflow:auto!important/.test(html));

// Q62 — actual helper + actual validation routine with complete setup stubs.
{
  const c=context({
    data:{currentTournament:'TEC Test'},document:{querySelectorAll:()=>[],getElementById:()=>null},
    clearPairingSetupValidationMarks(){},markPairingSetupField(){},escapeHtml:s=>String(s),
    ensurePairingNumbers(t){(t.players||[]).forEach((p,i)=>p.pairingNumber=i+1);},hasCompleteTournamentPairingNumbers:()=>true,
    getExistingPairingRounds:()=>[],playerKey:(p,i)=>String(p.id||i),isPlayerEligibleForRound:()=>true,isPlayerSyncedAbsent:()=>false,isPlayerExcludedForRound:()=>false
  });
  vm.runInContext(extractFunction('maximumSwissRoundsForStartingField')+'\n'+extractFunction('validateOfficialPairingSetup'),c);
  const settings={country:'BUL',timeControl:'90+30',startDate:'2026-09-01T10:00',endDate:'2026-09-05T18:00',rounds:'3',tournamentFormat:'Individual Swiss',pairingSystem:'FIDE Dutch System',fideRated:'No',tournamentRatingType:'Standard',initialRankSorting:'Rating',initialRatingSource:'FIDE',pairingScoreSystem:'game-1-0.5-0',tournamentType:'real'};
  function run(n,r){const t={settings:{...settings,rounds:String(r)},players:Array.from({length:n},(_,i)=>({id:i+1,name:`P${i+1}`,rating:1800+i})),pairings:{engine:{manualByes:{}}}};c.getCurrentTournament=()=>t;return c.validateOfficialPairingSetup(1,'dutch');}
  eq('Q62 even field max rounds',c.maximumSwissRoundsForStartingField(4),3);
  eq('Q62 odd field max rounds',c.maximumSwissRoundsForStartingField(5),5);
  ok('Q62 allows 4-player 3-round Swiss',run(4,3).ok===true);
  ok('Q62 blocks 4-player 4-round Swiss before start',run(4,4).errors.some(e=>/cannot be completed.*without repeating an opponent/i.test(e.message)));
  ok('Q62 allows 5-player 5-round Swiss',run(5,5).ok===true);
  ok('Q62 blocks 5-player 6-round Swiss before start',run(5,6).errors.some(e=>e.fieldId==='rounds'));
}

// Q99 — execute actual Berger source/order/schedule functions.
{
  const c=context({keepPairingAllocatedByeLast:x=>x});
  vm.runInContext(extractFunction('buildBergerCycleForRows')+'\n'+extractFunction('bergerSourceRoundOrder')+'\n'+extractFunction('buildCompleteBergerScheduleForRows'),c);
  const rows=Array.from({length:6},(_,i)=>({id:i+1,key:`P${i+1}`}));
  const base=c.buildBergerCycleForRows(rows,'w'),r=base.roundsPerCycle;
  eq('Q99 six-player rounds per cycle',r,5);
  eq('Q99 first cycle source order reverses final two rounds',Array.from(c.bergerSourceRoundOrder(r,0,2,6)),[1,2,3,5,4]);
  eq('Q99 second cycle returns normal Berger order',Array.from(c.bergerSourceRoundOrder(r,1,2,6)),[1,2,3,4,5]);
  eq('Q99 single-cycle order remains unchanged',Array.from(c.bergerSourceRoundOrder(r,0,1,6)),[1,2,3,4,5]);
  eq('Q99 odd field is not reordered',Array.from(c.bergerSourceRoundOrder(5,0,2,5)),[1,2,3,4,5]);
  const schedule=c.buildCompleteBergerScheduleForRows(rows,2,'w').schedule;
  const sig=boards=>boards.map(b=>[b.whiteKey,b.blackKey].sort().join('-')).sort().join('|');
  const baseSig=n=>{const br=base.rounds.find(x=>x.round===n);return br.pairs.map(p=>[p[0]?`P${p[0]}`:'',p[1]?`P${p[1]}`:''].sort().join('-')).sort().join('|');};
  eq('Q99 penultimate first-cycle slot uses original final Berger round',sig(schedule['4']),baseSig(5));
  eq('Q99 final first-cycle slot uses original penultimate Berger round',sig(schedule['5']),baseSig(4));
  eq('Q99 first slot of return cycle resumes normal source round 1',sig(schedule['6']),baseSig(1));
}

// Q128 — execute actual search-result sequence fallback helpers.
{
  const tournament={settings:{ratingListSequence:['fide-standard','fide-rapid','fide-blitz']}};
  const labels={'fide-standard':'FIDE Standard','fide-rapid':'FIDE Rapid','fide-blitz':'FIDE Blitz','effective-rapid':'Effective Rapid','effective-blitz':'Effective Blitz'};
  const c=context({getCurrentTournament:()=>tournament,cpBeta66:{LABELS:labels,sequenceFor:t=>t.settings.ratingListSequence}});c.window.cpBeta66=c.cpBeta66;
  vm.runInContext(extractFunction('fideSearchRatingForList')+'\n'+extractFunction('fideSearchRatingSequenceFallbackNotice'),c);
  const notice=c.fideSearchRatingSequenceFallbackNotice({std:0,rapid:2111,blitz:1999},tournament);
  ok('Q128 main-list miss identifies later sequence ratings',/Main list FIDE Standard: no rating/.test(notice)&&/FIDE Rapid: 2111/.test(notice)&&/FIDE Blitz: 1999/.test(notice));
  eq('Q128 no fallback notice when main list has rating',c.fideSearchRatingSequenceFallbackNotice({std:2200,rapid:2111,blitz:0},tournament),'');
  const effective={settings:{ratingListSequence:['effective-rapid','fide-blitz']}};
  eq('Q128 effective main list recognizes Standard fallback',c.fideSearchRatingSequenceFallbackNotice({std:2050,rapid:0,blitz:1900},effective),'');
  ok('Q128 rendered FIDE result contains sequence notice hook',/cp-rating-sequence-fallback/.test(html)&&/fideSearchRatingSequenceFallbackNotice\(player\)/.test(html));
}

// Q209 — actual rating-performance function proves two explicit unrated methods.
{
  const c=context({
    fidePointsFromRound:g=>g.result==='1'?1:g.result==='='?.5:0,
    fideRoundedAverage:a=>a.length?Math.round(a.reduce((s,x)=>s+x,0)/a.length):0,
    fidePerformanceDifference:()=>0,
    fidePerfectTournamentPerformance:g=>g.length?1:0
  });
  vm.runInContext(extractFunction('fidePerformanceMetricsForPlayer'),c);
  const a={id:1,rating:2000,rounds:[{opp:2,played:true,result:'1'}]},b={id:2,rating:0,rounds:[{opp:1,played:true,result:'0'}]},map=new Map([[1,a],[2,b]]);
  eq('Q209 method 1 substitutes configured rating for unrated opponent',c.fidePerformanceMetricsForPlayer(a,map,1400).aro,1400);
  eq('Q209 method 2 excludes unrated opponent when setting is zero',c.fidePerformanceMetricsForPlayer(a,map,0).games.length,0);
  ok('Q209 UI documents zero as exclusion method',/tbOptUnratedRating88[^>]*[\s\S]{0,300}0 excludes unrated opponents/.test(html));
}

// User-requested export UI.
{
  const c=context();
  vm.runInContext(extractFunction('pairingsExportDefaults')+'\n'+extractFunction('pairingsExportClassicColumns')+'\n'+extractFunction('startingListExportDefaults')+'\n'+extractFunction('startingListExportColumns'),c);
  const pairDefaults=c.pairingsExportDefaults();
  ok('Pairings PDF default includes Board and SNo toggles',pairDefaults.board===true&&pairDefaults.sno===true);
  let keys=Array.from(c.pairingsExportClassicColumns({...pairDefaults,board:false,sno:false})).map(x=>x.key);
  ok('Pairings PDF can hide Board and both SNo columns',!keys.includes('board')&&!keys.includes('whiteSNo')&&!keys.includes('blackSNo'));
  ok('Pairings modal exposes Board/SNo/FIDE ID tick boxes',/id="peShowBoard"/.test(html)&&/id="peShowSNo"/.test(html)&&/id="peShowFideId"/.test(html));
  const sl=c.startingListExportDefaults();
  keys=Array.from(c.startingListExportColumns({...sl,fideId:true,gender:true,birth:true})).map(x=>x.key);
  ok('Starting List export supports SNo Title Name Rating FED FIDE ID Gender Birth',['sno','title','name','rating','fed','fideId','gender','birth'].every(k=>keys.includes(k)));
  ok('Starting List Name checkbox is mandatory',/id="slShowName"[^>]*checked disabled/.test(html));
}

console.log(`BETA74 TEC/UI RESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail?1:0);
