export const HUB_API_VERSION="1";
export const SNAPSHOT_SCHEMA_VERSION="1.0";
export const PRODUCT="Chess-Publisher";
export const MAX_SNAPSHOT_BYTES=2*1024*1024;
export const MAX_PLAYERS=10000;
export const MAX_ROUNDS=99;
export const MAX_PAIRINGS_PER_ROUND=10000;

function isObject(value){
  return !!value && typeof value==="object" && !Array.isArray(value);
}

function text(value){
  return value===null || value===undefined ? "" : String(value).trim();
}

function requireText(value,label,max=1000){
  const valueText=text(value);
  if(!valueText) throw new HubContractError("snapshot_invalid",`${label} is required.`);
  if(valueText.length>max) throw new HubContractError("snapshot_invalid",`${label} is too long.`);
  return valueText;
}

function integer(value,label,min,max){
  if(!Number.isInteger(value) || value<min || value>max){
    throw new HubContractError("snapshot_invalid",`${label} is invalid.`);
  }
  return value;
}

function finiteNumber(value,label){
  if(typeof value!=="number" || !Number.isFinite(value)){
    throw new HubContractError("snapshot_invalid",`${label} is invalid.`);
  }
  return value;
}

function assertFederation(value,label){
  if(!/^[A-Z]{3}$/.test(text(value))){
    throw new HubContractError("snapshot_invalid",`${label} must be a three-letter federation code.`);
  }
}

function assertNullableIso(value,label){
  if(value===null) return;
  const raw=requireText(value,label,80);
  if(Number.isNaN(Date.parse(raw))) throw new HubContractError("snapshot_invalid",`${label} must be an ISO date/time or null.`);
}

export class HubContractError extends Error{
  constructor(code,message,status=400,details=null){
    super(message);
    this.name="HubContractError";
    this.code=code;
    this.status=status;
    this.details=details;
  }
}

export function canonicalize(value){
  if(Array.isArray(value)) return value.map(canonicalize);
  if(isObject(value)){
    return Object.keys(value).sort().reduce((out,key)=>{
      out[key]=canonicalize(value[key]);
      return out;
    },{});
  }
  return value;
}

export function canonicalStateObject(snapshot){
  validateSnapshot(snapshot);
  return canonicalize({
    schemaVersion:snapshot.schemaVersion,
    tournament:snapshot.tournament,
    players:snapshot.players,
    rounds:snapshot.rounds,
    standings:snapshot.standings,
    schedule:snapshot.schedule
  });
}

export function canonicalStateJson(snapshot){
  return JSON.stringify(canonicalStateObject(snapshot));
}

export async function sha256Hex(input){
  const bytes=typeof input==="string" ? new TextEncoder().encode(input) : input;
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}

export async function snapshotStateChecksum(snapshot){
  return sha256Hex(canonicalStateJson(snapshot));
}

export function normalizeRequestedSlug(value){
  const raw=text(value).toLowerCase();
  if(!raw) return null;
  const normalized=raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"")
    .replace(/-{2,}/g,"-");
  if(!normalized || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)){
    throw new HubContractError("bad_request","requestedSlug must contain ASCII letters, digits or hyphens.",400);
  }
  if(normalized.length>100) throw new HubContractError("bad_request","requestedSlug is too long.",400);
  return normalized;
}

export function validateCreateTournamentRequest(body){
  if(!isObject(body)) throw new HubContractError("bad_request","Request body must be a JSON object.",400);
  const localKey=requireText(body.localKey,"localKey",240);
  const name=requireText(body.name,"name",240);
  const requestedSlug=normalizeRequestedSlug(body.requestedSlug);
  return {localKey,name,requestedSlug};
}

