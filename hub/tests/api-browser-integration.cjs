"use strict";

const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const {chromium}=require("playwright");

const API_BASE=process.env.HUB_API_BASE||"http://127.0.0.1:8787";
const SITE_BASE=process.env.HUB_SITE_BASE||"http://127.0.0.1:4173/hub/";
const TOKEN="cp_test_0123456789abcdef0123456789abcdef";
const SLUG="hub-site-api-integration";
const LOCAL_KEY="hub-site-api-integration-local";

async function api(pathname,{method="GET",body}={}){
  const headers={accept:"application/json"};
  if(method!=="GET") headers.authorization=`Bearer ${TOKEN}`;
  if(body!==undefined) headers["content-type"]="application/json";
  const response=await fetch(`${API_BASE}${pathname}`,{
    method,
    headers,
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const data=response.status===304?null:await response.json();
  return {response,data};
}

function publicationSnapshot(tournamentId){
  const fixturePath=path.resolve(__dirname,"..","sample-tournament.json");
  const snapshot=JSON.parse(fs.readFileSync(fixturePath,"utf8"));
  snapshot.client.version="1.05.00-beta.site-integration";
  snapshot.tournament.localKey=LOCAL_KEY;
  snapshot.tournament.name="Chess-Publisher Hub API Browser Integration";
  snapshot.publication.hubTournamentId=tournamentId;
  snapshot.publication.publicSlug=SLUG;
  snapshot.publication.revision=1;
  snapshot.publication.previousRevision=0;
  snapshot.publication.checksum=null;
  snapshot.publication.generatedAt="2026-08-31T11:00:00.000Z";
  return snapshot;
}

(async()=>{
  const health=await api("/health");
  assert.equal(health.response.status,200,"Local Hub API must be healthy before browser integration test");

  const created=await api("/v1/tournaments",{
    method:"POST",
    body:{localKey:LOCAL_KEY,name:"Chess-Publisher Hub API Browser Integration",requestedSlug:SLUG}
  });
  assert.ok([200,201].includes(created.response.status),`Create tournament returned ${created.response.status}`);
  const tournamentId=created.data.tournamentId;
  assert.match(tournamentId,/^ht_[a-z0-9]+$/i);

  if(created.data.currentRevision===0){
    const published=await api(`/v1/tournaments/${tournamentId}/revisions`,{
      method:"PUT",
      body:publicationSnapshot(tournamentId)
    });
    assert.equal(published.response.status,201,`Publish returned ${published.response.status}`);
    assert.equal(published.data.revision,1);
  }

  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const pageErrors=[];
  let fixtureRequests=0;
  let publicApiRequests=0;

  page.on("pageerror",error=>pageErrors.push(error.message));
  page.on("console",message=>{if(message.type()==="error") pageErrors.push(message.text());});
  page.on("request",request=>{
    if(request.url().includes("sample-tournament.json")) fixtureRequests++;
    if(request.url().includes(`/v1/public/tournaments/${SLUG}`)) publicApiRequests++;
  });

  await page.route("**/hub/config.js",route=>route.fulfill({
    status:200,
    contentType:"application/javascript; charset=utf-8",
    body:`window.ChessPublisherHubConfig=Object.freeze({apiBase:${JSON.stringify(API_BASE)},fixturePath:"sample-tournament.json",previewFixture:false});`
  }));

  try{
    await page.goto(`${SITE_BASE}?t=${SLUG}`,{waitUntil:"networkidle"});
    await page.waitForFunction(()=>document.getElementById("tournamentName")?.textContent.includes("API Browser Integration"));

    assert.equal(await page.evaluate(()=>document.documentElement.dataset.hubSource),"api");
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.hubSlug),SLUG);
    assert.equal(fixtureRequests,0,"Real slug mode must not request preview fixture data");
    assert.ok(publicApiRequests>=1,"Browser must request the Hub public API");
    assert.equal(await page.locator("#playersCount").textContent(),"8");

    await page.click('[data-section="pairings"]');
    assert.notEqual(await page.$eval('[data-panel="pairings"] .mobile-list',el=>getComputedStyle(el).display),"none");

    await page.click('[data-section="standings"]');
    assert.notEqual(await page.$eval('[data-panel="standings"] .mobile-list',el=>getComputedStyle(el).display),"none");

    assert.deepEqual(pageErrors,[],`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("PASS - Chess-Publisher Hub public site -> Worker API browser integration");
  }finally{
    await browser.close();
  }
})().catch(error=>{
  console.error(error.stack||error);
  process.exit(1);
});
