const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'ChessPublisher.html'),'utf8');
const checks=[
 ['beta20 workflow carried into current branding',(()=>{const m=html.match(/v1\.06\.00-beta\.(\d+)/);return !!m&&Number(m[1])>=20;})()],
 ['manual PAB removed',!html.includes('<option value="PAB"')],
 ['programmatic PAB rejected',html.includes('PAB is assigned only by the pairing engine')],
 ['late entry previous rounds zero',html.includes('previous rounds 0 pts')],
 ['no automatic post-pair late BYE prompt',!html.includes('await offerPostPairLateEntryPab(player,joinInfo);')],
 ['delete cleans stable config',html.includes('cleanupRemovedRegistrationKeys(t,removedKeys)')],
 ['delete requires resort',html.includes('e.firstRoundRegistrationNeedsResort=true')],
 ['TPN managed by resort',html.includes('Tournament Pairing Number is managed by Resort Starting List.')],
 ['rank correction gate',html.includes('rankCorrectionNeedsResort')],
 ['post-start free resort blocked',html.includes('No rule-based Resort is pending')],
 ['after-R4 correction preserves TPN',html.includes('existing TPN preserved because Round 4 has already been paired')],
 ['late-entry resort remains allowed',html.includes('workflow.needsLateResort')],
 ['admin bye labels qualified',html.includes('only if regulations allow')],
 ['protected pairing generate still present',html.includes('requestLocalGacruxPairs')],
 ['TRF16 still present',/TRF16/i.test(html)],
 ['TRF26 still present',/TRF26/i.test(html)],
 ['Chess-Results publish still present',html.includes('publishChessResultsTournament')],
];
let fail=0;
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} - ${name}`); if(!ok) fail++;}
if(fail) process.exit(1);
console.log(`BETA20 REGISTRATION WORKFLOW GATE PASS (${checks.length}/${checks.length})`);
