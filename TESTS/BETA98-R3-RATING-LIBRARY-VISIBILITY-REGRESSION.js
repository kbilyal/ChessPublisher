'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'ChessPublisher.html'),'utf8');
const js=fs.readFileSync(path.join(ROOT,'ChessPublisher-Beta98-Custom-Rating-Lists.js'),'utf8');
let pass=0,fail=0,n=0;function ok(name,v){n++;if(v){pass++;console.log(`PASS ${String(n).padStart(2,'0')} ${name}`);}else{fail++;console.error(`FAIL ${String(n).padStart(2,'0')} ${name}`);}}
ok('static Rating List Library group exists in Lists & Players',html.includes('id="cpRatingListLibraryHome"')&&html.includes('<div class="group-title">Rating List Library</div>'));
ok('visible Import Rating List button exists statically',html.includes('id="cpRatingListImportButton"')&&html.includes('Import Rating List…'));
ok('visible Manage Rating Lists button exists statically',html.includes('id="cpRatingListManageButton"')&&html.includes('Manage Rating Lists'));
ok('library status badge exists statically',html.includes('id="cpRatingListLibraryStatus"'));
ok('static help explicitly says import does not register participants',html.includes('they do not register tournament participants'));
ok('normal Add Player search statically names imported rating lists',html.includes('placeholder="Search player (FIDE + imported rating lists)..."'));
ok('Custom UI no longer depends on integratedRatingListsPanel',!js.match(/function installCustomUi\(\)[\s\S]{0,300}integratedRatingListsPanel/));
ok('runtime fallback can recreate library home if static markup is missing',js.includes('function ensureRatingListLibraryHome()'));
ok('Import Rating List opens dedicated modal',js.includes('function customImportModal()')&&js.includes('Import Rating List'));
ok('import modal states it does not add participants',js.includes('It will not add participants to the current tournament.'));
ok('successful import closes modal and refreshes library status',js.includes('cpCustomImportModal')&&js.includes('refreshCustomUi();'));
ok('API exposes openImportDialog for static button',js.includes('openCustomManager,openImportDialog,installSearchIntegration'));
console.log(`BETA98-R3 RATING LIBRARY VISIBILITY RESULT: ${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
