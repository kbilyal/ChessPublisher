(async()=>{
 const results=[]; const fail=[];
 const check=(cond,name,detail={})=>{const row={name,ok:!!cond,...detail};results.push(row);if(!cond)fail.push(row);};
 function baseTournament(n=8,name='TRF29'){
   const t=createEmptyTournament();
   t.settings.rounds='3';t.settings.lastSwissRounds='3';t.settings.tournamentFormat='Individual Swiss';t.settings.pairingSystem='FIDE Dutch System';
   t.settings.initialRankSorting='automatic';t.settings.initialRatingSource='fide';
   t.settings.fideRated='No';t.settings.tournamentRatingType='Rapid';t.settings.country='BUL';t.settings.city='Sofia';t.settings.chiefArbiter='Chief Arbiter';t.settings.timeControl='10+5';t.settings.startDate='2026-09-05T09:00';t.settings.endDate='2026-09-05T18:00';t.settings.tournamentType='real';
   t.players=Array.from({length:n},(_,i)=>({localKey:`k${i+1}`,name:i===0?'Zulu':i===1?'Alpha':`Player ${i+1}`,rating:i<2?2200:2190-i*10,title:i===0?'':i===1?'IM':'',fed:'BUL',fideId:String(2911000+i),birth:'1990',gender:i%2?'f':'m',attendance:'present',joinedFromRound:1}));
   data={currentTournament:name,tournaments:{[name]:t},preferences:{defaultRating:'rapid',sortMode:'rating',activeTab:'main'}};normalizeData();
   return getCurrentTournament();
 }
 function syncStrictDom(t){
   setVal('city',t.settings.city);setVal('country',t.settings.country);setVal('startDate',t.settings.startDate);setVal('endDate',t.settings.endDate);setVal('rounds',t.settings.rounds);setVal('chiefArbiter',t.settings.chiefArbiter);setVal('timeControl',t.settings.timeControl);setVal('fideRated',t.settings.fideRated);setVal('tournamentRatingType',t.settings.tournamentRatingType);setVal('tournamentType',t.settings.tournamentType);
 }
 function addSchedule(t){t.schedule.rows=[{event:'Round 1',dateTime:'2026-09-05T10:00'},{event:'Round 2',dateTime:'2026-09-05T12:00'},{event:'Round 3',dateTime:'2026-09-05T14:00'}];}
 function generateCompletedR1(t){assignFideInitialPairingNumbers(t);const b=generateLocalSwissFallback(1);b.forEach((x,i)=>{if(x.whiteKey&&x.blackKey)x.result=i%3===0?'1-0':i%3===1?'½-½':'0-1';});t.pairings.liveBoards['1']=b;t.pairings.round='1';t.pairings.engine.lastGeneratedRound=1;}

 // A. Fresh roster, no persisted TPN: Starting List must build, without mutating real players.
 let t=baseTournament();
 const before=t.players.map(p=>p.pairingNumber??null);
 const c0=window.__cpTrfStartingList.validate();
 check(c0.errors.length===0,'Fresh Round-0 Starting List validates without prior Resort',{errors:c0.errors});
 check(c0.derivedNumbers===true,'Fresh Round-0 Starting List uses export-only derived numbering');
 check(c0.players.map(x=>x.no).join(',')==='1,2,3,4,5,6,7,8','Derived Starting Rank is consecutive 1..N',{numbers:c0.players.map(x=>x.no)});
 check(t.players.every(p=>p.pairingNumber==null),'Starting List validation does not mutate real tournament TPN',{before,after:t.players.map(p=>p.pairingNumber??null)});
 const b0=window.__cpTrfStartingList.build(c0);
 check((b0.text.match(/^001/gm)||[]).length===8,'Starting List build emits one 001 per player');
 check(/182 Chess-Publisher Version 1\.06\.00-beta\.29/.test(b0.text),'Starting List record 182 reports beta.29');
 check(t.players.every(p=>p.pairingNumber==null),'Starting List build remains non-mutating');
 // verify tie-break ordering: same rating, IM Alpha must outrank untitled Zulu
 const first001=b0.text.split(/\r?\n/).find(x=>x.startsWith('001'))||'';
 check(first001.includes('Alpha'),'Derived export numbering uses FIDE rating→title→alphabetical order',{first001});

 // B. Pending pre-R1 resort with stale but complete numbers must derive current order, still non-mutating.
 t.players.forEach((p,i)=>p.pairingNumber=i+1); t.players[0].rating=2600; t.pairings.engine.firstRoundRegistrationNeedsResort=true;
 const stale=t.players.map(p=>p.pairingNumber);
 const cPending=window.__cpTrfStartingList.validate();
 check(cPending.errors.length===0 && cPending.derivedNumbers===true,'Pending pre-R1 Resort derives export numbering even when stored TPN is complete');
 check(t.players.map(p=>p.pairingNumber).join(',')===stale.join(','),'Pending Resort export does not rewrite stored TPN');

 // C. Once history exists, invalid TPN must fail closed (no export-only renumbering).
 t=baseTournament();generateCompletedR1(t);t.players[1].pairingNumber=t.players[0].pairingNumber;
 const cHist=window.__cpTrfStartingList.validate();
 check(cHist.errors.some(x=>/Existing pairing history prevents export-only renumbering/.test(x)),'Started tournament with invalid TPN fails closed');
 check(cHist.derivedNumbers===false,'Started tournament never derives replacement TPN');

 // D. All TRF profiles on a valid completed R1.
 t=baseTournament();syncStrictDom(t);addSchedule(t);generateCompletedR1(t);
 const c16=window.__cpTrfCompliance.validate(16,1,{strict:true,syncUi:false});
 check(c16.errors.length===0,'FIDE Rating TRF16 strict validation passes synthetic valid R1',{errors:c16.errors});
 const trf16=window.__cpTrfCompliance.build(16,1,{strict:true,prevalidated:c16});
 check((trf16.text.match(/^001/gm)||[]).length===8,'TRF16 build has all players');
 check(/182 Chess-Publisher Version 1\.06\.00-beta\.29, Gacrux engine/.test(trf16.text),'TRF16 record 182 reports beta.29');
 const c26=window.__cpTrfCompliance.validate(26,1,{strict:true,syncUi:false});
 check(c26.errors.length===0,'FIDE Rating TRF26 strict validation passes synthetic valid R1',{errors:c26.errors});
 const trf26=window.__cpTrfCompliance.build(26,1,{strict:true,prevalidated:c26});
 const strict26=window.__cpTrfCompliance.strictExchangeCheck(trf26.text,{throughRound:1,requireRoundDates:true});
 check(strict26.ok,'TRF26 strict exchange checker passes generated R1',{errors:strict26.errors,warnings:strict26.warnings});
 check(/182 Chess-Publisher Version 1\.06\.00-beta\.29/.test(trf26.text),'TRF26 record 182 reports beta.29');

 // E. Export handlers save expected artifacts through the common bridge.
 let saves=[]; window.cpCheckpointPersistenceForExport=async()=>true; window.cpSaveTextToTournamentTRF=async(fileName,text)=>{saves.push({fileName,bytes:text.length});return {ok:true,path:'MOCK/'+fileName};}; window.appAlert=async()=>true; window.appConfirm=async()=>true;
 // Round-0 Starting + Editable
 t=baseTournament();
 await window.exportTRFStartingList();
 const editable=await window.exportSwissManagerEditableTournament();
 check(!!editable?.ok,'Editable Tournament TRF26 exports on fresh roster without Resort',{editable});
 // Round-1 Full
 t=baseTournament();generateCompletedR1(t);
 const full=await window.exportSwissManagerFullTournament();
 check(!!full?.ok,'Full Tournament TRF26 exports completed generated history',{full});
 check(saves.some(x=>/_TRF26_Starting_List\.TXT$/.test(x.fileName)),'Starting List export reached shared save bridge',{saves});
 check(saves.some(x=>/_Editable_Tournament_TRF26\.TXT$/.test(x.fileName)),'Editable Tournament export reached shared save bridge',{saves});
 check(saves.some(x=>/_Full_Tournament_TRF26_R1-R1\.TXT$/.test(x.fileName)),'Full Tournament export reached shared save bridge',{saves});

 return {total:results.length,passed:results.filter(x=>x.ok).length,failed:fail.length,results};
})()
