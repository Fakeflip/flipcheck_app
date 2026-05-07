/* Flipcheck Extension — MediaMarkt.de Product Page Content Script
 * MediaMarkt and Saturn share the same MediaSaturn Next.js platform.
 * extractEanMediaMarkt is an alias for extractEanSaturn in ean-utils.js.
 */

(function () {
  if (document.getElementById('__fc_panel')) return;
  console.log('[FC boot] mediamarkt-product.js');

  const panel = document.createElement('flipcheck-panel');
  panel.id = '__fc_panel';
  // Pre-set inline position so panel is visible even before shadow-DOM CSS applies.
  // setProperty with 'important' beats any host-page CSS including Next.js resets.
    panel.style.setProperty('position', 'fixed',       'important');
  panel.style.setProperty('display',  'block',        'important');
  panel.style.setProperty('z-index',  '2147483647',  'important');
  panel.style.setProperty('top',      '0',            'important');
  panel.style.setProperty('left',     '0',            'important');
  panel.style.setProperty('right',    'auto',         'important');
  panel.style.setProperty('bottom',   'auto',         'important');
  panel.style.setProperty('width',    '100vw',        'important');
  panel.style.setProperty('height',   '100vh',        'important');
  panel.style.setProperty('background', 'transparent', 'important');
  panel.style.setProperty('color-scheme', 'dark',     'important');
  panel.style.setProperty('margin',   '0',            'important');
  panel.style.setProperty('padding',  '0',            'important');
  panel.style.setProperty('border',   'none',         'important');
  panel.style.setProperty('opacity',  '1',            'important');
  panel.style.setProperty('visibility', 'visible',    'important');
  panel.style.setProperty('transform', 'none',        'important');
  panel.style.setProperty('max-width', 'none',        'important');
  panel.style.setProperty('min-width', '0',           'important');
  panel.style.setProperty('overflow',  'visible',     'important');
  panel.style.setProperty('float',     'none',        'important');
  panel.style.setProperty('clear',     'none',        'important');
  panel.style.setProperty('isolation', 'isolate',     'important');
  panel.style.setProperty('pointer-events', 'none',   'important');
  document.documentElement.appendChild(panel);
  // v7: Panel floats — no body-margin push needed.
  try {
    document.body.style.removeProperty('margin-right');
    document.body.style.removeProperty('margin-left');
    document.body.style.removeProperty('padding-bottom');
  } catch (_) {}

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

  // Module-level so SPA navigator can reuse it
  let _autoPanel = true;
  chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }, res => {
    _autoPanel = res?.data?.autoPanel !== false;
    tryExtract(_autoPanel, 0);
  });

  function _ensureAttached() {
    if (!panel.isConnected) {
      // Next.js hydration may have replaced <body> and detached the panel.
      // Re-append to <body> (preferred) or <html> as fallback.
      (document.body || document.documentElement).appendChild(panel);
    }
  }

  function tryExtract(autoPanel, attempt, forUrl) {
    // Abort stale retry chains when user navigated away before this fires
    forUrl = forUrl || location.href;
    if (forUrl !== location.href) return;

    // Re-attach if Next.js hydration removed the panel from the DOM
    _ensureAttached();
    // Wait for custom element upgrade (customElements.define may be delayed on SPAs)
    if (typeof panel.probe !== 'function') {
      setTimeout(() => tryExtract(autoPanel, attempt, forUrl), 150);
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
        if (forUrl !== location.href) return;
        const price = detectMMPrice();
        if (price && price > 0) panel.autofillEk(price);
      }, 500);
      return;
    }
    if (attempt === 0) {
      panel.setState('no-ean');
      setTimeout(() => tryExtract(autoPanel, 1, forUrl), 1500);
    } else if (attempt === 1) {
      setTimeout(() => tryExtract(autoPanel, 2, forUrl), 3000);
    } else if (attempt === 2) {
      setTimeout(() => tryExtract(autoPanel, 3, forUrl), 6000);
    } else if (attempt === 3) {
      // Cloudflare / bot protection can show a challenge page first and then
      // load the real product page without a URL change. Watch for the product
      // title or JSON-LD to appear and re-scan once more (attempt 4 = final).
      _watchForProductContent(autoPanel, forUrl);
    }
    // attempt 4+: stay on no-ean
  }

  // Watch for product content to appear after bot-protection challenge resolves.
  // Triggers a final extraction attempt when a JSON-LD Product or product heading
  // is added to the DOM (indicates the real page has loaded).
  let _watcherActive = false;
  function _watchForProductContent(autoPanel, forUrl) {
    forUrl = forUrl || location.href;
    if (_watcherActive) return;
    _watcherActive = true;
    const obs = new MutationObserver(() => {
      if (forUrl !== location.href) { obs.disconnect(); _watcherActive = false; return; }
      const hasProduct =
        document.querySelector('script[type="application/ld+json"]') ||
        document.querySelector('[data-testid="pdp-product-title"], [data-testid="product-title"], h1[class*="product"]');
      if (!hasProduct) return;
      obs.disconnect();
      _watcherActive = false;
      setTimeout(() => {
        if (forUrl !== location.href) return;
        _ensureAttached();
        if (typeof panel.probe !== 'function') return;
        const fn = typeof extractEanMediaMarkt === 'function' ? extractEanMediaMarkt : extractEanSaturn;
        const ean = typeof fn === 'function' ? fn() : null;
        if (ean && ean !== panel.currentEan) {
          if (autoPanel) panel.probe(ean);
          else panel.setEan(ean);
          setTimeout(() => { const p = detectMMPrice(); if (p > 0) panel.autofillEk(p); }, 500);
        }
      }, 800);
    });
    obs.observe(document, { subtree: true, childList: true });
    // Auto-disconnect after 30s to avoid leaking the observer forever
    setTimeout(() => { obs.disconnect(); _watcherActive = false; }, 30000);
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

  // SPA navigation — detect URL changes via history.pushState patch + popstate.
  // MutationObserver alone is unreliable in isolated worlds; patching the history
  // API is the only guaranteed way to catch Next.js client-side route changes.
  function _onSpaNav() {
    const navUrl = location.href;
    if (navUrl === _lastUrl) return;
    _lastUrl = navUrl;
    _watcherActive = false; // reset bot-protection watcher
    // Wait for Next.js to inject the new page's JSON-LD, then run full retry chain
    setTimeout(() => {
      _ensureAttached();
      tryExtract(_autoPanel, 0, navUrl);
    }, 800);
  }

  let _lastUrl = location.href;

  // 1) Patch history.pushState (covers link clicks in Next.js App Router)
  const _origPush    = history.pushState.bind(history);
  const _origReplace = history.replaceState.bind(history);
  history.pushState = function (...args) {
    _origPush(...args);
    _onSpaNav();
  };
  history.replaceState = function (...args) {
    _origReplace(...args);
    _onSpaNav();
  };

  // 2) popstate covers browser back/forward buttons
  window.addEventListener('popstate', _onSpaNav);

  // 3) MutationObserver as belt-and-suspenders fallback (catches edge cases)
  new MutationObserver(() => { _onSpaNav(); }).observe(document, { subtree: true, childList: true });
})();
