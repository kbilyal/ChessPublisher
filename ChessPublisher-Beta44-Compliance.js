/* Chess-Publisher v1.06.00-beta.44 — FIDE/TEC continuation layer.
   Additive only: protected pairing/TRF/tie-break engine files are not modified. */
(function(){
'use strict';
const BETA='1.06.00-beta.44';
const RR_TB=[
 'Direct Encounter (DE) [81]',
 'Greater number of games played with Black (BPG) [68]',
 'Greater number of games won with Black (BWG) [68]',
 'Rounds Elected to Play (REP) [79]',
 'Standard Points (STD)',
 'Sonneborn-Berger Tie-Break (2023) [85]',
 'Sonneborn-Berger Cut-1 (SB-C1) [85]',
 'Sonneborn-Berger Cut-2 (SB-C2) [85]',
 'Rating (RTNG)',
 'Reverse Rating (RTNG/R)',
 'Greater number of victories (WIN) [68]',
 'Tournament Pairing Number (TPN)',
 'Reverse Tournament Pairing Number (TPN/R)',
 'Koya System (KS) [87]',
 'Koya System (KS/L1)',
 'Koya System (KS/L2)',
 'Koya System (KS/L-1)',
 'Koya System (KS/L-2)'
];
function t(){try{return getCurrentTournament();}catch(_){return null;}}
function deep(v){return JSON.parse(JSON.stringify(v));}
function started(){try{return getLatestGeneratedRound()>0||!!t()?.pairings?.engine?.firstRoundRegistrationLocked;}catch(_){return false;}}
function roundNow(){try{return Number(getSelectedPairingRoundNumber())||Number(getLatestGeneratedRound())||0;}catch(_){return 0;}}
function persist(){try{saveData();}catch(_){} try{return Promise.resolve(writePersistentState(false));}catch(_){return Promise.resolve(false);}}
function pNo(player){return Number(player?.pairingNumber)||0;}
function keyForPlayer(player){const tt=t();const i=tt?.players?.indexOf(player)??-1;try{return playerKey(player,i);}catch(_){return '';} }
function playersByNo(){return new Map((t()?.players||[]).map(p=>[pNo(p),p]).filter(x=>x[0]>0));}
function setVersion(){
 document.documentElement.dataset.chesspublisherVersion=BETA;
 document.title=`Chess-Publisher v${BETA}`;
 const w=document.getElementById('windowDocumentTitle'); if(w)w.textContent=`Chess-Publisher v${BETA} — Tournament Manager & Publisher`;
}

// ---------- beta.37: prohibited pairings + Manual Pairing absolute criteria ----------
function ensureRestrictions(tt=t()){
 if(!tt)return [];
 if(!Array.isArray(tt.prohibitedPairings))tt.prohibitedPairings=[];
 tt.prohibitedPairings=tt.prohibitedPairings.map(x=>({a:Number(x.a)||0,b:Number(x.b)||0,rounds:Array.isArray(x.rounds)?x.rounds.map(Number).filter(n=>n>0):[]})).filter(x=>x.a>0&&x.b>0&&x.a!==x.b);
 return tt.prohibitedPairings;
}
function restrictionApplies(a,b,round){
 a=Number(a);b=Number(b);round=Number(round)||0;
 return ensureRestrictions().some(r=>((r.a===a&&r.b===b)||(r.a===b&&r.b===a))&&(!r.rounds.length||r.rounds.includes(round)));
}
function parseRoundSpec(text){
 text=String(text||'').trim(); if(!text||/^all$/i.test(text))return [];
 const out=[];for(const part of text.split(',')){const m=part.trim().match(/^(\d+)(?:-(\d+))?$/);if(!m)throw new Error(`Invalid round range: ${part}`);const a=+m[1],b=+(m[2]||m[1]);for(let n=Math.min(a,b);n<=Math.max(a,b);n++)out.push(n);}return [...new Set(out)].sort((a,b)=>a-b);
}
async function manageProhibitedPairings(){
 const tt=t();if(!tt)return;
 if(started()){await appAlert('Pairing restrictions are locked after Round 1 has been paired.','Prohibited Pairings','info');return;}
 const current=ensureRestrictions(tt).map(r=>`${r.a}-${r.b}${r.rounds.length?'@'+r.rounds.join(','):''}`).join('; ');
 const value=await appPrompt('Enter Pairing No. pairs separated by semicolons. Optional @rounds, e.g. 1-4; 2-7@3-5. Leave blank to clear.',current,'Prohibited Pairings');
 if(value===null)return;
 const parsed=[];for(const token of String(value).split(';').map(x=>x.trim()).filter(Boolean)){const [pair,spec='all']=token.split('@');const m=pair.match(/^(\d+)\s*-\s*(\d+)$/);if(!m){await appAlert(`Invalid pair: ${pair}`,'Prohibited Pairings','warning');return;}const a=+m[1],b=+m[2];if(a===b){await appAlert('A player cannot be prohibited from playing themselves.','Prohibited Pairings','warning');return;}try{parsed.push({a,b,rounds:parseRoundSpec(spec)});}catch(err){await appAlert(err.message,'Prohibited Pairings','warning');return;}}
 tt.prohibitedPairings=parsed;await persist();setStatus(`Prohibited pairings updated: ${parsed.length}.`);
}
function priorOpponent(key,other,round){
 const live=t()?.pairings?.liveBoards||{};for(const [r,boards] of Object.entries(live)){if(Number(r)>=Number(round)||!Array.isArray(boards))continue;for(const b of boards){if((b.whiteKey===key&&b.blackKey===other)||(b.whiteKey===other&&b.blackKey===key))return Number(r);}}return 0;
}
function colorsBefore(key,round){const out=[];const live=t()?.pairings?.liveBoards||{};for(let r=1;r<Number(round);r++){for(const b of live[String(r)]||[]){if(b.whiteKey===key&&b.blackKey)out.push('w');else if(b.blackKey===key&&b.whiteKey)out.push('b');}}return out;}
function colorViolation(key,color,round){const seq=[...colorsBefore(key,round),color];if(Number(round)>=Number(t()?.settings?.rounds||999))return false;const last=seq.slice(-3);if(last.length===3&&last.every(c=>c===color))return true;const w=seq.filter(c=>c==='w').length,b=seq.filter(c=>c==='b').length;return Math.abs(w-b)>2;}
async function manualCriteriaGate(candidate,round){
 const map=new Map((t()?.players||[]).map(p=>[keyForPlayer(p),p]));const violations=[];
 for(const b of candidate||[]){if(!b?.whiteKey||!b?.blackKey)continue;const wp=map.get(b.whiteKey),bp=map.get(b.blackKey);const a=pNo(wp),bb=pNo(bp);const old=priorOpponent(b.whiteKey,b.blackKey,round);if(old)violations.push(`repeat opponent (${a}-${bb}, previously Round ${old})`);if(restrictionApplies(a,bb,round))violations.push(`prohibited pairing (${a}-${bb})`);if(colorViolation(b.whiteKey,'w',round)||colorViolation(b.blackKey,'b',round))violations.push(`colour absolute criterion (${a}-${bb})`);}
 if(!violations.length)return true;
 const msg=`Manual Pairing creates: ${[...new Set(violations)].join('; ')}.`;
 if(typeof cpFideWarning==='function'&&typeof cpFideModeActive==='function'&&cpFideModeActive())return cpFideWarning(3,msg,{title:'FIDE Mode — Manual Pairing',category:'PIBE'});
 await appAlert(msg,'Manual Pairing','warning');return true;
}
const originalUpdateLive=window.updateLivePairingBoard;
if(typeof originalUpdateLive==='function')window.updateLivePairingBoard=async function(index,field,value){
 if(!window.manualPairingMode && typeof manualPairingMode!=='undefined' && !manualPairingMode)return originalUpdateLive(index,field,value);
 const boards=getLivePairingBoards();const snapshot=deep(boards);const candidate=deep(boards);if(candidate[index])candidate[index][field]=field==='board'?(parseInt(value)||index+1):String(value||'');
 const ok=await manualCriteriaGate(candidate,roundNow());if(!ok){renderLivePairings(true);return;}return originalUpdateLive(index,field,value);
};
const originalRequestPairs=window.requestLocalGacruxPairs;
if(typeof originalRequestPairs==='function')window.requestLocalGacruxPairs=async function(next,initialColor){const result=await originalRequestPairs(next,initialColor);const map=new Map((t()?.players||[]).map(p=>[keyForPlayer(p),p]));const bad=(result||[]).find(b=>b.whiteKey&&b.blackKey&&restrictionApplies(pNo(map.get(b.whiteKey)),pNo(map.get(b.blackKey)),next));if(bad){const w=pNo(map.get(bad.whiteKey)),bl=pNo(map.get(bad.blackKey));if(typeof cpRecordPibe==='function')cpRecordPibe('Prohibited Pairing Conflict',`Generated Round ${next} contains prohibited pairing ${w}-${bl}.`,{level:5,round:next});throw new Error(`Generated pairing conflicts with prohibited pairing ${w}-${bl}.`);}return result;};

// ---------- beta.38: revalidate every paired round after PAB change ----------
const originalEditPab=window.editPabPoints;
if(typeof originalEditPab==='function')window.editPabPoints=async function(){const tt=t();if(!tt)return originalEditPab();const before=deep(tt),old=String(tt.regulations?.pabPoints??'1');await originalEditPab();const cur=t();const now=String(cur?.regulations?.pabPoints??'1');if(old===now||!started())return;const bad=[];try{for(const r of getExistingPairingRounds()){const boards=cur?.pairings?.liveBoards?.[String(r)];if(!Array.isArray(boards)||!boards.length)continue;const v=await cpVerifyPairingIntegrityForRound(r,boards,{source:'PAB historical revalidation'});if(!v.ok)bad.push(v);} }catch(err){if(typeof cpFideModeActive==='function'&&cpFideModeActive()){data.tournaments[data.currentTournament]=before;normalizeData();saveData();await appAlert(`PAB change rolled back because historical pairing verification could not be completed.\n\n${err?.message||err}`,'FIDE Mode — PAB','error');return;} }
 if(bad.length){const details=bad.map(v=>`Round ${v.round}`).join(', ');let proceed=true;if(typeof cpFideModeActive==='function'&&cpFideModeActive())proceed=await cpFideWarning(3,`The new PAB value makes historical pairing(s) inconsistent: ${details}.`,{title:'FIDE Mode — PAB Historical Pairing Integrity',category:'PIBE'});if(!proceed){data.tournaments[data.currentTournament]=before;normalizeData();saveData();renderLivePairings(true);refreshFinalStandings();return;}for(const v of bad)if(typeof cpRecordPibe==='function')cpRecordPibe('PAB Historical Pairing Violation',`PAB value ${old} → ${now} makes Round ${v.round} differ from the verifier pairing.`,{level:3,round:v.round});await persist();}
};

// ---------- beta.39: FIDE Baku Acceleration ----------
function acceleration(tt=t()){if(!tt)return 'NONE';tt.settings=tt.settings||{};const v=String(tt.settings.accelerationMethod||'NONE').toUpperCase();tt.settings.accelerationMethod=v==='BAKU'?'BAKU':'NONE';return tt.settings.accelerationMethod;}
function bakuLocked(){return started();}
function bakuPlayersRound1(){const tt=t();return (tt?.players||[]).filter(p=>{try{return isPlayerEligibleForRound(p,1)&&!isPlayerExcludedForRound(keyForPlayer(p),1)&&!isPlayerSyncedAbsent(keyForPlayer(p));}catch(_){return true;}}).slice().sort((a,b)=>pNo(a)-pNo(b));}
function bakuGroup(){const tt=t();if(!tt)return [];tt.pairings=tt.pairings||{};tt.pairings.engine=tt.pairings.engine||{};let keys=tt.pairings.engine.bakuGroupKeys;if(!Array.isArray(keys)||!keys.length){const rows=bakuPlayersRound1();const n=rows.length;const size=2*Math.ceil(n/4);keys=rows.slice(0,size).map(keyForPlayer);tt.pairings.engine.bakuGroupKeys=keys;}return keys;}
function bakuVirtual(round){const total=Math.max(1,Number(t()?.settings?.rounds)||1),acc=Math.ceil(total/2),first=Math.ceil(acc/2);if(round<=first)return 1;if(round<=acc)return .5;return 0;}
function trf250(round,points,firstNo,lastNo){let line=' '.repeat(31);if(typeof trf26SetField==='function'){line=trf26SetField(line,1,3,'250');line=trf26SetField(line,10,4,Number(points).toFixed(1),true);line=trf26SetField(line,15,3,round,true);line=trf26SetField(line,19,3,round,true);line=trf26SetField(line,23,4,firstNo,true);line=trf26SetField(line,28,4,lastNo,true);return line.trimEnd();}return `250      ${Number(points).toFixed(1).padStart(4)} ${String(round).padStart(3)} ${String(round).padStart(3)} ${String(firstNo).padStart(4)} ${String(lastNo).padStart(4)}`;}
function addBakuRecords(text){if(acceleration()!=='BAKU')return text;const group=bakuGroup();if(!group.length)return text;const nums=group.map(k=>pNo(resolveRegisteredPlayer(k))).filter(n=>n>0);if(!nums.length)return text;const first=Math.min(...nums),last=Math.max(...nums),total=Math.max(1,Number(t()?.settings?.rounds)||1),accRounds=Math.ceil(total/2),records=[];for(let r=1;r<=accRounds;r++)records.push(trf250(r,bakuVirtual(r),first,last));let out=String(text).replace(/^192[ \t]+FIDE_DUTCH_(?:2017|2025)[ \t]*$/m,m=>m.replace(/[ \t]+$/,'')+'_BAKU');const lines=out.replace(/\r/g,'').split('\n');const at=lines.findIndex(x=>/^192\s/.test(x));lines.splice(at>=0?at+1:lines.length,0,...records);return lines.filter((x,i,a)=>!(i===a.length-1&&x==='')).join('\r\n')+'\r\n';}
const origPairingTRF=window.buildPairingEngineTRF;if(typeof origPairingTRF==='function')window.buildPairingEngineTRF=function(color){return addBakuRecords(origPairingTRF(color));};
const origTrfType=window.trf26PairingTypeCode;if(typeof origTrfType==='function')window.trf26PairingTypeCode=function(){const base=origTrfType();return acceleration()==='BAKU'&&/^FIDE_DUTCH_/.test(base)&&!/_BAKU$/.test(base)?base+'_BAKU':base;};
function installAccelerationUI(){const ps=document.getElementById('pairingSystem');if(!ps||document.getElementById('cpAccelerationMethod'))return;const label=document.createElement('label');label.id='cpAccelerationLabel';label.textContent='Acceleration';const sel=document.createElement('select');sel.id='cpAccelerationMethod';sel.innerHTML='<option value="NONE">None</option><option value="BAKU">Baku</option>';sel.value=acceleration();sel.disabled=bakuLocked();sel.onchange=async()=>{const tt=t();if(!tt)return;if(bakuLocked()){sel.value=acceleration();await appAlert('Acceleration is locked after Round 1 has been paired.','Acceleration','info');return;}tt.settings.accelerationMethod=sel.value;tt.pairings.engine.bakuGroupKeys=[];await persist();};ps.insertAdjacentElement('afterend',sel);ps.insertAdjacentElement('afterend',label);}

// ---------- beta.40: Round Robin public-draw TPN ----------
async function enterRoundRobinTpnDraw(){const tt=t();if(!tt||!isRoundRobinTournament(tt)){await appAlert('TPN Draw is available for Round Robin tournaments.','TPN Draw','info');return;}if(started()){await appAlert('TPN Draw is locked after the Berger schedule has been generated.','TPN Draw','info');return;}const active=(typeof getActiveRegistrationPlayers==='function'?getActiveRegistrationPlayers(tt):(tt.players||[]));const n=active.length;if(n<2)return;const current=active.map(p=>pNo(p)||'').join(',');const raw=await appPrompt(`Enter ${n} TPN values in player-list order (1-${n}), separated by commas.`,current,'Round Robin TPN Draw');if(raw===null)return;const vals=String(raw).split(/[;,\s]+/).filter(Boolean).map(Number);if(vals.length!==n||vals.some(x=>!Number.isInteger(x)||x<1||x>n)||new Set(vals).size!==n){await appAlert(`Enter each TPN from 1 to ${n} exactly once.`,'TPN Draw','warning');return;}const snapshot=deep(tt);try{active.forEach((p,i)=>p.pairingNumber=vals[i]);tt.pairings=tt.pairings||{};tt.pairings.engine=tt.pairings.engine||{};tt.pairings.engine.firstRoundRegistrationSyncedSignature=typeof getFirstRoundRegistrationSignature==='function'?getFirstRoundRegistrationSignature(tt):'';saveData();if(typeof writePersistentState==='function'&&!await writePersistentState(false,true))throw new Error('The TPN draw could not be saved.');renderRegistered();setStatus('Round Robin TPN draw saved.');}catch(err){data.tournaments[data.currentTournament]=snapshot;normalizeData();saveData();await appAlert(err?.message||String(err),'TPN Draw','error');}}
function installTpnButton(){if(document.getElementById('cpRrTpnDrawBtn'))return;const anchor=document.getElementById('resortStartingListBtn')||document.getElementById('pairingsResortStartingListBtn');if(!anchor)return;const b=document.createElement('button');b.id='cpRrTpnDrawBtn';b.type='button';b.textContent='Enter TPN Draw';b.onclick=enterRoundRobinTpnDraw;anchor.insertAdjacentElement('afterend',b);}

// ---------- beta.41: RR withdrawal <50% rule ----------
let rrStandingsAdjust=false;const originalTournamentState=window.tournamentState;
function rrExcludedFromStandings(state){const tt=t();if(!tt||!isRoundRobinTournament(tt))return new Set();const excluded=new Set();const live=tt.pairings?.liveBoards||{};for(const p of tt.players||[]){if(!p.registrationDeleted&&!p.expelled&&String(p.tournamentStatus||'').toLowerCase()!=='expelled')continue;const key=keyForPlayer(p);let scheduled=0,played=0;for(const boards of Object.values(live)){for(const b of boards||[]){if((b.whiteKey===key||b.blackKey===key)&&b.whiteKey&&b.blackKey){scheduled++;if(b.result&&b.result!=='-'&&!isForfeitResult(b.result))played++;}}}if(scheduled>0&&played/scheduled<.5)excluded.add(key);}return excluded;}
if(typeof originalTournamentState==='function')window.tournamentState=function(){const state=originalTournamentState();if(!rrStandingsAdjust)return state;const ex=rrExcludedFromStandings(state);if(!ex.size)return state;const excludedIds=new Set();for(const row of state.rows||[]){const source=row.sourcePlayer||{};const k=keyForPlayer(source);if(ex.has(k))excludedIds.add(Number(row.id));}const rows=(state.rows||[]).filter(r=>!excludedIds.has(Number(r.id))).map(r=>{const x=deep(r);x.rounds=(x.rounds||[]).map(g=>g&&excludedIds.has(Number(g.opp))?null:g);return x;});return {...state,rows};};
const originalCalcStandings=window.calculateFinalStandings;if(typeof originalCalcStandings==='function')window.calculateFinalStandings=function(){rrStandingsAdjust=true;try{return originalCalcStandings();}finally{rrStandingsAdjust=false;}};

// ---------- beta.42: mandatory Round Robin tie-break catalogue ----------
function rrState(){const state=originalTournamentState?originalTournamentState():tournamentState();return {state,byId:new Map((state.rows||[]).map(x=>[Number(x.id),x]))};}
function rrSbContrib(player){const {byId}=rrState();const vals=[];for(const g of player?.rounds||[]){if(!g||!g.played||!g.opp)continue;const opp=byId.get(Number(g.opp));if(!opp)continue;vals.push((Number(fidePointsFromRound(g))||0)*(Number(opp.score)||0));}return vals;}
function rrKoya(player,delta){const {byId}=rrState();const max=Number(getCurrentTournament()?.settings?.rounds)||1;const threshold=(max/2)+delta;let score=0;for(const g of player?.rounds||[]){if(!g||!g.played||!g.opp)continue;const opp=byId.get(Number(g.opp));if(opp&&Number(opp.score)>=threshold)score+=Number(fidePointsFromRound(g))||0;}return score;}
const originalStandingValue=window.standingTieBreakValue;if(typeof originalStandingValue==='function')window.standingTieBreakValue=function(player,tie){const s=String(tie||'');if(!isRoundRobinTournament(t()))return originalStandingValue(player,tie);if(s==='Standard Points (STD)')return Number(player.score)||0;if(s==='Rating (RTNG)')return Number(player.rating)||0;if(s==='Reverse Rating (RTNG/R)')return -(Number(player.rating)||0);if(s==='Tournament Pairing Number (TPN)')return -(Number(player.id)||0);if(s==='Reverse Tournament Pairing Number (TPN/R)')return Number(player.id)||0;if(s.includes('Sonneborn-Berger Cut-2')){const a=rrSbContrib(player).sort((x,y)=>x-y);return a.slice(Math.min(2,a.length)).reduce((x,y)=>x+y,0);}if(s.includes('Koya System (KS/L1)'))return rrKoya(player,.5);if(s.includes('Koya System (KS/L2)'))return rrKoya(player,1);if(s.includes('Koya System (KS/L-1)'))return rrKoya(player,-.5);if(s.includes('Koya System (KS/L-2)'))return rrKoya(player,-1);return originalStandingValue(player,tie);};
const originalPopulateTB=window.populateTieBreakMenus;if(typeof originalPopulateTB==='function')window.populateTieBreakMenus=function(){originalPopulateTB();if(!isRoundRobinTournament(t()))return;for(const id of ['tieBreakAddSelect','standingsTieBreakSelect']){const sel=document.getElementById(id);if(!sel)continue;const have=new Set([...sel.options].map(o=>o.value));for(const name of RR_TB){if(have.has(name))continue;const o=document.createElement('option');o.value=name;o.textContent=name;sel.appendChild(o);}}};

// ---------- beta.43: mid-event Tie-Break changes ----------
function tieList(){try{return [...getTournamentTieBreakPriority(t())];}catch(_){return [];}}
async function tbGate(action,before){if(!started())return true;if(typeof cpFideWarning==='function'&&typeof cpFideModeActive==='function'&&cpFideModeActive())return cpFideWarning(4,`${action} while the tournament is in progress. Previous tie-break list: ${before.join(' > ')||'None'}.`,{title:'FIDE Mode — Tie-Break Change',category:'PIBE',secondMessage:'Confirm only if this change is intentional. It will be recorded in the TRF.'});return appConfirm(`${action} while the tournament is in progress?`,'Tie-Break Change','warning');}
function logTbChange(before){const after=tieList();if(JSON.stringify(before)===JSON.stringify(after))return;if(typeof cpRecordPibe==='function')cpRecordPibe('Tie-Break List Change',`Round ${roundNow()||0}: previous list [${before.join(' > ')||'None'}]; new list [${after.join(' > ')||'None'}].`,{level:4,round:roundNow()});persist();}
for(const fn of ['addTieBreakCriterion','moveTieBreakCriterion','removeTieBreakCriterion']){const original=window[fn];if(typeof original!=='function')continue;window[fn]=async function(...args){const before=tieList();let ok=false;try{ok=await tbGate(fn==='addTieBreakCriterion'?'Add tie-break':fn==='removeTieBreakCriterion'?'Remove tie-break':'Change tie-break priority',before);}catch(_){ok=false;}if(!ok)return;const r=original.apply(this,args);await Promise.resolve(r);logTbChange(before);return r;};}
const origSaveTbSettings=window.saveTieBreakSettingsModal;if(typeof origSaveTbSettings==='function')window.saveTieBreakSettingsModal=async function(...args){const before=tieList(),settingsBefore=deep(t()?.regulations?.tieBreakOptions||{});if(started()){let ok=false;try{ok=await tbGate('Change tie-break settings',before);}catch(_){ok=false;}if(!ok)return;}const r=await origSaveTbSettings.apply(this,args);if(started()&&JSON.stringify(settingsBefore)!==JSON.stringify(t()?.regulations?.tieBreakOptions||{})){if(typeof cpRecordPibe==='function')cpRecordPibe('Tie-Break Settings Change',`Round ${roundNow()||0}: tie-break parameter settings were changed.`,{level:4,round:roundNow()});await persist();}return r;};

// ---------- beta.44: Adjourned Games ----------
function isAdj(board){return !!board?.adjourned && (!board.result||board.result==='-');}
function selectedBoard(){try{return getLivePairingBoards()?.[selectedLiveBoardIndex]||null;}catch(_){return null;}}
function adjText(){return getLanguage()==='bg'?'Отложена':'Adjourned';}
async function markSelectedAdjourned(){const b=selectedBoard();if(!b||!isRealPairingBoard(b)){await appAlert('Select a board with two paired players.','Adjourned','warning');return;}if(b.result&&b.result!=='-'){await appAlert('Clear the final result before marking the game as Adjourned.','Adjourned','warning');return;}b.result='-';b.adjourned=true;b.adjournedAt=new Date().toISOString();b.adjournedRound=roundNow();if(typeof cpRecordPibe==='function')cpRecordPibe('Game Adjournment',`Round ${roundNow()} Board ${b.board||selectedLiveBoardIndex+1} registered as Adjourned.`,{level:2,round:roundNow()});await persist();try{renderLivePairings(true);refreshFinalStandings();updateGacruxPanel();}catch(_){}setStatus(`Round ${roundNow()} Board ${b.board||selectedLiveBoardIndex+1}: Adjourned.`);}
async function resolveAdjourned(board,result,advance){const r=String(result||'-');if(r==='-'||!r){board.result='-';board.adjourned=true;await persist();renderLivePairings(true);return;}if(isByeResult(r)){await appAlert('An adjourned game must be resolved as a game result, not a bye.','Adjourned','warning');return;}const nonDraw=r!=='½ - ½';if(nonDraw&&typeof cpFideModeActive==='function'&&cpFideModeActive()){let ok=false;try{ok=await cpFideWarning(3,`The final result of an adjourned game in Round ${roundNow()} is ${r}, not a draw.`,{title:'FIDE Mode — Adjourned Game Result',category:'PIBE'});}catch(_){ok=false;}if(!ok)return;}board.adjourned=false;board.adjournedResolvedAt=new Date().toISOString();board.result=r;if(nonDraw&&typeof cpRecordPibe==='function')cpRecordPibe('Adjourned Game Result',`Round ${roundNow()} Board ${board.board||selectedLiveBoardIndex+1}: adjourned game resolved ${r}.`,{level:3,round:roundNow()});saveData();try{recalculateRoundHistoryState();}catch(_){}await persist();try{renderLivePairings(true);refreshFinalStandings();updateGacruxPanel();}catch(_){}if(advance){const boards=getLivePairingBoards();const next=typeof findNextRealPairingBoardIndex==='function'?findNextRealPairingBoardIndex(boards,selectedLiveBoardIndex,true):-1;if(next>=0){selectedLiveBoardIndex=next;selectLivePairingBoard(next);}}}
const originalApplyResult=window.applyResultToSelectedBoard;if(typeof originalApplyResult==='function')window.applyResultToSelectedBoard=async function(result,advance=true){const b=selectedBoard();if(b&&isAdj(b))return resolveAdjourned(b,result,advance);return originalApplyResult(result,advance);};
function paintAdjourned(){const boards=getLivePairingBoards?.()||[];document.querySelectorAll('#livePairingsBody tr').forEach((tr,i)=>{const b=boards[i];if(!isAdj(b))return;const el=tr.querySelector('.result-display');if(el){el.textContent=adjText();el.classList.remove('result-empty','result-entered','result-forfeit','result-bye');el.classList.add('result-empty');el.setAttribute('aria-label',adjText());}});const b=selectedBoard(),cur=document.getElementById('resultPaletteCurrent');if(cur&&isAdj(b)){cur.textContent=adjText();cur.className='result-current-empty';}}
const originalRender=window.renderLivePairings;if(typeof originalRender==='function')window.renderLivePairings=function(...args){const r=originalRender.apply(this,args);setTimeout(paintAdjourned,0);return r;};
const originalPalette=window.updateResultPaletteSelection;if(typeof originalPalette==='function')window.updateResultPaletteSelection=function(...args){const r=originalPalette.apply(this,args);paintAdjourned();return r;};
function installAdjButton(){if(document.getElementById('cpAdjournedResultBtn'))return;const grid=document.querySelector('.result-admin-grid');if(!grid)return;const b=document.createElement('button');b.id='cpAdjournedResultBtn';b.type='button';b.textContent='Adjourned';b.onclick=markSelectedAdjourned;grid.appendChild(b);}
function unknownTRFChar(c){c=String(c||'').trim().toUpperCase();return !!c&&!['1','0','=','+','-','U','P','W','L','D','F','H','X','Z','A'].includes(c);}
function sanitizeITDX(text){const lines=String(text||'').replace(/\r/g,'').split('\n'),unknown=[];const out=lines.map(line=>{if(!line.startsWith('001'))return line;let a=line.split('');const no=parseInt(trfLineField(line,5,4))||0;const slots=Math.max(0,Math.ceil(Math.max(0,line.length-91)/10));for(let r=1;r<=slots;r++){const idx=98+(r-1)*10,c=a[idx]||'';if(c==='?'||unknownTRFChar(c)){unknown.push({no,round:r});a[idx]='=';}}return a.join('');});return {text:out.join('\n'),unknown};}
const originalParseTRF=window.parseTRF26Tournament;if(typeof originalParseTRF==='function')window.parseTRF26Tournament=function(text){const s=sanitizeITDX(text);const parsed=originalParseTRF(s.text);if(!s.unknown.length)return parsed;const set=new Set(s.unknown.map(x=>`${x.no}:${x.round}`));for(const [r,boards] of Object.entries(parsed.rounds||{})){for(const b of boards||[]){if(set.has(`${b.whiteNo}:${r}`)||set.has(`${b.blackNo}:${r}`)){b.result='-';b.trfImportedResult='-';b.adjourned=true;b.itdxUnknown=true;}}}return parsed;};
function adjournedEntries(){const out=[];for(const [r,boards] of Object.entries(t()?.pairings?.liveBoards||{})){for(const b of boards||[]){if(isAdj(b))out.push({round:Number(r),board:b});}}return out;}
function setFixed(line,start,len,value,right=false){if(typeof trf26SetField==='function')return trf26SetField(line,start,len,value,right);let s=String(line).padEnd(start-1+len,' ').split(''),v=String(value??'');v=(right?v.padStart(len,' '):v.padEnd(len,' ')).slice(0,len);for(let i=0;i<len;i++)s[start-1+i]=v[i];return s.join('');}
function buildITDX(){const entries=adjournedEntries();if(!entries.length)throw new Error('There are no unresolved adjourned games.');const latest=Math.max(...getExistingPairingRounds());const tt=t(),actualState=originalTournamentState?originalTournamentState():tournamentState();const scoreById=new Map((actualState.rows||[]).map(x=>[Number(x.id),Number(x.score)||0]));const changed=[];try{for(const x of entries){changed.push([x.board,x.board.result]);x.board.result='½ - ½';}const tempState=originalTournamentState?originalTournamentState():tournamentState();const selected=buildTRF26SelectedState(tempState,1,latest);const announced=Math.max(latest,parseInt(tt.settings?.rounds)||latest);const schedule=validateTRF26SelectedSchedule(tt,1,latest,announced);const check={errors:[],warnings:[],state:tempState,selectedState:selected,announced,fromRound:1,toRound:latest,roundDates:schedule?.dates||[],encodedTC:trf26EncodedTimeControl(tt.settings?.timeControl),useCurrentRank:true};let result=window.buildTRF26({fromRound:1,toRound:latest},check);let lines=String(result.text).replace(/\r/g,'').split('\n');const pairNoByKey=new Map((tt.players||[]).map(p=>[keyForPlayer(p),pNo(p)]));lines=lines.map(line=>{if(!line.startsWith('001'))return line;const no=parseInt(trfLineField(line,5,4))||0;line=setFixed(line,81,4,(scoreById.get(no)||0).toFixed(1),true);for(const x of entries){const w=pairNoByKey.get(x.board.whiteKey)||0,b=pairNoByKey.get(x.board.blackKey)||0;if(no===w||no===b)line=setFixed(line,99+(x.round-1)*10,1,'?');}return line;});return {...result,text:lines.filter((x,i,a)=>!(i===a.length-1&&x==='')).join('\r\n')+'\r\n'};}finally{for(const [b,r] of changed)b.result=r;}}
async function exportITDX(){try{const result=buildITDX();const fileName=`${safeFileName(data.currentTournament)}_ITDX_TRF26_R1-R${result.toRound}.TXT`;if(typeof window.cpSaveTextToTournamentTRF==='function'){const saved=await window.cpSaveTextToTournamentTRF(fileName,result.text);setStatus(`ITDX TRF26 exported: ${saved?.browserDownload?'browser Downloads':(saved?.path||'TRF folder')}.`);}else{const blob=new Blob([result.text],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=fileName;a.click();URL.revokeObjectURL(url);}}catch(err){await appAlert(err?.message||String(err),'ITDX TRF26','error');}}
function installITDXButton(){if(document.getElementById('cpITDXExportBtn'))return;const fide=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='FIDE Rating TRF26');if(!fide)return;const b=document.createElement('button');b.id='cpITDXExportBtn';b.type='button';b.textContent='ITDX TRF26';b.title='TRF26 exchange file; unresolved adjourned games are marked ?';b.onclick=exportITDX;fide.insertAdjacentElement('afterend',b);}
function unresolvedAdjourned(){return adjournedEntries().length;}
const originalCheckCompletion=window.checkTournamentCompletionPrompt;if(typeof originalCheckCompletion==='function')window.checkTournamentCompletionPrompt=async function(...args){if(unresolvedAdjourned()){setStatus('Tournament has unresolved adjourned games.');return false;}return originalCheckCompletion.apply(this,args);};

function installMiscUI(){
 installAccelerationUI();installTpnButton();installAdjButton();installITDXButton();
 if(!document.getElementById('cpProhibitedPairingsBtn')){const a=document.getElementById('manualPairingToggleBtn');if(a){const b=document.createElement('button');b.id='cpProhibitedPairingsBtn';b.type='button';b.textContent='Prohibited Pairings';b.onclick=manageProhibitedPairings;a.insertAdjacentElement('afterend',b);}}
 // Shorten user-facing engineering text where the beta.36 base still contains it.
 const help=document.getElementById('tieBreakFormatHelp');if(help&&help.textContent.length>220)help.textContent=isRoundRobinTournament(t())?'Round Robin · FIDE tie-break criteria.':'Swiss · FIDE tie-break criteria.';
}
function install(){setVersion();installMiscUI();try{populateTieBreakMenus();}catch(_){}try{renderLivePairings(true);}catch(_){}window.cpBeta44={version:BETA,RR_TB,manageProhibitedPairings,enterRoundRobinTpnDraw,bakuVirtual,bakuGroup,addBakuRecords,markSelectedAdjourned,buildITDX,exportITDX,sanitizeITDX,unresolvedAdjourned,restrictionApplies};}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
