const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const htmlPath=path.join(root,'ChessPublisher.html');
const html=fs.readFileSync(htmlPath,'utf8');

function assert(cond,msg){
  if(!cond){console.error('FAIL:',msg);process.exitCode=1;throw new Error(msg);}
  console.log('PASS:',msg);
}
function functionNames(src){
  return new Set([...src.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]));
}
function extractFunction(src,name){
  const re=new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m=re.exec(src); if(!m) return '';
  const start=m.index;
  const brace=src.indexOf('{',m.index+m[0].length);
  if(brace<0) return '';
  let depth=0, quote='', escaped=false, lineComment=false, blockComment=false;
  for(let i=brace;i<src.length;i++){
    const c=src[i], n=src[i+1]||'';
    if(lineComment){if(c==='\n')lineComment=false;continue;}
    if(blockComment){if(c==='*'&&n==='/'){blockComment=false;i++;}continue;}
    if(quote){
      if(escaped){escaped=false;continue;}
      if(c==='\\'){escaped=true;continue;}
      if(c===quote){quote='';continue;}
      // Template literals are safe enough for this function; nested ${} braces
      // remain counted below only when not inside a quoted segment.
      continue;
    }
    if(c==='/'&&n==='/'){lineComment=true;i++;continue;}
    if(c==='/'&&n==='*'){blockComment=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==='{')depth++;
    if(c==='}'){
      depth--;
      if(depth===0)return src.slice(start,i+1);
    }
  }
  return '';
}

const names=functionNames(html);
const sharedRuntimeHelpers=[
  'getLanguage','getExportLanguage','withExportLanguage','T','ET',
  'getFederationFlag','formatDateTime','translateScheduleEvent',
  'meaningfulScheduleRows','cpSchedulePublicDescription',
  'buildGeneralText','buildPlayersText','buildScheduleText','buildRegulationsText',
  'splitTelegramText','sendTelegram','publishPlayersTelegram'
];
for(const name of sharedRuntimeHelpers) assert(names.has(name),`shared runtime helper restored: ${name}`);

const fileOpen=extractFunction(html,'fileOpenTournament');
assert(fileOpen.includes('loadAndNormalizeSnapshotObject(snapshot)'), 'Open Tournament uses validated normalize path');
assert(fileOpen.includes('refreshEverything()'), 'Open Tournament refreshes UI after snapshot load');
const refresh=extractFunction(html,'refreshEverything');
assert(refresh.includes('renderRegistered'), 'refreshEverything renders registered players');
const render=extractFunction(html,'renderRegistered');
assert(!!render,'renderRegistered function is present');
assert(render.includes('getLanguage()'), 'registered-player render uses language helper and therefore guards against its accidental removal');

let players=[
  {name:'Alice Test',rating:2100,fed:'BUL',fideId:'1234567',gender:'f',birth:'1995',attendance:'present',joinedFromRound:1,pairingNumber:1,originalIndex:0},
  {name:'Bob Test',rating:2050,fed:'TUR',fideId:'2345678',gender:'m',birth:'1990',attendance:'present',joinedFromRound:1,pairingNumber:2,originalIndex:1},
  {name:'Carol Test',rating:1800,fed:'GRE',fideId:'3456789',gender:'f',birth:'2000',attendance:'present',joinedFromRound:1,pairingNumber:3,originalIndex:2}
];
const fixture=process.env.CP_TOURNAMENT_FIXTURE;
if(fixture){
  const snap=JSON.parse(fs.readFileSync(fixture,'utf8'));
  const current=snap?.data?.currentTournament;
  const tournament=snap?.data?.tournaments?.[current] || Object.values(snap?.data?.tournaments||{})[0];
  if(tournament?.players?.length){
    players=tournament.players.map((p,i)=>({...p,originalIndex:i}));
    console.log(`INFO: external tournament fixture loaded with ${players.length} players`);
  }
}

// Focused runtime harness: execute the REAL renderRegistered() source against
// an in-memory DOM stub.  This is intentionally small so that a missing shared
// helper (the beta.21 regression) throws exactly where the Registration table
// would otherwise remain empty.
const body={innerHTML:'',children:[],appendChild(node){this.children.push(node);}};
const rowFactory=()=>({
  classList:{add(){}},innerHTML:'',onclick:null,ondblclick:null
});
const selectedPlayerIndexes=new Set();
const context={
  document:{
    getElementById(id){
      if(id==='registeredBody') return body;
      if(id==='selectedCount') return {textContent:''};
      if(id==='setLateEntryBtn') return {disabled:false,textContent:'',title:''};
      if(id==='deleteSelectedPlayersBtn') return {disabled:false,title:''};
      if(id==='startingRankResortState') return {textContent:'',className:'',title:''};
      if(id==='resortStartingListBtn') return {disabled:false,title:'',style:{}};
      return null;
    },
    createElement(tag){if(tag==='tr')return rowFactory();return {};}
  },
  Number, String, Math, Set,
  selectedPlayerIndexes,
  ensurePairingNumbers(){},
  getCurrentTournament(){return {players};},
  getVisibleRegisteredPlayers(){return players;},
  getPlayerAttendance(p){return p.attendance==='absent'?'absent':'present';},
  getLanguage(){return 'en';},
  escapeAttribute(v){return String(v??'');},
  escapeHtml(v){return String(v??'');},
  getPlayerJoinRound(p){return Math.max(1,Number(p.joinedFromRound)||1);},
  fideProfileLinkHtml(v){return String(v??'');},
  normalizePlayerGender(v){return String(v||'').toLowerCase();},
  selectPlayerRow(){},openEditPlayerModal(){},
  updateSelectedCount(){},updatePlayerDeletionAvailability(){},updateRegistrationWorkflowUI(){}
};
vm.createContext(context);
vm.runInContext(render,context,{filename:'renderRegistered-from-ChessPublisher.html'});
vm.runInContext('renderRegistered()',context);
assert(body.children.length===players.length,`Registration render preserves all loaded players (${body.children.length}/${players.length})`);
assert(players.length>0,'fixture contains registered players');

// This is the structural gate that would have failed beta.21: all functions
// present in the known-good beta.20 base must remain available after beta.21 UX
// additions.  The baseline file is optional in distribution; when present in
// the development environment it becomes a stronger regression check.
const baseline=process.env.CP_BASELINE_HTML;
if(baseline && fs.existsSync(baseline)){
  const baseNames=functionNames(fs.readFileSync(baseline,'utf8'));
  const missing=[...baseNames].filter(n=>!names.has(n));
  assert(missing.length===0,`no beta.20 function declarations lost (${missing.length} missing)`);
}

console.log('BETA22 TOURNAMENT LOAD + PLAYERS REGRESSION: PASS');
