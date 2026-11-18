const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('ChessPublisher.html','utf8');
let pass=0;
const ok=(cond,msg)=>{assert.ok(cond,msg);pass++;};
const has=(s,msg)=>ok(html.includes(s),msg);
const lacks=(s,msg)=>ok(!html.includes(s),msg);

// 1) Print must isolate the report from body-level runtime overlays/modals.
has('body > *:not(#screenPrintReport){display:none!important}','print isolates all body children except the report');
has('#screenPrintReport{display:block!important}','print report is explicitly visible');

// 2) Telegram is not exposed by any application UI and the legacy credential store is purged.
lacks('Telegram Publisher','Telegram Publisher group removed');
lacks('Telegram Publishing','Telegram Publishing group removed');
lacks('class="primary telegram-command"','Telegram action buttons removed');
lacks('id="telegramToken"','Telegram token input removed');
lacks('id="telegramChannel','Telegram channel selectors removed');
has('localStorage.removeItem(TELEGRAM_GLOBAL_KEY)','legacy Telegram token store is purged');
has('"sendTelegram","testTelegram"','legacy publishing entry points are hard-disabled');

// 3) Resort Starting List appears next to Generate Pairings in the result sidebar and not in the quickbar.
const actionBlock=html.match(/<div class="result-palette-wide pairing-generate-actions">([\s\S]*?)<\/div>/)?.[1]||'';
ok(actionBlock.includes('pairingsResortStartingListBtn') && actionBlock.includes('btnGenerateGacrux'),'Resort and Generate share one action block');
const quickbar=html.match(/<div class="pairing-quickbar">([\s\S]*?)<\/div>/)?.[1]||'';
ok(!quickbar.includes('pairingsResortStartingListBtn'),'Resort removed from Pairings quickbar');

// 4) Player-only export is XML everywhere it remains visible.
has('onclick="exportPlayersXML()"><span>Export Players XML...','Files menu exposes Export Players XML');
has('id="exportPlayersXmlBtn"','Registration exposes Export Players XML');
has('id="pairingsExportPlayersXmlBtn"','Pairings exposes Export Players XML');
has('function buildPlayersXML()','Players XML builder exists');
has('function exportPlayersXML()','Players XML download action exists');
has("'<Players>'",'Players XML root is emitted');
has('PlayerUniqueId:unique,PlayerSno:sno,Lastname:names.last,Firstname:names.first','XML uses the supplied PlayerUniqueId/PlayerSno/Lastname/Firstname profile');
has('pairingNumber:parseInt(attr(node,"PlayerSno","SNo"','XML import roundtrip recognizes PlayerSno');
lacks('Export TRF Starting List','old visible Starting TRF label removed');

// 5) Pairings no longer offers/embeds Tournament Schedule in print/export.
lacks('id="pairingsShowScheduleOnPrint"','Pairings schedule checkbox removed');
lacks('id="peIncludeSchedule"','Pairings export schedule checkbox removed');
lacks('if(options.includeSchedule)','Pairings export schedule rendering removed');
lacks('includeSchedule:true','Detailed preset no longer silently enables schedule');

// 6) Other / Export no longer contains the three requested tournament-transfer actions.
const exportPage=html.match(/<div id="exportPage" class="page">([\s\S]*?)<div id="screenPrintReport"/)?.[1]||html.match(/<div id="exportPage" class="page">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="statusbar">/)?.[1]||'';
ok(exportPage.length>0,'Other / Export section was located');
ok(!exportPage.includes('Export TRF Starting List'),'Other / Export has no TRF Starting List export');
ok(!exportPage.includes('Export Editable Tournament in TXT'),'Other / Export has no editable tournament TXT export');
ok(!exportPage.includes('Export Tournament in TXT'),'Other / Export has no full tournament TXT export');

// 7) Tournament Type is exactly Real/Test and legacy values normalize safely.
const typeSelect=html.match(/<select id="tournamentType">([\s\S]*?)<\/select>/)?.[1]||'';
const options=[...typeSelect.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(m=>[m[1],m[2]]);
assert.deepEqual(options,[['real','Real Tournament'],['test','Test Tournament']]); pass++;
has('t.settings.tournamentType=String(t.settings.tournamentType||"")==="test"?"test":"real";','legacy tournament types normalize to Real except explicit Test');
lacks('<option value="real-online">','Real Online option removed');
lacks('<option value="unknown">','Unknown option removed');
has('if(mode!=="real" && mode!=="test") throw new Error','Chess-Results identity gate permits only Real/Test');

console.log(`BETA97 REQUESTED UI CLEANUP: ${pass} PASS / 0 FAIL`);
