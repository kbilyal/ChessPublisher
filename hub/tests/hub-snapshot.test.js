"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Hub=require("../client/hub-snapshot.js");

function makeTournament(){
  return {
    settings:{
      organizer:"Chess Club",
      chiefArbiter:"Chief Arbiter",
      arbiter:"Arbiter",
      director:"Director",
      venue:"Sports Hall",
      city:"Sofia",
      country:"BUL",
      timeControl:"15+5",
      startDate:"2026-09-01T10:00:00+03:00",
      endDate:"2026-09-01T18:00:00+03:00",
      generalRegistrationDeadline:"2026-09-01T09:30:00+03:00",
      rounds:2,
      tournamentFormat:"Swiss",
      pairingSystem:"Dutch",
      fideRated:"Yes",
      tournamentRatingType:"Rapid",
      liveLink:"https://example.test/live",
      website:"https://example.test",
      email:"test@example.test",
      phone:"+359000000000"
    },
    pairings:{
      liveBoards:{
        "1":[{board:1,whiteKey:"fid:1001",blackKey:"local:p2",result:"1-0"}],
        "2":[{board:1,whiteKey:"local:p2",blackKey:"fid:1001",result:"-"}]
      }
    },
    schedule:{rows:[{no:"1",dateTime:"2026-09-01T10:00:00+03:00",event:"Round 1",description:"Start"}]},
    players:[
      {name:"Player One",fideId:"1001",fed:"BUL",rating:2100,birth:"1990",title:"FM",attendance:"present",joinedFromRound:1},
      {name:"Player Two",fideId:"",localKey:"local:p2",fed:"TUR",rating:1900,birth:"2000",title:"",attendance:"present",joinedFromRound:1}
    ]
  };
}

function makeStandings(){
  return {
    completed:1,
    tieList:["BH","SB"],
    players:[
      {key:"fid:1001",score:1,bh:1.5,sb:1},
      {key:"local:p2",score:0,bh:1,sb:0}
    ]
  };
}

function build(tournament=makeTournament(),overrides={}){
  return Hub.buildSnapshot({
    tournament,
    tournamentName:"Hub Test Open",
    localTournamentId:"local-tournament-test-1",
    clientVersion:"1.05.00-beta.1",
    revision:3,
    previousRevision:2,
    generatedAt:"2026-08-31T10:00:00Z",
    standings:makeStandings(),
    tieBreakValueFn:(player,label)=>label==="BH"?player.bh:player.sb,
    ...overrides
  });
}

(function testContractIdentity(){
  assert.equal(Hub.SCHEMA_VERSION,"1.0");
  assert.equal(Hub.PRODUCT,"Chess-Publisher");
  const schemaPath=path.join(__dirname,"..","contracts","tournament-snapshot-v1.schema.json");
  const schema=JSON.parse(fs.readFileSync(schemaPath,"utf8"));
  assert.equal(schema.title,"Chess-Publisher Hub Tournament Snapshot v1");
})();

(function testSnapshotShape(){
  const snapshot=build();
  assert.equal(snapshot.schemaVersion,"1.0");
  assert.equal(snapshot.tournament.name,"Hub Test Open");
  assert.equal(snapshot.tournament.status,"playing");
  assert.equal(snapshot.tournament.fideRated,true);
  assert.equal(snapshot.players.length,2);
  assert.equal(snapshot.players[0].key,"fid:1001");
  assert.equal(snapshot.players[1].key,"local:p2");
  assert.equal(snapshot.rounds.length,2);
  assert.equal(snapshot.rounds[0].complete,true);
  assert.equal(snapshot.rounds[1].complete,false);
  assert.equal(snapshot.standings.rows[0].tieBreakValues[0],1.5);
  assert.equal(snapshot.schedule.length,1);
})();

(function testSerializerDoesNotMutateTournament(){
  const tournament=makeTournament();
  const before=JSON.stringify(tournament);
  build(tournament);
  assert.equal(JSON.stringify(tournament),before);
})();

(function testByeCompletion(){
  assert.equal(Hub.isByeResult("PAB"),true);
  assert.equal(Hub.isByeResult("½ BYE"),true);
  assert.equal(Hub.roundComplete([{board:1,whiteKey:"fid:1001",blackKey:null,result:"PAB"}]),true);
})();

(function testFinishedStatus(){
  const tournament=makeTournament();
  tournament.pairings.liveBoards["2"][0].result="0-1";
  const snapshot=build(tournament);
  assert.equal(snapshot.tournament.status,"finished");
})();

(function testRequiresStableLocalPlayerKey(){
  const tournament=makeTournament();
  delete tournament.players[1].localKey;
  assert.throws(()=>build(tournament),/stable key/i);
})();

(function testRejectsUnknownPairingPlayer(){
  const tournament=makeTournament();
  tournament.pairings.liveBoards["2"][0].blackKey="local:missing";
  assert.throws(()=>build(tournament),/Unknown player key/i);
})();

(function testFederationFallbackIsSchemaSafe(){
  const tournament=makeTournament();
  tournament.settings.country="";
  tournament.players[1].fed="FIDE";
  const snapshot=build(tournament);
  assert.equal(snapshot.tournament.location.federation,"FID");
  assert.equal(snapshot.players[1].federation,"FID");
  assert.equal(Hub.normalizeFederation("BUL"),"BUL");
  assert.equal(Hub.normalizeFederation("invalid federation"),"FID");
})();

(function testCanonicalSerializationIgnoresTransportMetadata(){
  const a=build();
  const b=build(makeTournament(),{
    clientVersion:"1.05.00-beta.9",
    revision:9,
    previousRevision:8,
    generatedAt:"2026-09-10T12:00:00Z",
    hubTournamentId:"ht_abcdef",
    publicSlug:"different-transport-slug",
    checksum:"transport-value"
  });
  assert.equal(Hub.canonicalJson(a),Hub.canonicalJson(b));
})();

(function testCanonicalSerializationChangesWithTournamentState(){
  const a=build();
  const tournament=makeTournament();
  tournament.players[0].rating=2200;
  const b=build(tournament);
  assert.notEqual(Hub.canonicalJson(a),Hub.canonicalJson(b));
})();

console.log("PASS - Chess-Publisher Hub snapshot serializer regression tests");
