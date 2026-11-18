(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.ChessPublisherCloudWorkspaceApi=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const DEFAULT_BASE_URL="https://chess-publisher-hub-api-beta.kyamranbilyal.workers.dev";
  const DEFAULT_CLIENT_VERSION="1.06.00-beta.10";
  const DEFAULT_REQUEST_TIMEOUT_MS=45000;

  class CloudWorkspaceApiError extends Error{
    constructor(message,details={}){
      super(message||"Chess-Publisher Cloud Workspace request failed.");
      this.name="CloudWorkspaceApiError";
      this.status=Number(details.status||0);
      this.code=String(details.code||"cloud_api_error");
      this.currentRevision=details.currentRevision==null?null:Number(details.currentRevision);
      this.response=details.response||null;
    }
  }

  const text=v=>v==null?"":String(v).trim();
  function required(v,label){const s=text(v);if(!s)throw new Error(`${label} is required.`);return s;}
  function revision(v,label="Revision"){
    const n=Number(v);
    if(!Number.isInteger(n)||n<0)throw new Error(`${label} must be a non-negative integer.`);
    return n;
  }
  function normalizeBaseUrl(v){return required(v||DEFAULT_BASE_URL,"Cloud API base URL").replace(/\/+$/,"");}
  function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}

  function createClient(options={}){
    const baseUrl=normalizeBaseUrl(options.baseUrl||DEFAULT_BASE_URL);
    const fetchImpl=options.fetchImpl||options.fetch||(typeof fetch==="function"?fetch.bind(globalThis):null);
    const clientVersion=text(options.clientVersion)||DEFAULT_CLIENT_VERSION;
    const requestTimeoutMs=Number.isFinite(Number(options.timeoutMs))&&Number(options.timeoutMs)>0?Number(options.timeoutMs):DEFAULT_REQUEST_TIMEOUT_MS;
    if(typeof fetchImpl!=="function")throw new Error("A fetch implementation is required for Cloud Workspace.");

    async function request(path,init={}){
      const headers=new Headers(init.headers||{});
      headers.set("Accept","application/json");
      // Browser/WebView compatibility: Organizer authentication and revision
      // guards are carried by Authorization/X-Expected-Revision. Do not add the
      // optional X-Client-Version header because cross-origin Worker preflight
      // may reject it before the authenticated request reaches the Hub.
      let body=init.body;
      if(body!==undefined&&body!==null&&typeof body!=="string"){
        headers.set("Content-Type","application/json");
        body=JSON.stringify(body);
      }
      let response;
      let raw="";
      const controller=typeof AbortController!=="undefined"?new AbortController():null;
      let timer=null;
      let timedOut=false;
      const timeoutPromise=new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          timedOut=true;
          try{controller?.abort();}catch(_){}
          reject(new CloudWorkspaceApiError("Cloud Workspace request timed out.",{code:"timeout"}));
        },requestTimeoutMs);
      });
      try{
        [response,raw]=await Promise.race([
          (async()=>{
            const r=await fetchImpl(`${baseUrl}${path}`,{...init,headers,body,cache:"no-store",...(controller?{signal:controller.signal}:{})});
            return [r,await r.text()];
          })(),
          timeoutPromise
        ]);
      }catch(error){
        if(error instanceof CloudWorkspaceApiError)throw error;
        if(timedOut||error?.name==="AbortError")throw new CloudWorkspaceApiError("Cloud Workspace request timed out.",{code:"timeout"});
        throw new CloudWorkspaceApiError("Cloud Workspace is unavailable.",{code:"network_error",response:{message:text(error?.message)}});
      }finally{if(timer!==null)clearTimeout(timer);}

      let payload=null;
      if(raw){try{payload=JSON.parse(raw);}catch{payload={raw};}}
      if(!response.ok){
        throw new CloudWorkspaceApiError(
          text(payload?.message)||`Cloud Workspace returned HTTP ${response.status}.`,
          {
            status:response.status,
            code:text(payload?.error)||`http_${response.status}`,
            currentRevision:payload?.currentRevision,
            response:payload
          }
        );
      }
      return payload;
    }

    const bearer=token=>({Authorization:`Bearer ${required(token,"Organizer token")}`});

    // beta.96 r4: align Desktop CREATE/PUT identity safety with the current
    // React/Vite Web Companion. Organizer token scopes ownership; a logical
    // tournament is never selected by display name alone.
    async function identitySafeCreateTournament(token,input){
      if(!input||typeof input!=="object")throw new Error("Cloud tournament metadata is required.");
      const internalId=text(input.localKey);
      if(!internalId)throw new CloudWorkspaceApiError("Stable tournament identity is required before Cloud CREATE.",{status:409,code:"cloud_identity_missing"});
      const listed=await request("/api/v1/cloud/tournaments",{method:"GET",headers:bearer(token)});
      const rows=Array.isArray(listed?.tournaments)?listed.tournaments:[];
      const matches=rows.filter(row=>text(row?.localKey)===internalId);
      if(matches.length>1){
        throw new CloudWorkspaceApiError("More than one Cloud tournament has the same stable identity. Automatic selection is blocked.",{
          status:409,code:"cloud_identity_ambiguous",response:{internalId,matches:matches.map(row=>text(row?.id)).filter(Boolean)}
        });
      }
      if(matches.length===1)return {ok:true,tournament:clone(matches[0]),reused:true};
      return request("/api/v1/cloud/tournaments",{
        method:"POST",headers:bearer(token),body:{
          localKey:internalId,
          name:required(input.name,"Tournament name"),
          deviceId:text(input.deviceId),deviceLabel:text(input.deviceLabel)
        }
      });
    }

    async function identitySafePutSnapshot(token,args){
      if(!args||typeof args!=="object")throw new Error("Cloud snapshot arguments are required.");
      const rawId=required(args.tournamentId,"Cloud tournament ID");
      const id=encodeURIComponent(rawId);
      if(!args.snapshot||typeof args.snapshot!=="object")throw new Error("Cloud snapshot is required.");
      const baseRevision=revision(args.baseRevision||0,"Base revision");
      const snapshot=clone(args.snapshot);
      const internalId=text(snapshot?.cloudWorkspace?.internalId);
      const snapshotCloudId=text(snapshot?.cloudWorkspace?.cloudTournamentId);
      const metaResult=await request(`/api/v1/cloud/tournaments/${id}`,{method:"GET",headers:bearer(token)});
      const remote=metaResult?.tournament||{};
      const remoteId=text(remote?.id);
      const remoteInternalId=text(remote?.localKey);
      if(remoteId&&remoteId!==rawId){
        throw new CloudWorkspaceApiError("Cloud tournament identity changed before synchronization.",{status:409,code:"cloud_identity_mismatch"});
      }
      if(snapshotCloudId&&snapshotCloudId!==rawId){
        throw new CloudWorkspaceApiError("Snapshot belongs to a different Cloud tournament. Write blocked.",{status:409,code:"cloud_identity_mismatch"});
      }
      if(internalId&&remoteInternalId&&internalId!==remoteInternalId){
        throw new CloudWorkspaceApiError("Stable tournament identity does not match the selected Cloud tournament. Write blocked.",{
          status:409,code:"cloud_identity_mismatch",response:{internalId,remoteInternalId,cloudTournamentId:rawId}
        });
      }
      return request(`/api/v1/cloud/tournaments/${id}/snapshot`,{
        method:"PUT",headers:{...bearer(token),"X-Expected-Revision":String(baseRevision)},
        body:{baseRevision,snapshot,deviceId:text(args.deviceId),deviceLabel:text(args.deviceLabel)}
      });
    }

    return Object.freeze({
      baseUrl,
      clientVersion,
      workspace(token){return request("/api/v1/cloud/workspace",{method:"GET",headers:bearer(token)});},
      getSettings(token){return request("/api/v1/cloud/settings",{method:"GET",headers:bearer(token)});},
      putSettings(token,args){
        if(!args||typeof args!=="object")throw new Error("Cloud settings arguments are required.");
        const baseRevision=revision(args.baseRevision||0,"Settings base revision");
        if(!args.settings||typeof args.settings!=="object"||Array.isArray(args.settings))throw new Error("Cloud settings are required.");
        return request("/api/v1/cloud/settings",{
          method:"PUT",headers:{...bearer(token),"X-Expected-Revision":String(baseRevision)},
          body:{baseRevision,settings:clone(args.settings),deviceId:text(args.deviceId),deviceLabel:text(args.deviceLabel)}
        });
      },
      listTournaments(token){return request("/api/v1/cloud/tournaments",{method:"GET",headers:bearer(token)});},
      // beta.90: Desktop must see reversible Web Trash so SYNC can restore the
      // same logical tournament instead of attempting to create a duplicate.
      listArchivedTournaments(token){return request("/api/v1/cloud/tournaments/archived",{method:"GET",headers:bearer(token)});},
      restoreArchivedTournament(token,tournamentId){
        const id=encodeURIComponent(required(tournamentId,"Cloud tournament ID"));
        return request(`/api/v1/cloud/tournaments/${id}/restore`,{method:"POST",headers:bearer(token)});
      },
      getTournament(token,tournamentId){return request(`/api/v1/cloud/tournaments/${encodeURIComponent(required(tournamentId,"Cloud tournament ID"))}`,{method:"GET",headers:bearer(token)});},
      createTournament:identitySafeCreateTournament,
      putSnapshot:identitySafePutSnapshot,
      getCurrentSnapshot(token,tournamentId){
        const id=encodeURIComponent(required(tournamentId,"Cloud tournament ID"));
        return request(`/api/v1/cloud/tournaments/${id}/snapshot`,{method:"GET",headers:bearer(token)});
      },
      listRevisions(token,tournamentId){
        const id=encodeURIComponent(required(tournamentId,"Cloud tournament ID"));
        return request(`/api/v1/cloud/tournaments/${id}/revisions`,{method:"GET",headers:bearer(token)});
      },
      getRevision(token,tournamentId,rev){
        const id=encodeURIComponent(required(tournamentId,"Cloud tournament ID"));
        const n=revision(rev,"Cloud revision");if(n<1)throw new Error("Cloud revision must be positive.");
        return request(`/api/v1/cloud/tournaments/${id}/revisions/${n}`,{method:"GET",headers:bearer(token)});
      },
      restoreRevision(token,tournamentId,rev){
        const id=encodeURIComponent(required(tournamentId,"Cloud tournament ID"));
        const n=revision(rev,"Cloud revision");if(n<1)throw new Error("Cloud revision must be positive.");
        return request(`/api/v1/cloud/tournaments/${id}/restore/${n}`,{method:"POST",headers:bearer(token)});
      }
    });
  }

  return Object.freeze({DEFAULT_BASE_URL,DEFAULT_CLIENT_VERSION,DEFAULT_REQUEST_TIMEOUT_MS,CloudWorkspaceApiError,createClient});
});
