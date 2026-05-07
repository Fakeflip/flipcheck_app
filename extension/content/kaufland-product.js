/* Flipcheck Extension — Kaufland.de Product Page Content Script */

(function () {
  if (document.getElementById('__fc_panel')) return;

  const panel = document.createElement('flipcheck-panel');
  panel.id = '__fc_panel';
  // Pre-set inline position so panel is visible even before shadow-DOM CSS applies.
  panel.style.setProperty('position', 'fixed',       'important');
  panel.style.setProperty('display',  'block',        'important');
  panel.style.setProperty('z-index',  '2147483647',  'important');
  panel.style.setProperty('top',      '0',            'important');
  panel.style.setProperty('right',    '0',            'important');
  panel.style.setProperty('bottom',   'auto',         'important');
  panel.style.setProperty('height',   '100vh',        'important');
  panel.style.setProperty('width',    'auto',         'important');
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

  // Read autoPanel setting, then try EAN extraction with retry
  chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }, res => {
    const autoPanel = res?.data?.autoPanel !== false; // default: true
    tryExtract(autoPanel, 0);
  });

  function tryExtract(autoPanel, attempt) {
    // Wait for custom element upgrade (customElements.define may be delayed on SPAs)
    if (typeof panel.probe !== 'function') {
      setTimeout(() => tryExtract(autoPanel, attempt), 150);
      return;
    }
    const ean = extractEanKaufland();
    if (ean) {
      if (autoPanel) panel.probe(ean);
      else panel.setEan(ean);
      setTimeout(() => {
        const price = detectKauflandPrice();
        if (price && price > 0) panel.autofillEk(price);
      }, 600);
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
    const ean = extractEanKaufland();
    if (ean && typeof panel.probe === 'function') panel.probe(ean);
  });

  function detectKauflandPrice() {
    for (const sel of [
      '.price-tag__price',
      '[data-testid="product-price"]',
      '.a-price__value',
      '.product-price__price',
    ]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const m = el.textContent.replace(',', '.').match(/\d+\.?\d{0,2}/);
      if (m) return parseFloat(m[0]);
    }
    return null;
  }

  // SPA navigation watcher
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(() => {
        const n = extractEanKaufland();
        if (n && n !== panel.currentEan && typeof panel.probe === 'function') {
          panel.probe(n);
          setTimeout(() => {
            const price = detectKauflandPrice();
            if (price && price > 0) panel.autofillEk(price);
          }, 600);
        }
      }, 1200);
    }
  }).observe(document, { subtree: true, childList: true });
})();
