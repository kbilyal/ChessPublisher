#!/usr/bin/env node
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import {fileURLToPath} from "node:url";

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SCRIPT=path.resolve(HERE,"../linux/export_integration.js");
const calls=[];
const fetchFn=async (input,init={})=>{
  calls.push([String(input),init]);
  return new Response(JSON.stringify({ok:true,path:"/home/test/Downloads/Chess-Publisher/Test Cup/export.txt"}),{status:200,headers:{"Content-Type":"application/json"}});
};
const report={innerHTML:""};
let currentFrame=null;
let printed=0;
let printedHtml="";
const printDocument={
  readyState:"complete",html:"",open(){this.html="";},write(value){this.html+=String(value);printedHtml=this.html;},close(){}
};
const printWindow={document:printDocument,focus(){},print(){printed++;},addEventListener(){}};
function makeFrame(){
  const frame={id:"",style:{cssText:""},contentWindow:printWindow,contentDocument:printDocument,setAttribute(){},addEventListener(){},remove(){if(currentFrame===frame)currentFrame=null;}};
  currentFrame=frame;
  return frame;
}
const documentObj={
  readyState:"complete",title:"",body:{appendChild(node){currentFrame=node;}},
  getElementById(id){if(id==="screenPrintReport")return report;if(id==="cpLinuxPrintFrame")return currentFrame;return null;},
  querySelectorAll(sel){if(sel==="style")return[{textContent:".cp-exact-table{border-collapse:collapse}"}];return[];},
  createElement(tag){if(tag==="iframe")return makeFrame();return{};},
  addEventListener(){}
};
const windowObj={
  fetch:fetchFn,
  data:{currentTournament:"Test Cup"},
  getCurrentTournament(){return {settings:{organizer:"Club",country:"BUL",director:"Director",chiefArbiter:"FA Arbiter",timeControl:"60+30",tournamentRatingType:"Standard",venue:"Hall",city:"Zlatograd",rounds:"7",tournamentFormat:"Individual Swiss",fideRated:"Yes",fideEventId:"497756",startDate:"2026-10-02T10:00",endDate:"2026-10-04T18:00"},players:[{pairingNumber:2,title:"",name:"B Player",fideId:"2222222",fed:"BUL",rating:1900},{pairingNumber:1,title:"IM",name:"A Player",fideId:"1111111",fed:"TUR",rating:2300}]};},
  getActiveRegistrationPlayers(t){return t.players;},
  normalizePlayerTitle(v){return String(v||"").trim();},
  exportTextFile(){throw new Error("browser fallback should not be used in native contract");},
  buildGeneralText(){return "GENERAL";},buildScheduleText(){return "SCHEDULE";},buildRegulationsText(){return "REGS";},
  printReport(){return "other";},saveAll(){},setStatus(v){this.lastStatus=v;},appAlert(){},print(){throw new Error("parent native print must not be used when a report exists");},escapeHtml(v){return String(v)}
};
const immediate=(fn)=>{fn();return 1;};
const context={window:windowObj,document:documentObj,Response,console,setTimeout:immediate,clearTimeout(){}};context.globalThis=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(SCRIPT,"utf8"),context,{filename:"export_integration.js"});

const text=windowObj.cpLinuxStartingListText();
if(!text.includes("Starting rank")||!text.includes("FideID")||!text.includes("FED")||!text.includes("Rtg"))throw new Error("Starting List reference columns are missing");
if(text.indexOf("A Player")>text.indexOf("B Player"))throw new Error("Starting List must follow Starting Rank / pairing number order");
if(!text.includes("1111111")||!text.includes("FA Arbiter"))throw new Error("Starting List metadata/player identity is incomplete");

let result=await windowObj.exportParticipantsTxt();
if(!result?.ok)throw new Error("Starting List native TXT export failed");
let payload=JSON.parse(calls.at(-1)[1].body);
if(calls.at(-1)[0]!=="/linux/export-text"||payload.category!=="Starting List")throw new Error("Starting List did not use native export service");

result=await windowObj.exportTextFile("PAIRINGS\r\n","Pairings_R1");
payload=JSON.parse(calls.at(-1)[1].body);
if(!result?.ok||payload.category!=="Pairings"||!payload.fileName.endsWith("_Pairings_R1.txt"))throw new Error("Pairings TXT did not use native export service");

windowObj.printReport("players");
if(!report.innerHTML.includes("Starting rank")||!report.innerHTML.includes("<th>FideID</th>")||!report.innerHTML.includes("<th>FED</th>"))throw new Error("Starting List print template does not match required columns");
if(printed!==1)throw new Error(`isolated print frame did not print exactly once: ${printed}`);
if(!printedHtml.includes('id="screenPrintReport"')||!printedHtml.includes("A Player")||!printedHtml.includes("FideID"))throw new Error("isolated print document is missing Starting List rows");
if(!printedHtml.includes("#cpLinuxDevBadge,#cpLinuxTabPopupBackdrop")||!printedHtml.includes("display:none!important"))throw new Error("isolated print document does not suppress Linux overlays/badges");

console.log("LINUX_EXPORT_WEBVIEW_CONTRACT=PASS (Starting List + native TXT + Pairings TXT + isolated nonblank print)");
