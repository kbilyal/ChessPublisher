const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('ChessPublisher.html','utf8'),js=fs.readFileSync('ChessPublisher-Beta67-Compliance.js','utf8');let pass=0,fail=0;
function check(c,m){try{assert.ok(c);console.log(`PASS ${String(++pass).padStart(2,'0')} ${m}`);}catch(e){fail++;console.log(`FAIL ${m}`);}}
check((()=>{const m=html.match(/data-chesspublisher-version="1\.06\.00-beta\.(\d+)(?:-r\d+)?"/);return !!m&&Number(m[1])>=67;})(),'HTML self-identifies beta67 or newer');
check(/ChessPublisher-Beta67-Compliance\.js/.test(html),'HTML loads beta67 module');
check(html.indexOf('ChessPublisher-Beta67-Compliance.js')>html.indexOf('ChessPublisher-Beta66-Compliance.js'),'beta67 loads after beta66');
check(/highest score of the higher-ranked player/.test(js),'module states first FIDE publication criterion');
check(/highest combined score/.test(js),'module states second FIDE publication criterion');
check(/lowest TPN of the higher-ranked player/.test(js),'module states third FIDE publication criterion');
check(/bakuVirtual/.test(js)&&/bakuGroupKeys/.test(js),'Baku virtual pairing points are included in publication-order audit');
check(/Nothing was published or renumbered/.test(js),'failed audit blocks publication without hidden renumbering');
check(!/requestLocalGacruxPairs\s*=|buildPairingEngineTRF\s*=|buildTRF26\s*=|calculateTieBreaks\s*=/.test(js),'beta67 does not redefine protected pairing/TRF core');
(async()=>{
 const players={A:{pairingNumber:8},B:{pairingNumber:10},C:{pairingNumber:3},D:{pairingNumber:12},E:{pairingNumber:4},F:{pairingNumber:9},G:{pairingNumber:2},H:{pairingNumber:7}};
 const actualScores=new Map([['A',3],['B',2.5],['C',3],['D',3],['E',3],['F',2.5],['G',2.5],['H',2.5]]);
 const document={readyState:'complete',documentElement:{dataset:{}},title:'Chess-Publisher v1.06.00-beta.66',getElementById:()=>null,addEventListener:()=>{}};
 let alerts=0,exports=0,telegrams=0;
 const tournament={settings:{accelerationMethod:'NONE'},pairings:{engine:{},liveBoards:{'4':[]}}};
 const window={document,getCurrentTournament:()=>tournament,getSelectedPairingRoundNumber:()=>4,resolveRegisteredPlayer:key=>players[key],pairingPointsBeforeRound:()=>actualScores,runPairingsExport:async()=>{exports++;return true;},publishProgramPairingsTelegram:async()=>{telegrams++;return true;},appAlert:async()=>{alerts++;}};
 const ctx={window,document,console,Date,Map,Set,Number,String,Math};Object.assign(ctx,window);vm.createContext(ctx);vm.runInContext(js,ctx);Object.assign(ctx,window);const api=window.cpBeta67;
 check(api.VERSION==='1.06.00-beta.67','runtime API version is beta67');
 check(document.documentElement.dataset.chesspublisherVersion==='1.06.00-beta.67','install publishes beta67 version');
 const fixture=[
  {whiteKey:'C',blackKey:'D',result:'-'}, // 3+3, HRP TPN 3
  {whiteKey:'E',blackKey:'F',result:'-'}, // 3+2.5, HRP TPN 4
  {whiteKey:'A',blackKey:'B',result:'-'}, // 3+2.5, HRP TPN 8
  {whiteKey:'G',blackKey:'H',result:'-'}  // 2.5+2.5
 ];
 let audit=api.auditBoards(fixture,4,tournament);
 check(audit.ok,'deterministic fixture satisfies all three publication-order criteria');
 check(audit.expectedOrder.join(',')===audit.actualOrder.join(','),'expected and actual order are identical for valid fixture');
 const wrong=[fixture[2],fixture[1],fixture[0],fixture[3]];
 audit=api.auditBoards(wrong,4,tournament);
 check(!audit.ok&&audit.reason==='pair-order','misordered board list is detected');
 check(audit.expectedOrder[0]==='C|D'&&audit.expectedOrder[1]==='E|F'&&audit.expectedOrder[2]==='A|B','criteria order: highest pair score, sum, then HRP TPN');
 const equalScoreEntry=api.entry({whiteKey:'C',blackKey:'D'},0,4,tournament);
 check(equalScoreEntry.hrpTpn===3,'when scores are equal the lower TPN is the higher-ranked player');
 const byeMixed=[fixture[0],{whiteKey:'H',blackKey:'',result:'PAB'},fixture[1]];
 const normalized=api.normalizedPublicationBoards(byeMixed);
 check(normalized[2].result==='PAB'&&normalized.every((b,i)=>b.board===i+1),'non-pair rows are placed after ordinary pairs in publication copy only');
 check(byeMixed[1].result==='PAB'&&!('board' in byeMixed[0]),'publication normalization does not mutate authoritative pairing boards');
 tournament.settings.accelerationMethod='BAKU';tournament.pairings.engine.bakuGroupKeys=['G','H'];window.cpBeta44={bakuVirtual:()=>1};
 const bakuScores=new Map([['A',3],['B',2.5],['G',2.5],['H',2.5]]);window.pairingPointsBeforeRound=()=>bakuScores;ctx.pairingPointsBeforeRound=window.pairingPointsBeforeRound;
 const accelerated=[{whiteKey:'G',blackKey:'H',result:'-'},{whiteKey:'A',blackKey:'B',result:'-'}];
 audit=api.auditBoards(accelerated,4,tournament);
 check(audit.ok,'Baku fixture ranks boards by actual plus virtual pairing points');
 check(api.playerScore(tournament,4,'G').total===3.5,'Baku virtual point is added to actual score for board sorting');
 tournament.pairings.engine.bakuGroupKeys=[];
 audit=api.auditBoards(accelerated,4,tournament);
 check(!audit.ok&&audit.reason==='baku-group-unavailable','Baku publication is blocked when acceleration-group metadata cannot be verified');
 tournament.settings.accelerationMethod='NONE';window.pairingPointsBeforeRound=()=>actualScores;ctx.pairingPointsBeforeRound=window.pairingPointsBeforeRound;
 tournament.pairings.liveBoards['4']=wrong;
 let result=await window.runPairingsExport();check(result===false&&exports===0&&alerts===1,'PDF/TXT pairing publication is blocked when order is invalid');
 result=await window.publishProgramPairingsTelegram();check(result===false&&telegrams===0&&alerts===2,'Telegram pairing publication is blocked when order is invalid');
 tournament.pairings.liveBoards['4']=fixture;
 result=await window.runPairingsExport();check(result===true&&exports===1,'valid ordered pairings pass export publication guard');
 result=await window.publishProgramPairingsTelegram();check(result===true&&telegrams===1,'valid ordered pairings pass Telegram publication guard');
 const source=fs.readFileSync('ChessPublisher.html','utf8');
 check(/pairs\.map\(\(pair,index\)=>\{/.test(source)&&/board:index\+1/.test(source),'Gacrux output sequence is converted directly to board sequence');
 check(/a\.weight-b\.weight \|\| a\.index-b\.index/.test(source),'existing live-board normalizer preserves ordinary-pair relative order');
 check(/return getLivePairingBoards\(\)\.map\(\(b,i\)=>\{/.test(source),'published row builder consumes preserved live-board sequence');
 check(/rows\.forEach\(r=>\{/.test(source),'program pairing publication iterates the preserved row order');
 check(/const body=rows\.map\(r=>/.test(source),'HTML/PDF pairing publication iterates the preserved row order');
 check(/rows\.forEach\(r=>out\.push/.test(source),'TXT pairing publication iterates the preserved row order');
 console.log(`BETA67 RESULT: ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
