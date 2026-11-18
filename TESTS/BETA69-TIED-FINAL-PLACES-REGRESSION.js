const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('ChessPublisher.html','utf8'),js=fs.readFileSync('ChessPublisher-Beta69-Compliance.js','utf8');let pass=0,fail=0;
function check(c,m){try{assert.ok(c);console.log(`PASS ${String(++pass).padStart(2,'0')} ${m}`);}catch(e){fail++;console.log(`FAIL ${m}`);}}
{const m=html.match(/data-chesspublisher-version="1\.06\.00-beta\.(\d+)(?:-r\d+)?"/);check(!!m&&Number(m[1])>=69,'HTML self-identifies beta69 or newer');}
check(/ChessPublisher-Beta69-Compliance\.js/.test(html),'HTML loads beta69 module');
check(html.indexOf('ChessPublisher-Beta69-Compliance.js')>html.indexOf('ChessPublisher-Beta68-Compliance.js'),'beta69 loads after beta68');
check(/Keep same place/.test(js)&&/Drawing of lots/.test(js)&&/Manual order/.test(js),'three final-tie resolution choices are exposed');
check(/competition ranking: 1,1,3/.test(js),'same-place mode uses explicit tied competition ranking semantics');
check(/repeat-draw/.test(js)&&/drawNo/.test(js),'repeated lot is a distinct persisted draw');
check(/Tie-break calculations are not modified/.test(js),'manual order states the protected calculation boundary');
check(!/requestLocalGacruxPairs\s*=|buildPairingEngineTRF\s*=|buildTRF26\s*=|calculateTieBreaks\s*=|standingTieBreakValue\s*=/.test(js),'beta69 does not redefine protected pairing/TRF/tie-break core');

const tournament={finalTieResolution:null};
let saves=0,refreshes=0,rand=0;
const basePlayers=[
 {id:1,localKey:'A',name:'Alpha',score:5,bh:20},
 {id:2,localKey:'B',name:'Beta',score:5,bh:20},
 {id:3,localKey:'C',name:'Gamma',score:4.5,bh:19},
 {id:4,localKey:'D',name:'Delta',score:4,bh:18}
];
function baseStandings(){return {players:basePlayers.map(p=>({...p})),tieList:['BH'],completed:7};}
const els={};
const document={readyState:'complete',documentElement:{dataset:{}},getElementById:id=>els[id]||null,querySelectorAll:()=>[],createElement:()=>({style:{},innerHTML:'',className:'',id:'',remove(){},querySelector:()=>null,querySelectorAll:()=>[]}),body:{appendChild(){}},addEventListener:()=>{}};
const window={document,getCurrentTournament:()=>tournament,saveData:()=>{saves++;},standingTieBreakValue:(p,tb)=>tb==='BH'?p.bh:0,calculateFinalStandings:baseStandings,refreshFinalStandings:()=>{refreshes++;return baseStandings();},appAlert:()=>{}};
const crypto={getRandomValues:a=>{for(let i=0;i<a.length;i++)a[i]=(++rand)*100003;return a;}};
const ctx={window,document,console,Date,Map,Set,Number,String,Math,Uint32Array,crypto};Object.assign(ctx,window);vm.createContext(ctx);vm.runInContext(js,ctx);Object.assign(ctx,window);
const api=window.cpBeta69;
check(api.VERSION==='1.06.00-beta.69','runtime API version is beta69');
check(document.documentElement.dataset.chesspublisherVersion==='1.06.00-beta.69','install publishes beta69 version');
check(api.mode()==='same-place','legacy tournament migrates to same-place final ties by default');
let st=window.calculateFinalStandings();
check(st.players[0].beta69FinalRank===1&&st.players[1].beta69FinalRank===1,'exactly tied leaders receive the same final place');
check(/🥇 Alpha/.test(api.buildPlainText(st,false))&&/🥇 Beta/.test(api.buildPlainText(st,false)),'Telegram/plain-text final standings preserve equal displayed place');
check(api.buildFixedText(st,false).split('\n').some(line=>/^1\s+Beta/.test(line)),'TXT/print final standings preserve equal numeric place');
check(st.players[2].beta69FinalRank===3,'place after a two-player tie is competition rank 3');
check(st.unresolvedTieGroups===1,'exact tie group is detected after all announced tie-breaks');
check(api.officiallyEqual(st.players[0],st.players[1],st.tieList),'exact equality ignores legacy persistent lot fallback');
check(!api.officiallyEqual(st.players[1],st.players[2],st.tieList),'different score/tie values are not merged');
const groups=api.splitGroups(st.players,st.tieList),tieGroup=groups.find(g=>g.tied);
check(!!tieGroup&&tieGroup.players.length===2,'splitGroups exposes tied players as one explicit group');
const first=api.drawLotsForGroup(tieGroup,true),second=api.drawLotsForGroup(tieGroup,true);
check(first.drawNo===1&&second.drawNo===2,'repeat drawing increments the persisted draw number');
check(JSON.stringify(first.values)!==JSON.stringify(second.values),'repeated drawing produces a new random result set');
check(tournament.finalTieResolution.audit.some(e=>e.action==='repeat-draw'),'repeat drawing is audit-recorded');
api.setMode('drawing-lots');
st=window.calculateFinalStandings();
check(st.players[0].beta69FinalRank===1&&st.players[1].beta69FinalRank===2,'lot mode assigns distinct final ranks inside the exact tie');
check(new Set(st.players.slice(0,2).map(p=>p.id)).size===2,'lot mode retains both tied players without mutation/loss');
const lotOrder=st.players.slice(0,2).map(p=>String(p.localKey));
check(api.manualOrderForGroup(api.splitGroups(st.players,st.tieList).find(g=>g.tied),lotOrder.slice().reverse()),'manual tied-player order accepts exactly the tied group identities');
st=window.calculateFinalStandings();
check(st.finalTieMode==='manual-order','manual order switches only the final-tie resolution mode');
check(st.players.slice(0,2).map(p=>p.localKey).join(',')===lotOrder.slice().reverse().join(','),'manual order determines final ranking inside the tie');
check(st.players[0].beta69FinalRank===1&&st.players[1].beta69FinalRank===2,'manual order assigns distinct ranks when user chooses to break tie');
check(!api.manualOrderForGroup(api.splitGroups(st.players,st.tieList).find(g=>g.tied),['A']),'manual order rejects incomplete player lists');
api.setMode('same-place');st=window.calculateFinalStandings();
check(st.players[0].beta69FinalRank===1&&st.players[1].beta69FinalRank===1,'user can return to unresolved equal final places');
check(basePlayers.every((p,i)=>p.score===[5,5,4.5,4][i]),'final-tie layer does not alter scores');
check(basePlayers.every((p,i)=>p.bh===[20,20,19,18][i]),'final-tie layer does not alter tie-break values');
check(saves>0,'tie-resolution choices are persisted');
check(refreshes>0,'changing resolution refreshes standings presentation');
console.log(`BETA69 RESULT: ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
