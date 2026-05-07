/* Flipcheck Extension — Amazon.de Product Page (/dp/) Content Script */

(function () {
  if (document.getElementById('__fc_panel')) return;
  console.log('[FC boot] amazon-product.js');

  function getAmazonAsin() {
    // From URL: /dp/B0XXXXXXXXX/  or /gp/product/B0XXXXXXXXX
    const m = location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  }

  const panel = document.createElement('flipcheck-panel');
  panel.id = '__fc_panel';
  // Pre-set inline position so panel is visible even before shadow-DOM CSS applies.
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
  panel.dataset.market = 'amazon';
  document.documentElement.appendChild(panel);
  // v7: Panel floats — no body-margin push needed.
  try {
    document.body.style.removeProperty('margin-right');
    document.body.style.removeProperty('margin-left');
    document.body.style.removeProperty('padding-bottom');
  } catch (_) {}

  // ── Context-menu EAN probe ─────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'CONTEXT_EAN_PROBE' && msg.ean && typeof panel.probe === 'function') {
      panel.probe(msg.ean, 'amazon');
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

  // ── Auto-detect Amazon category from breadcrumbs ───────────────────────────
  function detectAmazonCategory() {
    // Primary: breadcrumb navigation
    const bcEl = document.querySelector('#wayfinding-breadcrumbs_feature_div');
    const bcText = (bcEl?.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
    // Secondary: product category from detail table
    const detailRows = document.querySelectorAll('#detailBullets_feature_div li, #productDetails_detailBullets_sections1 tr');
    let catText = bcText;
    detailRows.forEach(row => {
      const t = (row.textContent || '').toLowerCase();
      if (t.includes('kategorie') || t.includes('abteilung')) catText += ' ' + t;
    });
    if (!catText) return null;
    if (typeof AMAZON_CATEGORY_MAP !== 'undefined') {
      for (const entry of AMAZON_CATEGORY_MAP) {
        if (entry.keywords.some(kw => catText.includes(kw))) return entry.cat;
      }
    }
    return null;
  }

  // ── Load settings, then extract identifier with retry ──────────────────────
  chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }, res => {
    const s         = res?.data || {};
    const autoPanel = s.autoPanel !== false; // default: true
    tryExtract(autoPanel, 0);
  });

  // ── Extraction with up to 3 attempts ──────────────────────────────────────
  // On Amazon: ASIN from URL is always the primary identifier.
  // EAN is a nice-to-have for cross-market lookup but not required.
  function tryExtract(autoPanel, attempt) {
    // Wait for panel to be initialised (custom element upgrade or manual init)
    if (typeof panel.probe !== 'function') {
      setTimeout(() => tryExtract(autoPanel, attempt), 150);
      return;
    }

    const asin = getAmazonAsin();
    const ean  = extractEanAmazon();
    // ASIN takes priority — it's the identifier for Amazon checks.
    // EAN is used as fallback (e.g. on /dp/ pages without an ASIN in path).
    const identifier = asin || ean;

    if (identifier) {
      if (autoPanel) {
        panel.probe(identifier, 'amazon');
      } else {
        panel.setIdentifier(identifier, 'amazon');
      }

      // Auto-detect category from page breadcrumbs
      const detectedCat = detectAmazonCategory();
      if (detectedCat && typeof panel.setAmzCategory === 'function') {
        panel.setAmzCategory(detectedCat);
      }

      if (asin) {
        if (ean) {
          // Both known from page — pre-populate crossId immediately.
          // eBay tab switch works without any ASIN_TO_EAN roundtrip.
          if (typeof panel.setCrossId === 'function') panel.setCrossId(ean);
        } else {
          // No EAN on page — ask background to resolve via Keepa in background.
          // Result is stored as crossId so eBay tab switch works later.
          chrome.runtime.sendMessage({ type: 'ASIN_TO_EAN', asin }, res => {
            if (res?.ok && res.ean && typeof panel.setCrossId === 'function') {
              panel.setCrossId(res.ean);
            }
          });
        }
      }

      // Auto-fill EK from page price
      setTimeout(() => {
        const price = detectAmazonPrice();
        if (price && price > 0) panel.autofillEk(price);
      }, 600);
      return;
    }

    // Neither ASIN nor EAN found yet — retry (Amazon loads details lazily)
    if (attempt < 2) {
      panel.setState('no-ean');
      setTimeout(() => tryExtract(autoPanel, attempt + 1), attempt === 0 ? 2000 : 4000);
    }
    // attempt 2: stay no-ean
  }

  // ── Amazon price detection ─────────────────────────────────────────────────
  // IMPORTANT selector ordering:
  //   Amazon uses data-a-color="price"    → current/active price  ✓
  //             data-a-color="secondary"  → strikethrough/was-price  ✗
  // Generic ".a-price .a-offscreen" matches the FIRST element, which is often
  // the strikethrough price. Always prefer explicit [data-a-color="price"] or
  // the specific ".priceToPay" buybox container.
  function detectAmazonPrice() {
    for (const sel of [
      // 1. priceToPay = the "you pay" amount in the buybox — most reliable
      '.priceToPay .a-offscreen',
      '.reinventPricePriceToPayMargin .a-offscreen',
      // 2. Explicit color="price" = current price (not strikethrough)
      '#corePriceDisplay_desktop_feature_div .a-price[data-a-color="price"] .a-offscreen',
      '#apex_desktop .a-price[data-a-color="price"] .a-offscreen',
      '#corePrice_desktop .a-price[data-a-color="price"] .a-offscreen',
      // 3. Legacy IDs that always hold the current price
      '#priceblock_dealprice',
      '#priceblock_ourprice',
      '#price_inside_buybox',
      '#newBuyBoxPrice',
      // 4. Last resort: any price-coloured offscreen label on the page
      '.a-price[data-a-color="price"] .a-offscreen',
    ]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const price = parseEuroText(el.textContent);
      if (price && price > 0) return price;
    }
    // data-asin-price attribute (some seller pages)
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

  // ── Manual EAN scan (panel 🔍 button) ─────────────────────────────────────
  panel.addEventListener('fc-manual-ean', () => {
    const asin = getAmazonAsin();
    const ean  = extractEanAmazon();
    const identifier = asin || ean;
    if (identifier && typeof panel.probe === 'function') {
      panel.probe(identifier, 'amazon');
    }
  });

  // ── SPA navigation ──────────────────────────────────────────────────────────
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href === _lastUrl) return;
    _lastUrl = location.href;
    setTimeout(() => {
      if (typeof panel.probe !== 'function') return;
      const newAsin = getAmazonAsin();
      const newEan  = extractEanAmazon();
      const newId   = newAsin || newEan;
      // Re-probe if identifier changed (new product page)
      if (newId && newId !== panel.currentEan) {
        panel.probe(newId, 'amazon');
        // Auto-detect category for new product
        const newCat = detectAmazonCategory();
        if (newCat && typeof panel.setAmzCategory === 'function') panel.setAmzCategory(newCat);
        // Pre-populate EAN crossId for the new product
        if (newAsin) {
          if (newEan) {
            if (typeof panel.setCrossId === 'function') panel.setCrossId(newEan);
          } else {
            chrome.runtime.sendMessage({ type: 'ASIN_TO_EAN', asin: newAsin }, res => {
              if (res?.ok && res.ean && typeof panel.setCrossId === 'function') panel.setCrossId(res.ean);
            });
          }
        }
        setTimeout(() => {
          const price = detectAmazonPrice();
          if (price && price > 0) panel.autofillEk(price);
        }, 600);
      }
    }, 1200);
  }).observe(document, { subtree: true, childList: true });
})();
