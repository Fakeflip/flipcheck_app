/* Flipcheck Extension — EAN Extraction Utilities v2
 * Covers: eBay, Amazon, Kaufland, Otto, Saturn, MediaMarkt, Conrad, Alternate,
 *         Notebooksbilliger, Cyberport, Idealo, Thalia, Hugendubel, DM, Rossmann,
 *         Zalando, AboutYou, Decathlon, Bauhaus, Hornbach, Tchibo, Rewe, Penny,
 *         Lidl (enhanced), and generic fallback for any shop.
 */

// ── Validation ────────────────────────────────────────────────────────────────

function isValidEan(s) {
  return /^\d{8,14}$/.test(String(s || '').trim());
}

// ── Shared Helpers ────────────────────────────────────────────────────────────

/** Try to extract EAN/GTIN from a parsed JSON-LD object (handles @graph and top-level arrays). */
function _eanFromJsonLd(d) {
  // Handle top-level arrays (e.g. Alternate.de uses [{Product},{BreadcrumbList}])
  if (Array.isArray(d)) {
    for (const item of d) { const r = _eanFromJsonLd(item); if (r) return r; }
    return null;
  }
  const items = d?.['@graph'] ? d['@graph'] : [d];
  for (const item of items) {
    for (const k of ['gtin13', 'gtin8', 'gtin', 'ean', 'isbn']) {
      const v = item?.[k];
      if (v && isValidEan(String(v))) return String(v).trim();
    }
  }
  return null;
}

/** Parse all JSON-LD script tags on the page and return first valid EAN. */
function _scanJsonLd() {
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const ean = _eanFromJsonLd(JSON.parse(el.textContent));
      if (ean) return ean;
    } catch {}
  }
  return null;
}

