(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  if(root) root.ChessPublisherHubData=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const SCHEMA_VERSION="1.0";

  function text(value){
    return value===null || value===undefined ? "" : String(value).trim();
  }

  function normalizeApiBase(value){
    return text(value).replace(/\/+$/g,"");
  }

  function normalizeSlug(value){
    const slug=text(value).toLowerCase();
    if(!slug) return null;
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)){
      throw new Error("Tournament link contains an invalid Hub slug.");
    }
    if(slug.length>100) throw new Error("Tournament Hub slug is too long.");
    return slug;
  }

  function effectiveConfig(config){
    return {
      apiBase:normalizeApiBase(config?.apiBase),
      fixturePath:text(config?.fixturePath)||"sample-tournament.json",
      previewFixture:config?.previewFixture===true
    };
  }

  function resolveRequest({search="",config={}}={}){
    const cfg=effectiveConfig(config);
    const params=new URLSearchParams(search||"");
    const slug=normalizeSlug(params.get("t")||params.get("slug"));
    const fixtureRequested=params.get("fixture")==="1";

    if(slug){
      if(!cfg.apiBase){
        throw new Error("Chess-Publisher Hub API is not configured for this beta preview.");
      }
      return {
        kind:"api",
        slug,
        url:`${cfg.apiBase}/v1/public/tournaments/${encodeURIComponent(slug)}`
      };
    }

    if(fixtureRequested || cfg.previewFixture){
      return {kind:"fixture",slug:null,url:cfg.fixturePath};
    }

    throw new Error("Tournament link is missing. Open a Chess-Publisher Hub tournament URL.");
  }

  function validatePublicSnapshot(snapshot){
    if(!snapshot || typeof snapshot!=="object" || Array.isArray(snapshot)){
      throw new Error("Hub returned invalid tournament data.");
    }
    if(snapshot.schemaVersion!==SCHEMA_VERSION){
      throw new Error(`Unsupported Hub tournament schema: ${text(snapshot.schemaVersion)||"unknown"}.`);
    }
    if(!snapshot.tournament || typeof snapshot.tournament!=="object" || !text(snapshot.tournament.name)){
      throw new Error("Hub tournament data is missing its event identity.");
    }
    if(!Array.isArray(snapshot.players) || !Array.isArray(snapshot.rounds)){
      throw new Error("Hub tournament data is incomplete.");
    }
    if(!snapshot.standings || typeof snapshot.standings!=="object" || !Array.isArray(snapshot.standings.rows)){
      throw new Error("Hub tournament standings data is incomplete.");
    }
    return snapshot;
  }

  async function readErrorResponse(response){
    try{
      const body=await response.clone().json();
      const message=text(body?.error?.message);
      if(message) return message;
    }catch{}
    if(response.status===404) return "Published tournament was not found.";
    if(response.status===503) return "Tournament storage is temporarily unavailable.";
    return `Tournament data request failed (${response.status}).`;
  }

  async function loadTournament({
    fetchImpl=globalThis.fetch,
    search=globalThis.location?.search||"",
    config=globalThis.ChessPublisherHubConfig||{}
  }={}){
    if(typeof fetchImpl!=="function") throw new Error("Browser fetch is unavailable.");
    const request=resolveRequest({search,config});
    const response=await fetchImpl(request.url,{
      method:"GET",
      headers:{accept:"application/json"},
      cache:request.kind==="fixture"?"no-store":"default",
      credentials:"omit"
    });
    if(!response.ok) throw new Error(await readErrorResponse(response));
    const data=validatePublicSnapshot(await response.json());
    return {
      data,
      meta:{
        source:request.kind,
        slug:request.slug,
        etag:text(response.headers?.get?.("etag"))||null
      }
    };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    normalizeSlug,
    resolveRequest,
    validatePublicSnapshot,
    loadTournament
  });
});
