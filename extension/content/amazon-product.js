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
  // Pre-set inline position so panel is visible even before shadow-DOM CSS applies.
  panel.style.setProperty('position', 'fixed',       'important');
  panel.style.setProperty('display',  'block',        'important');
  panel.style.setProperty('z-index',  '2147483647',  'important');
  panel.style.setProperty('top',      '0',            'important');
  panel.style.setProperty('right',    '0',            'important');
  panel.style.setProperty('bottom',   'auto',         'important');
  panel.style.setProperty('height',   '100vh',        'important');
  panel.style.setProperty('width',    'auto',         'important');
  panel.dataset.market = 'amazon';
  document.documentElement.appendChild(panel);
  // Push page content so sidebar doesn't overlap
  (function () {
    function _syncBodyMargin(w, pos) {
      document.body.style.removeProperty('margin-right');
      document.body.style.removeProperty('margin-left');
      document.body.style.removeProperty('padding-bottom');
      if (pos === 'left')        document.body.style.setProperty('margin-left',    w + 'px', 'important');
      else if (pos === 'bottom') document.body.style.setProperty('padding-bottom', '320px',  'important');
      else                       document.body.style.setProperty('margin-right',   w + 'px', 'important');
    }
    // Default: right-docked at 380px
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
    // Re-apply margin if SPA navigation resets body styles
    let _fcMg = false;
    new MutationObserver(() => {
      if (_fcMg || !document.body) return;
      const pos = panel._position || 'right';
      const ok  = (pos === 'left'   && document.body.style.marginLeft)   ||
                  (pos === 'bottom' && document.body.style.paddingBottom) ||
                  (pos !== 'left' && pos !== 'bottom' && document.body.style.marginRight);
      if (!ok) {
        _fcMg = true;
        try {
          chrome.storage.local.get('fc_position', r => {
            _syncBodyMargin(panel.offsetWidth || 380, r?.fc_position || 'right');
            setTimeout(() => { _fcMg = false; }, 300);
          });
        } catch (_) { _fcMg = false; }
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['style'] });
  })();

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
