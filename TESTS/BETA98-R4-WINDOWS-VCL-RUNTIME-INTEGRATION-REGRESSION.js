'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'ChessPublisher.html'),'utf8');
const local=fs.readFileSync(path.join(ROOT,'ChessPublisher-LocalEngine.ps1'),'utf8');
const manual=fs.readFileSync(path.join(ROOT,'USER-MANUAL-EN.html'),'utf8');
const mods=[
'ChessPublisher-Beta44-Compliance.js','ChessPublisher-Beta45-Compliance.js','ChessPublisher-Beta46-Compliance.js','ChessPublisher-Beta47-Documentation.js','ChessPublisher-Beta48-Compliance.js','ChessPublisher-Beta49-Compliance.js','ChessPublisher-Beta50-Compliance.js','ChessPublisher-Beta51-Compliance.js','ChessPublisher-Beta52-Compliance.js','ChessPublisher-Beta53-Compliance.js','ChessPublisher-Beta54-Compliance.js','ChessPublisher-Beta55-Compliance.js','ChessPublisher-Beta56-Compliance.js','ChessPublisher-Beta57-Compliance.js','ChessPublisher-Beta58-Compliance.js','ChessPublisher-Beta59-Compliance.js','ChessPublisher-Beta60-Compliance.js','ChessPublisher-Beta61-Compliance.js','ChessPublisher-Beta62-Compliance.js','ChessPublisher-Beta63-Compliance.js','ChessPublisher-Beta64-Compliance.js','ChessPublisher-Beta65-Compliance.js','ChessPublisher-Beta66-Compliance.js','ChessPublisher-Beta67-Compliance.js','ChessPublisher-Beta68-Compliance.js','ChessPublisher-Beta69-Compliance.js','ChessPublisher-Beta70-Compliance.js','ChessPublisher-Beta72-RatingLists.js','ChessPublisher-Beta73-Compliance.js','ChessPublisher-Beta81-TypeB-RatingLists.js','ChessPublisher-Beta89-Compliance.js','ChessPublisher-Beta98-Custom-Rating-Lists.js'];
let pass=0,fail=0,n=0;function ok(name,v){n++;if(v){pass++;console.log(`PASS ${String(n).padStart(2,'0')} ${name}`);}else{fail++;console.error(`FAIL ${String(n).padStart(2,'0')} ${name}`);}}
function extract(name){const esc=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const re=new RegExp(`<!-- CP-WINDOWS-INLINE-BUNDLE: ${esc} -->\\s*<script data-cp-bundled-source="${esc}">\\n([\\s\\S]*?)\\n<\\/script>\\s*<!-- \/CP-WINDOWS-INLINE-BUNDLE: ${esc} -->`);return html.match(re)?.[1]??null;}
function sha(s){return crypto.createHash('sha256').update(s).digest('hex');}

