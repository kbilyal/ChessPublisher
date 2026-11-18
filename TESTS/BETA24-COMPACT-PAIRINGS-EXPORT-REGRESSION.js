"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"ChessPublisher.html"),"utf8");
const assert=(v,m)=>{if(!v)throw new Error(`FAIL: ${m}`);console.log(`PASS: ${m}`);};

assert(/<title>Chess-Publisher v1\.06\.00-beta\.(?:2[4-9]|[3-9][0-9]|[1-9][0-9]{2,})(?:-r\d+)?<\/title>/.test(html),"visible branding is beta.24 or newer cumulative");
assert(/pairing-export-classic-table/.test(html),"compact classic pairing table CSS exists");
assert(/one row per board/i.test(html),"export dialog describes one-row-per-board layout");
assert(/function pairingsExportClassicColumns/.test(html),"dynamic compact column builder exists");
assert(/function buildPairingsReadableHtml/.test(html)&&/function buildPairingsReadableText/.test(html),"PDF/TXT builders remain present");
assert(/pc-result-box/.test(html)&&/pc-result-line/.test(html),"compact writable result fields exist");
assert(!/design-hero-title">🏆/.test(html.slice(html.indexOf("function buildPairingsReadableHtml"),html.indexOf("async function runPairingsExport"))),"pairings export no longer uses large hero banner");
assert(!/pairing-result-boxes/.test(html.slice(html.indexOf("function pairingsExportResultHtml"),html.indexOf("async function runPairingsExport"))),"pairings export no longer renders three large result boxes");

function extractFunction(name){
  const needle=`function ${name}`;
  const s=html.indexOf(needle); if(s<0)throw new Error(`missing function ${name}`);
  let par=html.indexOf("(",s),pdepth=0,quote=null,esc=false,body=-1;
  for(let i=par;i<html.length;i++){
    const ch=html[i];
    if(quote){if(esc){esc=false;continue;}if(ch==='\\'){esc=true;continue;}if(ch===quote){quote=null;}continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='(')pdepth++;
    else if(ch===')'){pdepth--;if(pdepth===0){body=html.indexOf("{",i);break;}}
  }
  if(body<0)throw new Error(`missing body ${name}`);
  let depth=0;quote=null;esc=false;
  for(let i=body;i<html.length;i++){
    const ch=html[i];
    if(quote){if(esc){esc=false;continue;}if(ch==='\\'){esc=true;continue;}if(ch===quote){quote=null;}continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;
    else if(ch==='}'){depth--;if(depth===0)return html.slice(s,i+1);}
  }
  throw new Error(`unterminated function ${name}`);
}
const names=["pairingsExportName","pairingsExportResultHtml","pairingsExportResultText","pairingsExportClassicColumns","pairingsExportClassicValue","pairingsExportCompactHeader","buildPairingsReadableHtml","peTextFit","pairingsExportTextColumns","buildPairingsReadableText"];
const sandbox={
  console,
  data:{currentTournament:"Compact Test Open"},
  getLanguage:()=>"en",
  pairingsRoundLabel:()=>"Round 4",
  cpExactPairingsRoundLine:()=>"Round 4",
  cpExactExportPoints:v=>String(v??"").replace(/\.5$/,"½").replace(/\.0$/,""),
  cpExactPlayerName:(row,side)=>String(row?.[side]||"").trim()|| (side==="black"?"-":""),
  getCurrentTournament:()=>({settings:{city:"Sofia",venue:"Hall A",timeControl:"15+5"},schedule:{rows:[]}}),
  buildLivePairingsRows:()=>[
    {board:1,white:"Alpha, Alice",whiteTitle:"WFM",whiteFed:"BUL",whiteRating:2010,whitePoints:"2.5",whiteFideId:"2900001",result:"-",black:"Beta, Bob",blackTitle:"FM",blackFed:"TUR",blackRating:2205,blackPoints:"2.0",blackFideId:"6300002"},
    {board:2,white:"Gamma, Gina",whiteTitle:"",whiteFed:"GRE",whiteRating:1800,whitePoints:"2.0",whiteFideId:"4200003",result:"1-0",black:"Delta, Dan",blackTitle:"CM",blackFed:"ROU",blackRating:1900,blackPoints:"1.5",blackFideId:"1200004"}
  ],
  escapeHtml:s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),
  meaningfulScheduleRows:r=>r||[], translateScheduleEvent:s=>s, formatDateTime:s=>s||"", cpSchedulePublicDescription:()=>""
};
vm.createContext(sandbox);
for(const n of names)vm.runInContext(extractFunction(n),sandbox);

const publicOpts={title:true,federation:true,points:true,rating:true,fideId:false,resultMode:"current",includeSchedule:false,showHeaderDetails:true};
const arbiterOpts={...publicOpts,resultMode:"boxes"};
const detailedOpts={...publicOpts,fideId:true};
const minimalOpts={title:false,federation:false,points:false,rating:false,fideId:false,resultMode:"blank",includeSchedule:false,showHeaderDetails:false};

const out=sandbox.buildPairingsReadableHtml(publicOpts);
assert((out.match(/<tbody>/g)||[]).length===1,"PDF has one table body");
assert((out.match(/<tbody>[\s\S]*?<tr>/g)||[]).length>=1,"PDF contains pairing rows");
assert((out.match(/<tr>/g)||[]).length===3,"PDF uses one header row plus one row per board");
assert(/>WFM<\/td>/.test(out)&&(/>FM Beta, Bob<\/td>/.test(out)||/>FM<\/td>/.test(out)),"titles remain present in the compact cumulative format");
assert(/>FED<\/th>/.test(out)&&/>Rtg<\/th>/.test(out)&&/>Pts<\/th>/.test(out),"optional FED/rating/points are compact columns");
assert(!/>FIDE ID<\/th>/.test(out),"FIDE ID stays hidden when not selected");
assert(!/🏆|🔀|📍|⏱/.test(out),"print output has no decorative pairing icons");
const arb=sandbox.buildPairingsReadableHtml(arbiterOpts);
assert((arb.match(/pc-result-box/g)||[]).length===2,"arbiter preset renders one compact writable box per board");
const det=sandbox.buildPairingsReadableHtml(detailedOpts);
assert((det.match(/>FIDE ID<\/th>/g)||[]).length===2,"detailed preset adds FIDE ID symmetrically");
const min=sandbox.buildPairingsReadableHtml(minimalOpts);
assert(!/>FED<\/th>|>Rtg<\/th>|>Pts<\/th>|>FIDE ID<\/th>/.test(min),"minimal preset keeps only board/names/result");
const txt=sandbox.buildPairingsReadableText(publicOpts);
assert(txt.includes("White")&&txt.includes("Black")&&txt.includes("Res."),"TXT has classic table headings");
assert(!/Board 1\r?\n|White:|Black:|Result:/.test(txt),"TXT no longer uses multi-line board cards");
assert(txt.split(/\r?\n/).filter(x=>/^\s*[12]\s/.test(x)).length===2,"TXT uses one row per board");
console.log("BETA24 COMPACT PAIRINGS EXPORT REGRESSION: PASS");
