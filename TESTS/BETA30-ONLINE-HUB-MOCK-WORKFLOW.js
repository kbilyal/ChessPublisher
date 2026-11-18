'use strict';
const path=require('path');
const apiLib=require(path.join(__dirname,'..','hub','client','hub-api-client.js'));

const state={
  organizerToken:'ORG-TOKEN-SECRET', manageToken:'MANAGE-TOKEN-SECRET', id:'tnr-001', slug:'mock-open-2026', revision:0,
  deleted:false, regulations:null, snapshot:null, requests:[]
};
function json(data,status=200,extraHeaders={}){
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...extraHeaders}});
}
function auth(h){return h.get('Authorization')||'';}
async function mockFetch(url,init={}){
  const u=new URL(url); const p=u.pathname; const method=(init.method||'GET').toUpperCase();
  const h=new Headers(init.headers||{}); state.requests.push({method,path:p,headers:Object.fromEntries(h.entries())});
  if(h.get('X-Client-Version')!=='1.06.00-beta.30') return json({error:'bad_client_version',message:'bad client version'},400);
  if(p==='/api/v1/health'&&method==='GET') return json({ok:true,d1:true,b2:true,organizerAuth:true});
  if(p==='/api/v1/organizer/me'&&method==='GET'){
    if(auth(h)!==`Bearer ${state.organizerToken}`) return json({error:'unauthorized'},401);
    return json({organizer:{id:'org-1',displayName:'Mock Organizer'}});
  }
  if(p==='/api/v1/organizer/tournaments'&&method==='POST'){
    if(auth(h)!==`Bearer ${state.organizerToken}`) return json({error:'unauthorized'},401);
    const body=JSON.parse(init.body);
    if(body.name!=='Mock Tournament') return json({error:'bad_metadata'},400);
    return json({tournament:{id:state.id,publicSlug:state.slug,manageToken:state.manageToken,revision:0,isPublic:true}});
  }
  if(p==='/api/v1/organizer/tournaments'&&method==='GET'){
    if(auth(h)!==`Bearer ${state.organizerToken}`) return json({error:'unauthorized'},401);
    return json({organizer:{id:'org-1'},tournaments:[{id:state.id,publicSlug:state.slug,name:'Mock Tournament',revision:state.revision,deleted:state.deleted,isPublic:!state.deleted}]});
  }
  if(p===`/api/v1/tournaments/${state.id}/snapshot`&&method==='PUT'){
    if(auth(h)!==`Bearer ${state.manageToken}`||h.get('X-Organizer-Token')!==state.organizerToken) return json({error:'unauthorized'},401);
    const expected=Number(h.get('X-Expected-Revision'));
    if(expected!==state.revision) return json({error:'revision_conflict',message:'revision conflict',currentRevision:state.revision},409);
    const snap=JSON.parse(init.body);
    const unchanged=state.snapshot&&JSON.stringify(state.snapshot)===JSON.stringify(snap);
    state.snapshot=snap;
    if(!unchanged) state.revision++;
    return json({revision:state.revision,checksum:'mock-checksum',unchanged:!!unchanged});
  }
  if(p===`/api/v1/tournaments/${state.id}/regulations-file`&&method==='PUT'){
    if(auth(h)!==`Bearer ${state.manageToken}`||h.get('X-Organizer-Token')!==state.organizerToken) return json({error:'unauthorized'},401);
    if(!(init.body instanceof FormData)) return json({error:'expected_formdata'},400);
    const f=init.body.get('file');
    state.regulations={name:f.name,size:f.size,type:f.type};
    return json({file:{...state.regulations,key:'mock-key'}});
  }
  if(p===`/api/v1/tournaments/${state.id}`&&method==='DELETE'){
    if(auth(h)!==`Bearer ${state.manageToken}`||h.get('X-Organizer-Token')!==state.organizerToken) return json({error:'unauthorized'},401);
    if(h.get('X-Confirm-Delete')!==state.slug) return json({error:'confirmation_required'},400);
    state.deleted=true; return json({deleted:true,deletedAt:'2026-09-05T00:00:00Z',purgeAfter:'2026-10-05T00:00:00Z',recoveryDays:30});
  }
  if(p===`/api/v1/tournaments/${state.id}/restore`&&method==='POST'){
    if(auth(h)!==`Bearer ${state.manageToken}`||h.get('X-Organizer-Token')!==state.organizerToken) return json({error:'unauthorized'},401);
    state.deleted=false; return json({restored:true});
  }
  if(p==='/api/v1/public/tournaments'&&method==='GET') return json({tournaments:state.deleted?[]:[{id:state.id,publicSlug:state.slug,name:'Mock Tournament',revision:state.revision}]});
  if(p===`/api/v1/public/tournaments/${state.slug}`&&method==='GET') return state.deleted?json({error:'not_found'},404):json({tournament:{id:state.id,publicSlug:state.slug,revision:state.revision,snapshot:state.snapshot}});
  return json({error:'not_found',method,path:p},404);
}

