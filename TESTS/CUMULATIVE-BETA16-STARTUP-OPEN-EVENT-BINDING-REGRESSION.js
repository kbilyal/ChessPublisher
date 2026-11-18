"use strict";
const fs=require("fs");
const path=require("path");
const vm=require("vm");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"ChessPublisher.html"),"utf8");
const hub=fs.readFileSync(path.join(root,"webview","HubAdapter.js"),"utf8");
const cloud=fs.readFileSync(path.join(root,"webview","CloudWorkspaceAdapter.js"),"utf8");
const assert=(v,m)=>{if(!v)throw new Error(`FAIL: ${m}`);console.log(`PASS: ${m}`);};

// Cumulative chooser/token contract.
assert(/data-chesspublisher-version="1\.06\.00-beta\.(?:19|[2-9][0-9]|[1-9][0-9]{2,})(?:-r\d+)?"/.test(html),"visible desktop branding is beta.19 or newer cumulative");
assert(/id="cpNewSwissChoice"/.test(html)&&/>Swiss Dutch</.test(html),"Swiss Dutch chooser remains present");
assert(/id="cpNewRoundRobinChoice"/.test(html)&&/>Round Robin</.test(html),"Round Robin chooser remains present");
assert(/id="cpNewOnlineChoice"/.test(html)&&/>Open My Online Tournaments</.test(html),"Open My Online Tournaments chooser remains present");
assert((hub.match(/id="hubOrganizerToken"/g)||[]).length===1,"exactly one visible Organizer Token input remains");
assert(!/id="cloud[^"]*Token/i.test(cloud),"private Cloud still adds no duplicate token input");
assert(/ChessPublisherOnline_InstallScope_v1/.test(hub)&&/ChessPublisherOnline_InstallScope_v1/.test(cloud),"installation-scoped Organizer Token contract remains shared");
assert(/const PATCH_VERSION="1\.06\.00-beta\.12"/.test(html),"beta.12 Smart Schedule repair provenance remains intact");
assert(/CP-BETA15-LOCAL-OPEN-CANCEL-RECOVERY/.test(html),"beta.15 local-open cancel recovery remains present");

// beta.16 startup binding fix.
assert(/CP-BETA16-STARTUP-OPEN-EVENT-BINDING-FIX/.test(html),"beta.16 startup binding fix marker exists");
assert(/function cpFinishStartupOpenFromNewDialog\(\)[\s\S]*modal\?\.dataset\.mode!=="startup"[\s\S]*bindEvents\(\)[\s\S]*modal\.dataset\.mode="opened"/.test(html),"startup open completes deferred core event binding exactly for startup mode");
assert(/else if\(opened===true\)\{\s*cpFinishStartupOpenFromNewDialog\(\)/.test(html),"successful local startup open completes deferred binding");
assert(/else if\(opened!==false\)cpFinishStartupOpenFromNewDialog\(\)/.test(html),"successful online startup open completes deferred binding");

// New chooser online open must not race on double-click/concurrent click.
assert(/let cpNewTournamentOnlineOpenBusy=false/.test(html),"online chooser has its own open-operation busy guard");
assert(/if\(cpNewTournamentOnlineOpenBusy\)return false/.test(html),"duplicate online open is rejected while one is active");
assert(/if\(window\.__cpOnlineCloudBusy\)/.test(html),"chooser also respects an already-running Online & Cloud operation");
assert(/cpSetNewTournamentOnlineOpenBusy\(true\)/.test(html)&&/finally\{\s*cpSetNewTournamentOnlineOpenBusy\(false\)/.test(html),"online chooser disables and restores open controls around the operation");

const start=html.indexOf('// CP-BETA16-STARTUP-OPEN-EVENT-BINDING-FIX');
const end=html.indexOf('\nasync function changeTournament',start);
assert(start>=0&&end>start,"beta.16 startup/open wrapper can be isolated for runtime checks");
const code='let cpNewTournamentOnlineOpenBusy=false;\n'+html.slice(start,end);

function makeContext({mode="startup",localResult=true,onlineImpl=async()=>"Opened"}={}){
  const modal={dataset:{mode},style:{display:"flex"},attrs:{},setAttribute(k,v){this.attrs[k]=v;}};
  const swiss={focusCalls:0,focus(){this.focusCalls++;}};
  const refresh={disabled:false};
  const openButtons=[{disabled:false},{disabled:false}];
  let bindCount=0;
  const ctx={
    console,
    window:null,globalThis:null,
    document:{
      getElementById(id){if(id==="createScreen")return modal;if(id==="cpNewSwissChoice")return swiss;if(id==="cpNewOnlineRefreshBtn")return refresh;if(id==="cpNewOnlineState")return {textContent:""};return null;},
      querySelectorAll(sel){return sel===".cp-new-online-open"?openButtons:[];}
    },
    bindEvents(){bindCount++;},
    fileOpenTournament:async()=>localResult,
    setTimeout(fn){fn();},
    showTab(){},
  };
  ctx.window=ctx;ctx.globalThis=ctx;ctx.cpCloudOpenTournament=onlineImpl;
  vm.createContext(ctx);vm.runInContext(code,ctx);
  return {ctx,modal,swiss,refresh,openButtons,getBindCount:()=>bindCount};
}

(async()=>{
  {
    const t=makeContext({mode:"startup",localResult:true});
    const ok=await t.ctx.openLocalTournamentFromNewDialog();
    assert(ok===true,"startup local open succeeds");
    assert(t.getBindCount()===1,"startup local open binds core UI events once");
    assert(t.modal.dataset.mode==="opened","startup local open marks deferred binding completed");
    t.ctx.cpFinishStartupOpenFromNewDialog();
    assert(t.getBindCount()===1,"completed startup binding cannot be duplicated by a second completion call");
  }
  {
    const t=makeContext({mode:"new",localResult:true});
    const ok=await t.ctx.openLocalTournamentFromNewDialog();
    assert(ok===true,"normal local open succeeds");
    assert(t.getBindCount()===0,"normal post-startup local open does not duplicate core listeners");
  }
  {
    const t=makeContext({mode:"startup",localResult:false});
    const ok=await t.ctx.openLocalTournamentFromNewDialog();
    assert(ok===false,"cancelled startup local open reports false");
    assert(t.getBindCount()===0,"cancelled startup local open does not bind core listeners prematurely");
    assert(t.modal.style.display==="flex","cancelled startup local open restores chooser");
  }
  {
    let resolveOpen;let calls=0;
    const pending=new Promise(resolve=>{resolveOpen=resolve;});
    const t=makeContext({mode:"startup",onlineImpl:async()=>{calls++;return pending;}});
    const first=t.ctx.openOnlineTournamentFromNewDialog("cloud-1");
    const second=await t.ctx.openOnlineTournamentFromNewDialog("cloud-1");
    assert(second===false,"second online open click is rejected while first is pending");
    assert(calls===1,"double-click cannot start two cloud-open operations");
    assert(t.openButtons.every(b=>b.disabled)&&t.refresh.disabled,"online open controls stay disabled while operation is pending");
    resolveOpen("Opened");
    const firstResult=await first;
    assert(firstResult===true,"first online open completes successfully");
    assert(t.getBindCount()===1,"successful startup online open completes deferred core event binding");
    assert(t.openButtons.every(b=>!b.disabled)&&!t.refresh.disabled,"online open controls are restored after operation completion");
  }
  console.log("CLOUD-WORKSPACE-BETA16-STARTUP-OPEN-EVENT-BINDING-REGRESSION: PASS");
})().catch(error=>{console.error(error);process.exit(1);});