/** Parse a JSON data layer script by selector and recurse for ean/gtin. */
function _deepSearchEan(obj, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return null;
  for (const k of ['gtin13', 'gtin8', 'gtin', 'ean', 'isbn', 'barcode']) {
    if (obj[k] && isValidEan(String(obj[k]))) return String(obj[k]);
  }
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      for (const el of v) {
        const r = _deepSearchEan(el, depth + 1);
        if (r) return r;
      }
    } else if (v && typeof v === 'object') {
      const r = _deepSearchEan(v, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/** Try to parse a global JS variable from a <script> tag containing that variable. */
function _parseScriptVar(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  try { return JSON.parse(el.textContent); } catch { return null; }
}

/** Search itemprop attributes. */
function _itemPropEan() {
  for (const sel of [
    '[itemprop="gtin13"]', '[itemprop="gtin8"]',
    '[itemprop="gtin"]', '[itemprop="isbn"]',
  ]) {
    const el = document.querySelector(sel);
    if (el) {
      const v = (el.getAttribute('content') || el.value || el.textContent || '').replace(/\s/g, '');
      if (isValidEan(v)) return v;
    }
  }
  return null;
}

/** Search meta tags for EAN/GTIN. */
function _metaEan() {
  for (const sel of [
    'meta[property="product:ean"]', 'meta[name="ean"]',
    'meta[property="og:ean"]', 'meta[name="gtin"]',
    'meta[name="gtin13"]', 'meta[property="product:gtin"]',
    'meta[name="isbn"]', 'meta[property="og:isbn"]',
    'meta[itemprop="gtin13"]',
  ]) {
    const el = document.querySelector(sel);
    const v  = el?.content?.trim();
    if (v && isValidEan(v)) return v;
  }
  return null;
}

/** Search data attributes on product elements. */
function _dataAttrEan() {
  for (const el of document.querySelectorAll('[data-ean],[data-gtin],[data-barcode],[data-gtin13]')) {
    const v = (el.dataset.ean || el.dataset.gtin || el.dataset.gtin13 || el.dataset.barcode || '').trim();
    if (isValidEan(v)) return v;
  }
  return null;
}

/** Table-row scanner: finds rows where th/label matches pattern and td has EAN. */
function _tableEan(tableSelector, labelPattern = /EAN|GTIN|Barcode|ISBN/i) {
  for (const row of document.querySelectorAll(tableSelector)) {
    const cells = row.querySelectorAll('td, th, dd, dt');
    for (let i = 0; i < cells.length - 1; i++) {
      if (labelPattern.test(cells[i].textContent)) {
        const v = cells[i + 1]?.textContent.trim().replace(/\s/g, '');
        if (isValidEan(v)) return v;
      }
    }
  }
  return null;
}

/** Scan ALL inline <script> tags for EAN/GTIN patterns.
 *  Most reliable for modern React/Next.js shops that embed product data in JS. */
function _scanInlineScripts() {
  const RE = /"(?:gtin13|gtin8|gtin|ean|EAN|barcode)"\s*:\s*"(\d{8,14})"/g;
  for (const script of document.querySelectorAll('script:not([src])')) {
    const text = script.textContent;
    if (!text || text.length > 600000) continue; // skip massive bundles
    let m;
    while ((m = RE.exec(text)) !== null) {
      if (isValidEan(m[1])) return m[1];
    }
    RE.lastIndex = 0; // reset for next script tag
  }
  return null;
}

/** Text-match within an element's text content. */
function _textMatchEan(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const m = el.textContent.match(/(?:EAN|GTIN|Barcode|ISBN)[:\s]+([\d\-]{8,17})/i);
  if (m) {
    const v = m[1].replace(/\D/g, '');
    if (isValidEan(v)) return v;
  }
  return null;
}

// ── eBay Product Page (/itm/) ─────────────────────────────────────────────────

function extractEanEbayProduct() {
  // 1) JSON-LD (fastest, most reliable when present)
  const ld = _scanJsonLd();
  if (ld) return ld;

  // 2) Item-Specifics table — current eBay.de layout (2024-2026)
  //    Labels live inside .ux-labels-values with a BOLD span
  for (const section of document.querySelectorAll('.ux-labels-values')) {
    const labelEls = section.querySelectorAll('.ux-labels-values__labels span, .ux-textspans--BOLD');
    for (const lbl of labelEls) {
      if (/^(EAN|GTIN|UPC|ISBN|Barcode)$/i.test(lbl.textContent.trim())) {
        const valEl = section.querySelector('.ux-labels-values__values span, .ux-labels-values__values-content');
        const val   = (valEl?.textContent || '').replace(/\s/g, '');
        if (isValidEan(val)) return val;
      }
    }
  }

  // 3) itemprop on page
  const ip = _itemPropEan();
  if (ip) return ip;

  // 4) data attributes
  const da = _dataAttrEan();
  if (da) return da;

  // 5) Scan eBay inline JS (window.__reduxStore__, utpCriticalData, etc.)
  const inl = _scanInlineScripts();
  if (inl) return inl;

  // 6) Walk all <dd> / <li> elements near "EAN" text
  for (const el of document.querySelectorAll('dl dd, ul li, td')) {
    if (/EAN|GTIN/i.test(el.previousElementSibling?.textContent || '')) {
      const v = el.textContent.trim().replace(/\s/g, '');
      if (isValidEan(v)) return v;
    }
  }

  return null;
}

// ── eBay SERP Card ────────────────────────────────────────────────────────────

function extractEanFromSerpCard(card) {
  const gtin = card.querySelector('[data-gtin],[itemprop="gtin13"],[itemprop="gtin8"]');
  if (gtin) {
    const v = (gtin.dataset.gtin || gtin.getAttribute('content') || gtin.textContent).replace(/\s/g, '');
    if (isValidEan(v)) return v;
  }
  try {
    const ld = card.querySelector('script[type="application/ld+json"]');
    if (ld) {
      const ean = _eanFromJsonLd(JSON.parse(ld.textContent));
      if (ean) return ean;
    }
  } catch {}
  return null;
}

// ── Amazon.de (/dp/) ──────────────────────────────────────────────────────────

function extractEanAmazon() {
  // 1) Technical Details tables — Amazon uses multiple section IDs depending on product/locale
  //    Labels may be "EAN", "GTIN", or "Global Trade Identification Number" (English Amazon.de)
  const AMAZON_EAN_RE = /EAN|GTIN|Global Trade Identification/i;
  for (const row of document.querySelectorAll(
      '#productDetails_techSpec_section_1 tr, ' +
      '#productDetails_techSpec_section_2 tr, ' +
      '#productDetails_detailBullets_sections1 tr, ' +
      '#productDetails_feature_div tr, ' +
      '#prodDetails tr')) {
    const th = (row.querySelector('th') || row.cells?.[0])?.textContent || '';
    const td = (row.querySelector('td') || row.cells?.[1])?.textContent || '';
    if (AMAZON_EAN_RE.test(th)) {
      const v = td.trim().replace(/\s/g, '');
      if (isValidEan(v)) return v;
    }
  }

  // 2) Detail Bullets (Produktinformationen section)
  for (const li of document.querySelectorAll(
      '#detailBullets_feature_div li, #detail-bullets li, .detail-bullet-list li')) {
    const m = li.textContent.match(/(?:EAN|GTIN|Barcode)[:\s]+([\d\s]{8,16})/i);
    if (m) {
      const v = m[1].replace(/\s/g, '');
      if (isValidEan(v)) return v;
    }
  }

  // 3) JSON-LD
  const ld = _scanJsonLd();
  if (ld) return ld;

  // 4) Inline script scan (__NEXT_DATA__, Amazon's product data layer)
  const inl = _scanInlineScripts();
  if (inl) return inl;

  // 5) itemprop
  const ip = _itemPropEan();
  if (ip) return ip;

  // 6) Aplus content / additional product info sections
  for (const el of document.querySelectorAll(
      '#aplus li, #aplus td, #dpx-asin_feature_div td, .aplus-module td')) {
    if (/EAN|GTIN/i.test(el.previousElementSibling?.textContent || el.textContent)) {
      const v = el.textContent.trim().replace(/\s/g, '');
      if (isValidEan(v)) return v;
    }
  }

  return null;
}

// ── Kaufland.de ───────────────────────────────────────────────────────────────

function extractEanKaufland() {
  // 1) JSON-LD (fastest when present)
  const ld = _scanJsonLd(); if (ld) return ld;

  // 2) __NEXT_DATA__ — Kaufland is Next.js, product data is embedded here
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }

  // 3) Inline script scan (catches window.__KAUFLAND_DATA__, dataLayer, etc.)
  const inl = _scanInlineScripts(); if (inl) return inl;

  // 4) 2024+ PDP layout: .pdp-attribute-list__item with DT label "EAN"
  for (const item of document.querySelectorAll('.pdp-attribute-list__item')) {
    if (/^EAN$/i.test(item.querySelector('dt')?.textContent?.trim())) {
      const v = (item.querySelector('dd [data-test-item_text]')?.getAttribute('data-test-item_text')
               || item.querySelector('dd')?.textContent || '').replace(/\s/g, '');
      if (isValidEan(v)) return v;
    }
  }

  // 5) Generic DL/table scan (older layouts)
  const tbl = _tableEan('.product-details__info dl, .k-product-info dl, [class*="pdp"] dl');
  if (tbl) return tbl;

  // 6) data-* attributes, meta tags, text-match fallbacks
  return (
    _dataAttrEan() ||
    _metaEan() ||
    _textMatchEan('.product-details, .product-info, [class*="ProductDetails"], [class*="pdp"]')
  );
}

// ── Otto.de ───────────────────────────────────────────────────────────────────

function extractEanOtto() {
  const ld = _scanJsonLd(); if (ld) return ld;
  // Otto product data in __NEXT_DATA__
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  // Data layer
  const dl = _parseScriptVar('script[data-testid="trackingData"]');
  if (dl) { const r = _deepSearchEan(dl); if (r) return r; }
  return (
    _tableEan('.pdp-product-details__table tr') ||
    _tableEan('.product-data-table tr') ||
    _textMatchEan('.pdp-product-info, .product-details') ||
    _metaEan()
  );
}

// ── Saturn.de + MediaMarkt.de (same platform — MediaSaturn) ──────────────────

function extractEanSaturn() {
  // 1) JSON-LD
  const ld = _scanJsonLd(); if (ld) return ld;
  // 2) __NEXT_DATA__ (Saturn/MMS React app)
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  // 3) General inline script scan (catches window.__DATA__ and other patterns)
  const inl = _scanInlineScripts(); if (inl) return inl;
  // 4) DOM tables and meta
  return (
    _dataAttrEan() ||
    _tableEan('.product-details-page__specification tr, .sc-bdf5e3bc tr') ||
    _tableEan('[data-test="spec-table"] tr') ||
    _textMatchEan('.product-details-page__information, [data-test="productDetails"]') ||
    _metaEan()
  );
}

// Alias for MediaMarkt (same platform as Saturn)
const extractEanMediaMarkt = extractEanSaturn;

// ── Conrad.de ─────────────────────────────────────────────────────────────────

function extractEanConrad() {
  const ld = _scanJsonLd(); if (ld) return ld;
  return (
    _dataAttrEan() ||
    _tableEan('.product-attribute-table tr, .pdp-attributes tr') ||
    _tableEan('[class*="product-detail"] tr') ||
    _textMatchEan('.product-detail-info, .product-description') ||
    _metaEan()
  );
}

// ── Alternate.de ──────────────────────────────────────────────────────────────

function extractEanAlternate() {
  const ld = _scanJsonLd(); if (ld) return ld;
  // Alternate puts EAN in product info list
  for (const el of document.querySelectorAll('.productPropertiesContent li, .prod-info li')) {
    const m = el.textContent.match(/EAN[:\s]+([\d]{8,14})/i);
    if (m && isValidEan(m[1])) return m[1];
  }
  return (
    _dataAttrEan() ||
    _tableEan('#prod-info tr, .product-info-table tr') ||
    _metaEan()
  );
}

// ── Notebooksbilliger.de ──────────────────────────────────────────────────────

function extractEanNotebooksbilliger() {
  const ld = _scanJsonLd(); if (ld) return ld;
  return (
    _tableEan('.product-data-table tr, .tech-specs tr') ||
    _textMatchEan('.product-details-wrapper, .product-data') ||
    _dataAttrEan() ||
    _metaEan()
  );
}

// ── Cyberport.de ──────────────────────────────────────────────────────────────

function extractEanCyberport() {
  const ld = _scanJsonLd(); if (ld) return ld;
  for (const li of document.querySelectorAll('.product-details__attribute-list li, .tech-specs__row')) {
    const m = li.textContent.match(/EAN[:\s]+([\d]{8,14})/i);
    if (m && isValidEan(m[1])) return m[1];
  }
  return (
    _tableEan('.details-table tr') ||
    _metaEan()
  );
}

// ── Idealo.de (Preisvergleich) ────────────────────────────────────────────────

function extractEanIdealo() {
  const ld = _scanJsonLd(); if (ld) return ld;
  // Idealo embeds product EAN in meta tags and JSON-LD consistently
  return (
    _metaEan() ||
    _itemPropEan() ||
    _dataAttrEan() ||
    _textMatchEan('.product-details, .offer-details')
  );
}

// ── Thalia.de (Bücher — ISBN ist EAN-13) ─────────────────────────────────────

function extractEanThalia() {
  const ld = _scanJsonLd(); if (ld) return ld;
  // ISBN in product meta rows
  for (const el of document.querySelectorAll(
      '.product-meta__detail-row, .product-details__row, .product-info__row')) {
    const m = el.textContent.match(/(?:EAN|ISBN)[:\s]+([\d\-]{10,17})/i);
    if (m) {
      const v = m[1].replace(/\D/g, '');
      if (isValidEan(v)) return v;
    }
  }
  return _metaEan() || _itemPropEan();
}

// ── Hugendubel.de ────────────────────────────────────────────────────────────

function extractEanHugendubel() {
  const ld = _scanJsonLd(); if (ld) return ld;
  // ISBN is always embedded in Hugendubel product URLs: -9783551551672-produkt-details.html
  const urlM = location.href.match(/-(\d{13})-produkt-details/i);
  if (urlM && isValidEan(urlM[1])) return urlM[1];
  for (const el of document.querySelectorAll('.product-detail__attribute, .bibliographic-data tr, [class*="bibliograph"] td, [class*="product-info"] td')) {
    const m = el.textContent.match(/(?:EAN|ISBN)[:\s]+([\d\-]{10,17})/i);
    if (m) { const v = m[1].replace(/\D/g, ''); if (isValidEan(v)) return v; }
  }
  return _metaEan();
}

// ── DM.de ────────────────────────────────────────────────────────────────────

function extractEanDM() {
  const ld = _scanJsonLd(); if (ld) return ld;
  // DM embeds EAN in product URL: /produkt-name-p{EAN}.html
  const urlM = location.href.match(/-p(\d{8,14})\.html/i);
  if (urlM && isValidEan(urlM[1])) return urlM[1];
  // DOM fallback
  for (const el of document.querySelectorAll('.pdp-product-info__content td, .product-info-list li')) {
    const m = el.textContent.match(/EAN[:\s]+([\d]{8,14})/i);
    if (m && isValidEan(m[1])) return m[1];
  }
  return _metaEan() || _dataAttrEan();
}

// ── Rossmann.de ──────────────────────────────────────────────────────────────

function extractEanRossmann() {
  const ld = _scanJsonLd(); if (ld) return ld;
  // Rossmann embeds EAN in URL: /de/produktname/p/{EAN}
  const urlM = location.href.match(/\/p\/(\d{8,14})(?:[/?#]|$)/i);
  if (urlM && isValidEan(urlM[1])) return urlM[1];
  for (const el of document.querySelectorAll(
      '.rde-product-detail-tab td, .product-attributes-container dd')) {
    const m = el.textContent.match(/EAN[:\s]+([\d]{8,14})/i);
    if (m && isValidEan(m[1])) return m[1];
  }
  return _metaEan() || _itemPropEan();
}

// ── Zalando.de ───────────────────────────────────────────────────────────────

function extractEanZalando() {
  const ld = _scanJsonLd(); if (ld) return ld;
  // Zalando stores product data in a script tag with JSON
  const scripts = document.querySelectorAll('script[type="application/json"]');
  for (const s of scripts) {
    try {
      const data = JSON.parse(s.textContent);
      const r = _deepSearchEan(data);
      if (r) return r;
    } catch {}
  }
  // Also check __NEXT_DATA__
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  return _metaEan() || _itemPropEan();
}

// ── AboutYou.de ──────────────────────────────────────────────────────────────

function extractEanAboutYou() {
  const ld = _scanJsonLd(); if (ld) return ld;
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  // AboutYou state in window.__STATE__
  const scripts = document.querySelectorAll('script:not([src])');
  for (const s of scripts) {
    const m = s.textContent.match(/"gtin(?:13)?"\s*:\s*"(\d{8,14})"/);
    if (m && isValidEan(m[1])) return m[1];
  }
  return _metaEan();
}

// ── Decathlon.de ─────────────────────────────────────────────────────────────

function extractEanDecathlon() {
  const ld = _scanJsonLd(); if (ld) return ld;
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  return (
    _tableEan('.product-information__list dt, .product-information__list dd') ||
    _metaEan() ||
    _itemPropEan()
  );
}

// ── Bauhaus.de ───────────────────────────────────────────────────────────────

function extractEanBauhaus() {
  const ld = _scanJsonLd(); if (ld) return ld;
  return (
    _tableEan('.product-detail-info tr, .attribute-table tr') ||
    _textMatchEan('.product-information, .product-detail') ||
    _metaEan() ||
    _dataAttrEan()
  );
}

// ── Hornbach.de ──────────────────────────────────────────────────────────────

function extractEanHornbach() {
  const ld = _scanJsonLd(); if (ld) return ld;
  return (
    _tableEan('.product-attributes tr, .hb-product-attributes tr') ||
    _textMatchEan('.product-details-wrapper, [class*="ProductDetails"]') ||
    _metaEan() ||
    _dataAttrEan()
  );
}

// ── Tchibo.de ────────────────────────────────────────────────────────────────

function extractEanTchibo() {
  const ld = _scanJsonLd(); if (ld) return ld;
  for (const el of document.querySelectorAll('.product-variation-details li, .product-details li')) {
    const m = el.textContent.match(/EAN[:\s]+([\d]{8,14})/i);
    if (m && isValidEan(m[1])) return m[1];
  }
  return _metaEan() || _dataAttrEan();
}

// ── Rewe.de ──────────────────────────────────────────────────────────────────

function extractEanRewe() {
  const ld = _scanJsonLd(); if (ld) return ld;
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  return _metaEan() || _dataAttrEan();
}

// ── Penny.de ─────────────────────────────────────────────────────────────────

function extractEanPenny() {
  const ld = _scanJsonLd(); if (ld) return ld;
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  return _metaEan() || _dataAttrEan();
}

// ── Lidl.de (enhanced) ───────────────────────────────────────────────────────

function extractEanLidl() {
  // 1) JSON-LD / structured data (has EAN on some items)
  const ld = _scanJsonLd(); if (ld) return ld;
  // 2) __NEXT_DATA__
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  // 3) Lidl-specific product description list
  for (const el of document.querySelectorAll(
      '.s-product-description__list li, .product-detail-info li')) {
    const m = el.textContent.match(/EAN[:\s]+([\d]{8,14})/i);
    if (m && isValidEan(m[1])) return m[1];
  }
  const metaOrData = _metaEan() || _dataAttrEan();
  if (metaOrData) return metaOrData;

  // 4) Fallback: extract model code from title between »...« guillemets
  // Lidl titles look like: "PARKSIDE® »PBBPS 25 B2« Akku-Blasgerät" → returns "PBBPS 25 B2"
  for (const sel of ['h1', '[data-testid*="title"]', '[class*="ProductTitle"]',
                     '[class*="product-title"]', '[class*="headline"]']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const m = el.textContent.match(/[»›]([^«‹]{3,30})[«‹]/);
    if (m) return m[1].trim();
  }
  return null;
}

// ── OBI.de ───────────────────────────────────────────────────────────────────

function extractEanObi() {
  const ld = _scanJsonLd(); if (ld) return ld;
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  return (
    _tableEan('.product-attributes tr, .attribute-list tr') ||
    _metaEan() ||
    _dataAttrEan()
  );
}

// ── Metro.de ─────────────────────────────────────────────────────────────────

function extractEanMetro() {
  const ld = _scanJsonLd(); if (ld) return ld;
  return (
    _tableEan('.product-attributes__row, .pdp-attributes tr') ||
    _metaEan() ||
    _dataAttrEan()
  );
}

// ── BackMarket.de ─────────────────────────────────────────────────────────────

function extractEanBackmarket() {
  const ld = _scanJsonLd(); if (ld) return ld;
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  // BackMarket stores IMEI/serial in product props; EAN may be in data attrs
  return _dataAttrEan() || _metaEan();
}

// ── Rebuy.de / Refurbed.de ────────────────────────────────────────────────────

function extractEanRebuy() {
  const ld = _scanJsonLd(); if (ld) return ld;
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  return _metaEan() || _dataAttrEan() || _itemPropEan();
}

// ── Thomann.de ────────────────────────────────────────────────────────────────

function extractEanThomann() {
  const ld = _scanJsonLd(); if (ld) return ld;
  // Thomann uses data-artno for article numbers; EAN in JSON-LD or meta
  return (
    _metaEan() ||
    _tableEan('.product-attribute-list tr, .product-specs tr') ||
    _textMatchEan('.rs-product-page, .product-page-main')
  );
}

// ── Galaxus.de / Digitec.ch ───────────────────────────────────────────────────

function extractEanGalaxus() {
  const ld = _scanJsonLd(); if (ld) return ld;
  // Galaxus Next.js
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  return _metaEan() || _dataAttrEan();
}

// ── Mindfactory.de / Caseking.de / Jacob.de ──────────────────────────────────

function extractEanPcShop() {
  const ld = _scanJsonLd(); if (ld) return ld;
  // Classic German PC shops often put EAN in spec tables
  return (
    _dataAttrEan() ||
    _tableEan('.product-detail-table tr, .ProductAttributes tr, .spec-table tr') ||
    _tableEan('[class*="attr"] tr, [class*="spec"] tr') ||
    _metaEan() ||
    _itemPropEan()
  );
}

// ── Euronics.de / Expert.de ───────────────────────────────────────────────────

function extractEanEuronics() {
  const ld = _scanJsonLd(); if (ld) return ld;
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  return (
    _dataAttrEan() ||
    _tableEan('.product-detail__specs tr, .specs-table tr') ||
    _metaEan()
  );
}

// ── Reichelt.de / Pollin.de / Pearl.de / Voelkner.de ─────────────────────────

function extractEanReichelt() {
  // Reichelt and similar use classic server-rendered HTML
  const ld = _scanJsonLd(); if (ld) return ld;
  return (
    _dataAttrEan() ||
    _tableEan('#av_items tr, .av_items tr, .product-detail-attr tr, .tab-pane tr') ||
    _textMatchEan('#product-attributes, .product-attributes, .productinfos') ||
    _metaEan() ||
    _itemPropEan()
  );
}

// ── Douglas.de / Flaconi.de / Parfumdreams.de ────────────────────────────────

function extractEanDouglas() {
  const ld = _scanJsonLd(); if (ld) return ld;
  const next = _parseScriptVar('#__NEXT_DATA__');
  if (next) { const r = _deepSearchEan(next); if (r) return r; }
  return (
    _dataAttrEan() ||
    _tableEan('.product-detail-info tr, .attributes-list tr') ||
    _metaEan() ||
    _itemPropEan()
  );
}

// ── Generic (Enhanced Fallback) ───────────────────────────────────────────────

function extractEanGeneric() {
  // 0) Route to site-specific extractor when running on known new platforms
  const h = location.hostname;
  if (h.includes('backmarket'))                                    return extractEanBackmarket();
  if (h.includes('rebuy') || h.includes('refurbed'))              return extractEanRebuy();
  if (h.includes('thomann'))                                       return extractEanThomann();
  if (h.includes('galaxus') || h.includes('digitec'))             return extractEanGalaxus();
  if (h.includes('mindfactory') || h.includes('caseking') ||
      h.includes('jacob.de') || h.includes('getgoods') ||
      h.includes('computeruniverse'))                              return extractEanPcShop();
  if (h.includes('euronics') || h.includes('expert.de') ||
      h.includes('ep.de'))                                         return extractEanEuronics();
  if (h.includes('reichelt') || h.includes('pollin') ||
      h.includes('pearl.de') || h.includes('voelkner'))           return extractEanReichelt();
  if (h.includes('douglas') || h.includes('flaconi') ||
      h.includes('parfumdreams') || h.includes('notino'))         return extractEanDouglas();

  // 1) JSON-LD (handles @graph and nested structures)
  const ld = _scanJsonLd(); if (ld) return ld;

  // 2) Meta tags (extended list)
  const meta = _metaEan(); if (meta) return meta;

  // 3) itemprop
  const ip = _itemPropEan(); if (ip) return ip;

  // 4) data-* attributes
  const da = _dataAttrEan(); if (da) return da;

  // 5) __NEXT_DATA__ (Next.js) / __NUXT__ (Nuxt.js) / __STATE__
  for (const sel of ['#__NEXT_DATA__', '#__NUXT_DATA__', '#__nuxt-error']) {
    const d = _parseScriptVar(sel);
    if (d) { const r = _deepSearchEan(d); if (r) return r; }
  }
  // Inline script comprehensive scan (matchAll finds all occurrences)
  const inl = _scanInlineScripts();
  if (inl) return inl;

  // 6) TreeWalker: text nodes matching "EAN: 1234567890123" (up to 5000 nodes)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  let checked = 0;
  while ((node = walker.nextNode()) && checked < 5000) {
    checked++;
    const text = node.textContent;
    if (text.length > 300 || text.length < 5) continue;
    const m = text.match(/(?:EAN|GTIN|Barcode|ISBN)[:\s]+([\d]{8,14})/i);
    if (m && isValidEan(m[1])) return m[1];
  }

  return null;
}

// ── Universal Page Price Detector ─────────────────────────────────────────────
// Called automatically by the panel's probe() to autofill the EK field.
// Tries structured data → meta tags → site-specific selectors → generic selectors.
// Returns a positive float, or null if nothing found.

function detectPagePrice() {
  // Helper: parse German (1.299,99) or English (1299.99) price text
  function _pp(raw) {
    const s = String(raw ?? '').replace(/[€$£\s\u00a0]/g, '');
    // German format: "1.299,99" → 1299.99
    const de = s.match(/(\d{1,3}(?:\.\d{3})*),(\d{2})(?!\d)/);
    if (de) { const p = parseFloat(de[0].replace(/\./g, '').replace(',', '.')); if (p > 0 && p < 99999) return p; }
    // Plain decimal: "49.99"
    const en = s.match(/(\d+)\.(\d{2})(?!\d)/);
    if (en) { const p = parseFloat(en[0]); if (p > 0 && p < 99999) return p; }
    // Integer fallback: "49"
    const iv = s.match(/^(\d{1,5})$/);
    if (iv) { const p = parseFloat(iv[0]); if (p > 0 && p < 99999) return p; }
    return null;
  }

  // 1) JSON-LD structured data (most reliable)
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const d = JSON.parse(el.textContent);
      const raw = d?.offers?.price ?? d?.offers?.[0]?.price ?? d?.price;
      if (raw) { const p = _pp(raw); if (p) return p; }
    } catch (_) {}
  }

  // 2) Meta tags
  for (const sel of [
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    'meta[name="price"]',
  ]) {
    const el = document.querySelector(sel);
    if (el?.content) { const p = _pp(el.content); if (p) return p; }
  }

  // 3) schema.org itemprop="price"
  const ipEl = document.querySelector('[itemprop="price"]');
  if (ipEl) {
    const raw = ipEl.getAttribute('content') || ipEl.textContent;
    const p = _pp(raw); if (p) return p;
  }

  // 4) Site-specific CSS selectors (ordered by reliability)
  const SELECTORS = [
    // MediaMarkt / Saturn
    '[data-test="branded-price-without-rrp"]',
    '[data-test="price-box"]',
    '.price__value',
    '[class*="BrandedPrice"] span',
    // Amazon
    '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
    '#apex_desktop_newAccordionRow .a-price .a-offscreen',
    '.reinventPricePriceToPayMargin .a-price .a-offscreen',
    '.a-price .a-offscreen',
    // eBay
    '.x-price-primary .ux-textspans',
    '#prcIsum',
    // Notebooksbilliger
    '.price-tag',
    '[data-qa="product-price"]',
    '[class*="PriceTag"]',
    // Conrad / Cyberport / Alternate
    '.pdp-price__actual',
    '.product-price__amount',
    '.pricebox__price',
    '.price-box__price',
    '.pro-price',
    // Otto
    '.pds__price',
    '[class*="ProductPriceComp"] [class*="price"]',
    '[class*="PdsPriceComp"]',
    // Idealo
    '[class*="offer-price"]',
    '[class*="productOffers-listItem__price"]',
    // Lidl
    '.m-price__main',
    '.pricebox .pricebox__price',
    // Rossmann / DM
    '.product__price',
    '[class*="ProductPrice"]',
    '[class*="PriceGroup"] [class*="price"]',
    // Kaufland
    '[class*="price--main"]',
    '[class*="ProductCardPrice"]',
    // Zalando / AboutYou
    '[data-testid="price"]',
    '[class*="ArticlePrice"]',
    // BackMarket (refurb marketplace, Next.js)
    '[data-qa="buybox-price"]',
    '[class*="Buybox"] [class*="price"]',
    '[class*="ProductPrice"]',
    // Rebuy / Refurbed
    '.rebuy-price',
    '[class*="offer__price"]',
    '[class*="Price__value"]',
    // Thomann (music instruments)
    '.price-wrapper .product-price',
    '#product-price',
    '.thomann-price',
    // Galaxus / Digitec
    '[class*="productPrice"]',
    '[class*="Price_price"]',
    '[class*="detailPrice"]',
    // Douglas / beauty
    '.product-price .value',
    '[class*="ProductStagePrice"]',
    // Euronics / Expert / EP
    '.product-price .price',
    '.buybox-price',
    '[class*="PriceBlock"]',
    // Intersport / sports shops
    '[class*="product-price-value"]',
    '[data-testid="pdp-price"]',
    // Caseking / Mindfactory / PC hardware
    '.priceBlock .price',
    '#product-price-block',
    '[class*="price-now"]',
    // Thomann
    '.rs-product-price__amount',
    // Generic catch-all (broad, tried last)
    '[data-testid="product-price"]',
    '.product-price__price',
    '.price--main',
    '.price__amount',
    '.product__price',
    '.product-detail-price',
    '.current-price',
    '.sale-price',
    '.offer-price',
    '.special-price',
    '[class*="selling-price"]',
    '[class*="final-price"]',
  ];

  for (const sel of SELECTORS) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const txt = el.textContent;
    if (!txt || txt.length > 30) continue;
    const p = _pp(txt);
    if (p) return p;
  }

  return null;
}
