"use strict";

const assert=require("node:assert/strict");
const Data=require("../data-source.js");

function snapshot(){
  return {
    schemaVersion:"1.0",
    publication:{revision:2,generatedAt:"2026-08-31T10:00:00Z"},
    tournament:{name:"Data Source Test Open"},
    players:[],
    rounds:[],
    standings:{rows:[],tieBreaks:[]},
    schedule:[]
  };
}

(async()=>{
  {
    const request=Data.resolveRequest({
      search:"",
      config:{apiBase:"",fixturePath:"sample-tournament.json",previewFixture:true}
    });
    assert.deepEqual(request,{kind:"fixture",slug:null,url:"sample-tournament.json"});
  }

  {
    const request=Data.resolveRequest({
      search:"?t=sofia-open-2026",
      config:{apiBase:"https://hub-api.example.test/",previewFixture:false}
    });
    assert.deepEqual(request,{
      kind:"api",
      slug:"sofia-open-2026",
      url:"https://hub-api.example.test/v1/public/tournaments/sofia-open-2026"
    });
  }

  {
    assert.throws(()=>Data.resolveRequest({
      search:"?t=real-event",
      config:{apiBase:"",previewFixture:true}
    }),/API is not configured/i,"A real tournament slug must never silently fall back to fixture data");
  }

  {
    assert.throws(()=>Data.resolveRequest({
      search:"?t=../bad",
      config:{apiBase:"https://hub-api.example.test"}
    }),/invalid Hub slug/i);
  }

  {
    const calls=[];
    const fakeFetch=async(url,options)=>{
      calls.push({url,options});
      return new Response(JSON.stringify(snapshot()),{
        status:200,
        headers:{"content-type":"application/json","etag":"\"abc123\""}
      });
    };
    const loaded=await Data.loadTournament({
      fetchImpl:fakeFetch,
      search:"?slug=sofia-open-2026",
      config:{apiBase:"https://hub-api.example.test",previewFixture:false}
    });
    assert.equal(loaded.data.tournament.name,"Data Source Test Open");
    assert.equal(loaded.meta.source,"api");
    assert.equal(loaded.meta.slug,"sofia-open-2026");
    assert.equal(loaded.meta.etag,"\"abc123\"");
    assert.equal(calls.length,1);
    assert.equal(calls[0].options.credentials,"omit");
    assert.equal(calls[0].options.cache,"default");
    assert.equal(calls[0].options.headers.accept,"application/json");
  }

  {
    const fakeFetch=async()=>new Response(JSON.stringify({
      error:{code:"not_found",message:"Published tournament was not found."}
    }),{status:404,headers:{"content-type":"application/json"}});
    await assert.rejects(()=>Data.loadTournament({
      fetchImpl:fakeFetch,
      search:"?t=missing-event",
      config:{apiBase:"https://hub-api.example.test",previewFixture:false}
    }),/Published tournament was not found/i);
  }

  {
    assert.throws(()=>Data.validatePublicSnapshot({schemaVersion:"9.9",tournament:{name:"Bad"},players:[],rounds:[],standings:{rows:[]}}),/Unsupported Hub tournament schema/i);
  }

  console.log("PASS - Chess-Publisher Hub public data source regression tests");
})().catch(error=>{
  console.error(error.stack||error);
  process.exit(1);
});
