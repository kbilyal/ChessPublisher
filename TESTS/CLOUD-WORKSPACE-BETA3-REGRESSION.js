"use strict";

const fs=require("fs");
const path=require("path");
const vm=require("vm");
const {webcrypto}=require("crypto");

const adapterPath=path.resolve(__dirname,"..","webview","CloudWorkspaceAdapter.js");
const code=fs.readFileSync(adapterPath,"utf8");

class CloudError extends Error{
  constructor(message,details={}){
    super(message);
    this.code=details.code||"cloud_api_error";
    this.currentRevision=details.currentRevision??null;
    this.response=details.response||null;
  }
}

const clone=value=>JSON.parse(JSON.stringify(value));
function assert(condition,label){
  if(!condition)throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}

function cloudSnapshot(name,tournament,savedAt="2026-09-03T10:00:00Z"){
  const t=clone(tournament);delete t.cloud;
  return {
    version:"V99",savedAt,
    data:{currentTournament:name,tournaments:{[name]:t},preferences:{}},
    telegramGlobal:{},currentTournament:name,preferences:{},
    cloudWorkspace:{schemaVersion:1,scope:"single-tournament",private:true,clientVersion:"1.06.00-beta.2"}
  };
}

function baseContext(api,data){
  const context={
    console:{log:console.log,warn(){},error(){}},
    crypto:webcrypto,TextEncoder,setTimeout,clearTimeout,setInterval,clearInterval,
    navigator:{platform:"Win32"},
    localStorage:{getItem(){return null;},setItem(){}},
    document:{querySelector(){return null;},getElementById(){return null;},head:{appendChild(){}},createElement(){return {}; }},
    data,telegramGlobal:{},stateDirty:false,
    getCurrentTournament(){return context.data.tournaments[context.data.currentTournament]||null;},
    getPersistentSnapshot(){
      return {version:"V99",savedAt:new Date().toISOString(),data:clone(context.data),telegramGlobal:{},currentTournament:context.data.currentTournament,preferences:clone(context.data.preferences||{})};
    },
    cpSnapshotForExternalFile(value){return clone(value);},
    cpNativeHubSecretGet:async()=>"organizer-token",
    saveData(){},saveTelegramGlobal(){},loadAllFields(){},
    fileSaveTournament:async()=>true,
    cpValidateSnapshotStructure:()=>true,
    cpResetTournamentDocumentBinding(){},normalizeData(){},refreshEverything(){},
    loadAndNormalizeSnapshotObject(snapshot){context.data=clone(snapshot.data);return true;},
    showTab(){},prepareCurrentTournamentForTransition:async()=>true
  };
  context.window=context;
  context.globalThis=context;
  context.ChessPublisherCloudWorkspaceApi={createClient(){return api;},CloudWorkspaceApiError:CloudError};
  vm.createContext(context);
  vm.runInContext(code,context);
  return context;
}

