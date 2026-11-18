"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"ChessPublisher.html"),"utf8");
const assert=(v,m)=>{if(!v)throw new Error(`FAIL: ${m}`);console.log(`PASS: ${m}`);};

assert(/<title>Chess-Publisher v1\.06\.00-beta\.(?:26|2[7-9]|[3-9]\d)(?:-r\d+)?<\/title>/.test(html),"visible branding is beta.26 or newer cumulative");
assert(/CP-BETA26-EXACT-EXPORT-FORMATS/.test(html),"beta.26 exact export marker exists");
assert(/function cpExactPairingsRoundLine/.test(html)&&/function cpExactTieBreakLabel/.test(html),"exact export helpers exist");
assert(/whiteSNo:/.test(html)&&/blackSNo:/.test(html),"pairing rows expose both starting numbers");
assert(/SNo\.<\/th><th class="x-title"><\/th><th class="x-name">Name<\/th><th class="x-rating">IRtg<\/th><th class="x-fed">FED/.test(html),"starting rank reference columns are exact");
assert(/Rank<\/th><th class="x-sno">SNo\.<\/th><th class="x-title"><\/th><th class="x-name">Name<\/th><th class="x-rating">Rtg<\/th><th class="x-fed">FED<\/th><th class="x-points">Pts/.test(html),"ranking reference columns are exact");
assert(/id="peShowHeaderDetails"[^>]*display:none/.test(html),"legacy header-details control is hidden and cannot add extra report headings");

function extractFunction(name){
  const needle=`function ${name}`; const s=html.indexOf(needle); if(s<0)throw new Error(`missing function ${name}`);
  let par=html.indexOf("(",s),pdepth=0,quote=null,esc=false,body=-1;
  for(let i=par;i<html.length;i++){const ch=html[i];if(quote){if(esc){esc=false;continue;}if(ch==='\\'){esc=true;continue;}if(ch===quote){quote=null;}continue;}if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}if(ch==='(')pdepth++;else if(ch===')'){pdepth--;if(pdepth===0){body=html.indexOf("{",i);break;}}}
  if(body<0)throw new Error(`missing body ${name}`);
  let depth=0;quote=null;esc=false;
  for(let i=body;i<html.length;i++){const ch=html[i];if(quote){if(esc){esc=false;continue;}if(ch==='\\'){esc=true;continue;}if(ch===quote){quote=null;}continue;}if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}if(ch==='{')depth++;else if(ch==='}'){depth--;if(depth===0)return html.slice(s,i+1);}}
  throw new Error(`unterminated ${name}`);
}

const names=["cpExactExportPoints","cpExactExportNumber","cpExactExportDateTime","cpExactPairingsRoundLine","cpExactPlayerName","pairingsExportResultHtml","pairingsExportResultText","pairingsExportClassicColumns","pairingsExportClassicValue","pairingsExportCompactHeader","buildPairingsReadableHtml","peTextFit","pairingsExportTextColumns","buildPairingsReadableText"];
const sandbox={
  console,
  data:{currentTournament:"Reference Tournament"},
  getLanguage:()=>"en",
  getSelectedPairingRoundNumber:()=>7,
  scheduleRoundNumberFromEvent:e=>/^Round\s+(\d+)$/i.test(String(e||""))?Number(String(e).match(/\d+/)[0]):0,
  getCurrentTournament:()=>({settings:{},schedule:{rows:[{event:"Round 7",dateTime:"2026-07-26T15:40"}]}}),
  buildLivePairingsRows:()=>[
    {board:1,whiteSNo:1,whiteTitle:"",white:"Ninov Ventsislav",whitePoints:"4.0",whiteFed:"BUL",whiteRating:2200,whiteFideId:"2900001",result:"-",blackPoints:"5.5",black:"Petkov Rostislav",blackTitle:"",blackSNo:3,blackFed:"BUL",blackRating:1959,blackFideId:"2900003"},
    {board:2,whiteSNo:19,whiteTitle:"ACM",white:"Kouvalakis Andreas",whitePoints:"2.5",result:"-",blackPoints:"2.0",black:"Emin Ramis",blackTitle:"",blackSNo:23}
  ],
  escapeHtml:s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),
  meaningfulScheduleRows:r=>r||[],translateScheduleEvent:s=>s,formatDateTime:s=>s||"",cpSchedulePublicDescription:()=>""
};
vm.createContext(sandbox); for(const n of names)vm.runInContext(extractFunction(n),sandbox);
const opts={title:true,federation:false,points:true,rating:false,fideId:false,resultMode:"blank",includeSchedule:false,showHeaderDetails:false};
const cols=sandbox.pairingsExportClassicColumns(opts).map(x=>x.label);
assert(JSON.stringify(cols)===JSON.stringify(["Bo.","SNo.","","White","Pts","Res.","Pts","Black","SNo."]),"default pairings columns exactly match reference");
const out=sandbox.buildPairingsReadableHtml(opts);
assert(/Reference Tournament/.test(out)&&/Round 7 on 2026\/07\/26 at 15:40/.test(out),"pairings heading matches reference structure");
assert(/<th class="x-board">Bo\.<\/th><th class="x-sno">SNo\.<\/th><th class="x-title"><\/th><th class="x-name">White<\/th>/.test(out),"pairings header begins with exact reference columns");
assert(/>4<\/td>/.test(out)&&/>5½<\/td>/.test(out)&&/>2½<\/td>/, "points use compact whole/half notation");
assert(!/Chess-Publisher\s*•|Tournament Manager & Publisher|Swiss-Manager|User:|Program Swiss/i.test(out),"pairings export has no application/vendor/user footer");
const txt=sandbox.buildPairingsReadableText(opts);
assert(txt.startsWith("Reference Tournament\r\n\r\nRound 7 on 2026/07/26 at 15:40\r\n\r\n"),"TXT heading and blank-line layout matches reference");
assert(/Bo\.\s+SNo\.\s+White\s+Pts\s+Res\.\s+Pts\s+Black\s+SNo\./.test(txt.replace(/\s+/g," ")),"TXT has exact reference field order");
assert(!/Swiss-Manager|User:|Program Swiss|Chess-Publisher\s*•/i.test(txt),"TXT has no extra footer labels");

const playersSlice=html.slice(html.indexOf('if(kind==="players")'),html.indexOf('if(kind==="pairings")'));
const standingsSlice=html.slice(html.indexOf('if(kind==="standings")'),html.indexOf('if(kind==="program")'));
for(const [name,slice] of [["Starting Rank",playersSlice],["Ranking",standingsSlice]]){
  assert(!/Swiss-Manager|User:|Program Swiss|Chess-Publisher\s*•|Tournament Manager & Publisher/i.test(slice),`${name} report has no extra footer labels`);
}
console.log("BETA26 EXACT EXPORT FORMATS REGRESSION: PASS");
