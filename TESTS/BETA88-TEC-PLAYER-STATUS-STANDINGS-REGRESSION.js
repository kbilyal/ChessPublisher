"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),assert=require("assert");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"ChessPublisher.html"),"utf8");
const beta69=fs.readFileSync(path.join(root,"ChessPublisher-Beta69-Compliance.js"),"utf8");
const beta44=fs.readFileSync(path.join(root,"ChessPublisher-Beta44-Compliance.js"),"utf8");
let pass=0,fail=0;
function check(condition,message){try{assert.ok(condition);console.log(`PASS ${String(++pass).padStart(2,"0")} ${message}`);}catch(e){fail++;console.log(`FAIL ${message}`);}}
function extractFunction(name){
  const re=new RegExp(`function\\s+${name}\\s*\\(`),m=re.exec(html);if(!m)throw new Error(`missing ${name}`);
  const start=m.index,brace=html.indexOf("{",m.index+m[0].length);let d=0,q="",esc=false,line=false,block=false;
  for(let i=brace;i<html.length;i++){const c=html[i],n=html[i+1]||"";if(line){if(c==="\n")line=false;continue;}if(block){if(c==="*"&&n==="/"){block=false;i++;}continue;}if(q){if(esc){esc=false;continue;}if(c==="\\"){esc=true;continue;}if(c===q)q="";continue;}if(c==="/"&&n==="/"){line=true;i++;continue;}if(c==="/"&&n==="*"){block=true;i++;continue;}if(c==='"'||c==="'"||c==='`'){q=c;continue;}if(c==="{")d++;else if(c==="}"&&--d===0)return html.slice(start,i+1);}throw new Error(`unterminated ${name}`);
}

