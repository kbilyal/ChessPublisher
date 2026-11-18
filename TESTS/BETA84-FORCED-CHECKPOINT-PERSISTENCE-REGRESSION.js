"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"ChessPublisher.html"),"utf8");
const dir=fs.readFileSync(path.join(root,"webview","CloudWorkspaceRedesign.js"),"utf8");
let pass=0,fail=0;
function check(cond,label){if(cond){console.log(`PASS: ${label}`);pass++;}else{console.error(`FAIL: ${label}`);fail++;}}
function extractFunction(name){
  const needles=[`async function ${name}(`,`function ${name}(`];let start=-1;
  for(const needle of needles){start=html.indexOf(needle);if(start>=0)break;}
  if(start<0)throw new Error(`Function ${name} not found`);
  const brace=html.indexOf("{",start);let depth=0,quote=null,esc=false,templateDepth=0;
  for(let i=brace;i<html.length;i++){
    const c=html[i],n=html[i+1];
    if(quote){if(esc){esc=false;continue;}if(c==="\\"){esc=true;continue;}if(quote==="`"&&c==="$"&&n==="{"){templateDepth++;depth++;i++;continue;}if(c===quote&&templateDepth===0){quote=null;continue;}if(quote==="`"&&c==="}"&&templateDepth>0){templateDepth--;depth--;continue;}continue;}
    if(c==='"'||c==="'"||c==="`"){quote=c;templateDepth=0;continue;}
    if(c==="{")depth++;else if(c==="}"){depth--;if(depth===0)return html.slice(start,i+1);}
  }
  throw new Error(`Function ${name} not terminated`);
}
const executeSrc=extractFunction("cpExecutePersistentSave");
const localBackupSrc=extractFunction("writeLocalBackup");

async function runPersistenceCase({nativeOk,serverOk,idbOk,localOk}){
  const order=[];
  const context={
    console:{log(){},warn(){},error(){}},JSON,Date,
    autosaveEnabled:true,cpStateRevision:10,cpPersistenceCompletedSequence:0,stateDirty:true,lastCommittedSnapshot:null,
    cpIsTournamentContextCurrent:()=>true,
    writeServerSnapshot:async()=>{order.push("managed-server");if(serverOk instanceof Error)throw serverOk;return !!serverOk;},
    cpWriteNativeTournamentFile:async()=>{order.push("managed-native");if(nativeOk instanceof Error)throw nativeOk;return !!nativeOk;},
    cpUpdateNativeFileLabel(){},
    idbWriteSnapshot:async()=>{order.push("recovery-idb");if(!idbOk)throw Object.assign(new Error("quota"),{name:"QuotaExceededError"});return true;},
    writeLocalBackup:()=>{order.push("recovery-localStorage");return !!localOk;},
    setSaveIndicator(){},setStatus(){},appAlert(){},
  };
  vm.createContext(context);vm.runInContext(executeSrc,context);
  const job={snapshot:{data:{tournaments:{T:{}}}},saveContext:{name:"T",nativeHandle:{}},showStatus:false,force:true,revision:10,sequence:1};
  const ok=await context.cpExecutePersistentSave(job);
  return {ok,order};
}

(async()=>{
  // PERSIST-01
  const p1=await runPersistenceCase({nativeOk:true,serverOk:false,idbOk:true,localOk:false});
  check(p1.ok===true,"PERSIST-01 forced checkpoint succeeds when native managed-file write succeeds and localStorage recovery fails");
  check(p1.order.indexOf("managed-native")>=0&&p1.order.indexOf("recovery-localStorage")>p1.order.indexOf("managed-native"),"PERSIST-01 browser recovery runs only after managed-file durability");
  check(p1.order.indexOf("recovery-idb")>=0&&p1.order.indexOf("recovery-idb")<p1.order.indexOf("recovery-localStorage"),"PERSIST-01 IndexedDB is preferred before localStorage recovery");

  // Exercise the real localStorage recovery helper with an actual quota throw.
  {
    const quotaContext={
      console:{warn(){}},JSON,autosaveEnabled:true,
      APP_STORAGE_KEY:"app",APP_BACKUP_KEY:"backup",STORAGE_KEY:"core",TELEGRAM_GLOBAL_KEY:"tg",AUTOSAVE_PREF_KEY:"auto",
      localStorage:{getItem(){return null;},setItem(){const e=new Error("quota exceeded");e.name="QuotaExceededError";throw e;}}
    };
    vm.createContext(quotaContext);vm.runInContext(localBackupSrc,quotaContext);
    check(quotaContext.writeLocalBackup({data:{},telegramGlobal:{}})===false,"PERSIST-01 real localStorage QuotaExceededError is downgraded to recovery-shadow failure");
  }

  // PERSIST-02 managed file failure must fail closed and not promote browser recovery.
  const p2=await runPersistenceCase({nativeOk:false,serverOk:false,idbOk:true,localOk:true});
  check(p2.ok===false,"PERSIST-02 forced checkpoint fails when both managed-file targets fail");
  check(!p2.order.includes("recovery-idb")&&!p2.order.includes("recovery-localStorage"),"PERSIST-02 failed managed checkpoint does not persist a newer browser recovery/common-base snapshot");

  // Source-level gate: fileSaveTournament suppresses saveData browser persistence during forced capture.
  check(/cpManagedCheckpointCaptureDepth\+\+;[\s\S]*?saveAll\(\)[\s\S]*?writePersistentState\(!silent,true\)/.test(html),"PERSIST-02 fileSaveTournament(true) synchronizes UI in memory before forced write without browser durability proof");
  check(/if\(cpManagedCheckpointCaptureDepth>0\)return;/.test(html),"PERSIST-02 saveData browser write is suppressed during forced checkpoint capture");

  // SYNC must stop before Cloud PUT when fileSaveTournament(true) fails.
  check(/fileSaveTournament\(true\)[\s\S]*?if\(!saved\)throw new Error\("Local managed-file checkpoint failed\. SYNC was cancelled before any Cloud write\."\)[\s\S]*?prepareRemoteForPush/.test(dir),"PERSIST-02 unified SYNC durability gate precedes Cloud link/PUT work");

  console.log(`BETA84 FORCED CHECKPOINT PERSISTENCE: ${fail?"FAIL":"PASS"} (${pass} PASS / ${fail} FAIL)`);
  process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
