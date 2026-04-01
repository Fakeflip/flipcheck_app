/* Flipcheck Extension — StockX & GOAT Product Page Content Script
 * Extracts sneaker SKU from StockX and GOAT product pages.
 * Autofills EK (retail price) and probes panel with market="sneaker".
 */

(function () {
  if (document.getElementById('__fc_panel')) return;

  const panel = document.createElement('flipcheck-panel');
  panel.id = '__fc_panel';
  panel.style.setProperty('position', 'fixed',       'important');
  panel.style.setProperty('display',  'block',        'important');
  panel.style.setProperty('z-index',  '2147483647',  'important');
  panel.style.setProperty('top',      '0',            'important');
  panel.style.setProperty('right',    '0',            'important');
  panel.style.setProperty('bottom',   'auto',         'important');
  panel.style.setProperty('height',   '100vh',        'important');
  panel.style.setProperty('width',    'auto',         'important');
  document.documentElement.appendChild(panel);

  (function () {
    function _syncBodyMargin(w, pos) {
      document.body.style.removeProperty('margin-right');
      document.body.style.removeProperty('margin-left');
      document.body.style.removeProperty('padding-bottom');
      if (pos === 'left')        document.body.style.setProperty('margin-left',    w + 'px', 'important');
      else if (pos === 'bottom') document.body.style.setProperty('padding-bottom', '320px',  'important');
      else                       document.body.style.setProperty('margin-right',   w + 'px', 'important');
    }
    try {
      chrome.storage.local.get('fc_position', r => {
        _syncBodyMargin(380, r?.fc_position || 'right');
      });
    } catch (_) { _syncBodyMargin(380, 'right'); }
    panel.addEventListener('fc-width-change', e => _syncBodyMargin(e.detail.w, e.detail.pos));
    panel.addEventListener('fc-close', () => {
      document.body.style.removeProperty('margin-right');
      document.body.style.removeProperty('margin-left');
      document.body.style.removeProperty('padding-bottom');
    });
  })();

  document.addEventListener('keydown', e => {
    if (e.altKey && e.key.toLowerCase() === 'f') {
      panel.hasAttribute('data-minimized')
        ? panel.removeAttribute('data-minimized')
        : panel.setAttribute('data-minimized', '');
    }
  });

  init();

  function init() {
    if (typeof panel.probe !== 'function') {
      setTimeout(init, 150);
      return;
    }
    const sku = extractSku();
    if (sku) {
      panel.probe(sku, 'sneaker');
      autofillPrice();
    } else {
      panel.setState('no-ean');
      setTimeout(() => {
        const retry = extractSku();
        if (retry) { panel.probe(retry, 'sneaker'); autofillPrice(); }
      }, 2000);
      setTimeout(() => {
        if (panel.currentEan) return;
        const retry = extractSku();
        if (retry) { panel.probe(retry, 'sneaker'); autofillPrice(); }
      }, 5000);
    }
  }

  panel.addEventListener('fc-manual-ean', () => {
    const sku = extractSku();
    if (sku && typeof panel.probe === 'function') panel.probe(sku, 'sneaker');
  });

  // SPA navigation watcher (StockX is a SPA)
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(() => {
        const sku = extractSku();
        if (sku && sku !== panel.currentEan && typeof panel.probe === 'function') {
          panel.probe(sku, 'sneaker');
          autofillPrice();
        }
      }, 1500);
    }
  }).observe(document, { subtree: true, childList: true });

  // ── SKU Extraction ─────────────────────────────────────────────────────────

  function extractSku() {
    const host = location.hostname;

    // StockX
    if (host.includes('stockx.com')) {
      return extractSkuStockX();
    }
    // GOAT
    if (host.includes('goat.com')) {
      return extractSkuGoat();
    }
    return null;
  }

  function extractSkuStockX() {
    // StockX shows Style/SKU in product details
    // Look for JSON-LD structured data first
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        const json = JSON.parse(s.textContent);
        if (json.sku) return json.sku;
        if (json['@graph']) {
          for (const item of json['@graph']) {
            if (item.sku) return item.sku;
          }
        }
      }
    } catch (_) {}

    // Look for SKU in product detail rows
    const allText = document.body?.innerText || '';
    // Pattern: "Style FV5029-500" or "Modellnr. FV5029-500"
    const m = allText.match(/(?:Style|Modellnr\.|Artikelnr\.|SKU)[:\s]+([A-Z0-9][\w-]{4,})/i);
    if (m) return m[1].toUpperCase();

    // Fallback: extract from URL slug (e.g. /de-de/nike-dunk-low-retro-white-black-dd1391-100)
    const path = location.pathname;
    const urlSku = path.match(/([a-z0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*)$/i);
    if (urlSku) {
      // Try to find a SKU-like pattern at the end (e.g. dd1391-100)
      const skuMatch = urlSku[1].match(/([a-z]{1,3}\d{3,}[-]\d{2,})/i);
      if (skuMatch) return skuMatch[1].toUpperCase();
    }

    return null;
  }

  function extractSkuGoat() {
    // GOAT has structured data
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        const json = JSON.parse(s.textContent);
        if (json.sku) return json.sku;
        if (json.offers?.sku) return json.offers.sku;
      }
    } catch (_) {}

    // Look in page content
    const allText = document.body?.innerText || '';
    const m = allText.match(/(?:Style|SKU)[:\s]+([A-Z0-9][\w-]{4,})/i);
    if (m) return m[1].toUpperCase();

    // GOAT URL: /sneakers/nike-dunk-low-retro-white-black-dd1391-100
    const path = location.pathname;
    if (path.includes('/sneakers/')) {
      const slug = path.split('/sneakers/')[1]?.split('/')[0] || '';
      const skuMatch = slug.match(/([a-z]{1,3}\d{3,}[-]\d{2,})/i);
      if (skuMatch) return skuMatch[1].toUpperCase();
    }

    return null;
  }

  // ── Price Autofill ─────────────────────────────────────────────────────────

  function autofillPrice() {
    setTimeout(() => {
      if (typeof detectPagePrice === 'function') return; // generic handler exists
      const price = findPrice();
      if (price > 0 && typeof panel.autofillEk === 'function') {
        panel.autofillEk(price);
      }
    }, 500);
  }

  function findPrice() {
    const host = location.hostname;
    if (host.includes('stockx.com')) {
      // StockX: "ab XXX €" or "Lowest Ask: €XXX"
      const priceEls = document.querySelectorAll('[data-testid="product-price"], [class*="price"]');
      for (const el of priceEls) {
        const m = el.textContent.match(/(\d[\d.,]+)\s*[€$]/);
        if (m) return parseFloat(m[1].replace(',', '.'));
        const m2 = el.textContent.match(/[€$]\s*(\d[\d.,]+)/);
        if (m2) return parseFloat(m2[1].replace(',', '.'));
      }
    }
    if (host.includes('goat.com')) {
      const priceEls = document.querySelectorAll('[class*="price"], [class*="Price"]');
      for (const el of priceEls) {
        const m = el.textContent.match(/(\d[\d.,]+)\s*[€$]/);
        if (m) return parseFloat(m[1].replace(',', '.'));
        const m2 = el.textContent.match(/[€$]\s*(\d[\d.,]+)/);
        if (m2) return parseFloat(m2[1].replace(',', '.'));
      }
    }
    return 0;
  }
})();
