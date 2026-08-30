const toggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('.site-nav');
if (toggle && nav) {
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }));
}

const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();

const RELEASES_API = 'https://api.github.com/repos/kbilyal/ChessPublisher/releases?per_page=10';
const RELEASES_URL = 'https://github.com/kbilyal/ChessPublisher/releases';

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric'
  }).format(date);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
}

function cleanVersion(tag) {
  return String(tag || '').replace(/^v/i, '') || 'Unknown';
}

function findAsset(release, matcher) {
  return (release.assets || []).find(asset => matcher.test(asset.name || '')) || null;
}

function addDynamicStyles() {
  if (document.getElementById('release-live-styles')) return;
  const style = document.createElement('style');
  style.id = 'release-live-styles';
  style.textContent = `
    .release-live-pill{display:inline-flex;align-items:center;gap:8px;margin:0 0 26px;padding:8px 12px;border:1px solid #d7e2eb;border-radius:999px;background:#fff;color:#506174;font-size:12px;font-weight:700;box-shadow:0 5px 18px rgba(20,32,51,.04)}
    .release-live-pill strong{color:#17314b}.release-live-pill .release-dot{width:7px;height:7px;border-radius:50%;background:#2c8b67;box-shadow:0 0 0 4px rgba(44,139,103,.1)}
    .release-download-meta{margin-top:18px;padding-top:16px;border-top:1px solid #e4e9ef;color:#607083;font-size:12px;display:grid;gap:6px}.release-download-meta strong{color:#17314b;font-size:13px}.release-download-meta span{display:inline;color:inherit;font-size:12px}
    .release-notes-shell{max-width:1180px;margin:auto}.release-notes-head{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:34px}.release-notes-head p{max-width:680px;color:#5f6d80;margin-bottom:0}.release-notes-head a{white-space:nowrap}
    .release-current{border:1px solid #dbe2ea;border-radius:22px;background:#fff;overflow:hidden;box-shadow:0 10px 34px rgba(20,32,51,.045)}.release-current-top{padding:26px 28px 20px;display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:1px solid #e7ecf1}.release-current-top h3{font-size:24px;margin:3px 0 5px}.release-current-top p{margin:0;color:#6a7888;font-size:13px}.release-badge{display:inline-flex;padding:6px 9px;border-radius:999px;background:#eaf5ef;color:#23795b;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    .release-assets{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.release-assets a{padding:7px 10px;border:1px solid #dce4eb;border-radius:9px;background:#f8fafc;font-size:11px;font-weight:700;color:#30455a}.release-assets a:hover{border-color:#adc2d2;background:#fff}
    .release-notes-body{padding:25px 28px;color:#34465a;font:13px/1.75 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#fbfcfd;max-height:470px;overflow:auto}.release-notes-empty{color:#7c8997;font-style:italic}
    .release-history{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:18px}.release-history-card{border:1px solid #dbe2ea;border-radius:16px;background:#fff;padding:18px 20px}.release-history-card h4{margin:0 0 5px;font-size:16px}.release-history-card p{margin:0 0 12px;color:#748292;font-size:12px}.release-history-card details summary{cursor:pointer;font-size:12px;font-weight:700;color:#315f80}.release-history-card pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;color:#526276;margin:12px 0 0;max-height:260px;overflow:auto}.release-loading{border:1px dashed #cdd7e0;border-radius:18px;padding:28px;text-align:center;color:#718090;background:#f8fafc}
    @media(max-width:760px){.release-notes-head,.release-current-top{display:block}.release-notes-head a{margin-top:18px}.release-current-top .release-badge{margin-top:12px}.release-history{grid-template-columns:1fr}.release-current-top,.release-notes-body{padding-left:20px;padding-right:20px}.release-live-pill{margin-bottom:22px}}
  `;
  document.head.appendChild(style);
}

