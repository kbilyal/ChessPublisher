(()=>{
  "use strict";
  if(window.__cpLinuxExportIntegrationLoaded)return;
  window.__cpLinuxExportIntegrationLoaded=true;

  async function nativeTextExport(payload={}){
    const r=await window.fetch("/linux/export-text",{
      method:"POST",
      headers:{"Content-Type":"application/json;charset=utf-8","Accept":"application/json"},
      body:JSON.stringify(payload||{}),
      cache:"no-store"
    });
    const p=await r.json().catch(()=>({}));
    if(!r.ok||p.ok===false)throw new Error(p.error||`TXT export service HTTP ${r.status}`);
    return p;
  }
  window.cpNativeExportText=nativeTextExport;

  function safePart(value){
    const raw=String(value||"Tournament").replace(/[<>:"/\\|?*\u0000-\u001f]/g,"_").trim();
    return raw||"Tournament";
  }
  function pad(value,width,align="left"){
    let s=String(value??"").replace(/\s+/g," ").trim();
    if(s.length>width)s=width>1?s.slice(0,width-1)+"…":s.slice(0,width);
    return align==="right"?s.padStart(width," "):s.padEnd(width," ");
  }
  function startingPlayers(){
    const t=typeof window.getCurrentTournament==="function"?window.getCurrentTournament():null;
    let players=[];
    try{
      players=typeof window.getActiveRegistrationPlayers==="function"?[...(window.getActiveRegistrationPlayers(t)||[])]:[...(t?.players||[])];
    }catch(_){players=[...(t?.players||[])];}
    return players.map((player,index)=>({player,no:Number(player?.pairingNumber||player?.pairingNo||0),index})).sort((a,b)=>{
      const an=Number.isInteger(a.no)&&a.no>0?a.no:999999;
      const bn=Number.isInteger(b.no)&&b.no>0?b.no:999999;
      return an-bn || Number(b.player?.rating||0)-Number(a.player?.rating||0) || String(a.player?.name||"").localeCompare(String(b.player?.name||""));
    });
  }
  function dateOnly(value){
    const raw=String(value||"").trim();
    const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m?`${m[1]}/${m[2]}/${m[3]}`:raw;
  }
  function titleOf(player){
    try{return typeof window.normalizePlayerTitle==="function"?(window.normalizePlayerTitle(player?.title)||""):String(player?.title||"").trim();}
    catch(_){return String(player?.title||"").trim();}
  }
  function validFideId(player){
    const id=String(player?.fideId||"").trim();
    return /^\d{5,15}$/.test(id)&&!/^0+$/.test(id)?id:"";
  }

  function startingListText(){
    const t=typeof window.getCurrentTournament==="function"?window.getCurrentTournament():null;
    if(!t)throw new Error("No tournament is selected.");
    const s=t.settings||{},rows=startingPlayers(),out=[];
    if(!rows.length)throw new Error("No players to export.");
    out.push(String(window.data?.currentTournament||""));
    if(s.organizer)out.push(`Organizer(s) : ${s.organizer}`);
    if(s.country)out.push(`Federation : ${String(s.country).toUpperCase()}`);
    if(s.director)out.push(`Tournament director : ${s.director}`);
    if(s.chiefArbiter)out.push(`Chief Arbiter : ${s.chiefArbiter}`);
    if(s.timeControl)out.push(`Time control (${s.tournamentRatingType||""}) : ${s.timeControl}`);
    const location=[s.venue,s.city].filter(Boolean).join(", ");
    if(location)out.push(`Location : ${location}`);
    if(s.rounds)out.push(`Number of rounds : ${s.rounds}`);
    if(s.tournamentFormat)out.push(`Tournament type : ${s.tournamentFormat}`);
    if(s.fideRated)out.push(`Rating calculation : ${String(s.fideRated).toLowerCase()==="yes"?"Rating international":"Unrated"}`);
    if(s.fideEventId)out.push(`FIDE-Event-ID : ${s.fideEventId}`);
    const start=dateOnly(s.startDate),end=dateOnly(s.endDate);
    if(start||end)out.push(`Date : ${start}${end&&end!==start?` to ${end}`:""}`);
    out.push("","Starting rank");
    out.push(pad("No.",5,"right")+" "+pad("",5)+" "+pad("Name",34)+" "+pad("FideID",12,"right")+" "+pad("FED",4)+" "+pad("Rtg",5,"right"));
    out.push("-".repeat(70));
    rows.forEach((row,index)=>{
      const p=row.player||{},no=(Number.isInteger(row.no)&&row.no>0)?row.no:index+1;
      out.push(
        pad(no,5,"right")+" "+pad(titleOf(p),5)+" "+pad(p.name||"",34)+" "+
        pad(validFideId(p),12,"right")+" "+pad(String(p.fed||"").toUpperCase(),4)+" "+pad(Number(p.rating)||0,5,"right")
      );
    });
    out.push("",`Total players: ${rows.length}`);
    return out.join("\r\n")+"\r\n";
  }
  window.cpLinuxStartingListText=startingListText;

  function startingListHtml(){
    const t=typeof window.getCurrentTournament==="function"?window.getCurrentTournament():null;
    if(!t)return "";
    const s=t.settings||{},rows=startingPlayers();
    const esc=typeof window.escapeHtml==="function"?window.escapeHtml:(x=>String(x??"").replace(/[&<>\"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m])));
    const meta=[];
    if(s.organizer)meta.push(`Organizer(s) : ${s.organizer}`);
    if(s.country)meta.push(`Federation : ${String(s.country).toUpperCase()}`);
    if(s.director)meta.push(`Tournament director : ${s.director}`);
    if(s.chiefArbiter)meta.push(`Chief Arbiter : ${s.chiefArbiter}`);
    if(s.timeControl)meta.push(`Time control (${s.tournamentRatingType||""}) : ${s.timeControl}`);
    const location=[s.venue,s.city].filter(Boolean).join(", "); if(location)meta.push(`Location : ${location}`);
    if(s.rounds)meta.push(`Number of rounds : ${s.rounds}`);
    if(s.tournamentFormat)meta.push(`Tournament type : ${s.tournamentFormat}`);
    if(s.fideEventId)meta.push(`FIDE-Event-ID : ${s.fideEventId}`);
    const start=dateOnly(s.startDate),end=dateOnly(s.endDate);if(start||end)meta.push(`Date : ${start}${end&&end!==start?` to ${end}`:""}`);
    const body=rows.map((row,index)=>{
      const p=row.player||{},no=(Number.isInteger(row.no)&&row.no>0)?row.no:index+1;
      return `<tr><td>${no}</td><td>${esc(titleOf(p))}</td><td style="text-align:left">${esc(p.name||"")}</td><td>${esc(validFideId(p))}</td><td>${esc(String(p.fed||"").toUpperCase())}</td><td>${Number(p.rating)||0}</td></tr>`;
    }).join("");
    return `<div class="print-doc cp-exact-report"><div class="cp-exact-tournament">${esc(window.data?.currentTournament||"")}</div>${meta.map(x=>`<div style="text-align:left;font-size:12px;margin:2px 0">${esc(x)}</div>`).join("")}<div class="cp-exact-report-title" style="text-align:left;margin-top:12px">Starting rank</div><table class="cp-exact-table"><thead><tr><th>No.</th><th></th><th style="text-align:left">Name</th><th>FideID</th><th>FED</th><th>Rtg</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  const browserExport=typeof window.exportTextFile==="function"?window.exportTextFile:null;
  window.exportTextFile=async function(text,suffix){
    const suffixText=String(suffix||"Export"),tournament=String(window.data?.currentTournament||"Tournament");
    const category=/^Pairings/i.test(suffixText)?"Pairings":/^Starting/i.test(suffixText)?"Starting List":"Reports";
    const fileName=`${safePart(tournament)}_${safePart(suffixText)}.txt`;
    try{
      const saved=await nativeTextExport({tournamentName:tournament,fileName,category,text:String(text??"")});
      try{if(typeof window.setStatus==="function")window.setStatus(`${suffixText} TXT exported: ${saved.path||fileName}`);}catch(_){ }
      return saved;
    }catch(error){
      console.error("Linux native TXT export failed",error);
      if(browserExport){
        browserExport(text,suffix);
        try{if(typeof window.setStatus==="function")window.setStatus(`${suffixText} TXT exported with browser fallback.`);}catch(_){ }
        return {ok:true,browserDownload:true};
      }
      try{if(typeof window.appAlert==="function")await window.appAlert(`TXT export failed:\n\n${error?.message||String(error)}`,"TXT Export","error");}catch(_){ }
      return {ok:false,error:error?.message||String(error)};
    }
  };

  window.exportParticipantsTxt=function(){
    try{return window.exportTextFile(startingListText(),"Starting_List");}
    catch(error){
      try{if(typeof window.appAlert==="function")window.appAlert(error?.message||String(error),"Starting List TXT","error");}catch(_){ }
      return {ok:false,error:error?.message||String(error)};
    }
  };
  if(typeof window.buildGeneralText==="function")window.exportGeneralTxt=()=>window.exportTextFile(window.buildGeneralText(),"General");
  if(typeof window.buildScheduleText==="function")window.exportScheduleTxt=()=>window.exportTextFile(window.buildScheduleText(),"Program");
  if(typeof window.buildRegulationsText==="function")window.exportRegulationsTxt=()=>window.exportTextFile(window.buildRegulationsText(),"Regulations");

  const originalPrintReport=typeof window.printReport==="function"?window.printReport:null;
  if(originalPrintReport){
    window.printReport=function(kind){
      if(String(kind||"")!=="players")return originalPrintReport.apply(this,arguments);
      try{if(typeof window.saveAll==="function")window.saveAll();}catch(_){ }
      const report=document.getElementById("screenPrintReport");
      if(report)report.innerHTML=startingListHtml();
      document.title=`${window.data?.currentTournament||"Tournament"} - Starting Rank List`;
      setTimeout(()=>window.print(),30);
    };
  }

  function relabel(){
    try{
      document.querySelectorAll('button[onclick="exportParticipantsTxt()"]').forEach(btn=>{
        btn.textContent="Starting List TXT";
        btn.title="Export the current Starting Rank list as a real TXT file to Downloads/Chess-Publisher.";
      });
    }catch(_){ }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",relabel,{once:true});else relabel();
})();
