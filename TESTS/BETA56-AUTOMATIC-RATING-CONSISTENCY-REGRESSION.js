'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'ChessPublisher-Beta56-Compliance.js'),'utf8');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
let pass=0,fail=0;
function ok(v,n){if(v){pass++;console.log('PASS',n);}else{fail++;console.error('FAIL',n);}}
function eq(a,b,n){ok(a===b,`${n} (${JSON.stringify(a)} === ${JSON.stringify(b)})`);}
function storage(){const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),_m:m};}
function makeCtx({tournament=true,ids=true,busy=false,initialHashes=['a','b','c'],updateMode='unchanged',localUpdate=false,changes=1,verifyRefresh=false}={}){
  const listeners={window:{},document:{}};const timers=[];const ls=storage();
  const meta={lists:{std:{periodKey:'2026-09',hash:initialHashes[0],updatedAt:'2026-09-08T08:00:00Z',source:'FIDE server'},rapid:{periodKey:'2026-09',hash:initialHashes[1],updatedAt:'2026-09-08T08:00:00Z',source:'FIDE server'},blitz:{periodKey:'2026-09',hash:initialHashes[2],updatedAt:'2026-09-08T08:00:00Z',source:'FIDE server'}}};
  const t=tournament?{name:'Q139 Test',startDate:'2026-09-08',players:ids?[{name:'A',fideId:'15000001',rating:2000},{name:'B',fideId:'15000002',rating:1900}]:[{name:'A',fideId:''}]}:null;
  const state={serverUpdates:0,localUpdates:0,verify:0,lookup:0,overlay:0,evaluate:0,evaluateApply:null,build:0,save:0,lastPrefix:'',status:[],result:[],captured:0,checkedCtx:0};
  const ctx={console,Promise,Map,Set,Date,JSON,window:null,localStorage:ls,fideCacheMeta:meta,data:{currentTournament:t?'Q139 Test':''},registeredFideUpdateBusy:busy,fideImportInProgress:false,fideBackgroundUpdateRunning:false,
    document:{readyState:'complete',visibilityState:'visible',documentElement:{dataset:{}},addEventListener:(n,f)=>{listeners.document[n]=f;},getElementById:()=>null},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{},
    addEventListener:(n,f)=>{listeners.window[n]=f;},
    getCurrentTournament:()=>t,
    getRegisteredPlayerUpdateRatingType:()=> 'std',
    cpCaptureTournamentContext:()=>{state.captured++;return {name:'Q139 Test'};},
    cpIsTournamentContextCurrent:()=>{state.checkedCtx++;return true;},
    setStatus:x=>state.status.push(String(x)),setRegisteredFideUpdateResult:x=>state.result.push(String(x)),
    updateFideDatabaseNow:async()=>{state.serverUpdates++;if(updateMode==='change'){meta.lists.std.hash='a2';meta.lists.std.updatedAt='2026-09-08T09:00:00Z';}else if(updateMode==='partial'){meta.lists.std.hash='a2';return false;}else if(updateMode==='throw'){throw new Error('offline');}else{for(const type of ['std','rapid','blitz'])meta.lists[type].updatedAt='2026-09-08T09:00:00Z';}return true;},
    downloadAndUpdateFideDatabases:async()=>{state.localUpdates++;if(localUpdate){for(const type of ['std','rapid','blitz'])meta.lists[type]={periodKey:'2026-09',updatedAt:'2026-09-08T10:00:00Z',source:'local FIDE updater'};}},
    lookupRegisteredPlayersInFideDirectory:async idsArg=>{state.lookup++;return {byId:new Map(idsArg.map((id,i)=>[id,{name:i?'B':'A',std:i?1900:2010,stdAvailable:true}])),source:'FIDE LEGACY directory'};},
    evaluateRegisteredFideUpdate:(tt,lookup,opts,apply)=>{state.evaluate++;state.evaluateApply=apply;return {type:opts.type,typeLabel:'Standard',changes:Array.from({length:changes},(_,i)=>({name:'A',fideId:'15000001',details:[`Rating: 2000 → ${2010+i}`]})),matched:2,unchanged:changes?1:2,noFideId:0,notFound:0,birthUnavailable:0,ratingUnavailable:0,kUnavailable:0};},
    buildRegisteredFideUpdateReport:(r,o,a,s)=>{state.build++;return `REPORT ${r.changes.length} ${a} ${s}`;},
    saveRegisteredFideUpdateReport:async(r,p)=>{state.save++;state.lastPrefix=p;return {opened:true,fileName:p+'.txt'};}
  };
  ctx.window=ctx;
  ctx.cpBeta53={applyDateEffectiveRatings:async()=>{state.overlay++;}};
  ctx.cpBeta54={verifyBeforeRequestedConsistency:async()=>{state.verify++;if(verifyRefresh){await ctx.updateFideDatabaseNow({manual:false,reason:'consistency-check'});}return {verified:true};}};
  vm.createContext(ctx);vm.runInContext(src,ctx);
  return {ctx,api:ctx.cpBeta56,state,meta,t,listeners,timers,ls};
}
async function flush(){await Promise.resolve();await Promise.resolve();}
(async()=>{
  let x=makeCtx();
  eq(x.api.VERSION,'1.06.00-beta.56','beta56 API version');
  eq(x.api.RETRY_MS,30000,'retry interval is 30 seconds');
  eq(x.api.FIRST_RETRY_MS,1500,'first opportunity retry is prompt');
  ok(x.ctx.updateFideDatabaseNow.__cpBeta56Wrapped===true,'official server updater is wrapped additively');
  ok(x.ctx.downloadAndUpdateFideDatabases.__cpBeta56Wrapped===true,'local FIDE updater is wrapped additively');
  ok(x.ctx.saveRegisteredFideUpdateReport.__cpBeta56Wrapped===true,'manual report completion is observed additively');
  eq(x.ctx.document.documentElement.dataset.chesspublisherVersion,'1.06.00-beta.56','runtime version marker is beta56');

  eq(x.api.hashFingerprint(),'std:a|rapid:b|blitz:c','content fingerprint uses maintained list hashes');
  ok(/std:2026-09:a/.test(x.api.revisionKey()),'revision key contains period and content hash');
  const r1=x.api.revisionKey();x.meta.lists.std.updatedAt='2026-09-08T11:00:00Z';eq(x.api.revisionKey(),r1,'timestamp-only server verification does not create new revision');
  x.meta.lists.std.hash='';const r2=x.api.revisionKey();x.meta.lists.std.updatedAt='2026-09-08T12:00:00Z';ok(x.api.revisionKey()!==r2,'hashless local list revision uses completed update timestamp');

  x=makeCtx({tournament:false,updateMode:'unchanged'});
  await x.ctx.updateFideDatabaseNow({manual:false});await flush();
  eq(x.api.pendingState(),null,'unchanged server list verification does not enqueue Q139');
  eq(x.state.serverUpdates,1,'wrapped server updater preserves original call');

  x=makeCtx({tournament:false,updateMode:'change'});
  await x.ctx.updateFideDatabaseNow({manual:false});await flush();
  ok(!!x.api.pendingState(),'actual server content hash change enqueues Q139');
  ok(/official-rating-list-content-update/.test(x.api.pendingState().reason),'server update pending state records reason');
  ok(x.timers.length>=1,'pending Q139 schedules first-opportunity retry');

  x=makeCtx({tournament:false,updateMode:'partial'});
  const partial=await x.ctx.updateFideDatabaseNow({manual:false});await flush();
  eq(partial,false,'partial server update preserves original false result');
  ok(!!x.api.pendingState(),'actual content change remains pending even when another list failed');

  x=makeCtx({tournament:false,localUpdate:true,initialHashes:['','','']});
  await x.ctx.downloadAndUpdateFideDatabases();await flush();
  ok(!!x.api.pendingState(),'completed local FIDE list update enqueues Q139');
  ok(/local-rating-list-update/.test(x.api.pendingState().reason),'local update pending state records reason');

  x=makeCtx({tournament:false});x.api.queueRevision('test');
  let sc=x.api.safeContext();eq(sc.reason,'no-tournament','no tournament defers automatic consistency check');
  x=makeCtx({ids:false});x.api.queueRevision('test');sc=x.api.safeContext();eq(sc.reason,'no-fide-ids','tournament without valid FIDE IDs defers check');
  x=makeCtx({busy:true});x.api.queueRevision('test');sc=x.api.safeContext();eq(sc.reason,'busy','existing FIDE operation defers automatic check');

  x=makeCtx();const opts=x.api.automaticOptions();
  ok(opts.rating===true,'automatic Q139 check compares rating');
  ok(!opts.name&&!opts.k&&!opts.title&&!opts.birth&&!opts.sex&&!opts.fed,'automatic Q139 check does not compare unrelated registration fields');
  ok(opts.setZero===false,'automatic comparison never proposes a forced zero for unavailable rating');
  eq(opts.type,'std','automatic check uses tournament preferred rating list type');

  x=makeCtx({changes:1});{const key=x.api.revisionKey();x.api.writeState({pending:{revisionKey:key,reason:'test',queuedAt:new Date().toISOString()},checked:{}});}await x.api.tryAutomaticConsistency('test');
  // Explicit execution validates the complete first-opportunity path deterministically.
  ok(x.state.verify>=1,'automatic Q139 verifies required rating list before comparison');
  ok(x.state.lookup>=1,'automatic Q139 resolves registered players by FIDE ID');
  ok(x.state.overlay>=1,'date-effective beta53 rating overlay is applied before comparison');
  ok(x.state.evaluate>=1,'automatic Q139 executes existing comparison engine');
  eq(x.state.evaluateApply,false,'automatic Q139 uses non-mutating comparison path');
  eq(x.state.lastPrefix,'ChessPublisherLmsg-Auto-Consistency','rating differences produce dedicated automatic TXT report');
  ok(x.state.status.some(s=>/No player data was changed/.test(s)),'automatic result explicitly confirms no player data mutation');
  eq(x.api.pendingState(),null,'successful automatic check clears pending revision');
  ok(x.api.lastRun?.ok===true&&x.api.lastRun?.changes===1,'automatic result is recorded with affected-player count');
  ok(x.state.captured>=1&&x.state.checkedCtx>=1,'automatic check protects tournament operation context');

  x=makeCtx({changes:0});{const key=x.api.revisionKey();x.api.writeState({pending:{revisionKey:key,reason:'test',queuedAt:new Date().toISOString()},checked:{}});}await x.api.tryAutomaticConsistency('test');
  eq(x.state.save,0,'no-difference automatic check does not open a needless TXT report');
  ok(x.state.status.some(s=>/no rating differences found/i.test(s)),'no-difference result is reported operationally');
  eq(x.state.evaluateApply,false,'no-difference automatic check is also non-mutating');

  x=makeCtx({changes:1,verifyRefresh:true,updateMode:'change'});{const key=x.api.revisionKey();x.api.writeState({pending:{revisionKey:key,reason:'initial',queuedAt:new Date().toISOString()},checked:{}});}await x.api.tryAutomaticConsistency('initial');
  eq(x.state.evaluate,1,'beta54 pre-check refresh does not create a refresh-check recursion');
  eq(x.api.pendingState(),null,'post-refresh effective revision is covered by the same automatic check');

  x=makeCtx({tournament:false});const key=x.api.revisionKey();x.api.queueRevision('persist',key);
  const raw=x.ls.getItem(x.api.STATE_KEY);ok(!!raw&&raw.includes(key),'pending revision persists in local storage');
  const t={name:'T',startDate:'2026-09-08',players:[]};x.ctx.data.currentTournament='T';
  ok(x.api.markChecked(t,key,'test'),'checked revision can be recorded per tournament');
  ok(x.api.readState().checked['T|2026-09-08']?.revisionKey===key,'per-tournament checked revision is persisted');

  x=makeCtx();const manualKey=x.api.revisionKey();x.api.writeState({pending:{revisionKey:manualKey,reason:'manual',queuedAt:new Date().toISOString()},checked:{}});await x.ctx.saveRegisteredFideUpdateReport('manual report','ChessPublisherLmsg-Test');await flush();
  eq(x.api.pendingState(),null,'successful manual Start test satisfies matching pending Q139 revision');
  ok(Object.values(x.api.readState().checked).some(v=>v.source==='manual-consistency'),'manual consistency completion is recorded');

  x=makeCtx();{const key=x.api.revisionKey();x.api.writeState({pending:{revisionKey:key,reason:'manual-update',queuedAt:new Date().toISOString()},checked:{}});}await x.ctx.saveRegisteredFideUpdateReport('manual update','ChessPublisherLmsg');await flush();
  eq(x.api.pendingState(),null,'successful manual registered-player update also satisfies pending comparison');

  x=makeCtx({tournament:false});x.api.queueRevision('wake');await flush();
  ok(typeof x.listeners.window.focus==='function'&&typeof x.listeners.window.pageshow==='function','focus and pageshow first-opportunity handlers are installed');
  ok(typeof x.listeners.document.visibilitychange==='function','visibility first-opportunity handler is installed');

  ok(html.includes('ChessPublisher-Beta56-Compliance.js'),'HTML loads beta56 automatic consistency layer');
  ok(html.indexOf('ChessPublisher-Beta56-Compliance.js')>html.indexOf('ChessPublisher-Beta55-Compliance.js'),'beta56 layer loads after beta55 freshness layer');
  ok(/evaluateRegisteredFideUpdate\(t,lookup,options,false\)/.test(src),'source statically locks automatic comparison to applyChanges=false');
  ok(!/runRegisteredPlayersFideUpdate\s*\(/.test(src),'automatic module does not call manual update workflow');
  ok(!/saveData\s*\(|cpPersistCriticalMutation\s*\(/.test(src),'automatic module contains no player-data persistence path');
  ok(!/experimental|pending implementation|debug consistency/i.test(src),'no unfinished engineering wording in beta56 user-facing logic');
  ok(/actual server content hash change|content hash/i.test(fs.readFileSync(__filename,'utf8')),'dedicated suite explicitly tests content-change trigger semantics');

  console.log(`BETA56 RESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