export function validateSnapshot(snapshot){
  if(!isObject(snapshot)) throw new HubContractError("snapshot_invalid","Snapshot must be a JSON object.");
  if(snapshot.schemaVersion!==SNAPSHOT_SCHEMA_VERSION) throw new HubContractError("snapshot_invalid","Unsupported snapshot schema version.");
  if(!isObject(snapshot.client) || snapshot.client.product!==PRODUCT) throw new HubContractError("snapshot_invalid","Invalid snapshot client identity.");
  requireText(snapshot.client.version,"client.version",80);

  if(!isObject(snapshot.publication)) throw new HubContractError("snapshot_invalid","publication is required.");
  integer(snapshot.publication.revision,"publication.revision",0,1000000000);
  if(snapshot.publication.previousRevision!==null && snapshot.publication.previousRevision!==undefined){
    integer(snapshot.publication.previousRevision,"publication.previousRevision",0,1000000000);
  }
  assertNullableIso(snapshot.publication.generatedAt,"publication.generatedAt");
  if(snapshot.publication.publicSlug!==null && snapshot.publication.publicSlug!==undefined){
    const slug=text(snapshot.publication.publicSlug);
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new HubContractError("snapshot_invalid","publication.publicSlug is invalid.");
  }

  const tournament=snapshot.tournament;
  if(!isObject(tournament)) throw new HubContractError("snapshot_invalid","tournament is required.");
  requireText(tournament.localKey,"tournament.localKey",240);
  requireText(tournament.name,"tournament.name",240);
  if(!["draft","registration","playing","finished"].includes(tournament.status)) throw new HubContractError("snapshot_invalid","tournament.status is invalid.");
  integer(tournament.roundsDeclared,"tournament.roundsDeclared",1,99);

  if(!isObject(tournament.location)) throw new HubContractError("snapshot_invalid","tournament.location is required.");
  assertFederation(tournament.location.federation,"tournament.location.federation");

  if(!isObject(tournament.dates)) throw new HubContractError("snapshot_invalid","tournament.dates is required.");
  assertNullableIso(tournament.dates.start,"tournament.dates.start");
  assertNullableIso(tournament.dates.end,"tournament.dates.end");
  assertNullableIso(tournament.dates.registrationDeadline,"tournament.dates.registrationDeadline");

  if(!Array.isArray(snapshot.players)) throw new HubContractError("snapshot_invalid","players must be an array.");
  if(snapshot.players.length>MAX_PLAYERS) throw new HubContractError("snapshot_invalid",`players exceeds ${MAX_PLAYERS}.`);
  const playerKeys=new Set();
  for(let i=0;i<snapshot.players.length;i++){
    const player=snapshot.players[i];
    if(!isObject(player)) throw new HubContractError("snapshot_invalid",`players[${i}] is invalid.`);
    const key=requireText(player.key,`players[${i}].key`,240);
    requireText(player.name,`players[${i}].name`,240);
    if(playerKeys.has(key)) throw new HubContractError("snapshot_invalid",`Duplicate player key: ${key}.`);
    playerKeys.add(key);
    assertFederation(player.federation,`players[${i}].federation`);
    integer(player.rating,`players[${i}].rating`,0,4000);
    integer(player.joinedFromRound,`players[${i}].joinedFromRound`,1,99);
    if(!["present","absent"].includes(player.attendance)) throw new HubContractError("snapshot_invalid",`players[${i}].attendance is invalid.`);
  }

  if(!Array.isArray(snapshot.rounds)) throw new HubContractError("snapshot_invalid","rounds must be an array.");
  if(snapshot.rounds.length>MAX_ROUNDS) throw new HubContractError("snapshot_invalid",`rounds exceeds ${MAX_ROUNDS}.`);
  const roundNumbers=new Set();
  for(let r=0;r<snapshot.rounds.length;r++){
    const round=snapshot.rounds[r];
    if(!isObject(round)) throw new HubContractError("snapshot_invalid",`rounds[${r}] is invalid.`);
    integer(round.round,`rounds[${r}].round`,1,99);
    if(roundNumbers.has(round.round)) throw new HubContractError("snapshot_invalid",`Duplicate round: ${round.round}.`);
    roundNumbers.add(round.round);
    if(typeof round.complete!=="boolean") throw new HubContractError("snapshot_invalid",`rounds[${r}].complete is invalid.`);
    if(!Array.isArray(round.pairings)) throw new HubContractError("snapshot_invalid",`rounds[${r}].pairings must be an array.`);
    if(round.pairings.length>MAX_PAIRINGS_PER_ROUND) throw new HubContractError("snapshot_invalid",`rounds[${r}].pairings exceeds ${MAX_PAIRINGS_PER_ROUND}.`);
    const boards=new Set();
    for(let p=0;p<round.pairings.length;p++){
      const pairing=round.pairings[p];
      if(!isObject(pairing)) throw new HubContractError("snapshot_invalid",`rounds[${r}].pairings[${p}] is invalid.`);
      integer(pairing.board,`rounds[${r}].pairings[${p}].board`,1,100000);
      if(boards.has(pairing.board)) throw new HubContractError("snapshot_invalid",`Duplicate board ${pairing.board} in round ${round.round}.`);
      boards.add(pairing.board);
      for(const key of [pairing.whiteKey,pairing.blackKey]){
        if(key!==null && key!==undefined && !playerKeys.has(text(key))){
          throw new HubContractError("snapshot_invalid",`Unknown player key ${text(key)} in round ${round.round}.`);
        }
      }
      if(typeof pairing.result!=="string") throw new HubContractError("snapshot_invalid",`rounds[${r}].pairings[${p}].result is invalid.`);
    }
  }

  const standings=snapshot.standings;
  if(!isObject(standings)) throw new HubContractError("snapshot_invalid","standings is required.");
  integer(standings.round,"standings.round",0,99);
  if(typeof standings.final!=="boolean") throw new HubContractError("snapshot_invalid","standings.final is invalid.");
  if(!Array.isArray(standings.tieBreaks) || !Array.isArray(standings.rows)) throw new HubContractError("snapshot_invalid","standings arrays are invalid.");
  const standingPlayers=new Set();
  for(let i=0;i<standings.rows.length;i++){
    const row=standings.rows[i];
    if(!isObject(row)) throw new HubContractError("snapshot_invalid",`standings.rows[${i}] is invalid.`);
    integer(row.rank,`standings.rows[${i}].rank`,1,MAX_PLAYERS);
    const key=requireText(row.playerKey,`standings.rows[${i}].playerKey`,240);
    if(!playerKeys.has(key)) throw new HubContractError("snapshot_invalid",`Unknown standings player key: ${key}.`);
    if(standingPlayers.has(key)) throw new HubContractError("snapshot_invalid",`Duplicate standings player key: ${key}.`);
    standingPlayers.add(key);
    finiteNumber(row.points,`standings.rows[${i}].points`);
    if(!Array.isArray(row.tieBreakValues) || row.tieBreakValues.length!==standings.tieBreaks.length){
      throw new HubContractError("snapshot_invalid",`Tie-break value count mismatch for ${key}.`);
    }
  }

  if(!Array.isArray(snapshot.schedule)) throw new HubContractError("snapshot_invalid","schedule must be an array.");
  for(let i=0;i<snapshot.schedule.length;i++){
    const item=snapshot.schedule[i];
    if(!isObject(item)) throw new HubContractError("snapshot_invalid",`schedule[${i}] is invalid.`);
    assertNullableIso(item.dateTime,`schedule[${i}].dateTime`);
  }

  return true;
}

