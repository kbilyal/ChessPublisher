/* Chess-Publisher beta.69 — FIDE/TEC Q203-Q206 final tied-place resolution.
   Additive final-standings/presentation layer only. It does NOT redefine
   Gacrux, Swiss pairing, TRF16/TRF26 fixed-width core, BBP or tie-break maths. */
(function(){
  'use strict';
  const VERSION='1.06.00-beta.69';
  const MODES={SAME:'same-place',LOTS:'drawing-lots',MANUAL:'manual-order'};
  const EPS=1e-9;

  function tournament(){ try{return typeof getCurrentTournament==='function'?getCurrentTournament():null;}catch(_){return null;} }
  function save(){ try{if(typeof saveData==='function')saveData();}catch(_){} }
  function identity(p){
    const src=p?.sourcePlayer||{};
    return String(src.localKey||p?.localKey||src.fideId||p?.fideId||p?.key||p?.id||p?.name||'');
  }
  function state(create=true){
    const t=tournament(); if(!t)return null;
    if(!t.finalTieResolution && create)t.finalTieResolution={mode:MODES.SAME,draws:{},manual:{},audit:[]};
    const x=t.finalTieResolution;
    if(!x)return null;
    if(!Object.values(MODES).includes(x.mode))x.mode=MODES.SAME;
    if(!x.draws||typeof x.draws!=='object'||Array.isArray(x.draws))x.draws={};
    if(!x.manual||typeof x.manual!=='object'||Array.isArray(x.manual))x.manual={};
    if(!Array.isArray(x.audit))x.audit=[];
    return x;
  }
  function mode(){return state()?.mode||MODES.SAME;}
  function setMode(value){
    const x=state(); if(!x)return false;
    const next=Object.values(MODES).includes(value)?value:MODES.SAME;
    if(x.mode!==next){x.mode=next;x.audit.push({at:new Date().toISOString(),action:'mode',value:next});save();}
    refresh(); return true;
  }
  function tbValue(p,tb){ try{return Number(standingTieBreakValue(p,tb))||0;}catch(_){return 0;} }
  function officiallyEqual(a,b,ties){
    if(!a||!b)return false;
    if(Math.abs((Number(a.score)||0)-(Number(b.score)||0))>EPS)return false;
    for(const tb of (ties||[]))if(Math.abs(tbValue(a,tb)-tbValue(b,tb))>EPS)return false;
    return true;
  }
  function splitGroups(players,ties){
    const out=[];
    for(const p of (players||[])){
      const last=out[out.length-1];
      if(last&&officiallyEqual(last.players[0],p,ties))last.players.push(p);else out.push({players:[p]});
    }
    let cursor=1;
    for(const g of out){g.baseRank=cursor;cursor+=g.players.length;g.tied=g.players.length>1;g.key=groupKey(g.players,ties);}
    return out;
  }
  function groupKey(players,ties){
    const ids=(players||[]).map(identity).sort().join('|');
    const sig=(ties||[]).map(String).join('>');
    return `${ids}::${sig}`;
  }
  function randomValue(){
    try{const a=new Uint32Array(2);crypto.getRandomValues(a);return ((a[0]*4294967296+a[1])+1)/18446744073709551617;}catch(_){return Math.random();}
  }
  function drawLotsForGroup(group,force=true){
    const x=state(); if(!x||!group?.tied)return null;
    if(!force&&x.draws[group.key])return x.draws[group.key];
    const previous=x.draws[group.key]?.drawNo||0;
    const values={}; for(const p of group.players)values[identity(p)]=randomValue();
    const record={drawNo:previous+1,at:new Date().toISOString(),values};
    x.draws[group.key]=record;
    x.audit.push({at:record.at,action:previous?'repeat-draw':'draw-lots',group:group.key,drawNo:record.drawNo});
    save(); return record;
  }
  function drawAll(force=true){
    const st=rawStandings(); if(!st)return 0;
    let count=0; for(const g of splitGroups(st.players,st.tieList))if(g.tied){drawLotsForGroup(g,force);count++;}
    if(count){state().mode=MODES.LOTS;save();refresh();} return count;
  }
  function manualOrderForGroup(group,orderedIds){
    const x=state(); if(!x||!group?.tied)return false;
    const expected=group.players.map(identity),got=(orderedIds||[]).map(String);
    if(got.length!==expected.length||new Set(got).size!==expected.length||expected.some(id=>!got.includes(id)))return false;
    x.manual[group.key]=got.slice();
    x.mode=MODES.MANUAL;
    x.audit.push({at:new Date().toISOString(),action:'manual-order',group:group.key,order:got.slice()});
    save(); refresh(); return true;
  }
  function orderedGroup(group,currentMode){
    const x=state(); const ps=[...group.players];
    if(!group.tied||currentMode===MODES.SAME)return ps;
    if(currentMode===MODES.LOTS){
      const rec=x?.draws?.[group.key]; if(!rec)return ps;
      return ps.sort((a,b)=>(Number(rec.values?.[identity(b)])||0)-(Number(rec.values?.[identity(a)])||0)||identity(a).localeCompare(identity(b)));
    }
    if(currentMode===MODES.MANUAL){
      const order=x?.manual?.[group.key]; if(!Array.isArray(order))return ps;
      const pos=new Map(order.map((id,i)=>[String(id),i]));
      return ps.sort((a,b)=>(pos.get(identity(a))??999999)-(pos.get(identity(b))??999999));
    }
    return ps;
  }
  let originalCalculate=null,originalRefresh=null,originalBuildText=null,originalPrintTxt=null;
  function rawStandings(){
    try{return originalCalculate?originalCalculate():null;}catch(_){return null;}
  }
  function applyPolicy(st){
    if(!st||!Array.isArray(st.players))return st;
    const m=mode(),groups=splitGroups(st.players,st.tieList||[]),out=[];
    let place=1;
    for(const g of groups){
      const ordered=orderedGroup(g,m);
      if(m===MODES.SAME){
        for(const p of ordered){p.beta69FinalRank=place;p.beta69Tied=g.tied;p.beta69TieGroup=g.key;out.push(p);}
        place+=g.players.length; // competition ranking: 1,1,3
      }else{
        for(const p of ordered){p.beta69FinalRank=place++;p.beta69Tied=g.tied;p.beta69TieGroup=g.key;out.push(p);}
      }
    }
    st.players=out;st.finalTieMode=m;st.unresolvedTieGroups=groups.filter(g=>g.tied).length;return st;
  }
  function rankOf(p,index){return Number(p?.beta69FinalRank)||Number(index)+1;}
  function patchRanks(st){
    if(typeof document==='undefined'||!st)return;
    const rows=[...document.querySelectorAll?.('#finalStandingsBody tr')||[]];
    rows.forEach((row,i)=>{const cell=row.querySelector?.('.final-place');if(!cell)return;const r=rankOf(st.players[i],i);cell.textContent=(r===1?'🥇':r===2?'🥈':r===3?'🥉':String(r));});
  }

  function buildPlainText(st,bg=false){
    if(!st)st=window.calculateFinalStandings?.();
    if(!st)return '';
    const ties=st.tieList||[], name=(typeof data!=='undefined'&&data?.currentTournament)||'Tournament';
    let text=`🏆 ${name}\n🏁 ${bg?'КРАЙНО КЛАСИРАНЕ':'FINAL STANDINGS'}\n━━━━━━━━━━━━━━━━━━━━\n`;
    text+=`${bg?'Кръгове':'Rounds'}: ${st.completed||0}  •  ${bg?'Участници':'Players'}: ${st.players.length}\n`;
    if(ties.length)text+=`${bg?'Тайбрейк':'Tie-break'}: `+ties.map((tb,i)=>`${i+1}.${typeof shortTieBreakLabel==='function'?shortTieBreakLabel(tb):tb}`).join(' → ')+'\n';
    text+='\n';
    st.players.forEach((p,i)=>{
      const place=rankOf(p,i),prefix=place===1?'🥇':place===2?'🥈':place===3?'🥉':`${place}.`,fed=p.fed?` ${p.fed}`:'';
      text+=`${prefix} ${typeof standingPlayerDisplayName==='function'?standingPlayerDisplayName(p):p.name}${fed} — ${Number(p.score||0).toFixed(1)}`;
      if(ties.length)text+=' | '+ties.map(tb=>`${typeof shortTieBreakLabel==='function'?shortTieBreakLabel(tb):tb} ${typeof formatStandingTie==='function'?formatStandingTie(p,tb):tbValue(p,tb)}`).join(' | ');
      text+='\n';
    });
    return text.trim();
  }
  function buildFixedText(st,bg=false){
    if(!st)st=window.calculateFinalStandings?.(); if(!st)return '';
    const ties=st.tieList||[],padFn=typeof pad==='function'?pad:(v,n)=>String(v).padEnd(n,' '),name=(typeof data!=='undefined'&&data?.currentTournament)||'Tournament';
    const rankW=5,nameW=30,fedW=5,rtgW=6,ptsW=6,tbW=8;
    let text=String(name).toUpperCase()+'\n'+(bg?'КРАЙНО КЛАСИРАНЕ':'FINAL STANDINGS')+'\n';
    text+=`${bg?'Кръгове':'Rounds'}: ${st.completed||0}   ${bg?'Участници':'Players'}: ${st.players.length}\n\n`;
    text+=padFn('#',rankW)+padFn(bg?'Име':'Name',nameW)+padFn('FED',fedW)+padFn('Rtg',rtgW)+padFn('Pts',ptsW);
    ties.forEach(tb=>text+=padFn(typeof shortTieBreakLabel==='function'?shortTieBreakLabel(tb):tb,tbW)); text+='\n';
    text+='-'.repeat(rankW+nameW+fedW+rtgW+ptsW+ties.length*tbW)+'\n';
    st.players.forEach((p,i)=>{text+=padFn(rankOf(p,i),rankW)+padFn(typeof standingPlayerDisplayName==='function'?standingPlayerDisplayName(p):p.name,nameW)+padFn(p.fed||'',fedW)+padFn(p.rating||0,rtgW)+padFn(Number(p.score||0).toFixed(1),ptsW);ties.forEach(tb=>text+=padFn(typeof formatStandingTie==='function'?formatStandingTie(p,tb):tbValue(p,tb),tbW));text+='\n';});
    return text;
  }

  function ensureUi(){
    if(typeof document==='undefined'||document.getElementById?.('cpBeta69TiePanel'))return;
    const anchor=document.getElementById?.('standingsStateLine'); if(!anchor||!anchor.parentNode)return;
    const panel=document.createElement('div');panel.id='cpBeta69TiePanel';panel.className='info-box';
    panel.style.cssText='margin:8px 0;padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    panel.innerHTML='<b>Final tied places:</b> <select id="cpBeta69TieMode"><option value="same-place">Keep same place</option><option value="drawing-lots">Drawing of lots</option><option value="manual-order">Manual order</option></select><button id="cpBeta69DrawBtn" class="small-btn">Draw lots</button><button id="cpBeta69RepeatBtn" class="small-btn">Repeat draw</button><button id="cpBeta69ManualBtn" class="small-btn">Manual order tied players</button><span id="cpBeta69TieStatus" class="muted"></span>';
    anchor.insertAdjacentElement?.('afterend',panel);
    const sel=document.getElementById('cpBeta69TieMode');if(sel){sel.value=mode();sel.onchange=()=>setMode(sel.value);}
    const d=document.getElementById('cpBeta69DrawBtn');if(d)d.onclick=()=>drawAll(false);
    const r=document.getElementById('cpBeta69RepeatBtn');if(r)r.onclick=()=>drawAll(true);
    const m=document.getElementById('cpBeta69ManualBtn');if(m)m.onclick=()=>openManualDialog();
  }
  function renderUi(st){
    ensureUi(); if(typeof document==='undefined')return;
    const x=state(),sel=document.getElementById?.('cpBeta69TieMode');if(sel)sel.value=mode();
    const status=document.getElementById?.('cpBeta69TieStatus');
    if(status)status.textContent=`${st?.unresolvedTieGroups||0} exact tie group(s) · ${mode()==='same-place'?'equal final rank':mode()==='drawing-lots'?'lot order':'manual order'}`;
    const rep=document.getElementById?.('cpBeta69RepeatBtn');if(rep)rep.hidden=mode()!==MODES.LOTS;
  }
  function refresh(){try{if(typeof window.refreshFinalStandings==='function')window.refreshFinalStandings();}catch(_){} }
  function openManualDialog(){
    const st=window.calculateFinalStandings?.(); if(!st)return false;
    const groups=splitGroups(st.players,st.tieList).filter(g=>g.tied); if(!groups.length){try{appAlert('There are no exact tied final places to order manually.');}catch(_){}return false;}
    const g=groups[0],current=orderedGroup(g,MODES.MANUAL),labels=new Map(g.players.map(p=>[identity(p),`${p.name||identity(p)} (#${p.id||''})`]));
    const existing=document.getElementById?.('cpBeta69ManualDialog');if(existing)existing.remove();
    const box=document.createElement('div');box.id='cpBeta69ManualDialog';box.style.cssText='position:fixed;inset:10% 20%;z-index:99999;background:white;border:1px solid #888;border-radius:10px;padding:16px;box-shadow:0 15px 40px #0004;overflow:auto';
    const ids=current.map(identity);box.innerHTML='<h3>Manual order — exact tied players</h3><p>Only the order inside this exact tie group is changed. Tie-break calculations are not modified.</p><div id="cpBeta69ManualRows"></div><div style="margin-top:12px"><button id="cpBeta69ManualSave">Save manual order</button> <button id="cpBeta69ManualCancel">Cancel</button></div>';
    document.body.appendChild(box);
    const rows=box.querySelector('#cpBeta69ManualRows');
    function repaint(){rows.innerHTML=ids.map((id,i)=>`<div style="display:flex;gap:8px;margin:5px 0"><b style="width:28px">${i+1}.</b><span style="flex:1">${labels.get(id)||id}</span><button data-up="${i}">↑</button><button data-down="${i}">↓</button></div>`).join('');rows.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.up);if(i>0){[ids[i-1],ids[i]]=[ids[i],ids[i-1]];repaint();}});rows.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.down);if(i<ids.length-1){[ids[i+1],ids[i]]=[ids[i],ids[i+1]];repaint();}});}
    repaint();box.querySelector('#cpBeta69ManualSave').onclick=()=>{manualOrderForGroup(g,ids);box.remove();};box.querySelector('#cpBeta69ManualCancel').onclick=()=>box.remove();return true;
  }
  function install(){
    if(typeof window==='undefined')return;
    document?.documentElement?.dataset&&(document.documentElement.dataset.chesspublisherVersion=VERSION);
    originalCalculate=window.calculateFinalStandings;
    if(typeof originalCalculate==='function')window.calculateFinalStandings=function(){return applyPolicy(originalCalculate.apply(this,arguments));};
    originalRefresh=window.refreshFinalStandings;
    if(typeof originalRefresh==='function')window.refreshFinalStandings=function(){const r=originalRefresh.apply(this,arguments);const st=window.calculateFinalStandings();patchRanks(st);renderUi(st);return st||r;};
    originalBuildText=window.buildFinalStandingsText;
    if(typeof originalBuildText==='function')window.buildFinalStandingsText=function(){const bg=typeof getLanguage==='function'&&getLanguage()==='bg';return buildPlainText(window.refreshFinalStandings?.()||window.calculateFinalStandings?.(),bg);};
    originalPrintTxt=window.printFinalStandingsTxt;
    if(typeof originalPrintTxt==='function')window.printFinalStandingsTxt=function(){const run=()=>{const st=window.refreshFinalStandings?.()||window.calculateFinalStandings?.(),bg=typeof getLanguage==='function'&&getLanguage()==='bg',text=buildFixedText(st,bg),report=document.getElementById?.('screenPrintReport');if(report)report.innerHTML=`<div class="print-doc final-txt-print"><pre class="final-txt-pre">${typeof escapeHtml==='function'?escapeHtml(text):text}</pre></div>`;try{document.title=`${data.currentTournament} - Final Standings`;}catch(_){};try{setTimeout(()=>window.print(),30);}catch(_){};return text;};return typeof withExportLanguage==='function'?withExportLanguage(run):run();};
    // Preserve old output builders, but make their index-based ranks reflect beta69
    // by exposing final rank on every returned player. The protected tie-break and
    // TRF algorithms are not redefined here.
    ensureUi();
  }
  const api={VERSION,MODES,state,mode,setMode,officiallyEqual,splitGroups,groupKey,drawLotsForGroup,drawAll,manualOrderForGroup,applyPolicy,rankOf,buildPlainText,buildFixedText,openManualDialog,install};
  window.cpBeta69=api;
  if(typeof document!=='undefined'&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
