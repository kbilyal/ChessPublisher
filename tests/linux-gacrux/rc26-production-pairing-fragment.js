// Extracted byte-for-byte from Chess-Publisher v1.05.00-RC26 production HTML.
// Test-only fragment; not a replacement runtime.

function normalizePlayerTitle(value){
  const title=String(value??"").trim().toUpperCase();
  return ["GM","IM","WGM","FM","WIM","CM","WFM","WCM"].includes(title) ? title : "";
}

function cpTRFNormalizeResult(value){
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

function cpTRFPlayerKeyAliases(player,index){
  const aliases=new Set();
  const primary=playerKey(player,index);
  if(primary) aliases.add(String(primary));

  const localKey=String(player?.localKey||"").trim();
  if(localKey) aliases.add(localKey);

  const fideId=String(player?.fideId||"").trim();
  if(fideId && fideId!=="-"){
    aliases.add("fid:"+fideId);
    aliases.add(fideId);
  }

  const pn=Number(player?.pairingNumber || player?.pairingNo);
  if(Number.isInteger(pn) && pn>0){
    aliases.add(String(pn));
    aliases.add("pn:"+pn);
    aliases.add("pairing:"+pn);
    aliases.add("pairingNumber:"+pn);
  }
  return aliases;
}

function cpTRFBuildPlayerMaps(t){
  ensurePairingNumbers(t);

  const raw=(t.players||[]).map((player,index)=>({player,index}));
  raw.sort((a,b)=>
    Number(a.player.pairingNumber||a.player.pairingNo||0)-
    Number(b.player.pairingNumber||b.player.pairingNo||0)
  );

  const rows=[];
  const byKey=new Map();
  const byNumber=new Map();

  for(const item of raw){
    const p=item.player;
    const index=item.index;
    const id=Number(p.pairingNumber || p.pairingNo);

    if(!Number.isInteger(id) || id<=0){
      throw new Error(`TRF repair: invalid Pairing No. for player "${p.name||"?"}".`);
    }

    const key=playerKey(p,index);

    const row={
      id,
      key,
      sourcePlayer:p,
      sourceIndex:index,
      name:p.name||"",
      rating:Number(p.rating)||0,
      title:normalizePlayerTitle(p.title),
      fed:p.fed||"---",
      fideId:p.fideId||"",
      birth:p.birth||"",
      gender:p.gender||"",
      joinedFromRound:
        typeof getPlayerJoinRound==="function"
          ? Math.max(1,Number(getPlayerJoinRound(p))||1)
          : 1,
      score:0,
      wins:0,
      gameWins:0,
      blackWins:0,
      opponents:[],
      colors:[],
      byeCount:0,
      fullPointUnplayed:0,
      rounds:[]
    };

    rows.push(row);
    byNumber.set(id,row);

    for(const alias of cpTRFPlayerKeyAliases(p,index)){
      if(alias) byKey.set(String(alias),row);
    }
  }

  return {rows,byKey,byNumber};
}

function cpTRFResolveBoardPlayer(rawKey,maps){
  const key=String(rawKey ?? "").trim();
  if(!key) return null;

  if(maps.byKey.has(key)) return maps.byKey.get(key);

  const m=key.match(/^(?:pn:|pairing:|pairingNumber:)?(\d+)$/i);
  if(m){
    const n=Number(m[1]);
    if(maps.byNumber.has(n)) return maps.byNumber.get(n);
  }

  return null;
}

function cpTRFPointsForCode(code,pointsOverride=null){
  if(pointsOverride!==null && Number.isFinite(Number(pointsOverride))){
    return Number(pointsOverride);
  }
  if(code==="1" || code==="+" || code==="U" || code==="F" || code==="W") return 1;
  if(code==="=" || code==="H" || code==="D") return 0.5;
  return 0;
}

function tournamentState(){
  const t=getCurrentTournament();
  if(!t) return {rows:[],map:new Map()};

  if(!t.pairings) t.pairings={};
  if(!t.pairings.liveBoards) t.pairings.liveBoards={};

  const maps=cpTRFBuildPlayerMaps(t);
  const rows=maps.rows;
  const maxRounds=parseInt(t.settings?.rounds)||7;

  const addRound=(player,roundNo,record,pointsOverride=null)=>{
    player.rounds[roundNo-1]=record;
    const points=cpTRFPointsForCode(record.result,pointsOverride);
    player.score+=points;
    if(points===1) player.wins++;

    if(record.played){
      if(record.opp>0) player.opponents.push(record.opp);
      if(record.color==="w" || record.color==="b") player.colors.push(record.color);
      if(record.result==="1" || record.result==="W"){
        player.gameWins++;
        if(record.color==="b") player.blackWins++;
      }
    }

    if(!record.played && points===1) player.fullPointUnplayed++;

    if(record.result==="U" || record.result==="F" || record.result==="H" || record.result==="Z"){
      player.byeCount++;
    }
  };

  for(const player of rows){
    for(let r=1;r<player.joinedFromRound && r<=maxRounds;r++){
      addRound(player,r,{
        opp:0,color:"-",result:"Z",played:false,kind:"late-entry",points:0
      },0);
    }
  }

  for(let round=1;round<=maxRounds;round++){
    const boards=t.pairings.liveBoards?.[String(round)];
    if(!Array.isArray(boards) || boards.length===0) continue;

    for(const board of boards){
      const whiteKey=String(board?.whiteKey ?? "").trim();
      const blackKey=String(board?.blackKey ?? "").trim();

      const white=cpTRFResolveBoardPlayer(whiteKey,maps);
      const black=cpTRFResolveBoardPlayer(blackKey,maps);

      if(whiteKey && !white){
        throw new Error(
          `TRF repair: Round ${round}, board ${board?.board||"?"}: cannot map whiteKey "${whiteKey}" to a Pairing No.`
        );
      }
      if(blackKey && !black){
        throw new Error(
          `TRF repair: Round ${round}, board ${board?.board||"?"}: cannot map blackKey "${blackKey}" to a Pairing No.`
        );
      }

      const res=cpTRFNormalizeResult(board?.result);
      const importedResult=cpTRFNormalizeResult(board?.trfImportedResult);
      const importedSemanticsActive=!!board?.trfImportedResult && importedResult===res;

      if(white && black){
        if(importedSemanticsActive && board?.trfOriginalCodes){
          const wc=String(board.trfOriginalCodes.white||"").toUpperCase();
          const bc=String(board.trfOriginalCodes.black||"").toUpperCase();
          if((wc==="W"&&bc==="L")||(wc==="L"&&bc==="W")||(wc==="D"&&bc==="D")){
            addRound(white,round,{opp:black.id,color:"w",result:wc,played:false,kind:"unrated-game",points:cpTRFPointsForCode(wc)},cpTRFPointsForCode(wc));
            addRound(black,round,{opp:white.id,color:"b",result:bc,played:false,kind:"unrated-game",points:cpTRFPointsForCode(bc)},cpTRFPointsForCode(bc));
            continue;
          }
        }
        let wr=" ", br=" ", played=false, forfeit=false;

        if(res==="1-0" || res==="1:0"){
          wr="1"; br="0"; played=true;
        }else if(res==="0-1" || res==="0:1"){
          wr="0"; br="1"; played=true;
        }else if(res==="½-½" || res==="1/2-1/2" || res==="0.5-0.5" || res==="="){
          wr="="; br="="; played=true;
        }else if(res==="1F-0F" || res==="+:-" || res==="+--"){
          wr="+"; br="-"; forfeit=true;
        }else if(res==="0F-1F" || res==="-:+" || res==="--+"){
          wr="-"; br="+"; forfeit=true;
        }else if(res==="0F-0F" || res==="-:-"){
          wr="-"; br="-"; forfeit=true;
        }else{
          continue;
        }

        if(played){
          addRound(white,round,{opp:black.id,color:"w",result:wr,played:true,kind:"played"});
          addRound(black,round,{opp:white.id,color:"b",result:br,played:true,kind:"played"});
        }else if(forfeit){
          addRound(white,round,{opp:black.id,color:"w",result:wr,played:false,kind:"forfeit"});
          addRound(black,round,{opp:white.id,color:"b",result:br,played:false,kind:"forfeit"});
        }
        continue;
      }

      const single=white||black;
      if(!single) continue;

      if(importedSemanticsActive && board?.trfOriginalCode!==undefined){
        const originalCode=String(board.trfOriginalCode||"").toUpperCase();
        if(originalCode==="F"){
          addRound(single,round,{opp:0,color:"-",result:"F",played:false,kind:"full-bye",points:1},1);
          continue;
        }
        if(originalCode==="U"){
          const pab=typeof getPabPoints==="function"?Number(getPabPoints()):1;
          const safe=Number.isFinite(pab)?pab:1;
          addRound(single,round,{opp:0,color:"-",result:"U",played:false,kind:"pairing-bye",points:safe},safe);
          continue;
        }
        if(originalCode==="H"){
          addRound(single,round,{opp:0,color:"-",result:"H",played:false,kind:"half-bye",points:0.5},0.5);
          continue;
        }
        if(originalCode==="Z" || originalCode===""){
          addRound(single,round,{opp:0,color:"-",result:"Z",played:false,kind:"zero-bye",points:0},0);
          continue;
        }
      }

      if(res==="1BYE" || res==="FULLBYE"){
        addRound(single,round,{
          opp:0,color:"-",result:"F",played:false,kind:"full-bye",points:1
        },1);
      }else if(res==="PAB"){
        const pabPoints=
          typeof getPabPoints==="function" ? Number(getPabPoints()) : 1;
        const safePab=Number.isFinite(pabPoints)?pabPoints:1;

        addRound(single,round,{
          opp:0,color:"-",result:"U",played:false,kind:"pairing-bye",points:safePab
        },safePab);
      }else if(res==="½BYE" || res==="1/2BYE" || res==="0.5BYE"){
        addRound(single,round,{
          opp:0,color:"-",result:"H",played:false,kind:"half-bye",points:0.5
        },0.5);
      }else if(res==="0BYE"){
        addRound(single,round,{
          opp:0,color:"-",result:"Z",played:false,kind:"zero-bye",points:0
        },0);
      }
    }
  }

  const idMap=new Map(rows.map(row=>[row.key,row.id]));
  return {rows,map:idMap};
}

function bbpAscii(value){
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^\x20-\x7e]/g,"?").replace(/\s+/g," ").trim();
}

