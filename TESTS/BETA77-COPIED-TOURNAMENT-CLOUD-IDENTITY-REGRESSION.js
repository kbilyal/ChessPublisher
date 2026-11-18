"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto");
const root=path.resolve(__dirname,"..");
const adapterSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceAdapter.js"),"utf8");
const dirSrc=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
let pass=0,fail=0;
function check(cond,label){if(cond){console.log(`PASS: ${label}`);pass++;}else{console.error(`FAIL: ${label}`);fail++;}}
function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}
function notFound(){const e=new Error("not found");e.status=404;e.code="not_found";return e;}

check(/COPY_LINK_MISMATCH/.test(dirSrc),"copied/imported cloud-link mismatch has a dedicated safe state");
check(/Upload as New/.test(dirSrc),"copied/imported mismatch exposes Upload as New wording");
check(/detachAsIndependentCloudCopy/.test(dirSrc),"independent-copy detach helper exists");
check(/cp-cloud:\$\{uuid\(\)\}/.test(dirSrc)&&/cp-tournament:\$\{uuid\(\)\}/.test(dirSrc),"detaching a copy assigns fresh local and logical cloud identities");

function makeContext(api,tournament,{showMessage}={}){
  const data={currentTournament:tournament.name,tournaments:{[tournament.name]:tournament},preferences:{}};
  const fakeEl={addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},style:{},classList:{toggle(){}},appendChild(){},insertBefore(){},closest(){return null;}};
  const document={querySelector(){return null;},getElementById(){return null;},createElement(){return {...fakeEl,innerHTML:"",id:"",className:"",remove(){}};},head:fakeEl,body:fakeEl};
  const context={console:{log(){},warn(){},error(){}},crypto:crypto.webcrypto,TextEncoder,Headers,URL,navigator:{platform:"Win32"},document,localStorage:{getItem(){return null;},setItem(){}},data,stateDirty:false,
    getCurrentTournament:()=>data.tournaments[data.currentTournament],
    getPersistentSnapshot:()=>({version:"V99",data:clone(data),telegramGlobal:{},currentTournament:data.currentTournament,preferences:{}}),
    cpSnapshotForExternalFile:v=>clone(v),saveAll(){},fileSaveTournament:async()=>true,saveData(){},normalizeData(){},refreshEverything(){},cpResetTournamentDocumentBinding(){},
    cpValidateSnapshotStructure:()=>true,showTab(){},prepareCurrentTournamentForTransition:async()=>true,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},location:{href:""},alert(){},confirm:()=>true,
    showAppMessage:showMessage||undefined
  };
  context.window=context;context.globalThis=context;
  context.ChessPublisherCloudWorkspaceApi={createClient:()=>api,CloudWorkspaceApiError:class extends Error{constructor(m,d={}){super(m);Object.assign(this,d);}}};
  context.cpNativeHubSecretGet=async()=>"token";context.cpOnlineOrganizerSecretKey=()=>"organizer-primary:test";
  vm.createContext(context);vm.runInContext(adapterSrc,context,{filename:"CloudWorkspaceAdapter.js"});
  vm.runInContext(dirSrc,context,{filename:"CloudWorkspaceRedesign.js"});
  return context;
}
function copiedTournament(name="RC beta test (Imported)2"){
  return {name,settings:{city:"Sofia",rounds:7},players:[{id:"p1",name:"A"}],pairings:{liveBoards:{}},cloud:{schemaVersion:4,localKey:"copied-local-key",internalId:"golden-internal",cloudTournamentId:"golden-r15",revision:15,baseRevision:15,baseFingerprint:"golden-base",lastSyncedContentHash:"golden-base",lastSyncedHash:"golden-check"}};
}