check(/data-chesspublisher-version="1\.06\.00-beta\.(?:8[89]|9\d|\d{3,})(?:-r\d+)?"/.test(html),"HTML self-identifies beta.88 or later");
check(/id="editPlayerTournamentStatus"[\s\S]*?<option value="expelled">Expelled<\/option>/.test(html),"Edit Player exposes explicit Expelled tournament status");
check(/id="editPlayerExcludeFromStandings"/.test(html)&&/results remain in tournament history/.test(html),"Edit Player exposes optional standings exclusion with history-preservation wording");
check(/<th class="final-status-col">Status<\/th>/.test(html),"Standings has a dedicated status column");
check(/standing-status-withdrawn/.test(html)&&/standing-status-expelled/.test(html),"Withdrawn and Expelled have distinct visual badges");
check(/p\.tournamentStatus=.*expelled[\s\S]{0,180}p\.excludeFromStandings=p\.tournamentStatus==="expelled"/.test(html),"Save/load normalization retains exclusion only for expelled status");
check(/visiblePlayers=orderedPlayers\.filter\(player=>!isPlayerExcludedFromFinalStandings\(player\)\)/.test(html),"Standings exclusion occurs after ordering/calculation path");
check(/standingPlayerDisplayName\(p\)/.test(html),"Base standings text/TXT exports carry status labels");
check(/standingPlayerDisplayName/.test(beta69),"beta.69 final-tie export layer preserves status labels");
check(/tournamentStatus\|\|''\)\.toLowerCase\(\)!==['"]expelled['"]/.test(beta44),"existing Round Robin <50% withdrawal rule recognizes beta.88 Expelled status");
check(!/requestLocalGacruxPairs\s*=|buildPairingEngineTRF\s*=|buildTRF26\s*=|standingTieBreakValue\s*=|calculateNumberedTieBreakData\s*=/.test(beta69),"Existing beta.69 protected tie-break boundary remains intact");

const src=[
  "isPlayerRegistrationDeleted","getPlayerTournamentStandingStatus","isPlayerExcludedFromFinalStandings",
  "standingPlayerStatusLabel","standingPlayerDisplayName","calculateFinalStandings"
].map(extractFunction).join("\n");
const allRows=[
  {id:1,name:"Active",rating:2200,score:2,rounds:[],colors:[],sourcePlayer:{name:"Active",registrationDeleted:false,tournamentStatus:"active",excludeFromStandings:false}},
  {id:2,name:"Withdrawn",rating:2100,score:1,rounds:[],colors:[],sourcePlayer:{name:"Withdrawn",registrationDeleted:true,registrationDeletedFromRound:3,tournamentStatus:"active",excludeFromStandings:false}},
  {id:3,name:"ExpelledShown",rating:2050,score:1.5,rounds:[],colors:[],sourcePlayer:{name:"ExpelledShown",tournamentStatus:"expelled",excludeFromStandings:false}},
  {id:4,name:"ExpelledHidden",rating:2000,score:1,rounds:[],colors:[],sourcePlayer:{name:"ExpelledHidden",tournamentStatus:"expelled",excludeFromStandings:true}}
];
let tbInputCount=0,tbNames=[];
const ctx={console,Number,String,Math,Map,Set,
  getCurrentTournament:()=>({settings:{rounds:"3"}}),
  tournamentState:()=>({rows:allRows.map(p=>({...p,rounds:[],colors:[],opponents:[]}))}),
  getCompletedRounds:()=>0,calculateFide2026TieBreakData:()=>{},fidePointsFromRound:()=>0,fideRoundedAverage:()=>0,
  calculateNumberedTieBreakData:(players)=>{tbInputCount=players.length;tbNames=players.map(p=>p.name);},
  getSelectedTieBreaksInPriority:()=>[],isDirectEncounterTie:()=>false,assignDirectEncounterDisplayScores:()=>{},sortStandingsByTieBreakPriority:(players)=>players.slice().sort((a,b)=>b.score-a.score)
};ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(src,ctx,{filename:"beta88-player-status-functions.js"});

check(ctx.getPlayerTournamentStandingStatus(allRows[1])==="withdrawn","post-start registration tombstone is exposed as Withdrawn");
check(ctx.getPlayerTournamentStandingStatus({attendance:"absent",registrationDeleted:false})==="active","temporary Absent is not mislabeled as Withdrawn");
check(ctx.getPlayerTournamentStandingStatus(allRows[2])==="expelled","explicit tournament status is exposed as Expelled");
check(ctx.isPlayerExcludedFromFinalStandings(allRows[2])===false,"expelled player can remain visible in standings");
check(ctx.isPlayerExcludedFromFinalStandings(allRows[3])===true,"user-selected expelled player can be excluded from standings");
check(ctx.standingPlayerDisplayName(allRows[1])==="Withdrawn [Withdrawn]","withdrawn label is preserved in text exports");
check(ctx.standingPlayerDisplayName(allRows[2])==="ExpelledShown [Expelled]","expelled label is preserved in text exports");
const st=ctx.calculateFinalStandings();
check(tbInputCount===4&&tbNames.includes("ExpelledHidden"),"all players including hidden expelled player remain in tie-break/result calculation input");
check(st.players.length===3&&!st.players.some(p=>p.name==="ExpelledHidden"),"only the explicitly hidden expelled player is removed from standings output");
check(st.players.some(p=>p.name==="Withdrawn")&&st.players.some(p=>p.name==="ExpelledShown"),"withdrawn and non-hidden expelled players remain visible with their historical scores");
check(allRows[3].score===1,"standings exclusion does not mutate the expelled player's stored score/history");

function extractFrom(text,name){
  const re=new RegExp(`function\\s+${name}\\s*\\(`),m=re.exec(text);if(!m)throw new Error(`missing ${name}`);
  const start=m.index,brace=text.indexOf("{",m.index+m[0].length);let d=0,q="",esc=false,line=false,block=false;
  for(let i=brace;i<text.length;i++){const c=text[i],n=text[i+1]||"";if(line){if(c==="\n")line=false;continue;}if(block){if(c==="*"&&n==="/"){block=false;i++;}continue;}if(q){if(esc){esc=false;continue;}if(c==="\\"){esc=true;continue;}if(c===q)q="";continue;}if(c==="/"&&n==="/"){line=true;i++;continue;}if(c==="/"&&n==="*"){block=true;i++;continue;}if(c==='"'||c==="'"||c==='`'){q=c;continue;}if(c==="{")d++;else if(c==="}"&&--d===0)return text.slice(start,i+1);}throw new Error(`unterminated ${name}`);
}
const rrTournament={players:[
  {localKey:"E1",tournamentStatus:"expelled"},
  {localKey:"E2",tournamentStatus:"expelled"}
],pairings:{liveBoards:{
  "1":[{whiteKey:"E1",blackKey:"A",result:"1-0"},{whiteKey:"E2",blackKey:"B",result:"1-0"}],
  "2":[{whiteKey:"E1",blackKey:"C",result:"-"},{whiteKey:"E2",blackKey:"D",result:"0-1"}],
  "3":[{whiteKey:"E1",blackKey:"F",result:"-"},{whiteKey:"E2",blackKey:"G",result:"-"}]
}}};
const rrCtx={console,String,Set,Object,t:()=>rrTournament,isRoundRobinTournament:()=>true,keyForPlayer:p=>p.localKey,isForfeitResult:r=>/F/.test(String(r))};rrCtx.window=rrCtx;rrCtx.globalThis=rrCtx;vm.createContext(rrCtx);vm.runInContext(extractFrom(beta44,"rrExcludedFromStandings"),rrCtx);
const rrExcluded=rrCtx.rrExcludedFromStandings({});
check(rrExcluded.has("E1"),"Round Robin expelled player below 50% is routed through existing result-cancellation rule");
check(!rrExcluded.has("E2"),"Round Robin expelled player at or above 50% keeps historical results while standings exclusion remains presentation-only");

console.log(`BETA88 TEC Q170/Q197/Q198 RESULT: ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