function bbpRoundField(round){
  if(!round) return "          ";

  const opponentNumber=Number(round.opp);
  const opponent=
    Number.isInteger(opponentNumber) && opponentNumber>0
      ? String(opponentNumber).padStart(4," ").slice(-4)
      : "0000";

  const color=(round.color==="w" || round.color==="b") ? round.color : "-";

  let result=String(round.result||" ").slice(0,1);
  const kind=String(round.kind||"").toLowerCase();
  if(result==="F" && (kind==="pairing-bye" || kind==="pab" || !kind)) result="U";

  return opponent+" "+color+" "+result+"  ";
}

function pairingEngineScoreFromHistory(rounds,completed){
  let score=0;
  for(let i=0;i<completed;i++){
    const rd=rounds?.[i];
    if(!rd) continue;

    if(Number.isFinite(Number(rd.points)) && (rd.kind==="pairing-bye" || ["F","U"].includes(String(rd.result||"").slice(0,1)))){
      score+=Number(rd.points);
      continue;
    }

    let code=String(rd.result||" ").slice(0,1);
    const kind=String(rd.kind||"").toLowerCase();
    if(code==="F" && (kind==="pairing-bye" || kind==="pab" || !kind)) code="U";

    if(code==="1" || code==="+" || code==="F" || code==="U" || code==="W") score+=1;
    else if(code==="=" || code==="H" || code==="D") score+=0.5;
  }
  return score;
}

