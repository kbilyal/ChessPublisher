(()=>{
  "use strict";

  try{
    if(window.__cpCloudWorkspaceAdapterLoaded)return;
    window.__cpCloudWorkspaceAdapterLoaded=true;

    const CLIENT_VERSION="1.06.00-beta.10";
    const FINGERPRINT_CONTENT_SCHEMA=7;
    const WEB_APP_URL="https://web.chess-publisher.org/";
    const ORGANIZER_SECRET_BASE_KEY="organizer-primary";
    const INSTALL_SCOPE_STORAGE_KEY="ChessPublisherOnline_InstallScope_v1";
    const AUTO_SYNC_KEY="ChessPublisherCloudWorkspace_AutoSync_v1";
    const DEVICE_ID_KEY="ChessPublisherCloudWorkspace_DeviceId_v1";
    const DEVICE_LABEL_KEY="ChessPublisherCloudWorkspace_DeviceLabel_v1";
    const apiLib=window.ChessPublisherCloudWorkspaceApi;
    if(!apiLib)throw new Error("Cloud Workspace API client module is unavailable.");
    const WIRE_CLIENT_VERSION=String(document.documentElement?.dataset?.chesspublisherVersion||CLIENT_VERSION).trim()||CLIENT_VERSION;
    // beta.96 Windows SYNC runtime hotfix: every legacy Cloud Workspace call
    // uses the same-origin LocalEngine proxy in Desktop WebView. Production Web
    // keeps the API client's normal remote Worker base.
    const desktopCloudProxyBase=(()=>{
      try{
        const u=new URL(window.location.href);
        if(u.protocol==="http:"&&(u.hostname==="127.0.0.1"||u.hostname==="localhost"))return `${u.origin}/cloud-proxy`;
      }catch(_){ }
      return "";
    })();
    const api=apiLib.createClient({clientVersion:WIRE_CLIENT_VERSION,...(desktopCloudProxyBase?{baseUrl:desktopCloudProxyBase}:{})});

    const text=v=>v==null?"":String(v).trim();
    const clone=v=>JSON.parse(JSON.stringify(v));
    function installationScope(){
      let scope="";try{scope=text(localStorage.getItem(INSTALL_SCOPE_STORAGE_KEY));}catch(_){ }
      if(!scope){scope=`install:${uuid()}`;try{localStorage.setItem(INSTALL_SCOPE_STORAGE_KEY,scope);}catch(_){ }}
      return scope;
    }
    function organizerSecretKey(){
      try{if(typeof window.cpOnlineOrganizerSecretKey==="function")return window.cpOnlineOrganizerSecretKey();}catch(_){ }
      return `${ORGANIZER_SECRET_BASE_KEY}:${installationScope()}`;
    }
    const esc=v=>text(v).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const runtimeState=new Map();

    let tokenCache="";
    let organizerInfo=null;
    let workspaceInfo=null;
    let settingsRevision=0;
    let settingsChecksum="";
    let settingsLastSyncedAt="";
    let settingsSyncTimer=null;
    let syncChain=Promise.resolve();
    let foregroundBusy=0;
    let cloudList=[];
    let lastPersistenceSignature="";
    let autoSyncTimer=null;
    let monitorTimer=null;
    let startupSweepDone=false;
    let suppressAutoSync=0;

    function autoSyncEnabled(){
      // Desktop/Web continuity is automatic by default. A new installation or
      // browser profile starts with Cloud backup enabled; an explicit user
      // opt-out ("0") is still respected. This ensures newly created/opened
      // desktop tournaments become visible in Web without a separate manual sync.
      try{return localStorage.getItem(AUTO_SYNC_KEY)!=="0";}catch(_){return true;}
    }
    function setAutoSyncEnabled(enabled){
      try{localStorage.setItem(AUTO_SYNC_KEY,enabled?"1":"0");}catch(_){ }
      const input=document.getElementById("cloudAutoSync");if(input)input.checked=!!enabled;
    }
    function uuid(){return globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;}
    function deviceId(){
      let value="";try{value=text(localStorage.getItem(DEVICE_ID_KEY));}catch(_){ }
      if(!value){value=`device:${uuid()}`;try{localStorage.setItem(DEVICE_ID_KEY,value);}catch(_){ }}
      return value;
    }
    function deviceLabel(){
      let value="";try{value=text(localStorage.getItem(DEVICE_LABEL_KEY));}catch(_){ }
      if(value)return value;
      const platform=text(navigator.userAgentData?.platform||navigator.platform)||"Windows";
      value=`${platform} PC`;
      try{localStorage.setItem(DEVICE_LABEL_KEY,value);}catch(_){ }
      return value;
    }
    function setDeviceLabel(value){
      const label=text(value).slice(0,160)||"Windows PC";
      try{localStorage.setItem(DEVICE_LABEL_KEY,label);}catch(_){ }
      return label;
    }

    function currentTournament(){try{return typeof getCurrentTournament==="function"?getCurrentTournament():null;}catch(_){return null;}}
    function currentName(){return text(data?.currentTournament);}
    function findNameByTournament(tournament){
      try{for(const [name,value] of Object.entries(data?.tournaments||{}))if(value===tournament)return name;}catch(_){ }
      return "";
    }

    function ensureCloudMeta(tournament){
      if(!tournament||typeof tournament!=="object")throw new Error("No tournament is open.");
      if(!tournament.cloud||typeof tournament.cloud!=="object"||Array.isArray(tournament.cloud))tournament.cloud={};
      const meta=tournament.cloud;
      if(!text(meta.localKey))meta.localKey=`cp-cloud:${uuid()}`;
      // internalId is the logical tournament identity shared by this PC and the
      // organizer's private cloud object. It is NOT an authorization key and is
      // deliberately separate from the installation-local localKey.
      if(!text(meta.internalId)){
        // Preserve beta.1-beta.3 linked identities first: their remote localKey
        // was the installation localKey. For a genuinely unlinked tournament,
        // use the same durable identity candidates as the current React/Vite Web
        // Companion before generating a new UUID. This is what lets one event
        // continue Desktop -> Web -> Desktop without manufacturing a second row.
        const sharedCandidate=text(tournament?.online?.hubTournamentId)||text(tournament?.hub?.tournamentId)||text(tournament?.publication?.hubTournamentId)||text(tournament?.hub?.localKey);
        meta.internalId=text(meta.cloudTournamentId)?meta.localKey:(sharedCandidate||`cp-tournament:${uuid()}`);
      }
      const storedFingerprintSchema=Math.max(0,Number(meta.fingerprintContentSchema)||0);
      const previousDesktopFingerprint=text(meta.lastSyncedContentHash).toLowerCase();
      const previousWebFingerprint=text(meta.baseFingerprint).toLowerCase();
      meta.schemaVersion=4;
      meta.internalId=text(meta.internalId);
      meta.cloudTournamentId=text(meta.cloudTournamentId);
      meta.ownerId=text(meta.ownerId);
      meta.revision=Math.max(0,Number(meta.revision ?? meta.baseRevision)||0);
      meta.baseRevision=Math.max(0,Number(meta.baseRevision ?? meta.revision)||0);
      meta.lastSyncedAt=text(meta.lastSyncedAt||meta.lastSyncAt);
      meta.lastSyncAt=text(meta.lastSyncAt||meta.lastSyncedAt);
      meta.lastSyncedHash=text(meta.lastSyncedHash).toLowerCase();

      // A common-base fingerprint is valid ONLY when it was produced by the
      // current Web/Desktop content projection (schema 7). Older or unqualified
      // hashes are never reused as the three-way base; they are reconstructed
      // from the immutable baseRevision during reconciliation.
      if(storedFingerprintSchema===FINGERPRINT_CONTENT_SCHEMA){
        const compatibleFingerprint=previousWebFingerprint||previousDesktopFingerprint;
        meta.lastSyncedContentHash=compatibleFingerprint;
        meta.baseFingerprint=compatibleFingerprint;
        meta.fingerprintContentSchema=FINGERPRINT_CONTENT_SCHEMA;
      }else{
        meta.lastSyncedContentHash="";
        meta.baseFingerprint="";
      }
      return meta;
    }

    function storedBaseFingerprint(meta){
      if(Math.max(0,Number(meta?.fingerprintContentSchema)||0)!==FINGERPRINT_CONTENT_SCHEMA)return "";
      return text(meta?.baseFingerprint||meta?.lastSyncedContentHash).toLowerCase();
    }

    function captureCommonBase(meta){
      const out={};
      for(const key of ["baseRevision","revision","baseFingerprint","lastSyncedContentHash","fingerprintContentSchema","lastSyncedHash","lastSyncedAt","lastSyncAt","cloudTournamentId","internalId"]){
        out[key]=meta?.[key];
      }
      return out;
    }

    function restoreCommonBase(meta,before){
      if(!meta||!before)return meta;
      for(const key of Object.keys(before)){
        if(before[key]===undefined)delete meta[key];
        else meta[key]=before[key];
      }
      return meta;
    }

    async function persistCurrentSyncBaseDurably(tournament,before,message){
      if(tournament!==currentTournament()){
        // Background/non-current sweeps cannot prove a managed-file checkpoint
        // for another tournament through fileSaveTournament(). Keep their base
        // metadata in memory only; the tournament will establish it when opened.
        return false;
      }
      if(typeof fileSaveTournament!=="function"){
        restoreCommonBase(ensureCloudMeta(tournament),before);
        throw new Error(message||"Managed tournament file save is unavailable.");
      }
      const saved=await fileSaveTournament(true);
      if(!saved){
        restoreCommonBase(ensureCloudMeta(tournament),before);
        throw new Error(message||"Managed tournament file checkpoint failed.");
      }
      return true;
    }

    function runtimeKey(name,tournament){
      const meta=tournament?.cloud;
      return text(meta?.cloudTournamentId)||text(meta?.localKey)||`name:${name}`;
    }
    function setRuntime(name,tournament,state,message=""){
      runtimeState.set(runtimeKey(name,tournament),{state,message,at:new Date().toISOString()});
      if(name===currentName())renderCurrent();
    }
    function getRuntime(name,tournament){return runtimeState.get(runtimeKey(name,tournament))||null;}

    async function getOrganizerToken(){
      if(tokenCache)return tokenCache;
      if(typeof window.cpNativeHubSecretGet!=="function")return "";
      tokenCache=text(await window.cpNativeHubSecretGet(organizerSecretKey()));
      return tokenCache;
    }

    async function refreshOrganizer({quiet=false}={}){
      const token=await getOrganizerToken();
      if(!token){organizerInfo=null;workspaceInfo=null;renderAccount();return null;}
      try{
        const result=await api.workspace(token);
        organizerInfo=result?.organizer||null;
        workspaceInfo=result||null;
        try{await pullOrganizerSettings({quiet:true,apply:true});}catch(_){ }
        renderAccount();
        return organizerInfo;
      }catch(error){
        organizerInfo=null;workspaceInfo=null;
        renderAccount(error);
        if(!quiet)throw error;
        return null;
      }
    }

    function portableOrganizerSettings(){
      const prefs=clone(data?.preferences||{});
      // These are device/UI/hardware state rather than portable organizer preferences.
      for(const key of Object.keys(prefs)){
        if(key==="activeTab"||key==="dgtExpectedBoards"||/^(?:device|window|path|dgt)/i.test(key))delete prefs[key];
      }
      const tg=clone(telegramGlobal||{});
      delete tg.token;
      return {schemaVersion:1,preferences:prefs,telegramGlobal:tg};
    }

    function applyPortableOrganizerSettings(settings){
      if(!settings||typeof settings!=="object")return false;
      let changed=false;
      if(settings.preferences&&typeof settings.preferences==="object"&&!Array.isArray(settings.preferences)){
        const localOnly={activeTab:data?.preferences?.activeTab,dgtExpectedBoards:data?.preferences?.dgtExpectedBoards};
        data.preferences={...(data.preferences||{}),...clone(settings.preferences)};
        for(const [k,v] of Object.entries(localOnly))if(v!==undefined)data.preferences[k]=v;
        changed=true;
      }
      if(settings.telegramGlobal&&typeof settings.telegramGlobal==="object"&&!Array.isArray(settings.telegramGlobal)){
        const localToken=text(telegramGlobal?.token);
        telegramGlobal={...(telegramGlobal||{}),...clone(settings.telegramGlobal),token:localToken};
        changed=true;
      }
      if(changed){
        try{if(typeof saveData==="function")saveData();}catch(_){ }
        try{if(typeof saveTelegramGlobal==="function")saveTelegramGlobal();}catch(_){ }
        try{if(typeof loadAllFields==="function")loadAllFields();}catch(_){ }
      }
      return changed;
    }

    async function pullOrganizerSettings({quiet=false,apply=true}={}){
      const token=await getOrganizerToken();if(!token)return null;
      try{
        const result=await api.getSettings(token);
        settingsRevision=Math.max(0,Number(result?.revision)||0);
        settingsChecksum=text(result?.checksum).toLowerCase();
        settingsLastSyncedAt=text(result?.updatedAt);
        if(apply&&result?.settings)applyPortableOrganizerSettings(result.settings);
        return result;
      }catch(error){if(!quiet)throw error;console.warn("Cloud settings pull:",error);return null;}
    }

    async function pushOrganizerSettings({quiet=false,force=false}={}){
      const token=await getOrganizerToken();if(!token)return {skipped:true,noToken:true};
      try{
        const settings=portableOrganizerSettings();
        const checksum=await sha256Json(settings);
        if(!force&&settingsChecksum&&settingsChecksum===checksum)return {ok:true,unchanged:true,revision:settingsRevision};
        const result=await api.putSettings(token,{baseRevision:settingsRevision,settings,deviceId:deviceId(),deviceLabel:deviceLabel()});
        settingsRevision=Math.max(0,Number(result?.revision)||settingsRevision);
        settingsChecksum=text(result?.checksum||checksum).toLowerCase();
        settingsLastSyncedAt=text(result?.updatedAt)||new Date().toISOString();
        return result;
      }catch(error){
        if(error?.code==="cloud_settings_revision_conflict"){
          const remote=await pullOrganizerSettings({quiet:true,apply:true});
          if(!quiet)throw error;
          return {ok:false,conflict:true,remote};
        }
        if(!quiet)throw error;console.warn("Cloud settings push:",error);return {ok:false,error};
      }
    }

    function scheduleSettingsSync(delayMs=1800){
      clearTimeout(settingsSyncTimer);
      settingsSyncTimer=setTimeout(()=>pushOrganizerSettings({quiet:true}).catch(error=>console.warn("Cloud settings autosync:",error)),Math.max(800,delayMs));
    }

    const INSTALLATION_LOCAL_KEYS=new Set([
      "organizertoken","managetoken","managekey","admintoken","authtoken","accesstoken","refreshtoken","devicetoken",
      "password","secret","devicesecret","aeskey","aes","iv","filepath","folderpath","installationpath","windowspath",
      "linuxpath","executablepath","workingdirectory","serialport","usbpath","dgtport",
      // beta.96 SYNC freeze repair: checker provenance is runtime/UI metadata.
      // beta.95 accidentally persisted these keys under pairings.engine, which
      // made a checker run change the schema-7 tournament fingerprint and could
      // force false Desktop/Cloud conflicts. Treat them as installation-local
      // and strip them from both fingerprints and uploaded cloud snapshots.
      "lastcheckeruisource","lastcheckeruibuildversion","lastcheckeruicheckedat",
      // Preserve the Desktop-only account/session sanitization that predates
      // Web schema 7.
      "connectedorganizer","organizeraccount","organizersession","accountsession","authsession",
      "cloudworkspaceaccount","currentaccount","currentorganizeraccount"
    ]);
    const VOLATILE_SYNC_KEYS=new Set([
      "updatedat","lastviewedat","lastaccess","requesttimestamp","requesttimestamps",
      "cachetimestamp","cachetimestamps","generatedat","serverprocessingmetadata",
      "processingmetadata","browserstate","browserdata","sessionstate","sessiondata"
    ]);

    function sanitizePortableValue(value){
      if(Array.isArray(value))return value.map(sanitizePortableValue);
      if(!value||typeof value!=="object")return value;
      const out={};
      for(const [key,item] of Object.entries(value)){
        if(INSTALLATION_LOCAL_KEYS.has(String(key).toLowerCase()))continue;
        out[key]=sanitizePortableValue(item);
      }
      return out;
    }

    function stripVolatileSyncMetadata(value){
      if(Array.isArray(value))return value.map(stripVolatileSyncMetadata);
      if(!value||typeof value!=="object")return value;
      const out={};
      for(const [key,item] of Object.entries(value)){
        if(VOLATILE_SYNC_KEYS.has(String(key).toLowerCase()))continue;
        out[key]=stripVolatileSyncMetadata(item);
      }
      return out;
    }

    function sanitizeDownloadedTournament(tournament){
      const one=stripVolatileSyncMetadata(sanitizePortableValue(clone(tournament||{})));
      // Private-cloud linkage belongs to the local installation/session and is
      // rebuilt below. Keep only the non-secret logical internalId long enough
      // for cross-device/browser identity recovery; all revision/local fields
      // are rebuilt from the token-scoped cloud record.
      const portableInternalId=text(one?.cloud?.internalId);
      delete one.cloud;
      if(portableInternalId)one.cloud={schemaVersion:4,internalId:portableInternalId};
      delete one.cloudWorkspace;
      delete one.deviceId;
      delete one.deviceLabel;
      return one;
    }

    function tournamentContentForFingerprint(tournament){
      // Exact Web schema-7 reference projection.
      const one=stripVolatileSyncMetadata(sanitizePortableValue(clone(tournament||{})));
      delete one.cloud;
      delete one.online;
      delete one.hub;
      delete one.publication;
      delete one.savedAt;
      delete one.dgt;
      delete one.uiState;
      delete one.runtimeState;
      if(one.telegram&&typeof one.telegram==="object"){
        delete one.telegram.token;
        delete one.telegram.botToken;
      }
      return one;
    }

    function canonicalValue(value){
      if(Array.isArray(value))return value.map(canonicalValue);
      if(!value||typeof value!=="object")return value;
      const out={};
      for(const key of Object.keys(value).sort()){
        if(value[key]!==undefined)out[key]=canonicalValue(value[key]);
      }
      return out;
    }

    function tournamentContentObject(name,tournament){
      const one=tournamentContentForFingerprint(tournament);
      // Web fingerprints the tournament object itself. The local display name
      // lives inside the tournament and must not create a platform-only hash.
      return canonicalValue(one);
    }

    async function tournamentContentHash(name,tournament){
      return sha256Json(tournamentContentObject(name,tournament));
    }

    function snapshotTournament(snapshot){
      const sourceName=text(snapshot?.data?.currentTournament||snapshot?.currentTournament);
      const sourceTournament=snapshot?.data?.tournaments?.[sourceName];
      if(!sourceName||!sourceTournament)throw new Error("Cloud snapshot does not contain its tournament.");
      return {name:sourceName,tournament:sourceTournament};
    }

    async function snapshotContentHash(snapshot){
      const source=snapshotTournament(snapshot);
      return tournamentContentHash(source.name,source.tournament);
    }

    function decideReconciliation({localHash,baseHash,remoteHash,localRevision=0,remoteRevision=0}={}){
      localHash=text(localHash).toLowerCase();baseHash=text(baseHash).toLowerCase();remoteHash=text(remoteHash).toLowerCase();
      localRevision=Math.max(0,Number(localRevision)||0);remoteRevision=Math.max(0,Number(remoteRevision)||0);
      if(remoteRevision<localRevision)return "remote-behind";
      if(localHash&&remoteHash&&localHash===remoteHash)return "converged";
      if(!baseHash)return "conflict";
      const localChanged=localHash!==baseHash;
      const remoteChanged=remoteHash!==baseHash;
      if(!localChanged&&!remoteChanged)return remoteRevision>localRevision?"advance":"converged";
      if(!localChanged&&remoteChanged)return "pull";
      if(localChanged&&!remoteChanged)return "push";
      return "conflict";
    }

    function cloudScopedSnapshot(name,tournament){
      if(!name||!tournament)throw new Error("Tournament snapshot is unavailable.");
      const base=typeof getPersistentSnapshot==="function"?getPersistentSnapshot():null;
      if(!base)throw new Error("Persistent tournament snapshot is unavailable.");
      const safe=typeof cpSnapshotForExternalFile==="function"?cpSnapshotForExternalFile(base):clone(base);
      const one=sanitizeDownloadedTournament(tournament);
      // schema v4 carries only the stable, non-secret logical identity. The
      // installation localKey, owner, revision and fingerprint never travel.
      const portableMeta=ensureCloudMeta(tournament);
      one.cloud={schemaVersion:4,internalId:portableMeta.internalId};
      if(text(portableMeta.cloudTournamentId))one.cloud.cloudTournamentId=text(portableMeta.cloudTournamentId);
      safe.data={currentTournament:name,tournaments:{[name]:one},preferences:{}};
      safe.currentTournament=name;
      safe.preferences={};
      // savedAt is a local persistence timestamp, not tournament content. Beta.2
      // included it in the cloud snapshot, which made an unchanged tournament
      // hash differently on every sync and could create revision churn.
      delete safe.savedAt;
      // Device-global Telegram settings are not part of a tournament backup.
      safe.telegramGlobal={};
      safe.cloudWorkspace={schemaVersion:5,scope:"single-tournament",private:true,internalId:portableMeta.internalId,fingerprintContentSchema:FINGERPRINT_CONTENT_SCHEMA,clientVersion:CLIENT_VERSION};
      if(text(portableMeta.cloudTournamentId))safe.cloudWorkspace.cloudTournamentId=text(portableMeta.cloudTournamentId);
      return sanitizePortableValue(safe);
    }

    async function sha256Json(value){
      const bytes=new TextEncoder().encode(JSON.stringify(value));
      const digest=await crypto.subtle.digest("SHA-256",bytes);
      return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
    }

    function updateSyncBase(meta,{revision,contentHash,checksum,updatedAt,cloudTournamentId,internalId}={}){
      const rev=Math.max(0,Number(revision ?? meta.revision ?? meta.baseRevision)||0);
      const fp=text(contentHash ?? meta.lastSyncedContentHash ?? meta.baseFingerprint).toLowerCase();
      const at=text(updatedAt)||meta.lastSyncedAt||meta.lastSyncAt||new Date().toISOString();
      meta.schemaVersion=4;
      meta.revision=rev;meta.baseRevision=rev;
      meta.lastSyncedContentHash=fp;meta.baseFingerprint=fp;
      meta.fingerprintContentSchema=FINGERPRINT_CONTENT_SCHEMA;
      meta.lastSyncedAt=at;meta.lastSyncAt=at;
      if(checksum!==undefined)meta.lastSyncedHash=text(checksum).toLowerCase();
      if(cloudTournamentId!==undefined&&text(cloudTournamentId))meta.cloudTournamentId=text(cloudTournamentId);
      if(internalId!==undefined&&text(internalId))meta.internalId=text(internalId);
      return meta;
    }

    function historicalSnapshotFromResponse(response){
      const candidates=[response?.snapshot,response?.revision?.snapshot,response?.data?.snapshot,response?.result?.snapshot];
      for(const candidate of candidates)if(candidate&&typeof candidate==="object")return candidate;
      return null;
    }
    function revisionRowNumber(row){return Math.max(0,Number(row?.revision??row?.number??row?.rev)||0);}
    function revisionRowChecksum(row){return text(row?.checksum??row?.snapshotChecksum??row?.hash).toLowerCase();}

    async function recoverBaseBySavedChecksum(token,meta,{remoteResponse=null,remoteRevision=0,remoteHash=""}={}){
      const savedChecksum=text(meta?.lastSyncedHash).toLowerCase();
      if(!savedChecksum||!text(meta?.cloudTournamentId))return null;
      remoteRevision=Math.max(0,Number(remoteRevision)||0);
      remoteHash=text(remoteHash).toLowerCase();

      // Exact raw Cloud checksum is stronger lineage evidence than an old/missing
      // local baseRevision. If the current remote is exactly the snapshot Desktop
      // last acknowledged, it is a proven common base.
      const currentChecksum=text(remoteResponse?.tournament?.checksum).toLowerCase();
      if(currentChecksum&&currentChecksum===savedChecksum&&remoteRevision>0&&remoteHash){
        return {hash:remoteHash,revision:remoteRevision,source:"saved-checksum-current-remote"};
      }

      if(typeof api.listRevisions!=="function"||typeof api.getRevision!=="function")return null;
      try{
        const history=await api.listRevisions(token,meta.cloudTournamentId);
        const rows=Array.isArray(history?.revisions)?history.revisions:[];
        const matches=rows.filter(row=>revisionRowChecksum(row)===savedChecksum&&revisionRowNumber(row)>0);
        // More than one checksum match should be impossible for immutable history,
        // but fail closed rather than guessing if the provider ever returns it.
        if(matches.length!==1)return null;
        const revision=revisionRowNumber(matches[0]);
        const historical=await api.getRevision(token,meta.cloudTournamentId,revision);
        const snapshot=historicalSnapshotFromResponse(historical);
        if(!snapshot)return null;
        const hash=await snapshotContentHash(snapshot);
        if(hash)return {hash,revision,source:"saved-checksum-immutable-revision"};
      }catch(error){
        console.warn("Cloud common base could not be recovered from the saved checksum:",error);
      }
      return null;
    }

    async function resolveBaseFingerprint(token,meta,{remoteResponse=null,remoteRevision=0,remoteHash="",fallbackName=""}={}){
      const stored=storedBaseFingerprint(meta);
      const baseRevision=Math.max(0,Number(meta?.baseRevision)||0);
      remoteRevision=Math.max(0,Number(remoteRevision)||0);
      remoteHash=text(remoteHash).toLowerCase();
      if(stored)return {hash:stored,revision:baseRevision,source:"stored-schema-7"};

      // If the remote has not moved since the stored base revision, its current
      // immutable content is the authoritative common base even after a local
      // metadata-save failure or fingerprint schema upgrade.
      if(baseRevision>0&&remoteRevision===baseRevision&&remoteHash){
        return {hash:remoteHash,revision:baseRevision,source:"current-remote-same-revision"};
      }

      if(baseRevision>0){
        try{
          const historical=await api.getRevision(token,meta.cloudTournamentId,baseRevision);
          const snapshot=historicalSnapshotFromResponse(historical);
          if(snapshot){
            const hash=await snapshotContentHash(snapshot);
            if(hash)return {hash,revision:baseRevision,source:"immutable-base-revision"};
          }
        }catch(error){
          console.warn(`Cloud base revision ${baseRevision} could not be fingerprinted with schema ${FINGERPRINT_CONTENT_SCHEMA}:`,error);
        }
      }

      // beta.94 migration recovery: older Desktop packages may retain the exact
      // acknowledged Cloud checksum even when schema-7 base fingerprint/revision
      // metadata is absent or stale. Match that checksum against immutable Cloud
      // history to prove (never guess) the common base.
      const recovered=await recoverBaseBySavedChecksum(token,meta,{remoteResponse,remoteRevision,remoteHash});
      if(recovered)return recovered;
      return {hash:"",revision:baseRevision,source:baseRevision>0?"unavailable":"none"};
    }

    function cloudErrorText(error){
      if(error?.code==="cloud_true_conflict"||error?.code==="cloud_revision_conflict")return `Conflict: this tournament changed both on this PC and in cloud${error.currentRevision!=null?` (cloud revision ${error.currentRevision})`:""}. No data was overwritten.`;
      if(error?.code==="network_error")return "Offline — cloud backup pending. Local tournament is safe.";
      return text(error?.message)||"Cloud Workspace operation failed.";
    }

    function persistCloudMeta(){
      try{if(typeof saveData==="function")saveData();}catch(error){console.warn("Cloud metadata local save warning:",error);}
    }

    async function ensureRemoteTournament(token,name,tournament){
      const meta=ensureCloudMeta(tournament);
      if(!organizerInfo)await refreshOrganizer({quiet:false});
      if(!organizerInfo)throw new Error("Organizer Token is not connected.");

      // A copied local backup may contain cloud linkage owned by another
      // organizer. Never reuse another organizer's private cloud ID.
      if(meta.ownerId&&meta.ownerId!==text(organizerInfo.id)){
        meta.cloudTournamentId="";meta.revision=0;meta.baseRevision=0;meta.lastSyncedHash="";meta.lastSyncedContentHash="";meta.baseFingerprint="";meta.fingerprintContentSchema=FINGERPRINT_CONTENT_SCHEMA;meta.lastSyncedAt="";meta.lastSyncAt="";
      }
      meta.ownerId=text(organizerInfo.id);

      if(meta.cloudTournamentId)return meta;

      // If this logical tournament already exists in this organizer workspace,
      // link it by the shared internal ID instead of creating a duplicate. The
      // lookup is organizer-scoped by the authenticated token; internalId never
      // grants access by itself.
      try{
        const listed=await api.listTournaments(token);
        const rows=Array.isArray(listed?.tournaments)?listed.tournaments:[];
        const matches=rows.filter(row=>text(row?.localKey)===meta.internalId);
        if(matches.length===1){
          const remote=matches[0];
          meta.cloudTournamentId=text(remote.id);
          meta.remoteRevision=Math.max(0,Number(remote.revision)||0);
          meta.ownerId=text(organizerInfo.id);
          persistCloudMeta();
          return meta;
        }
        if(matches.length>1)throw new Error("Multiple cloud tournaments share the same internal ID. No automatic link was made.");
      }catch(error){
        if(/Multiple cloud tournaments/.test(text(error?.message)))throw error;
        console.warn("Cloud internal-ID lookup skipped:",error);
      }

      const result=await api.createTournament(token,{
        localKey:meta.internalId,name,deviceId:deviceId(),deviceLabel:deviceLabel()
      });
      const remote=result?.tournament||{};
      meta.cloudTournamentId=text(remote.id);
      meta.remoteRevision=Math.max(0,Number(remote.revision)||0);
      if(!meta.cloudTournamentId)throw new Error("Cloud Workspace did not return a tournament ID.");
      persistCloudMeta();
      return meta;
    }

    async function syncTournamentByName(name,{force=false,quiet=false,allowPull=!quiet}={}){
      name=text(name);
      const tournament=data?.tournaments?.[name];
      if(!name||!tournament)return {skipped:true};

      // beta.93: one reconciliation authority for the CURRENT tournament.
      // CloudWorkspaceRedesign owns schema-7 three-way SYNC. The legacy adapter
      // still services background/non-current helpers, but it must not run a
      // second independent conflict classifier for the open tournament.
      // This also covers startup backup, persistence autosync and Cloud-open
      // pre-sync because they all flow through syncTournamentByName().
      const unified=window.cpCloudSyncUnified;
      if(name===currentName()&&typeof unified==="function"&&unified.__cpUnifiedSyncAuthorityV2===true){
        return unified({force,quiet,allowPull,source:"legacy-adapter-delegate"});
      }
      const token=await getOrganizerToken();
      if(!token){setRuntime(name,tournament,"local","Organizer Token not connected");return {skipped:true,noToken:true};}

      const job=async()=>{
        try{
          setRuntime(name,tournament,"syncing","Syncing…");
          const preparedMeta=ensureCloudMeta(tournament);
          const hadCloudTournamentId=!!text(preparedMeta.cloudTournamentId);
          const meta=await ensureRemoteTournament(token,name,tournament);
          const snapshot=cloudScopedSnapshot(name,tournament);
          const checksum=await sha256Json(snapshot);
          const contentHash=await tournamentContentHash(name,tournament);
          let baseRevision=Math.max(0,Number(meta.baseRevision)||0);
          let remoteResponse=null;

          // A freshly-created Cloud row at revision 0 has no immutable
          // snapshot yet. Do not preflight a non-existent revision-0 snapshot;
          // the first Desktop upload establishes revision 1. Existing links or
          // rows with any revision/base history are still fetched normally.
          const shouldFetchCurrent=!!meta.cloudTournamentId&&(
            hadCloudTournamentId||
            Math.max(0,Number(meta.remoteRevision)||0)>0||
            Math.max(0,Number(meta.baseRevision)||0)>0||
            Math.max(0,Number(meta.revision)||0)>0
          );
          if(shouldFetchCurrent){
            try{remoteResponse=await api.getCurrentSnapshot(token,meta.cloudTournamentId);}
            catch(error){
              if(error?.status!==404&&error?.code!=="not_found")throw error;
            }
          }

          if(remoteResponse?.snapshot){
            const remote=remoteResponse?.tournament||{};
            const remoteRevision=Math.max(0,Number(remote.revision)||0);
            const remoteHash=await snapshotContentHash(remoteResponse.snapshot);
            const base=await resolveBaseFingerprint(token,meta,{
              remoteResponse,remoteRevision,remoteHash,fallbackName:name
            });
            const decision=decideReconciliation({
              localHash:contentHash,baseHash:base.hash,remoteHash,
              localRevision:baseRevision,remoteRevision
            });

            if(decision==="converged"||decision==="advance"){
              const before=captureCommonBase(meta);
              updateSyncBase(meta,{
                revision:remoteRevision,
                checksum:text(remote.checksum)||meta.lastSyncedHash,
                contentHash:remoteHash||contentHash,
                updatedAt:remote.updatedAt
              });
              meta.ownerId=text(organizerInfo?.id)||meta.ownerId;
              if(name===currentName()){
                await persistCurrentSyncBaseDurably(tournament,before,"Desktop and Cloud already match, but the repaired schema-7 common base could not be saved to the managed tournament file.");
              }else{
                persistCloudMeta();
              }
              setRuntime(name,tournament,"synced",remoteRevision>baseRevision?`Updated sync base to cloud revision ${remoteRevision}`:"Already current");
              return {ok:true,unchanged:true,advanced:remoteRevision>baseRevision,revision:remoteRevision,checksum:meta.lastSyncedHash,contentHash:remoteHash||contentHash};
            }

            if(decision==="pull"){
              if(!allowPull){
                setRuntime(name,tournament,"update",`Cloud revision ${remoteRevision} is newer; press Pull Changes to update safely.`);
                return {ok:true,skipped:true,updateAvailable:true,revision:remoteRevision};
              }
              if(name!==currentName()){
                setRuntime(name,tournament,"update",`Cloud revision ${remoteRevision} is newer; open this tournament to update.`);
                return {ok:true,skipped:true,updateAvailable:true,revision:remoteRevision};
              }
              const targetName=await importCloudSnapshot(remoteResponse,{showMain:false});
              const pulled=data?.tournaments?.[targetName];
              const pulledMeta=ensureCloudMeta(pulled);
              setRuntime(targetName,pulled,"synced",`Updated from cloud revision ${baseRevision} → ${remoteRevision}`);
              return {ok:true,pulled:true,revision:remoteRevision,checksum:pulledMeta.lastSyncedHash,contentHash:pulledMeta.lastSyncedContentHash};
            }

            if(decision==="remote-behind"){
              throw new Error(`Cloud revision ${remoteRevision} is older than the local sync base ${baseRevision}. No data was overwritten.`);
            }

            if(decision==="conflict"){
              throw new apiLib.CloudWorkspaceApiError(
                "The tournament was changed both on this PC and in the cloud.",
                {code:"cloud_true_conflict",currentRevision:remoteRevision,response:{baseRevision,remoteRevision,baseSource:base.source}}
              );
            }

            // DESKTOP_ONLY: write on top of the actual current remote revision.
            baseRevision=remoteRevision;
          }else if(baseRevision>0){
            throw new Error(`Cloud snapshot is unavailable for the stored base revision ${baseRevision}. No data was overwritten.`);
          }

          const result=await api.putSnapshot(token,{
            tournamentId:meta.cloudTournamentId,
            baseRevision,
            snapshot,
            deviceId:deviceId(),
            deviceLabel:deviceLabel()
          });

          const acceptedRevision=Math.max(0,Number(result?.revision ?? result?.tournament?.revision)||baseRevision||0);
          const acceptedFingerprint=text(result?.contentFingerprint||result?.tournament?.contentFingerprint||contentHash).toLowerCase()||contentHash;
          const acceptedCloudId=text(result?.cloudTournamentId||result?.tournament?.id||meta.cloudTournamentId);
          const acceptedInternalId=text(result?.internalId||result?.tournament?.localKey||meta.internalId);
          const before=captureCommonBase(meta);
          updateSyncBase(meta,{
            revision:acceptedRevision,
            checksum:result?.checksum||result?.tournament?.checksum||checksum,
            contentHash:acceptedFingerprint,
            updatedAt:result?.updatedAt||result?.tournament?.updatedAt,
            cloudTournamentId:acceptedCloudId,
            internalId:acceptedInternalId
          });
          meta.ownerId=text(organizerInfo?.id)||meta.ownerId;
          meta.remoteRevision=acceptedRevision;

          if(name===currentName()){
            await persistCurrentSyncBaseDurably(
              tournament,
              before,
              `Cloud accepted revision ${acceptedRevision}, but the new common base could not be saved to the managed tournament file. The Cloud revision is preserved; the next SYNC will repair the base from equal schema-7 content.`
            );
          }else{
            persistCloudMeta();
          }
          setRuntime(name,tournament,"synced",result?.unchanged?"Already current":"Synced");
          return {...(result||{}),ok:true,revision:acceptedRevision,contentHash:acceptedFingerprint};
        }catch(error){
          if(error?.code==="cloud_revision_conflict"||error?.code==="cloud_true_conflict"){
            const meta=ensureCloudMeta(tournament);
            if(Number.isInteger(Number(error.currentRevision)))meta.remoteRevision=Number(error.currentRevision);
            setRuntime(name,tournament,"conflict",cloudErrorText(error));
          }else if(error?.code==="network_error"){
            setRuntime(name,tournament,"offline",cloudErrorText(error));
          }else{
            setRuntime(name,tournament,"error",cloudErrorText(error));
          }
          if(!quiet)throw error;
          console.warn(`Cloud sync skipped for ${name}:`,error);
          return {ok:false,error};
        }
      };
      const task=syncChain.then(job,job);
      syncChain=task.then(()=>true,()=>true);
      return task;
    }

    async function syncCurrent({force=false,quiet=false,allowPull=!quiet}={}){
      const name=currentName();if(!name)return {skipped:true};
      const tournament=currentTournament();
      if(tournament){
        // Prepare installation-local identity in memory only. Do not persist or
        // advance common-base metadata before the forced managed-file checkpoint.
        ensureCloudMeta(tournament);
      }
      // A foreground cloud operation is a durability boundary: first commit the
      // exact active tournament to managed local storage, then reconcile cloud.
      if(!quiet&&typeof fileSaveTournament==="function"){
        const saved=await fileSaveTournament(true);
        if(!saved)throw new Error("Local tournament could not be saved. Cloud sync was cancelled.");
      }
      const result=await syncTournamentByName(name,{force,quiet,allowPull});
      if(result?.ok!==false)await pushOrganizerSettings({quiet:true,force});
      return result;
    }

    async function pullCurrentChanges(){
      // Explicit Pull is cloud-authoritative, but never silent. The current PC
      // copy is committed first. If both sides changed, ask before replacing the
      // open local copy with the cloud snapshot. This makes Pull useful across
      // Desktop/Web while preserving the local copy on disk.
      const name=currentName();
      const tournament=currentTournament();
      if(!name||!tournament)throw new Error("No tournament is open.");
      const token=await getOrganizerToken();
      if(!token)throw new Error("Organizer Token is not connected.");
      ensureCloudMeta(tournament);
      if(typeof fileSaveTournament==="function"){
        const saved=await fileSaveTournament(true);
        if(!saved)throw new Error("Local tournament could not be saved. Pull was cancelled.");
      }
      const meta=await ensureRemoteTournament(token,name,tournament);
      const response=await api.getCurrentSnapshot(token,meta.cloudTournamentId);
      const remote=response?.tournament||{};
      const remoteRevision=Math.max(0,Number(remote.revision)||0);
      const localRevision=Math.max(0,Number(meta.revision)||0);
      if(remoteRevision<localRevision)throw new Error(`Cloud revision ${remoteRevision} is older than the local sync base ${localRevision}. No data was overwritten.`);

      const localHash=await tournamentContentHash(name,tournament);
      const remoteHash=await snapshotContentHash(response?.snapshot);
      const base=await resolveBaseFingerprint(token,meta,{remoteResponse:response,remoteRevision,remoteHash,fallbackName:name});
      const baseHash=base.hash;
      if(localHash===remoteHash){
        const before=captureCommonBase(meta);
        updateSyncBase(meta,{revision:remoteRevision,checksum:text(remote.checksum)||meta.lastSyncedHash,contentHash:remoteHash,updatedAt:remote.updatedAt});
        await persistCurrentSyncBaseDurably(tournament,before,"Desktop and Cloud are already equal, but the schema-7 common base could not be saved to the managed tournament file.");
        setRuntime(name,tournament,"synced","Already current");
        return {ok:true,unchanged:true,revision:remoteRevision};
      }

      const decision=decideReconciliation({localHash,baseHash,remoteHash,localRevision:Math.max(0,Number(meta.baseRevision)||0),remoteRevision});
      const localChanged=decision==="push"||decision==="conflict";
      const remoteChanged=decision==="pull"||decision==="conflict";
      if(decision==="conflict"){
        let ok=false;
        const message=`This tournament changed both on this PC and in cloud (cloud revision ${remoteRevision}).\n\nPull Changes will now use the CLOUD copy. Your current PC copy has already been saved locally, so it is not lost.\n\nContinue with cloud copy?`;
        if(typeof appConfirm==="function")ok=await appConfirm(message,"Pull Changes — resolve conflict","warning");
        else ok=window.confirm(message);
        if(!ok)return {ok:false,cancelled:true,conflict:true,revision:remoteRevision};
      }else if(decision==="push"){
        setRuntime(name,tournament,"local","Local changes are newer; use Save & Sync Web to upload them.");
        return {ok:true,skipped:true,localNewer:true,revision:localRevision};
      }else if(decision==="remote-behind"){
        throw new Error(`Cloud revision ${remoteRevision} is older than the local sync base ${Math.max(0,Number(meta.baseRevision)||0)}. No data was overwritten.`);
      }

      const targetName=await importCloudSnapshot(response,{showMain:false});
      const pulled=data?.tournaments?.[targetName];
      const pulledMeta=ensureCloudMeta(pulled);
      const pulledHash=await tournamentContentHash(targetName,pulled);
      updateSyncBase(pulledMeta,{revision:remoteRevision,checksum:text(remote.checksum)||pulledMeta.lastSyncedHash,contentHash:pulledHash,updatedAt:remote.updatedAt});
      persistCloudMeta();
      setRuntime(targetName,pulled,"synced",`Pulled cloud revision ${remoteRevision}`);
      return {ok:true,pulled:true,revision:remoteRevision,contentHash:pulledHash};
    }

    async function syncAllLocal({quiet=false}={}){
      const token=await getOrganizerToken();
      if(!token)return {ok:false,noToken:true};
      if(!organizerInfo)await refreshOrganizer({quiet});
      if(!organizerInfo)return {ok:false};
      const names=Object.keys(data?.tournaments||{});
      let ok=0,failed=0;
      for(const name of names){
        const result=await syncTournamentByName(name,{quiet:true});
        if(result?.ok!==false)ok++;else failed++;
        await delay(120);
      }
      if(!quiet)log(`Cloud backup sweep complete: ${ok} tournament(s) current${failed?`, ${failed} pending/error`:""}.`);
      await pushOrganizerSettings({quiet:true});
      await refreshCloudList({quiet:true});
      return {ok:failed===0,count:ok,failed};
    }

    function scheduleAutoSync(delayMs=2500){
      if(!autoSyncEnabled()||suppressAutoSync)return;
      const scheduled=typeof window.cpPersistenceStatus==="function"?window.cpPersistenceStatus():null;
      const scheduledSignature=scheduled?`${scheduled.revision}:${scheduled.completed}`:"";
      clearTimeout(autoSyncTimer);
      autoSyncTimer=setTimeout(()=>{
        try{
          // A newer edit may exist even before its 300 ms local autosave has
          // entered the persistence queue. Revision equality proves the state
          // being mirrored is still the exact locally-completed state that
          // scheduled this cloud operation.
          const now=typeof window.cpPersistenceStatus==="function"?window.cpPersistenceStatus():null;
          if(now&&(Number(now.queued)!==Number(now.completed)||`${now.revision}:${now.completed}`!==scheduledSignature))return;
          if(window.__cpOnlineCloudBusy){scheduleAutoSync(1800);return;}
          syncCurrent({quiet:true,allowPull:false}).catch(error=>console.warn("Cloud autosync:",error));
        }catch(error){console.warn("Cloud autosync gate:",error);}
      },Math.max(800,Number(delayMs)||2500));
    }

    function startPersistenceMonitor(){
      clearInterval(monitorTimer);
      monitorTimer=setInterval(()=>{
        try{
          if(!autoSyncEnabled()||suppressAutoSync||typeof window.cpPersistenceStatus!=="function")return;
          const status=window.cpPersistenceStatus();
          if(!status||Number(status.queued)!==Number(status.completed))return;
          const sig=`${status.revision}:${status.completed}`;
          if(sig===lastPersistenceSignature)return;
          lastPersistenceSignature=sig;
          scheduleAutoSync(2500);
        }catch(error){console.warn("Cloud persistence monitor:",error);}
      },900);
    }

    function formatDate(value){
      if(!value)return "—";const d=new Date(value);if(Number.isNaN(d.getTime()))return text(value);
      return new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(d);
    }
    function formatBytes(value){const n=Math.max(0,Number(value)||0);if(n>=1048576)return `${(n/1048576).toFixed(2)} MiB`;if(n>=1024)return `${(n/1024).toFixed(1)} KiB`;return `${n} B`;}

    async function copyCloudDiagnostics(){
      const name=currentName();const tournament=currentTournament();const meta=tournament?.cloud||{};
      const payload=[
        `Chess-Publisher Cloud Diagnostics ${CLIENT_VERSION}`,
        `Tournament: ${name||"No tournament open"}`,
        `Cloud linked: ${text(meta.cloudTournamentId)?"yes":"no"}`,
        `Cloud revision: ${Math.max(0,Number(meta.revision)||0)}`,
        `Last sync: ${text(meta.lastSyncedAt||meta.lastSyncAt)||"Never"}`,
        `Internal ID: ${text(meta.internalId)||"not assigned"}`,
        `Auto Backup: ${autoSyncEnabled()?"ON":"OFF"}`,
        `Organizer: ${organizerInfo?"connected":"not connected"}`,
        `Device label: ${deviceLabel()}`
      ].join("\n");
      try{await navigator.clipboard.writeText(payload);log("Cloud diagnostics copied without secrets.");}
      catch(_){log(payload);}
    }

    function renderAccount(error=null){
      const state=document.getElementById("cloudOrganizerState");
      const stats=document.getElementById("cloudWorkspaceStats");
      const device=document.getElementById("cloudDeviceId");
      const label=document.getElementById("cloudDeviceLabel");
      if(state){
        if(organizerInfo)state.innerHTML=`<b>${esc(organizerInfo.displayName||"Organizer")}</b><span class="cloud-ok">Connected securely</span>`;
        else state.innerHTML=error?`<span class="cloud-warn">${esc(cloudErrorText(error))}</span>`:`<span class="muted">Use the Organizer Token field above.</span>`;
      }
      if(stats){
        const storage=workspaceInfo?.storage;
        stats.textContent=storage?`${Number(storage.tournamentCount)||0} cloud tournament(s) · ${Number(storage.revisionCount)||0} revision(s)`:"—";
      }
      if(device)device.textContent=deviceId();
      if(label&&!label.matches(":focus"))label.value=deviceLabel();
      const badge=document.getElementById("cloudConnectionBadge");
      if(badge){
        const name=currentName();const tournament=currentTournament();const meta=tournament?.cloud||{};const rt=getRuntime(name,tournament);
        const stateName=rt?.state||"local";
        const linked=!!text(meta.cloudTournamentId);
        const textLabel=stateName==="syncing"?"Syncing":stateName==="synced"?"Synced":stateName==="update"?"Pull Changes required":stateName==="offline"?"Offline pending":stateName==="conflict"?"Conflict":stateName==="error"?"Sync error":linked?"Cloud linked":"Local only";
        badge.textContent=textLabel;
        badge.className=`cloud-status-pill ${stateName==="synced"||linked&&stateName==="local"?"cloud-status-ok":(stateName==="syncing"||stateName==="update"?"cloud-status-busy":(stateName==="conflict"||stateName==="error"||stateName==="offline"?"cloud-status-warn":"cloud-status-neutral"))}`;
      }
    }

    function renderCurrent(){
      const name=currentName();const tournament=currentTournament();const meta=tournament?.cloud||{};const rt=getRuntime(name,tournament);
      const pairs={
        cloudCurrentName:name||"No tournament open",
        cloudCurrentInternalId:text(meta.internalId)||"Assigned on first cloud action",
        cloudCurrentId:text(meta.cloudTournamentId)||"Not linked yet",
        cloudCurrentRevision:String(Math.max(0,Number(meta.revision)||0)),
        cloudCurrentLastSync:text(meta.lastSyncedAt||meta.lastSyncAt)?formatDate(meta.lastSyncedAt||meta.lastSyncAt):"Never"
      };
      for(const [id,value] of Object.entries(pairs)){const el=document.getElementById(id);if(el)el.textContent=value;}
      const state=document.getElementById("cloudCurrentState");
      const stateName=rt?.state||"local";
      const linked=!!text(meta.cloudTournamentId);
      const label=stateName==="syncing"?"↻ Syncing":stateName==="synced"?"✓ Synced":stateName==="update"?"↓ Cloud changes available — press Pull Changes":stateName==="offline"?"☁ Saved locally — Cloud sync pending":stateName==="conflict"?"⚠ Conflict detected — no overwrite":stateName==="error"?"⚠ Sync error":linked?"Cloud linked":"Local only";
      if(state){
        state.className=`cloud-state cloud-state-${stateName}`;state.textContent=label;
        state.title=rt?.message||"";
      }
      const warning=document.getElementById("cloudConflictWarning");
      if(warning)warning.classList.toggle("hidden",stateName!=="conflict");
      const badge=document.getElementById("cloudConnectionBadge");
      if(badge){
        badge.textContent=stateName==="syncing"?"Syncing":stateName==="synced"?"Synced":stateName==="update"?"Pull Changes required":stateName==="offline"?"Offline pending":stateName==="conflict"?"Conflict":stateName==="error"?"Sync error":linked?"Cloud linked":"Local only";
        badge.className=`cloud-status-pill ${stateName==="synced"||linked&&stateName==="local"?"cloud-status-ok":(stateName==="syncing"||stateName==="update"?"cloud-status-busy":(stateName==="conflict"||stateName==="error"||stateName==="offline"?"cloud-status-warn":"cloud-status-neutral"))}`;
      }
      const action=document.getElementById("cloudRecommendedAction");
      if(action){
        const prefix="Recommended: ";
        action.textContent=!name?`${prefix}open or create a tournament first.`:
          !organizerInfo?`${prefix}enter the Organizer Token above, then use Save & Sync Web.`:
          stateName==="conflict"?`${prefix}stop and review both copies. No overwrite was performed.`:
          stateName==="update"?`${prefix}press Pull Changes before continuing work.`:
          stateName==="offline"?`${prefix}continue local work; use Save & Sync Web when internet is available.`:
          linked?`${prefix}use Pull Changes after Web edits, Save & Sync Web after desktop edits.`:
          `${prefix}press Save & Sync Web to create the private cloud link.`;
        action.className=`cloud-recommended-action ${stateName==="conflict"||stateName==="update"?"cloud-recommended-warn":(stateName==="offline"?"cloud-recommended-offline":"")}`;
      }
      const auto=document.getElementById("cloudAutoSyncStatus");
      if(auto)auto.textContent=autoSyncEnabled()?"Auto Backup is ON — push-only after completed local saves. It never pulls remote changes automatically.":"Auto Backup is OFF. It never pulls remote changes automatically.";
      for(const id of ["cloudSyncNowBtn","cloudPullChangesBtn","cloudSyncAllBtn","cloudRefreshBtn","cloudCopyDiagnosticsBtn"]){
        const btn=document.getElementById(id);if(btn)btn.disabled=!name&&id!=="cloudRefreshBtn"&&id!=="cloudCopyDiagnosticsBtn"||foregroundBusy>0;
      }
    }


    function renderCloudList(){
      const body=document.getElementById("cloudTournamentBody");if(!body)return;
      if(!cloudList.length){body.innerHTML='<tr><td colspan="5" class="muted">No private cloud tournaments yet.</td></tr>';return;}
      body.innerHTML=cloudList.map(row=>`<tr data-cloud-id="${esc(row.id)}"><td><b>${esc(row.name)}</b></td><td>${Number(row.revision)||0}</td><td>${esc(formatDate(row.updatedAt))}</td><td><button class="cloud-row-btn" data-cloud-action="open" data-cloud-id="${esc(row.id)}">Open</button></td><td><button class="cloud-row-btn" data-cloud-action="history" data-cloud-id="${esc(row.id)}">History</button></td></tr>`).join("");
    }

    async function refreshCloudList({quiet=false}={}){
      const token=await getOrganizerToken();if(!token){cloudList=[];renderCloudList();renderAccount();return []}
      try{
        if(!organizerInfo)await refreshOrganizer({quiet:true});
        const result=await api.listTournaments(token);cloudList=Array.isArray(result?.tournaments)?result.tournaments:[];
        renderCloudList();renderAccount();renderCurrent();return cloudList;
      }catch(error){if(!quiet)throw error;console.warn("Cloud list:",error);return []}
    }

    function localNameForCloudId(id){
      for(const [name,t] of Object.entries(data?.tournaments||{}))if(text(t?.cloud?.cloudTournamentId)===text(id))return name;
      return "";
    }
    function uniqueLocalName(preferred,exceptName=""){
      const base=text(preferred)||"Cloud Tournament";
      if(!data?.tournaments?.[base]||base===exceptName)return base;
      for(let i=1;i<1000;i++){
        const candidate=i===1?`${base} (Cloud)`:`${base} (Cloud ${i})`;
        if(!data.tournaments[candidate]||candidate===exceptName)return candidate;
      }
      return `${base} (Cloud ${Date.now()})`;
    }

    async function importCloudSnapshot(response,{showMain=true}={}){
      const remote=response?.tournament||{};const snapshot=response?.snapshot;
      if(!snapshot||typeof snapshot!=="object")throw new Error("Cloud snapshot is missing.");
      if(typeof cpValidateSnapshotStructure==="function"&&!cpValidateSnapshotStructure(snapshot))throw new Error("Cloud snapshot failed local tournament validation.");
      const sourceName=text(snapshot?.data?.currentTournament||snapshot?.currentTournament);
      const sourceTournament=snapshot?.data?.tournaments?.[sourceName];
      if(!sourceName||!sourceTournament)throw new Error("Cloud snapshot does not contain its tournament.");

      const linkedName=localNameForCloudId(remote.id);
      const targetName=uniqueLocalName(sourceName,linkedName);
      const previous=typeof getPersistentSnapshot==="function"?getPersistentSnapshot():null;
      const imported=sanitizeDownloadedTournament(sourceTournament);
      const existingLocalKey=linkedName?text(data?.tournaments?.[linkedName]?.cloud?.localKey):"";
      const existingInternalId=linkedName?text(data?.tournaments?.[linkedName]?.cloud?.internalId):"";
      const sourceInternalId=text(sourceTournament?.cloud?.internalId);
      imported.cloud={
        schemaVersion:4,
        // localKey is installation-local. internalId is organizer-scoped logical
        // identity mirrored in the token-owned cloud record's localKey.
        localKey:existingLocalKey||`cp-cloud:${uuid()}`,
        internalId:existingInternalId||sourceInternalId||text(remote.localKey)||`cp-tournament:${uuid()}`,
        cloudTournamentId:text(remote.id),
        ownerId:text(organizerInfo?.id),
        revision:Math.max(0,Number(remote.revision)||0),
        baseRevision:Math.max(0,Number(remote.revision)||0),
        lastSyncedHash:text(remote.checksum).toLowerCase(),
        lastSyncedContentHash:"",
        baseFingerprint:"",
        fingerprintContentSchema:FINGERPRINT_CONTENT_SCHEMA,
        lastSyncedAt:text(remote.updatedAt)||new Date().toISOString(),
        lastSyncAt:text(remote.updatedAt)||new Date().toISOString()
      };

      suppressAutoSync++;
      try{
        if(linkedName&&linkedName!==targetName)delete data.tournaments[linkedName];
        data.tournaments[targetName]=imported;
        imported.cloud.lastSyncedContentHash=await tournamentContentHash(targetName,imported);
        imported.cloud.baseFingerprint=imported.cloud.lastSyncedContentHash;
        imported.cloud.fingerprintContentSchema=FINGERPRINT_CONTENT_SCHEMA;
        data.currentTournament=targetName;
        if(typeof cpResetTournamentDocumentBinding==="function")cpResetTournamentDocumentBinding(targetName,"cloud-open");
        if(typeof normalizeData==="function")normalizeData();
        stateDirty=true;
        if(typeof refreshEverything==="function")refreshEverything();
        const saved=typeof fileSaveTournament==="function"?await fileSaveTournament(true):false;
        if(!saved)throw new Error("Cloud tournament was downloaded but could not be committed to local managed storage.");
        setRuntime(targetName,data.tournaments[targetName],"synced","Opened from private cloud");
        if(showMain&&document.getElementById("tabMain")&&typeof showTab==="function")showTab("main",document.getElementById("tabMain"));
        log(`Opened cloud tournament “${targetName}” locally at revision ${imported.cloud.revision}.`);
        return targetName;
      }catch(error){
        if(previous&&typeof loadAndNormalizeSnapshotObject==="function"&&loadAndNormalizeSnapshotObject(previous)){
          stateDirty=false;try{refreshEverything();}catch(_){ }
        }
        throw error;
      }finally{suppressAutoSync=Math.max(0,suppressAutoSync-1);}
    }

    async function openCloudTournament(id,{skipLocalPreSync=false}={}){
      id=text(id);if(!id)throw new Error("Cloud tournament ID is missing.");
      const token=await getOrganizerToken();if(!token)throw new Error("Organizer Token is not connected.");
      if(typeof prepareCurrentTournamentForTransition==="function"){
        const ready=await prepareCurrentTournamentForTransition("Open Cloud Tournament","Save unsaved changes before opening the cloud tournament?");
        if(!ready)return false;
      }

      const existingName=localNameForCloudId(id);
      if(existingName&&!skipLocalPreSync){
        const local=data.tournaments[existingName];const meta=ensureCloudMeta(local);
        const localHash=await tournamentContentHash(existingName,local);
        if(!meta.lastSyncedContentHash||meta.lastSyncedContentHash!==localHash){
          if(existingName===currentName()){
            // Current tournament uses the single unified schema-7 authority.
            const result=await syncTournamentByName(existingName,{quiet:false,force:true});
            if(result?.ok===false)return false;
          }else{
            // beta.94: opening a different Cloud tournament must never run the
            // legacy background reconciler against a non-current local copy.
            // The explicit Open action is Cloud-oriented; require confirmation
            // before replacing an unsynced local linked copy, then import the
            // exact current Cloud snapshot below.
            const message=`A local copy of “${existingName}” contains changes that have not been proven synchronized.

Opening this Cloud tournament will replace that local linked copy with the current Cloud version. No Cloud data will be changed.

Continue?`;
            let approved=false;
            if(typeof window.appConfirm==="function")approved=!!(await window.appConfirm(message,"Open Cloud Tournament","warning"));
            else approved=!!window.confirm?.(message);
            if(!approved)return false;
          }
        }
      }

      const response=await api.getCurrentSnapshot(token,id);
      return importCloudSnapshot(response);
    }

    async function loadHistory(id){
      const token=await getOrganizerToken();if(!token)throw new Error("Organizer Token is not connected.");
      const result=await api.listRevisions(token,id);
      const body=document.getElementById("cloudRevisionBody");const title=document.getElementById("cloudHistoryTitle");
      if(title)title.textContent=`Version history — ${result?.tournament?.name||id}`;
      if(body){
        const rows=Array.isArray(result?.revisions)?result.revisions:[];
        body.innerHTML=rows.length?rows.map(r=>`<tr><td><b>${Number(r.revision)||0}</b></td><td>${esc(formatDate(r.createdAt))}</td><td>${esc(r.deviceLabel||r.deviceId||"—")}</td><td>${esc(r.reason||"sync")}${r.sourceRevision?` from r${Number(r.sourceRevision)}`:""}</td><td>${esc(formatBytes(r.size))}</td><td><button class="cloud-row-btn" data-cloud-action="restore" data-cloud-id="${esc(id)}" data-cloud-revision="${Number(r.revision)||0}">Restore</button></td></tr>`).join(""):'<tr><td colspan="6" class="muted">No revisions stored.</td></tr>';
      }
      return result;
    }

    async function restoreRevision(id,revision){
      const token=await getOrganizerToken();if(!token)throw new Error("Organizer Token is not connected.");
      let ok=true;
      if(typeof appConfirm==="function")ok=await appConfirm(`Restore cloud revision ${revision}?\n\nThe old history is preserved. Restore creates a NEW current revision; nothing is deleted.`,`Restore Cloud Revision`,`warning`);
      if(!ok)return false;
      const result=await api.restoreRevision(token,id,revision);
      log(`Cloud revision ${revision} restored as new revision ${result.revision}.`);
      await openCloudTournament(id,{skipLocalPreSync:true});
      await loadHistory(id);
      await refreshCloudList({quiet:true});
      return true;
    }

    function log(message,kind="info"){
      const box=document.getElementById("cloudLog");const line=`[${new Date().toLocaleTimeString("en-GB",{hour12:false})}] ${message}`;
      if(box){box.value+=(box.value?"\n":"")+line;box.scrollTop=box.scrollHeight;}
      if(kind==="error")console.error("Chess-Publisher Cloud Workspace:",message);
    }

    async function foreground(label,fn){
      if(window.__cpOnlineCloudBusy){
        const error=new Error("Another Online & Cloud operation is already running.");
        log(error.message,"error");
        return false;
      }
      window.__cpOnlineCloudBusy=true;
      foregroundBusy++;renderCurrent();try{window.cpHubRefreshUi?.();}catch(_){ }const busy=document.getElementById("cloudBusyLabel");if(busy)busy.textContent=label;
      try{return await fn();}
      catch(error){log(cloudErrorText(error),"error");try{if(typeof appAlert==="function")await appAlert(cloudErrorText(error),"Online & Cloud","error");}catch(_){ }throw error;}
      finally{foregroundBusy=Math.max(0,foregroundBusy-1);window.__cpOnlineCloudBusy=false;if(busy)busy.textContent="";renderCurrent();try{window.cpHubRefreshUi?.();}catch(_){ }}
    }

    async function openWorkspace(){
      renderCurrent();renderAccount();
      // Re-read DPAPI each time so a token changed in Online Hub is picked up.
      tokenCache="";
      await refreshOrganizer({quiet:true});
      await refreshCloudList({quiet:true});
      renderCurrent();
    }

    function injectUi(){
      const tabs=document.querySelector("#appWindow .tabs");const content=document.querySelector("#appWindow .content");
      if(!tabs||!content)throw new Error("Chess-Publisher tab container was not found.");
      if(document.getElementById("cloudWorkspace"))return;

      // Beta.4 merges private Cloud Workspace into the existing Online Hub tab.
      // Keep tabHub/id=hub stable for preferences and regression compatibility.
      const hubTab=document.getElementById("tabHub");
      const hubPage=document.getElementById("hub");
      if(!hubTab||!hubPage)throw new Error("Online Hub must be initialized before Cloud Workspace.");
      hubTab.textContent="Online & Cloud (Beta)";

      const page=document.createElement("div");page.id="cloudWorkspace";page.className="cloud-integrated";page.innerHTML=`
        <div class="groupbox cloud-primary-box cloud-section">
          <div class="cloud-section-head"><div><div class="cloud-section-eyebrow">Private workspace</div><div class="group-title">Private Organizer Cloud Sync</div></div><span id="cloudConnectionBadge" class="cloud-status-pill cloud-status-neutral">Local only</span></div>
          <div class="cloud-compact-top">
            <div class="cloud-summary-card cloud-summary-wide"><span>Current tournament</span><b id="cloudCurrentName">—</b></div>
            <div class="cloud-summary-card"><span>Status</span><b id="cloudCurrentState" class="cloud-state">Local only</b></div>
            <div class="cloud-summary-card"><span>Rev.</span><b><span id="cloudCurrentRevision">0</span></b></div>
            <div class="cloud-summary-card"><span>Last sync</span><b id="cloudCurrentLastSync">Never</b></div>
          </div>
          <div id="cloudRecommendedAction" class="cloud-recommended-action cloud-recommended-compact">Recommended: enter the Organizer Token above, then Save & Sync Web.</div>
          <div id="cloudConflictWarning" class="cloud-conflict-warning hidden" role="alert">Local and Cloud both changed. Chess-Publisher did not overwrite either copy. Use Pull Changes after reviewing the conflict.</div>
          <details class="cloud-identity-details"><summary>Cloud IDs</summary><div class="cloud-current-grid cloud-identity-grid">
            <strong>Internal tournament ID</strong><span id="cloudCurrentInternalId" class="cloud-code">Assigned on first cloud action</span>
            <strong>Private Cloud ID</strong><span id="cloudCurrentId" class="cloud-code">Not linked yet</span>
          </div></details>
          <div class="cloud-action-panel">
            <div class="cloud-action-cluster">
              <div class="cloud-action-title">Main safe actions</div>
              <div class="toolbar cloud-current-actions">
                <button id="cloudSyncNowBtn" class="primary cloud-action-primary" type="button" title="Save locally, then safely sync this tournament with private Organizer Cloud/Web">Save & Sync Web</button>
                <button id="cloudPullChangesBtn" class="cloud-action-secondary" type="button" title="Safely pull cloud/web changes into this desktop tournament without overwrite">Pull Changes</button>
              </div>
            </div>
            <div class="cloud-action-help"><b>Rule:</b> Use Save & Sync Web after desktop edits. Use Pull Changes after work in Web/another PC. Public publishing stays in the Public Tournament Hub section below.</div>
          </div>
          <div id="cloudSyncSafetyLine" class="cloud-safety-line">Safe sync: saves locally first, reconciles private Organizer Cloud/Web data, uploads local-only changes, pulls cloud-only changes only during explicit foreground sync/pull, and stops on a true two-sided conflict.</div>
        </div>

        <div class="groupbox cloud-section">
          <div class="cloud-section-head"><div><div class="cloud-section-eyebrow">Cloud list</div><div class="group-title">My Private Cloud Tournaments</div></div><button id="cloudRefreshBtn" type="button" class="cloud-small-button">Refresh Cloud List</button></div>
          <div class="cloud-list-hint">Private Web/Cloud work only — this list never publishes to players.</div>
          <div class="table-frame cloud-table-frame"><table><thead><tr><th>Name</th><th>Rev.</th><th>Updated</th><th>Open</th><th>Versions</th></tr></thead><tbody id="cloudTournamentBody"><tr><td colspan="5" class="muted">Open Online & Cloud to load private cloud tournaments.</td></tr></tbody></table></div>
        </div>

        <details class="groupbox cloud-more cloud-section">
          <summary>Cloud Options & Version History</summary>
          <div class="cloud-account-grid cloud-options-grid">
            <strong>Connected organizer</strong><div id="cloudOrganizerState">Checking local credential…</div><span id="cloudWorkspaceStats">—</span>
            <strong>This device</strong><div><span id="cloudDeviceId" class="cloud-code"></span><input id="cloudDeviceLabel" class="cloud-device-label" maxlength="160" title="Friendly label stored locally and recorded with new cloud revisions"></div><button id="cloudCopyDiagnosticsBtn" type="button">Copy Diagnostics</button>
            <strong>Auto Backup</strong><label class="cloud-toggle"><input id="cloudAutoSync" type="checkbox"> Push-only cloud backup after a completed local save</label><button id="cloudSyncAllBtn" type="button">Back Up All Local</button>
          </div>
          <div id="cloudAutoSyncStatus" class="cloud-note cloud-autosync-note">Auto Backup is OFF. It never pulls remote changes automatically.</div>
          <div class="muted cloud-note">Organizer Token entry is managed once above; device identity stays local to this installation.</div>
          <div class="group-title cloud-history-heading" id="cloudHistoryTitle">Version History</div>
          <div class="muted cloud-note">Restore is non-destructive: a selected old revision is copied forward as a new current revision.</div>
          <div class="table-frame cloud-history-frame"><table><thead><tr><th>Revision</th><th>Created</th><th>Device</th><th>Reason</th><th>Size</th><th>Action</th></tr></thead><tbody id="cloudRevisionBody"><tr><td colspan="6" class="muted">Choose History for a cloud tournament.</td></tr></tbody></table></div>
        </details>

        <details class="groupbox cloud-log-details"><summary>Cloud Activity Log / Diagnostics</summary><textarea id="cloudLog" class="full" readonly></textarea></details>`;
      const mount=document.getElementById("cloudWorkspaceMount")||hubPage;
      mount.appendChild(page);

      const style=document.createElement("style");style.id="cpCloudWorkspaceStyle";style.textContent=`
        .cloud-integrated{margin-top:8px}.cloud-compact-top{display:grid;grid-template-columns:minmax(220px,1.6fr) minmax(170px,1fr) 80px minmax(120px,.8fr);gap:7px;margin:4px 0 7px}.cloud-recommended-compact{margin:4px 0 7px;padding:6px 8px}.cloud-identity-details{margin:5px 0}.cloud-identity-details>summary{cursor:pointer;font-size:11px;font-weight:700;color:#586675}.cloud-primary-box{padding:9px 10px}.cloud-primary-box .cloud-section-head{margin-bottom:5px}.cloud-action-panel{margin-top:7px;padding-top:7px}.cloud-action-cluster{padding:6px 7px}.cloud-action-help{font-size:10.5px;line-height:14px}.cloud-safety-line{margin-top:6px;padding:5px 8px}.cloud-table-frame{min-height:95px;max-height:190px}
.cloud-section{position:relative}.cloud-primary-box{border-color:#9fc0df;background:linear-gradient(180deg,#f8fbff 0%,#fff 100%)}.cloud-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px}.cloud-section-head .group-title{margin:0}.cloud-section-eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#5f6b76;font-weight:800;margin-bottom:2px}.cloud-workflow-strip{display:grid;grid-template-columns:repeat(3,minmax(130px,1fr));gap:7px;margin:7px 0 8px}.cloud-workflow-step{display:grid;grid-template-columns:26px minmax(0,1fr);gap:1px 7px;align-items:start;border:1px solid var(--cp-border,#d8dde2);border-radius:8px;background:#fff;padding:7px 8px}.cloud-workflow-step span{grid-row:1/3;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#eef6ff;border:1px solid #b7d7f2;color:#0f4f84;font-weight:800}.cloud-workflow-step b{font-size:11px}.cloud-workflow-step em{font-style:normal;font-size:10px;line-height:13px;color:#5a6672}.cloud-recommended-action{margin:6px 0 8px;padding:8px 10px;border-radius:8px;border:1px solid #bdd7ee;background:#f7fbff;color:#27394b;font-size:12px;font-weight:800}.cloud-recommended-warn{background:#fff8e5;border-color:#e4c86d;color:#7a4a00}.cloud-recommended-offline{background:#f4f6f8;border-color:#c9d2dc;color:#4c5966}.cloud-sync-summary{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;margin:6px 0 9px}.cloud-summary-card{border:1px solid var(--cp-border,#d8dde2);background:#fff;border-radius:7px;padding:7px 9px;min-width:0}.cloud-summary-card span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#637080;font-weight:700;margin-bottom:3px}.cloud-summary-card b{display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cloud-status-pill{display:inline-flex;align-items:center;justify-content:center;min-height:22px;padding:3px 9px;border-radius:999px;border:1px solid #ccd4dc;background:#f6f8fa;color:#4d5965;font-size:11px;font-weight:800;white-space:nowrap}.cloud-status-ok{background:#edf7ed;border-color:#9fd29f;color:#107c10}.cloud-status-warn{background:#fff8e5;border-color:#e4c86d;color:#8a5a00}.cloud-status-busy{background:#eef6ff;border-color:#9fc6e8;color:#0f6cbd}.cloud-status-neutral{background:#f4f6f8;border-color:#c9d2dc;color:#4c5966}.cloud-conflict-warning{padding:8px 10px;margin:8px 0;border:1px solid #e0a04f;border-radius:7px;background:#fff8e5;color:#7a4a00;font-weight:700}.cloud-conflict-warning.hidden{display:none}.cloud-current-grid{display:grid;grid-template-columns:165px minmax(280px,1fr);gap:6px 10px;align-items:center}.cloud-identity-grid{padding:8px;margin-top:7px;background:#fbfcfd;border:1px solid var(--cp-border,#d8dde2);border-radius:6px}.cloud-code{font-family:Consolas,"Courier New",monospace;overflow-wrap:anywhere}.cloud-device-label{display:block;margin-top:5px;max-width:360px;width:100%}.cloud-note{margin-top:8px}.cloud-autosync-note{padding:6px 8px;border:1px solid var(--cp-border,#d8dde2);border-radius:6px;background:#fbfcfd;color:#4f5862}.cloud-toggle{display:flex;align-items:center;gap:7px}.cloud-state{font-weight:700}.cloud-state-synced,.cloud-ok{color:#107c10}.cloud-state-syncing,.cloud-state-update{color:#0f6cbd}.cloud-state-offline,.cloud-state-conflict,.cloud-state-error,.cloud-warn{color:#a15c00}.cloud-action-panel{margin-top:10px;padding-top:10px;border-top:1px solid var(--cp-border,#dedede);display:grid;grid-template-columns:1fr;gap:10px;align-items:start}.cloud-action-cluster{border:1px solid var(--cp-border,#d8dde2);border-radius:8px;background:#fff;padding:8px}/* Browser-open action intentionally removed in beta.9 sync-only workflow. */.cloud-action-title{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#5f6b76;font-weight:800;margin-bottom:6px}.cloud-current-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cloud-current-actions button{min-width:132px;min-height:33px;font-weight:700}.cloud-action-primary{min-width:142px}.cloud-action-help{grid-column:1/-1;margin-top:0;font-size:11px;line-height:15px;color:#4f5862}.cloud-safety-line{margin-top:8px;padding:7px 9px;border-left:3px solid #0f6cbd;background:#f5f9fd;color:#43505c;font-size:11px;line-height:15px}.cloud-list-hint{margin:0 0 8px 0;font-size:11px;line-height:15px;color:#4f5862}.cloud-table-frame{min-height:135px;max-height:230px}.cloud-history-frame{min-height:120px;max-height:220px;margin-top:7px}.cloud-row-btn{min-width:70px}.cloud-small{font-size:10px;margin-top:2px}.cloud-small-button{min-height:28px;white-space:nowrap}.cloud-more>summary,.cloud-log-details>summary{cursor:pointer;font-weight:700;padding:2px 0}.cloud-more[open]>summary,.cloud-log-details[open]>summary{margin-bottom:10px}.cloud-account-grid{display:grid;grid-template-columns:165px minmax(300px,1fr) auto;gap:7px 10px;align-items:center}.cloud-options-grid{margin-top:4px}.cloud-history-heading{margin-top:14px}.cloud-hidden-id{display:none}#cloudLog{height:92px;resize:vertical;font-family:Consolas,"Courier New",monospace;font-size:11px;margin-top:8px}@media(max-width:1100px){.cloud-compact-top{grid-template-columns:repeat(2,minmax(150px,1fr))}.cloud-sync-summary{grid-template-columns:repeat(2,minmax(120px,1fr))}.cloud-workflow-strip{grid-template-columns:repeat(2,minmax(130px,1fr))}.cloud-action-panel{grid-template-columns:1fr}}@media(max-width:980px){.cloud-account-grid,.cloud-current-grid{grid-template-columns:1fr}.cloud-section-head{flex-direction:column}.cloud-status-pill{align-self:flex-start}}@media(max-width:640px){.cloud-compact-top{grid-template-columns:1fr}.cloud-sync-summary{grid-template-columns:1fr}.cloud-workflow-strip{grid-template-columns:1fr}.cloud-current-actions button{width:100%}}
      `;document.head.appendChild(style);

      document.getElementById("cloudAutoSync").checked=autoSyncEnabled();
      document.getElementById("cloudAutoSync").addEventListener("change",event=>{setAutoSyncEnabled(event.target.checked);renderCurrent();if(event.target.checked)scheduleAutoSync(900);});
      document.getElementById("cloudDeviceLabel").value=deviceLabel();
      document.getElementById("cloudDeviceLabel").addEventListener("change",event=>{event.target.value=setDeviceLabel(event.target.value);});
      document.getElementById("cloudRefreshBtn").addEventListener("click",()=>foreground("Refreshing cloud list…",async()=>{tokenCache="";await refreshOrganizer();await refreshCloudList();log("Private cloud list refreshed.");}).catch(()=>{}));
      document.getElementById("cloudSyncNowBtn").addEventListener("click",()=>foreground("Syncing now…",async()=>{const result=await syncCurrent({force:true,quiet:false,allowPull:true});await refreshCloudList({quiet:true});if(result?.pulled)log("Save & Sync Web pulled cloud-only changes safely.");else if(result?.unchanged||result?.advanced)log("Save & Sync Web confirmed desktop and Web cloud data are current.");else log("Save & Sync Web uploaded local changes safely.");}).catch(()=>{}));
      document.getElementById("cloudPullChangesBtn").addEventListener("click",()=>foreground("Pulling changes…",async()=>{const result=await pullCurrentChanges();await refreshCloudList({quiet:true});if(result?.pulled)log(`Pulled cloud changes into the current tournament.`);else if(result?.unchanged||result?.advanced)log(`Local and cloud tournament are current.`);else log(`Pull Changes completed safely.`);}).catch(()=>{}));
      document.getElementById("cloudCopyDiagnosticsBtn").addEventListener("click",()=>copyCloudDiagnostics().catch(()=>{}));
      document.getElementById("cloudSyncAllBtn").addEventListener("click",()=>foreground("Backing up local tournaments…",async()=>{if(typeof fileSaveTournament==="function"&&currentName()){const saved=await fileSaveTournament(true);if(!saved)throw new Error("Current tournament could not be saved locally.");}await syncAllLocal({quiet:false});}).catch(()=>{}));
      document.getElementById("cloudTournamentBody").addEventListener("click",event=>{
        const btn=event.target.closest("button[data-cloud-action]");if(!btn)return;
        const id=btn.dataset.cloudId;const action=btn.dataset.cloudAction;
        if(action==="open")foreground("Opening cloud tournament…",()=>openCloudTournament(id)).catch(()=>{});
        if(action==="history")foreground("Loading version history…",()=>loadHistory(id)).catch(()=>{});
      });
      document.getElementById("cloudRevisionBody").addEventListener("click",event=>{
        const btn=event.target.closest('button[data-cloud-action="restore"]');if(!btn)return;
        foreground("Restoring cloud revision…",()=>restoreRevision(btn.dataset.cloudId,Number(btn.dataset.cloudRevision))).catch(()=>{});
      });

      const originalShowTab=window.showTab;
      if(typeof originalShowTab==="function"&&!originalShowTab.__cpCloudWrapped){
        const wrapped=function(id,button){
          // Saved beta.1-beta.3 Cloud Workspace tab preferences transparently
          // migrate to the merged Online & Cloud tab.
          if(id==="cloudWorkspace"){
            const hub=document.getElementById("tabHub");
            const result=originalShowTab.call(this,"hub",hub||button);
            setTimeout(()=>openWorkspace().catch(error=>console.warn("Cloud Workspace open:",error)),0);
            return result;
          }
          const result=originalShowTab.apply(this,arguments);
          if(id==="hub")setTimeout(()=>openWorkspace().catch(error=>console.warn("Cloud Workspace open:",error)),0);
          return result;
        };
        wrapped.__cpCloudWrapped=true;window.showTab=wrapped;
      }

      try{
        if(data?.preferences?.activeTab==="cloudWorkspace"){
          data.preferences.activeTab="hub";
          if(typeof saveData==="function")saveData();
        }
      }catch(_){ }

      for(const selectorId of ["mainTournamentSelect","registrationTournamentSelect","pairingsTournamentSelect","chessResultsTournamentSelect","standingsTournamentSelect","scheduleTournamentSelect","exportTournamentSelect"]){
        document.getElementById(selectorId)?.addEventListener("change",()=>setTimeout(renderCurrent,0));
      }
      renderAccount();renderCurrent();startPersistenceMonitor();
      log("Private Cloud/Web sync loaded. Save & Sync Web is desktop-to-web sync; Pull Changes is web-to-desktop reconcile. Public publishing remains in the Public Tournament Hub section.");

      // One conservative startup backup sweep. It never pulls remote content.
      setTimeout(async()=>{
        if(startupSweepDone||!autoSyncEnabled())return;startupSweepDone=true;
        try{
          const token=await getOrganizerToken();if(!token)return;
          await refreshOrganizer({quiet:true});if(!organizerInfo)return;
          if(currentName()&&typeof fileSaveTournament==="function"){
            const current=currentTournament();if(current)ensureCloudMeta(current);
            const saved=await fileSaveTournament(true);if(!saved)return;
          }
          await syncAllLocal({quiet:true});
        }catch(error){console.warn("Cloud startup backup sweep:",error);}
      },3500);
    }

    window.ChessPublisherCloudSyncInternals=Object.freeze({
      FINGERPRINT_CONTENT_SCHEMA,canonicalValue,tournamentContentObject,tournamentContentHash,tournamentContentForFingerprint,cloudScopedSnapshot,decideReconciliation,sanitizeDownloadedTournament,ensureCloudMeta,updateSyncBase,storedBaseFingerprint,historicalSnapshotFromResponse,recoverBaseBySavedChecksum,resolveBaseFingerprint,captureCommonBase,restoreCommonBase,persistCurrentSyncBaseDurably,cloudDiagnosticLog:log
    });
    // Export the non-UI entry points before UI injection. This keeps the cloud
    // service testable and does not change normal desktop startup behaviour.
    window.cpCloudWorkspaceOpen=openWorkspace;
    window.cpCloudSyncCurrent=syncCurrent;
    window.cpCloudPullChanges=pullCurrentChanges;
    window.cpCloudSyncAllLocal=syncAllLocal;
    window.cpCloudRefreshList=refreshCloudList;
    // beta.14 New Tournament chooser reuses the existing safe cloud open path.
    window.cpCloudOpenTournament=openCloudTournament;
    window.cpCloudSettingsPull=pullOrganizerSettings;
    window.cpCloudSettingsPush=pushOrganizerSettings;
    injectUi();
  }catch(error){console.error("Chess-Publisher Cloud Workspace adapter:",error);}
})();
