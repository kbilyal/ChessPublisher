'use strict';
const cp = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const htmlPath = path.join(ROOT, 'ChessPublisher.html');
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browserExe = fs.existsSync(edgePath) ? edgePath : chromePath;
console.log(`Using Windows Browser Runtime: ${browserExe}`);

async function getWsUrl(port) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const data = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/json/list`, res => {
          let b = '';
          res.on('data', c => b += c);
          res.on('end', () => resolve(JSON.parse(b)));
        }).on('error', reject);
      });
      if (Array.isArray(data)) {
        const page = data.find(p => p.type === 'page');
        if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {}
  }
  throw new Error('Failed to connect to browser page CDP on port ' + port);
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.pending = new Map();
    this.events = new Map();
    this.ws.onmessage = msg => {
      const d = JSON.parse(msg.data);
      if (d.id && this.pending.has(d.id)) {
        const { resolve, reject } = this.pending.get(d.id);
        this.pending.delete(d.id);
        if (d.error) reject(new Error(d.error.message));
        else resolve(d.result);
      } else if (d.method) {
        const handlers = this.events.get(d.method) || [];
        for (const h of handlers) h(d.params);
      }
    };
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, handler) {
    if (!this.events.has(event)) this.events.set(event, []);
    this.events.get(event).push(handler);
  }
}

async function run() {
  const port = 9222;
  const proc = cp.spawn(browserExe, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  const pageErrors = [];
  const consoleErrors = [];

  try {
    const wsUrl = await getWsUrl(port);
    console.log(`Connected to CDP: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.onopen = r);

    const client = new CdpClient(ws);
    await client.send('Page.enable');
    await client.send('Runtime.enable');

    client.on('Runtime.exceptionThrown', p => {
      const desc = p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'Unknown runtime error';
      pageErrors.push(desc);
      console.error('PAGE ERROR:', desc);
    });

    client.on('Runtime.consoleAPICalled', p => {
      if (p.type === 'error') {
        const msg = p.args?.map(a => a.value || a.description || '').join(' ');
        consoleErrors.push(msg);
      }
    });

    // Navigate directly to fileUrl
    const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
    console.log(`Navigating to ${fileUrl}...`);
    await client.send('Page.navigate', { url: fileUrl });

    // Wait for page load
    await new Promise(r => setTimeout(r, 1500));

    // Run test scenario
    const testCode = `
      (async function() {
        const out = {};
        
        out.version = document.documentElement.getAttribute('data-chesspublisher-version');
        out.title = document.title;
        
        // Modules check
        const mods = ['cpBeta44','cpBeta45','cpBeta46','cpBeta47','cpBeta48','cpBeta49','cpBeta50','cpBeta51',
                      'cpBeta52','cpBeta53','cpBeta54','cpBeta55','cpBeta56','cpBeta57','cpBeta58','cpBeta59',
                      'cpBeta60','cpBeta61','cpBeta62','cpBeta63','cpBeta64','cpBeta65','cpBeta66','cpBeta67',
                      'cpBeta68','cpBeta69','cpBeta70','cpBeta72RatingLists','cpBeta73','cpBeta81','cpBeta89','cpBeta98',
                      'cpBeta98R6','cpBeta98R7','cpBeta98R12'];
        out.missingModules = mods.filter(m => typeof window[m] === 'undefined');
        
        // Late Entry Bar display check
        const bar = document.getElementById('cpR11LateEntryBar');
        out.barDisplay = bar ? getComputedStyle(bar).display : 'none';
        
        // Tournament creation
        const t = createEmptyTournament();
        t.settings.name = 'R12 Live Edge Validation';
        t.settings.format = 'Individual Swiss';
        t.settings.tournamentFormat = 'Individual Swiss';
        t.settings.pairingSystem = 'FIDE Dutch System';
        t.settings.rounds = '7';
        t.settings.tournamentRatingType = 'Rapid';
        t.players = [
          {name:'Player One', rating:2100, fed:'BUL', fideId:'9900001', birth:'1990', gender:'m', attendance:'present', localKey:'p1', joinedFromRound:1, pairingNumber:1},
          {name:'Player Two', rating:2000, fed:'BUL', fideId:'9900002', birth:'1991', gender:'m', attendance:'present', localKey:'p2', joinedFromRound:1, pairingNumber:2}
        ];
        t.pairings = t.pairings || {};
        t.pairings.liveBoards = {'1': [{board:1, whiteKey:'p1', blackKey:'p2', result:'1:0'}]};
        t.pairings.engine = t.pairings.engine || {};
        
        data.tournaments = data.tournaments || {};
        data.tournaments[t.settings.name] = t;
        data.currentTournament = t.settings.name;
        
        normalizeData();
        loadAllFields();
        showTab('registration', document.getElementById('tabRegistration'));
        const cs = document.getElementById('createScreen');
        if (cs) cs.style.display = 'none';
        
        window.__confirms = [];
        window.__alerts = [];
        window.appConfirm = async (msg, title) => {
          window.__confirms.push({msg, title});
          return true;
        };
        window.appAlert = async (msg, title) => {
          window.__alerts.push({msg, title});
          return true;
        };
        window.cpPersistCriticalMutation = async () => true;
        
        cpBeta98R12.hideLegacyLateBar();
        
        // Test Late Entry Double Click
        const mockLate = {name:'Late Test Player', fed:'BUL', fideId:'9900011', birth:'1994', gender:'m', std:1800, rapid:1910, blitz:1750, title:''};
        cpBeta98R7.unifiedSearch = async () => [mockLate];
        document.getElementById('fideSearch').value = 'late test player';
        renderFideResults([mockLate]);
        
        const countBefore = getCurrentTournament().players.length;
        
        // Double-click via DOM event
        const item = document.querySelector('#fideResults .fide-item');
        if (item) {
          item.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        }
        await new Promise(r => setTimeout(r, 300));
        
        const countAfter = getCurrentTournament().players.length;
        const pAdded = getCurrentTournament().players[countAfter - 1];
        
        out.counts = { countBefore, countAfter };
        out.added = {
          name: pAdded ? pAdded.name : null,
          rating: pAdded ? pAdded.rating : null,
          join: pAdded ? getPlayerJoinRound(pAdded) : null,
          attendance: pAdded ? getPlayerAttendance(pAdded) : null,
          needsResort: !!getCurrentTournament().pairings.engine.needsResort,
          confirms: window.__confirms
        };
        
        // Test Cancel
        window.appConfirm = async (msg, title) => {
          window.__confirms.push({msg, title, cancel: true});
          return false;
        };
        const cancelCandidate = {name:'Cancel Late Player', fed:'BUL', fideId:'9900012', birth:'1995', gender:'m', std:1700, rapid:1710, blitz:1650, title:''};
        cpBeta98R7.unifiedSearch = async () => [cancelCandidate];
        document.getElementById('fideSearch').value = 'cancel late player';
        renderFideResults([cancelCandidate]);
        
        const cancelCountBefore = getCurrentTournament().players.length;
        const cancelItem = document.querySelector('#fideResults .fide-item');
        if (cancelItem) {
          cancelItem.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        }
        await new Promise(r => setTimeout(r, 200));
        const cancelCountAfter = getCurrentTournament().players.length;
        
        out.cancel = { cancelCountBefore, cancelCountAfter };
        
        // VCL Anchors audit
        out.vclAnchors = {
          headerManual: !!document.querySelector('.desktop-status-controls'),
          bakuAcceleration: !!document.getElementById('cpAccelerationMethod'),
          ratingListSequence: !!document.getElementById('ratingListSequenceControl'),
          consistencyPolicy: !!document.getElementById('ratingConsistencyPolicyToggle'),
          ratingListLibrary: !!document.getElementById('cpRatingListLibraryHome'),
          prohibitedPairings: !!document.getElementById('cpProhibitedPairingsBtn'),
          adjournedResults: !!document.getElementById('cpAdjournedResultBtn'),
          unusualOtbResults: !!document.getElementById('cpUnusualOtbGroup'),
          tiedFinalPlaces: !!document.getElementById('cpBeta69TiePanel'),
          itdxExport: !!document.getElementById('cpITDXExportBtn'),
          correctionsBtn: !!document.getElementById('cpRatingReportCorrectionsBtn')
        };
        
        return out;
      })();
    `;

    const res = await client.send('Runtime.evaluate', {
      expression: testCode,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      console.error('EVAL EXCEPTION:', JSON.stringify(res.exceptionDetails, null, 2));
    }
    const val = res.result?.value;
    console.log('\n=== LIVE BROWSER RUNTIME VALIDATION RESULTS ===');
    console.log('Version:', val.version);
    console.log('Document Title:', val.title);
    console.log('Missing Continuation Modules:', val.missingModules.length ? val.missingModules : 'NONE (all 35 present)');
    console.log('Late Entry Bar Display:', val.barDisplay);
    console.log('Player Counts (Before -> After Add):', val.counts.countBefore, '->', val.counts.countAfter);
    console.log('Added Player Data:', JSON.stringify(val.added, null, 2));
    console.log('Cancellation Counts (Before -> After):', val.cancel.cancelCountBefore, '->', val.cancel.cancelCountAfter);
    console.log('VCL UI Anchors:', JSON.stringify(val.vclAnchors, null, 2));
    console.log('Page Errors:', pageErrors.length ? pageErrors : '0 errors');
    console.log('Console Errors:', consoleErrors.length ? consoleErrors : '0 errors');

    // Assertions
    let pass = 0, fail = 0;
    function check(cond, msg) {
      if (cond) { pass++; console.log(`PASS: ${msg}`); }
      else { fail++; console.error(`FAIL: ${msg}`); }
    }

    check(val.version === '1.06.00-beta.98-r12' || val.version === '1.06.00-beta.98-r13', 'HTML version is 1.06.00-beta.98-r12 or r13');
    check(val.missingModules.length === 0, 'All 35 FIDE/TEC/r12 modules present in runtime');
    check(val.barDisplay === 'none', 'Yellow Late Entry contextual bar is hidden');
    check(val.counts.countAfter === val.counts.countBefore + 1, 'Double-click added 1 player');
    check(val.added.name === 'Late Test Player', 'Added player name is Late Test Player');
    check(val.added.rating === 1910, 'Tournament rating matches Rapid rating 1910');
    check(val.added.join === 2, 'joinedFromRound is 2 (next round)');
    check(val.added.attendance === 'present', 'attendance is Present');
    check(val.added.needsResort === true, 'needsResort flag is set');
    check(val.added.confirms.length >= 1, 'Late Entry confirmation prompt appeared');
    check(val.added.confirms[0].msg.includes('0 points') || val.added.confirms[0].msg.includes('0 точки'), 'Warning mentions 0 points default');
    check(val.added.confirms[0].msg.includes('Resort Starting List'), 'Warning mentions Resort Starting List');
    check(val.cancel.cancelCountAfter === val.cancel.cancelCountBefore, 'Cancellation path left player count unchanged');
    check(Object.values(val.vclAnchors).every(Boolean), 'All 11 VCL tab controls/anchors present in live DOM');
    check(pageErrors.length === 0, 'Zero page/runtime errors');

    console.log(`\nFINAL LIVE VALIDATION: ${pass} PASS / ${fail} FAIL`);
    if (fail > 0) process.exitCode = 1;

  } finally {
    proc.kill('SIGKILL');
  }
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