function cpTRFValidateCompletedHistory(rows,completed){
  const missing=[];
  const malformedForfeits=[];

  for(const player of rows){
    for(let r=1;r<=completed;r++){
      const rd=player.rounds?.[r-1];
      if(!rd){
        missing.push(`${player.id} (R${r})`);
        continue;
      }

      const code=String(rd.result||" ").slice(0,1);
      if(!"10=+-UHFZWD".includes(code)){
        missing.push(`${player.id} (R${r}:${code||"blank"})`);
      }

      if(
        rd?.kind==="forfeit" &&
        Number(rd?.opp)>0 &&
        !(rd?.color==="w" || rd?.color==="b")
      ){
        malformedForfeits.push(`${player.id} (R${r})`);
      }
    }
  }

  if(missing.length){
    throw new Error(
      "TRF repair: incomplete liveBoards history for Pairing No.: "+missing.join(", ")
    );
  }

  if(malformedForfeits.length){
    throw new Error(
      "TRF repair: forfeited paired games must retain White/Black orientation: "+
      malformedForfeits.join(", ")
    );
  }
}

function buildPairingEngineTRF(initialColor="w"){
  const t=getCurrentTournament();
  if(!t) throw new Error("No tournament is currently selected.");

  ensurePairingNumbers(t);

  const state=tournamentState();
  const totalRounds=parseInt(t.settings?.rounds)||7;
  const completed=getCompletedRounds();
  const latest=getLatestGeneratedRound();
  const integrity=getPairingHistoryIntegrity();

  if(!integrity.ok || completed!==latest){
    throw new Error(
      integrity.message ||
      `Pairing history is incomplete: ${completed}/${latest} generated rounds are complete.`
    );
  }

  cpTRFValidateCompletedHistory(state.rows,completed);

  const effectiveInitialColor=
    typeof getInitialTopColorForEngine==="function"
      ? getInitialTopColorForEngine()
      : initialColor;

  const lines=[
    "012 "+bbpAscii(data.currentTournament||"Tournament"),
    "142 "+totalRounds,
    "152 "+(effectiveInitialColor==="b"?"B":"W"),
    "162  W 1.0    D 0.5    L 0.0    A 0.0    P "+getPabPoints().toFixed(1),
    "192 FIDE_DUTCH_2025"
  ];

  const players=state.rows.slice().sort((a,b)=>Number(a.id)-Number(b.id));

  players.forEach(player=>{
    const id=String(player.id).padStart(5," ");
    const name=bbpAscii(player.name).slice(0,33).padEnd(33," ");
    const rating=String(Math.max(0,Number(player.rating)||0)).padStart(4," ");

    const points=pairingEngineScoreFromHistory(
      player.rounds,completed
    ).toFixed(1).padStart(4," ");

    const position=String(player.id).padStart(5," ");

    const history=Array.from(
      {length:completed},
      (_,i)=>bbpRoundField(player.rounds?.[i])
    ).join("");

    const line=
      "001"+id+"      "+name+" "+rating+" ".repeat(28)+points+position+"  "+history;

    for(let r=1;r<=completed;r++){
      const rd=player.rounds?.[r-1];
      const start=91+(r-1)*10;

      const trfOpp=line.slice(start,start+4).trim();
      const trfColor=line.charAt(start+5);
      const trfResult=line.charAt(start+7);

      const expectedOpp=Number(rd?.opp)>0 ? String(Number(rd.opp)) : "0000";
      const expectedColor=(rd?.color==="w" || rd?.color==="b") ? rd.color : "-";

      let expectedResult=String(rd?.result||" ").slice(0,1);
      const expectedKind=String(rd?.kind||"").toLowerCase();
      if(expectedResult==="F" && (expectedKind==="pairing-bye" || expectedKind==="pab" || !expectedKind)) expectedResult="U";

      if(
        trfOpp!==expectedOpp ||
        trfColor!==expectedColor ||
        trfResult!==expectedResult
      ){
        throw new Error(
          `TRF fixed-column error: Pairing No. ${player.id}, Round ${r}. `+
          `Expected opp=${expectedOpp||"blank"}, color=${expectedColor}, result=${expectedResult}; `+
          `got opp=${trfOpp||"blank"}, color=${trfColor}, result=${trfResult}.`
        );
      }
    }

    lines.push(line);
  });

  const trf=lines.join("\r\n")+"\r\n";

  console.log("===== GACRUX TRF AFTER LIVEBOARDS REPAIR =====");
  console.log(trf);
  console.log("==============================================");

  return trf;
}
