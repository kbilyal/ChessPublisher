import assert from "node:assert/strict";
import {
  HubContractError,
  acceptedSnapshot,
  buildRevisionObjectKey,
  canonicalStateJson,
  normalizeRequestedSlug,
  publicationDecision,
  snapshotStateChecksum,
  validateCreateTournamentRequest,
  validateSnapshot
} from "../backend/core.mjs";

function snapshot(){
  return {
    schemaVersion:"1.0",
    client:{product:"Chess-Publisher",version:"1.05.00-beta.1"},
    publication:{
      hubTournamentId:null,
      publicSlug:null,
      revision:1,
      generatedAt:"2026-08-31T10:00:00.000Z",
      previousRevision:0,
      checksum:null
    },
    tournament:{
      localKey:"local-test-001",
      name:"Hub Backend Test Open",
      status:"playing",
      format:"Swiss",
      pairingSystem:"Dutch",
      timeControl:"15+5",
      ratingType:"Rapid",
      fideRated:true,
      roundsDeclared:2,
      location:{venue:"Sports Hall",city:"Sofia",federation:"BUL"},
      staff:{organizer:"Chess Club",chiefArbiter:"Chief",arbiter:"Arbiter",director:"Director"},
      dates:{start:"2026-09-01T07:00:00.000Z",end:"2026-09-01T15:00:00.000Z",registrationDeadline:null},
      contact:{email:"test@example.test",phone:""},
      links:{website:"",live:""}
    },
    players:[
      {key:"fid:1001",name:"Player One",fideId:"1001",federation:"BUL",rating:2100,birth:"1990",title:"FM",attendance:"present",joinedFromRound:1},
      {key:"local:p2",name:"Player Two",fideId:null,federation:"FID",rating:0,birth:null,title:"",attendance:"present",joinedFromRound:1}
    ],
    rounds:[
      {round:1,complete:true,pairings:[{board:1,whiteKey:"fid:1001",blackKey:"local:p2",result:"1-0"}]},
      {round:2,complete:false,pairings:[{board:1,whiteKey:"local:p2",blackKey:"fid:1001",result:"-"}]}
    ],
    standings:{
      round:1,
      final:false,
      tieBreaks:[{key:"bh",label:"BH"},{key:"sb",label:"SB"}],
      rows:[
        {rank:1,playerKey:"fid:1001",points:1,tieBreakValues:[0,0]},
        {rank:2,playerKey:"local:p2",points:0,tieBreakValues:[1,0]}
      ]
    },
    schedule:[{no:"1",dateTime:"2026-09-01T07:00:00.000Z",event:"Round 1",description:"Start"}]
  };
}

{
  const value=snapshot();
  assert.equal(validateSnapshot(value),true);
}

{
  const a=snapshot();
  const b=snapshot();
  b.client.version="1.05.00-beta.9";
  b.publication.generatedAt="2026-09-01T12:34:56.000Z";
  b.publication.revision=8;
  b.publication.previousRevision=7;
  b.publication.hubTournamentId="ht_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  b.publication.publicSlug="some-other-transport-slug";
  b.publication.checksum="transport-only-value";
  assert.equal(canonicalStateJson(a),canonicalStateJson(b));
  assert.equal(await snapshotStateChecksum(a),await snapshotStateChecksum(b));
}

{
  const a=snapshot();
  const b=snapshot();
  b.standings.rows[0].points=1.5;
  assert.notEqual(await snapshotStateChecksum(a),await snapshotStateChecksum(b));
}

{
  const value=snapshot();
  value.players[1].federation="FIDE";
  assert.throws(()=>validateSnapshot(value),error=>
    error instanceof HubContractError && error.code==="snapshot_invalid" && /three-letter federation/i.test(error.message)
  );
}

{
  const value=snapshot();
  value.rounds[0].pairings[0].blackKey="local:missing";
  assert.throws(()=>validateSnapshot(value),/Unknown player key/i);
}

{
  const incoming="a".repeat(64);
  assert.deepEqual(publicationDecision({currentRevision:0,currentChecksum:null,expectedRevision:0,incomingChecksum:incoming}),{kind:"accept",nextRevision:1});
  assert.deepEqual(publicationDecision({currentRevision:1,currentChecksum:incoming,expectedRevision:0,incomingChecksum:incoming}),{kind:"idempotent",revision:1});
  assert.deepEqual(publicationDecision({currentRevision:3,currentChecksum:"b".repeat(64),expectedRevision:1,incomingChecksum:incoming}),{kind:"stale",currentRevision:3});
  assert.deepEqual(publicationDecision({currentRevision:1,currentChecksum:incoming,expectedRevision:2,incomingChecksum:incoming}),{kind:"client_ahead",currentRevision:1});
}

{
  const checksum="1".repeat(64);
  assert.equal(
    buildRevisionObjectKey("ht_abcdef0123456789",12,checksum),
    `tournaments/ht_abcdef0123456789/revisions/00000012-${checksum}.json`
  );
}

{
  const source=snapshot();
  const before=JSON.stringify(source);
  const checksum=await snapshotStateChecksum(source);
  const accepted=acceptedSnapshot(source,{
    tournamentId:"ht_abcdef0123456789",
    publicSlug:"hub-backend-test-open",
    revision:1,
    previousRevision:0,
    checksum
  });
  assert.equal(JSON.stringify(source),before,"acceptedSnapshot must not mutate the desktop payload");
  assert.equal(accepted.publication.hubTournamentId,"ht_abcdef0123456789");
  assert.equal(accepted.publication.checksum,checksum);
}

{
  assert.equal(normalizeRequestedSlug(" Sofia Open 2026 "),"sofia-open-2026");
  assert.deepEqual(
    validateCreateTournamentRequest({localKey:"local-1",name:"Sofia Open",requestedSlug:"sofia-open"}),
    {localKey:"local-1",name:"Sofia Open",requestedSlug:"sofia-open"}
  );
}

console.log("PASS - Chess-Publisher Hub backend core regression tests");
