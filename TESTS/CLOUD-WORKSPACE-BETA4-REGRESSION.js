"use strict";

const fs=require("fs");
const path=require("path");
const vm=require("vm");
const {webcrypto}=require("crypto");

const root=path.resolve(__dirname,"..");
const adapterPath=path.join(root,"webview","CloudWorkspaceAdapter.js");
const hubPath=path.join(root,"webview","HubAdapter.js");
const code=fs.readFileSync(adapterPath,"utf8");
const hubCode=fs.readFileSync(hubPath,"utf8");

class CloudError extends Error{
  constructor(message,details={}){super(message);this.code=details.code||"cloud_api_error";this.currentRevision=details.currentRevision??null;this.response=details.response||null;}
}
const clone=v=>JSON.parse(JSON.stringify(v));
function assert(condition,label){if(!condition)throw new Error(`FAIL: ${label}`);console.log(`PASS: ${label}`);}
function snapshot(name,tournament){const t=clone(tournament);delete t.cloud;return {version:"V99",data:{currentTournament:name,tournaments:{[name]:t},preferences:{}},telegramGlobal:{},currentTournament:name,preferences:{},cloudWorkspace:{schemaVersion:2,scope:"single-tournament",private:true}};}

function contextFor(api,data,storage={}){
  const store=new Map(Object.entries(storage));
  const context={
    console:{log:console.log,warn(){},error(){}},crypto:webcrypto,TextEncoder,setTimeout,clearTimeout,setInterval,clearInterval,
    navigator:{platform:"Win32"},
    localStorage:{getItem(k){return store.has(k)?store.get(k):null;},setItem(k,v){store.set(k,String(v));}},
    document:{querySelector(){return null;},getElementById(){return null;},head:{appendChild(){}},createElement(){return {}; }},
    data,telegramGlobal:{},stateDirty:false,
    getCurrentTournament(){return context.data.tournaments[context.data.currentTournament]||null;},
    getPersistentSnapshot(){return {version:"V99",data:clone(context.data),telegramGlobal:{},currentTournament:context.data.currentTournament,preferences:clone(context.data.preferences||{})};},
    cpSnapshotForExternalFile:v=>clone(v),cpNativeHubSecretGet:async()=>"organizer-token",saveData(){},saveTelegramGlobal(){},loadAllFields(){},
    fileSaveTournament:async()=>true,cpValidateSnapshotStructure:()=>true,cpResetTournamentDocumentBinding(){},normalizeData(){},refreshEverything(){},
    loadAndNormalizeSnapshotObject(snap){context.data=clone(snap.data);return true;},showTab(){},prepareCurrentTournamentForTransition:async()=>true
  };
  context.window=context;context.globalThis=context;
  context.ChessPublisherCloudWorkspaceApi={createClient(){return api;},CloudWorkspaceApiError:CloudError};
  vm.createContext(context);vm.runInContext(code,context);
  return {context,store};
}

