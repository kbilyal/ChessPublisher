"use strict";

const assert=require("node:assert/strict");
const Hub=require("../client/hub-snapshot.js");

const BASE_URL=process.env.HUB_TEST_BASE_URL||"http://127.0.0.1:8787";
const TOKEN="cp_test_0123456789abcdef0123456789abcdef";

function makeTournament(){
  return {
    settings:{
      organizer:"Hub Integration Chess Club",
      chiefArbiter:"Chief Arbiter",
      arbiter:"Arbiter",
      director:"Director",
      venue:"Sports Hall",
      city:"Sofia",
      country:"BUL",
      timeControl:"15+5",
      startDate:"2026-09-01T10:00:00+03:00",
      endDate:"2026-09-01T18:00:00+03:00",
      rounds:2,
      tournamentFormat:"Swiss",
      pairingSystem:"Dutch",
      fideRated:"Yes",
      tournamentRatingType:"Rapid",
      email:"integration@example.test",
      phone:""
    },
    players:[
      {name:"Player One",fideId:"1001",fed:"BUL",rating:2100,title:"FM",attendance:"present",joinedFromRound:1},
      {name:"Local Player",fideId:"",localKey:"local:p2",fed:"",rating:0,title:"",attendance:"present",joinedFromRound:1}
    ],
    pairings:{
      liveBoards:{
        "1":[{board:1,whiteKey:"fid:1001",blackKey:"local:p2",result:"1-0"}],
        "2":[{board:1,whiteKey:"local:p2",blackKey:"fid:1001",result:"-"}]
      }
    },
    schedule:{rows:[{no:"1",dateTime:"2026-09-01T10:00:00+03:00",event:"Round 1",description:"Start"}]}
  };
}

function makeStandings(){
  return {
    completed:1,
    tieList:["BH","SB"],
    players:[
      {key:"fid:1001",score:1,bh:0,sb:0},
      {key:"local:p2",score:0,bh:1,sb:0}
    ]
  };
}

function buildSnapshot(tournament,{hubTournamentId,publicSlug,revision,previousRevision}){
  return Hub.buildSnapshot({
    tournament,
    tournamentName:"Hub Local Integration Open",
    localTournamentId:"local-integration-001",
    clientVersion:"1.05.00-beta.1",
    hubTournamentId,
    publicSlug,
    revision,
    previousRevision,
    generatedAt:"2026-08-31T10:00:00Z",
    standings:makeStandings(),
    tieBreakValueFn:(player,label)=>label==="BH"?player.bh:player.sb
  });
}

async function api(path,{method="GET",body,token=TOKEN,headers={}}={}){
  const finalHeaders={...headers};
  if(token) finalHeaders.authorization=`Bearer ${token}`;
  if(body!==undefined) finalHeaders["content-type"]="application/json";
  const response=await fetch(`${BASE_URL}${path}`,{
    method,
    headers:finalHeaders,
    body:body===undefined?undefined:JSON.stringify(body)
  });
  let data=null;
  if(response.status!==304){
    const contentType=response.headers.get("content-type")||"";
    if(contentType.includes("application/json")) data=await response.json();
    else data=await response.text();
  }
  return {response,data};
}

