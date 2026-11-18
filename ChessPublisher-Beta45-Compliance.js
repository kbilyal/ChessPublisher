/* Chess-Publisher v1.06.00-beta.45 — unusual over-the-board results.
   Additive continuation layer. Protected pairing/TRF/tie-break core is not modified. */
(function(){
'use strict';
const BETA='1.06.00-beta.45';
const TOKENS=new Set(['½-0','0-½','0-0']);
const compact=v=>String(v||'').replace(/\s+/g,'').replace('1/2','½');
const t=()=>{try{return getCurrentTournament();}catch(_){return null;}};
const boardNow=()=>{try{return getLivePairingBoards()?.[selectedLiveBoardIndex]||null;}catch(_){return null;}};
const roundNow=()=>{try{return Number(getSelectedPairingRoundNumber())||Number(getLatestGeneratedRound())||0;}catch(_){return 0;}};
const pkey=(p,i)=>{try{return playerKey(p,i);}catch(_){return String(p?._key||p?.fideId||p?.pairingNumber||i);}};
function setVersion(){document.documentElement.dataset.chesspublisherVersion=BETA;document.title=`Chess-Publisher v${BETA}`;const w=document.getElementById('windowDocumentTitle');if(w)w.textContent=`Chess-Publisher v${BETA} — Tournament Manager & Publisher`;}
function unusualPoints(token,side){token=compact(token);if(token==='½-0')return side==='w'?.5:0;if(token==='0-½')return side==='w'?0:.5;if(token==='0-0')return 0;return .5;}
let internal=false;
const originalApply=window.applyResultToSelectedBoard;
if(typeof originalApply==='function')window.applyResultToSelectedBoard=async function(result,advance=true){const b=boardNow();if(b&&!internal)delete b.cpUnusualResult;return originalApply.call(this,result,advance);};
async function setUnusual(token){token=compact(token);if(!TOKENS.has(token))return false;const b=boardNow();if(!b||!b.whiteKey||!b.blackKey){await appAlert('Select a board with two paired players.','Unusual OTB Result','warning');return false;}if(typeof ensureSelectedRoundEditable==='function'&&!ensureSelectedRoundEditable('enter this result'))return false;b.cpUnusualResult=token;b.cpUnusualAt=new Date().toISOString();internal=true;try{await originalApply.call(window,'½ - ½',false);}finally{internal=false;}b.result='½ - ½';b.cpUnusualResult=token;try{saveData();await Promise.resolve(writePersistentState(false));renderLivePairings(true);refreshFinalStandings();updateGacruxPanel();}catch(_){}setStatus(`Board ${b.board||selectedLiveBoardIndex+1}: ${token}.`);return true;}
const originalState=window.tournamentState;
if(typeof originalState==='function') window.tournamentState=function(){
  const state=originalState();
  const tt=t();
  if(!tt) return state;
  const byKey=new Map((state.rows||[]).map(r=>[String(r.key),r]));
  for(const [rs,boards] of Object.entries(tt.pairings?.liveBoards||{})){
    const r=Number(rs);
    for(const b of boards||[]){
      const token=compact(b?.cpUnusualResult);
      if(!TOKENS.has(token)||!b.whiteKey||!b.blackKey) continue;
      for(const [key,side] of [[b.whiteKey,'w'],[b.blackKey,'b']]){
        const row=byKey.get(String(key));
        if(!row) continue;
        const actual=unusualPoints(token,side);
        const rd=row.rounds?.[r-1];
        if(!rd) continue;
        const before=Number(typeof fidePointsFromRound==='function'?fidePointsFromRound(rd):.5)||0;
        rd.points=actual;
        rd.cpUnusualResult=token;
        rd.result='=';
        rd.played=true;
        rd.kind='played';
        row.score=Number(row.score||0)+(actual-before);
      }
    }
  }
  return state;
};
const originalEngineScore=window.pairingEngineScoreFromHistory;
if(typeof originalEngineScore==='function')window.pairingEngineScoreFromHistory=function(rounds,completed){let score=Number(originalEngineScore(rounds,completed))||0;for(let i=0;i<Math.min(Number(completed)||0,rounds?.length||0);i++){const rd=rounds?.[i];if(rd?.cpUnusualResult&&Number.isFinite(Number(rd.points)))score+=Number(rd.points)-.5;}return score;};
function paint(){const boards=getLivePairingBoards?.()||[];document.querySelectorAll('#livePairingsBody tr').forEach((tr,i)=>{const token=compact(boards[i]?.cpUnusualResult);if(!TOKENS.has(token))return;const el=tr.querySelector('.result-display');if(el){el.textContent=token;el.classList.remove('result-empty','result-forfeit','result-bye');el.classList.add('result-entered');}});const b=boardNow(),cur=document.getElementById('resultPaletteCurrent');const token=compact(b?.cpUnusualResult);if(cur&&TOKENS.has(token)){cur.textContent=token;cur.className='result-current-entered';}}
const originalRender=window.renderLivePairings;if(typeof originalRender==='function')window.renderLivePairings=function(...args){const x=originalRender.apply(this,args);setTimeout(paint,0);return x;};
const originalPalette=window.updateResultPaletteSelection;if(typeof originalPalette==='function')window.updateResultPaletteSelection=function(...args){const x=originalPalette.apply(this,args);paint();return x;};
const originalSwap=window.swapSelectedBoardColors;if(typeof originalSwap==='function')window.swapSelectedBoardColors=async function(...args){const before=compact(boardNow()?.cpUnusualResult);const ok=await originalSwap.apply(this,args);if(ok&&TOKENS.has(before)){const b=boardNow();b.cpUnusualResult=before==='½-0'?'0-½':before==='0-½'?'½-0':'0-0';saveData();try{await writePersistentState(false);}catch(_){}renderLivePairings(true);}return ok;};
function blankAatLine(delta,round,pairNo){return `299   ${Number(delta).toFixed(1)} ${Number(round)||0} ${Number(pairNo)||0}`;}
function unusualAdjustments(){const tt=t(),out=[];if(!tt)return out;const noByKey=new Map((tt.players||[]).map((p,i)=>[pkey(p,i),Number(p.pairingNumber||p.pairingNo)||0]));for(const [rs,boards] of Object.entries(tt.pairings?.liveBoards||{})){const round=Number(rs);for(const b of boards||[]){const token=compact(b?.cpUnusualResult);if(!TOKENS.has(token))continue;if((token==='0-½'||token==='0-0')&&b.whiteKey)out.push({round,pairNo:noByKey.get(b.whiteKey)||0,delta:-.5,token});if((token==='½-0'||token==='0-0')&&b.blackKey)out.push({round,pairNo:noByKey.get(b.blackKey)||0,delta:-.5,token});}}return out.filter(x=>x.pairNo>0);}
const originalBuildTRF26=window.buildTRF26;if(typeof originalBuildTRF26==='function')window.buildTRF26=function(...args){const result=originalBuildTRF26.apply(this,args);const range=args?.[0]||{},from=Math.max(1,Number(range.fromRound)||1),to=Math.max(from,Number(result?.toRound)||999);const rec=unusualAdjustments().filter(x=>x.round>=from&&x.round<=to).map(x=>blankAatLine(x.delta,x.round,x.pairNo));if(rec.length)result.text=String(result.text||'').replace(/\s*$/,'')+'\r\n'+rec.join('\r\n')+'\r\n';return result;};
function parseBlank299(text){const out=[];for(const line of String(text||'').replace(/\r/g,'').split('\n')){if(!/^299\s/.test(line))continue;const parts=line.trimEnd().split(/\s+/);if(parts[0]!=='299')continue;/* blank-AAT produced by this layer: 299 <delta> <round> <participant> */if(parts.length>=4&&!['W','D','L','F','H','Z','+','-'].includes(parts[1])){const delta=Number(parts[1]),round=Number(parts[2]),pairNo=Number(parts[3]);if(Number.isFinite(delta)&&round>=0&&pairNo>0)out.push({delta,round,pairNo});}}
 return out;
}
const originalParseTRF=window.parseTRF26Tournament;if(typeof originalParseTRF==='function')window.parseTRF26Tournament=function(text){const parsed=originalParseTRF(text);const a=parseBlank299(text).filter(x=>Math.abs(x.delta+.5)<1e-9);if(!a.length)return parsed;const byRound=new Map();for(const x of a){if(!byRound.has(x.round))byRound.set(x.round,[]);byRound.get(x.round).push(x.pairNo);}for(const [r,boards] of Object.entries(parsed.rounds||{})){const nums=byRound.get(Number(r))||[];if(!nums.length)continue;for(const b of boards||[]){const w=Number(b.whiteNo)||0,bl=Number(b.blackNo)||0;const hw=nums.includes(w),hb=nums.includes(bl);if(hw||hb){b.cpUnusualResult=hw&&hb?'0-0':hw?'0-½':'½-0';b.result='½ - ½';b.trfImportedResult='½ - ½';}}}return parsed;};
function installButtons(){if(document.getElementById('cpUnusualOtbGroup'))return;const grid=document.querySelector('.result-admin-grid');if(!grid)return;const wrap=document.createElement('div');wrap.id='cpUnusualOtbGroup';wrap.style.cssText='grid-column:1/-1;display:grid;grid-template-columns:repeat(3,1fr);gap:4px';for(const token of ['½-0','0-½','0-0']){const b=document.createElement('button');b.type='button';b.textContent=token;b.title='Unusual over-the-board result';b.onclick=()=>setUnusual(token);wrap.appendChild(b);}grid.appendChild(wrap);}
function install(){setVersion();installButtons();window.cpBeta45={version:BETA,setUnusual,unusualPoints,unusualAdjustments,blankAatLine,parseBlank299};}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
