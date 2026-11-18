(()=>{
  "use strict";

  try{
    if(window.__cpCloudDirectionalSyncLoaded)return;
    window.__cpCloudDirectionalSyncLoaded=true;

    const VERSION="1.06.00-beta.96";
    // Historical regression markers retained for compatibility; these labels are
    // no longer rendered as separate user actions in beta.78:
    // ↓ Pull Cloud → Desktop | ↑ Push Desktop → Cloud | Check Cloud Status | Open in Web
    // Legacy UI IDs/text retained as non-rendered markers only: cloudUploadCurrentBtn / ↑ Upload Current / cloudPullCurrentBtn / ↓ Pull Current
    // Autosave is local only. Pull never creates a cloud tournament.
    const WEB_APP_URL="https://web.chess-publisher.org/";
    const AUTO_SYNC_KEY="ChessPublisherCloudWorkspace_AutoSync_v1";
    const INSTALL_SCOPE_STORAGE_KEY="ChessPublisherOnline_InstallScope_v1";
    const ORGANIZER_SECRET_BASE_KEY="organizer-primary";
    const apiLib=window.ChessPublisherCloudWorkspaceApi;
    const core=window.ChessPublisherCloudSyncInternals;
    if(!apiLib||!core)throw new Error("Cloud directional sync prerequisites are unavailable.");
    // beta.96 Windows SYNC runtime hotfix: the Desktop WebView is served from a
    // random 127.0.0.1 LocalEngine port. Direct browser fetches to the remote
    // Cloud Worker are therefore CORS-dependent and can be blocked before GET/PUT
    // reaches the service. On the Windows local origin, route the exact same Cloud
    // API contract through LocalEngine; it forwards the request server-side. Web
    // builds keep the ordinary remote API base and their WEB_ORIGIN CORS policy.
    const desktopCloudProxyBase=(()=>{
      try{
        const u=new URL(window.location.href);
        if(u.protocol==="http:"&&(u.hostname==="127.0.0.1"||u.hostname==="localhost"))return `${u.origin}/cloud-proxy`;
      }catch(_){ }
      return "";
    })();
    const api=apiLib.createClient({clientVersion:VERSION,...(desktopCloudProxyBase?{baseUrl:desktopCloudProxyBase}:{})});
    const text=v=>v==null?"":String(v).trim();
    const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
    const stable=v=>JSON.stringify(canonical(v));
    let currentStatus={state:"OFFLINE",message:"Cloud status has not been checked.",remoteRevision:0};
    let pendingConflict=null;
    let tokenCache="";

    function syncTrace(stage,details={}){
      const cloudId=text(details.cloudTournamentId||details.cloudId);
      const internalId=text(details.internalId);
      const baseRevision=Math.max(0,Number(details.baseRevision)||0);
      const remoteRevision=Math.max(0,Number(details.remoteRevision)||0);
      const decision=text(details.decision);
      const bits=[`[SYNC r4] ${stage}`,`transport=${desktopCloudProxyBase?"local-/cloud-proxy":"remote-api"}`];
      if(cloudId)bits.push(`cloud=${cloudId}`);
      if(internalId)bits.push(`internal=${internalId}`);
      if(baseRevision||details.baseRevision===0)bits.push(`base=r${baseRevision}`);
      if(remoteRevision||details.remoteRevision===0)bits.push(`remote=r${remoteRevision}`);
      if(decision)bits.push(`decision=${decision}`);
      const line=bits.join(" | ");
      try{core.cloudDiagnosticLog?.(line,details.kind||"info");}catch(_){ }
      try{console.info(line);}catch(_){ }
    }

    function isGeneratedOrLegacyInternalId(value){
      const id=text(value);
      return !id||/^cp-(?:tournament|cloud):/i.test(id);
    }

    // Critical safety rule: legacy Auto Backup is permanently disabled for this
    // directional-sync layer. Chess-Publisher Autosave remains local persistence
    // only and never triggers a Cloud Pull/Push.
    try{localStorage.setItem(AUTO_SYNC_KEY,"0");}catch(_){ }

    function uuid(){return globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;}
    function canonical(value){
      if(Array.isArray(value))return value.map(canonical);
      if(!value||typeof value!=="object")return value;
      const out={};for(const key of Object.keys(value).sort())out[key]=canonical(value[key]);return out;
    }
    function equal(a,b){return stable(a)===stable(b);}
    function currentTournament(){try{return typeof getCurrentTournament==="function"?getCurrentTournament():null;}catch(_){return null;}}
    function currentName(){return text(data?.currentTournament);}
    function ensureTournamentName(name,tournament){
      const wanted=text(name);
      // beta.86: data.currentTournament / map-key is the Desktop display identity.
      // Older Desktop renames changed that key but left tournament.name stale,
      // so schema-7 hashing could incorrectly return NO-OP and never publish the
      // rename. Keep the portable tournament identity canonical before every
      // status/hash/push operation.
      if(tournament&&typeof tournament==="object"&&wanted&&text(tournament.name)!==wanted)tournament.name=wanted;
      return tournament;
    }
    function installationScope(){
      let scope="";try{scope=text(localStorage.getItem(INSTALL_SCOPE_STORAGE_KEY));}catch(_){ }
      if(!scope){scope=`install:${uuid()}`;try{localStorage.setItem(INSTALL_SCOPE_STORAGE_KEY,scope);}catch(_){ }}
      return scope;
    }
    function organizerSecretKey(){
      try{if(typeof window.cpOnlineOrganizerSecretKey==="function")return window.cpOnlineOrganizerSecretKey();}catch(_){ }
      return `${ORGANIZER_SECRET_BASE_KEY}:${installationScope()}`;
    }
    async function getToken(){
      if(tokenCache)return tokenCache;
      if(typeof window.cpNativeHubSecretGet!=="function")return "";
      tokenCache=text(await window.cpNativeHubSecretGet(organizerSecretKey()));
      return tokenCache;
    }
    async function sha256Json(value){
      const bytes=new TextEncoder().encode(JSON.stringify(value));
      const digest=await crypto.subtle.digest("SHA-256",bytes);
      return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
    }
    function remoteTournament(response){
      const snapshot=response?.snapshot;
      const name=text(snapshot?.data?.currentTournament||snapshot?.currentTournament);
      const tournament=snapshot?.data?.tournaments?.[name];
      if(!name||!tournament)throw new Error("Cloud snapshot does not contain a portable tournament object.");
      return {name,tournament};
    }
    async function remoteFingerprint(response){
      const remote=remoteTournament(response);
      return core.tournamentContentHash(remote.name,remote.tournament);
    }
    function localFingerprint(name,tournament){return core.tournamentContentHash(name,tournament);}

    const WEB_RESULT_CANONICAL=Object.freeze({
      "1-0":"1 - 0","1:0":"1 - 0",
      "0-1":"0 - 1","0:1":"0 - 1",
      "½-½":"½ - ½","1/2-1/2":"½ - ½","0.5-0.5":"½ - ½","=":"½ - ½",
      "1F-0F":"1F - 0F","0F-1F":"0F - 1F","0F-0F":"0F - 0F",
      "PAB":"PAB","1BYE":"1 BYE","½BYE":"½ BYE","1/2BYE":"½ BYE","0.5BYE":"½ BYE","0BYE":"0 BYE"
    });
    const WEB_UNUSUAL_RESULTS=Object.freeze(new Set(["½-0","0-½","0-0"]));
    function canonicalWebResult(value){
      const raw=text(value);
      if(!raw||raw==="-")return "-";
      const compact=raw.replace(/\s+/g,"").toUpperCase();
      return WEB_RESULT_CANONICAL[compact]||"";
    }
    function canonicalWebUnusual(value){return text(value).replace(/\s+/g,"").replace(/1\/2/g,"½");}
    function boardPlayerIdentity(board){return `${text(board?.whiteKey)}|${text(board?.blackKey)}`;}
    function resolveResultTarget(localBoards,remoteBoard,remoteIndex){
      if(!Array.isArray(localBoards))return null;
      const remoteNo=Math.max(1,Number(remoteBoard?.board)||remoteIndex+1);
      const identity=boardPlayerIdentity(remoteBoard);
      const byBoard=localBoards.find((board,index)=>(Math.max(1,Number(board?.board)||index+1)===remoteNo));
      if(byBoard&&boardPlayerIdentity(byBoard)===identity)return byBoard;
      const byIdentity=localBoards.filter(board=>boardPlayerIdentity(board)===identity);
      return byIdentity.length===1?byIdentity[0]:null;
    }
    function resultState(board,{remote=false}={}){
      const rawResult=text(board?.result);
      const unusualRaw=canonicalWebUnusual(board?.cpUnusualResult);
      if(unusualRaw){
        if(!WEB_UNUSUAL_RESULTS.has(unusualRaw))return remote?{invalid:`Unsupported unusual Web result: ${text(board?.cpUnusualResult)}`}:{kind:"local",label:text(board?.cpUnusualResult)||rawResult||"-"};
        return {kind:"unusual",result:"½ - ½",cpUnusualResult:unusualRaw,label:unusualRaw};
      }
      if(!!board?.adjourned && (!rawResult||rawResult==="-"))return {kind:"adjourned",result:"-",adjourned:true,label:"Adjourned"};
      const result=canonicalWebResult(rawResult);
      if((!rawResult||rawResult==="-")&&result==="-")return {kind:"empty",result:"-",label:"-"};
      if(!result)return remote?{invalid:`Unsupported Web result: ${rawResult}`}:{kind:"local",result:rawResult||"-",label:rawResult||"-"};
      return {kind:"result",result,label:result};
    }
    function sameResultState(a,b){return text(a?.kind)===text(b?.kind)&&text(a?.result)===text(b?.result)&&text(a?.cpUnusualResult)===text(b?.cpUnusualResult)&&!!a?.adjourned===!!b?.adjourned;}
    function applyRemoteResultState(target,state){
      if(!target||!state)return target;
      target.result=state.result||"-";
      if(state.kind==="unusual"){
        target.cpUnusualResult=state.cpUnusualResult;
        target.cpUnusualAt=new Date().toISOString();
      }else{
        delete target.cpUnusualResult;delete target.cpUnusualAt;
      }
      if(state.kind==="adjourned"){
        target.adjourned=true;
        target.adjournedAt=target.adjournedAt||new Date().toISOString();
      }else{
        target.adjourned=false;
        delete target.adjournedAt;delete target.adjournedRound;
      }
      return target;
    }
    function planWebResultDownload(localTournament,remoteTournamentObject){
      const operations=[],conflicts=[],mismatches=[],invalid=[];
      const localRounds=localTournament?.pairings?.liveBoards||{};
      const remoteRounds=remoteTournamentObject?.pairings?.liveBoards||{};
      for(const [roundKey,remoteBoards] of Object.entries(remoteRounds)){
        if(!Array.isArray(remoteBoards))continue;
        const localBoards=localRounds?.[String(roundKey)];
        remoteBoards.forEach((remoteBoard,remoteIndex)=>{
          const remoteState=resultState(remoteBoard,{remote:true});
          if(remoteState.invalid){invalid.push({round:String(roundKey),board:Number(remoteBoard?.board)||remoteIndex+1,result:remoteState.invalid});return;}
          if(remoteState.kind==="empty")return; // A plain blank Web result never clears Desktop.
          const target=resolveResultTarget(localBoards,remoteBoard,remoteIndex);
          if(!target){mismatches.push({round:String(roundKey),board:Number(remoteBoard?.board)||remoteIndex+1,whiteKey:text(remoteBoard?.whiteKey),blackKey:text(remoteBoard?.blackKey)});return;}
          const localState=resultState(target);
          if(sameResultState(localState,remoteState))return;
          const op={round:String(roundKey),board:Number(target?.board)||remoteIndex+1,target,localState,remoteState,localResult:localState.label,remoteResult:remoteState.label};
          operations.push(op);
          if(localState.kind!=="empty")conflicts.push(op);
        });
      }
      return {operations,conflicts,mismatches,invalid};
    }

    const LOCAL_ONLY_KEY_RE=/^(?:organizerToken|manageToken|authToken|accessToken|refreshToken|password|secret|aesKey|aesIv|encryptionKey|encryptionIv|localPath|filePath|folderPath|installationPath|executablePath|windowsPath|linuxPath|dgtPort|dgtSerial|dgtUsb)$/i;
    function captureLocalFields(value){
      const captured=[];
      function walk(node,path){
        if(!node||typeof node!=="object")return;
        if(path.length===0&&Object.prototype.hasOwnProperty.call(node,"dgt"))captured.push({path:["dgt"],value:clone(node.dgt)});
        for(const [key,item] of Object.entries(node)){
          if(path.length===0&&(key==="cloud"||key==="dgt"))continue;
          if(LOCAL_ONLY_KEY_RE.test(key)||/(?:Local|File|Folder|Installation|Executable)Path$/i.test(key)||/^dgt(?:Port|Serial|Usb)/i.test(key)){
            captured.push({path:[...path,key],value:clone(item)});continue;
          }
          if(item&&typeof item==="object"&&!Array.isArray(item))walk(item,[...path,key]);
        }
      }
      walk(value,[]);return captured;
    }
    function setAtPath(target,path,value){
      if(!path.length)return value;
      let node=target;
      const isIndex=value=>/^\d+$/.test(String(value));
      for(let i=0;i<path.length-1;i++){
        const key=path[i],nextKey=path[i+1];
        if(Array.isArray(node)){
          const index=Number(key);
          if(!Number.isInteger(index)||index<0)throw new Error(`Invalid array conflict path: ${path.join(".")}`);
          if(!node[index]||typeof node[index]!=="object")node[index]=isIndex(nextKey)?[]:{};
          node=node[index];
          continue;
        }
        if(!node[key]||typeof node[key]!=="object")node[key]=isIndex(nextKey)?[]:{};
        node=node[key];
      }
      const last=path[path.length-1];
      if(Array.isArray(node)&&isIndex(last))node[Number(last)]=clone(value);else node[last]=clone(value);
      return target;
    }
    function restoreLocalFields(target,captured){for(const entry of captured||[])setAtPath(target,entry.path,entry.value);return target;}

    function stableArrayMergeKey(item,index,path){
      if(!item||typeof item!=="object"||Array.isArray(item))return "";
      const leaf=text(path[path.length-1]);
      if(leaf==="players")return text(item.localKey||item.id||item.playerKey);
      // beta.87: Calendar/Schedule rows have a stable logical row number.
      // This lets independent edits to different rows, or to different fields
      // of the same row, merge safely without treating the whole rows array as
      // one atomic conflict. Add/remove/reorder still fail closed because the
      // complete key sequence must remain identical across base/local/remote.
      if(leaf==="rows"&&text(path[path.length-2])==="schedule")return text(item.no||item.round||item.id);
      const liveBoardsIndex=path.lastIndexOf("liveBoards");
      if(liveBoardsIndex>=0&&liveBoardsIndex===path.length-2){
        const board=Math.max(0,Number(item.board)||index+1);
        const white=text(item.whiteKey),black=text(item.blackKey);
        return white||black?`${board}|${white}|${black}`:"";
      }
      return "";
    }
    function stableArrayKeys(array,path){
      if(!Array.isArray(array))return null;
      const keys=array.map((item,index)=>stableArrayMergeKey(item,index,path));
      if(keys.some(key=>!key)||new Set(keys).size!==keys.length)return null;
      return keys;
    }

    function mergeThreeWay(base,local,remote,path=[]){
      if(equal(local,remote))return {value:clone(local),conflicts:[]};
      if(equal(local,base)&&!equal(remote,base))return {value:clone(remote),conflicts:[]};
      if(equal(remote,base)&&!equal(local,base))return {value:clone(local),conflicts:[]};
      if(Array.isArray(base)&&Array.isArray(local)&&Array.isArray(remote)){
        const baseKeys=stableArrayKeys(base,path),localKeys=stableArrayKeys(local,path),remoteKeys=stableArrayKeys(remote,path);
        // Merge element-by-element only when all three arrays represent the same
        // stable logical rows in the same order. Concurrent add/remove/reorder is
        // intentionally left as a real conflict instead of guessing.
        if(baseKeys&&localKeys&&remoteKeys&&equal(baseKeys,localKeys)&&equal(baseKeys,remoteKeys)){
          const out=[];const conflicts=[];
          for(let i=0;i<base.length;i++){
            const child=mergeThreeWay(base[i],local[i],remote[i],[...path,String(i)]);
            if(child.value!==undefined)out[i]=child.value;
            conflicts.push(...child.conflicts);
          }
          return {value:out,conflicts};
        }
      }
      const plain=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
      if(plain(base)&&plain(local)&&plain(remote)){
        const out={};const conflicts=[];
        const keys=new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)]);
        for(const key of keys){
          const child=mergeThreeWay(base[key],local[key],remote[key],[...path,key]);
          if(child.value!==undefined)out[key]=child.value;
          conflicts.push(...child.conflicts);
        }
        return {value:out,conflicts};
      }
      return {value:clone(local),conflicts:[{path:path.join("."),pathParts:[...path],base:clone(base),local:clone(local),remote:clone(remote)}]};
    }
    function applyConflictChoices(merged,conflicts,choices){
      const out=clone(merged);
      for(const conflict of conflicts){
        const choice=choices?.[conflict.path];
        if(choice!=="local"&&choice!=="remote")throw new Error(`Conflict ${conflict.path||"(root)"} has not been resolved.`);
        setAtPath(out,conflict.pathParts,choice==="local"?conflict.local:conflict.remote);
      }
      return out;
    }

    function metaOf(tournament){return core.ensureCloudMeta(tournament);}
    function captureBaseMeta(meta){
      if(typeof core.captureCommonBase==="function")return core.captureCommonBase(meta);
      const out={};for(const key of ["baseRevision","revision","baseFingerprint","lastSyncedContentHash","fingerprintContentSchema","lastSyncedHash","lastSyncedAt","lastSyncAt","cloudTournamentId","internalId"])out[key]=meta?.[key];
      return out;
    }
    function restoreBaseMeta(meta,before){
      if(typeof core.restoreCommonBase==="function")return core.restoreCommonBase(meta,before);
      if(!meta||!before)return meta;for(const key of Object.keys(before)){if(before[key]===undefined)delete meta[key];else meta[key]=before[key];}return meta;
    }
    async function persistBaseDurably(tournament,before,message){
      if(typeof core.persistCurrentSyncBaseDurably==="function")return core.persistCurrentSyncBaseDurably(tournament,before,message);
      if(typeof fileSaveTournament!=="function"){restoreBaseMeta(metaOf(tournament),before);throw new Error(message||"Managed tournament file save is unavailable.");}
      const saved=await fileSaveTournament(true);if(!saved){restoreBaseMeta(metaOf(tournament),before);throw new Error(message||"Managed tournament file checkpoint failed.");}
      return true;
    }
    function reconcileDecision(args){
      if(typeof core.decideReconciliation==="function")return core.decideReconciliation(args);
      let {localHash,baseHash,remoteHash,localRevision=0,remoteRevision=0}=args||{};
      localHash=text(localHash).toLowerCase();baseHash=text(baseHash).toLowerCase();remoteHash=text(remoteHash).toLowerCase();
      localRevision=Math.max(0,Number(localRevision)||0);remoteRevision=Math.max(0,Number(remoteRevision)||0);
      if(remoteRevision<localRevision)return "remote-behind";
      if(localHash&&remoteHash&&localHash===remoteHash)return "converged";
      if(!baseHash)return "conflict";
      const localChanged=localHash!==baseHash,remoteChanged=remoteHash!==baseHash;
      if(!localChanged&&!remoteChanged)return remoteRevision>localRevision?"advance":"converged";
      if(!localChanged&&remoteChanged)return "pull";
      if(localChanged&&!remoteChanged)return "push";
      return "conflict";
    }
    async function resolvedBase(token,meta,response,remoteRevision,remoteHash,name){
      if(typeof core.resolveBaseFingerprint==="function")return core.resolveBaseFingerprint(token,meta,{remoteResponse:response,remoteRevision,remoteHash,fallbackName:name});
      const stored=text(meta?.baseFingerprint||meta?.lastSyncedContentHash).toLowerCase();
      if(stored)return {hash:stored,revision:Math.max(0,Number(meta?.baseRevision)||0),source:"legacy-test-harness"};
      if(Math.max(0,Number(meta?.baseRevision)||0)===Math.max(0,Number(remoteRevision)||0)&&remoteHash)return {hash:remoteHash,revision:remoteRevision,source:"current-remote-same-revision"};
      return {hash:"",revision:Math.max(0,Number(meta?.baseRevision)||0),source:"unavailable"};
    }
    function clearRemoteLink(meta){
      if(typeof core.clearCloudRemoteLink==="function")return core.clearCloudRemoteLink(meta);
      if(!meta||typeof meta!=="object")return meta;
      meta.cloudTournamentId="";meta.revision=0;meta.baseRevision=0;meta.remoteRevision=0;
      meta.lastSyncedHash="";meta.lastSyncedContentHash="";meta.baseFingerprint="";meta.fingerprintContentSchema=core.FINGERPRINT_CONTENT_SCHEMA||7;meta.lastSyncedAt="";meta.lastSyncAt="";meta.lastPullAt="";meta.lastPushAt="";meta.directionalStatus="UNLINKED";
      return meta;
    }
    function normalizedTournamentName(value){
      return text(value).normalize?.("NFKC")?.toLocaleLowerCase?.()
        .replace(/[\s\u00a0]+/g," ").replace(/[–—]/g,"-").trim() || text(value).toLocaleLowerCase();
    }
    function remoteRowName(row){return text(row?.name||row?.title||row?.tournamentName);}
    function linkedNameMismatch(localName,row){
      const a=normalizedTournamentName(localName),b=normalizedTournamentName(remoteRowName(row));
      return !!a&&!!b&&a!==b;
    }
    function looksLikeIndependentCopyName(name){
      const value=text(name);
      return /\(\s*(?:imported|copy|cloud)(?:\s*\d+)?\s*\)\s*\d*$/i.test(value) || /(?:^|[ _-])copy(?:[ _-]*\d+)?$/i.test(value);
    }
    function detachAsIndependentCloudCopy(meta){
      clearRemoteLink(meta);
      meta.localKey=`cp-cloud:${uuid()}`;
      meta.internalId=`cp-tournament:${uuid()}`;
      meta.ownerId="";
      meta.directionalStatus="UNLINKED";
      return meta;
    }
    async function prepareRemoteForPush(token,name,tournament,{unified=false}={}){
      // beta.78: one SYNC workflow follows the CURRENT logical tournament.
      // There is no user-facing Push/Pull/Upload-as-New decision. When an
      // imported/copied Desktop file still carries another event's Cloud link,
      // first reuse an already existing Cloud row with the current name; if none
      // exists, repair the foreign identity once and create the current event's
      // single Cloud counterpart. Subsequent SYNC calls always reuse it.
      let identity=await reconcileRemoteIdentity(token,name,tournament,{createIfMissing:false});
      if(identity.row&&linkedNameMismatch(name,identity.row)&&looksLikeIndependentCopyName(name)){
        const meta=metaOf(tournament);
        const listed=await api.listTournaments(token);
        const rows=Array.isArray(listed?.tournaments)?listed.tournaments:[];
        const wanted=normalizedTournamentName(name);
        const byCurrentName=rows.filter(row=>normalizedTournamentName(remoteRowName(row))===wanted);
        if(byCurrentName.length>1)throw new Error("More than one Cloud tournament has the current tournament name. SYNC stopped instead of guessing.");
        if(byCurrentName.length===1){
          const row=byCurrentName[0];
          clearRemoteLink(meta);
          meta.internalId=text(row.localKey)||meta.internalId||`cp-tournament:${uuid()}`;
          meta.cloudTournamentId=text(row.id);
          meta.remoteRevision=Math.max(0,Number(row.revision)||0);
          persistMeta();
          return {meta,row,state:"RELINKED_CURRENT",created:false,repairedForeignLink:true};
        }
        detachAsIndependentCloudCopy(meta);persistMeta();
        identity=await reconcileRemoteIdentity(token,name,tournament,{createIfMissing:true});
        return {...identity,repairedForeignLink:true};
      }
      // Historical direct-direction compatibility: "Upload as New" remains an
      // internal regression marker only. The beta.78 UI never exposes this
      // choice because users operate through the single SYNC button.
      if(!unified&&identity.row&&linkedNameMismatch(name,identity.row)&&!looksLikeIndependentCopyName(name)){
        let makeIndependent=false;
        const remoteName=remoteRowName(identity.row)||"another Cloud tournament";
        const message=`Desktop tournament “${name}” is linked to Cloud tournament “${remoteName}”.

To avoid overwriting the wrong event, Chess-Publisher will not assume they are the same tournament.

Choose “Upload as New” to detach this Desktop file and create a separate Cloud tournament. Choose “Keep Existing Link” to leave the link unchanged.`;
        if(typeof window.showAppMessage==="function")makeIndependent=!!(await window.showAppMessage(message,{title:"My Cloud Tournaments",type:"warning",confirm:true,okText:"Upload as New",cancelText:"Keep Existing Link"}));
        else if(typeof window.appConfirm==="function")makeIndependent=!!(await window.appConfirm(message,"My Cloud Tournaments","warning"));
        if(makeIndependent){detachAsIndependentCloudCopy(metaOf(tournament));persistMeta();return reconcileRemoteIdentity(token,name,tournament,{createIfMissing:true});}
      }
      if(identity.state==="UNLINKED")return reconcileRemoteIdentity(token,name,tournament,{createIfMissing:true});
      return identity;
    }
    function resolveIdentity(meta,rows){
      if(typeof core.resolveCloudIdentityFromRows==="function")return core.resolveCloudIdentityFromRows(meta,rows);
      rows=Array.isArray(rows)?rows:[];const internalId=text(meta?.internalId),savedId=text(meta?.cloudTournamentId);
      const bySavedId=savedId?rows.find(row=>text(row?.id)===savedId):null;const byInternal=internalId?rows.filter(row=>text(row?.localKey)===internalId):[];
      if(byInternal.length>1)return {state:"AMBIGUOUS",savedId,internalId,matches:byInternal};
      if(bySavedId){
        const remoteInternalId=text(bySavedId?.localKey);
        if(!internalId||!remoteInternalId||remoteInternalId===internalId)return {state:"LINKED",row:bySavedId,savedId,internalId};
        // A saved provider ID is strong organizer-scoped evidence. beta.96 r4
        // may repair only generated/legacy Desktop internal IDs from that exact
        // active row. A meaningful different ID still fails closed so a copied
        // tournament cannot silently attach to another logical event.
        if(byInternal.length===0&&isGeneratedOrLegacyInternalId(internalId)&&remoteInternalId){
          return {state:"ADOPT_SAVED_IDENTITY",row:bySavedId,savedId,internalId,remoteInternalId};
        }
      }
      if(byInternal.length===1)return {state:"RELINK",row:byInternal[0],savedId,internalId};
      return {state:savedId?"STALE":"MISSING",savedId,internalId,row:null};
    }

    function markStatus(state,message,extra={}){
      currentStatus={state,message:text(message),remoteRevision:Number(extra.remoteRevision||0),at:new Date().toISOString()};
      const tournament=currentTournament();if(tournament){const meta=metaOf(tournament);meta.directionalStatus=state;if(extra.remoteRevision!=null)meta.remoteRevision=Number(extra.remoteRevision)||0;}
      renderStatus();return currentStatus;
    }
    function statusLabel(state){
      return ({IN_SYNC:"✓ In sync",LOCAL_CHANGES:"↑ Desktop changes not pushed",REMOTE_CHANGES:"↓ Cloud has newer changes",CONFLICT:"⚠ Conflict — Desktop and Cloud changed",OFFLINE:"○ Offline",UNLINKED:"○ Not linked",COPY_LINK_MISMATCH:"○ Independent copy detected"})[state]||state;
    }
    function renderStatus(){
      const host=document.getElementById("cloudDirectionalStatus");if(!host)return;
      const t=currentTournament();const meta=t?metaOf(t):{};
      const state=currentStatus.state||"OFFLINE";
      host.className=`cloud-directional-status cloud-dir-${state.toLowerCase()}`;
      host.querySelector("[data-role=badge]").textContent=statusLabel(state);
      host.querySelector("[data-role=message]").textContent=currentStatus.message||"";
      host.querySelector("[data-role=base]").textContent=`r${Math.max(0,Number(meta.baseRevision)||0)}`;
      host.querySelector("[data-role=remote]").textContent=`r${Math.max(0,Number(meta.remoteRevision ?? currentStatus.remoteRevision)||0)}`;
      host.querySelector("[data-role=pull]").textContent=meta.lastPullAt?new Date(meta.lastPullAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"Never";
      host.querySelector("[data-role=push]").textContent=meta.lastPushAt?new Date(meta.lastPushAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"Never";
      const resolve=document.getElementById("cloudResolveConflictBtn");if(resolve)resolve.hidden=state!=="CONFLICT";
      try{renderSimpleCloudControls();}catch(_){ }
    }
    function persistMeta(){try{if(typeof saveData==="function")saveData();}catch(_){ }}

    async function linkedRemote(token,tournament){
      const meta=metaOf(tournament);if(!text(meta.cloudTournamentId))return null;
      return api.getCurrentSnapshot(token,meta.cloudTournamentId);
    }
    async function recoverArchivedRemoteIdentity(token,name,tournament,plan){
      const meta=metaOf(tournament);
      if(typeof api.listArchivedTournaments!=="function"||typeof api.restoreArchivedTournament!=="function")return null;
      let archived;
      try{archived=await api.listArchivedTournaments(token);}
      catch(error){
        // Older Workers may not expose Trash yet. Only endpoint absence falls
        // back to the historical recreate path; network/server errors fail
        // closed so we never manufacture a duplicate while Trash is unknown.
        if(error?.status===404||error?.code==="not_found"||error?.code==="http_404")return null;
        throw error;
      }
      const rows=Array.isArray(archived?.tournaments)?archived.tournaments:[];
      const savedId=text(plan?.savedId||meta.cloudTournamentId),internalId=text(plan?.internalId||meta.internalId);
      const matches=rows.filter(row=>{
        const rowId=text(row?.id),rowInternal=text(row?.localKey);
        if(savedId&&rowId===savedId)return !internalId||!rowInternal||rowInternal===internalId;
        return !!internalId&&rowInternal===internalId;
      });
      if(matches.length>1)throw new Error("More than one tournament in Trash shares this tournament's Cloud identity. SYNC stopped instead of guessing.");
      const row=matches[0];if(!row)return null;

      // Copied/imported Desktop tournaments must not revive the source event
      // merely because they still carry its archived provider identity.
      if(linkedNameMismatch(name,row)&&looksLikeIndependentCopyName(name))return null;

      const restored=await api.restoreArchivedTournament(token,row.id);
      const restoredRow=restored?.tournament||row;
      const restoredId=text(restoredRow?.id||row.id);
      if(!restoredId)throw new Error("Cloud restored the tournament but did not return its ID.");

      // Preserve baseRevision/baseFingerprint. Trash is only visibility state;
      // preserving the immutable common base lets ordinary three-way SYNC
      // decide whether Desktop, Web, or both changed while the event was hidden.
      meta.cloudTournamentId=restoredId;
      meta.remoteRevision=Math.max(0,Number(restoredRow?.revision ?? row?.revision)||0);
      persistMeta();
      return {meta,row:{...row,...restoredRow,id:restoredId},state:"RESTORED_FROM_TRASH",created:false,restored:true};
    }

    async function reconcileRemoteIdentity(token,name,tournament,{createIfMissing=false}={}){
      const meta=metaOf(tournament);ensureTournamentName(name,tournament);
      const listed=await api.listTournaments(token);
      const rows=Array.isArray(listed?.tournaments)?listed.tournaments:[];
      const plan=resolveIdentity(meta,rows);
      if(plan.state==="AMBIGUOUS")throw new Error("Multiple entries in My Cloud Tournaments share this tournament's internal ID. Chess-Publisher stopped instead of guessing which tournament is correct.");
      if(plan.state==="LINKED"){
        meta.cloudTournamentId=text(plan.row.id);meta.remoteRevision=Math.max(0,Number(plan.row.revision)||0);persistMeta();
        syncTrace("identity-linked",{cloudTournamentId:meta.cloudTournamentId,internalId:meta.internalId,remoteRevision:meta.remoteRevision});
        return {meta,row:plan.row,state:"LINKED",created:false};
      }
      if(plan.state==="ADOPT_SAVED_IDENTITY"){
        meta.internalId=text(plan.remoteInternalId);
        meta.cloudTournamentId=text(plan.row.id);
        meta.remoteRevision=Math.max(0,Number(plan.row.revision)||0);
        persistMeta();
        syncTrace("identity-repaired-from-saved-cloud-id",{cloudTournamentId:meta.cloudTournamentId,internalId:meta.internalId,remoteRevision:meta.remoteRevision});
        return {meta,row:plan.row,state:"LINKED",created:false,repairedIdentity:true};
      }
      if(plan.state==="RELINK"){
        clearRemoteLink(meta);
        meta.cloudTournamentId=text(plan.row.id);meta.remoteRevision=Math.max(0,Number(plan.row.revision)||0);persistMeta();
        return {meta,row:plan.row,state:"RELINKED",created:false};
      }
      if(plan.state==="STALE"||plan.state==="MISSING"){
        const recovered=await recoverArchivedRemoteIdentity(token,name,tournament,plan);
        if(recovered)return recovered;
      }
      if(plan.state==="STALE"&&text(plan.savedId)){
        // Active list + Trash are authoritative. If the provider ID is absent
        // from both, a permanently deleted/orphaned backend snapshot must never
        // be resurrected by direct lookup. Recreate only after both indexes miss.
      }

      // Absent from active list and Trash => stale/permanently-deleted linkage:
      // stale metadata, not a Cloud conflict. Forget only the remote linkage;
      // preserve internalId and tournament data.
      clearRemoteLink(meta);persistMeta();
      if(!createIfMissing)return {meta,row:null,state:"UNLINKED",created:false};

      const created=await api.createTournament(token,{localKey:meta.internalId,name,deviceId:"",deviceLabel:"Windows Desktop"});
      const row=created?.tournament||{};
      meta.cloudTournamentId=text(row.id);meta.remoteRevision=Math.max(0,Number(row.revision)||0);persistMeta();
      if(!meta.cloudTournamentId)throw new Error("Cloud did not return a tournament ID.");
      syncTrace("identity-created",{cloudTournamentId:meta.cloudTournamentId,internalId:meta.internalId,remoteRevision:meta.remoteRevision});
      return {meta,row,state:"CREATED",created:true};
    }
    async function findOrCreateRemoteForPush(token,name,tournament){
      return (await reconcileRemoteIdentity(token,name,tournament,{createIfMissing:true})).meta;
    }
    async function baseTournament(token,meta,revisionOverride=0){
      const revision=Math.max(0,Number(revisionOverride)||Number(meta.baseRevision)||0);if(!revision)return null;
      try{
        const response=await api.getRevision(token,meta.cloudTournamentId,revision);
        const snapshot=typeof core.historicalSnapshotFromResponse==="function"
          ? core.historicalSnapshotFromResponse(response)
          : (response?.snapshot||response?.revision?.snapshot||response?.data?.snapshot||response?.result?.snapshot||null);
        if(!snapshot)return null;
        return remoteTournament({snapshot}).tournament;
      }catch(error){
        console.warn(`Cloud immutable base r${revision} could not be loaded:`,error);
        return null;
      }
    }

    async function commitLocalTournament(oldName,tournament,{baseRevision,baseFingerprint,remoteChecksum,remoteUpdatedAt,status="IN_SYNC",message=""}={}){
      const old=currentTournament();const oldMeta=old?clone(metaOf(old)):{};const captured=captureLocalFields(old||{});
      const clean=core.sanitizeDownloadedTournament(tournament);restoreLocalFields(clean,captured);
      const newName=text(clean.name||oldName)||oldName;clean.name=newName;
      clean.cloud={...oldMeta,
        schemaVersion:4,
        localKey:text(oldMeta.localKey)||`cp-cloud:${uuid()}`,
        internalId:text(oldMeta.internalId)||text(tournament?.cloud?.internalId)||`cp-tournament:${uuid()}`,
        cloudTournamentId:text(oldMeta.cloudTournamentId),
        ownerId:text(oldMeta.ownerId),
        revision:Math.max(0,Number(baseRevision)||0),baseRevision:Math.max(0,Number(baseRevision)||0),
        lastSyncedContentHash:text(baseFingerprint).toLowerCase(),baseFingerprint:text(baseFingerprint).toLowerCase(),
        fingerprintContentSchema:core.FINGERPRINT_CONTENT_SCHEMA||7,
        lastSyncedHash:text(remoteChecksum).toLowerCase(),lastSyncedAt:text(remoteUpdatedAt)||new Date().toISOString(),lastSyncAt:text(remoteUpdatedAt)||new Date().toISOString(),
        remoteRevision:Math.max(0,Number(baseRevision)||0),
        lastPullAt:oldMeta.lastPullAt,lastPushAt:oldMeta.lastPushAt
      };
      delete clean.cloud.pendingStructuralSync;
      if(oldName!==newName)delete data.tournaments[oldName];
      data.tournaments[newName]=clean;data.currentTournament=newName;
      try{if(typeof cpResetTournamentDocumentBinding==="function")cpResetTournamentDocumentBinding(newName,"cloud-directional-merge");}catch(_){ }
      try{if(typeof normalizeData==="function")normalizeData();}catch(_){ }
      try{stateDirty=true;}catch(_){ }
      try{if(typeof refreshEverything==="function")refreshEverything();}catch(_){ }
      if(typeof fileSaveTournament==="function"){
        const saved=await fileSaveTournament(true);if(!saved)throw new Error("Merged/Pulled tournament could not be saved locally.");
      }else{try{if(typeof saveData==="function")saveData();}catch(_){ }}
      markStatus(status,message,{remoteRevision:baseRevision});return clean;
    }

    async function confirmRemoteEqualsLocal(token,cloudTournamentId,expectedLocalHash,minRevision=0){
      const cloudId=text(cloudTournamentId);
      if(!cloudId)throw new Error("Cloud tournament identity is missing after synchronization.");
      const latest=await api.getCurrentSnapshot(token,cloudId);
      if(!latest?.snapshot)throw new Error("Cloud synchronization could not be confirmed because the current snapshot is missing.");
      const remote=latest?.tournament||{};
      const returnedId=text(remote?.id||latest?.cloudTournamentId||cloudId);
      if(returnedId&&returnedId!==cloudId){
        const error=new apiLib.CloudWorkspaceApiError("Cloud tournament identity changed while confirming synchronization.",{status:409,code:"cloud_identity_mismatch",response:{expected:cloudId,actual:returnedId}});
        throw error;
      }
      const revision=Math.max(0,Number(remote?.revision)||0);
      const remoteHash=await remoteFingerprint(latest);
      syncTrace("postcondition-readback",{cloudTournamentId:cloudId,remoteRevision:revision,baseRevision:minRevision,decision:remoteHash===text(expectedLocalHash).toLowerCase()?"equal":"mismatch"});
      if(revision<Math.max(0,Number(minRevision)||0)){
        throw new apiLib.CloudWorkspaceApiError("Cloud revision moved backwards while confirming synchronization.",{status:409,code:"cloud_revision_regression",currentRevision:revision});
      }
      if(remoteHash!==text(expectedLocalHash).toLowerCase()){
        throw new apiLib.CloudWorkspaceApiError("Cloud did not retain the exact Desktop tournament state. SYNC stopped without claiming success.",{status:409,code:"cloud_postcondition_mismatch",currentRevision:revision,response:{cloudTournamentId:cloudId}});
      }
      return {response:latest,remote,revision,hash:remoteHash};
    }

    async function checkCloudStatus(){
      const name=currentName(),t=currentTournament();if(!name||!t)throw new Error("No tournament is open.");
      ensureTournamentName(name,t);const meta=metaOf(t);
      const token=await getToken();if(!token)return markStatus("OFFLINE","Organizer Token is not connected.");
      let identity;
      try{identity=await reconcileRemoteIdentity(token,name,t,{createIfMissing:false});}
      catch(error){if(error?.code==="network_error")return markStatus("OFFLINE","Cloud is unavailable. Local tournament remains unchanged.");throw error;}
      if(identity.state==="UNLINKED")return markStatus("UNLINKED","This tournament is not in My Cloud Tournaments yet. Press SYNC to connect the current tournament.");
      if(identity.row&&linkedNameMismatch(name,identity.row)&&looksLikeIndependentCopyName(name)){
        return markStatus("COPY_LINK_MISMATCH",`Current Desktop tournament needs one-time Cloud identity repair. Press SYNC; no other tournament will be overwritten.`,{remoteRevision:identity.row?.revision});
      }
      let response;
      try{response=await api.getCurrentSnapshot(token,meta.cloudTournamentId);}
      catch(error){
        if(error?.code==="network_error")return markStatus("OFFLINE","Cloud is unavailable. Local tournament remains unchanged.");
        if((error?.status===404||error?.code==="not_found")&&Math.max(0,Number(identity.row?.revision)||0)===0)return markStatus("LOCAL_CHANGES","The Cloud tournament exists but has no uploaded snapshot yet. Press SYNC.",{remoteRevision:0});
        throw error;
      }
      const remote=response?.tournament||{};const remoteRevision=Math.max(0,Number(remote.revision)||0);
      const localHash=await localFingerprint(name,t),remoteHash=await remoteFingerprint(response);
      const base=await resolvedBase(token,meta,response,remoteRevision,remoteHash,name);
      const decision=reconcileDecision({localHash,baseHash:base.hash,remoteHash,localRevision:Math.max(0,Number(base?.revision)||Number(meta.baseRevision)||0),remoteRevision});

      // Status/Refresh is read-only. It may calculate schema-7 reconciliation
      // state, but it never advances/persists the common base.
      if(decision==="converged"||decision==="advance")return markStatus("IN_SYNC",`Desktop and My Cloud Tournaments match at revision r${remoteRevision}. Press SYNC to persist any repaired base metadata.`,{remoteRevision});
      if(decision==="pull")return markStatus("REMOTE_CHANGES","Cloud contains newer changes. Press SYNC.",{remoteRevision});
      if(decision==="push")return markStatus("LOCAL_CHANGES","Desktop has changes ready to synchronize. Press SYNC.",{remoteRevision});
      pendingConflict={response,localName:name,local:clone(t),remote:clone(remoteTournament(response).tournament),remoteName:remoteTournament(response).name,remoteHash,remoteRevision,baseHash:base.hash};
      return markStatus("CONFLICT","Desktop and Cloud both contain changes. Nothing has been overwritten.",{remoteRevision});
    }

    function structuralIntentAllowsPush(meta,remoteRevision){
      const intent=meta?.pendingStructuralSync;if(!intent||typeof intent!=="object")return false;
      const kind=text(intent.kind);if(kind!=="reset-tournament"&&kind!=="delete-round")return false;
      if(text(intent.cloudTournamentId)!==text(meta.cloudTournamentId))return false;
      return Math.max(0,Number(intent.baseRevision)||0)===Math.max(0,Number(remoteRevision)||0);
    }

    async function pushDesktopToCloud({unified=false,allowStructuralIntent=false}={}){
      const name=currentName(),t=currentTournament();if(!name||!t)throw new Error("No tournament is open.");
      ensureTournamentName(name,t);
      if(typeof saveAll==="function")saveAll();
      if(typeof fileSaveTournament==="function"){
        const saved=await fileSaveTournament(true);
        if(!saved)throw new Error("Local save failed. Push was cancelled before any Cloud write.");
      }
      const token=await getToken();if(!token)throw new Error("Organizer Token is not connected.");
      const prepared=await prepareRemoteForPush(token,name,t,{unified});const meta=prepared.meta;let response=null;
      try{response=await api.getCurrentSnapshot(token,meta.cloudTournamentId);}catch(error){if(error?.status!==404&&error?.code!=="not_found")throw error;}

      const localHash=await localFingerprint(name,t);let remoteHash="",remoteRevision=0,remote={};
      if(response?.snapshot){remote=response.tournament||{};remoteRevision=Math.max(0,Number(remote.revision)||0);remoteHash=await remoteFingerprint(response);}

      if(remoteHash){
        const base=await resolvedBase(token,meta,response,remoteRevision,remoteHash,name);
        const decision=reconcileDecision({
          localHash,baseHash:base.hash,remoteHash,
          localRevision:Math.max(0,Number(base?.revision)||Number(meta.baseRevision)||0),remoteRevision
        });

        if(decision==="converged"||decision==="advance"){
          const before=captureBaseMeta(meta);
          core.updateSyncBase(meta,{revision:remoteRevision,contentHash:remoteHash,checksum:remote.checksum,updatedAt:remote.updatedAt});
          meta.lastPushAt=new Date().toISOString();meta.remoteRevision=remoteRevision;
          await persistBaseDurably(t,before,"Desktop and Cloud already match, but the repaired schema-7 common base could not be saved to the managed tournament file.");
          markStatus("IN_SYNC",`Desktop and Cloud already match at revision r${remoteRevision}.`,{remoteRevision});
          return {ok:true,unchanged:true,revision:remoteRevision,contentFingerprint:remoteHash};
        }
        if(decision==="pull"){
          markStatus("REMOTE_CHANGES","Cloud contains newer changes. Pull Cloud → Desktop first.",{remoteRevision});
          return {ok:false,blocked:true,state:"REMOTE_CHANGES",revision:remoteRevision};
        }
        if(decision==="conflict"){
          meta.remoteRevision=remoteRevision;
          if(!(allowStructuralIntent&&structuralIntentAllowsPush(meta,remoteRevision))){
            markStatus("CONFLICT","Desktop and Cloud both contain changes. Push stopped safely.",{remoteRevision});
            return {ok:false,blocked:true,state:"CONFLICT",revision:remoteRevision};
          }
          // Explicit Reset Tournament/Delete Round intent may replace the Cloud
          // snapshot only while Cloud is still exactly at the revision recorded
          // when the destructive local action was confirmed. PUT below still has
          // the normal optimistic revision race gate.
          markStatus("LOCAL_CHANGES",`Publishing confirmed ${text(meta.pendingStructuralSync?.kind)} from Desktop…`,{remoteRevision});
        }
        if(decision==="remote-behind"){
          markStatus("REMOTE_CHANGES","Cloud snapshot is older than the stored common base. Push was stopped.",{remoteRevision});
          return {ok:false,blocked:true,state:"REMOTE_CHANGES",revision:remoteRevision};
        }
        // DESKTOP_ONLY continues to PUT on the current remote revision.
      }else if(Math.max(0,Number(meta.baseRevision)||0)>0){
        markStatus("REMOTE_CHANGES","Cloud snapshot is unavailable for the expected base. Push was stopped.",{remoteRevision});return {ok:false,blocked:true};
      }

      const snapshot=core.cloudScopedSnapshot(name,t);
      const expectedRevision=remoteRevision;
      const result=await api.putSnapshot(token,{tournamentId:meta.cloudTournamentId,baseRevision:expectedRevision,snapshot,deviceId:"",deviceLabel:"Windows Desktop"});
      const putRevision=Math.max(0,Number(result?.revision ?? result?.tournament?.revision)||expectedRevision);
      const acceptedCloudId=text(result?.cloudTournamentId||result?.tournament?.id||meta.cloudTournamentId);
      const acceptedInternalId=text(result?.internalId||result?.tournament?.localKey||meta.internalId);
      const confirmed=await confirmRemoteEqualsLocal(token,acceptedCloudId,localHash,putRevision);
      const newRevision=confirmed.revision;
      const acceptedFingerprint=confirmed.hash;
      const before=captureBaseMeta(meta);
      core.updateSyncBase(meta,{
        revision:newRevision,
        contentHash:acceptedFingerprint,
        checksum:confirmed.remote?.checksum||result?.checksum||result?.tournament?.checksum,
        updatedAt:confirmed.remote?.updatedAt||result?.updatedAt||result?.tournament?.updatedAt,
        cloudTournamentId:acceptedCloudId,
        internalId:acceptedInternalId
      });
      meta.lastPushAt=new Date().toISOString();meta.remoteRevision=newRevision;
      delete meta.pendingStructuralSync;

      try{
        await persistBaseDurably(
          t,before,
          `Cloud accepted revision ${newRevision}, but the new common base could not be saved to the managed tournament file. The next SYNC will repair it from equal schema-7 Cloud content.`
        );
      }catch(error){
        error.code=error.code||"cloud_post_upload_checkpoint_failed";
        error.cloudRevision=newRevision;
        throw error;
      }

      markStatus("IN_SYNC",`Pushed Desktop → Cloud · revision r${newRevision}`,{remoteRevision:newRevision});
      return {...(result||{}),ok:true,revision:newRevision,contentFingerprint:acceptedFingerprint,cloudTournamentId:acceptedCloudId,internalId:acceptedInternalId};
    }

    async function downloadWebResults(){
      const name=currentName(),t=currentTournament();if(!name||!t)throw new Error("No tournament is open.");
      ensureTournamentName(name,t);const meta=metaOf(t);persistMeta();
      const token=await getToken();if(!token)throw new Error("Organizer Token is not connected.");
      const identity=await reconcileRemoteIdentity(token,name,t,{createIfMissing:false});
      if(identity.state==="UNLINKED"){const synced=await syncCurrent();return {ok:!!synced?.ok,unchanged:true,applied:0,synced:true,revision:Number(synced?.revision)||0};}
      // beta.91: A Trash restore is a visibility/identity recovery event, not a
      // Web-results import event. The restored snapshot may legitimately be an
      // older pairing state than the current Desktop tournament. Running the
      // result-only matcher here would raise a false Pairing mismatch before
      // schema-7 three-way SYNC can decide push/pull/merge/conflict. Delegate
      // directly to unified SYNC; the ordinary mismatch guard remains intact
      // for every normal Download Results operation.
      if(identity.state==="RESTORED_FROM_TRASH"){
        const synced=await syncCurrent();
        return {...(synced||{}),restoredFromTrash:true,applied:0,synced:!!synced?.ok};
      }
      let response;
      try{response=await api.getCurrentSnapshot(token,meta.cloudTournamentId);}
      catch(error){
        if((error?.status===404||error?.code==="not_found")&&Math.max(0,Number(identity.row?.revision)||0)===0){const synced=await syncCurrent();return {ok:!!synced?.ok,unchanged:true,applied:0,synced:true,revision:Number(synced?.revision)||0};}
        throw error;
      }
      const remote=response?.tournament||{};
      const remoteRevision=Math.max(0,Number(remote.revision)||0);
      const rt=remoteTournament(response);
      const plan=planWebResultDownload(t,rt.tournament);

      // Unsupported remote result encodings remain blocked before any full-state
      // reconciliation. beta.92 changes pairing orchestration only; it does not
      // weaken the result-value validation boundary.
      if(plan.invalid.length){
        const first=plan.invalid[0];
        throw new Error(`Web contains an unsupported result on Round ${first.round}, Board ${first.board}: ${first.result}. Nothing was changed.`);
      }

      // beta.92: result-only import is permitted only while Desktop still
      // represents the immutable common base. Structural local edits such as
      // Reset Tournament, Delete Round, a newly generated round, manual pairing
      // corrections or other tournament edits must be reconciled by the full
      // schema-7 three-way SYNC before any board-result mapping is attempted.
      // This prevents a stale Cloud pairing from producing a false mismatch and
      // also prevents a Web result from ever being applied to a locally changed
      // board identity.
      const preflightLocalHash=await localFingerprint(name,t);
      const preflightRemoteHash=await remoteFingerprint(response);
      const preflightBase=await resolvedBase(token,meta,response,remoteRevision,preflightRemoteHash,name);
      const preflightDecision=reconcileDecision({
        localHash:preflightLocalHash,baseHash:preflightBase.hash,remoteHash:preflightRemoteHash,
        localRevision:Math.max(0,Number(preflightBase?.revision)||Number(meta.baseRevision)||0),remoteRevision
      });
      if(!preflightBase.hash || preflightLocalHash!==preflightBase.hash || preflightDecision==="remote-behind"){
        const synced=await syncCurrent();
        return {...(synced||{}),delegatedToUnified:true,applied:0,synced:!!synced?.ok};
      }

      meta.remoteRevision=remoteRevision;persistMeta();

      // A pairing mismatch means this is not a result-only delta. Do not try to
      // map a result onto the wrong board; hand the entire state to unified SYNC.
      // If Desktop is unchanged it will safely pull the Cloud structure. If both
      // sides changed it will merge independent fields or fail closed on a true
      // same-field conflict.
      if(plan.mismatches.length){
        const synced=await syncCurrent();
        return {...(synced||{}),delegatedToUnified:true,pairingMismatchDelegated:true,applied:0,synced:!!synced?.ok};
      }
      if(!plan.operations.length){
        const localHash=await localFingerprint(name,t),remoteHash=await remoteFingerprint(response);
        if(localHash===remoteHash){
          core.updateSyncBase(meta,{revision:remoteRevision,contentHash:localHash,checksum:remote.checksum,updatedAt:remote.updatedAt});
          meta.lastPullAt=new Date().toISOString();persistMeta();
          markStatus("IN_SYNC",`No new Web results to download · Desktop already matches cloud revision r${remoteRevision}.`,{remoteRevision});
        }else{
          markStatus("REMOTE_CHANGES",`No new Web results to download. Other Desktop/Cloud differences remain; use Pull Cloud → Desktop before Push.`,{remoteRevision});
        }
        const synced=await syncCurrent();
        return {ok:true,unchanged:true,applied:0,revision:Number(synced?.revision)||remoteRevision,synced:true};
      }

      if(plan.conflicts.length){
        const preview=plan.conflicts.slice(0,5).map(op=>`Round ${op.round}, Board ${op.board}: Desktop ${op.localResult} → Web ${op.remoteResult}`).join("\n");
        const more=plan.conflicts.length>5?`\n…and ${plan.conflicts.length-5} more changed result(s).`:"";
        const message=`${plan.operations.length} Web result change(s) are available. ${plan.conflicts.length} already have a different Desktop result.\n\n${preview}${more}\n\nReplace the differing Desktop result values with the Web results? Pairings, players and tournament settings will not be changed.`;
        let approved=false;
        if(typeof window.appConfirm==="function")approved=!!(await window.appConfirm(message,"Download Results","warning"));
        else approved=!!window.confirm?.(message);
        if(!approved)return {ok:false,cancelled:true,applied:0,revision:remoteRevision};
      }

      for(const op of plan.operations)applyRemoteResultState(op.target,op.remoteState);
      try{stateDirty=true;}catch(_){ }
      try{if(typeof saveData==="function")saveData();}catch(_){ }
      try{if(typeof recalculateRoundHistoryState==="function")recalculateRoundHistoryState();}catch(_){ }
      try{if(typeof renderLivePairings==="function")renderLivePairings(true);}catch(_){ }
      try{if(typeof updateGacruxPanel==="function")updateGacruxPanel();}catch(_){ }
      try{if(typeof refreshFinalStandings==="function")refreshFinalStandings();}catch(_){ }
      try{if(typeof refreshPairingStandingsPanel==="function")refreshPairingStandingsPanel();}catch(_){ }
      try{if(typeof resetFinalStandingsPromptIfNeeded==="function")resetFinalStandingsPromptIfNeeded();}catch(_){ }
      try{window.scheduleTieBreakCheckerAutoCheck?.(250);}catch(_){ }
      if(typeof fileSaveTournament==="function"){
        const saved=await fileSaveTournament(true);
        if(!saved)throw new Error("Web results were applied in memory, but the local tournament file could not be saved. Save the tournament before continuing.");
      }

      const localHash=await localFingerprint(name,t);
      const remoteHash=await remoteFingerprint(response);
      meta.lastPullAt=new Date().toISOString();
      if(localHash===remoteHash){
        // Do not advance common-base metadata here. The unified SYNC below will
        // adopt and durably checkpoint the schema-7 base after proving equality.
        markStatus("IN_SYNC",`Downloaded ${plan.operations.length} Web result(s) · Desktop content now matches cloud revision r${remoteRevision}.`,{remoteRevision});
      }else{
        markStatus("REMOTE_CHANGES",`Downloaded ${plan.operations.length} Web result(s). Other Desktop/Cloud differences remain; use Pull Cloud → Desktop before Push.`,{remoteRevision});
      }
      const synced=await syncCurrent();
      return {ok:true,applied:plan.operations.length,conflicts:plan.conflicts.length,revision:Number(synced?.revision)||remoteRevision,synced:true};
    }

    async function pullCloudToDesktop(){
      const name=currentName(),t=currentTournament();if(!name||!t)throw new Error("No tournament is open.");
      ensureTournamentName(name,t);const meta=metaOf(t);
      const token=await getToken();if(!token)throw new Error("Organizer Token is not connected.");
      const identity=await reconcileRemoteIdentity(token,name,t,{createIfMissing:false});
      if(identity.state==="UNLINKED")return {ok:false,blocked:true,state:"UNLINKED",status:markStatus("UNLINKED","This tournament is not in My Cloud Tournaments. Use SYNC first.")};
      let response;
      try{response=await api.getCurrentSnapshot(token,meta.cloudTournamentId);}
      catch(error){
        if((error?.status===404||error?.code==="not_found")&&Math.max(0,Number(identity.row?.revision)||0)===0)return {ok:false,blocked:true,state:"UNLINKED",status:markStatus("UNLINKED","This Cloud tournament has no uploaded snapshot yet. Use SYNC first.")};
        throw error;
      }

      const remote=response?.tournament||{};
      const remoteRevision=Math.max(0,Number(remote.revision)||0);
      const rt=remoteTournament(response);
      const localHash=await localFingerprint(name,t);
      const remoteHash=await remoteFingerprint(response);
      const base=await resolvedBase(token,meta,response,remoteRevision,remoteHash,name);
      const decision=reconcileDecision({
        localHash,baseHash:base.hash,remoteHash,
        localRevision:Math.max(0,Number(base?.revision)||Number(meta.baseRevision)||0),remoteRevision
      });
      meta.remoteRevision=remoteRevision;

      if(decision==="converged"||decision==="advance"){
        const before=captureBaseMeta(meta);
        core.updateSyncBase(meta,{revision:remoteRevision,contentHash:remoteHash,checksum:remote.checksum,updatedAt:remote.updatedAt});
        meta.lastPullAt=new Date().toISOString();
        await persistBaseDurably(t,before,"Desktop and Cloud are equal, but the schema-7 common base could not be saved to the managed tournament file.");
        markStatus("IN_SYNC",`Pulled Cloud revision r${remoteRevision} → Desktop (already identical).`,{remoteRevision});
        return {ok:true,unchanged:true,revision:remoteRevision};
      }

      if(decision==="pull"){
        const imported=clone(rt.tournament);imported.name=text(imported.name||rt.name)||rt.name;
        const clean=await commitLocalTournament(name,imported,{baseRevision:remoteRevision,baseFingerprint:remoteHash,remoteChecksum:remote.checksum,remoteUpdatedAt:remote.updatedAt,status:"IN_SYNC",message:`Pulled Cloud revision r${remoteRevision} → Desktop`});
        const confirmedLocalHash=await localFingerprint(clean.name||name,clean);
        if(confirmedLocalHash!==remoteHash)throw new Error("Pulled Cloud state was saved, but the durable Desktop tournament does not match the Cloud fingerprint.");
        syncTrace("pull-postcondition",{cloudTournamentId:metaOf(clean).cloudTournamentId,internalId:metaOf(clean).internalId,baseRevision:remoteRevision,remoteRevision,decision:"equal"});
        metaOf(clean).lastPullAt=new Date().toISOString();
        // lastPullAt is UI metadata; the common base was already durably saved by
        // commitLocalTournament. Browser persistence is secondary only.
        persistMeta();renderStatus();return {ok:true,pulled:true,revision:remoteRevision};
      }

      if(decision==="push"){
        markStatus("LOCAL_CHANGES","Desktop has unpublished changes. Use SYNC/Push Desktop → Cloud.",{remoteRevision});
        return {ok:true,skipped:true,localChanges:true,revision:remoteRevision};
      }

      if(decision==="remote-behind"){
        throw new Error(`Cloud revision ${remoteRevision} is older than the local sync base ${Math.max(0,Number(meta.baseRevision)||0)}. No data was overwritten.`);
      }

      // True BOTH_CHANGED only. Stop fail-closed and require explicit conflict
      // resolution even when the field-level merge would be mechanically
      // non-overlapping. The three-way merger remains available inside the
      // resolver, but unified SYNC never auto-publishes two-sided edits.
      let baseTournamentValue=null,merge=null;
      if(Math.max(0,Number(base?.revision)||Number(meta.baseRevision)||0)>0)baseTournamentValue=await baseTournament(token,meta,base?.revision);
      if(baseTournamentValue){
        merge=mergeThreeWay(core.tournamentContentForFingerprint(baseTournamentValue),core.tournamentContentForFingerprint(t),core.tournamentContentForFingerprint(rt.tournament));
      }
      pendingConflict={response,localName:name,local:clone(t),remote:clone(rt.tournament),remoteName:rt.name,remoteHash,remoteRevision,baseHash:base.hash,base:baseTournamentValue?clone(baseTournamentValue):null,merge};
      markStatus("CONFLICT","Desktop and Cloud both contain independent changes. Nothing has been overwritten. Resolve Conflict is required.",{remoteRevision});
      return {ok:false,conflict:true,bothChanged:true,revision:remoteRevision};
    }

    async function syncCurrent(){
      const name=currentName(),t=currentTournament();if(!name||!t)throw new Error("No tournament is open.");
      ensureTournamentName(name,t);
      if(typeof saveAll==="function")saveAll();

      // Durability gate: no Cloud PUT, link creation, or common-base advancement
      // is allowed until the exact current Desktop tournament has reached the
      // managed tournament file/native filesystem.
      if(typeof fileSaveTournament==="function"){
        const saved=await fileSaveTournament(true);
        if(!saved)throw new Error("Local managed-file checkpoint failed. SYNC was cancelled before any Cloud write.");
      }else{
        throw new Error("Managed tournament file save is unavailable. SYNC was cancelled.");
      }

      const token=await getToken();if(!token)throw new Error("Organizer Token is not connected.");
      const prepared=await prepareRemoteForPush(token,name,t,{unified:true});const meta=prepared.meta;
      let response=null;
      try{response=await api.getCurrentSnapshot(token,meta.cloudTournamentId);}catch(error){if(error?.status!==404&&error?.code!=="not_found")throw error;}
      if(!response?.snapshot){
        return pushDesktopToCloud({unified:true});
      }

      const remote=response.tournament||{};
      const remoteRevision=Math.max(0,Number(remote.revision)||0);
      const localHash=await localFingerprint(name,t);
      const remoteHash=await remoteFingerprint(response);
      const base=await resolvedBase(token,meta,response,remoteRevision,remoteHash,name);
      const decision=reconcileDecision({
        localHash,baseHash:base.hash,remoteHash,
        localRevision:Math.max(0,Number(base?.revision)||Number(meta.baseRevision)||0),remoteRevision
      });
      meta.remoteRevision=remoteRevision;
      syncTrace("unified-decision",{cloudTournamentId:meta.cloudTournamentId,internalId:meta.internalId,baseRevision:Math.max(0,Number(base?.revision)||Number(meta.baseRevision)||0),remoteRevision,decision});

      if(decision==="converged"||decision==="advance"){
        const before=captureBaseMeta(meta);
        core.updateSyncBase(meta,{revision:remoteRevision,contentHash:remoteHash,checksum:remote.checksum,updatedAt:remote.updatedAt});
        await persistBaseDurably(
          t,before,
          "Desktop and Cloud content are equal, but the repaired schema-7 common base could not be saved to the managed tournament file."
        );
        return {ok:true,unchanged:true,revision:remoteRevision,status:markStatus("IN_SYNC",`NO-OP · Already current at revision r${remoteRevision}`,{remoteRevision})};
      }

      if(decision==="pull"){
        const pulled=await pullCloudToDesktop();
        return {...(pulled||{}),synced:true,direction:"pull"};
      }

      if(decision==="push"){
        const pushed=await pushDesktopToCloud({unified:true});
        return {...(pushed||{}),synced:true,direction:"push"};
      }

      if(decision==="remote-behind"){
        throw new Error(`Cloud revision ${remoteRevision} is older than the local sync base ${Math.max(0,Number(meta.baseRevision)||0)}. No data was overwritten.`);
      }

      if(decision==="conflict"&&!base.hash&&structuralIntentAllowsPush(meta,remoteRevision)){
        const pushed=await pushDesktopToCloud({unified:true,allowStructuralIntent:true});
        return {...(pushed||{}),synced:!!pushed?.ok,direction:pushed?.ok?"structural-push":"conflict",structuralIntent:true};
      }

      // BOTH_CHANGED: attempt a deterministic three-way merge before stopping.
      // This is the normal arbiter workflow when Web has a result update while
      // Desktop has already generated the next round. Independent changes must
      // be preserved together; only a true same-field collision is a conflict.
      let baseTournamentValue=null,merge=null;
      if(Math.max(0,Number(base?.revision)||Number(meta.baseRevision)||0)>0)baseTournamentValue=await baseTournament(token,meta,base?.revision);
      if(baseTournamentValue){
        merge=mergeThreeWay(
          core.tournamentContentForFingerprint(baseTournamentValue),
          core.tournamentContentForFingerprint(t),
          core.tournamentContentForFingerprint(remoteTournament(response).tournament)
        );
      }

      if(merge&&Array.isArray(merge.conflicts)&&merge.conflicts.length===0){
        const merged={...clone(t),...clone(merge.value)};
        merged.name=text(merged.name||name)||name;
        const clean=await commitLocalTournament(name,merged,{
          baseRevision:remoteRevision,
          baseFingerprint:remoteHash,
          remoteChecksum:remote.checksum,
          remoteUpdatedAt:remote.updatedAt,
          status:"LOCAL_CHANGES",
          message:`Auto-merged independent Desktop + Web changes at r${remoteRevision}. Publishing merged tournament…`
        });
        const mergedName=text(clean?.name||name)||name;
        const mergedRoundCount=Object.keys(clean?.pairings?.liveBoards||{}).length;
        const pushed=await pushDesktopToCloud({unified:true});
        return {...(pushed||{}),ok:true,synced:true,direction:"merge-push",autoMerged:true,mergedRoundCount,tournamentName:mergedName};
      }

      // A missing immutable base or a real same-field collision remains fail-closed.
      // Reuse the existing resolver path; no Cloud write occurs before the user
      // explicitly resolves the conflicting value(s).
      const pulled=await pullCloudToDesktop();
      if(pulled?.conflict){try{openConflictDialog();}catch(error){console.warn("Conflict resolver UI could not open:",error);}return {...pulled,synced:false,direction:"conflict"};}
      return {...(pulled||{}),synced:!pulled?.conflict,direction:pulled?.conflict?"conflict":"pull"};
    }

    async function resolveMissingBaseWholeTournament(side){
      const p=pendingConflict;if(!p)throw new Error("No synchronization conflict is pending.");
      if(side!=="desktop"&&side!=="cloud")throw new Error("Choose Desktop or Cloud.");

      if(side==="cloud"){
        const clean=await commitLocalTournament(p.localName,clone(p.remote),{
          baseRevision:p.remoteRevision,
          baseFingerprint:p.remoteHash,
          remoteChecksum:p.response?.tournament?.checksum,
          remoteUpdatedAt:p.response?.tournament?.updatedAt,
          status:"IN_SYNC",
          message:`Kept the complete Cloud tournament at r${p.remoteRevision}; Desktop was replaced only after explicit confirmation.`
        });
        try{if(clean?.cloud)delete clean.cloud.pendingStructuralSync;}catch(_){ }
        pendingConflict=null;persistMeta();renderStatus();
        return {ok:true,wholeTournament:true,kept:"cloud",revision:p.remoteRevision};
      }

      const name=currentName(),t=currentTournament();
      if(!name||!t||name!==p.localName)throw new Error("The active Desktop tournament changed. Resolve the conflict again.");
      ensureTournamentName(name,t);
      if(typeof saveAll==="function")saveAll();
      if(typeof fileSaveTournament==="function"){
        const saved=await fileSaveTournament(true);
        if(!saved)throw new Error("Local save failed. Cloud was not changed.");
      }else throw new Error("Managed tournament file save is unavailable. Cloud was not changed.");

      const token=await getToken();if(!token)throw new Error("Organizer Token is not connected.");
      const meta=metaOf(t);const cloudId=text(meta.cloudTournamentId);
      if(!cloudId||cloudId!==text(p.response?.tournament?.id||p.response?.cloudTournamentId||cloudId)){
        throw new Error("Cloud tournament identity changed. Nothing was overwritten.");
      }

      // Race gate: the exact remote snapshot shown in the resolver must still be
      // current when Keep Desktop is confirmed. Otherwise require a fresh resolve.
      const latest=await api.getCurrentSnapshot(token,cloudId);
      const latestRevision=Math.max(0,Number(latest?.tournament?.revision)||0);
      const latestHash=await remoteFingerprint(latest);
      if(latestRevision!==Math.max(0,Number(p.remoteRevision)||0)||latestHash!==text(p.remoteHash).toLowerCase()){
        throw new Error(`Cloud changed to revision r${latestRevision} while the conflict dialog was open. Nothing was overwritten. Run SYNC again.`);
      }

      const localHash=await localFingerprint(name,t);
      const result=await api.putSnapshot(token,{
        tournamentId:cloudId,
        baseRevision:latestRevision,
        snapshot:core.cloudScopedSnapshot(name,t),
        deviceId:"",deviceLabel:"Windows Desktop"
      });
      const newRevision=Math.max(0,Number(result?.revision??result?.tournament?.revision)||latestRevision);
      const acceptedFingerprint=text(result?.contentFingerprint||result?.tournament?.contentFingerprint||localHash).toLowerCase()||localHash;
      const before=captureBaseMeta(meta);
      core.updateSyncBase(meta,{
        revision:newRevision,
        contentHash:acceptedFingerprint,
        checksum:result?.checksum||result?.tournament?.checksum,
        updatedAt:result?.updatedAt||result?.tournament?.updatedAt,
        cloudTournamentId:text(result?.cloudTournamentId||result?.tournament?.id||cloudId),
        internalId:text(result?.internalId||result?.tournament?.localKey||meta.internalId)
      });
      delete meta.pendingStructuralSync;
      meta.lastPushAt=new Date().toISOString();meta.remoteRevision=newRevision;
      await persistBaseDurably(t,before,`Cloud accepted revision ${newRevision}, but the new common base could not be saved locally.`);
      pendingConflict=null;
      markStatus("IN_SYNC",`Kept the complete Desktop tournament → Cloud · revision r${newRevision}`,{remoteRevision:newRevision});
      renderStatus();
      return {ok:true,wholeTournament:true,kept:"desktop",revision:newRevision};
    }

    async function saveResolvedConflict(choices){
      if(!pendingConflict)throw new Error("No synchronization conflict is pending.");
      const p=pendingConflict;if(!p.base)throw new Error("The base revision is unavailable; automatic field-level merge cannot be completed safely.");
      const merge=p.merge||mergeThreeWay(core.tournamentContentForFingerprint(p.base),core.tournamentContentForFingerprint(p.local),core.tournamentContentForFingerprint(p.remote));
      const resolved=applyConflictChoices(merge.value,merge.conflicts,choices);
      const merged={...clone(p.local),...resolved};merged.name=text(merged.name||p.localName);
      const clean=await commitLocalTournament(p.localName,merged,{baseRevision:p.remoteRevision,baseFingerprint:p.remoteHash,remoteChecksum:p.response?.tournament?.checksum,remoteUpdatedAt:p.response?.tournament?.updatedAt,status:"LOCAL_CHANGES",message:"Conflict resolved and merged version saved locally. Use Push Desktop → Cloud to publish it."});
      metaOf(clean).lastPullAt=new Date().toISOString();persistMeta();pendingConflict=null;renderStatus();return {ok:true,localOnly:true};
    }

    function openConflictDialog(){
      if(!pendingConflict)return;
      const merge=pendingConflict.merge;
      document.getElementById("cloudConflictResolverDialog")?.remove();
      if(!merge){
        const overlay=document.createElement("div");overlay.id="cloudConflictResolverDialog";overlay.className="cloud-conflict-overlay";
        overlay.innerHTML=`<div class="cloud-conflict-card"><h3>⚠ Common sync base unavailable</h3><p>Chess-Publisher cannot prove the historical common revision needed for a safe field-by-field merge. Nothing has been overwritten.</p><p><b>Choose one complete tournament only.</b> No fields or results will be mixed between the two copies.</p><div class="cloud-conflict-fields"><div class="cloud-field-conflict"><b>Desktop</b><p>Keep the complete tournament currently open on this PC and replace the current Cloud snapshot.</p></div><div class="cloud-field-conflict"><b>Cloud</b><p>Keep the complete current Cloud tournament and replace this Desktop copy.</p></div></div><div class="toolbar"><button data-action="cancel">Cancel</button><button data-action="whole-cloud">Keep Cloud entire tournament</button><button data-action="whole-desktop" class="primary">Keep Desktop entire tournament</button></div></div>`;
        overlay.addEventListener("click",async event=>{
          const btn=event.target.closest("button[data-action]");if(!btn)return;
          if(btn.dataset.action==="cancel"){overlay.remove();return;}
          const side=btn.dataset.action==="whole-desktop"?"desktop":btn.dataset.action==="whole-cloud"?"cloud":"";if(!side)return;
          overlay.querySelectorAll("button").forEach(b=>b.disabled=true);
          try{await resolveMissingBaseWholeTournament(side);overlay.remove();}
          catch(error){window.alert?.(error?.message||String(error));overlay.querySelectorAll("button").forEach(b=>b.disabled=false);}
        });
        document.body?.appendChild(overlay);return;
      }
      const overlay=document.createElement("div");overlay.id="cloudConflictResolverDialog";overlay.className="cloud-conflict-overlay";
      const choices={};
      const independent=Array.isArray(merge.conflicts)&&merge.conflicts.length===0;
      overlay.innerHTML=independent
        ? `<div class="cloud-conflict-card"><h3>⚠ Synchronization Conflict</h3><p>Desktop and Cloud both changed independently. Chess-Publisher stopped safely instead of auto-publishing a merge. Review the merged version, then save it locally before a later SYNC publishes it.</p><div class="cloud-conflict-fields"><div class="cloud-field-conflict"><b>No same-field collisions were detected.</b><p>The deterministic three-way merge can be saved locally only after this explicit confirmation.</p></div></div><div class="toolbar"><button data-action="cancel">Cancel</button><button data-action="save" class="primary">Save merged version locally</button></div></div>`
        : `<div class="cloud-conflict-card"><h3>⚠ Synchronization Conflict</h3><p>Desktop and Cloud both changed. Nothing has been overwritten. Choose each conflicting field, then save the merged version locally.</p><div class="cloud-conflict-fields"></div><div class="toolbar"><button data-action="cancel">Cancel</button><button data-action="save" class="primary" disabled>Save merged version locally</button></div></div>`;
      const fields=overlay.querySelector(".cloud-conflict-fields");
      const display=v=>v===undefined?"(not set)":typeof v==="object"?JSON.stringify(v,null,2):String(v);
      for(const c of merge.conflicts||[]){
        const row=document.createElement("div");row.className="cloud-field-conflict";row.innerHTML=`<b>Conflict: ${c.path||"Tournament"}</b><div class="cloud-conflict-values"><div><span>Desktop</span><pre></pre><button data-choice="local">Keep Desktop</button></div><div><span>Cloud</span><pre></pre><button data-choice="remote">Keep Cloud</button></div></div>`;
        row.querySelectorAll("pre")[0].textContent=display(c.local);row.querySelectorAll("pre")[1].textContent=display(c.remote);
        row.addEventListener("click",event=>{const btn=event.target.closest("button[data-choice]");if(!btn)return;choices[c.path]=btn.dataset.choice;row.querySelectorAll("button[data-choice]").forEach(b=>b.classList.toggle("primary",b===btn));overlay.querySelector("button[data-action=save]").disabled=Object.keys(choices).length!==(merge.conflicts||[]).length;});fields?.appendChild(row);
      }
      overlay.addEventListener("click",async event=>{const btn=event.target.closest("button[data-action]");if(!btn)return;if(btn.dataset.action==="cancel")overlay.remove();if(btn.dataset.action==="save"){btn.disabled=true;try{await saveResolvedConflict(choices);overlay.remove();}catch(error){window.alert?.(error.message);btn.disabled=false;}}});
      document.body?.appendChild(overlay);
    }

    function openInWeb(){try{window.open(WEB_APP_URL,"_blank","noopener");}catch(_){location.href=WEB_APP_URL;}}

    function simpleCloudMessage(){
      const state=currentStatus.state||"OFFLINE";
      const map={
        IN_SYNC:"Current tournament is synchronized.",
        LOCAL_CHANGES:"Desktop has changes. Press SYNC.",
        REMOTE_CHANGES:"Cloud has changes. Press SYNC.",
        CONFLICT:"Desktop and Cloud both changed. SYNC stopped safely and requires conflict resolution.",
        UNLINKED:"Current tournament is not connected to Cloud yet. Press SYNC.",
        COPY_LINK_MISMATCH:"Current tournament needs one-time Cloud identity repair. Press SYNC.",
        OFFLINE:"Cloud status is unavailable. Local tournament remains safe."
      };
      return map[state]||text(currentStatus.message);
    }
    function renderSimpleCloudControls(){
      const t=currentTournament();const name=currentName();const meta=t?metaOf(t):{};
      const current=document.getElementById("cloudListCurrentTournament");if(current)current.textContent=name?`Current Desktop: ${name}`:"No Desktop tournament open";
      const status=document.getElementById("cloudListFriendlyStatus");if(status){status.textContent=simpleCloudMessage();status.className=`cloud-list-friendly-status cloud-list-${String(currentStatus.state||"OFFLINE").toLowerCase()}`;}
      const sync=document.getElementById("cloudSyncCurrentBtn");if(sync){sync.disabled=!t;sync.textContent="↕ SYNC";}
    }
    async function refreshSimpleCloudList(){
      if(typeof window.cpCloudRefreshList==="function")await window.cpCloudRefreshList({quiet:true});
      simplifyCloudRows();renderSimpleCloudControls();
    }
    async function syncCurrentFromList(){
      // Keep the My Cloud Tournaments SYNC button on the exact same
      // result-aware pipeline as the Pairings SYNC button: first import
      // validated arbiter/Web results, then continue through the existing
      // unified syncCurrent() logic inside downloadWebResults().
      const result=await downloadWebResults();
      await refreshSimpleCloudList();
      if(result?.conflict&&!document.getElementById("cloudConflictResolverDialog"))openConflictDialog();
      return result;
    }

    function simplifyCloudRows(){
      const body=document.getElementById("cloudTournamentBody");if(!body)return;
      const table=body.closest("table");const head=table?.querySelector("thead tr");
      if(head&&head.children.length>4)while(head.children.length>4)head.lastElementChild.remove();
      const current=currentTournament();const meta=current?metaOf(current):{};
      for(const row of Array.from(body.querySelectorAll("tr"))){
        while(row.children.length>4)row.lastElementChild.remove();
        const btn=row.querySelector('button[data-cloud-action="open"]');if(!btn)continue;
        const id=text(btn.dataset.cloudId);const isCurrent=!!current&&text(meta.cloudTournamentId)===id;
        row.classList.toggle("cloud-current-row",isCurrent);
        const nameCell=row.children[0];if(nameCell){nameCell.querySelector(".cloud-current-tag")?.remove();if(isCurrent){const tag=document.createElement("span");tag.className="cloud-current-tag";tag.textContent="Current";nameCell.appendChild(tag);}}
        btn.textContent=isCurrent?"Current":"Open";if(isCurrent)btn.disabled=true;
      }
      const empty=body.querySelector('tr td[colspan="5"]');if(empty)empty.setAttribute("colspan","4");
    }
    async function openCloudRowSafely(id){
      id=text(id);if(!id)return false;
      const token=await getToken();if(!token)throw new Error("Organizer Token is not connected.");
      const listed=await api.listTournaments(token);const rows=Array.isArray(listed?.tournaments)?listed.tournaments:[];
      const row=rows.find(item=>text(item?.id)===id);
      if(!row)throw new Error("This Cloud tournament is no longer present in My Cloud Tournaments. Refresh the list.");
      const current=currentTournament();
      if(current){
        const meta=metaOf(current);const sameLogical=text(row.localKey)&&text(row.localKey)===text(meta.internalId);
        if(sameLogical){
          if(text(meta.cloudTournamentId)!==id){clearRemoteLink(meta);meta.cloudTournamentId=id;meta.remoteRevision=Math.max(0,Number(row.revision)||0);persistMeta();}
          const result=await pullCloudToDesktop();if(result?.conflict)openConflictDialog();await refreshSimpleCloudList();return result;
        }
      }
      if(typeof window.cpCloudOpenTournament!=="function")throw new Error("Cloud tournament open action is unavailable.");
      const result=await window.cpCloudOpenTournament(id);await refreshSimpleCloudList();return result;
    }

    function installUi(){
      const page=document.getElementById("cloudWorkspace");if(!page)return false;
      const body=document.getElementById("cloudTournamentBody");if(!body)return false;
      const listSection=body.closest(".groupbox")||body.parentElement;

      // The Cloud UI has one user-facing surface only: My Cloud Tournaments.
      // IDs, revision-base diagnostics, auto-backup controls and the old sync
      // dashboard remain internal implementation details and are not displayed.
      for(const child of Array.from(page.children))if(child!==listSection)child.style.display="none";
      if(listSection)listSection.style.display="block";
      const title=listSection?.querySelector(".group-title");if(title)title.textContent="My Cloud Tournaments";
      const eyebrow=listSection?.querySelector(".cloud-section-eyebrow");if(eyebrow)eyebrow.style.display="none";

      const head=listSection?.querySelector(".cloud-section-head");
      if(head&&!document.getElementById("cloudSyncCurrentBtn")){
        document.getElementById("cloudUploadCurrentBtn")?.remove();
        document.getElementById("cloudPullCurrentBtn")?.remove();
        const actions=document.createElement("div");actions.className="cloud-list-actions";
        const sync=document.createElement("button");sync.id="cloudSyncCurrentBtn";sync.className="primary";sync.type="button";sync.textContent="↕ SYNC";sync.title="Safely synchronize the current tournament in the required direction.";
        const web=document.createElement("button");web.id="cloudListOpenWebBtn";web.type="button";web.textContent="Open Web";
        const refresh=document.getElementById("cloudRefreshBtn");
        actions.append(sync);if(refresh)actions.append(refresh);actions.append(web);head.appendChild(actions);
        sync.addEventListener("click",()=>syncCurrentFromList().catch(async error=>{markStatus(error?.code==="network_error"?"OFFLINE":"CONFLICT",text(error?.message)||"SYNC failed.");renderSimpleCloudControls();if(typeof window.appAlert==="function")await window.appAlert(text(error?.message)||"SYNC failed.","My Cloud Tournaments","warning");}));
        web.addEventListener("click",openInWeb);
      }
      if(listSection&&!document.getElementById("cloudListCurrentTournament")){
        const hint=listSection.querySelector(".cloud-list-hint");
        const current=document.createElement("div");current.id="cloudListCurrentTournament";current.className="cloud-list-current";
        const status=document.createElement("div");status.id="cloudListFriendlyStatus";status.className="cloud-list-friendly-status";
        if(hint){hint.insertAdjacentElement("afterend",current);current.insertAdjacentElement("afterend",status);}else{listSection.prepend(status);listSection.prepend(current);}
      }

      if(!document.getElementById("cloudIronStyles")){
        const style=document.createElement("style");style.id="cloudIronStyles";style.textContent=`
          #cloudWorkspace{margin-top:8px}.cloud-list-actions{display:flex;gap:7px;flex-wrap:wrap;align-items:center;justify-content:flex-end}.cloud-list-current{font-weight:800;margin:7px 0 3px}.cloud-list-friendly-status{margin:0 0 8px;padding:7px 9px;border:1px solid #c9d2dc;border-radius:7px;background:#f7f9fb;font-size:11px}.cloud-list-in_sync{border-color:#9bc69b;background:#f2faf2}.cloud-list-local_changes,.cloud-list-remote_changes{border-color:#9fc0df;background:#f4f9ff}.cloud-list-conflict{border-color:#d9a351;background:#fff8e8}.cloud-current-tag{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:#e9f4ff;color:#0f5d96;font-size:9px;font-weight:800;vertical-align:1px}.cloud-current-row{background:#f8fbff}.cloud-table-frame{max-height:340px}.hub-online-list-compact{display:none!important}.hub-online-list-compact .hub-section-eyebrow{display:none!important}.cp-new-tournament-online,#cpNewTournamentOnlinePanel{display:none!important}
        `;document.head.appendChild(style);
      }

      if(!body.__cpIronOpenCapture){
        body.__cpIronOpenCapture=true;
        body.addEventListener("click",event=>{
          const btn=event.target.closest('button[data-cloud-action="open"]');if(!btn)return;
          event.preventDefault();event.stopImmediatePropagation();
          openCloudRowSafely(btn.dataset.cloudId).catch(async error=>{if(typeof window.appAlert==="function")await window.appAlert(text(error?.message)||"Open failed.","My Cloud Tournaments","warning");});
        },true);
      }
      if(!body.__cpIronObserver&&typeof MutationObserver!=="undefined"){
        body.__cpIronObserver=new MutationObserver(()=>simplifyCloudRows());body.__cpIronObserver.observe(body,{childList:true,subtree:false});
      }

      for(const selectorId of ["mainTournamentSelect","registrationTournamentSelect","pairingsTournamentSelect","chessResultsTournamentSelect","standingsTournamentSelect","scheduleTournamentSelect","exportTournamentSelect"]){
        const selector=document.getElementById(selectorId);if(selector&&!selector.__cpIronCloudRender){selector.__cpIronCloudRender=true;selector.addEventListener("change",()=>setTimeout(renderSimpleCloudControls,0));}
      }
      simplifyCloudRows();renderSimpleCloudControls();return true;
    }

    const oldOpen=window.cpCloudWorkspaceOpen;
    window.cpCloudWorkspaceOpen=async function(){
      const result=typeof oldOpen==="function"?await oldOpen.apply(this,arguments):null;
      setTimeout(async()=>{
        installUi();renderStatus();
        try{await checkCloudStatus();}catch(error){if(error?.code==="network_error")markStatus("OFFLINE","Cloud is unavailable. Local tournament remains safe.");else console.warn("Cloud status validation:",error);}
        try{await refreshSimpleCloudList();}catch(_){ }
      },0);
      return result;
    };
    window.cpCloudPullCloudToDesktop=pullCloudToDesktop;
    window.cpCloudDownloadWebResults=downloadWebResults;
    window.cpCloudPushDesktopToCloud=pushDesktopToCloud;
    window.cpCloudCheckStatus=checkCloudStatus;
    window.cpCloudResolveConflict=openConflictDialog;
    window.cpCloudResolveWholeTournament=resolveMissingBaseWholeTournament;
    // beta.78 user contract: one SYNC action. Directional exports stay
    // available only for protected legacy integrations and regression tests.
    window.cpCloudPullChanges=pullCloudToDesktop;
    // beta.93: explicit single-authority marker consumed by the legacy adapter.
    // It prevents the current tournament from being reconciled by two different
    // conflict engines in the same runtime.
    syncCurrent.__cpUnifiedSyncAuthorityV2=true;
    window.cpCloudSyncCurrent=syncCurrent;
    window.cpCloudSyncUnified=syncCurrent;
    window.ChessPublisherCloudDirectionalInternals=Object.freeze({mergeThreeWay,applyConflictChoices,captureLocalFields,restoreLocalFields,ensureTournamentName,statusLabel,canonicalWebResult,canonicalWebUnusual,resultState,applyRemoteResultState,planWebResultDownload,reconcileRemoteIdentity,recoverArchivedRemoteIdentity,resolveIdentity,clearRemoteLink,syncCurrent,resolveMissingBaseWholeTournament,structuralIntentAllowsPush});
    setTimeout(()=>{installUi();renderStatus();},0);
  }catch(error){console.error("Chess-Publisher directional Cloud sync:",error);}
})();
