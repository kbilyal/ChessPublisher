/* Chess-Publisher v1.06.00-beta.46 — mandatory Swiss tie-break catalogue.
   Additive layer. Existing Swiss pairing and tie-break core functions are reused. */
(function(){
'use strict';
const BETA='1.06.00-beta.46';
const CATALOG=[
"Average of Opponents' Buchholz (AOB) [77]",
"Average of Opponents' Fore Buchholz (AOB/F) [77]",
"Performance Tie-Break (APPO) [88]","Performance Tie-Break (APRO) [88]",
"Average Rating of Opponents (ARO) [80]","Average Rating of Opponents Cut-1 (ARO/C1) [80]","Average Rating of Opponents Cut-2 (ARO/C2) [80]","Average Rating of Opponents Median-1 (ARO/M1) [80]","Average Rating of Opponents Median-2 (ARO/M2) [80]",
"Buchholz Tie-Break (2023) [84]","Buchholz Cut-1 (BH-C1) [84]","Buchholz Cut-2 (BH-C2) [84]","Median Buchholz (BH-M1) [84]","Median Buchholz 2 (BH-M2) [84]",
"Greater number of games played with Black (BPG) [68]","Greater number of games won with Black (BWG) [68]",
"Direct Encounter (DE) [81]","Direct Encounter including forfeits (DE/P) [81]",
"Fore Buchholz (FB) [84]","Fore Buchholz Cut-1 (FB/C1) [84]","Fore Buchholz Cut-2 (FB/C2) [84]","Fore Buchholz Median-1 (FB/M1) [84]","Fore Buchholz Median-2 (FB/M2) [84]",
"Sum of Progressive Scores (PS) [86]","Sum of Progressive Scores Cut-1 (PS/C1) [86]","Sum of Progressive Scores Cut-2 (PS/C2) [86]",
"Performance Tie-Break (PTP) [88]","Rounds Elected to Play (REP) [79]","Rating (RTNG) [80]","Reverse Rating (RTNG/R) [80]",
"Sonneborn-Berger Tie-Break (2023) [85]","Sonneborn-Berger Cut-1 (SB-C1) [85]","Sonneborn-Berger Cut-2 (SB/C2) [85]","Standard Points (STD) [1]",
"Tournament Pairing Number (TPN) [0]","Reverse Tournament Pairing Number (TPN/R) [0]","Performance Tie-Break (TPR) [88]",
"Greater number of victories (WIN) [68]","Greater number of games won (WON) [68]"
];
const DESCRIPTORS=new Map([
 ["Average of Opponents' Buchholz (AOB) [77]","AOB"],["Average of Opponents' Fore Buchholz (AOB/F) [77]","AOB/F"],
 ["Performance Tie-Break (APPO) [88]","APPO"],["Performance Tie-Break (APRO) [88]","APRO"],
 ["Average Rating of Opponents (ARO) [80]","ARO"],["Average Rating of Opponents Cut-1 (ARO/C1) [80]","ARO/C1"],["Average Rating of Opponents Cut-2 (ARO/C2) [80]","ARO/C2"],["Average Rating of Opponents Median-1 (ARO/M1) [80]","ARO/M1"],["Average Rating of Opponents Median-2 (ARO/M2) [80]","ARO/M2"],
 ["Buchholz Tie-Break (2023) [84]","BH"],["Buchholz Cut-1 (BH-C1) [84]","BH/C1"],["Buchholz Cut-2 (BH-C2) [84]","BH/C2"],["Median Buchholz (BH-M1) [84]","BH/M1"],["Median Buchholz 2 (BH-M2) [84]","BH/M2"],
 ["Greater number of games played with Black (BPG) [68]","BPG"],["Greater number of games won with Black (BWG) [68]","BWG"],
 ["Direct Encounter (DE) [81]","DE"],["Direct Encounter including forfeits (DE/P) [81]","DE/P"],
 ["Fore Buchholz (FB) [84]","FB"],["Fore Buchholz Cut-1 (FB/C1) [84]","FB/C1"],["Fore Buchholz Cut-2 (FB/C2) [84]","FB/C2"],["Fore Buchholz Median-1 (FB/M1) [84]","FB/M1"],["Fore Buchholz Median-2 (FB/M2) [84]","FB/M2"],
 ["Sum of Progressive Scores (PS) [86]","PS"],["Sum of Progressive Scores Cut-1 (PS/C1) [86]","PS/C1"],["Sum of Progressive Scores Cut-2 (PS/C2) [86]","PS/C2"],
 ["Performance Tie-Break (PTP) [88]","PTP"],["Rounds Elected to Play (REP) [79]","REP"],["Rating (RTNG) [80]","RTNG"],["Reverse Rating (RTNG/R) [80]","RTNG/R"],
 ["Sonneborn-Berger Tie-Break (2023) [85]","SB"],["Sonneborn-Berger Cut-1 (SB-C1) [85]","SB/C1"],["Sonneborn-Berger Cut-2 (SB/C2) [85]","SB/C2"],["Standard Points (STD) [1]","STD"],
 ["Tournament Pairing Number (TPN) [0]","TPN"],["Reverse Tournament Pairing Number (TPN/R) [0]","TPN/R"],["Performance Tie-Break (TPR) [88]","TPR"],
 ["Greater number of victories (WIN) [68]","WIN"],["Greater number of games won (WON) [68]","WON"]
]);
const isSwiss=t=>!/round robin/i.test(String(t?.settings?.tournamentFormat||t?.regulations?.format||''));
const avg=a=>{const x=(a||[]).map(Number).filter(Number.isFinite);if(!x.length)return 0;const r=x.reduce((s,v)=>s+v,0)/x.length;return typeof fideRoundedAverage==='function'?fideRoundedAverage(x):Math.floor(r+.5+1e-12);};
const cutAvg=(a,mode)=>{let x=(a||[]).map(Number).filter(Number.isFinite).sort((m,n)=>m-n);const lo=()=>{if(x.length)x.shift();},hi=()=>{if(x.length)x.pop();};if(mode==='C1')lo();if(mode==='C2'){lo();lo();}if(mode==='M1'){lo();hi();}if(mode==='M2'){lo();lo();hi();hi();}return avg(x);};
const pts=r=>{try{return Number(fidePointsFromRound(r))||0;}catch(_){return Number(r?.points)||0;}};
function foreClone(players,totalRounds){
 const clone=JSON.parse(JSON.stringify(players||[])); const last=Math.max(0,(Number(totalRounds)||1)-1);
 for(const p of clone){const g=p.rounds?.[last];if(g&&g.opp){g.points=.5;g.result='=';g.played=true;g.kind='played';}}
 try{calculateFide2026TieBreakData(clone,totalRounds);}catch(_){}
 return new Map(clone.map(p=>[p.id,p]));
}
function standardPoints(p,byId,totalRounds){let s=0;for(let i=0;i<Math.min(Number(totalRounds)||0,p.rounds?.length||0);i++){const g=p.rounds?.[i];if(!g)continue;const mine=pts(g);let theirs=.5;if(g.opp&&byId.has(g.opp)){const og=byId.get(g.opp)?.rounds?.[i];theirs=og?pts(og):.5;}s+=mine>theirs+1e-9?1:mine<theirs-1e-9?0:.5;}return s;}
function progressiveValues(p,totalRounds){let running=0,sum=0,after=[];for(let i=0;i<Number(totalRounds)||0;i++){const g=p.rounds?.[i];if(g)running+=pts(g);after.push(running);sum+=running;}return {ps:sum,c1:sum-(after[0]||0),c2:sum-(after[0]||0)-(after[1]||0)};}
const originalCatalog=window.getTieBreakCatalogForTournament;
if(typeof originalCatalog==='function')window.getTieBreakCatalogForTournament=function(tournament=getCurrentTournament()){if(!isSwiss(tournament))return originalCatalog(tournament);const imported=Array.isArray(tournament?.regulations?.tunxImportedTieBreakNames)?tournament.regulations.tunxImportedTieBreakNames.filter(x=>typeof isSupportedImportedTunxTieBreak==='function'&&isSupportedImportedTunxTieBreak(x)):[];return [...new Set([...CATALOG,...imported])];};
const originalOptions=window.getTieBreakOptions;
if(typeof originalOptions==='function')window.getTieBreakOptions=function(tie,tournament=getCurrentTournament()){const o=originalOptions(tie,tournament);if(DESCRIPTORS.get(String(tie))==='DE/P')o.countForfeits=true;return o;};
const originalCalc=window.calculateNumberedTieBreakData;
if(typeof originalCalc==='function')window.calculateNumberedTieBreakData=function(players,byId,totalRounds){const r=originalCalc(players,byId,totalRounds);if(!isSwiss(getCurrentTournament()))return r;const fore=foreClone(players,totalRounds);for(const p of players){const opponents=(p.rounds||[]).filter(g=>g&&g.opp&&byId.has(g.opp)&&g.played).map(g=>byId.get(g.opp));const ratings=opponents.map(o=>Number(o.rating)||0).filter(x=>x>0);p.cp46AroC1=cutAvg(ratings,'C1');p.cp46AroC2=cutAvg(ratings,'C2');p.cp46AroM1=cutAvg(ratings,'M1');p.cp46AroM2=cutAvg(ratings,'M2');const fp=fore.get(p.id)||{};p.cp46Fb=Number(fp.buchholz)||0;p.cp46FbC1=Number(fp.buchholzCut1)||0;p.cp46FbC2=Number(fp.buchholzCut2)||0;p.cp46FbM1=Number(fp.buchholzMedian1)||0;p.cp46FbM2=Number(fp.buchholzMedian2)||0;const oppFore=opponents.map(o=>Number(fore.get(o.id)?.buchholz)||0);p.cp46AobF=oppFore.length?Math.floor((oppFore.reduce((s,x)=>s+x,0)/oppFore.length)*100+.5+1e-9)/100:0;const pr=progressiveValues(p,totalRounds);p.cp46Ps=pr.ps;p.cp46PsC1=pr.c1;p.cp46PsC2=pr.c2;p.cp46SbC2=typeof sonnebornVariable2026==='function'?sonnebornVariable2026(p.fide2026ElementsStandard||p.fide2026Elements||[],0,2):0;p.cp46Std=standardPoints(p,byId,totalRounds);p.cp46Rtng=Number(p.rating)||0;p.cp46Tpn=Number(p.id||p.pairingNumber)||0;}return r;};
const originalValue=window.standingTieBreakValue;
if(typeof originalValue==='function')window.standingTieBreakValue=function(player,tie){const d=DESCRIPTORS.get(String(tie));if(!d)return originalValue(player,tie);if(d==='AOB/F')return Number(player.cp46AobF)||0;if(d==='ARO/C1')return Number(player.cp46AroC1)||0;if(d==='ARO/C2')return Number(player.cp46AroC2)||0;if(d==='ARO/M1')return Number(player.cp46AroM1)||0;if(d==='ARO/M2')return Number(player.cp46AroM2)||0;if(d==='FB')return Number(player.cp46Fb)||0;if(d==='FB/C1')return Number(player.cp46FbC1)||0;if(d==='FB/C2')return Number(player.cp46FbC2)||0;if(d==='FB/M1')return Number(player.cp46FbM1)||0;if(d==='FB/M2')return Number(player.cp46FbM2)||0;if(d==='PS')return Number(player.cp46Ps)||Number(player.progressive)||0;if(d==='PS/C1')return Number(player.cp46PsC1)||0;if(d==='PS/C2')return Number(player.cp46PsC2)||0;if(d==='SB/C2')return Number(player.cp46SbC2)||0;if(d==='STD')return Number(player.cp46Std)||0;if(d==='RTNG')return Number(player.cp46Rtng??player.rating)||0;if(d==='RTNG/R')return -(Number(player.cp46Rtng??player.rating)||0);if(d==='TPN')return -(Number(player.cp46Tpn??player.id)||0);if(d==='TPN/R')return Number(player.cp46Tpn??player.id)||0;if(d==='DE/P')return Number(player.directEncounter)||0;if(d==='REP')return Number(player.roundsElectedToPlay)||0;return originalValue(player,tie);};
const originalBuild=window.buildTRF26;
if(typeof originalBuild==='function')window.buildTRF26=function(...args){const out=originalBuild.apply(this,args);try{const ties=typeof getSelectedTieBreaksInPriority==='function'?getSelectedTieBreaksInPriority():[];const desc=ties.map(t=>DESCRIPTORS.get(String(t))).filter(Boolean);if(desc.length){const line='212 '+['PTS',...desc].join(',');const lines=String(out.text||'').replace(/\r/g,'').split('\n');const idx=lines.findIndex(x=>/^212\s/.test(x));if(idx>=0)lines[idx]=line;else lines.splice(Math.max(0,lines.findIndex(x=>/^001\s/.test(x))),0,line);out.text=lines.filter((x,i,a)=>i<a.length-1||x!=='').join('\r\n')+(String(out.text||'').endsWith('\n')?'\r\n':'');}}catch(_){}return out;};
function setVersion(){document.documentElement.dataset.chesspublisherVersion=BETA;document.title=`Chess-Publisher v${BETA}`;const w=document.getElementById('windowDocumentTitle');if(w)w.textContent=`Chess-Publisher v${BETA} — Tournament Manager & Publisher`;}
function install(){setVersion();window.cpBeta46={version:BETA,catalog:CATALOG.slice(),descriptors:DESCRIPTORS,cutAvg,progressiveValues,standardPoints};}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
