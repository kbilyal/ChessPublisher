"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),assert=require("assert");
const root=path.resolve(__dirname,"..");
const apiSrc=fs.readFileSync(path.join(root,"cloud","client","cloud-workspace-api.js"),"utf8");
const adapter=fs.readFileSync(path.join(root,"webview","CloudWorkspaceAdapter.js"),"utf8");
const redesign=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
const engine=fs.readFileSync(path.join(root,"ChessPublisher-LocalEngine.ps1"),"utf8");
const launcher=fs.readFileSync(path.join(root,"ChessPublisher-WebView.ps1"),"utf8");
const contract=JSON.parse(fs.readFileSync(path.join(root,"WEB-SYNC-CONTRACT-beta96-r4.json"),"utf8"));
let pass=0,fail=0;
function ok(v,msg){try{assert.ok(v);console.log(`PASS ${String(++pass).padStart(2,"0")} ${msg}`);}catch(e){fail++;console.error(`FAIL ${msg}`);}}
function eq(a,b,msg){try{assert.deepStrictEqual(a,b);console.log(`PASS ${String(++pass).padStart(2,"0")} ${msg}`);}catch(e){fail++;console.error(`FAIL ${msg}: ${e.message}`);}}
function response(payload,status=200){return {ok:status>=200&&status<300,status,text:async()=>JSON.stringify(payload)};}
function loadApi(fetchImpl){
  const c={module:{exports:{}},exports:{},globalThis:{},Headers,AbortController,setTimeout,clearTimeout};c.globalThis=c;
  vm.createContext(c);vm.runInContext(apiSrc,c,{filename:"cloud-workspace-api.js"});
  return c.module.exports.createClient({baseUrl:"http://127.0.0.1:18765/cloud-proxy",fetchImpl,clientVersion:"1.06.00-beta.96"});
}
(async()=>{
  ok(contract.webMainCommit==="6506f7acf4d6330ca67cfde57119e631258833d1","contract anchors the audited current Web main commit");
  ok(contract.fingerprintContentSchema===7,"Desktop/Web parity contract locks portable fingerprint schema 7");
  ok(adapter.includes('return `${u.origin}/cloud-proxy`;')&&redesign.includes('return `${u.origin}/cloud-proxy`;'),"Windows keeps the already-starting r3 LocalEngine /cloud-proxy transport unchanged");
  const lv=(launcher.match(/^\$serviceVersion\s*=\s*'([^']+)'/m)||[])[1];
  const ev=(engine.match(/^\$serviceVersion\s*=\s*'([^']+)'/m)||[])[1];
  eq([lv,ev],["V140","V140"],"launcher and LocalEngine remain byte-compatible at proven V140 startup contract");

  {
    const seen=[];
    const fetchImpl=async(url,init)=>{
      seen.push({url,method:init.method,headers:init.headers,body:init.body});
      if(url.endsWith('/api/v1/cloud/tournaments')&&init.method==='GET')return response({tournaments:[]});
      if(url.endsWith('/api/v1/cloud/tournaments')&&init.method==='POST')return response({tournament:{id:'cloud-1',localKey:'shared-1',revision:0,name:'Event'}});
      throw new Error('unexpected '+init.method+' '+url);
    };
    const api=loadApi(fetchImpl);
    const out=await api.createTournament('tok',{localKey:'shared-1',name:'Event',deviceId:'dev',deviceLabel:'Windows Desktop'});
    eq(seen.map(x=>x.method),['GET','POST'],"CREATE first lists organizer-owned tournaments and creates only when exact stable identity is absent");
    ok(seen[0].headers.get('Authorization')==='Bearer tok'&&seen[1].headers.get('Authorization')==='Bearer tok',"Organizer bearer auth is present on identity preflight and CREATE");
    ok(out.tournament.id==='cloud-1',"identity-safe CREATE returns created Cloud row");
  }
  {
    const seen=[];
    const fetchImpl=async(url,init)=>{seen.push({url,method:init.method});return response({tournaments:[{id:'cloud-existing',localKey:'shared-1',revision:9,name:'Event'}]});};
    const api=loadApi(fetchImpl);
    const out=await api.createTournament('tok',{localKey:'shared-1',name:'Event'});
    eq(seen.map(x=>x.method),['GET'],"CREATE reuses one exact organizer-scoped identity without duplicate POST");
    ok(out.reused===true&&out.tournament.id==='cloud-existing',"exact shared identity is reused");
  }
  {
    const seen=[];
    const snapshot={cloudWorkspace:{internalId:'shared-1',cloudTournamentId:'cloud-1'},data:{currentTournament:'Event',tournaments:{Event:{name:'Event'}}}};
    const fetchImpl=async(url,init)=>{
      seen.push({url,method:init.method,headers:init.headers,body:init.body});
      if(url.endsWith('/api/v1/cloud/tournaments/cloud-1')&&init.method==='GET')return response({tournament:{id:'cloud-1',localKey:'shared-1',revision:7}});
      if(url.endsWith('/api/v1/cloud/tournaments/cloud-1/snapshot')&&init.method==='PUT')return response({revision:8,cloudTournamentId:'cloud-1',internalId:'shared-1'});
      throw new Error('unexpected '+init.method+' '+url);
    };
    const api=loadApi(fetchImpl);
    await api.putSnapshot('tok',{tournamentId:'cloud-1',baseRevision:7,snapshot,deviceId:'dev',deviceLabel:'Windows Desktop'});
    eq(seen.map(x=>x.method),['GET','PUT'],"PUT validates current Cloud tournament metadata before guarded write");
    ok(seen[1].headers.get('X-Expected-Revision')==='7',"PUT preserves X-Expected-Revision optimistic concurrency guard");
    eq(Object.keys(JSON.parse(seen[1].body)).sort(),['baseRevision','deviceId','deviceLabel','snapshot'].sort(),"PUT body matches current Web Cloud wire shape");
  }
  {
    let putSeen=false;
    const fetchImpl=async(url,init)=>{
      if(init.method==='GET')return response({tournament:{id:'cloud-1',localKey:'other-event',revision:7}});
      putSeen=true;return response({revision:8});
    };
    const api=loadApi(fetchImpl);let code='';
    try{await api.putSnapshot('tok',{tournamentId:'cloud-1',baseRevision:7,snapshot:{cloudWorkspace:{internalId:'shared-1',cloudTournamentId:'cloud-1'}},deviceId:'',deviceLabel:''});}catch(e){code=e.code;}
    ok(code==='cloud_identity_mismatch'&&!putSeen,"stable-identity mismatch fails closed before Cloud PUT");
  }

  ok(adapter.includes('tournament?.online?.hubTournamentId')&&adapter.includes('tournament?.hub?.tournamentId')&&adapter.includes('tournament?.publication?.hubTournamentId'),"new Desktop identity uses the same durable Hub identity candidates as current Web");
  ok(adapter.includes('one.cloud.cloudTournamentId')&&adapter.includes('safe.cloudWorkspace.cloudTournamentId'),"Desktop private snapshot carries cloudTournamentId in the same portable locations as Web");
  ok(redesign.includes('ADOPT_SAVED_IDENTITY')&&redesign.includes('isGeneratedOrLegacyInternalId'),"saved organizer-owned Cloud ID can repair only generated/legacy Desktop internal identity");
  ok(/return !id\|\|\/\^cp-\(\?:tournament\|cloud\):\/i\.test\(id\);/.test(redesign)&&!redesign.includes('||/^tournament:/i.test(id)'),"Web-generated tournament:<uuid> identity is treated as durable and never silently adopted away");
  ok(redesign.includes('confirmRemoteEqualsLocal')&&redesign.includes('cloud_postcondition_mismatch'),"Desktop push requires authoritative Cloud read-back equality before success");
  ok(redesign.includes('pull-postcondition')&&redesign.includes('confirmedLocalHash!==remoteHash'),"Desktop pull verifies durable local fingerprint equality");
  ok(redesign.includes('[SYNC r4]')&&redesign.includes('cloudDiagnosticLog'),"SYNC diagnostics expose transport/identity/revision/decision without bearer token");
  ok(!/syncTrace\([^\n]*token/i.test(redesign),"SYNC diagnostics never include Organizer Token");

  console.log(`BETA96 R4 WEB-DESKTOP CLOUD CONTRACT PARITY: ${fail?'FAIL':'PASS'} (${pass} PASS / ${fail} FAIL)`);
  process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