ok('candidate marker is beta.98-r4 or later revision',/data-chesspublisher-version="1[.]06[.]00-beta[.]98-r(?:[4-9]|[1-9][0-9]+)"/.test(html)&&/<title>Chess-Publisher v1[.]06[.]00-beta[.]98-r(?:[4-9]|[1-9][0-9]+)<\/title>/.test(html));
ok('protected Windows LocalEngine remains HTML-only for UI navigation',local.includes("($path -eq '/') -or ($path -eq '/ChessPublisher.html')")&&local.includes("Send-HtmlResponse $context"));
ok('LocalEngine has no generic JavaScript static-file route',!local.match(/\.js['\"]?\)\s*\{|ContentType\s*=\s*['\"](?:application|text)\/javascript/i));
ok('all 32 FIDE/TEC continuation modules have inline bundle markers',mods.every(f=>html.includes(`CP-WINDOWS-INLINE-BUNDLE: ${f}`)));
ok('no external ChessPublisher-Beta script src remains',!/<script[^>]+src="ChessPublisher-Beta/i.test(html));
let exact=true,syntax=true,ordered=true,last=-1;
for(const f of mods){const src=fs.readFileSync(path.join(ROOT,f),'utf8').replace(/\n$/,'');const bundled=extract(f);if(bundled===null||sha(bundled)!==sha(src))exact=false;try{new vm.Script(bundled??'',{filename:f});}catch(e){syntax=false;console.error('SYNTAX',f,e.message);}const at=html.indexOf(`CP-WINDOWS-INLINE-BUNDLE: ${f}`);if(at<=last)ordered=false;last=at;}
ok('inline bundle content is byte-equivalent to each source module (final newline ignored)',exact);
ok('every bundled module parses as JavaScript',syntax);
ok('bundled modules retain original chronological order',ordered);
ok('runtime guard checks all 32 module APIs',mods.length===32&&mods.every((f,i)=>html.includes(['cpBeta44','cpBeta45','cpBeta46','cpBeta47','cpBeta48','cpBeta49','cpBeta50','cpBeta51','cpBeta52','cpBeta53','cpBeta54','cpBeta55','cpBeta56','cpBeta57','cpBeta58','cpBeta59','cpBeta60','cpBeta61','cpBeta62','cpBeta63','cpBeta64','cpBeta65','cpBeta66','cpBeta67','cpBeta68','cpBeta69','cpBeta70','cpBeta72RatingLists','cpBeta73','cpBeta81','cpBeta89','cpBeta98'][i])));
ok('runtime guard restores current r4/r5 version/title after historical installers',/document\.title='Chess-Publisher v1\.06\.00-beta\.98-r[45]'/.test(html)&&/t\.textContent='Chess-Publisher v1\.06\.00-beta\.98-r[45] — Tournament Manager & Publisher'/.test(html));

// Direct user-visible access and runtime-independent Rating List UI.
ok('Rating List Library is static in Lists & Players',html.includes('id="cpRatingListLibraryHome"')&&html.includes('id="cpRatingListImportButton"')&&html.includes('id="cpRatingListManageButton"'));
ok('Import Rating List handler calls the live Q117 API and has visible failure feedback',html.includes('window.cpBeta98?.openImportDialog')&&html.includes('Rating List Library runtime is not loaded'));
const q117=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta98-Custom-Rating-Lists.js'),'utf8');
ok('Import dialog becomes visible before library restore and triggers native file chooser in user gesture',q117.includes("function openImportDialog(options={}){const m=customImportModal();m.style.display='flex'")&&q117.includes("file.click()"));
ok('file selection auto-fills list label when blank',q117.includes("cpCustomFile')?.addEventListener('change'")&&q117.includes("replace(/\\.[^.]+$/,''"));
ok('Add Player search explicitly includes imported rating lists',html.includes('placeholder="Search player (FIDE + imported rating lists)..."'));

// Manual must work under HTML-only LocalEngine.
const b47=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta47-Documentation.js'),'utf8');
ok('Manual button targets current desktop header',b47.includes("document.querySelector('.desktop-status-controls')"));
ok('Manual no longer navigates to an unserved relative HTML route',!b47.includes("window.open('USER-MANUAL-EN.html'")&&!b47.includes("location.href='USER-MANUAL-EN.html'"));
ok('manual is embedded and opens in-app, with F1 access',b47.includes('MANUAL_B64=')&&b47.includes('cpUserManualModal')&&b47.includes("e.key==='F1'"));
ok('manual itself is version-matched and documents Custom/Type-B Rating List workflow',/v1\.06\.00-beta\.98-r[45]/.test(manual)&&manual.includes('Rating List Library — Custom and Type-B lists')&&manual.includes('Do not use Import Players for a federation rating list.'));

// Tab-by-tab VCL UI restoration markers.
ok('Tournament Setup VCL controls are bundled: Baku acceleration',html.includes('cpAccelerationMethod'));
ok('Tournament Setup VCL controls are bundled: Rating List Sequence editor/check',html.includes('ratingListSequenceControl')&&html.includes('ratingListSequenceManage')&&html.includes('ratingListSequenceCheck'));
ok('Tournament Setup VCL controls are bundled: long-event rating history/policy',html.includes('cpBeta70LongEventBox')&&html.includes('cpBeta73RatingPolicyBox'));
ok('Lists & Players VCL controls are bundled: integrated/Type-B/Custom lists',html.includes('integratedRatingListsPanel')&&html.includes('cpTypeBPanel')&&html.includes('cpRatingListLibraryHome'));
ok('Lists & Players VCL controls are bundled: TPN exchange and half-point-bye eligibility',html.includes('cpTpnExchangeBtn')&&html.includes('editPlayerHpbEligible'));
ok('Lists & Players VCL controls are bundled: selected consistency updates',html.includes('cpBeta89SubsetBox')&&html.includes('cpBeta89SelectAll'));
ok('Pairings VCL controls are bundled: Adjourned and unusual OTB results',html.includes('cpAdjournedResultBtn')&&html.includes('cpUnusualOtbGroup'));
ok('Pairings VCL controls are bundled: prohibited pairings and previous-round correction',html.includes('cpProhibitedPairingsBtn')&&html.includes('cpBeta68PreviousRoundCorrectionBtn'));
ok('Other / Export VCL controls are bundled: ITDX and post-event rating corrections',html.includes('cpITDXExportBtn')&&html.includes('cpRatingReportCorrectionsBtn'));
ok('Standings VCL controls are bundled: tied-final-place resolution panel',html.includes('cpBeta69TiePanel')&&html.includes('cpBeta69TieMode'));
ok('core Tournament Schedule remains present',html.includes('id="schedule"')||html.includes('Tournament Schedule'));
ok('core Chess-Results tab remains present',html.includes('Chess-Results'));
ok('core DGT tab remains present',html.includes('DGT Boards'));
ok('current HTML provides Pairings anchors required by VCL modules',html.includes('result-admin-grid')&&html.includes('id="manualPairingToggleBtn"')&&html.includes('id="resortStartingListBtn"'));
ok('current HTML provides Tournament Setup anchors required by Rating Sequence/long-event modules',html.includes('pairing-essentials-box')&&html.includes('id="tournamentRatingType"'));
ok('current HTML provides Lists/Edit Player anchors required by rating provenance/HPB modules',html.includes('id="registeredFideUpdateResult"')&&html.includes('id="editPlayerRatingSources"')&&html.includes('class="form-grid"'));
ok('current HTML provides Standings/Tie-Break anchors required by final-place/rating-policy modules',html.includes('id="finalStandingsBody"')&&html.includes('id="tieBreakSettingsBody"'));
ok('current HTML provides Other/Export TRF anchor required by ITDX/corrections modules',html.includes('FIDE Rating TRF26'));

const localHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'ChessPublisher-LocalEngine.ps1'))).digest('hex');
ok('protected LocalEngine hash remains beta96-r4 exact or beta98-r13 Gacrux 1.11.65 candidate',localHash==='71113c2763ebfd438eab3dd3d4c1d8f11f630c59d67224c2d97e4568c8db3550'||localHash==='4236ee37b72f4ed7ccb7f760d5d62a63ec1386b217ee08400f18c39ca534b788'||localHash==='cebe72b54d2bd41eb331f5e892a17b48429684538ad54139a90e89e8f000639e');
console.log(`BETA98-R4 WINDOWS VCL RUNTIME INTEGRATION RESULT: ${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
