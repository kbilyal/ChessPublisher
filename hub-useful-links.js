/* hub-useful-links-v1: responsive public Tournament Hub links + inline document viewer. */
(() => {
  'use strict';

  if (!/^\/tournaments(?:\.html)?$/.test(window.location.pathname)) return;
  if (!new URLSearchParams(window.location.search).get('id')) return;

  const MAX_LINKS = 16;
  let currentLinks = [];
  let renderQueued = false;

  const text = value => value == null ? '' : String(value).trim();
  const safeUrl = value => {
    const raw = text(value);
    if (!raw) return '';
    try {
      const parsed = new URL(raw, window.location.href);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
    } catch (_) {
      return '';
    }
  };

  const normalizeLinks = value => {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const out = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const label = text(item.label || item.name || item.title).slice(0, 80);
      const url = safeUrl(item.url || item.href || item.link);
      if (!label || !url || seen.has(url)) continue;
      seen.add(url);
      out.push({ label, url });
      if (out.length >= MAX_LINKS) break;
    }
    return out;
  };

  const drivePreviewUrl = raw => {
    const url = safeUrl(raw);
    if (!url) return '';
    try {
      const parsed = new URL(url);
      if (!/(^|\.)drive\.google\.com$/i.test(parsed.hostname)) return url;
      let id = '';
      const pathMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/i);
      if (pathMatch) id = pathMatch[1];
      if (!id) id = parsed.searchParams.get('id') || '';
      return id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview` : url;
    } catch (_) {
      return url;
    }
  };

  const isDocument = item => {
    const label = text(item?.label).toLowerCase();
    const url = text(item?.url).toLowerCase();
    return /regulation|регламент|rules|правил|pdf|document/.test(label)
      || /\.pdf(?:$|[?#])/.test(url)
      || /drive\.google\.com|docs\.google\.com/.test(url);
  };

  const extractLinks = (value, depth = 0, seen = new WeakSet()) => {
    if (!value || typeof value !== 'object' || depth > 7) return [];
    if (seen.has(value)) return [];
    seen.add(value);

    const regulations = value.regulations;
    if (regulations && typeof regulations === 'object') {
      const links = normalizeLinks(regulations.usefulLinks || regulations.links);
      const file = regulations.file;
      const fileUrl = safeUrl(file?.url || file?.publicUrl || file?.downloadUrl);
      if (fileUrl && !links.some(item => item.url === fileUrl)) {
        links.unshift({ label: text(file?.name) || 'Regulations', url: fileUrl });
      }
      if (links.length) return links.slice(0, MAX_LINKS);
    }

    for (const key of ['snapshot', 'data', 'payload', 'result', 'tournament']) {
      const nested = value[key];
      if (!nested || typeof nested !== 'object') continue;
      const found = extractLinks(nested, depth + 1, seen);
      if (found.length) return found;
    }

    for (const nested of Object.values(value)) {
      if (!nested || typeof nested !== 'object') continue;
      const found = extractLinks(nested, depth + 1, seen);
      if (found.length) return found;
    }
    return [];
  };

  const ensureStyles = () => {
    if (document.getElementById('cp-hub-public-links-style')) return;
    const style = document.createElement('style');
    style.id = 'cp-hub-public-links-style';
    style.textContent = `
      [data-hub-useful-links="v1"] { margin-top:14px; width:100%; }
      [data-hub-useful-links="v1"] .cp-public-links-title { margin:0 0 8px; font-size:12px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:#64748b; }
      [data-hub-useful-links="v1"] .cp-public-links-grid { display:flex; flex-wrap:wrap; gap:8px; }
      [data-hub-useful-links="v1"] .cp-public-link { display:inline-flex; align-items:center; gap:8px; min-height:40px; max-width:100%; padding:9px 12px; border:1px solid rgba(37,99,235,.18); border-radius:10px; background:#f8fbff; color:#174a7c; font:700 13px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; text-decoration:none; cursor:pointer; box-shadow:0 1px 2px rgba(15,23,42,.04); }
      [data-hub-useful-links="v1"] .cp-public-link:hover { background:#eff6ff; border-color:rgba(37,99,235,.32); }
      [data-hub-useful-links="v1"] .cp-public-link-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      [data-cp-document-viewer="v1"] { position:fixed; inset:0; z-index:2147483000; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(2,6,23,.72); backdrop-filter:blur(4px); }
      [data-cp-document-viewer="v1"] .cp-viewer-panel { width:min(1120px,96vw); height:min(88vh,900px); display:flex; flex-direction:column; overflow:hidden; border-radius:16px; background:#fff; box-shadow:0 24px 80px rgba(2,6,23,.4); }
      [data-cp-document-viewer="v1"] .cp-viewer-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
      [data-cp-document-viewer="v1"] .cp-viewer-title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:800 14px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:#0f172a; }
      [data-cp-document-viewer="v1"] .cp-viewer-actions { display:flex; gap:8px; flex-shrink:0; }
      [data-cp-document-viewer="v1"] .cp-viewer-actions a,
      [data-cp-document-viewer="v1"] .cp-viewer-actions button { min-height:38px; padding:8px 11px; border:1px solid #cbd5e1; border-radius:9px; background:#fff; color:#334155; font:700 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; text-decoration:none; cursor:pointer; }
      [data-cp-document-viewer="v1"] iframe { width:100%; flex:1; border:0; background:#fff; }
      @media (max-width: 640px) {
        [data-hub-useful-links="v1"] .cp-public-links-grid { display:grid; grid-template-columns:1fr; }
        [data-hub-useful-links="v1"] .cp-public-link { width:100%; min-height:48px; justify-content:space-between; font-size:14px; }
        [data-cp-document-viewer="v1"] { padding:0; align-items:stretch; }
        [data-cp-document-viewer="v1"] .cp-viewer-panel { width:100vw; height:100dvh; max-height:none; border-radius:0; padding-top:env(safe-area-inset-top); padding-bottom:env(safe-area-inset-bottom); }
        [data-cp-document-viewer="v1"] .cp-viewer-head { flex-wrap:wrap; padding:10px 12px; }
        [data-cp-document-viewer="v1"] .cp-viewer-title { width:100%; font-size:14px; }
        [data-cp-document-viewer="v1"] .cp-viewer-actions { width:100%; display:grid; grid-template-columns:1fr 1fr; }
        [data-cp-document-viewer="v1"] .cp-viewer-actions a,
        [data-cp-document-viewer="v1"] .cp-viewer-actions button { min-height:44px; display:flex; align-items:center; justify-content:center; }
      }
    `;
    document.head.appendChild(style);
  };

  const titleHost = () => {
    const headings = [...document.querySelectorAll('main h1, main h2, h1')];
    const title = headings.find(node => {
      const value = text(node.textContent).toLowerCase();
      return value && !value.includes('tournament hub') && value !== 'tournaments';
    }) || headings[0];
    return title?.parentElement || document.querySelector('main');
  };

  const openViewer = item => {
    document.querySelector('[data-cp-document-viewer="v1"]')?.remove();
    const overlay = document.createElement('div');
    overlay.dataset.cpDocumentViewer = 'v1';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', item.label);

    const panel = document.createElement('div');
    panel.className = 'cp-viewer-panel';
    const head = document.createElement('div');
    head.className = 'cp-viewer-head';
    const title = document.createElement('div');
    title.className = 'cp-viewer-title';
    title.textContent = item.label;
    const actions = document.createElement('div');
    actions.className = 'cp-viewer-actions';

    const external = document.createElement('a');
    external.href = item.url;
    external.target = '_blank';
    external.rel = 'noopener noreferrer';
    external.textContent = 'Open in browser';

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => overlay.remove());
    actions.append(external, close);
    head.append(title, actions);

    const frame = document.createElement('iframe');
    frame.src = drivePreviewUrl(item.url);
    frame.title = item.label;
    frame.loading = 'eager';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute('allow', 'fullscreen');

    panel.append(head, frame);
    overlay.appendChild(panel);
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function onKey(event) {
      if (event.key !== 'Escape') return;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    });
    document.body.appendChild(overlay);
    close.focus();
  };

  const render = () => {
    renderQueued = false;
    ensureStyles();
    const existing = document.querySelector('[data-hub-useful-links="v1"]');
    if (!currentLinks.length) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const host = titleHost();
    if (!host) return;

    const section = document.createElement('section');
    section.dataset.hubUsefulLinks = 'v1';
    section.setAttribute('aria-label', 'Useful tournament links');
    const title = document.createElement('div');
    title.className = 'cp-public-links-title';
    title.textContent = 'Useful links';
    const grid = document.createElement('div');
    grid.className = 'cp-public-links-grid';

    for (const item of currentLinks) {
      const link = document.createElement('a');
      link.className = 'cp-public-link';
      link.href = item.url;
      link.rel = 'noopener noreferrer';
      const label = document.createElement('span');
      label.className = 'cp-public-link-label';
      label.textContent = item.label;
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = isDocument(item) ? '↗' : '→';
      link.append(label, icon);
      if (isDocument(item)) {
        link.addEventListener('click', event => {
          event.preventDefault();
          openViewer(item);
        });
      } else {
        link.target = '_blank';
      }
      grid.appendChild(link);
    }

    section.append(title, grid);
    host.appendChild(section);
  };

  const queueRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  };

  const capture = payload => {
    const links = extractLinks(payload);
    if (!links.length) return;
    const fingerprint = JSON.stringify(links);
    if (fingerprint === JSON.stringify(currentLinks)) return;
    currentLinks = links;
    document.querySelector('[data-hub-useful-links="v1"]')?.remove();
    queueRender();
  };

  const nativeFetch = window.fetch?.bind(window);
  if (nativeFetch) {
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args);
      try {
        const clone = response.clone();
        const type = clone.headers.get('content-type') || '';
        if (type.includes('json')) clone.json().then(capture).catch(() => {});
      } catch (_) {}
      return response;
    };
  }

  const observer = new MutationObserver(queueRender);
  const start = () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    queueRender();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
