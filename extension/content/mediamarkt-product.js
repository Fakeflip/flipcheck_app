/* Flipcheck Extension — MediaMarkt.de Product Page Content Script
 * MediaMarkt and Saturn share the same MediaSaturn Next.js platform.
 * extractEanMediaMarkt is an alias for extractEanSaturn in ean-utils.js.
 */

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

  chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }, res => {
    const autoPanel = res?.data?.autoPanel !== false;
    tryExtract(autoPanel, 0);
  });

  function _ensureAttached() {
    if (!panel.isConnected) {
      // Next.js hydration may have replaced <body> and detached the panel.
      // Re-append to <body> (preferred) or <html> as fallback.
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
    // MediaMarkt = same Next.js platform as Saturn
    const ean = (typeof extractEanMediaMarkt === 'function')
      ? extractEanMediaMarkt()
      : (typeof extractEanSaturn === 'function' ? extractEanSaturn() : null);

    if (ean) {
      if (autoPanel) panel.probe(ean);
      else panel.setEan(ean);
      setTimeout(() => {
        const price = detectMMPrice();
        if (price && price > 0) panel.autofillEk(price);
      }, 500);
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

  function detectMMPrice() {
    // MediaMarkt price selectors (Next.js rendered)
    for (const sel of [
      '[data-test="branded-price-without-rrp"]',
      '[data-test="price-box"]',
      '.price__value',
      '[class*="BrandedPrice"] span',
      '[class*="price-tag"]',
    ]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const m = el.textContent.replace(',', '.').match(/\d+\.?\d{0,2}/);
      if (m) { const p = parseFloat(m[0]); if (p > 0) return p; }
    }
    return null;
  }

  // ── Manual EAN scan (panel button) ────────────────────────────────────────
  panel.addEventListener('fc-manual-ean', () => {
    const fn = typeof extractEanMediaMarkt === 'function' ? extractEanMediaMarkt : extractEanSaturn;
    const ean = typeof fn === 'function' ? fn() : null;
    if (ean && typeof panel.probe === 'function') panel.probe(ean);
  });

  // Re-attach on disconnectedCallback: fired immediately by FlipcheckPanel when
  // Next.js SSR hydration replaces <body> and detaches the panel from the DOM.
  // This replaces the old 800 ms polling interval with an event-driven approach.
  panel.addEventListener('fc-disconnected', () => {
    setTimeout(() => {
      if (!panel.isConnected) {
        (document.body || document.documentElement).appendChild(panel);
      }
    }, 0);
  });

  // SPA navigation
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(() => {
        _ensureAttached(); // re-attach if Next.js replaced <body> on route change
        const fn = typeof extractEanMediaMarkt === 'function' ? extractEanMediaMarkt : extractEanSaturn;
        if (typeof fn !== 'function') return;
        const n = fn();
        if (n && n !== panel.currentEan && typeof panel.probe === 'function') {
          panel.probe(n);
          setTimeout(() => { const p = detectMMPrice(); if (p > 0) panel.autofillEk(p); }, 500);
        }
      }, 1000);
    }
  }).observe(document, { subtree: true, childList: true });
})();
