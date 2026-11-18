"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"ChessPublisher.html"),"utf8");
const src=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
let pass=0,fail=0;
function check(cond,label){if(cond){console.log("PASS "+label);pass++;}else{console.error("FAIL "+label);fail++;}}

check(/id="pairingsDownloadWebResultsBtn"/.test(html),"Pairings toolbar has Download Results button");
check(/onclick="downloadWebEnteredResults\(\)"/.test(html),"Download Results uses dedicated Pairings action");
check(/Pairings, players and tournament settings are never replaced/.test(html),"button tooltip states results-only safety contract");
check(/cpCloudDownloadWebResults/.test(html),"Pairings wrapper calls directional Cloud results API");
check(/window\.cpCloudDownloadWebResults=downloadWebResults/.test(src),"directional Cloud module exports results-only download");
check(/Pairing mismatch/.test(src)&&/Nothing was changed|Download Results was stopped/.test(src),"pairing mismatch fails closed");
check(/applyRemoteResultState\(op\.target,op\.remoteState\)/.test(src),"download applies only validated result-state metadata");
check(!/op\.target\.(?:whiteKey|blackKey|board)\s*=/.test(src),"download never rewrites board/player identity");

const localStorage={getItem:()=>null,setItem:()=>{}};
const fakeApi={createClient:()=>({})};
const core={
  tournamentContentHash:async()=>"x",
  ensureCloudMeta:t=>(t.cloud||(t.cloud={})),
  updateSyncBase:()=>{},
  cloudScopedSnapshot:()=>({}),
  tournamentContentForFingerprint:v=>v
};
const context={console,window:null,globalThis:null,document:{getElementById:()=>null,querySelector:()=>null,head:{appendChild(){}},body:{appendChild(){}},createElement:()=>({})},localStorage,
  ChessPublisherCloudWorkspaceApi:fakeApi,ChessPublisherCloudSyncInternals:core,
  setTimeout:()=>0,clearTimeout:()=>{},TextEncoder,crypto:require("crypto").webcrypto,
  data:{currentTournament:"",tournaments:{}},location:{href:""}
};
context.window=context;context.globalThis=context;
vm.createContext(context);vm.runInContext(src,context,{filename:"CloudWorkspaceRedesign.js"});
const internals=context.ChessPublisherCloudDirectionalInternals;
check(!!internals,"results planner internals exported");
check(internals.canonicalWebResult("1-0")==="1 - 0","canonicalizes compact white win");
check(internals.canonicalWebResult("1/2 - 1/2")==="½ - ½","canonicalizes ASCII draw");
check(internals.canonicalWebResult("PAB")==="PAB","preserves administrative PAB");
check(internals.canonicalWebResult("nonsense")==="","rejects unsupported result code");

const local={pairings:{liveBoards:{
  "1":[
    {board:1,whiteKey:"A",blackKey:"B",result:"-"},
    {board:2,whiteKey:"C",blackKey:"D",result:"1 - 0"},
    {board:3,whiteKey:"E",blackKey:"",result:"-"}
  ],
  "2":[{board:1,whiteKey:"F",blackKey:"G",result:"1 - 0"}]
}}};
const remote={pairings:{liveBoards:{
  "1":[
    {board:1,whiteKey:"A",blackKey:"B",result:"1-0"},
    {board:2,whiteKey:"C",blackKey:"D",result:"0 - 1"},
    {board:3,whiteKey:"E",blackKey:"",result:"PAB"}
  ],
  "2":[{board:1,whiteKey:"F",blackKey:"G",result:"-"}]
}}};
const plan=internals.planWebResultDownload(local,remote);
check(plan.operations.length===3,"planner finds three entered Web result changes");
check(plan.conflicts.length===1&&plan.conflicts[0].board===2,"planner flags populated Desktop result conflict");
check(plan.mismatches.length===0,"matching pairings are accepted");
check(plan.invalid.length===0,"valid Web result codes accepted");
check(local.pairings.liveBoards["1"][0].result==="-","planner is pure and does not mutate Desktop tournament");
check(!plan.operations.some(op=>op.round==="2"),"blank Web result never clears an existing Desktop result");

const movedRemote={pairings:{liveBoards:{"1":[{board:99,whiteKey:"A",blackKey:"B",result:"1 - 0"}]}}};
const moved=internals.planWebResultDownload(local,movedRemote);
check(moved.operations.length===1&&moved.mismatches.length===0,"unique player identity safely resolves a changed board number without changing pairing");

const mismatchRemote={pairings:{liveBoards:{"1":[{board:1,whiteKey:"A",blackKey:"X",result:"1 - 0"}]}}};
const mismatch=internals.planWebResultDownload(local,mismatchRemote);
check(mismatch.operations.length===0&&mismatch.mismatches.length===1,"different player identity is rejected");


const unusualRemote={pairings:{liveBoards:{"1":[{board:1,whiteKey:"A",blackKey:"B",result:"½ - ½",cpUnusualResult:"½-0"}]}}};
const unusual=internals.planWebResultDownload(local,unusualRemote);
check(unusual.operations.length===1&&unusual.operations[0].remoteState.kind==="unusual","unusual OTB Web result state is preserved");
const unusualTarget={board:1,whiteKey:"A",blackKey:"B",result:"-"};
internals.applyRemoteResultState(unusualTarget,unusual.operations[0].remoteState);
check(unusualTarget.result==="½ - ½"&&unusualTarget.cpUnusualResult==="½-0","unusual OTB metadata is applied without changing player identity");

const adjRemote={pairings:{liveBoards:{"1":[{board:1,whiteKey:"A",blackKey:"B",result:"-",adjourned:true}]}}};
const adj=internals.planWebResultDownload(local,adjRemote);
check(adj.operations.length===1&&adj.operations[0].remoteState.kind==="adjourned","Adjourned Web state is treated as an explicit result state");
const adjTarget={board:1,whiteKey:"A",blackKey:"B",result:"1 - 0"};
internals.applyRemoteResultState(adjTarget,adj.operations[0].remoteState);
check(adjTarget.result==="-"&&adjTarget.adjourned===true,"explicit Adjourned Web state can replace a result only through conflict-confirmed operation");

const invalidRemote={pairings:{liveBoards:{"1":[{board:1,whiteKey:"A",blackKey:"B",result:"2 - 0"}]}}};
const invalid=internals.planWebResultDownload(local,invalidRemote);
check(invalid.operations.length===0&&invalid.invalid.length===1,"unsupported Web result is rejected before mutation");

console.log(`BETA74 WEB RESULT DOWNLOAD RESULT: ${pass} PASS / ${fail} FAIL`);
process.exitCode=fail?1:0;
