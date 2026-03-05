/* Flipcheck Extension — Saturn Content Script */
(function () {
  if (document.getElementById('__fc_panel')) return;

  const panel = document.createElement('flipcheck-panel');
  panel.id = '__fc_panel';
  document.body.appendChild(panel);

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'CONTEXT_EAN_PROBE' && msg.ean && typeof panel.probe === 'function') panel.probe(msg.ean);
  });

  document.addEventListener('keydown', e => {
    if (e.altKey && e.key.toLowerCase() === 'f') {
      panel.hasAttribute('data-minimized')
        ? panel.removeAttribute('data-minimized')
        : panel.setAttribute('data-minimized', '');
    }
  });

  // Read autoPanel setting, then try EAN extraction with retry
  chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }, res => {
    const autoPanel = res?.data?.autoPanel !== false; // default: true
    tryExtract(autoPanel, 0);
  });

  function _ensureAttached() {
    if (!panel.isConnected) {
      // Next.js hydration may have replaced <body> and detached the panel.
      (document.body || document.documentElement).appendChild(panel);
    }
  }

  function tryExtract(autoPanel, attempt) {
    // Re-attach if Next.js hydration removed the panel from the DOM
    _ensureAttached();
    // Wait for custom element upgrade (customElements.define may be delayed on SPAs)
    if (typeof panel.probe !== 'function') {
      setTimeout(() => tryExtract(autoPanel, attempt), 150);
      return;
    }
    const ean = extractEanSaturn();
    if (ean) {
      if (autoPanel) panel.probe(ean);
      else panel.setEan(ean);
      return;
    }
    if (attempt === 0) {
      panel.setState('no-ean');
      setTimeout(() => tryExtract(autoPanel, 1), 1500);
    } else if (attempt === 1) {
      setTimeout(() => tryExtract(autoPanel, 2), 3000);
    } else if (attempt === 2) {
      setTimeout(() => tryExtract(autoPanel, 3), 6000);
    }
    // attempt 3: stay on no-ean
  }

  // ── Manual EAN scan (panel button) ────────────────────────────────────────
  panel.addEventListener('fc-manual-ean', () => {
    const ean = extractEanSaturn();
    if (ean && typeof panel.probe === 'function') panel.probe(ean);
  });

  // Re-attach on disconnectedCallback: fired immediately by FlipcheckPanel when
  // Next.js SSR hydration replaces <body> and detaches the panel from the DOM.
  // Event-driven approach — no polling interval needed.
  panel.addEventListener('fc-disconnected', () => {
    setTimeout(() => {
      if (!panel.isConnected) {
        (document.body || document.documentElement).appendChild(panel);
      }
    }, 0);
  });

  // SPA navigation watcher
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(() => {
        _ensureAttached(); // re-attach if Next.js replaced <body> on route change
        const n = extractEanSaturn();
        if (n && n !== panel.currentEan && typeof panel.probe === 'function') panel.probe(n);
      }, 1000);
    }
  }).observe(document, { subtree: true, childList: true });
})();
