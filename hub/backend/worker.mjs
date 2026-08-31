import {
  HUB_API_VERSION,
  MAX_SNAPSHOT_BYTES,
  HubContractError,
  acceptedSnapshot,
  buildRevisionObjectKey,
  byteLengthUtf8,
  canonicalize,
  publicationDecision,
  sha256Hex,
  snapshotStateChecksum,
  validateCreateTournamentRequest,
  validateSnapshot
} from "./core.mjs";

const JSON_HEADERS={"content-type":"application/json; charset=utf-8","x-content-type-options":"nosniff"};
const PUBLIC_CACHE="public, max-age=15, stale-while-revalidate=60";

function nowIso(){
  return new Date().toISOString();
}

function requestId(request){
  return request.headers.get("cf-ray") || crypto.randomUUID();
}

function json(data,status=200,headers={}){
  return new Response(JSON.stringify(data),{
    status,
    headers:{...JSON_HEADERS,...headers}
  });
}

function isHubContractError(error){
  return !!error &&
    typeof error==="object" &&
    typeof error.code==="string" &&
    typeof error.message==="string" &&
    Number.isInteger(error.status) &&
    error.status>=400 &&
    error.status<=599;
}

function errorJson(error,id){
  // Do not rely only on instanceof here. Workers/Miniflare can move errors
  // across module/runtime boundaries where prototype identity is not stable.
  const known=isHubContractError(error);
  const status=known ? error.status : 500;
  const code=known ? error.code : "internal_error";
  const message=known ? error.message : "Unexpected Hub API error.";
  return json({error:{code,message,requestId:id}},status);
}

function publicHeaders(extra={}){
  return {
    "access-control-allow-origin":"*",
    "cache-control":PUBLIC_CACHE,
    "x-content-type-options":"nosniff",
    ...extra
  };
}

async function readJsonBody(request,maxBytes){
  const declared=Number(request.headers.get("content-length")||0);
  if(declared>maxBytes) throw new HubContractError("payload_too_large","Request body is too large.",413);
  const raw=await request.text();
  if(byteLengthUtf8(raw)>maxBytes) throw new HubContractError("payload_too_large","Request body is too large.",413);
  try{
    return JSON.parse(raw);
  }catch{
    throw new HubContractError("bad_request","Request body is not valid JSON.",400);
  }
}

function bearerToken(request){
  const authorization=request.headers.get("authorization")||"";
  const match=/^Bearer\s+(.+)$/i.exec(authorization);
  return match ? match[1].trim() : "";
}

async function authenticateOrganizer(request,env){
  const token=bearerToken(request);
  if(!token || token.length<24 || token.length>512){
    throw new HubContractError("unauthorized","Organizer credential is missing or invalid.",401);
  }
  const tokenHash=await sha256Hex(token);
  const credential=await env.DB.prepare(`
    SELECT c.id AS credential_id, c.organizer_id, o.display_name
      FROM organizer_credentials c
      JOIN organizers o ON o.id = c.organizer_id
     WHERE c.token_hash = ?1
       AND c.revoked_at IS NULL
       AND o.disabled_at IS NULL
     LIMIT 1
  `).bind(tokenHash).first();
  if(!credential) throw new HubContractError("unauthorized","Organizer credential is missing or invalid.",401);
  await env.DB.prepare("UPDATE organizer_credentials SET last_used_at = ?1 WHERE id = ?2")
    .bind(nowIso(),credential.credential_id).run();
  return credential;
}

function newTournamentId(){
  return `ht_${crypto.randomUUID().replaceAll("-","")}`;
}

function fallbackSlug(tournamentId){
  return `event-${tournamentId.slice(-12).toLowerCase()}`;
}

async function createTournament(request,env){
  const organizer=await authenticateOrganizer(request,env);
  const body=validateCreateTournamentRequest(await readJsonBody(request,64*1024));

  const existing=await env.DB.prepare(`
    SELECT id, public_slug, current_revision, name
      FROM tournaments
     WHERE owner_id = ?1 AND local_key = ?2
     LIMIT 1
  `).bind(organizer.organizer_id,body.localKey).first();

  if(existing){
    return json({
      tournamentId:existing.id,
      publicSlug:existing.public_slug,
      currentRevision:existing.current_revision,
      linked:true
    },200);
  }

  const tournamentId=newTournamentId();
  const publicSlug=body.requestedSlug || fallbackSlug(tournamentId);
  const slugOwner=await env.DB.prepare("SELECT id FROM tournaments WHERE public_slug = ?1 LIMIT 1")
    .bind(publicSlug).first();
  if(slugOwner) throw new HubContractError("slug_conflict","The requested public slug is already in use.",409);

  const createdAt=nowIso();
  try{
    await env.DB.prepare(`
      INSERT INTO tournaments (
        id, owner_id, local_key, public_slug, name, status,
        current_revision, created_at, updated_at
      ) VALUES (?1,?2,?3,?4,?5,'draft',0,?6,?6)
    `).bind(
      tournamentId,
      organizer.organizer_id,
      body.localKey,
      publicSlug,
      body.name,
      createdAt
    ).run();
  }catch(error){
    const conflict=await env.DB.prepare("SELECT id FROM tournaments WHERE public_slug = ?1 LIMIT 1")
      .bind(publicSlug).first();
    if(conflict) throw new HubContractError("slug_conflict","The requested public slug is already in use.",409);
    throw error;
  }

  return json({tournamentId,publicSlug,currentRevision:0,linked:false},201);
}

