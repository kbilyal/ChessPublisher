/* hub-fide-event-id-v1: public Tournament Hub display only. */
(() => {
  'use strict';

  if (!/^\/tournaments(?:\.html)?$/.test(window.location.pathname)) return;

  const detailId = new URLSearchParams(window.location.search).get('id');
  if (!detailId) return;

  let currentFideEventId = '';
  let renderQueued = false;

  const numericId = value => {
    const normalized = String(value ?? '').trim();
    return /^\d{1,20}$/.test(normalized) ? normalized : '';
  };

  const findFideEventId = (value, depth = 0, seen = new WeakSet()) => {
    if (!value || typeof value !== 'object' || depth > 7) return '';
    if (seen.has(value)) return '';
    seen.add(value);

    const direct = numericId(value.fideEventId ?? value.fide_event_id ?? value.fideeventid);
    if (direct) return direct;

    for (const key of ['tournament', 'snapshot', 'data', 'payload', 'result']) {
      const nested = value[key];
      if (!nested || typeof nested !== 'object') continue;
      const found = findFideEventId(nested, depth + 1, seen);
      if (found) return found;
    }

    for (const nested of Object.values(value)) {
      if (!nested || typeof nested !== 'object') continue;
      const found = findFideEventId(nested, depth + 1, seen);
      if (found) return found;
    }
    return '';
  };

  const findTitleHost = () => {
    const headings = [...document.querySelectorAll('main h1, main h2, h1')];
    const title = headings.find(node => {
      const text = (node.textContent || '').trim().toLowerCase();
      return text && !text.includes('tournament hub') && !text.includes('tournaments');
    }) || headings[0];
    return title?.parentElement || document.querySelector('main');
  };

  const render = () => {
    renderQueued = false;
    const existing = document.querySelector('[data-hub-fide-event-id="hub-fide-event-id-v1"]');
    if (!currentFideEventId) {
      existing?.remove();
      return;
    }
    if (existing) {
      const value = existing.querySelector('[data-fide-event-value]');
      if (value) value.textContent = currentFideEventId;
      return;
    }

    const host = findTitleHost();
    if (!host) return;

    const badge = document.createElement('div');
    badge.dataset.hubFideEventId = 'hub-fide-event-id-v1';
    badge.setAttribute('aria-label', `FIDE Event ID ${currentFideEventId}`);
    badge.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:7px',
      'margin-top:8px',
      'padding:6px 10px',
      'border:1px solid rgba(37,99,235,.18)',
      'border-radius:999px',
      'background:rgba(239,246,255,.92)',
      'color:#1e3a5f',
      'font-size:12px',
      'line-height:1',
      'white-space:nowrap'
    ].join(';');

    const label = document.createElement('span');
    label.textContent = 'FIDE Event ID';
    label.style.cssText = 'font-weight:650;color:#52739a';

    const value = document.createElement('strong');
    value.dataset.fideEventValue = 'true';
    value.textContent = currentFideEventId;
    value.style.cssText = 'font-weight:800;color:#163e70;letter-spacing:.01em';

    badge.append(label, value);
    host.appendChild(badge);
  };

  const queueRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(render);
  };

  const capture = payload => {
    const found = findFideEventId(payload);
    if (!found || found === currentFideEventId) return;
    currentFideEventId = found;
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
  const beginObserve = () => {
    if (!document.documentElement) return;
    observer.observe(document.documentElement, { childList: true, subtree: true });
    queueRender();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', beginObserve, { once: true });
  } else {
    beginObserve();
  }
})();
