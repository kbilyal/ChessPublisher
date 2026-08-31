(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  if(root) root.ChessPublisherHubApi=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const DEFAULT_BASE_URL="https://chess-publisher-hub-api-beta.kyamranbilyal.workers.dev";
  const DEFAULT_CLIENT_VERSION="1.05.00-beta.1";
  const SECRET_KEY_RE=/(authorization|token|secret|password|beta[_-]?key|manage[_-]?key)/i;

  class HubApiError extends Error{
    constructor(message,details={}){
      super(message||"Chess-Publisher Hub API request failed.");
      this.name="HubApiError";
      this.status=Number(details.status||0);
      this.code=String(details.code||"hub_api_error");
      this.retryAfter=details.retryAfter===null||details.retryAfter===undefined?null:Number(details.retryAfter);
      this.currentRevision=details.currentRevision===null||details.currentRevision===undefined?null:Number(details.currentRevision);
      this.response=details.response||null;
    }
  }

  function text(value){
    return value===null||value===undefined?"":String(value).trim();
  }

  function required(value,label){
    const out=text(value);
    if(!out) throw new Error(`${label} is required.`);
    return out;
  }

  function nonNegativeInteger(value,label){
    const number=Number(value);
    if(!Number.isInteger(number)||number<0) throw new Error(`${label} must be a non-negative integer.`);
    return number;
  }

  function normalizeBaseUrl(value){
    return required(value||DEFAULT_BASE_URL,"Hub API base URL").replace(/\/+$/,"");
  }

  function cloneJson(value){
    return value===undefined?undefined:JSON.parse(JSON.stringify(value));
  }

  function redactSensitive(value,seen){
    if(value===null||value===undefined) return value;
    if(typeof value!=="object") return value;
    const visited=seen||new WeakSet();
    if(visited.has(value)) return "[Circular]";
    visited.add(value);
    if(Array.isArray(value)) return value.map(item=>redactSensitive(item,visited));
    const out={};
    for(const [key,item] of Object.entries(value)){
      out[key]=SECRET_KEY_RE.test(key)?"[REDACTED]":redactSensitive(item,visited);
    }
    return out;
  }

  function publicLinkRecord(createResponse){
    const tournament=createResponse&&createResponse.tournament?createResponse.tournament:createResponse;
    if(!tournament||typeof tournament!=="object") throw new Error("Hub tournament create response is required.");
    return Object.freeze({
      hubTournamentId:required(tournament.id,"Hub tournament ID"),
      publicSlug:required(tournament.publicSlug,"Hub public slug"),
      revision:nonNegativeInteger(tournament.revision||0,"Hub revision"),
      publicPageUrl:text(tournament.publicPageUrl),
      ownerId:text(tournament.ownerId)||null,
      ownerBound:tournament.ownerBound===true
    });
  }

  function createTournamentPayload(input){
    if(!input||typeof input!=="object") throw new Error("Hub tournament metadata is required.");
    return {
      localKey:required(input.localKey,"Local tournament key"),
      name:required(input.name,"Tournament name"),
      status:text(input.status)||"draft",
      format:text(input.format),
      pairingSystem:text(input.pairingSystem),
      timeControl:text(input.timeControl),
      ratingType:text(input.ratingType),
      fideRated:input.fideRated===true,
      federation:text(input.federation)||"FID",
      city:text(input.city),
      startAt:input.startAt||null,
      endAt:input.endAt||null,
      roundsDeclared:Math.max(1,Number.parseInt(input.roundsDeclared,10)||1),
      isPublic:input.isPublic!==false
    };
  }

  function createClient(options={}){
    const baseUrl=normalizeBaseUrl(options.baseUrl||DEFAULT_BASE_URL);
    const fetchImpl=options.fetchImpl||options.fetch||(typeof fetch==="function"?fetch.bind(globalThis):null);
    const clientVersion=text(options.clientVersion)||DEFAULT_CLIENT_VERSION;
    if(typeof fetchImpl!=="function") throw new Error("A fetch implementation is required for Hub API access.");

    async function request(path,init={}){
      const headers=new Headers(init.headers||{});
      headers.set("Accept","application/json");
      headers.set("X-Client-Version",clientVersion);
      let body=init.body;
      if(body!==undefined&&body!==null&&typeof body!=="string"){
        headers.set("Content-Type","application/json");
        body=JSON.stringify(body);
      }

      let response;
      try{
        response=await fetchImpl(`${baseUrl}${path}`,{...init,headers,body});
      }catch(error){
        throw new HubApiError("Hub API is unavailable.",{code:"network_error",response:redactSensitive({message:error?.message||String(error)})});
      }

      const raw=await response.text();
      let payload=null;
      if(raw){
        try{payload=JSON.parse(raw);}catch{payload={raw};}
      }
      if(!response.ok){
        const code=text(payload?.error)||text(payload?.error?.code)||`http_${response.status}`;
        const message=text(payload?.message)||text(payload?.error?.message)||`Hub API returned HTTP ${response.status}.`;
        const retryRaw=response.headers.get("Retry-After");
        const retryAfter=retryRaw!==null&&/^\d+$/.test(retryRaw)?Number(retryRaw):null;
        throw new HubApiError(message,{
          status:response.status,
          code,
          retryAfter,
          currentRevision:payload?.currentRevision,
          response:redactSensitive(payload)
        });
      }
      return payload;
    }

    function organizerBearer(organizerToken){
      return {Authorization:`Bearer ${required(organizerToken,"Organizer token")}`};
    }

    function managedHeaders(organizerToken,manageToken,extra={}){
      return {
        Authorization:`Bearer ${required(manageToken,"Tournament management token")}`,
        "X-Organizer-Token":required(organizerToken,"Organizer token"),
        ...extra
      };
    }

    return Object.freeze({
      baseUrl,
      clientVersion,

      health(){
        return request("/api/v1/health",{method:"GET"});
      },

      organizerMe(organizerToken){
        return request("/api/v1/organizer/me",{method:"GET",headers:organizerBearer(organizerToken)});
      },

      listOrganizerTournaments(organizerToken){
        return request("/api/v1/organizer/tournaments",{method:"GET",headers:organizerBearer(organizerToken)});
      },

      createOrganizerTournament(organizerToken,metadata){
        return request("/api/v1/organizer/tournaments",{
          method:"POST",
          headers:organizerBearer(organizerToken),
          body:createTournamentPayload(metadata)
        });
      },

      publishSnapshot(args){
        if(!args||typeof args!=="object") throw new Error("Hub publish arguments are required.");
        const tournamentId=encodeURIComponent(required(args.tournamentId,"Hub tournament ID"));
        const expectedRevision=nonNegativeInteger(args.expectedRevision,"Expected revision");
        if(!args.snapshot||typeof args.snapshot!=="object") throw new Error("Hub snapshot is required.");
        return request(`/api/v1/tournaments/${tournamentId}/snapshot`,{
          method:"PUT",
          headers:managedHeaders(args.organizerToken,args.manageToken,{"X-Expected-Revision":String(expectedRevision)}),
          body:cloneJson(args.snapshot)
        });
      },

      deleteTournament(args){
        if(!args||typeof args!=="object") throw new Error("Hub delete arguments are required.");
        const tournamentId=encodeURIComponent(required(args.tournamentId,"Hub tournament ID"));
        const publicSlug=required(args.publicSlug,"Hub public slug");
        return request(`/api/v1/tournaments/${tournamentId}`,{
          method:"DELETE",
          headers:managedHeaders(args.organizerToken,args.manageToken,{"X-Confirm-Delete":publicSlug})
        });
      },

      restoreTournament(args){
        if(!args||typeof args!=="object") throw new Error("Hub restore arguments are required.");
        const tournamentId=encodeURIComponent(required(args.tournamentId,"Hub tournament ID"));
        return request(`/api/v1/tournaments/${tournamentId}/restore`,{
          method:"POST",
          headers:managedHeaders(args.organizerToken,args.manageToken)
        });
      },

      listPublicTournaments(){
        return request("/api/v1/public/tournaments",{method:"GET"});
      },

      getPublicTournament(idOrSlug){
        return request(`/api/v1/public/tournaments/${encodeURIComponent(required(idOrSlug,"Hub public tournament identifier"))}`,{method:"GET"});
      }
    });
  }

  return Object.freeze({
    DEFAULT_BASE_URL,
    DEFAULT_CLIENT_VERSION,
    HubApiError,
    createClient,
    createTournamentPayload,
    publicLinkRecord,
    redactSensitive
  });
});
