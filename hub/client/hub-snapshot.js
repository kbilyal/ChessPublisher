(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  if(root) root.ChessPublisherHubSnapshot=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const SCHEMA_VERSION="1.0";
  const PRODUCT="Chess-Publisher";
  const BYE_RESULTS=new Set(["PAB","½ BYE","1/2 BYE","0 BYE"]);

  function text(value){return value===null||value===undefined?"":String(value).trim();}
  function nullableText(value){const valueText=text(value);return valueText&&valueText!=="-"?valueText:null;}
  function asInteger(value,fallback=0){const number=Number.parseInt(value,10);return Number.isFinite(number)?number:fallback;}
  function asNumber(value,fallback=0){const number=Number(value);return Number.isFinite(number)?number:fallback;}
  function stableDecimal(value){const number=Number(value);if(!Number.isFinite(number))return value;return Math.round((number+Number.EPSILON)*1000000)/1000000;}
  function asBoolean(value){if(typeof value==="boolean")return value;return /^(yes|true|1|y)$/i.test(text(value));}
  function isoOrNull(value){
    if(!value)return null;
    if(value instanceof Date)return Number.isNaN(value.getTime())?null:value.toISOString();
    const raw=text(value);if(!raw)return null;
    const date=new Date(raw);return Number.isNaN(date.getTime())?null:date.toISOString();
  }
  function normalizeFederation(value){const raw=text(value).toUpperCase();if(!raw||raw==="FIDE")return "FID";return /^[A-Z]{3}$/.test(raw)?raw:"FID";}
  function playerStableKey(player,index){
    // Chess-Publisher localKey is the immutable internal identity. FIDE ID is
    // editable tournament data and must never replace the pairing/history key.
    const localKey=text(player?.localKey);if(localKey)return localKey;
    const fideId=nullableText(player?.fideId);if(fideId)return `fid:${fideId}`;
    throw new Error(`Hub snapshot requires a stable key for local player at index ${index}.`);
  }
  function normalizeResult(value){return text(value)||"-";}
  function isByeResult(value){return BYE_RESULTS.has(normalizeResult(value).toUpperCase());}
  function boardComplete(board){const result=normalizeResult(board?.result);if(isByeResult(result))return true;return !!text(board?.whiteKey)&&!!text(board?.blackKey)&&result!=="-";}
  function roundComplete(boards){return Array.isArray(boards)&&boards.length>0&&boards.every(boardComplete);}
  function generatedRoundNumbers(tournament){
    const live=tournament?.pairings?.liveBoards||{};
    return Object.keys(live).map(Number).filter(number=>Number.isInteger(number)&&number>0&&Array.isArray(live[String(number)])&&live[String(number)].length>0).sort((a,b)=>a-b);
  }
  function deriveStatus(tournament,roundsDeclared){
    const rounds=generatedRoundNumbers(tournament);const latest=rounds.length?rounds[rounds.length-1]:0;
    if(roundsDeclared>0&&latest>=roundsDeclared&&roundComplete(tournament?.pairings?.liveBoards?.[String(roundsDeclared)]))return "finished";
    if(latest>0)return "playing";
    if((tournament?.players||[]).length>0||text(tournament?.settings?.startDate))return "registration";
    return "draft";
  }
  function normalizePlayers(tournament){
    return (tournament?.players||[]).map((player,index)=>({
      key:playerStableKey(player,index),name:text(player?.name),fideId:nullableText(player?.fideId),federation:normalizeFederation(player?.fed),rating:Math.max(0,asInteger(player?.rating,0)),birth:nullableText(player?.birth),title:text(player?.title),attendance:player?.attendance==="absent"?"absent":"present",joinedFromRound:Math.max(1,asInteger(player?.joinedFromRound,1))
    }));
  }
  function normalizeRounds(tournament){
    const live=tournament?.pairings?.liveBoards||{};
    return generatedRoundNumbers(tournament).map(round=>({
      round,complete:roundComplete(live[String(round)]||[]),pairings:(live[String(round)]||[]).map((board,index)=>({board:Math.max(1,asInteger(board?.board,index+1)),whiteKey:nullableText(board?.whiteKey),blackKey:nullableText(board?.blackKey),result:normalizeResult(board?.result)})).sort((a,b)=>a.board-b.board)
    }));
  }
  function defaultTieBreakKey(label,index){
    const compact=text(label).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
    return compact||`tb-${index+1}`;
  }
  function normalizeStandings(standings,options={}){
    const players=Array.isArray(standings?.players)?standings.players:[];
    const tieList=Array.isArray(standings?.tieList)?standings.tieList:[];
    const valueFn=typeof options.tieBreakValueFn==="function"?options.tieBreakValueFn:()=>0;
    const round=Math.max(0,asInteger(standings?.completed,0));
    const roundsDeclared=Math.max(0,asInteger(options.roundsDeclared,0));
    return {
      round,final:roundsDeclared>0&&round>=roundsDeclared,
      tieBreaks:tieList.map((label,index)=>({key:defaultTieBreakKey(label,index),label:text(label)})),
      rows:players.map((player,index)=>({rank:index+1,playerKey:text(player?.key)||playerStableKey(player,index),points:asNumber(player?.score,0),tieBreakValues:tieList.map(label=>{const value=valueFn(player,label);return typeof value==="number"&&Number.isFinite(value)?stableDecimal(value):text(value);})}))
    };
  }
  function normalizeRegulationsFile(tournament){
    const raw=tournament?.hub?.regulationsFile;
    if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
    const name=text(raw.name||raw.fileName||raw.filename);
    const size=Math.max(0,asInteger(raw.size??raw.sizeBytes,0));
    if(!name)return null;
    return {
      name,
      size,
      contentType:text(raw.contentType||raw.mimeType||raw.type)||"application/octet-stream",
      uploadedAt:isoOrNull(raw.uploadedAt||raw.createdAt),
      objectKey:nullableText(raw.objectKey||raw.key||raw.storageKey),
      url:nullableText(raw.url||raw.publicUrl||raw.downloadUrl),
      sha256:nullableText(raw.sha256||raw.checksum),
      etag:nullableText(raw.etag)
    };
  }
  function normalizeRegulations(tournament){
    const r=tournament?.regulations||{};
    return {
      eligibility:text(r.eligibility),format:text(r.format),rounds:text(r.rounds),timeControl:text(r.timeControl),pairingSystem:text(r.pairingSystem),
      rating:text(r.rating),defaultTime:text(r.defaultTime),drawRules:text(r.drawRules),pabPoints:text(r.pabPoints),
      tieBreaks:(Array.isArray(r.tieBreaks)?r.tieBreaks:[]).map(text).filter(Boolean),entryFee:text(r.entryFee),
      registrationDeadline:isoOrNull(r.registrationDeadline),maximumPlayers:text(r.maximumPlayers),fideInfo:text(r.fideInfo),
      totalPrizeFund:text(r.totalPrizeFund),mainPrizes:text(r.mainPrizes),specialPrizes:text(r.specialPrizes),categoryPrizes:text(r.categoryPrizes),
      additional:text(r.additional),file:normalizeRegulationsFile(tournament)
    };
  }
  function normalizeSchedule(tournament){
    const rows=Array.isArray(tournament?.schedule?.rows)?tournament.schedule.rows:[];
    return rows.map(row=>({no:text(row?.no),dateTime:isoOrNull(row?.dateTime),event:text(row?.event),description:text(row?.description)}));
  }
  function buildSnapshot(options){
    if(!options||typeof options!=="object")throw new Error("Hub snapshot options are required.");
    const tournament=options.tournament;if(!tournament||typeof tournament!=="object")throw new Error("Tournament state is required.");
    const tournamentName=text(options.tournamentName);if(!tournamentName)throw new Error("Tournament name is required.");
    const localTournamentId=text(options.localTournamentId);if(!localTournamentId)throw new Error("A stable Hub local tournament ID is required.");
    const clientVersion=text(options.clientVersion);if(!clientVersion)throw new Error("Chess-Publisher client version is required.");
    const settings=tournament.settings||{};const roundsDeclared=Math.max(1,asInteger(settings.rounds,1));
    const standings=normalizeStandings(options.standings||{},{tieBreakValueFn:options.tieBreakValueFn,roundsDeclared});
    const snapshot={
      schemaVersion:SCHEMA_VERSION,client:{product:PRODUCT,version:clientVersion},
      publication:{hubTournamentId:nullableText(options.hubTournamentId),publicSlug:nullableText(options.publicSlug),revision:Math.max(0,asInteger(options.revision,0)),generatedAt:isoOrNull(options.generatedAt||new Date()),previousRevision:options.previousRevision===null||options.previousRevision===undefined?null:Math.max(0,asInteger(options.previousRevision,0)),checksum:nullableText(options.checksum)},
      tournament:{localKey:localTournamentId,name:tournamentName,status:deriveStatus(tournament,roundsDeclared),format:text(settings.tournamentFormat),pairingSystem:text(settings.pairingSystem),timeControl:text(settings.timeControl),ratingType:text(settings.tournamentRatingType),fideRated:asBoolean(settings.fideRated),roundsDeclared,location:{venue:text(settings.venue),city:text(settings.city),federation:normalizeFederation(settings.country)},staff:{organizer:text(settings.organizer),chiefArbiter:text(settings.chiefArbiter),arbiter:text(settings.arbiter),director:text(settings.director)},dates:{start:isoOrNull(settings.startDate),end:isoOrNull(settings.endDate),registrationDeadline:isoOrNull(settings.generalRegistrationDeadline)},contact:{email:text(settings.email),phone:text(settings.phone)},links:{website:text(settings.website),live:text(settings.liveLink)}},
      players:normalizePlayers(tournament),rounds:normalizeRounds(tournament),standings,regulations:normalizeRegulations(tournament),schedule:normalizeSchedule(tournament)
    };
    validateSnapshot(snapshot);return snapshot;
  }
  function validateSnapshot(snapshot){
    if(snapshot?.schemaVersion!==SCHEMA_VERSION)throw new Error("Unsupported Hub snapshot schema version.");
    if(snapshot?.client?.product!==PRODUCT||!text(snapshot?.client?.version))throw new Error("Invalid Hub snapshot client.");
    if(!text(snapshot?.tournament?.localKey))throw new Error("Tournament local key is missing.");
    if(!text(snapshot?.tournament?.name))throw new Error("Tournament name is missing.");
    if(!/^[A-Z]{3}$/.test(text(snapshot?.tournament?.location?.federation)))throw new Error("Tournament federation must be a three-letter code.");
    const players=Array.isArray(snapshot.players)?snapshot.players:[];const playerKeys=new Set();
    for(const player of players){
      if(!text(player.key))throw new Error("A Hub player key is missing.");
      if(!text(player.name))throw new Error(`Hub player name is missing for ${player.key}.`);
      if(playerKeys.has(player.key))throw new Error(`Duplicate Hub player key: ${player.key}`);
      if(!/^[A-Z]{3}$/.test(text(player.federation)))throw new Error(`Player federation must be a three-letter code: ${player.key}`);
      playerKeys.add(player.key);
    }
    const roundNumbers=new Set();
    for(const round of snapshot.rounds||[]){
      if(roundNumbers.has(round.round))throw new Error(`Duplicate Hub round: ${round.round}`);roundNumbers.add(round.round);const boards=new Set();
      for(const pairing of round.pairings||[]){
        if(boards.has(pairing.board))throw new Error(`Duplicate board ${pairing.board} in round ${round.round}.`);boards.add(pairing.board);
        for(const key of [pairing.whiteKey,pairing.blackKey])if(key&&!playerKeys.has(key))throw new Error(`Unknown player key ${key} in round ${round.round}.`);
      }
    }
    const regulationsFile=snapshot?.regulations?.file;
    if(regulationsFile){
      if(!text(regulationsFile.name))throw new Error("Regulations attachment filename is missing.");
      if(!Number.isInteger(regulationsFile.size)||regulationsFile.size<0||regulationsFile.size>20*1024*1024)throw new Error("Regulations attachment size is invalid.");
    }
    const standingPlayers=new Set();
    for(const row of snapshot?.standings?.rows||[]){
      if(!playerKeys.has(row.playerKey))throw new Error(`Unknown standings player key: ${row.playerKey}`);
      if(standingPlayers.has(row.playerKey))throw new Error(`Duplicate standings player key: ${row.playerKey}`);standingPlayers.add(row.playerKey);
      if((row.tieBreakValues||[]).length!==(snapshot?.standings?.tieBreaks||[]).length)throw new Error(`Tie-break value count mismatch for ${row.playerKey}.`);
    }
    return true;
  }
  function canonicalize(value){
    if(Array.isArray(value))return value.map(canonicalize);
    if(value&&typeof value==="object")return Object.keys(value).sort().reduce((out,key)=>{out[key]=canonicalize(value[key]);return out;},{});
    return value;
  }
  function canonicalStateObject(snapshot){validateSnapshot(snapshot);return canonicalize({schemaVersion:snapshot.schemaVersion,tournament:snapshot.tournament,players:snapshot.players,rounds:snapshot.rounds,standings:snapshot.standings,regulations:snapshot.regulations,schedule:snapshot.schedule});}
  function canonicalJson(snapshot){return JSON.stringify(canonicalStateObject(snapshot));}
  return Object.freeze({SCHEMA_VERSION,PRODUCT,buildSnapshot,validateSnapshot,canonicalJson,canonicalStateObject,normalizeFederation,roundComplete,isByeResult});
});
