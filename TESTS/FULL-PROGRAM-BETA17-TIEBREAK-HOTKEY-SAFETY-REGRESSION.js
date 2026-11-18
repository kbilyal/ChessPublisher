"use strict";
const fs=require("fs");
const path=require("path");
const vm=require("vm");
const crypto=require("crypto");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"ChessPublisher.html"),"utf8");
const engine=fs.readFileSync(path.join(root,"ChessPublisher-LocalEngine.ps1"),"utf8");
const hub=fs.readFileSync(path.join(root,"webview","HubAdapter.js"),"utf8");
const cloud=fs.readFileSync(path.join(root,"webview","CloudWorkspaceAdapter.js"),"utf8");
const assert=(v,m)=>{if(!v)throw new Error(`FAIL: ${m}`);console.log(`PASS: ${m}`);};

assert(/data-chesspublisher-version="1\.06\.00-beta\.(?:19|[2-9][0-9]|[1-9][0-9]{2,})(?:-r\d+)?"/.test(html),"visible desktop branding is beta.19 or newer cumulative");
assert(/CP-BETA17-PAIRINGS-HOTKEY-SAFETY/.test(html),"pairings hotkey safety patch marker exists");
assert(/tag==="INPUT" \|\| tag==="TEXTAREA" \|\| tag==="SELECT"/.test(html),"pairings hotkeys ignore select controls as well as typing controls");
assert(/!!active\?\.isContentEditable/.test(html),"pairings hotkeys ignore contenteditable controls");
assert(/typing \|\| getTopmostVisibleDialog\(\)/.test(html),"pairings hotkeys are disabled while a modal dialog is visible");
assert(/setLiveResultByHotkey\("1 - 0"\)/.test(html)&&/setLiveResultByHotkey\("½ - ½"\)/.test(html)&&/setLiveResultByHotkey\("0 - 1"\)/.test(html),"existing result hotkey mappings are preserved");

assert(/CP-BETA17-TIEBREAK-INSTALL-PROBE/.test(engine),"Tie-Break installer probe patch marker exists");
assert(/& \$stagedExe '-h' 1> \$probeOut 2> \$probeErr/.test(engine),"Tie-Break installer probes the documented help switch");
assert(!/& \$stagedExe '-V'/.test(engine),"unsupported -V Tie-Break probe is removed");
assert(/\$probeText -match '\(\?i\)usage:'/.test(engine),"Tie-Break help probe validates usage output");
assert(/\$probeText -match '\(\?i\)\\\[-u\\s\+UNRATED\\\]'/.test(engine),"Tie-Break help probe validates unrated option signature");
assert(/Get-FileHash -LiteralPath \$zipPath -Algorithm SHA256/.test(engine)&&/Tie-Break Checker download SHA256 mismatch/.test(engine),"release ZIP SHA256 verification remains intact");
assert(/Get-FileHash -LiteralPath \$stagedExe -Algorithm SHA256/.test(engine),"installed executable SHA256 is still recorded");

function extractFunction(src,name){
  const re=new RegExp(`^function\\s+${name.replace(/[.*+?^${}()|[\\]\\]/g,"\\$&")}\\b.*$`,`m`);
  const m=re.exec(src);if(!m)return "";
  const start=m.index;const rest=src.slice(start+m[0].length);
  const next=/^function\s+\S+.*$/m.exec(rest);
  return src.slice(start,next?start+m[0].length+next.index:src.length);
}
const invoke=extractFunction(engine,"Invoke-TieBreakValidation");
assert(invoke.length>1000,"Tie-Break validation function is present");
assert(crypto.createHash("sha256").update(invoke).digest("hex")==="eb19ecbddf388449186649677131ab043a7b73bd9299b3b87295e887e899b800","Tie-Break validation/core invocation function remains byte-identical to beta.16 parent");

// Runtime exercise of the patched global Pairings keyboard handler.
const start=html.indexOf('document.addEventListener("keydown",function(e){',html.indexOf('CP-BETA17-PAIRINGS-HOTKEY-SAFETY')-700);
const end=html.indexOf('\nfunction liveResultOptions',start);
assert(start>=0&&end>start,"patched Pairings hotkey handler can be isolated");
const code=html.slice(start,end);
function runHotkey({tag="DIV",key="1",modal=false,contentEditable=false}){
  let handler=null,result=null,moved=0,prevented=0;
  const active={tagName:tag,isContentEditable:contentEditable};
  const ctx={
    document:{
      activeElement:active,
      getElementById(id){return id==="pairings"?{classList:{contains(v){return v==="active";}}}:null;},
      addEventListener(type,fn){if(type==="keydown")handler=fn;}
    },
    getTopmostVisibleDialog(){return modal?{}:null;},
    setLiveResultByHotkey(v){result=v;},
    moveLiveBoardSelection(){moved++;},
    console
  };
  ctx.window=ctx;ctx.globalThis=ctx;
  vm.createContext(ctx);vm.runInContext(code,ctx);
  assert(typeof handler==="function","Pairings keydown handler registered in runtime simulation");
  handler({key,target:active,preventDefault(){prevented++;}});
  return {result,moved,prevented};
}
assert(runHotkey({tag:"SELECT",key:"1"}).result===null,"numeric key in Pairings SELECT cannot record a result");
assert(runHotkey({tag:"DIV",key:"1",modal:true}).result===null,"numeric key while a modal is open cannot record a hidden result");
assert(runHotkey({tag:"DIV",key:"1",contentEditable:true}).result===null,"numeric key in contenteditable cannot record a result");
assert(runHotkey({tag:"DIV",key:"1"}).result==="1 - 0","normal Pairings board hotkey still records 1-0");
assert(runHotkey({tag:"DIV",key:"ArrowDown"}).moved===1,"normal Pairings navigation hotkey remains active");

assert(/ChessPublisherOnline_InstallScope_v1/.test(hub)&&/ChessPublisherOnline_InstallScope_v1/.test(cloud),"installation-scoped Organizer Token contract remains intact");
assert(/CP-BETA17-REGISTRATION-DELETE-MODAL-SAFETY/.test(html),"Registration Delete modal safety patch marker exists");
assert(/if\(getTopmostVisibleDialog\(\)\) return;[\s\S]{0,900}deleteSelectedPlayers\(\)/.test(html),"Registration Delete is blocked while a modal is visible");
assert(/CP-BETA16-STARTUP-OPEN-EVENT-BINDING-FIX/.test(html),"beta.16 startup-open fix remains present");
assert(/CP-BETA15-LOCAL-OPEN-CANCEL-RECOVERY/.test(html),"beta.15 local-open cancel recovery remains present");
assert(/const PATCH_VERSION="1\.06\.00-beta\.12"/.test(html),"beta.12 Smart Schedule repair provenance remains present");
console.log("FULL-PROGRAM-BETA17-TIEBREAK-HOTKEY-SAFETY-REGRESSION: PASS");