async function run(){
  // Pure state-decision gate.
  {
    const api={};
    const ctx=baseContext(api,{currentTournament:"",tournaments:{},preferences:{}});
    const logic=ctx.ChessPublisherCloudSyncInternals;
    assert(!!logic,"cloud sync internals exported");
    assert(logic.decideReconciliation({localHash:"A",baseHash:"A",remoteHash:"A",localRevision:241,remoteRevision:243})==="converged","r241 -> r243 identical content is converged/NO-OP, not conflict");
    assert(logic.decideReconciliation({localHash:"A",baseHash:"A",remoteHash:"B",localRevision:241,remoteRevision:243})==="pull","cloud-only change pulls");
    assert(logic.decideReconciliation({localHash:"B",baseHash:"A",remoteHash:"A",localRevision:241,remoteRevision:243})==="push","local-only change pushes on current remote base");
    assert(logic.decideReconciliation({localHash:"B",baseHash:"A",remoteHash:"C",localRevision:241,remoteRevision:243})==="conflict","divergent local + cloud changes conflict");

    const sanitized=logic.sanitizeDownloadedTournament({
      settings:{organizer:"Kyamran Bilyal"},
      organizerToken:"SECRET",connectedOrganizer:"Kyamran Bilyal",deviceId:"source-pc",
      cloud:{ownerId:"source"},nested:{manageToken:"SECRET2",keep:"ok"}
    });
    assert(sanitized.settings.organizer==="Kyamran Bilyal","Tournament Setup organizer remains event metadata");
    assert(sanitized.organizerToken===undefined,"Organizer Token stripped from downloaded content");
    assert(sanitized.connectedOrganizer===undefined,"connected-organizer runtime identity stripped");
    assert(sanitized.deviceId===undefined,"source device identity stripped");
    assert(sanitized.cloud===undefined,"source private-cloud linkage stripped before local rebinding");
    assert(sanitized.nested.manageToken===undefined,"nested management credential stripped");

    ctx.getPersistentSnapshot=()=>({
      version:"V99",savedAt:new Date().toISOString(),
      data:{currentTournament:"T",tournaments:{T:{settings:{organizer:"Kyamran Bilyal"}}},preferences:{}},
      telegramGlobal:{token:"SECRET"},currentTournament:"T",preferences:{}
    });
    const scoped=logic.cloudScopedSnapshot("T",{settings:{organizer:"Kyamran Bilyal"},organizerToken:"SECRET",cloud:{revision:9}});
    assert(scoped.savedAt===undefined,"volatile savedAt excluded from private cloud snapshot");
    assert(scoped.telegramGlobal.token===undefined,"Telegram bot token excluded from private cloud snapshot");
    assert(scoped.data.tournaments.T.organizerToken===undefined,"tournament auth token excluded from private cloud snapshot");
  }

  const baseTournament={
    settings:{organizer:"Kyamran Bilyal",city:"Old"},players:[{name:"A"}],
    cloud:{localKey:"local-this-pc",cloudTournamentId:"cloud_1",ownerId:"org_current",revision:241,lastSyncedHash:"legacy-beta2-hash",lastSyncedAt:"2026-09-03T13:06:00Z"}
  };

  async function scenario(localTournament,baseSnap,currentSnap){
    const calls={putSnapshot:0,getCurrent:0,getRevision:0,putSettings:0};
    const remoteMeta={id:"cloud_1",revision:243,checksum:"remote-checksum",updatedAt:"2026-09-03T13:32:00Z",localKey:"source-pc-key"};
    const api={
      async workspace(){return {organizer:{id:"org_current",displayName:"Current Organizer"},storage:{tournamentCount:1,revisionCount:243}};},
      async getSettings(){return {revision:0,checksum:"",updatedAt:null,settings:{}};},
      async putSettings(){calls.putSettings++;return {revision:1,checksum:"settings",updatedAt:"2026-09-03T13:33:00Z"};},
      async getCurrentSnapshot(){calls.getCurrent++;return {tournament:clone(remoteMeta),snapshot:clone(currentSnap)};},
      async getRevision(token,id,revision){calls.getRevision++;if(revision!==241)throw new Error(`Unexpected base revision ${revision}`);return {tournament:{...remoteMeta,revision:241},snapshot:clone(baseSnap)};},
      async putSnapshot(token,args){calls.putSnapshot++;return {revision:244,checksum:"new-checksum",updatedAt:"2026-09-03T13:34:00Z"};},
      async createTournament(){throw new Error("createTournament should not be called in linked test");},
      async listTournaments(){return {tournaments:[]};}
    };
    const ctx=baseContext(api,{currentTournament:"T",tournaments:{T:clone(localTournament)},preferences:{}});
    return {ctx,calls};
  }

  // Exact reported screenshot class: local r241, cloud r243, no local content change.
  {
    const {ctx,calls}=await scenario(baseTournament,cloudSnapshot("T",baseTournament,"2026-09-03T13:06:00Z"),cloudSnapshot("T",baseTournament,"2026-09-03T13:32:00Z"));
    const result=await ctx.cpCloudSyncCurrent({force:true,quiet:false});
    assert(result.ok===true,"reported stale-revision sync succeeds");
    assert(calls.putSnapshot===0,"reported stale-revision sync creates no needless cloud revision");
    assert(ctx.data.tournaments.T.cloud.revision===243,"local sync base advances to cloud revision 243");
    assert(/^[0-9a-f]{64}$/.test(ctx.data.tournaments.T.cloud.lastSyncedContentHash),"stable content fingerprint established for legacy beta.2 link");
  }

  // Cloud-only change must fast-forward locally.
  {
    const remote=clone(baseTournament);remote.settings.city="Remote";
    const {ctx,calls}=await scenario(baseTournament,cloudSnapshot("T",baseTournament),cloudSnapshot("T",remote));
    const result=await ctx.cpCloudSyncCurrent({force:true,quiet:false});
    assert(result.pulled===true,"cloud-only content change pulls");
    assert(ctx.data.tournaments.T.settings.city==="Remote","pulled cloud content becomes local content");
    assert(ctx.data.tournaments.T.cloud.localKey==="local-this-pc","existing local installation key is preserved");
    assert(ctx.data.tournaments.T.connectedOrganizer===undefined,"download does not inject Connected organizer into tournament data");
    assert(calls.putSnapshot===0,"cloud-only pull does not overwrite the cloud");
  }

  // True two-sided change must fail closed.
  {
    const local=clone(baseTournament);local.settings.city="Local";
    const remote=clone(baseTournament);remote.settings.city="Remote";
    const {ctx,calls}=await scenario(local,cloudSnapshot("T",baseTournament),cloudSnapshot("T",remote));
    let error=null;
    try{await ctx.cpCloudSyncCurrent({force:true,quiet:false});}catch(e){error=e;}
    assert(error?.code==="cloud_true_conflict","only divergent two-sided edits produce true conflict");
    assert(ctx.data.tournaments.T.settings.city==="Local","true conflict preserves local content");
    assert(calls.putSnapshot===0,"true conflict performs no cloud overwrite");
  }


  // New local tournament must create cloud object and upload revision 1 without
  // trying to fetch a non-existent revision-0 snapshot first.
  {
    const calls={create:0,getCurrent:0,putSnapshot:0};
    const local={settings:{organizer:"Current Organizer",city:"New"},players:[]};
    const api={
      async workspace(){return {organizer:{id:"org_current",displayName:"Current Organizer"},storage:{tournamentCount:0,revisionCount:0}};},
      async getSettings(){return {revision:0,checksum:"",updatedAt:null,settings:{}};},
      async putSettings(){return {revision:1,checksum:"settings",updatedAt:"2026-09-03T13:33:00Z"};},
      async createTournament(){calls.create++;return {tournament:{id:"cloud_new",revision:0,checksum:"",updatedAt:null}};},
      async getCurrentSnapshot(){calls.getCurrent++;throw new Error("revision-0 snapshot must not be fetched");},
      async putSnapshot(token,args){calls.putSnapshot++;assert(args.baseRevision===0,"new tournament uploads from base revision 0");return {revision:1,checksum:"new-cloud-checksum",updatedAt:"2026-09-03T13:40:00Z"};},
      async listTournaments(){return {tournaments:[]};}
    };
    const ctx=baseContext(api,{currentTournament:"New T",tournaments:{"New T":clone(local)},preferences:{}});
    const result=await ctx.cpCloudSyncCurrent({force:true,quiet:false});
    assert(result.revision===1,"new local tournament creates first cloud revision");
    assert(calls.create===1,"new local tournament creates one cloud object");
    assert(calls.getCurrent===0,"new local tournament does not preflight missing revision-0 snapshot");
    assert(calls.putSnapshot===1,"new local tournament uploads exactly one snapshot");
  }

  console.log("CLOUD WORKSPACE BETA.3 REGRESSION: PASS");
}

run().catch(error=>{console.error(error);process.exit(1);});
