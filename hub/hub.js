"use strict";

const HubPage=(()=>{
  let data=null;
  let activeSection="overview";

  const $=id=>document.getElementById(id);
  const esc=value=>String(value??"").replace(/[&<>'"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
  const txt=value=>String(value??"").trim();
  const display=value=>txt(value)||"—";

  function formatDate(value,withTime=false){
    if(!value) return "—";
    const d=new Date(value);
    if(Number.isNaN(d.getTime())) return display(value);
    return new Intl.DateTimeFormat(undefined,withTime
      ?{dateStyle:"medium",timeStyle:"short"}
      :{dateStyle:"medium"}).format(d);
  }

  function playerMap(){
    return new Map((data?.players||[]).map(player=>[player.key,player]));
  }

  function latestRound(){
    const rounds=data?.rounds||[];
    return rounds.length?Math.max(...rounds.map(round=>Number(round.round)||0)):0;
  }

  function setStatus(status){
    const el=$("tournamentStatus");
    const label={draft:"Draft",registration:"Registration",playing:"Playing",finished:"Finished"}[status]||"Tournament";
    el.textContent=label;
    el.dataset.status=status||"";
  }

  function renderHeader(){
    const t=data.tournament||{};
    const round=latestRound();
    setStatus(t.status);
    $("tournamentName").textContent=display(t.name);
    $("tournamentType").textContent=[txt(t.format),txt(t.ratingType)].filter(Boolean).join(" • ")||"Tournament";
    $("tournamentMeta").textContent=[txt(t.location?.city),txt(t.location?.federation),formatDate(t.dates?.start)].filter(v=>v&&v!=="—").join(" • ")||"Tournament information";
    $("latestRound").textContent=round?String(round):"—";
    $("roundProgress").textContent=round?`of ${t.roundsDeclared||"—"}`:`${t.roundsDeclared||"—"} rounds declared`;
    $("playersCount").textContent=String((data.players||[]).length);

    const generated=data.publication?.generatedAt;
    $("updatedText").textContent=generated?`Updated ${formatDate(generated,true)}`:"Preview data";

    const facts=[
      ["Time control",t.timeControl],
      ["Pairing",[t.format,t.pairingSystem].filter(Boolean).join(" / ")],
      ["Venue",t.location?.venue||t.location?.city],
      ["Chief arbiter",t.staff?.chiefArbiter]
    ];
    $("quickFacts").innerHTML=facts.map(([label,value])=>`<div class="fact"><span>${esc(label)}</span><strong title="${esc(display(value))}">${esc(display(value))}</strong></div>`).join("");
  }

  function detailRows(rows){
    return `<dl class="detail-list">${rows.map(([label,value])=>`<div class="detail-row"><dt>${esc(label)}</dt><dd>${esc(display(value))}</dd></div>`).join("")}</dl>`;
  }

  function renderOverview(){
    const t=data.tournament||{};
    const blocks=[
      ["Event",[
        ["Format",[t.format,t.pairingSystem].filter(Boolean).join(" / ")],
        ["Rating type",t.ratingType],
        ["FIDE rated",t.fideRated?"Yes":"No"],
        ["Rounds",t.roundsDeclared]
      ]],
      ["Location & dates",[
        ["Venue",t.location?.venue],
        ["City / Federation",[t.location?.city,t.location?.federation].filter(Boolean).join(", ")],
        ["Start",formatDate(t.dates?.start,true)],
        ["End",formatDate(t.dates?.end,true)]
      ]],
      ["Officials",[
        ["Organizer",t.staff?.organizer],
        ["Chief arbiter",t.staff?.chiefArbiter],
        ["Arbiter",t.staff?.arbiter],
        ["Director",t.staff?.director]
      ]],
      ["Publication",[
        ["Status",t.status],
        ["Players",(data.players||[]).length],
        ["Latest round",latestRound()||"Not generated"],
        ["Revision",data.publication?.revision]
      ]]
    ];
    $("overviewGrid").innerHTML=blocks.map(([title,rows])=>`<article class="overview-block"><h3>${esc(title)}</h3>${detailRows(rows)}</article>`).join("");
  }

  function filteredPlayers(){
    const q=txt($("playerSearch")?.value).toLowerCase();
    if(!q) return data.players||[];
    return (data.players||[]).filter(player=>[player.name,player.federation,player.fideId,player.title].some(value=>txt(value).toLowerCase().includes(q)));
  }

  function renderPlayers(){
    const players=filteredPlayers();
    if(!players.length){
      $("playersView").innerHTML=`<div class="empty-state"><strong>No matching players</strong>Try another search.</div>`;
      return;
    }
    const rows=players.map((p,index)=>`<tr><td class="rank-cell">${index+1}</td><td class="player-cell"><strong>${esc(p.name)}</strong><small>${esc(p.title||"")}${p.fideId?`${p.title?" • ":""}FIDE ${esc(p.fideId)}`:""}</small></td><td><span class="fed">${esc(p.federation)}</span></td><td class="num">${esc(p.rating)}</td></tr>`).join("");
    const cards=players.map((p,index)=>`<article class="mobile-card player-card"><div class="player-card__top"><span class="player-card__rank">#${index+1}</span><strong class="player-card__rating">${esc(p.rating)}</strong></div><strong>${esc(p.name)}</strong><div class="player-card__meta">${esc([p.title,p.federation,p.fideId?`FIDE ${p.fideId}`:""].filter(Boolean).join(" • "))}</div></article>`).join("");
    $("playersView").innerHTML=`<div class="data-table-wrap desktop-table"><table class="data-table"><thead><tr><th>#</th><th>Player</th><th>FED</th><th class="num">Rtg</th></tr></thead><tbody>${rows}</tbody></table></div><div class="mobile-list">${cards}</div>`;
  }

  function roundByNumber(roundNo){
    return (data.rounds||[]).find(round=>Number(round.round)===Number(roundNo));
  }

  function playerLabel(key,map){
    const p=key?map.get(key):null;
    return p||{name:"Bye",federation:"",rating:""};
  }

  function splitResult(result){
    const r=txt(result).replace("1/2","½");
    if(r==="1-0") return ["1","0"];
    if(r==="0-1") return ["0","1"];
    if(r==="½-½"||r==="½-1/2") return ["½","½"];
    return ["",""];
  }

  function renderPairings(){
    const select=$("pairingsRound");
    const selected=Number(select.value)||latestRound();
    const round=roundByNumber(selected);
    if(!round || !(round.pairings||[]).length){
      $("pairingsView").innerHTML=`<div class="empty-state"><strong>No pairings yet</strong>This round has not been published.</div>`;
      return;
    }
    const map=playerMap();
    const desktop=round.pairings.map(board=>{
      const white=playerLabel(board.whiteKey,map),black=playerLabel(board.blackKey,map);
      return `<tr><td class="rank-cell">${esc(board.board)}</td><td class="player-cell"><strong>${esc(white.name)}</strong><small>${esc(white.federation||"")}</small></td><td class="num">${esc(white.rating||"")}</td><td class="center"><span class="result">${esc(display(board.result))}</span></td><td class="player-cell"><strong>${esc(black.name)}</strong><small>${esc(black.federation||"")}</small></td><td class="num">${esc(black.rating||"")}</td></tr>`;
    }).join("");
    const mobile=round.pairings.map(board=>{
      const white=playerLabel(board.whiteKey,map),black=playerLabel(board.blackKey,map),scores=splitResult(board.result);
      return `<article class="mobile-card board-card"><div class="board-card__top"><span class="board-no">Board ${esc(board.board)}</span><span class="board-result">${esc(display(board.result))}</span></div><div class="board-player"><div><strong>${esc(white.name)}</strong><small>${esc([white.rating,white.federation].filter(Boolean).join(" • "))}</small></div><span class="board-score">${esc(scores[0])}</span></div><div class="board-player"><div><strong>${esc(black.name)}</strong><small>${esc([black.rating,black.federation].filter(Boolean).join(" • "))}</small></div><span class="board-score">${esc(scores[1])}</span></div></article>`;
    }).join("");
    $("pairingsView").innerHTML=`<div class="data-table-wrap desktop-table"><table class="data-table"><thead><tr><th>Board</th><th>White</th><th class="num">Rtg</th><th class="center">Result</th><th>Black</th><th class="num">Rtg</th></tr></thead><tbody>${desktop}</tbody></table></div><div class="mobile-list">${mobile}</div>`;
  }

  function renderStandings(){
    const s=data.standings||{rows:[],tieBreaks:[]};
    $("standingsRound").textContent=s.round?`after round ${s.round}`:"";
    if(!(s.rows||[]).length){
      $("standingsView").innerHTML=`<div class="empty-state"><strong>No standings yet</strong>Standings will appear after results are published.</div>`;
      return;
    }
    const map=playerMap();
    const tb=s.tieBreaks||[];
    const headers=tb.map(item=>`<th class="num" title="${esc(item.label)}">${esc(item.key.toUpperCase())}</th>`).join("");
    const rows=s.rows.map(row=>{
      const p=playerLabel(row.playerKey,map);
      const values=(row.tieBreakValues||[]).map(value=>`<td class="num">${esc(value)}</td>`).join("");
      return `<tr><td class="rank-cell">${esc(row.rank)}</td><td class="player-cell"><strong>${esc(p.name)}</strong><small>${esc(p.federation||"")}</small></td><td class="num">${esc(p.rating||"")}</td><td class="num points">${esc(row.points)}</td>${values}</tr>`;
    }).join("");
    const cards=s.rows.map(row=>{
      const p=playerLabel(row.playerKey,map);
      const details=tb.map((item,index)=>`<div class="tb-item"><span>${esc(item.label)}</span><strong>${esc((row.tieBreakValues||[])[index]??"—")}</strong></div>`).join("");
      return `<article class="mobile-card standing-card"><div class="standing-card__top"><span class="standing-card__rank">${esc(row.rank)}</span><div class="standing-card__person"><strong>${esc(p.name)}</strong><small>${esc([p.rating,p.federation].filter(Boolean).join(" • "))}</small></div><span class="standing-card__points">${esc(row.points)}</span></div>${tb.length?`<details class="tb-details"><summary>Show tie-breaks</summary><div class="tb-grid">${details}</div></details>`:""}</article>`;
    }).join("");
    $("standingsView").innerHTML=`<div class="data-table-wrap desktop-table"><table class="data-table"><thead><tr><th>Rank</th><th>Player</th><th class="num">Rtg</th><th class="num">Pts</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div><div class="mobile-list">${cards}</div>`;
  }

  function setupRoundSelect(){
    const select=$("pairingsRound");
    const rounds=[...(data.rounds||[])].sort((a,b)=>Number(a.round)-Number(b.round));
    select.innerHTML=rounds.map(round=>`<option value="${esc(round.round)}">Round ${esc(round.round)}</option>`).join("");
    if(rounds.length) select.value=String(latestRound());
    select.addEventListener("change",renderPairings);
  }

  function showSection(section,updateHash=true){
    const allowed=new Set(["overview","players","pairings","standings"]);
    activeSection=allowed.has(section)?section:"overview";
    document.querySelectorAll("[data-panel]").forEach(panel=>panel.hidden=panel.dataset.panel!==activeSection);
    document.querySelectorAll(".section-tab").forEach(tab=>{
      const active=tab.dataset.section===activeSection;
      tab.classList.toggle("is-active",active);
      tab.setAttribute("aria-selected",String(active));
    });
    if(updateHash && location.hash!==`#${activeSection}`) history.replaceState(null,"",`#${activeSection}`);
  }

  function bindEvents(){
    document.querySelectorAll(".section-tab").forEach(tab=>tab.addEventListener("click",()=>showSection(tab.dataset.section)));
    $("playerSearch").addEventListener("input",renderPlayers);
    window.addEventListener("hashchange",()=>showSection(location.hash.slice(1),false));
  }

  function renderAll(){
    renderHeader();renderOverview();renderPlayers();setupRoundSelect();renderPairings();renderStandings();
    showSection(location.hash.slice(1)||"overview",false);
  }

  async function init(){
    bindEvents();
    try{
      const response=await fetch("sample-tournament.json",{cache:"no-store"});
      if(!response.ok) throw new Error(`Tournament data request failed (${response.status}).`);
      data=await response.json();
      renderAll();
    }catch(error){
      $("hubError").hidden=false;
      $("hubError").textContent=`Unable to load tournament data. ${error.message}`;
      $("updatedText").textContent="Data unavailable";
    }
  }

  return {init};
})();

document.addEventListener("DOMContentLoaded",HubPage.init);