async function ownedTournament(env,tournamentId,organizerId){
  const tournament=await env.DB.prepare(`
    SELECT id, owner_id, local_key, public_slug, name, status,
           current_revision, current_object_key, current_checksum
      FROM tournaments
     WHERE id = ?1
     LIMIT 1
  `).bind(tournamentId).first();
  if(!tournament) throw new HubContractError("not_found","Hub tournament was not found.",404);
  if(tournament.owner_id!==organizerId) throw new HubContractError("forbidden","This organizer does not own the Hub tournament.",403);
  return tournament;
}

async function currentRevisionResponse(env,tournament,incomingChecksum,expectedRevision){
  const refreshed=await env.DB.prepare(`
    SELECT current_revision, current_checksum, current_object_key, public_slug
      FROM tournaments WHERE id = ?1 LIMIT 1
  `).bind(tournament.id).first();
  const decision=publicationDecision({
    currentRevision:refreshed.current_revision,
    currentChecksum:refreshed.current_checksum,
    expectedRevision,
    incomingChecksum
  });
  if(decision.kind==="idempotent"){
    return json({
      tournamentId:tournament.id,
      publicSlug:refreshed.public_slug,
      revision:decision.revision,
      checksum:incomingChecksum,
      idempotent:true
    },200);
  }
  throw new HubContractError("revision_conflict",`Hub is already at revision ${refreshed.current_revision}.`,409);
}