(async()=>{
  // Exact user-reported shape: imported Desktop copy still carries Golden Rhodopes cloud identity.
  {
    let created=0,puts=0,oldWrites=0,newId="",newInternal="",newSnapshot=null,newRevision=0;
    const api={
      listTournaments:async()=>({tournaments:[
        {id:"golden-r3",localKey:"other-golden",name:"GOLDEN RHODOPES CHESS FESTIVAL 2026 – ZLATOGRAD Standard & Blitz | 5000€",revision:3},
        {id:"golden-r15",localKey:"golden-internal",name:"GOLDEN RHODOPES CHESS FESTIVAL 2026 – ZLATOGRAD | Standart & Blitz",revision:15,checksum:"golden-check",updatedAt:"2026-09-08T22:11:00Z"}
      ]}),
      createTournament:async(_t,args)=>{created++;newInternal=args.localKey;newId="rc-new";return {tournament:{id:newId,localKey:args.localKey,name:args.name,revision:0}};},
      getCurrentSnapshot:async(_t,id)=>{
        if(id===newId){
          if(!newSnapshot)throw notFound();
          return {tournament:{id,localKey:newInternal,name:"RC beta test (Imported)2",revision:newRevision,checksum:"rc-c1",updatedAt:"2026-09-09T14:50:00Z"},snapshot:clone(newSnapshot)};
        }
        if(id==="golden-r15")return {tournament:{id,localKey:"golden-internal",name:"GOLDEN RHODOPES CHESS FESTIVAL 2026 – ZLATOGRAD | Standart & Blitz",revision:15,checksum:"golden-check",updatedAt:"2026-09-08T22:11:00Z"},snapshot:{version:"V99",data:{currentTournament:"Golden",tournaments:{Golden:{name:"Golden",settings:{rounds:9},players:[],pairings:{liveBoards:{}}}}}}};
        throw notFound();
      },
      putSnapshot:async(_t,args)=>{
        puts++;
        if(args.tournamentId==="golden-r15")oldWrites++;
        check(args.tournamentId===newId,"copied Desktop tournament writes only to the newly created Cloud object");
        check(args.baseRevision===0,"copied Desktop tournament starts its new Cloud history at revision 0");
        newSnapshot=clone(args.snapshot);newRevision=1;
        return {revision:newRevision,checksum:"rc-c1",updatedAt:"2026-09-09T14:50:00Z"};
      }
    };
    const local=copiedTournament();const oldInternal=local.cloud.internalId,oldLocalKey=local.cloud.localKey;
    const ctx=makeContext(api,local);
    const status=await ctx.cpCloudCheckStatus();
    check(status.state==="COPY_LINK_MISMATCH","status identifies imported-copy link mismatch instead of claiming Cloud is newer");
    const result=await ctx.cpCloudPushDesktopToCloud();const meta=ctx.getCurrentTournament().cloud;
    check(result.ok===true&&result.revision===1,"Upload Current succeeds for imported copy without requiring Pull Current");
    check(created===1&&puts===1&&oldWrites===0,"exactly one new Cloud tournament is created and the original Golden tournament is never overwritten");
    check(meta.cloudTournamentId===newId,"Desktop copy is linked to its new Cloud tournament");
    check(meta.internalId!==oldInternal&&meta.localKey!==oldLocalKey,"Desktop copy receives fresh internalId and localKey");
    check(newInternal===meta.internalId,"new Cloud row is created with the fresh logical internalId");
    check(meta.baseRevision===1,"fresh Cloud upload establishes revision 1 as the new sync base");
  }

  // A normal renamed tournament must not be auto-detached. When the stored
  // fingerprint schema is old/missing and the current remote is still the
  // stored base revision, schema-7 treats the current remote as the
  // authoritative common base. The rename is therefore a Desktop-only edit
  // and must push to the existing linked Cloud object, never create a copy.
  {
    let created=0,asked=0,oldReads=0,puts=0,pushedSnapshot=null,pushedRevision=15;
    const local=copiedTournament("Renamed Championship");
    const api={
      listTournaments:async()=>({tournaments:[{id:"golden-r15",localKey:"golden-internal",name:"Original Championship",revision:15,checksum:"x"}]}),
      createTournament:async()=>{created++;return {tournament:{id:"new",revision:0}};},
      getCurrentSnapshot:async(_t,id)=>{
        oldReads++;
        if(pushedSnapshot)return {tournament:{id,localKey:"golden-internal",revision:pushedRevision,checksum:"rename-r16"},snapshot:clone(pushedSnapshot)};
        return {tournament:{id,localKey:"golden-internal",revision:15,checksum:"x"},snapshot:{version:"V99",data:{currentTournament:"Original Championship",tournaments:{"Original Championship":{name:"Original Championship",settings:{rounds:7},players:[],pairings:{liveBoards:{}}}}}}};
      },
      putSnapshot:async(_t,args)=>{
        puts++;
        pushedSnapshot=clone(args.snapshot);pushedRevision=16;
        check(args.tournamentId==="golden-r15","ordinary renamed tournament pushes only to its existing Cloud object");
        check(args.baseRevision===15,"ordinary renamed tournament pushes from authoritative current base revision 15");
        return {
          cloudTournamentId:"golden-r15",
          internalId:"golden-internal",
          revision:16,
          contentFingerprint:"a".repeat(64),
          checksum:"rename-r16",
          updatedAt:"2026-09-09T14:55:00Z"
        };
      }
    };
    const ctx=makeContext(api,local,{showMessage:async()=>{asked++;return false;}});
    const result=await ctx.cpCloudPushDesktopToCloud();
    check(asked===1,"ordinary name mismatch still asks the operator before changing copy/link semantics");
    check(created===0,"choosing Keep Existing Link does not create a duplicate Cloud tournament");
    check(ctx.getCurrentTournament().cloud.internalId==="golden-internal","Keep Existing Link preserves logical cloud identity");
    check(result.ok===true&&result.revision===16,"schema-7 treats rename as Desktop-only and pushes to existing linked tournament");
    check(oldReads===2&&puts===1,"existing linked remote is read once before write and once for authoritative post-write verification");
    check(ctx.getCurrentTournament().cloud.baseRevision===16&&ctx.getCurrentTournament().cloud.fingerprintContentSchema===7,"successful push establishes schema-7 revision 16 common base");
  }

  console.log(`BETA77 COPIED TOURNAMENT CLOUD IDENTITY: ${fail?"FAIL":"PASS"} (${pass} PASS / ${fail} FAIL)`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
