const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const hub = fs.readFileSync(path.join(root, 'webview', 'HubAdapter.js'), 'utf8');
const cloud = fs.readFileSync(path.join(root, 'webview', 'CloudWorkspaceAdapter.js'), 'utf8');
function assert(condition, message) {
  if (!condition) {
    console.error('FAIL - ' + message);
    process.exit(1);
  }
  console.log('PASS - ' + message);
}
assert(/group-title">Organizer Token/.test(hub), 'Account block is labelled Organizer Token');
assert(/hubAccountBadge[^>]*>Token required/.test(hub), 'Initial account badge says Token required');
assert(/Token required for Web Sync/.test(hub), 'Initial connection state explains Web Sync token requirement');
assert(/Connect the Organizer Token to enable Save & Sync Web and Pull Changes/.test(hub), 'Helper text explains token purpose');
assert(!/Paste the Organizer Token once/.test(hub), 'Old pasted-token helper text removed');
assert(!/stored with Windows DPAPI/.test(hub), 'Visible DPAPI wording removed from HubAdapter');
assert(/secure Windows storage/.test(hub), 'Secure Windows storage wording is present');
assert(/Publish to Hub/.test(hub), 'Publish to Hub remains visible');
assert(/Public Tournament Hub/.test(hub), 'Public Tournament Hub section remains visible');
assert(/Save & Sync Web/.test(cloud), 'Private sync action remains Save & Sync Web');
assert(/Pull Changes/.test(cloud), 'Pull Changes remains visible');
assert(!/id="cloudContinueBrowserBtn"/.test(cloud), 'Continue in Browser button remains absent');
console.log('CLOUD-WORKSPACE-BETA11-ORGANIZER-TOKEN-UI-REGRESSION.js: PASS');
