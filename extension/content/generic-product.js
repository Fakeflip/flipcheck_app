/* Flipcheck Extension — Generic Product Page Content Script
 * Covers 100+ retailers: BackMarket, Rebuy, Thomann, Galaxus, Douglas,
 * Euronics, Expert, Caseking, Mindfactory, Intersport, Smyths, Zooplus,
 * IKEA, Wayfair, Aliexpress, Etsy, and many more.
 * EAN extraction routes through extractEanGeneric() → site-specific functions.
 * Price autofill is handled automatically by panel.probe() → detectPagePrice().
 */

(function () {
  if (document.getElementById('__fc_panel')) return;
  console.log('[FC boot] generic-product.js');

  const panel = document.createElement('flipcheck-panel');
  panel.id = '__fc_panel';
  // Pre-set inline position so panel is visible even before shadow-DOM CSS applies.
  // Using inline !important to guarantee no page CSS can override these.
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
  // Inject page-level <style> as extra defense — beats page CSS even if inline styles get wiped
  if (!document.getElementById('__fc_host_shield')) {
    const shield = document.createElement('style');
    shield.id = '__fc_host_shield';
    shield.textContent = `flipcheck-panel, flipcheck-panel#__fc_panel {
      all: initial !important;
      position: fixed !important; display: block !important;
      z-index: 2147483647 !important; top: 0 !important; left: 0 !important;
      right: auto !important; bottom: auto !important;
      width: 100vw !important; height: 100vh !important;
      background: transparent !important; color-scheme: dark !important;
      margin: 0 !important; padding: 0 !important; border: none !important;
      opacity: 1 !important; visibility: visible !important;
      transform: none !important; max-width: none !important;
      overflow: visible !important; float: none !important;
      isolation: isolate !important; pointer-events: none !important;
    }`;
    (document.head || document.documentElement).appendChild(shield);
  }
  document.documentElement.appendChild(panel);
  try {
    document.body.style.removeProperty('margin-right');
    document.body.style.removeProperty('margin-left');
    document.body.style.removeProperty('padding-bottom');
  } catch (_) {}

  // Self-heal: re-attach if SPA/React navigation removes our panel from DOM
  new MutationObserver(() => {
    if (!document.documentElement.contains(panel)) {
      try { document.documentElement.appendChild(panel); } catch (_) {}
    }
  }).observe(document.documentElement, { childList: true });

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
