/* Flipcheck Extension — eBay Sell/List Page Content Script
 * Activated on: ebay.de/sl/sell, /sl/list, /lstng/, /sl/create
 *
 * Monitors the eBay listing form for title, EAN/GTIN, and price fields.
 * Opens the Flipcheck panel sidebar with live market data, price recommendations,
 * and profit calculation — helping sellers set optimal prices while listing.
 *
 * Architecture: reuses the shared <flipcheck-panel> component.
 * Extraction: watches form mutations (eBay's sell flow is an SPA).
 */

(function () {
  if (document.getElementById('__fc_panel')) return;
  console.log('[FC boot] ebay-sell.js');

  // ── Create Panel ──────────────────────────────────────────────────────────
  const panel = document.createElement('flipcheck-panel');
  panel.id = '__fc_panel';
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

  // ── Push page content so sidebar doesn't overlap ──────────────────────────
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

  // ── Context-menu & Toggle ─────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'CONTEXT_EAN_PROBE' && msg.ean && typeof panel.probe === 'function') {
      panel.probe(msg.ean);
    }
    if (msg.type === 'TOGGLE_PANEL') {
      panel.hasAttribute('data-minimized')
        ? panel.removeAttribute('data-minimized')
        : panel.setAttribute('data-minimized', '');
    }
  });

  // ── Alt+F keyboard shortcut ───────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.altKey && e.key.toLowerCase() === 'f') {
      panel.hasAttribute('data-minimized')
        ? panel.removeAttribute('data-minimized')
        : panel.setAttribute('data-minimized', '');
    }
  });

  // ── State tracking ────────────────────────────────────────────────────────
  let _lastEan   = null;
  let _lastTitle  = null;
  let _lastPrice  = null;
  let _scanning   = false;

  // ── Sell-form field selectors (eBay's SPA uses various layouts) ───────────
  // These cover the 2024-2026 eBay.de listing flow (React-based).
  const TITLE_SELS = [
    'input[name="title"]',
    '#s0-1-1-24-7-textbox',                    // legacy numeric ID
    'textarea[aria-label*="Titel"]',
    'textarea[aria-label*="Title"]',
    'input[placeholder*="Titel"]',
    'input[placeholder*="Title"]',
    '[data-testid="title"] input',
    '[data-testid="title"] textarea',
    '.title-input input',
    '.title-input textarea',
    '#editpane_title input',
  ];

  const EAN_SELS = [
    'input[name="ean"]',
    'input[name="gtin"]',
    'input[aria-label*="EAN"]',
    'input[aria-label*="GTIN"]',
    'input[aria-label*="UPC"]',
    'input[placeholder*="EAN"]',
    'input[placeholder*="GTIN"]',
    'input[placeholder*="UPC"]',
    '[data-testid="ean"] input',
    '[data-testid="gtin"] input',
    // eBay Sell Flow: the specifics panel uses label + input pairs
    // We look for the input next to a label containing EAN/GTIN
  ];

  const PRICE_SELS = [
    'input[name="price"]',
    'input[aria-label*="Preis"]',
    'input[aria-label*="Price"]',
    'input[placeholder*="EUR"]',
    '[data-testid="price"] input',
    '[data-testid="binPrice"] input',
    '#editpane_price input',
    '.price-input input',
  ];

  // ── Field finders ─────────────────────────────────────────────────────────
  function _findField(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /**
   * EAN can also live in the "Item Specifics" section as label-value pairs.
   * eBay renders these as rows: <label>EAN</label><input value="...">
   */
  function _findEanFromSpecifics() {
    // Strategy 1: label elements with "for" attribute
    for (const label of document.querySelectorAll('label')) {
      const txt = label.textContent.trim();
      if (/^(EAN|GTIN|UPC|ISBN|Barcode|MPN)$/i.test(txt)) {
        // Find associated input
        const forId = label.getAttribute('for');
        if (forId) {
          const inp = document.getElementById(forId);
          if (inp?.value) return inp.value.trim();
        }
        // Try next sibling / parent row
        const row = label.closest('div, tr, li, section');
        if (row) {
          const inp = row.querySelector('input');
          if (inp?.value) return inp.value.trim();
        }
      }
    }

    // Strategy 2: data-field or aria-label attributes
    for (const inp of document.querySelectorAll('input[data-field*="ean" i], input[data-field*="gtin" i]')) {
      if (inp.value) return inp.value.trim();
    }

    // Strategy 3: spans or divs showing a read-only EAN/GTIN value
    for (const el of document.querySelectorAll('span, div')) {
      const prev = el.previousElementSibling;
      if (prev && /^(EAN|GTIN)$/i.test(prev.textContent.trim())) {
        const v = el.textContent.trim().replace(/\s/g, '');
        if (typeof isValidEan === 'function' && isValidEan(v)) return v;
        if (/^\d{8,14}$/.test(v)) return v;
      }
    }

    return null;
  }

  // ── Title → EAN resolution (via background API) ───────────────────────────
  let _titleSearchDebounce = null;

  function _probeWithTitle(title) {
    if (!title || title.length < 5 || typeof panel.probe !== 'function') return;
    // Check if title contains something EAN-like
    const eanMatch = title.match(/\b(\d{8,14})\b/);
    if (eanMatch && typeof isValidEan === 'function' && isValidEan(eanMatch[1])) {
      panel.probe(eanMatch[1]);
      _lastEan = eanMatch[1];
      return;
    }
    // Use the title as search term — the panel supports text queries
    panel.probe(title);
  }

  // ── Main scan: extract EAN, title, price from the sell form ───────────────
  function scanSellForm() {
    if (_scanning || typeof panel.probe !== 'function') return;
    _scanning = true;

    try {
      // 1) Try to find EAN directly
      let ean = null;
      const eanInp = _findField(EAN_SELS);
      if (eanInp?.value) {
        const v = eanInp.value.trim().replace(/\s/g, '');
        if (typeof isValidEan === 'function' ? isValidEan(v) : /^\d{8,14}$/.test(v)) {
          ean = v;
        }
      }

      // Also check specifics section
      if (!ean) {
        const specEan = _findEanFromSpecifics();
        if (specEan && (typeof isValidEan === 'function' ? isValidEan(specEan) : /^\d{8,14}$/.test(specEan))) {
          ean = specEan;
        }
      }

      // 2) Get title
      const titleInp = _findField(TITLE_SELS);
      const title = titleInp?.value?.trim() || '';

      // 3) Get price (to auto-fill as VK in panel for profit calc — NOT as EK)
      const priceInp = _findField(PRICE_SELS);
      const priceVal = priceInp?.value ? parseFloat(priceInp.value.replace(',', '.')) : null;

      // ── Decide what to do ─────────────────────────────────────────────────
      if (ean && ean !== _lastEan) {
        _lastEan = ean;
        _lastTitle = title;
        panel.probe(ean);
      } else if (!ean && title && title !== _lastTitle && title.length >= 8) {
        _lastTitle = title;
        // Debounce title-based search (user still typing)
        clearTimeout(_titleSearchDebounce);
        _titleSearchDebounce = setTimeout(() => _probeWithTitle(title), 1200);
      }

      // ── Sync price to panel's VK suggestion display ──────────────────────
      if (priceVal && priceVal > 0 && priceVal !== _lastPrice) {
        _lastPrice = priceVal;
        // Auto-fill the panel's EK field with the sell price so user sees their fees
        // Actually — on a sell page the price IS the VK, not EK.
        // We don't auto-fill EK here; the panel will show market data.
        // But we can dispatch a custom event to let the panel know the user's asking price.
      }
    } finally {
      _scanning = false;
    }
  }

  // ── Wire up: listen for input changes + MutationObserver for SPA ──────────
  function wireInputListeners() {
    // Wire existing fields
    for (const sel of [...TITLE_SELS, ...EAN_SELS, ...PRICE_SELS]) {
      const el = document.querySelector(sel);
      if (el && !el._fcWired) {
        el._fcWired = true;
        el.addEventListener('input', () => scanSellForm());
        el.addEventListener('change', () => scanSellForm());
        el.addEventListener('blur', () => scanSellForm());
      }
    }
  }

  // ── SPA observer: eBay sell flow changes DOM heavily between steps ─────────
  let _wireDebounce = null;
  const observer = new MutationObserver(() => {
    clearTimeout(_wireDebounce);
    _wireDebounce = setTimeout(() => {
      wireInputListeners();
      scanSellForm();
    }, 500);
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }, res => {
    const s = res?.data || {};
    const autoPanel = s.autoPanel !== false;

    // Wait for panel custom element to be defined
    function _initWhenReady(attempt) {
      if (typeof panel.probe !== 'function') {
        if (attempt < 20) setTimeout(() => _initWhenReady(attempt + 1), 200);
        return;
      }

      if (autoPanel) {
        wireInputListeners();
        scanSellForm();
      } else {
        panel.setState('idle');
      }

      // Start observing for SPA changes
      observer.observe(document.body || document.documentElement, {
        childList: true, subtree: true
      });

      // Also run a periodic scan for fields that load late
      let _scans = 0;
      const _timer = setInterval(() => {
        wireInputListeners();
        scanSellForm();
        _scans++;
        if (_scans >= 15) clearInterval(_timer); // stop after ~15s
      }, 1000);
    }

    // Wait for body before starting
    if (document.body) {
      _initWhenReady(0);
    } else {
      document.addEventListener('DOMContentLoaded', () => _initWhenReady(0));
    }
  });

  // ── Listen for panel manual scan request ──────────────────────────────────
  panel.addEventListener('fc-manual-ean', () => {
    _lastEan = null;
    _lastTitle = null;
    scanSellForm();
  });

  // ── SPA navigation detection ──────────────────────────────────────────────
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      _lastEan = null;
      _lastTitle = null;
      _lastPrice = null;
      setTimeout(() => {
        wireInputListeners();
        scanSellForm();
      }, 1000);
    }
  }).observe(document, { subtree: true, childList: true });
})();
