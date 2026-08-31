"use strict";

const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const {chromium}=require("playwright");

const BASE_URL=process.env.HUB_PREVIEW_URL||"http://127.0.0.1:4173/hub/";
const OUT=path.resolve("artifacts");
fs.mkdirSync(OUT,{recursive:true});

async function visibleDisplay(page,selector){
  return page.$eval(selector,el=>getComputedStyle(el).display);
}

async function assertNoPageOverflow(page,label){
  const metrics=await page.evaluate(()=>({
    scrollWidth:document.documentElement.scrollWidth,
    clientWidth:document.documentElement.clientWidth,
    bodyWidth:document.body.scrollWidth
  }));
  assert.ok(metrics.scrollWidth<=metrics.clientWidth+1,`${label}: document horizontal overflow ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bodyWidth<=metrics.clientWidth+1,`${label}: body horizontal overflow ${JSON.stringify(metrics)}`);
}

async function openAndReady(page,width,height){
  await page.setViewportSize({width,height});
  await page.goto(BASE_URL,{waitUntil:"networkidle"});
  await page.waitForFunction(()=>document.getElementById("tournamentName")?.textContent.includes("Beta Open"));
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.hubSource),"fixture","Beta preview must declare fixture source explicitly");
  await assertNoPageOverflow(page,`${width}px overview`);
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  const consoleErrors=[];
  page.on("console",msg=>{if(msg.type()==="error") consoleErrors.push(msg.text());});
  page.on("pageerror",error=>consoleErrors.push(error.message));

  try{
    for(const width of [320,390]){
      await openAndReady(page,width,844);
      await page.click('[data-section="pairings"]');
      await assertNoPageOverflow(page,`${width}px pairings`);
      assert.equal(await visibleDisplay(page,'[data-panel="pairings"] .desktop-table'),"none",`${width}px must not show desktop pairings table`);
      assert.notEqual(await visibleDisplay(page,'[data-panel="pairings"] .mobile-list'),"none",`${width}px must show mobile pairings cards`);

      await page.click('[data-section="standings"]');
      await assertNoPageOverflow(page,`${width}px standings`);
      assert.equal(await visibleDisplay(page,'[data-panel="standings"] .desktop-table'),"none",`${width}px must not show desktop standings table`);
      assert.notEqual(await visibleDisplay(page,'[data-panel="standings"] .mobile-list'),"none",`${width}px must show mobile standings cards`);

      if(width===390){
        await page.screenshot({path:path.join(OUT,"hub-mobile-390.png"),fullPage:true});
      }
    }

    await openAndReady(page,1440,1000);
    await page.click('[data-section="pairings"]');
    await assertNoPageOverflow(page,"1440px pairings");
    assert.notEqual(await visibleDisplay(page,'[data-panel="pairings"] .desktop-table'),"none","Desktop must show pairings table");
    assert.equal(await visibleDisplay(page,'[data-panel="pairings"] .mobile-list'),"none","Desktop must hide pairings cards");

    await page.click('[data-section="standings"]');
    await assertNoPageOverflow(page,"1440px standings");
    assert.notEqual(await visibleDisplay(page,'[data-panel="standings"] .desktop-table'),"none","Desktop must show standings table");
    assert.equal(await visibleDisplay(page,'[data-panel="standings"] .mobile-list'),"none","Desktop must hide standings cards");
    await page.screenshot({path:path.join(OUT,"hub-desktop-1440.png"),fullPage:true});

    assert.deepEqual(consoleErrors,[],`Browser console/page errors: ${consoleErrors.join(" | ")}`);
    console.log("PASS - Chess-Publisher Hub responsive browser smoke tests");
  }finally{
    await browser.close();
  }
})().catch(error=>{
  console.error(error.stack||error);
  process.exit(1);
});