function ensureReleaseNotesNav() {
  const siteNav = document.querySelector('.site-nav');
  if (!siteNav || siteNav.querySelector('a[href="#release-notes"]')) return;
  const link = document.createElement('a');
  link.href = '#release-notes';
  link.textContent = 'Release notes';
  const docs = siteNav.querySelector('a[href="#docs"]');
  siteNav.insertBefore(link, docs || siteNav.querySelector('.nav-github'));
  link.addEventListener('click', () => {
    siteNav.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  });
}

function ensureReleaseNotesSection() {
  let section = document.getElementById('release-notes');
  if (section) return section;
  section = document.createElement('section');
  section.className = 'section';
  section.id = 'release-notes';
  section.innerHTML = `
    <div class="release-notes-shell">
      <div class="release-notes-head">
        <div>
          <div class="eyebrow">Release history</div>
          <h2>Release notes</h2>
          <p>Version information and notes are loaded directly from official GitHub Releases, so this page updates automatically after a new release is published.</p>
        </div>
        <a class="button button-secondary" href="${RELEASES_URL}" target="_blank" rel="noopener">All releases ↗</a>
      </div>
      <div id="release-notes-content" class="release-loading">Loading the latest release information…</div>
    </div>`;
  const docs = document.getElementById('docs');
  const download = document.getElementById('download');
  if (docs && docs.parentNode) docs.parentNode.insertBefore(section, docs);
  else if (download && download.parentNode) download.parentNode.insertBefore(section, download.nextSibling);
  else document.querySelector('main')?.appendChild(section);
  return section;
}

function updateMainReleaseUI(release) {
  const version = cleanVersion(release.tag_name);
  const date = formatDate(release.published_at || release.created_at);
  const exe = findAsset(release, /\.exe$/i);
  const zip = findAsset(release, /\.zip$/i);
  const checksum = findAsset(release, /(sha256|checksum).*\.(txt|sha256)$/i);
  const primaryUrl = exe?.browser_download_url || release.html_url || RELEASES_URL;

  document.querySelectorAll('[data-latest-release]').forEach(link => {
    link.href = primaryUrl;
  });

  const heroCopy = document.querySelector('.hero-copy');
  if (heroCopy && !heroCopy.querySelector('.release-live-pill')) {
    const pill = document.createElement('div');
    pill.className = 'release-live-pill';
    pill.innerHTML = `<span class="release-dot"></span><span>Latest stable <strong>v${version}</strong>${date ? ` · ${date}` : ''}</span>`;
    const actions = heroCopy.querySelector('.hero-actions');
    heroCopy.insertBefore(pill, actions || null);
  }

  const downloadActions = document.querySelector('#download .download-actions');
  if (downloadActions) {
    const first = downloadActions.querySelector('[data-latest-release]');
    if (first) {
      first.href = primaryUrl;
      first.textContent = exe ? `Download installer v${version}` : `Latest release v${version}`;
      first.removeAttribute('target');
    }
    if (zip && !downloadActions.querySelector('[data-portable-release]')) {
      const portable = document.createElement('a');
      portable.className = 'button button-secondary';
      portable.setAttribute('data-portable-release', '');
      portable.href = zip.browser_download_url;
      portable.textContent = 'Portable ZIP';
      downloadActions.insertBefore(portable, downloadActions.children[1] || null);
    }
  }

  const downloadCard = document.querySelector('#download .download-card');
  if (downloadCard && !downloadCard.querySelector('.release-download-meta')) {
    const meta = document.createElement('div');
    meta.className = 'release-download-meta';
    const parts = [];
    if (exe) parts.push(`Installer ${formatBytes(exe.size)}`.trim());
    if (zip) parts.push(`ZIP ${formatBytes(zip.size)}`.trim());
    meta.innerHTML = `<strong>Current release: v${version}</strong>${date ? `<span>Published ${date}</span>` : ''}${parts.length ? `<span>${parts.join(' · ')}</span>` : ''}`;
    downloadCard.appendChild(meta);
  }

  return { version, date, exe, zip, checksum };
}