async function publishRevision(request,env,tournamentId){
  const organizer=await authenticateOrganizer(request,env);
  const tournament=await ownedTournament(env,tournamentId,organizer.organizer_id);
  const snapshot=await readJsonBody(request,MAX_SNAPSHOT_BYTES);
  validateSnapshot(snapshot);

  if(snapshot.tournament.localKey!==tournament.local_key){
    throw new HubContractError("snapshot_invalid","Snapshot local tournament key does not match the linked Hub tournament.",400);
  }
  if(snapshot.publication.hubTournamentId && snapshot.publication.hubTournamentId!==tournament.id){
    throw new HubContractError("snapshot_invalid","Snapshot Hub tournament ID does not match the target tournament.",400);
  }
  if(snapshot.publication.publicSlug && snapshot.publication.publicSlug!==tournament.public_slug){
    throw new HubContractError("snapshot_invalid","Snapshot public slug does not match the target tournament.",400);
  }

  const expectedRevision=snapshot.publication.previousRevision ?? 0;
  const proposedRevision=snapshot.publication.revision;
  if(proposedRevision!==expectedRevision+1){
    throw new HubContractError("snapshot_invalid","publication.revision must equal previousRevision + 1.",400);
  }

  const incomingChecksum=await snapshotStateChecksum(snapshot);
  const decision=publicationDecision({
    currentRevision:tournament.current_revision,
    currentChecksum:tournament.current_checksum,
    expectedRevision,
    incomingChecksum
  });

  if(decision.kind==="idempotent"){
    return json({
      tournamentId:tournament.id,
      publicSlug:tournament.public_slug,
      revision:decision.revision,
      checksum:incomingChecksum,
      idempotent:true
    },200);
  }
  if(decision.kind!=="accept"){
    throw new HubContractError("revision_conflict",`Hub is already at revision ${tournament.current_revision}.`,409);
  }

  const nextRevision=decision.nextRevision;
  const accepted=acceptedSnapshot(snapshot,{
    tournamentId:tournament.id,
    publicSlug:tournament.public_slug,
    revision:nextRevision,
    previousRevision:expectedRevision,
    checksum:incomingChecksum
  });
  const objectKey=buildRevisionObjectKey(tournament.id,nextRevision,incomingChecksum);
  const objectBody=JSON.stringify(canonicalize(accepted));

  const stored=await env.SNAPSHOTS.put(objectKey,objectBody,{
    onlyIf:{etagDoesNotMatch:"*"},
    httpMetadata:{contentType:"application/json; charset=utf-8",cacheControl:"public, max-age=31536000, immutable"},
    customMetadata:{
      tournamentId:tournament.id,
      revision:String(nextRevision),
      stateChecksum:incomingChecksum
    }
  });

  // A null conditional result means an identical revision/checksum object key already exists.
  // It is safe to continue to the D1 compare-and-commit stage.
  void stored;

  const acceptedAt=nowIso();
  let batchResult;
  try{
    batchResult=await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO publish_revisions (
          tournament_id, revision, object_key, state_checksum,
          client_version, client_generated_at, accepted_at
        )
        SELECT ?1,?2,?3,?4,?5,?6,?7
          FROM tournaments
         WHERE id = ?1 AND owner_id = ?8 AND current_revision = ?9
      `).bind(
        tournament.id,
        nextRevision,
        objectKey,
        incomingChecksum,
        snapshot.client.version,
        snapshot.publication.generatedAt,
        acceptedAt,
        organizer.organizer_id,
        expectedRevision
      ),
      env.DB.prepare(`
        UPDATE tournaments
           SET name = ?1,
               status = ?2,
               current_revision = ?3,
               current_object_key = ?4,
               current_checksum = ?5,
               updated_at = ?6,
               published_at = ?6
         WHERE id = ?7
           AND owner_id = ?8
           AND current_revision = ?9
      `).bind(
        snapshot.tournament.name,
        snapshot.tournament.status,
        nextRevision,
        objectKey,
        incomingChecksum,
        acceptedAt,
        tournament.id,
        organizer.organizer_id,
        expectedRevision
      )
    ]);
  }catch{
    return currentRevisionResponse(env,tournament,incomingChecksum,expectedRevision);
  }

  const insertChanges=batchResult?.[0]?.meta?.changes ?? 0;
  const updateChanges=batchResult?.[1]?.meta?.changes ?? 0;
  if(insertChanges!==1 || updateChanges!==1){
    return currentRevisionResponse(env,tournament,incomingChecksum,expectedRevision);
  }

  await env.DB.prepare(`
    INSERT INTO audit_events (
      tournament_id, organizer_id, event_type, revision,
      state_checksum, created_at, request_id
    ) VALUES (?1,?2,'publish_revision',?3,?4,?5,?6)
  `).bind(
    tournament.id,
    organizer.organizer_id,
    nextRevision,
    incomingChecksum,
    acceptedAt,
    requestId(request)
  ).run();

  return json({
    tournamentId:tournament.id,
    publicSlug:tournament.public_slug,
    revision:nextRevision,
    checksum:incomingChecksum,
    idempotent:false
  },201);
}

function etagValue(checksum){
  return `"${checksum}"`;
}

async function r2JsonResponse(request,env,row){
  const etag=etagValue(row.current_checksum || row.state_checksum);
  if(request.headers.get("if-none-match")===etag){
    return new Response(null,{status:304,headers:publicHeaders({etag})});
  }
  const object=await env.SNAPSHOTS.get(row.current_object_key || row.object_key);
  if(!object || !("body" in object)){
    throw new HubContractError("storage_error","Published revision metadata exists but its snapshot object is unavailable.",503);
  }
  return new Response(object.body,{
    status:200,
    headers:publicHeaders({
      "content-type":"application/json; charset=utf-8",
      etag
    })
  });
}

async function getPublicTournament(request,env,slug){
  const row=await env.DB.prepare(`
    SELECT id, public_slug, current_revision, current_object_key, current_checksum
      FROM tournaments
     WHERE public_slug = ?1 AND current_revision > 0
     LIMIT 1
  `).bind(slug).first();
  if(!row) throw new HubContractError("not_found","Published tournament was not found.",404);
  return r2JsonResponse(request,env,row);
}

async function getPublicRevision(request,env,slug,revision){
  const revisionNumber=Number(revision);
  if(!Number.isInteger(revisionNumber) || revisionNumber<1){
    throw new HubContractError("bad_request","Revision number is invalid.",400);
  }
  const row=await env.DB.prepare(`
    SELECT r.object_key, r.state_checksum
      FROM tournaments t
      JOIN publish_revisions r ON r.tournament_id = t.id
     WHERE t.public_slug = ?1
       AND t.current_revision > 0
       AND r.revision = ?2
       AND r.revision <= t.current_revision
     LIMIT 1
  `).bind(slug,revisionNumber).first();
  if(!row) throw new HubContractError("not_found","Published revision was not found.",404);
  return r2JsonResponse(request,env,row);
}

function routeParts(pathname){
  return pathname.split("/").filter(Boolean).map(part=>decodeURIComponent(part));
}

export default {
  async fetch(request,env){
    const id=requestId(request);
    try{
      const url=new URL(request.url);
      const parts=routeParts(url.pathname);

      if(request.method==="GET" && url.pathname==="/health"){
        return json({service:"Chess-Publisher Hub API",apiVersion:HUB_API_VERSION,status:"ok"},200,{"cache-control":"no-store"});
      }

      if(request.method==="POST" && url.pathname==="/v1/tournaments"){
        return await createTournament(request,env);
      }

      if(request.method==="PUT" && parts.length===4 && parts[0]==="v1" && parts[1]==="tournaments" && parts[3]==="revisions"){
        return await publishRevision(request,env,parts[2]);
      }

      if(request.method==="GET" && parts.length===4 && parts[0]==="v1" && parts[1]==="public" && parts[2]==="tournaments"){
        return await getPublicTournament(request,env,parts[3]);
      }

      if(request.method==="GET" && parts.length===6 && parts[0]==="v1" && parts[1]==="public" && parts[2]==="tournaments" && parts[4]==="revisions"){
        return await getPublicRevision(request,env,parts[3],parts[5]);
      }

      throw new HubContractError("not_found","API route was not found.",404);
    }catch(error){
      console.error("Hub API request failed",{requestId:id,error:error?.message||String(error)});
      return errorJson(error,id);
    }
  }
};
