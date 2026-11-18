const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(__dirname+'/../ChessPublisher-Beta44-Compliance.js','utf8');
let alerts=[],warnings=[],pibes=[],saved=0,persisted=0,rendered=0;
const playerA={name:'A',pairingNumber:1,rating:2000},playerB={name:'B',pairingNumber:2,rating:1900},playerC={name:'C',pairingNumber:3,rating:1800},playerD={name:'D',pairingNumber:4,rating:1700};
const tournament={settings:{rounds:'7',pairingSystem:'FIDE Dutch System',tournamentFormat:'Individual Swiss',pabPoints:'1'},regulations:{pabPoints:'1',tieBreaks:[]},players:[playerA,playerB,playerC,playerD],pairings:{engine:{},liveBoards:{'1':[{board:1,whiteKey:'p1',blackKey:'p2',result:'-'},{board:2,whiteKey:'p3',blackKey:'p4',result:'-'}]}}};
const elements={};
function fakeEl(id=''){return elements[id]||(elements[id]={id,dataset:{},classList:{add(){},remove(){},toggle(){}},textContent:'',value:'',disabled:false,options:[],appendChild(){},insertAdjacentElement(){},setAttribute(){},querySelector(){return null},querySelectorAll(){return []}});}
const ctx={console,window:null,document:{readyState:'complete',documentElement:{dataset:{}},title:'',getElementById:id=>elements[id]||null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>fakeEl('x')},
 data:{currentTournament:'T',tournaments:{T:tournament}},selectedLiveBoardIndex:0,manualPairingMode:false,
 getCurrentTournament:()=>tournament,getLatestGeneratedRound:()=>1,getSelectedPairingRoundNumber:()=>1,getExistingPairingRounds:()=>[1],
 getLanguage:()=> 'en',playerKey:(p,i)=>'p'+(i+1),resolveRegisteredPlayer:k=>({p1:playerA,p2:playerB,p3:playerC,p4:playerD}[k]||null),
 isRoundRobinTournament:()=>false,isRoundRobinFormat:()=>false,isPlayerEligibleForRound:()=>true,isPlayerExcludedForRound:()=>false,isPlayerSyncedAbsent:()=>false,
 saveData:()=>saved++,writePersistentState:async()=>{persisted++;return true},normalizeData:()=>{},setStatus:()=>{},appAlert:async m=>alerts.push(m),appConfirm:async()=>true,appPrompt:async()=>null,
 cpRecordPibe:(a,m,o)=>pibes.push({a,m,o}),cpFideModeActive:()=>true,cpFideWarning:async(l,m,o)=>{warnings.push({l,m,o});return true},
 getLivePairingBoards:()=>tournament.pairings.liveBoards['1'],isRealPairingBoard:b=>!!b.whiteKey&&!!b.blackKey,isByeResult:r=>/BYE|PAB/.test(String(r)),isForfeitResult:r=>/F/.test(String(r)),
 renderLivePairings:()=>rendered++,refreshFinalStandings:()=>{},updateGacruxPanel:()=>{},recalculateRoundHistoryState:()=>{},selectLivePairingBoard:()=>{},findNextRealPairingBoardIndex:()=>-1,
 updateResultPaletteSelection:()=>{},applyResultToSelectedBoard:(r)=>{tournament.pairings.liveBoards['1'][0].result=r},
 updateLivePairingBoard:()=>{},requestLocalGacruxPairs:async()=>[],editPabPoints:async()=>{},populateTieBreakMenus:()=>{},calculateFinalStandings:()=>({players:[],tieList:[],completed:0}),
 tournamentState:()=>({rows:[{id:1,name:'A',rating:2000,score:0,rounds:[]},{id:2,name:'B',rating:1900,score:0,rounds:[]}]}),standingTieBreakValue:()=>0,
 addTieBreakCriterion:()=>{},moveTieBreakCriterion:()=>{},removeTieBreakCriterion:()=>{},saveTieBreakSettingsModal:async()=>{},getTournamentTieBreakPriority:()=>tournament.regulations.tieBreaks,
 cpVerifyPairingIntegrityForRound:async()=>({ok:true,round:1}),cpFidePairingMismatchGate:async()=>true,
 trf26SetField:(line,start,len,value,right=false)=>{let a=String(line).padEnd(start-1+len,' ').split(''),v=String(value);v=(right?v.padStart(len,' '):v.padEnd(len,' ')).slice(0,len);for(let i=0;i<len;i++)a[start-1+i]=v[i];return a.join('')},
 buildPairingEngineTRF:()=> '012 T\r\n142 7\r\n192 FIDE_DUTCH_2025\r\n',trf26PairingTypeCode:()=> 'FIDE_DUTCH_2025',
 trfLineField:(line,start,len)=>String(line).substring(start-1,start-1+len).trim(),parseTRF26Tournament:text=>({rounds:{1:[{whiteNo:1,blackNo:2,result:'½ - ½'}]}}),
 fidePointsFromRound:g=>Number(g?.points)||0,
 setTimeout:fn=>fn(),Blob:function(){},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},safeFileName:x=>x,
};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'beta44'});
let pass=0;function ok(name,fn){try{fn();console.log('PASS',name);pass++;}catch(e){console.error('FAIL',name,e);process.exitCode=1;}}
function okAsync(name,fn){return Promise.resolve().then(fn).then(()=>{console.log('PASS',name);pass++;},e=>{console.error('FAIL',name,e);process.exitCode=1;});}
ok('version marker',()=>assert.equal(ctx.document.documentElement.dataset.chesspublisherVersion,'1.06.00-beta.44'));
ok('Baku full point phase',()=>assert.equal(ctx.cpBeta44.bakuVirtual(1),1));
ok('Baku half point phase',()=>assert.equal(ctx.cpBeta44.bakuVirtual(3),.5));
ok('Baku ends',()=>assert.equal(ctx.cpBeta44.bakuVirtual(5),0));
tournament.settings.accelerationMethod='BAKU';ok('TRF Baku type',()=>assert(ctx.cpBeta44.addBakuRecords('192 FIDE_DUTCH_2025\r\n').includes('FIDE_DUTCH_2025_BAKU')));ok('TRF 250 present',()=>assert(ctx.cpBeta44.addBakuRecords('192 FIDE_DUTCH_2025\r\n').includes('250')));
tournament.settings.accelerationMethod='NONE';tournament.prohibitedPairings=[{a:1,b:2,rounds:[1]}];ok('prohibited pairing current round',()=>assert.equal(ctx.cpBeta44.restrictionApplies(1,2,1),true));ok('prohibited pairing other round',()=>assert.equal(ctx.cpBeta44.restrictionApplies(1,2,2),false));
const trfLine=('001 '+String(1).padStart(4)+' '.repeat(83)+'0002 w ?').padEnd(110,' ');const sanitized=ctx.cpBeta44.sanitizeITDX(trfLine);ok('ITDX unknown detected',()=>assert.equal(sanitized.unknown.length,1));ok('ITDX unknown sanitized for base parser',()=>assert(sanitized.text.includes('=')));
(async()=>{await okAsync('mark selected Adjourned',async()=>{await ctx.cpBeta44.markSelectedAdjourned();assert.equal(tournament.pairings.liveBoards['1'][0].adjourned,true);assert.equal(tournament.pairings.liveBoards['1'][0].result,'-');assert(pibes.some(x=>x.a==='Game Adjournment'));});await okAsync('non-draw final result Level-3',async()=>{await ctx.applyResultToSelectedBoard('1 - 0',false);assert.equal(tournament.pairings.liveBoards['1'][0].adjourned,false);assert.equal(tournament.pairings.liveBoards['1'][0].result,'1 - 0');assert(warnings.some(x=>x.l===3));assert(pibes.some(x=>x.a==='Adjourned Game Result'));});
 if(process.exitCode)process.exit(1);console.log(`RESULT ${pass} PASS / 0 FAIL`);})();
