"use strict";

const assert=require("node:assert/strict");
const {
  HubApiError,
  createClient,
  publicLinkRecord,
  redactSensitive
}=require("../client/hub-api-client.js");

function response(body,status=200,headers={}){
  return new Response(body===null?null:JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json",...headers}
  });
}

function recorder(queue){
  const calls=[];
  const fetchImpl=async (url,init={})=>{
    calls.push({url,init});
    const next=queue.shift();
    if(next instanceof Error) throw next;
    return next||response({ok:true});
  };
  return {calls,fetchImpl};
}

(async()=>{
  {
    const r=recorder([response({ok:true,tournament:{id:"hub_a",publicSlug:"event-a",revision:0,ownerBound:true,ownerId:"org_a",manageToken:"secret-manage",publicPageUrl:"https://chess-publisher.org/tournaments?id=event-a"}},201)]);
    const client=createClient({baseUrl:"https://hub.test/",clientVersion:"1.05.00-beta.1-test",fetchImpl:r.fetchImpl});
    const result=await client.createOrganizerTournament("organizer-secret",{
      localKey:"local-1",name:"Desktop Test",status:"registration",federation:"BUL",roundsDeclared:7,isPublic:true
    });
    assert.equal(r.calls.length,1);
    assert.equal(r.calls[0].url,"https://hub.test/api/v1/organizer/tournaments");
    assert.equal(r.calls[0].init.method,"POST");
    assert.equal(r.calls[0].init.headers.get("Authorization"),"Bearer organizer-secret");
    assert.equal(r.calls[0].init.headers.get("X-Beta-Key"),null,"desktop client must never send the shared beta create key");
    assert.equal(r.calls[0].init.headers.get("X-Client-Version"),"1.05.00-beta.1-test");
    const sent=JSON.parse(r.calls[0].init.body);
    assert.equal(sent.localKey,"local-1");
    assert.equal(sent.roundsDeclared,7);
    const link=publicLinkRecord(result);
    assert.deepEqual(link,{
      hubTournamentId:"hub_a",publicSlug:"event-a",revision:0,publicPageUrl:"https://chess-publisher.org/tournaments?id=event-a",ownerId:"org_a",ownerBound:true
    });
    assert.equal("manageToken" in link,false,"persisted public link record must not include manage token");
  }

  {
    const r=recorder([response({ok:true,revision:1,checksum:"abc"},201)]);
    const client=createClient({baseUrl:"https://hub.test",fetchImpl:r.fetchImpl});
    const snapshot={schemaVersion:"1.0",client:{product:"Chess-Publisher",version:"1.05.00-beta.1"},publication:{revision:0},tournament:{localKey:"x",name:"X"},players:[],rounds:[],standings:{rows:[],tieBreaks:[]},schedule:[]};
    await client.publishSnapshot({organizerToken:"organizer-secret",manageToken:"manage-secret",tournamentId:"hub_a",expectedRevision:0,snapshot});
    const call=r.calls[0];
    assert.equal(call.init.method,"PUT");
    assert.equal(call.init.headers.get("Authorization"),"Bearer manage-secret");
    assert.equal(call.init.headers.get("X-Organizer-Token"),"organizer-secret");
    assert.equal(call.init.headers.get("X-Expected-Revision"),"0");
    assert.deepEqual(JSON.parse(call.init.body),snapshot);
  }

  {
    const r=recorder([response({ok:true,deleted:true},200),response({ok:true,restored:true},200)]);
    const client=createClient({baseUrl:"https://hub.test",fetchImpl:r.fetchImpl});
    await client.deleteTournament({organizerToken:"org",manageToken:"manage",tournamentId:"hub_a",publicSlug:"slug-a"});
    assert.equal(r.calls[0].init.headers.get("X-Confirm-Delete"),"slug-a");
    assert.equal(r.calls[0].init.headers.get("X-Organizer-Token"),"org");
    await client.restoreTournament({organizerToken:"org",manageToken:"manage",tournamentId:"hub_a"});
    assert.equal(r.calls[1].init.method,"POST");
    assert.equal(r.calls[1].init.headers.get("Authorization"),"Bearer manage");
  }

  {
    const r=recorder([response({ok:false,error:"revision_conflict",currentRevision:4},409)]);
    const client=createClient({baseUrl:"https://hub.test",fetchImpl:r.fetchImpl});
    await assert.rejects(
      ()=>client.publishSnapshot({organizerToken:"org",manageToken:"manage",tournamentId:"hub_a",expectedRevision:3,snapshot:{x:1}}),
      error=>{
        assert.ok(error instanceof HubApiError);
        assert.equal(error.status,409);
        assert.equal(error.code,"revision_conflict");
        assert.equal(error.currentRevision,4);
        return true;
      }
    );
  }

  {
    const redacted=redactSensitive({
      organizerToken:"abc",
      nested:{manage_token:"def",Authorization:"Bearer secret",safe:"ok"},
      list:[{beta_key:"ghi",name:"visible"}]
    });
    assert.equal(redacted.organizerToken,"[REDACTED]");
    assert.equal(redacted.nested.manage_token,"[REDACTED]");
    assert.equal(redacted.nested.Authorization,"[REDACTED]");
    assert.equal(redacted.nested.safe,"ok");
    assert.equal(redacted.list[0].beta_key,"[REDACTED]");
    assert.equal(redacted.list[0].name,"visible");
  }

  console.log("Hub API client tests: PASS");
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
