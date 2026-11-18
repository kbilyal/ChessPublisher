(()=>{
  "use strict";

  try{
    if(window.__cpHubAdapterLoaded) return;
    window.__cpHubAdapterLoaded=true;

    const CLIENT_VERSION="1.06.00-beta.4";
    const ORGANIZER_SECRET_BASE_KEY="organizer-primary";
    const INSTALL_SCOPE_STORAGE_KEY="ChessPublisherOnline_InstallScope_v1";
    const apiLib=window.ChessPublisherHubApi;
    const snapshotLib=window.ChessPublisherHubSnapshot;
    if(!apiLib||!snapshotLib) throw new Error("Hub client modules are unavailable.");

    const WIRE_CLIENT_VERSION=String(document.documentElement?.dataset?.chesspublisherVersion||CLIENT_VERSION).trim()||CLIENT_VERSION;
    const api=apiLib.createClient({clientVersion:WIRE_CLIENT_VERSION});
    let organizerTokenCache="";
    let organizerInfo=null;
    let busy=false;
    let nativeSequence=0;
    const nativePending=new Map();

    const text=value=>value===null||value===undefined?"":String(value).trim();
    const html=value=>text(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
    const attr=html;

    // beta.13: Organizer Token is installation-scoped. The scope itself is a
    // non-secret random identifier stored only in this WebView profile. A clean
    // installation gets a new scope and therefore cannot inherit a credential
    // saved by an older installation, even under the same Windows account.
    function installationScope(){
      let scope="";
      try{scope=text(localStorage.getItem(INSTALL_SCOPE_STORAGE_KEY));}catch(_){ }
      if(!scope){
        const id=globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        scope=`install:${id}`;
        try{localStorage.setItem(INSTALL_SCOPE_STORAGE_KEY,scope);}catch(_){ }
      }
      return scope;
    }
    function organizerSecretKey(){return `${ORGANIZER_SECRET_BASE_KEY}:${installationScope()}`;}
    window.cpOnlineOrganizerSecretKey=organizerSecretKey;

    function log(message,kind="info"){
      const box=document.getElementById("hubLog");
      const line=`[${new Date().toLocaleTimeString("en-GB",{hour12:false})}] ${message}`;
      if(box){box.value+=(box.value?"\n":"")+line;box.scrollTop=box.scrollHeight;}
      try{ if(typeof setStatus==="function") setStatus(message); }catch(_){}
      if(kind==="error") console.error("Chess-Publisher Hub:",message);
    }

    function describeError(error){
      const status=Number(error?.status||0);
      const code=text(error?.code);
      const message=text(error?.message)||"Hub operation failed.";
      return `${status?`HTTP ${status}${code?` / ${code}`:""}: `:""}${message}`;
    }

    function nativeRequest(operation,key,value){
      return new Promise((resolve,reject)=>{
        const requestId=`hub-secret-${Date.now()}-${++nativeSequence}`;
        const timer=setTimeout(()=>{
          nativePending.delete(requestId);
          reject(new Error("Windows Hub credential operation timed out."));
        },10000);
        nativePending.set(requestId,{resolve,reject,timer});
        try{
          const payload={type:"cp:hub-secret",requestId,operation,key:String(key||"")};
          if(operation==="set") payload.value=String(value||"");
          window.chrome.webview.postMessage(payload);
        }catch(error){
          clearTimeout(timer);nativePending.delete(requestId);reject(error);
        }
      });
    }

    try{
      window.chrome.webview.addEventListener("message",event=>{
        const message=event?.data;
        if(!message||message.type!=="cp:hub-secret-result"||!message.requestId)return;
        const pending=nativePending.get(String(message.requestId));
        if(!pending)return;
        nativePending.delete(String(message.requestId));clearTimeout(pending.timer);
        if(message.ok)pending.resolve(message);
        else pending.reject(new Error(message.error||"Windows Hub credential operation failed."));
      });
    }catch(_){}

    window.cpNativeHubSecretGet=async key=>{
      const result=await nativeRequest("get",key);
      return result.found?String(result.value||""):"";
    };
    window.cpNativeHubSecretSet=(key,value)=>nativeRequest("set",key,value);
    window.cpNativeHubSecretRemove=key=>nativeRequest("remove",key);

    function currentTournament(){
      try{return typeof getCurrentTournament==="function"?getCurrentTournament():null;}catch(_){return null;}
    }

    function currentTournamentName(tournament){
      try{
        for(const [name,value] of Object.entries(data?.tournaments||{})) if(value===tournament) return name;
        return text(data?.currentTournament);
      }catch(_){return "";}
    }

    function syncCurrentTournamentFromUi(tournament){
      if(!tournament||currentTournament()!==tournament)throw new Error("The active tournament changed before the Hub operation started.");
      if(typeof saveAll==="function") saveAll();
      return tournament;
    }

    function formatBytes(bytes){
      const n=Math.max(0,Number(bytes)||0);
      if(n<1024)return `${n} B`;
      if(n<1024*1024)return `${(n/1024).toFixed(n<10*1024?1:0)} KiB`;
      return `${(n/(1024*1024)).toFixed(2)} MiB`;
    }

    function normalizeRegulationsFileMetadata(file,response){
      const raw=response?.regulationsFile||response?.file||response?.attachment||response?.upload||response?.metadata||response?.object||response||{};
      const out={
        name:text(raw.name||raw.fileName||raw.filename||response?.fileName||file?.name),
        size:Math.max(0,Number(raw.size??raw.sizeBytes??response?.size??response?.sizeBytes??file?.size)||0),
        contentType:text(raw.contentType||raw.mimeType||raw.type||response?.contentType||file?.type)||"application/octet-stream",
        uploadedAt:text(raw.uploadedAt||raw.createdAt||response?.uploadedAt||response?.createdAt)||new Date().toISOString()
      };
      const optional={
        objectKey:text(raw.objectKey||raw.storageKey||raw.key||response?.objectKey||response?.storageKey),
        url:text(raw.url||raw.publicUrl||raw.downloadUrl||response?.url||response?.publicUrl||response?.downloadUrl),
        sha256:text(raw.sha256||raw.checksum||response?.sha256||response?.checksum),
        etag:text(raw.etag||response?.etag)
      };
      for(const [key,value] of Object.entries(optional))if(value)out[key]=value;
      if(!out.name)throw new Error("Hub upload response did not identify the uploaded regulations file.");
      return out;
    }

    function ensureHubMeta(tournament){
      if(!tournament||typeof tournament!=="object")throw new Error("No tournament is open.");
      if(!tournament.hub||typeof tournament.hub!=="object"||Array.isArray(tournament.hub)) tournament.hub={};
      if(!text(tournament.hub.localKey)){
        const uuid=globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        // Beta.4 shares one non-secret logical tournament ID between the public
        // Hub link and private cloud when possible. It is never used for auth.
        tournament.hub.localKey=text(tournament?.cloud?.internalId)||`cp:${uuid}`;
        try{saveData();}catch(_){}
      }
      return tournament.hub;
    }

    function manageSecretKey(hubTournamentId){
      const id=text(hubTournamentId);
      if(!/^hub_[A-Za-z0-9]+$/.test(id))throw new Error("Hub tournament ID is invalid.");
      return `manage-${id}`;
    }

    async function getOrganizerToken(){
      if(organizerTokenCache)return organizerTokenCache;
      organizerTokenCache=text(await window.cpNativeHubSecretGet(organizerSecretKey()));
      return organizerTokenCache;
    }

    async function getManageToken(meta){
      if(!meta?.hubTournamentId)return "";
      return text(await window.cpNativeHubSecretGet(manageSecretKey(meta.hubTournamentId)));
    }

    function ensurePlayerKeys(tournament){
      let changed=false;
      (tournament?.players||[]).forEach((player,index)=>{
        if(!text(player?.localKey))changed=true;
        if(typeof ensureStableLocalPlayerKey==="function") ensureStableLocalPlayerKey(player,index);
      });
      if(changed){try{saveData();}catch(_){}}
    }

    function buildSnapshot(tournament){
      const meta=ensureHubMeta(tournament);
      ensurePlayerKeys(tournament);
      const name=currentTournamentName(tournament);
      let standings={players:[],tieList:[],completed:0};
      try{ if(typeof calculateFinalStandings==="function") standings=calculateFinalStandings(); }catch(error){console.warn("Hub standings snapshot fallback:",error);}
      const currentRevision=Math.max(0,Number(meta.revision)||0);
      return snapshotLib.buildSnapshot({
        tournament,
        tournamentName:name,
        localTournamentId:meta.localKey,
        clientVersion:WIRE_CLIENT_VERSION,
        hubTournamentId:text(meta.hubTournamentId)||null,
        publicSlug:text(meta.publicSlug)||null,
        revision:currentRevision+1,
        previousRevision:currentRevision===0?null:currentRevision,
        checksum:null,
        standings,
        tieBreakValueFn:typeof standingTieBreakValue==="function"?standingTieBreakValue:undefined
      });
    }

    function createMetadataFromSnapshot(snapshot){
      return {
        localKey:snapshot.tournament.localKey,
        name:snapshot.tournament.name,
        status:snapshot.tournament.status,
        format:snapshot.tournament.format,
        pairingSystem:snapshot.tournament.pairingSystem,
        timeControl:snapshot.tournament.timeControl,
        ratingType:snapshot.tournament.ratingType,
        fideRated:snapshot.tournament.fideRated,
        federation:snapshot.tournament.location.federation,
        city:snapshot.tournament.location.city,
        startAt:snapshot.tournament.dates.start,
        endAt:snapshot.tournament.dates.end,
        roundsDeclared:snapshot.tournament.roundsDeclared,
        isPublic:true
      };
    }

    function saveLink(tournament,link,extra={}){
      const meta=ensureHubMeta(tournament);
      Object.assign(meta,{
        hubTournamentId:text(link.hubTournamentId),
        publicSlug:text(link.publicSlug),
        revision:Math.max(0,Number(link.revision)||0),
        publicPageUrl:text(link.publicPageUrl)||`https://chess-publisher.org/tournaments?id=${encodeURIComponent(text(link.publicSlug))}`,
        ownerId:text(link.ownerId)||null,
        ownerBound:link.ownerBound===true,
        ...extra
      });
      try{saveData();}catch(_){}
      return meta;
    }

    function setBusy(value,label=""){
      busy=!!value;
      document.querySelectorAll('#hub button[id^="hub"],#hub input[id^="hub"]').forEach(el=>{
        if(el.id==="hubOrganizerToken"&&busy)el.disabled=true;
        else if(el.tagName==="BUTTON")el.disabled=busy;
        else if(el.id==="hubOrganizerToken")el.disabled=false;
      });
      const busyLabel=document.getElementById("hubBusyLabel");
      if(busyLabel)busyLabel.textContent=busy?(label||"Working…"):"";
    }

    async function runBusy(label,action){
      if(busy||window.__cpOnlineCloudBusy)return;
      window.__cpOnlineCloudBusy=true;
      setBusy(true,label);
      try{return await action();}
      catch(error){log(describeError(error),"error");throw error;}
      finally{setBusy(false);window.__cpOnlineCloudBusy=false;refreshUi();}
    }

    function publicUrl(meta){
      if(text(meta?.publicPageUrl))return text(meta.publicPageUrl);
      if(text(meta?.publicSlug))return `https://chess-publisher.org/tournaments?id=${encodeURIComponent(meta.publicSlug)}`;
      return "";
    }

    function refreshUi(){
      const t=currentTournament();
      const busyState=busy||!!window.__cpOnlineCloudBusy;
      const meta=t?.hub||{};
      const name=currentTournamentName(t)||"No tournament open";
      const el=id=>document.getElementById(id);
      if(el("hubCurrentTournament"))el("hubCurrentTournament").textContent=name;
      if(el("hubLocalKey"))el("hubLocalKey").textContent=text(meta.localKey)||"Not initialized";
      if(el("hubTournamentId"))el("hubTournamentId").textContent=text(meta.hubTournamentId)||"Not linked";
      if(el("hubPublicSlug"))el("hubPublicSlug").textContent=text(meta.publicSlug)||"—";
      if(el("hubRevision"))el("hubRevision").textContent=String(Math.max(0,Number(meta.revision)||0));
      const publicLabel=!text(meta.hubTournamentId)?"Not published":(meta.deleted?"Deleted (recoverable)":"Published / Active");
      if(el("hubDeleted"))el("hubDeleted").textContent=publicLabel;
      if(el("hubPublicBadge")){
        el("hubPublicBadge").textContent=publicLabel;
        el("hubPublicBadge").className=`hub-status-pill ${!text(meta.hubTournamentId)?"hub-status-neutral":(meta.deleted?"hub-status-warn":"hub-status-ok")}`;
      }
      if(el("hubOrganizerState"))el("hubOrganizerState").textContent=organizerInfo?`${organizerInfo.displayName} (${organizerInfo.id})`:(organizerTokenCache?"Token saved — verify to connect":"Token required for Web Sync");
      if(el("hubAccountBadge")){
        el("hubAccountBadge").textContent=organizerInfo?"Connected":(organizerTokenCache?"Token saved":"Token required");
        el("hubAccountBadge").className=`hub-status-pill ${organizerInfo?"hub-status-ok":(organizerTokenCache?"hub-status-neutral":"hub-status-warn")}`;
      }
      const regulationsFile=meta?.regulationsFile;
      const regulationsFileLabel=regulationsFile?.name?`${regulationsFile.name} (${formatBytes(regulationsFile.size)})`:"No regulations file uploaded.";
      if(el("hubRegulationsFileStatus"))el("hubRegulationsFileStatus").textContent=regulationsFileLabel;
      if(el("setupRegulationsFileStatus"))el("setupRegulationsFileStatus").textContent=regulationsFileLabel;
      const linked=!!text(meta.hubTournamentId);
      const del=!!meta.deleted;
      if(el("hubCreateBtn"))el("hubCreateBtn").disabled=busyState||linked;
      if(el("hubPublishBtn"))el("hubPublishBtn").disabled=busyState||!linked||del;
      if(el("hubPublishOnlineBtn")){
        el("hubPublishOnlineBtn").disabled=busyState||!t||del;
        el("hubPublishOnlineBtn").textContent="Publish to Hub";
        el("hubPublishOnlineBtn").title=linked?"Publish the latest tournament snapshot":"Create the public Hub record and publish the tournament";
      }
      for(const uploadId of ["hubRegulationsUploadBtn","setupRegulationsUploadBtn"]){
        const uploadButton=el(uploadId);
        if(uploadButton){
          uploadButton.disabled=busyState||!linked||del;
          uploadButton.title=!linked?"Create/link the tournament in Online Hub first":(del?"Restore the online tournament before uploading":"Upload a regulations attachment (maximum 20 MiB) and publish Regulations + Schedule automatically");
        }
      }
      if(el("pairingsHubPublishBtn")){
        el("pairingsHubPublishBtn").disabled=busyState||!t||del;
        el("pairingsHubPublishBtn").title=del?"Restore the online tournament before publishing":(linked?"Publish the latest tournament snapshot to Online Hub":"Create the public Hub record and publish the tournament");
      }
      if(el("hubOpenBtn"))el("hubOpenBtn").disabled=busyState||!publicUrl(meta)||del;
      if(el("hubDeleteBtn"))el("hubDeleteBtn").disabled=busyState||!linked||del;
      if(el("hubRestoreBtn"))el("hubRestoreBtn").disabled=busyState||!linked||!del;
    }

    async function verifyOrganizer(){
      return runBusy("Verifying organizer…",async()=>{
        const field=document.getElementById("hubOrganizerToken");
        let token=text(field?.value);
        if(!token)token=await getOrganizerToken();
        if(!token)throw new Error("Paste an Organizer Token first.");
        const result=await api.organizerMe(token);
        await window.cpNativeHubSecretSet(organizerSecretKey(),token);
        organizerTokenCache=token;
        organizerInfo=result.organizer||null;
        if(field){field.value="";field.placeholder="Saved for this installation";}
        log(`Organizer verified: ${organizerInfo?.displayName||organizerInfo?.id||"connected"}.`);
        return result;
      });
    }

    async function forgetOrganizer(){
      if(busy)return;
      await window.cpNativeHubSecretRemove(organizerSecretKey());
      organizerTokenCache="";organizerInfo=null;
      const field=document.getElementById("hubOrganizerToken");if(field){field.value="";field.placeholder="Paste Organizer Token";}
      log("Organizer credential removed from this installation.");refreshUi();
    }

    async function healthCheck(){
      return runBusy("Checking Hub API…",async()=>{
        const result=await api.health();
        const degraded=!result?.ok||result?.d1===false||result?.b2===false||result?.organizerAuth===false;
        if(degraded)throw new Error(`Hub API health check failed — D1 ${result?.d1===false?"FAIL":"OK"}, B2 ${result?.b2===false?"FAIL":"OK"}, organizer auth ${result?.organizerAuth===false?"OFF":"ON"}.`);
        log(`Hub API healthy — D1 ${result?.d1===false?"FAIL":"OK"}, B2 ${result?.b2===false?"FAIL":"OK"}, organizer auth ${result?.organizerAuth===false?"OFF":"ON"}.`);
      });
    }

    async function createOnlineTournament(){
      const tournament=currentTournament();if(!tournament)throw new Error("No tournament is open.");
      syncCurrentTournamentFromUi(tournament);
      const captured=tournament;
      return runBusy("Creating online tournament…",async()=>{
        const token=await getOrganizerToken();if(!token)throw new Error("Verify and save an Organizer Token first.");
        const meta=ensureHubMeta(captured);
        if(text(meta.hubTournamentId))throw new Error("This tournament is already linked to the Hub.");
        const snapshot=buildSnapshot(captured);
        const response=await api.createOrganizerTournament(token,createMetadataFromSnapshot(snapshot));
        const manageToken=text(response?.tournament?.manageToken);
        if(!manageToken)throw new Error("Hub did not return a tournament management credential.");
        const link=apiLib.publicLinkRecord(response);
        await window.cpNativeHubSecretSet(manageSecretKey(link.hubTournamentId),manageToken);
        saveLink(captured,link,{deleted:false,linkedAt:new Date().toISOString()});
        log(`Online tournament created: ${link.publicSlug}. Management credential stored in secure Windows storage.`);
        await publishCaptured(captured,true);
      });
    }

    async function publishCaptured(captured,fromCreate=false){
      // Every Hub snapshot publish must pass through the stable saveAll() sync
      // when the captured tournament is still the active UI tournament.
      if(currentTournament()===captured&&typeof saveAll==="function") saveAll();
      const meta=ensureHubMeta(captured);
      if(!text(meta.hubTournamentId))throw new Error("Create/link the online tournament first.");
      if(meta.deleted)throw new Error("Restore the online tournament before publishing.");
      const organizerToken=await getOrganizerToken();if(!organizerToken)throw new Error("Organizer credential is missing.");
      const manageToken=await getManageToken(meta);if(!manageToken)throw new Error("Tournament management credential is missing from this Windows profile.");
      const expectedRevision=Math.max(0,Number(meta.revision)||0);
      const snapshot=buildSnapshot(captured);
      try{
        const result=await api.publishSnapshot({organizerToken,manageToken,tournamentId:meta.hubTournamentId,expectedRevision,snapshot});
        meta.revision=Math.max(0,Number(result?.revision)||expectedRevision);
        meta.lastChecksum=text(result?.checksum)||meta.lastChecksum||null;
        meta.lastPublishedAt=new Date().toISOString();
        meta.deleted=false;
        try{saveData();}catch(_){}
        log(result?.unchanged?`Hub already matches local state at revision ${meta.revision}.`:`Published Hub revision ${meta.revision}${fromCreate?" after creation":""}.`);
        return result;
      }catch(error){
        if(error?.code==="revision_conflict"&&Number.isInteger(error.currentRevision)&&error.currentRevision>=0){
          meta.revision=error.currentRevision;try{saveData();}catch(_){}
          log(`Hub revision changed to ${error.currentRevision}; local link metadata was synchronized. Press Publish again.`,"error");
        }
        throw error;
      }
    }

    async function publishOnlineSmart(){
      const tournament=currentTournament();if(!tournament)throw new Error("No tournament is open.");
      const meta=ensureHubMeta(tournament);
      if(!text(meta.hubTournamentId))return createOnlineTournament();
      if(meta.deleted)throw new Error("Restore the online tournament before publishing.");
      return publishCurrentTournament();
    }

    async function publishCurrentTournament(){
      const tournament=currentTournament();if(!tournament)throw new Error("No tournament is open.");
      // saveAll() is the stable DOM -> tournament synchronization path. Run it
      // immediately before every user-initiated Hub publish so Setup changes,
      // Schedule rows and Additional Regulations are in the snapshot.
      syncCurrentTournamentFromUi(tournament);
      const captured=tournament;
      return runBusy("Publishing tournament snapshot…",()=>publishCaptured(captured,false));
    }

    async function uploadRegulationsFile(file,source="hub"){
      const tournament=currentTournament();if(!tournament)throw new Error("No tournament is open.");
      syncCurrentTournamentFromUi(tournament);
      const captured=tournament;
      const meta=ensureHubMeta(captured);
      if(!text(meta.hubTournamentId))throw new Error("Create/link the online tournament before uploading a regulations file.");
      if(meta.deleted)throw new Error("Restore the online tournament before uploading a regulations file.");
      if(!file)throw new Error("Choose a regulations file first.");
      const maxBytes=Number(apiLib.MAX_REGULATIONS_FILE_BYTES)||20*1024*1024;
      if(Number(file.size)>maxBytes)throw new Error("Regulations file exceeds the 20 MiB limit.");
      return runBusy("Uploading regulations file…",async()=>{
        const organizerToken=await getOrganizerToken();if(!organizerToken)throw new Error("Organizer credential is missing.");
        const manageToken=await getManageToken(meta);if(!manageToken)throw new Error("Tournament management credential is missing from this Windows profile.");
        const response=await api.uploadRegulationsFile({organizerToken,manageToken,tournamentId:meta.hubTournamentId,file});
        meta.regulationsFile=normalizeRegulationsFileMetadata(file,response);
        try{saveData();}catch(_){}
        refreshUi();
        log(`Uploaded regulations file: ${meta.regulationsFile.name} (${formatBytes(meta.regulationsFile.size)}).`);
        // The upload began from a fully synchronized tournament state. Publish
        // that captured tournament immediately, without requiring a second click.
        await publishCaptured(captured,false);
        log(`Regulations, Schedule and attachment metadata published automatically after ${source==="setup"?"Tournament Setup":"Online Hub"} upload.`);
        return response;
      });
    }

    function chooseRegulationsFile(source="hub"){
      const input=document.getElementById("hubRegulationsFileInput");
      if(!input)throw new Error("Regulations file picker is unavailable.");
      input.dataset.uploadSource=source;
      input.value="";
      input.click();
    }

    async function deleteOnlineTournament(){
      const tournament=currentTournament();if(!tournament)throw new Error("No tournament is open.");
      const captured=tournament;const meta=ensureHubMeta(captured);
      if(!text(meta.hubTournamentId))throw new Error("Tournament is not linked to the Hub.");
      let ok=true;
      if(typeof appConfirm==="function")ok=await appConfirm(`Remove “${currentTournamentName(captured)}” from the public Hub?\n\nThis is a soft delete. Snapshots are preserved and the tournament can be restored for 30 days.`,"Delete Online Tournament","warning");
      if(!ok)return;
      return runBusy("Deleting online tournament…",async()=>{
        const organizerToken=await getOrganizerToken();const manageToken=await getManageToken(meta);
        if(!organizerToken||!manageToken)throw new Error("Organizer or tournament management credential is missing.");
        const result=await api.deleteTournament({organizerToken,manageToken,tournamentId:meta.hubTournamentId,publicSlug:meta.publicSlug});
        meta.deleted=true;meta.deletedAt=result?.deletedAt||new Date().toISOString();meta.purgeAfter=result?.purgeAfter||null;
        try{saveData();}catch(_){}
        log(`Online tournament soft-deleted. Recovery window: ${result?.recoveryDays||30} days.`);
      });
    }

    async function restoreOnlineTournament(){
      const tournament=currentTournament();if(!tournament)throw new Error("No tournament is open.");
      const captured=tournament;const meta=ensureHubMeta(captured);
      return runBusy("Restoring online tournament…",async()=>{
        const organizerToken=await getOrganizerToken();const manageToken=await getManageToken(meta);
        if(!organizerToken||!manageToken)throw new Error("Organizer or tournament management credential is missing.");
        await api.restoreTournament({organizerToken,manageToken,tournamentId:meta.hubTournamentId});
        meta.deleted=false;meta.deletedAt=null;meta.purgeAfter=null;try{saveData();}catch(_){}
        log("Online tournament restored.");
      });
    }

    function openPublicTournament(){
      const meta=currentTournament()?.hub||{};const url=publicUrl(meta);if(!url)return;
      try{window.open(url,"_blank","noopener");}catch(_){location.href=url;}
    }

    async function refreshOrganizerTournaments(){
      return runBusy("Loading organizer tournaments…",async()=>{
        const token=await getOrganizerToken();if(!token)throw new Error("Verify and save an Organizer Token first.");
        const result=await api.listOrganizerTournaments(token);
        organizerInfo=result.organizer||organizerInfo;
        const body=document.getElementById("hubMyTournamentsBody");
        if(body){
          const rows=Array.isArray(result.tournaments)?result.tournaments:[];
          body.innerHTML=rows.length?rows.map(row=>{
            const url=`https://chess-publisher.org/tournaments?id=${encodeURIComponent(row.publicSlug||"")}`;
            const state=row.deleted?"Deleted":(row.isPublic?"Public":"Linked");
            return `<tr><td><b>${html(row.name)}</b><div class="muted hub-list-sub">${html(row.status||"")}</div></td><td>${Number(row.revision)||0}</td><td>${state}</td><td>${row.deleted?"—":`<a href="${attr(url)}" target="_blank" rel="noopener">Open</a>`}</td></tr>`;
          }).join(""):`<tr><td colspan="4" class="muted">No online tournaments for this organizer.</td></tr>`;
        }
        log(`Loaded ${(result.tournaments||[]).length} organizer tournament(s).`);
      });
    }

    function injectPairingsPublishButton(){
      if(document.getElementById("pairingsHubPublishBtn"))return;
      const pairings=document.getElementById("pairings");
      if(!pairings)return;
      const target=pairings.querySelector(".live-pairing-toolbar") || pairings.querySelector(".pairing-quickbar") || pairings.querySelector(".toolbar");
      if(!target)return;
      const button=document.createElement("button");
      button.id="pairingsHubPublishBtn";
      button.type="button";
      button.className="primary";
      button.textContent="Publish to Hub";
      button.addEventListener("click",()=>publishOnlineSmart().catch(()=>{}));
      target.appendChild(button);
    }

    function injectUi(){
      const tabs=document.querySelector("#appWindow .tabs");
      const content=document.querySelector("#appWindow .content");
      if(!tabs||!content)throw new Error("Chess-Publisher tab container was not found.");
      if(document.getElementById("tabHub"))return;

      const tab=document.createElement("div");
      tab.id="tabHub";tab.className="tab";tab.textContent="Online & Cloud (Beta)";
      tab.onclick=()=>showTab("hub",tab);
      tabs.appendChild(tab);

      const page=document.createElement("div");page.id="hub";page.className="page";
      page.innerHTML=`
        <div class="hub-beta-banner hub-polish-banner" title="Private Cloud Sync: Desktop ↔ Web data sync. Public Hub: Player-facing page · Publish to Hub · not private sync."><strong>Online & Cloud — Beta</strong><span>Save & Sync Web is private Desktop ↔ Web sync. Publish to Hub stays public.</span><span id="hubBusyLabel"></span></div>

        <div class="groupbox hub-section hub-account-section hub-compact-account">
          <div class="hub-section-head hub-section-head-inline"><div><div class="hub-section-eyebrow">Account</div><div class="group-title">Organizer Token</div></div><span id="hubAccountBadge" class="hub-status-pill hub-status-warn">Token required</span></div>
          <div class="hub-account-compact-row">
            <input id="hubOrganizerToken" type="password" autocomplete="off" placeholder="Paste Organizer Token" aria-label="Organizer Token">
            <button id="hubVerifyBtn" class="hub-btn primary hub-btn-account" type="button" title="Verify and save the Organizer Token for this installation">Connect / Save</button>
            <div id="hubOrganizerState" class="hub-value hub-organizer-state">Token required for Web Sync</div>
          </div>
          <div class="hub-helper-card hub-helper-safe hub-helper-compact">Connect the Organizer Token to enable Save & Sync Web and Pull Changes. It is kept in secure Windows storage, scoped to this installation, and is never written to tournament files or public Hub data.</div>
          <details class="hub-advanced"><summary>Account tools</summary><div class="toolbar hub-advanced-toolbar"><button id="hubHealthBtn" class="hub-btn hub-btn-quiet" type="button" title="Check the Online Hub API, database and snapshot storage">API Health</button><button id="hubForgetBtn" class="hub-btn hub-btn-quiet" type="button" title="Remove the saved Organizer Token from this installation">Forget on this installation</button></div></details>
        </div>

        <div id="cloudWorkspaceMount" class="hub-cloud-mount" aria-label="Private Organizer Cloud Sync"></div>

        <div class="groupbox hub-section hub-public-section hub-public-compact">
          <div class="hub-section-head hub-section-head-inline"><div><div class="hub-section-eyebrow">Public</div><div class="group-title">Public Tournament Hub</div></div><span id="hubPublicBadge" class="hub-status-pill hub-status-neutral">Not published</span></div>
          <div class="hub-public-main-row">
            <div class="hub-public-current"><span class="muted">Current</span><b id="hubCurrentTournament">—</b><span id="hubDeleted" class="muted">Not published</span></div>
            <div class="hub-actionbar-main">
              <button id="hubPublishOnlineBtn" class="hub-btn primary hub-btn-main hub-btn-publish hub-icon-publish" type="button" title="Create the public Hub record if needed, then publish the latest tournament snapshot">Publish to Hub</button>
              <button id="hubOpenBtn" class="hub-btn hub-btn-secondary hub-btn-main hub-icon-open" type="button" title="Open the public tournament page in your browser">Open Public Page</button>
            </div>
          </div>
          <div class="hub-helper-card hub-public-helper hub-helper-compact"><b>Public only.</b> similar to the Chess-Results publishing workflow; private sync stays in Save & Sync Web above.</div>
          <details class="hub-advanced hub-public-tools"><summary>Public Hub options & details</summary>
            <div class="hub-kv-grid">
              <strong>Public slug</strong><span id="hubPublicSlug">—</span>
              <strong>Regulations file</strong><span id="hubRegulationsFileStatus">No regulations file uploaded.</span>
              <strong>Internal tournament ID</strong><span id="hubLocalKey">Not initialized</span>
              <strong>Hub Tournament ID</strong><span id="hubTournamentId">Not linked</span>
              <strong>Public revision</strong><span id="hubRevision">0</span>
            </div>
            <div class="hub-regulations-upload">
              <button id="hubRegulationsUploadBtn" class="hub-btn hub-btn-secondary hub-icon-upload" type="button" title="Upload one regulations attachment (maximum 20 MiB)">Upload Regulations</button>
              <span class="muted">Regulations + Schedule + attachment metadata are published automatically.</span>
            </div>
            <div class="toolbar hub-advanced-toolbar">
              <button id="hubCreateBtn" class="hub-btn hub-btn-secondary" type="button" title="Create a new Online Hub record without changing the public workflow">Create / Link Only</button>
              <button id="hubPublishBtn" class="hub-btn hub-btn-secondary" type="button" title="Publish the latest tournament snapshot to the Online Hub">Publish Snapshot</button>
              <button id="hubRestoreBtn" class="hub-btn hub-btn-restore hub-icon-restore" type="button" title="Restore a soft-deleted tournament during the recovery window">Restore</button>
              <button id="hubDeleteBtn" class="hub-btn danger hub-btn-danger hub-icon-delete" type="button" title="Soft-delete the tournament from the public Hub; snapshots are preserved during recovery">Soft Delete</button>
            </div>
          </details>
        </div>

        <div class="groupbox hub-online-list-compact">
          <div class="hub-section-head hub-section-head-inline"><div><div class="hub-section-eyebrow">Public list</div><div class="group-title">My Online Tournaments</div></div><button id="hubRefreshListBtn" class="hub-btn hub-btn-quiet hub-icon-refresh" type="button" title="Reload tournaments owned by the connected organizer">Refresh</button></div>
          <div class="table-frame hub-table-frame hub-table-frame-compact"><table><thead><tr><th>Name</th><th>Rev.</th><th>State</th><th>Open</th></tr></thead><tbody id="hubMyTournamentsBody"><tr><td colspan="4" class="muted">Connect the Organizer Token to load tournaments.</td></tr></tbody></table></div>
        </div>

        <details class="groupbox hub-log-details"><summary>Public Hub Activity Log / Diagnostics</summary><textarea id="hubLog" class="full" readonly></textarea></details>`
      content.appendChild(page);

      const style=document.createElement("style");style.id="cpHubBetaStyle";style.textContent=`
        #tabHub{font-weight:bold}
        .hub-beta-banner{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:7px 9px;margin-bottom:8px;background:#eaf4ff;border:1px solid #82a9cf}
        .hub-beta-banner>span:last-child{margin-left:auto;font-weight:bold;color:#0a246a}
        .hub-account-grid{display:grid;grid-template-columns:140px minmax(260px,1fr) auto auto;gap:6px;align-items:center}
        .hub-account-grid label{font-weight:bold}.hub-value{min-height:28px;padding:5px 8px;background:var(--cp-surface-alt,#f3f3f3);border:1px solid var(--cp-border,#d8d8d8);border-radius:5px;display:flex;align-items:center}
        .hub-note{margin-top:7px}.hub-kv-grid{display:grid;grid-template-columns:150px minmax(280px,1fr);gap:5px 9px;align-items:center}.hub-kv-grid span{font-family:Consolas,"Courier New",monospace;overflow-wrap:anywhere}

        #hub .hub-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:32px;padding:5px 12px;border-radius:6px!important;font-weight:600;line-height:1.2;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.06);transition:background-color .15s ease,border-color .15s ease,box-shadow .15s ease,transform .08s ease}
        #hub .hub-btn:hover:not(:disabled){box-shadow:0 2px 5px rgba(0,0,0,.09)}
        #hub .hub-btn:active:not(:disabled){transform:translateY(1px);box-shadow:0 1px 2px rgba(0,0,0,.05)}
        #hub .hub-btn:focus-visible{outline:2px solid var(--cp-accent,#0f6cbd);outline-offset:2px}
        #hub .hub-btn:disabled{box-shadow:none;transform:none;opacity:.46}
        #hub .hub-btn::before{display:inline-flex;align-items:center;justify-content:center;width:14px;min-width:14px;font-size:15px;font-weight:700;line-height:1;color:currentColor}
        #hub .hub-btn-secondary{background:var(--cp-surface,#fff);border-color:var(--cp-border-strong,#b8b8b8);color:var(--cp-text,#202020)}
        #hub .hub-btn-secondary:hover:not(:disabled),#hub .hub-btn-quiet:hover:not(:disabled){background:var(--cp-surface-hover,#f3f3f3);border-color:rgba(0,0,0,.28)}
        #hub .hub-btn-quiet{background:var(--cp-surface-alt,#f6f6f6);border-color:var(--cp-border,#d8d8d8);color:var(--cp-text,#303030);box-shadow:none}
        #hub .hub-btn-account{min-width:142px}
        #hub .hub-btn-main{min-width:150px}
        #hub .hub-btn-publish{min-width:156px}
        #hub .hub-btn-danger{background:#fff;color:var(--cp-danger,#c42b1c);border-color:rgba(196,43,28,.34);box-shadow:none}
        #hub .hub-btn-danger:hover:not(:disabled){background:var(--cp-danger-soft,#fde7e9);border-color:rgba(196,43,28,.48)}
        #hub .hub-btn-restore{background:#fff;color:#107c10;border-color:rgba(16,124,16,.34);box-shadow:none}
        #hub .hub-btn-restore:hover:not(:disabled){background:#f0f8f0;border-color:rgba(16,124,16,.48)}
        #hubVerifyBtn::before{content:"✓"}
        #hubForgetBtn::before{content:"×";font-size:17px}
        #hubHealthBtn::before{content:"●";font-size:10px;color:#107c10}
        #hubCreateBtn::before{content:"+";font-size:18px}
        #hubPublishBtn::before{content:"↑"}
        #hubOpenBtn::before{content:"↗"}
        #hubDeleteBtn::before{content:"×";font-size:17px}
        #hubRestoreBtn::before{content:"↶"}
        #hubRefreshListBtn::before{content:"↻"}
        #hubRegulationsUploadBtn::before{content:"↑"}

        .hub-regulations-upload{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:10px;padding-top:9px;border-top:1px solid var(--cp-border,#dedede)}
        .hub-actionbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:11px;padding-top:10px;border-top:1px solid var(--cp-border,#dedede)}
        .hub-actionbar-main,.hub-actionbar-manage{display:flex;align-items:center;flex-wrap:wrap;gap:7px}
        .hub-actionbar-manage{margin-left:auto;padding-left:12px;border-left:1px solid var(--cp-border,#dedede)}
        .hub-list-toolbar{margin-top:2px;margin-bottom:8px}.hub-advanced{margin-top:8px}.hub-advanced>summary,.hub-log-details>summary{cursor:pointer;font-weight:700}.hub-advanced[open]>summary,.hub-log-details[open]>summary{margin-bottom:8px}.hub-advanced-toolbar{display:flex;gap:7px;flex-wrap:wrap}.hub-actionbar-simple{justify-content:flex-start}.hub-public-tools{padding-top:7px}
        .hub-table-frame{min-height:120px;max-height:190px}.hub-table-frame a{color:#0645ad}.hub-table-frame tr:hover a{color:#fff}
        #hubLog{height:110px;resize:vertical;font-family:Consolas,"Courier New",monospace;font-size:11px}

        .hub-section{position:relative}.hub-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px}.hub-section-head .group-title{margin:0}.hub-section-eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#5f6b76;font-weight:800;margin-bottom:2px}.hub-status-pill{display:inline-flex;align-items:center;justify-content:center;min-height:22px;padding:3px 9px;border-radius:999px;border:1px solid #ccd4dc;background:#f6f8fa;color:#4d5965;font-size:11px;font-weight:800;white-space:nowrap}.hub-status-ok{background:#edf7ed;border-color:#9fd29f;color:#107c10}.hub-status-warn{background:#fff8e5;border-color:#e4c86d;color:#8a5a00}.hub-status-neutral{background:#f4f6f8;border-color:#c9d2dc;color:#4c5966}.hub-helper-card{margin:0 0 9px 0;padding:7px 9px;border:1px solid var(--cp-border,#d8dde2);border-radius:6px;background:#fbfcfd;color:#4f5862;font-size:11px;line-height:15px}.hub-helper-safe{background:#f7fbff;border-color:#bdd7ee}.hub-public-helper{border-left:3px solid #0f6cbd}.hub-cloud-mount{margin-top:8px;margin-bottom:8px}.hub-account-grid-polished input[type=password]{min-height:30px}.hub-polish-banner strong{font-size:13px}.hub-mode-strip{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:8px;margin:-1px 0 8px}.hub-mode-card{border:1px solid var(--cp-border,#d8dde2);border-radius:8px;background:#fff;padding:8px 10px;min-width:0}.hub-mode-card b{display:block;font-size:12px;margin-bottom:2px}.hub-mode-card span{display:block;font-size:11px;line-height:15px;color:#4f5862}.hub-mode-private{background:#f7fbff;border-color:#bdd7ee}.hub-mode-public{background:#fffdf7;border-color:#ead9a0}.hub-mode-local{background:#fbfcfd}

        .hub-compact-account,.hub-public-compact,.hub-online-list-compact{padding:9px 10px}.hub-section-head-inline{align-items:center;margin-bottom:6px}.hub-account-compact-row{display:grid;grid-template-columns:minmax(260px,1fr) auto minmax(190px,.7fr);gap:7px;align-items:center}.hub-organizer-state{min-height:32px}.hub-helper-compact{padding:6px 8px;margin:6px 0 0;font-size:11px;line-height:14px}.hub-public-main-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.hub-public-current{display:flex;align-items:baseline;gap:7px;min-width:0}.hub-public-current b{max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hub-table-frame-compact{min-height:92px;max-height:190px}.hub-table-frame-compact th,.hub-table-frame-compact td{padding-top:5px;padding-bottom:5px}.hub-list-sub{font-size:10px;margin-top:1px}.hub-online-list-compact{margin-top:8px}.hub-public-tools .hub-kv-grid{margin:8px 0}.hub-account-section details,.hub-public-section details{margin-top:5px}
        @media(max-width:980px){.hub-account-grid,.hub-account-compact-row{grid-template-columns:1fr}.hub-kv-grid{grid-template-columns:1fr}.hub-actionbar{align-items:stretch;flex-direction:column}.hub-actionbar-main,.hub-actionbar-manage{width:100%}.hub-actionbar-manage{margin-left:0;padding-left:0;padding-top:8px;border-left:0;border-top:1px solid var(--cp-border,#dedede)}#hub .hub-btn-main{flex:1 1 180px}.hub-section-head{flex-direction:column}.hub-status-pill{align-self:flex-start}.hub-mode-strip{grid-template-columns:1fr}}
      `;document.head.appendChild(style);
      injectPairingsPublishButton();

      document.getElementById("hubVerifyBtn").addEventListener("click",()=>verifyOrganizer().catch(()=>{}));
      document.getElementById("hubForgetBtn").addEventListener("click",()=>forgetOrganizer().catch(error=>log(describeError(error),"error")));
      document.getElementById("hubHealthBtn").addEventListener("click",()=>healthCheck().catch(()=>{}));
      document.getElementById("hubCreateBtn").addEventListener("click",()=>createOnlineTournament().catch(()=>{}));
      document.getElementById("hubPublishOnlineBtn").addEventListener("click",()=>publishOnlineSmart().catch(()=>{}));
      document.getElementById("hubPublishBtn").addEventListener("click",()=>publishCurrentTournament().catch(()=>{}));
      document.getElementById("hubRegulationsUploadBtn").addEventListener("click",()=>chooseRegulationsFile("hub"));
      const setupUploadButton=document.getElementById("setupRegulationsUploadBtn");
      if(setupUploadButton)setupUploadButton.addEventListener("click",()=>chooseRegulationsFile("setup"));
      const regulationsFileInput=document.getElementById("hubRegulationsFileInput");
      if(regulationsFileInput)regulationsFileInput.addEventListener("change",()=>{
        const file=regulationsFileInput.files?.[0];
        const source=regulationsFileInput.dataset.uploadSource||"hub";
        if(file)uploadRegulationsFile(file,source).catch(()=>{});
      });
      document.getElementById("hubOpenBtn").addEventListener("click",openPublicTournament);
      document.getElementById("hubDeleteBtn").addEventListener("click",()=>deleteOnlineTournament().catch(()=>{}));
      document.getElementById("hubRestoreBtn").addEventListener("click",()=>restoreOnlineTournament().catch(()=>{}));
      document.getElementById("hubRefreshListBtn").addEventListener("click",()=>refreshOrganizerTournaments().catch(()=>{}));

      const originalShowTab=window.showTab;
      if(typeof originalShowTab==="function"&&!originalShowTab.__cpHubWrapped){
        const wrapped=function(id,button){
          const result=originalShowTab.apply(this,arguments);
          if(id==="hub")setTimeout(async()=>{
            refreshUi();
            try{
              organizerTokenCache="";
              const token=await getOrganizerToken();
              if(token)await refreshOrganizerTournaments();
            }catch(error){console.warn("Online & Cloud auto-load:",error);refreshUi();}
          },0);
          return result;
        };
        wrapped.__cpHubWrapped=true;window.showTab=wrapped;
      }

      for(const selectorId of ["mainTournamentSelect","registrationTournamentSelect","pairingsTournamentSelect","chessResultsTournamentSelect","standingsTournamentSelect","scheduleTournamentSelect","exportTournamentSelect"]){
        document.getElementById(selectorId)?.addEventListener("change",()=>setTimeout(refreshUi,0));
      }
      refreshUi();
      window.cpHubRefreshUi=refreshUi;
      window.cpHubPublishCurrentTournament=publishCurrentTournament;
      window.cpHubChooseRegulationsFile=chooseRegulationsFile;
      log("Online Hub public publishing module loaded. Publish to Hub remains explicit and separate from private sync.");
    }

    injectUi();
  }catch(error){
    console.error("Chess-Publisher Hub adapter:",error);
  }
})();