export function publicationDecision({currentRevision,currentChecksum,expectedRevision,incomingChecksum}){
  integer(currentRevision,"currentRevision",0,1000000000);
  integer(expectedRevision,"expectedRevision",0,1000000000);
  requireText(incomingChecksum,"incomingChecksum",128);

  if(expectedRevision===currentRevision){
    return {kind:"accept",nextRevision:currentRevision+1};
  }

  if(
    currentRevision===expectedRevision+1 &&
    currentChecksum &&
    currentChecksum===incomingChecksum
  ){
    return {kind:"idempotent",revision:currentRevision};
  }

  if(expectedRevision<currentRevision){
    return {kind:"stale",currentRevision};
  }

  return {kind:"client_ahead",currentRevision};
}

export function buildRevisionObjectKey(tournamentId,revision,checksum){
  const id=requireText(tournamentId,"tournamentId",100);
  if(!/^ht_[a-zA-Z0-9]+$/.test(id)) throw new HubContractError("bad_request","Invalid Hub tournament ID.");
  integer(revision,"revision",1,1000000000);
  if(!/^[a-f0-9]{64}$/.test(text(checksum))) throw new HubContractError("bad_request","Invalid SHA-256 checksum.");
  return `tournaments/${id}/revisions/${String(revision).padStart(8,"0")}-${checksum}.json`;
}

export function acceptedSnapshot(snapshot,{tournamentId,publicSlug,revision,previousRevision,checksum}){
  validateSnapshot(snapshot);
  const copy=JSON.parse(JSON.stringify(snapshot));
  copy.publication.hubTournamentId=tournamentId;
  copy.publication.publicSlug=publicSlug;
  copy.publication.revision=revision;
  copy.publication.previousRevision=previousRevision;
  copy.publication.checksum=checksum;
  validateSnapshot(copy);
  return copy;
}

export function byteLengthUtf8(value){
  return new TextEncoder().encode(value).byteLength;
}
