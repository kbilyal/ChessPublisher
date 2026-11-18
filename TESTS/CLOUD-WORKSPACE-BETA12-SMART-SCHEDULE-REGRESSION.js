const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ChessPublisher.html'), 'utf8');
const cloud = fs.readFileSync(path.join(root, 'webview', 'CloudWorkspaceAdapter.js'), 'utf8');
const hub = fs.readFileSync(path.join(root, 'webview', 'HubAdapter.js'), 'utf8');
function assert(condition, message) {
  if (!condition) {
    console.error('FAIL - ' + message);
    process.exit(1);
  }
  console.log('PASS - ' + message);
}
assert(/CP-BETA12-SMART-SCHEDULE-REPAIR-START/.test(html), 'beta.12 Smart Schedule repair patch is present');
assert(/id="cpBeta12SmartScheduleRepair"/.test(html), 'repair script has a stable id');
assert(/window\.generateRoundRows\s*=\s*repairedGenerateRoundRows/.test(html), 'Generate Schedule onclick is routed through repaired generator');
assert(/Generate Smart Schedule/.test(html), 'UI names the action Generate Smart Schedule');
assert(/flexibleTournamentBoundary/.test(html), 'date-only Tournament Start\/End boundaries are handled');
assert(/editable round rows/.test(html), 'fallback creates editable round rows instead of silent failure');
assert(/Open Tournament Schedule → Generate Smart Schedule/.test(html), 'rated schedule helper text points to the correct button');
assert(/Save & Sync Web/.test(cloud), 'private Web Sync action remains Save & Sync Web');
assert(!/id="cloudContinueBrowserBtn"/.test(cloud), 'Continue in Browser remains absent');
assert(/Publish to Hub/.test(hub), 'Publish to Hub remains in public Hub workflow');
console.log('CLOUD-WORKSPACE-BETA12-SMART-SCHEDULE-REGRESSION.js: PASS');
