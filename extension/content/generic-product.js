/* Flipcheck Extension — Generic Product Page Content Script
 * Covers 100+ retailers: BackMarket, Rebuy, Thomann, Galaxus, Douglas,
 * Euronics, Expert, Caseking, Mindfactory, Intersport, Smyths, Zooplus,
 * IKEA, Wayfair, Aliexpress, Etsy, and many more.
 * EAN extraction routes through extractEanGeneric() → site-specific functions.
 * Price autofill is handled automatically by panel.probe() → detectPagePrice().
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

  init();

  function init() {
    // Wait for custom element upgrade (customElements.define may be delayed on SPAs)
    if (typeof panel.probe !== 'function') {
      setTimeout(init, 150);
      return;
    }
    const ean = extractEanGeneric();
    if (ean) {
      panel.probe(ean); // probe() automatically calls _autoFillPagePrice()
    } else {
      panel.setState('no-ean');
      // Retry after page fully renders (SPAs hydrate after document_idle)
      setTimeout(() => {
        const retryEan = extractEanGeneric();
        if (retryEan) panel.probe(retryEan);
      }, 1500);
      // Second retry for slow SPAs
      setTimeout(() => {
        if (panel.currentEan) return; // already got one
        const retryEan = extractEanGeneric();
        if (retryEan) panel.probe(retryEan);
      }, 4000);
    }
  }

  // ── Manual EAN scan (panel button) ────────────────────────────────────────
  panel.addEventListener('fc-manual-ean', () => {
    const ean = extractEanGeneric();
    if (ean && typeof panel.probe === 'function') panel.probe(ean);
  });

  // SPA navigation watcher
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(() => {
        const n = extractEanGeneric();
        if (n && n !== panel.currentEan && typeof panel.probe === 'function') panel.probe(n);
      }, 1000);
    }
  }).observe(document, { subtree: true, childList: true });
})();