(async()=>{
  {
    const {response,data}=await api("/health",{token:null});
    assert.equal(response.status,200);
    assert.equal(data.status,"ok");
  }

  {
    const {response,data}=await api("/v1/tournaments",{
      method:"POST",
      token:null,
      body:{localKey:"unauthorized",name:"Unauthorized",requestedSlug:"unauthorized"}
    });
    assert.equal(response.status,401);
    assert.equal(data.error.code,"unauthorized");
  }

  const create=await api("/v1/tournaments",{
    method:"POST",
    body:{
      localKey:"local-integration-001",
      name:"Hub Local Integration Open",
      requestedSlug:"hub-local-integration-open"
    }
  });
  assert.equal(create.response.status,201);
  assert.match(create.data.tournamentId,/^ht_[a-z0-9]+$/i);
  assert.equal(create.data.publicSlug,"hub-local-integration-open");
  assert.equal(create.data.currentRevision,0);

  const tournamentId=create.data.tournamentId;
  const publicSlug=create.data.publicSlug;

  {
    const duplicate=await api("/v1/tournaments",{
      method:"POST",
      body:{
        localKey:"local-integration-001",
        name:"Hub Local Integration Open",
        requestedSlug:"ignored-on-relink"
      }
    });
    assert.equal(duplicate.response.status,200);
    assert.equal(duplicate.data.tournamentId,tournamentId);
    assert.equal(duplicate.data.linked,true);
  }

  {
    const conflict=await api("/v1/tournaments",{
      method:"POST",
      body:{
        localKey:"local-integration-002",
        name:"Slug Conflict",
        requestedSlug:"hub-local-integration-open"
      }
    });
    assert.equal(conflict.response.status,409);
    assert.equal(conflict.data.error.code,"slug_conflict");
  }

  const localTournament=makeTournament();
  const revision1=buildSnapshot(localTournament,{
    hubTournamentId:tournamentId,
    publicSlug,
    revision:1,
    previousRevision:0
  });

  const publish1=await api(`/v1/tournaments/${tournamentId}/revisions`,{
    method:"PUT",
    body:revision1
  });
  assert.equal(publish1.response.status,201);
  assert.equal(publish1.data.revision,1);
  assert.equal(publish1.data.idempotent,false);
  assert.match(publish1.data.checksum,/^[a-f0-9]{64}$/);
  const checksum1=publish1.data.checksum;

  {
    const publicRead=await api(`/v1/public/tournaments/${publicSlug}`,{token:null});
    assert.equal(publicRead.response.status,200);
    assert.equal(publicRead.data.publication.revision,1);
    assert.equal(publicRead.data.publication.checksum,checksum1);
    assert.equal(publicRead.data.players[1].federation,"FID");
    const etag=publicRead.response.headers.get("etag");
    assert.equal(etag,`"${checksum1}"`);

    const notModified=await api(`/v1/public/tournaments/${publicSlug}`,{
      token:null,
      headers:{"if-none-match":etag}
    });
    assert.equal(notModified.response.status,304);
  }

  {
    const retry=await api(`/v1/tournaments/${tournamentId}/revisions`,{
      method:"PUT",
      body:revision1
    });
    assert.equal(retry.response.status,200);
    assert.equal(retry.data.idempotent,true);
    assert.equal(retry.data.revision,1);
    assert.equal(retry.data.checksum,checksum1);
  }

  localTournament.players[1].rating=1800;
  const revision2=buildSnapshot(localTournament,{
    hubTournamentId:tournamentId,
    publicSlug,
    revision:2,
    previousRevision:1
  });

  const publish2=await api(`/v1/tournaments/${tournamentId}/revisions`,{
    method:"PUT",
    body:revision2
  });
  assert.equal(publish2.response.status,201);
  assert.equal(publish2.data.revision,2);
  assert.notEqual(publish2.data.checksum,checksum1);

  {
    const staleOldRetry=await api(`/v1/tournaments/${tournamentId}/revisions`,{
      method:"PUT",
      body:revision1
    });
    assert.equal(staleOldRetry.response.status,409);
    assert.equal(staleOldRetry.data.error.code,"revision_conflict");
  }

  {
    const oldRevision=await api(`/v1/public/tournaments/${publicSlug}/revisions/1`,{token:null});
    assert.equal(oldRevision.response.status,200);
    assert.equal(oldRevision.data.publication.revision,1);
    assert.equal(oldRevision.data.publication.checksum,checksum1);
  }

  {
    const current=await api(`/v1/public/tournaments/${publicSlug}`,{token:null});
    assert.equal(current.response.status,200);
    assert.equal(current.data.publication.revision,2);
    assert.equal(current.data.players[1].rating,1800);
  }

  console.log("PASS - Chess-Publisher Hub Worker local D1/R2 integration tests");
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