async function run(){
  assert(!/tab\.id="tabCloudWorkspace"/.test(code),"separate Cloud Workspace tab removed");
  assert(/Online & Cloud \(Beta\)/.test(code)&&/Online & Cloud \(Beta\)/.test(hubCode),"single merged Online & Cloud tab is the UI target");
  assert(/id="cloudPullChangesBtn"/.test(code),"Pull Changes button exists");
  assert(/Push-only cloud backup/.test(code),"automatic backup is explicitly push-only");
  assert(/Public Hub options/.test(hubCode)&&/Account tools/.test(hubCode),"secondary public/account actions moved behind compact options");
  assert(/id="hubPublishOnlineBtn"/.test(hubCode),"single smart Publish Online action exists");

  {
    const api={};
    const {context,store}=contextFor(api,{currentTournament:"T",tournaments:{T:{hub:{localKey:"cp:shared-hub"},cloud:{localKey:"cp-cloud:pc-only"}}},preferences:{}});
    const logic=context.ChessPublisherCloudSyncInternals;
    const meta=logic.ensureCloudMeta(context.data.tournaments.T);
    assert(meta.internalId==="cp:shared-hub","new private cloud identity reuses existing Hub logical ID");
    assert(meta.localKey==="cp-cloud:pc-only","installation-local key remains separate from internal ID");
    assert(store.get("ChessPublisherCloudWorkspace_AutoSync_v1")===undefined,"auto backup preference is not silently written");
  }

  {
    const api={};
    const {context}=contextFor(api,{currentTournament:"T",tournaments:{T:{cloud:{localKey:"legacy-local",cloudTournamentId:"cloud_legacy",revision:7}}},preferences:{}});
    const meta=context.ChessPublisherCloudSyncInternals.ensureCloudMeta(context.data.tournaments.T);
    assert(meta.internalId==="legacy-local","linked beta.1-beta.3 tournament migrates remote stable key without duplicate identity");
  }

  {
    const calls={create:0,put:0,list:0,createArg:null};
    const api={
      async workspace(){return {organizer:{id:"org1",displayName:"Organizer"},storage:{}};},
      async getSettings(){return {revision:0,settings:{}};},async putSettings(){return {revision:1,checksum:"s"};},
      async listTournaments(){calls.list++;return {tournaments:[]};},
      async createTournament(token,args){calls.create++;calls.createArg=clone(args);return {tournament:{id:"cloud_new",revision:0,checksum:""}};},
      async putSnapshot(token,args){calls.put++;return {revision:1,checksum:"x",updatedAt:"2026-09-03T14:00:00Z"};}
    };
    const local={hub:{localKey:"cp:logical-123"},cloud:{localKey:"cp-cloud:this-pc"},settings:{city:"A"}};
    const {context}=contextFor(api,{currentTournament:"T",tournaments:{T:local},preferences:{}});
    await context.cpCloudPullChanges();
    assert(calls.create===1&&calls.put===1,"Pull Changes safely initializes an unlinked tournament in cloud");
    assert(calls.createArg.localKey==="cp:logical-123","cloud record stores the shared internal tournament ID, not the PC-local key");
    assert(context.data.tournaments.T.cloud.internalId==="cp:logical-123","same internal ID is stored on this PC");
  }

  {
    const base={settings:{city:"Old"},cloud:{localKey:"pc-key",internalId:"cp:logical",cloudTournamentId:"cloud_1",ownerId:"org1",revision:5,lastSyncedContentHash:""}};
    const remote=clone(base);remote.settings.city="Remote";
    const api={
      async workspace(){return {organizer:{id:"org1",displayName:"Organizer"},storage:{}};},async getSettings(){return {revision:0,settings:{}};},
      async listTournaments(){return {tournaments:[]};},
      async getCurrentSnapshot(){return {tournament:{id:"cloud_1",localKey:"cp:logical",revision:6,checksum:"r",updatedAt:"2026-09-03T14:10:00Z"},snapshot:snapshot("T",remote)};},
      async getRevision(){return {tournament:{id:"cloud_1",revision:5},snapshot:snapshot("T",base)};},
      async putSnapshot(){throw new Error("background backup must not overwrite/pull this case");}
    };
    const {context}=contextFor(api,{currentTournament:"T",tournaments:{T:clone(base)},preferences:{}});
    // Establish the base hash exactly as a prior successful sync would.
    context.data.tournaments.T.cloud.lastSyncedContentHash=await context.ChessPublisherCloudSyncInternals.tournamentContentHash("T",base);
    // Change remote only. A quiet push-only autosync equivalent must not import it.
    const result=await context.cpCloudSyncCurrent({force:true,quiet:true,allowPull:false});
    assert(result.updateAvailable===true,"push-only background path marks a cloud update instead of pulling it");
    assert(context.data.tournaments.T.settings.city==="Old","background cloud backup never changes open tournament content");
  }

  console.log("CLOUD WORKSPACE BETA.4 REGRESSION: PASS");
}
run().catch(e=>{console.error(e);process.exit(1);});