let pass=0,fail=0;
function check(cond,label){if(cond){console.log('PASS:',label);pass++;}else{console.log('FAIL:',label);fail++;}}
(async()=>{
  const api=apiLib.createClient({baseUrl:'https://mock.invalid',clientVersion:'1.06.00-beta.30',fetchImpl:mockFetch,timeoutMs:500});
  const health=await api.health(); check(health.ok&&health.d1&&health.b2&&health.organizerAuth,'health all subsystems healthy');
  const me=await api.organizerMe(state.organizerToken); check(me.organizer.displayName==='Mock Organizer','organizer token validates');
  const created=await api.createOrganizerTournament(state.organizerToken,{localKey:'mock-local-001',name:'Mock Tournament',federation:'XXX',city:'Test',roundsDeclared:7,isPublic:true});
  check(created.tournament.manageToken===state.manageToken&&created.tournament.publicSlug===state.slug,'create returns manage token and public slug');
  let r=await api.publishSnapshot({organizerToken:state.organizerToken,manageToken:state.manageToken,tournamentId:state.id,expectedRevision:0,snapshot:{schemaVersion:1,name:'Mock Tournament',players:[{id:'p1',name:'A'}]}});
  check(r.revision===1&&!r.unchanged,'first publish increments revision');
  r=await api.publishSnapshot({organizerToken:state.organizerToken,manageToken:state.manageToken,tournamentId:state.id,expectedRevision:1,snapshot:{schemaVersion:1,name:'Mock Tournament',players:[{id:'p1',name:'A'}]}});
  check(r.revision===1&&r.unchanged,'unchanged publish keeps revision');
  let conflict=null; try{await api.publishSnapshot({organizerToken:state.organizerToken,manageToken:state.manageToken,tournamentId:state.id,expectedRevision:0,snapshot:{schemaVersion:1,name:'Mock Tournament'}});}catch(e){conflict=e;}
  check(conflict?.code==='revision_conflict'&&conflict?.currentRevision===1,'revision conflict returns current revision');
  r=await api.publishSnapshot({organizerToken:state.organizerToken,manageToken:state.manageToken,tournamentId:state.id,expectedRevision:conflict.currentRevision,snapshot:{schemaVersion:1,name:'Mock Tournament',players:[{id:'p1',name:'A'},{id:'p2',name:'Б'}]}});
  check(r.revision===2,'retry after conflict publishes next revision');
  const f=new File([new TextEncoder().encode('Правила\nRules')],'Наредба.txt',{type:'text/plain'});
  const up=await api.uploadRegulationsFile({organizerToken:state.organizerToken,manageToken:state.manageToken,tournamentId:state.id,file:f});
  check(state.regulations?.name==='Наредба.txt'&&up.file?.key==='mock-key','Unicode regulations upload preserved filename');
  const mine=await api.listOrganizerTournaments(state.organizerToken); check(mine.tournaments.length===1&&mine.tournaments[0].revision===2,'My Online Tournaments returns current revision');
  await api.deleteTournament({organizerToken:state.organizerToken,manageToken:state.manageToken,tournamentId:state.id,publicSlug:state.slug});
  check(state.deleted===true,'soft delete succeeds with slug confirmation');
  const pubDeleted=await api.listPublicTournaments(); check(pubDeleted.tournaments.length===0,'deleted tournament removed from public list');
  await api.restoreTournament({organizerToken:state.organizerToken,manageToken:state.manageToken,tournamentId:state.id});
  check(state.deleted===false,'restore succeeds');
  const pub=await api.getPublicTournament(state.slug); check(pub.tournament.revision===2&&pub.tournament.snapshot.players.length===2,'public read returns restored latest snapshot');
  const leaked=state.requests.some(x=>x.path.includes(state.organizerToken)||x.path.includes(state.manageToken)); check(!leaked,'no organizer/manage token appears in URL path');
  const allVersion=state.requests.every(x=>x.headers['x-client-version']==='1.06.00-beta.30'); check(allVersion,'all API calls send beta.30 client version');
  console.log(`BETA30 ONLINE HUB MOCK WORKFLOW: ${pass}/${pass+fail} PASS`);
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
