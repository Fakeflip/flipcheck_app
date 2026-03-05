/* Flipcheck Extension — Amazon.de Product Page (/dp/) Content Script */

(function () {
  if (document.getElementById('__fc_panel')) return;

  function getAmazonAsin() {
    // From URL: /dp/B0XXXXXXXXX/  or /gp/product/B0XXXXXXXXX
    const m = location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  }

  const panel = document.createElement('flipcheck-panel');
  panel.id = '__fc_panel';
  panel.dataset.market = 'amazon';
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
    const s         = res?.data || {};
    const autoPanel = s.autoPanel !== false; // default: true
    tryExtract(autoPanel, 0);
  });

  // ── Extraction with up to 3 attempts ──────────────────────────────────────
  function tryExtract(autoPanel, attempt) {
    // Wait for custom element upgrade (customElements.define may be delayed on SPAs)
    if (typeof panel.probe !== 'function') {
      setTimeout(() => tryExtract(autoPanel, attempt), 150);
      return;
    }
    const ean = extractEanAmazon();

    if (ean) {
      if (autoPanel) {
        const asin = getAmazonAsin();
        if (asin) {
          panel.setMarket('amazon');
          panel.probe(asin || ean, 'amazon');
        } else {
          panel.probe(ean);
        }
      } else {
        const asin = getAmazonAsin();
        panel.setMarket('amazon');
        panel.setIdentifier(asin || ean, 'amazon');
      }
      // Auto-fill EK from page price
      setTimeout(() => {
        const price = detectAmazonPrice();
        if (price && price > 0) panel.autofillEk(price);
      }, 600);
      return;
    }

    if (attempt === 0) {
      panel.setState('no-ean');
      setTimeout(() => tryExtract(autoPanel, 1), 2000); // Amazon loads details lazily
    } else if (attempt === 1) {
      setTimeout(() => tryExtract(autoPanel, 2), 4000);
    }
    // attempt 2: stay no-ean
  }

  // ── Amazon price detection ─────────────────────────────────────────────────
  function detectAmazonPrice() {
    for (const sel of [
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '#apex_desktop .a-price .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#price_inside_buybox',
      '#newBuyBoxPrice',
      '.a-price[data-a-color="price"] .a-offscreen',
      '.priceToPay .a-offscreen',
    ]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const price = parseEuroText(el.textContent);
      if (price && price > 0) return price;
    }
    // data-asin-price attribute
    const asinEl = document.querySelector('[data-asin-price]');
    if (asinEl) {
      const p = parseFloat(asinEl.dataset.asinPrice);
      if (p > 0) return p;
    }
    return null;
  }

  function parseEuroText(text) {
    const s = String(text || '').replace(/\s/g, '');
    const g = s.match(/(\d{1,3}(?:\.\d{3})*),(\d{2})/);
    if (g) return parseFloat(g[0].replace(/\./g, '').replace(',', '.'));
    const d = s.match(/(\d+)\.(\d{1,2})(?!\d)/);
    if (d) return parseFloat(d[0]);
    return null;
  }

  // ── Manual EAN scan (panel button) ────────────────────────────────────────
  panel.addEventListener('fc-manual-ean', () => {
    const asin = getAmazonAsin();
    const ean  = extractEanAmazon();
    if ((asin || ean) && typeof panel.probe === 'function') {
      panel.setMarket('amazon');
      panel.probe(asin || ean, 'amazon');
    }
  });

  // ── SPA navigation ──────────────────────────────────────────────────────────
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(() => {
        const newEan = extractEanAmazon();
        if (newEan && newEan !== panel.currentEan && typeof panel.probe === 'function') {
          const newAsin = getAmazonAsin();
          if (newAsin) {
            panel.setMarket('amazon');
            panel.probe(newAsin || newEan, 'amazon');
          } else {
            panel.probe(newEan);
          }
          setTimeout(() => {
            const price = detectAmazonPrice();
            if (price && price > 0) panel.autofillEk(price);
          }, 600);
        }
      }, 1200);
    }
  }).observe(document, { subtree: true, childList: true });
})();
