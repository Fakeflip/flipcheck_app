/* Flipcheck Extension — eBay Product Page (/itm/) Content Script */

(function () {
  if (document.getElementById('__fc_panel')) return;

  const panel = document.createElement('flipcheck-panel');
  panel.id = '__fc_panel';
  document.body.appendChild(panel);

  // ── Context-menu EAN probe ─────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'CONTEXT_EAN_PROBE' && msg.ean && typeof panel.probe === 'function') {
      panel.probe(msg.ean);
    }
  });

  // ── Alt+F keyboard shortcut ────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.altKey && e.key.toLowerCase() === 'f') {
      panel.hasAttribute('data-minimized')
        ? panel.removeAttribute('data-minimized')
        : panel.setAttribute('data-minimized', '');
    }
  });

  // ── Load settings, then extract EAN with retry ──────────────────────────────
  chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }, res => {
    const s          = res?.data || {};
    const autoPanel  = s.autoPanel  !== false;   // default: true
    const defaultEk  = s.ekMode === 'net';        // EK mode preference

    tryExtract(autoPanel, 0);
  });

  // ── Extraction with up to 3 attempts ──────────────────────────────────────
  function tryExtract(autoPanel, attempt) {
    // Wait for custom element upgrade (customElements.define may be delayed on SPAs)
    if (typeof panel.probe !== 'function') {
      setTimeout(() => tryExtract(autoPanel, attempt), 150);
      return;
    }
    const ean = extractEanEbayProduct();

    if (ean) {
      if (autoPanel) {
        panel.probe(ean);
      } else {
        panel.setEan(ean); // EAN in header, user clicks manually
      }
      // Auto-fill EK from page price
      setTimeout(() => {
        const price = detectEbayPrice();
        if (price && price > 0) panel.autofillEk(price);
      }, 500);
      return;
    }

    // No EAN yet
    if (attempt === 0) {
      panel.setState('no-ean');
      setTimeout(() => tryExtract(autoPanel, 1), 1500);  // retry after 1.5s
    } else if (attempt === 1) {
      setTimeout(() => tryExtract(autoPanel, 2), 3000);  // retry after 3s
    }
    // attempt 2: give up, stay on no-ean
  }

  // ── eBay price detection ───────────────────────────────────────────────────
  function detectEbayPrice() {
    // 1) Current eBay layout — primary price
    for (const sel of [
      '.x-price-primary .ux-textspans--BOLD',
      '.x-bin-price__content .ux-textspans--BOLD',
      '.x-price-primary [aria-hidden="true"]',
      '#prcIsum',
      '#mm-saleDscPrc',
    ]) {
      const el = document.querySelector(sel);
      if (el) { const p = parseEuroText(el.textContent); if (p) return p; }
    }
    // 2) itemprop="price"
    const ip = document.querySelector('[itemprop="price"]');
    if (ip) {
      const v = parseFloat(String(ip.getAttribute('content') || ip.textContent).replace(',', '.'));
      if (v > 0) return v;
    }
    // 3) JSON-LD offers.price
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(el.textContent);
        const raw = d?.offers?.price ?? d?.offers?.[0]?.price;
        if (raw) { const p = parseFloat(String(raw).replace(',', '.')); if (p > 0) return p; }
      } catch {}
    }
    return null;
  }

  function parseEuroText(text) {
    const s = String(text || '').replace(/\s/g, '');
    // German format: 1.234,56
    const g = s.match(/(\d{1,3}(?:\.\d{3})*),(\d{2})/);
    if (g) return parseFloat(g[0].replace(/\./g, '').replace(',', '.'));
    // Plain decimal: 45.99
    const d = s.match(/(\d+)\.(\d{1,2})(?!\d)/);
    if (d) return parseFloat(d[0]);
    // Integer: 45
    const i = s.match(/\d+/);
    if (i) return parseFloat(i[0]);
    return null;
  }

  // ── Manual EAN scan (panel button) ────────────────────────────────────────
  panel.addEventListener('fc-manual-ean', () => {
    const ean = extractEanEbayProduct();
    if (ean && typeof panel.probe === 'function') panel.probe(ean);
  });

  // ── SPA navigation (eBay variant switches use pushState) ────────────────────
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(() => {
        const newEan = extractEanEbayProduct();
        if (newEan && newEan !== panel.currentEan && typeof panel.probe === 'function') {
          panel.probe(newEan);
          setTimeout(() => {
            const price = detectEbayPrice();
            if (price && price > 0) panel.autofillEk(price);
          }, 500);
        }
      }, 1000);
    }
  }).observe(document, { subtree: true, childList: true });
})();