function renderReleaseNotes(releases) {
  const content = document.getElementById('release-notes-content');
  if (!content) return;
  if (!releases.length) {
    content.className = 'release-loading';
    content.textContent = 'No stable GitHub Release has been published yet.';
    return;
  }

  const latest = releases[0];
  const info = updateMainReleaseUI(latest);
  content.className = '';
  content.textContent = '';

  const current = document.createElement('article');
  current.className = 'release-current';

  const top = document.createElement('div');
  top.className = 'release-current-top';
  const titleBlock = document.createElement('div');
  titleBlock.innerHTML = `<div class="release-badge">Latest stable</div><h3>ChessPublisher v${info.version}</h3><p>${info.date ? `Published ${info.date}` : 'Official GitHub Release'}</p>`;

  const assetLinks = document.createElement('div');
  assetLinks.className = 'release-assets';
  if (info.exe) assetLinks.appendChild(makeAssetLink(info.exe, `Installer${formatBytes(info.exe.size) ? ` · ${formatBytes(info.exe.size)}` : ''}`));
  if (info.zip) assetLinks.appendChild(makeAssetLink(info.zip, `Portable ZIP${formatBytes(info.zip.size) ? ` · ${formatBytes(info.zip.size)}` : ''}`));
  if (info.checksum) assetLinks.appendChild(makeAssetLink(info.checksum, 'SHA-256'));
  const githubLink = document.createElement('a');
  githubLink.href = latest.html_url || RELEASES_URL;
  githubLink.target = '_blank';
  githubLink.rel = 'noopener';
  githubLink.textContent = 'GitHub release ↗';
  assetLinks.appendChild(githubLink);
  titleBlock.appendChild(assetLinks);

  const badgeWrap = document.createElement('div');
  top.appendChild(titleBlock);
  top.appendChild(badgeWrap);

  const body = document.createElement('div');
  body.className = 'release-notes-body';
  if (latest.body && latest.body.trim()) body.textContent = latest.body.trim();
  else {
    body.classList.add('release-notes-empty');
    body.textContent = 'No release notes were provided for this release.';
  }
  current.appendChild(top);
  current.appendChild(body);
  content.appendChild(current);

  if (releases.length > 1) {
    const history = document.createElement('div');
    history.className = 'release-history';
    releases.slice(1, 7).forEach(release => {
      const version = cleanVersion(release.tag_name);
      const card = document.createElement('article');
      card.className = 'release-history-card';
      const h4 = document.createElement('h4');
      h4.textContent = `v${version}`;
      const meta = document.createElement('p');
      meta.textContent = formatDate(release.published_at || release.created_at) || 'Official GitHub Release';
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Show release notes';
      const pre = document.createElement('pre');
      pre.textContent = (release.body || 'No release notes were provided.').trim();
      details.appendChild(summary);
      details.appendChild(pre);
      card.appendChild(h4);
      card.appendChild(meta);
      card.appendChild(details);
      history.appendChild(card);
    });
    content.appendChild(history);
  }
}

function makeAssetLink(asset, label) {
  const link = document.createElement('a');
  link.href = asset.browser_download_url;
  link.textContent = label;
  return link;
}

addDynamicStyles();
ensureReleaseNotesNav();
ensureReleaseNotesSection();

fetch(RELEASES_API, {
  cache: 'no-store',
  headers: {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
})
  .then(response => response.ok ? response.json() : Promise.reject(new Error(`GitHub API ${response.status}`)))
  .then(allReleases => {
    const stable = (Array.isArray(allReleases) ? allReleases : [])
      .filter(release => !release.draft && !release.prerelease)
      .sort((a, b) => new Date(b.published_at || b.created_at || 0) - new Date(a.published_at || a.created_at || 0));
    renderReleaseNotes(stable);
  })
  .catch(() => {
    const content = document.getElementById('release-notes-content');
    if (content) {
      content.className = 'release-loading';
      content.innerHTML = `Release information is temporarily unavailable. <a href="${RELEASES_URL}" target="_blank" rel="noopener">Open GitHub Releases ↗</a>`;
    }
  });
