const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
function assert(c,m){if(!c){console.error('FAIL:',m);process.exit(1)}console.log('PASS:',m)}
function extractFunction(src,name){
  const re=new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`); const m=re.exec(src); if(!m)return '';
  const start=m.index, brace=src.indexOf('{',m.index+m[0].length); let d=0,q='',esc=false,lc=false,bc=false;
  for(let i=brace;i<src.length;i++){const c=src[i],n=src[i+1]||'';
    if(lc){if(c==='\n')lc=false;continue} if(bc){if(c==='*'&&n==='/'){bc=false;i++}continue}
    if(q){if(esc){esc=false;continue}if(c==='\\'){esc=true;continue}if(c===q)q='';continue}
    if(c==='/'&&n==='/'){lc=true;i++;continue} if(c==='/'&&n==='*'){bc=true;i++;continue}
    if(c==='"'||c==="'"||c==='`'){q=c;continue} if(c==='{')d++; if(c==='}'&&--d===0)return src.slice(start,i+1);
  } return '';
}
const timeoutFn=extractFunction(html,'cpStartupTimeout');
const serverFn=extractFunction(html,'readServerSnapshot');
const loadFn=extractFunction(html,'loadPersistentState');
assert(timeoutFn.includes('Promise.race'), 'startup timeout races slow recovery source');
assert(loadFn.includes('Promise.allSettled'), 'IndexedDB and LocalEngine startup restore run in parallel');
assert(loadFn.indexOf('const localSnapshot=readCurrentLocalSnapshot()') < loadFn.indexOf('await Promise.allSettled'), 'local recovery snapshot is captured before waiting on optional stores');
assert(serverFn.includes('AbortController'), 'LocalEngine /state restore is abortable');
assert(serverFn.includes('controller.abort()'), 'LocalEngine /state timeout actively aborts stalled fetch');
assert(html.includes('requestIdleCallback(startFideBackground'), 'FIDE cache restore is deferred until browser idle');
assert(html.includes('else setTimeout(startFideBackground,1200)'), 'FIDE cache restore has non-idle fallback delay');

(async()=>{
  const ctx={Promise,setTimeout,clearTimeout,console}; vm.createContext(ctx); vm.runInContext(timeoutFn,ctx);
  const t=Date.now(); const r=await ctx.cpStartupTimeout(new Promise(()=>{}),60,'test restore'); const dt=Date.now()-t;
  assert(r===null,'stalled generic recovery source returns null after timeout');
  assert(dt<350,`generic recovery timeout is bounded (${dt}ms)`);

  const fetchCtx={
    Promise,setTimeout,clearTimeout,console,AbortController,
    canUseLocalStateFile(){return true;},
    fetch(_url,{signal}={}){return new Promise((resolve,reject)=>{if(signal)signal.addEventListener('abort',()=>{const e=new Error('aborted');e.name='AbortError';reject(e)},{once:true});});}
  };
  vm.createContext(fetchCtx); vm.runInContext(serverFn,fetchCtx);
  const s=Date.now(); const snap=await fetchCtx.readServerSnapshot(70); const sd=Date.now()-s;
  assert(snap===null,'stalled /state request falls back without startup failure');
  assert(sd<400,`/state abort is bounded (${sd}ms)`);
  console.log('BETA23 STARTUP PERFORMANCE REGRESSION: PASS');
})().catch(e=>{console.error(e);process.exit(1)});
