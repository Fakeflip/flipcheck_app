/* Flipcheck Extension — Amazon.de SERP Badge Injection
 *
 * Mirrors ebay-serp.js but for amazon.de/s/ (search results).
 * Uses ASIN (data-asin attribute) as identifier — no EAN needed.
 * Calls AMAZON_CHECK via background with ek=0.
 */

(function () {
  if (window.__fcAmazonSerpInit) return;
  window.__fcAmazonSerpInit = true;

  const _processed  = new WeakSet();
  const _inflight   = new Set();  // ASINs currently being fetched
  const _results    = new Map();  // asin → resultData
  const _pending    = new Map();  // asin → [cardEl, ...]
  let   _timer      = null;
  let   _scanMode   = false;
  let   _scanResults = [];

  // ── Palette ───────────────────────────────────────────────────────────────
  const PAL = {
    BUY:  { bg: '#10B98133', border: '#10B98166', text: '#10B981' },
    HOLD: { bg: '#F59E0B33', border: '#F59E0B66', text: '#F59E0B' },
    SKIP: { bg: '#EF444433', border: '#EF444466', text: '#EF4444' },
    NONE: { bg: '#1E1E2E',   border: '#2E2E42',   text: '#475569' },
  };

  const fmt      = v => (v != null && !isNaN(v)) ? `€${Number(v).toFixed(2)}` : '—';
  const fmtShort = v => (v != null && !isNaN(v)) ? `€${Math.abs(Number(v)).toFixed(0)}` : '—';

  // ── Tooltip ───────────────────────────────────────────────────────────────
  let _tooltip = null;

  function getTooltip() {
    if (_tooltip) return _tooltip;
    _tooltip = document.createElement('div');
    _tooltip.id = '__fc_amz_tooltip';
    Object.assign(_tooltip.style, {
      position:    'fixed',
      zIndex:      '2147483646',
      background:  '#111118',
      border:      '1px solid #2E2E42',
      borderRadius:'8px',
      boxShadow:   '0 8px 24px rgba(0,0,0,.7)',
      padding:     '8px 10px',
      fontFamily:  '-apple-system, BlinkMacSystemFont, Inter, sans-serif',
      fontSize:    '11px',
      color:       '#F1F5F9',
      pointerEvents:'none',
      opacity:     '0',
      transition:  'opacity .12s',
      minWidth:    '160px',
      lineHeight:  '1.6',
    });
    document.body.appendChild(_tooltip);
    return _tooltip;
  }

  function showTooltip(e, d) {
    const t  = getTooltip();
    const vc = PAL[d.verdict] || PAL.NONE;
    const profitColor = d.profit_median > 0 ? '#10B981' : d.profit_median < 0 ? '#EF4444' : '#94A3B8';
    t.innerHTML = `
      <div style="font-weight:800;font-size:12px;color:${vc.text};margin-bottom:4px;letter-spacing:.04em">${escT(d.verdict || '—')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 10px">
        <span style="color:#475569">Buy Box</span><span style="font-weight:600">${fmt(d.buy_box ?? d.sell_price_median)}</span>
        <span style="color:#475569">Profit</span><span style="font-weight:700;color:${profitColor}">${fmt(d.profit_median)}</span>
        <span style="color:#475569">Marge</span><span style="font-weight:600">${d.margin_pct != null ? Number(d.margin_pct).toFixed(1) + '%' : '—'}</span>
        <span style="color:#475569">Verk./30d</span><span style="font-weight:600">${d.sales_30d ?? '—'}</span>
        ${d.fba_count != null ? `<span style="color:#475569">FBA</span><span>${d.fba_count}</span>` : ''}
      </div>
      ${d.title ? `<div style="color:#475569;font-size:9px;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px">${escT(d.title.slice(0, 55))}</div>` : ''}
      ${d.ean    ? `<div style="color:#6366F1;font-size:9px;margin-top:3px">EAN: ${escT(d.ean)}</div>` : ''}
    `;
    const x = Math.min(e.clientX + 14, window.innerWidth - 190);
    const y = Math.min(e.clientY + 14, window.innerHeight - 130);
    t.style.left = x + 'px';
    t.style.top  = y + 'px';
    t.style.opacity = '1';
  }

  function hideTooltip() {
    if (_tooltip) _tooltip.style.opacity = '0';
  }

  // Tooltip-safe escape (no DOM injection risk)
  function escT(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Badge Renderers ───────────────────────────────────────────────────────

  function injectLoadingBadge(card) {
    removeBadge(card);
    const img = _imgWrap(card);
    if (!img) return;
    const b = _makeBadge('#1E1E2E', '#2E2E42', '#475569');
    b.innerHTML = '<span style="animation:fc-amz-spin .7s linear infinite;display:inline-block">↻</span>';
    b.style.cssText += ';font-size:11px';
    _mountBadge(img, b);
  }

  function injectResultBadge(card, d) {
    removeBadge(card);
    const img = _imgWrap(card);
    if (!img) return;
    if (!d) { injectNoBadge(card); return; }

    const vc = PAL[d.verdict] || PAL.NONE;
    const b  = _makeBadge(vc.bg, vc.border, vc.text);

    if (d.verdict && d.profit_median != null) {
      const sign   = d.profit_median >= 0 ? '+' : '';
      const profit = `${sign}${fmtShort(d.profit_median)}`;
      b.innerHTML = `<span style="font-weight:800">${escT(d.verdict)}</span><span style="opacity:.75;font-size:9px;margin-left:3px">${profit}</span>`;
    } else if (d.verdict) {
      b.textContent = d.verdict;
    } else {
      b.style.opacity = '0.3';
      b.textContent = 'FC';
    }

    b.style.pointerEvents = 'auto';
    b.addEventListener('mouseenter', ev => showTooltip(ev, d));
    b.addEventListener('mousemove',  ev => showTooltip(ev, d));
    b.addEventListener('mouseleave', hideTooltip);

    _mountBadge(img, b);

    if (_scanMode && d.verdict === 'BUY') {
      _scanResults.push({ card, d });
      updateScanCounter();
    }
  }

  function injectNoBadge(card) {
    const img = _imgWrap(card);
    if (!img) return;
    const b = _makeBadge('#1E1E2E', '#2E2E42', '#334155');
    b.style.opacity = '0.2';
    b.textContent = 'FC';
    _mountBadge(img, b);
  }

  function removeBadge(card) {
    card.querySelector('.__fc_amz_badge')?.remove();
  }

  function _imgWrap(card) {
    // Amazon SERP image container — try multiple selectors for layout resilience
    return (
      card.querySelector('.s-product-image-container') ||
      card.querySelector('.a-section.aok-relative') ||
      card.querySelector('.s-image')?.parentElement ||
      null
    );
  }

  function _makeBadge(bg, border, color) {
    const b = document.createElement('div');
    b.className = '__fc_amz_badge';
    b.style.cssText = [
      'position:absolute', 'top:6px', 'left:6px', 'z-index:9',
      `background:${bg}`, `border:1px solid ${border}`, `color:${color}`,
      'font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif',
      'font-size:10px', 'font-weight:700', 'padding:2px 7px',
      'border-radius:6px', 'letter-spacing:.04em',
      'display:flex', 'align-items:center', 'gap:3px',
      'backdrop-filter:blur(4px)', 'cursor:default',
    ].join(';');
    return b;
  }

  function _mountBadge(wrap, b) {
    const cs = getComputedStyle(wrap);
    if (cs.position === 'static') wrap.style.position = 'relative';
    wrap.appendChild(b);
  }

  // ── Spin keyframe (once) ──────────────────────────────────────────────────
  if (!document.getElementById('__fc_amz_spin_style')) {
    const s = document.createElement('style');
    s.id = '__fc_amz_spin_style';
    s.textContent = '@keyframes fc-amz-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(s);
  }

  // ── ASIN from card ────────────────────────────────────────────────────────

  function getAsinFromCard(card) {
    // data-asin is set by Amazon on every result item — ultra reliable
    const asin = card.dataset?.asin || card.getAttribute('data-asin');
    if (asin && /^[A-Z0-9]{10}$/i.test(asin)) return asin.toUpperCase();
    return null;
  }

  // ── Batch Flush ───────────────────────────────────────────────────────────

  function flushBatch() {
    _timer = null;
    if (_pending.size === 0) return;
    const batch = new Map(_pending);
    _pending.clear();

    for (const [asin, cards] of batch) {
      cards.forEach(c => injectLoadingBadge(c));

      // Re-use cached result
      if (_results.has(asin)) {
        cards.forEach(c => injectResultBadge(c, _results.get(asin)));
        continue;
      }

      // Skip if in-flight
      if (_inflight.has(asin)) continue;
      _inflight.add(asin);

      chrome.runtime.sendMessage(
        { type: 'AMAZON_SERP_CHECK', asin },
        res => {
          _inflight.delete(asin);
          if (chrome.runtime.lastError) return;
          const d = res?.ok ? res.data : null;
          if (d) _results.set(asin, d);
          cards.forEach(c => injectResultBadge(c, d));
        },
      );
    }
  }

  // ── Queue Card ────────────────────────────────────────────────────────────

  function queueCard(card) {
    if (_processed.has(card)) return;
    _processed.add(card);
    const asin = getAsinFromCard(card);
    if (!asin) {
      if (card.querySelector('.s-title-instructions-style, h2.a-size-mini')) injectNoBadge(card);
      return;
    }
    const arr = _pending.get(asin) || [];
    arr.push(card);
    _pending.set(asin, arr);
    clearTimeout(_timer);
    _timer = setTimeout(flushBatch, 300);
  }

  // ── IntersectionObserver ──────────────────────────────────────────────────

  const _io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) { _io.unobserve(e.target); queueCard(e.target); }
    }
  }, { rootMargin: '300px' });

  function observeCards() {
    document.querySelectorAll(
      '[data-asin]:not([data-fc-amz-observed]):not(.AdHolder)',
    ).forEach(card => {
      // Skip ads, carousels, sponsored tiles without product content
      if (!card.querySelector('.s-image, .s-title-instructions-style, h2')) return;
      if (card.dataset.fcAmzObserved) return;
      card.dataset.fcAmzObserved = '1';
      _io.observe(card);
    });
  }

  // ── MutationObserver ──────────────────────────────────────────────────────

  new MutationObserver(muts => {
    if (muts.some(m => m.addedNodes.length)) observeCards();
  }).observe(
    document.querySelector('.s-search-results, #search') || document.body,
    { childList: true, subtree: false },
  );

  // ── SPA nav watch ─────────────────────────────────────────────────────────
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      // Clear caches on new search
      _results.clear();
      setTimeout(observeCards, 700);
    }
  }).observe(document, { subtree: true, childList: true });

  // ── Deal Scanner ──────────────────────────────────────────────────────────

  function createScannerUI() {
    const wrap = document.createElement('div');
    wrap.id = '__fc_amz_scanner_ui';
    wrap.style.cssText = [
      'position:fixed', 'bottom:20px', 'left:20px', 'z-index:2147483647',
      'background:#111118', 'border:1px solid #2E2E42', 'border-radius:10px',
      'box-shadow:0 8px 24px rgba(0,0,0,.7)',
      'font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif',
      'padding:10px 14px', 'min-width:190px',
    ].join(';');
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="color:#6366F1;font-weight:800;font-size:12px;letter-spacing:.06em">▲ AMZ DEALS</span>
        <button id="__fc_amz_close" style="margin-left:auto;background:none;border:none;color:#475569;cursor:pointer;font-size:14px;line-height:1">✕</button>
      </div>
      <button id="__fc_amz_start" style="
        width:100%;background:#6366F1;color:#fff;border:none;border-radius:6px;
        font-size:12px;font-weight:700;padding:7px 12px;cursor:pointer;margin-bottom:6px
      ">▶ Scan starten</button>
      <div id="__fc_amz_status" style="font-size:11px;color:#475569;text-align:center"></div>
      <div id="__fc_amz_results" style="display:none;margin-top:8px;max-height:160px;overflow-y:auto"></div>
      <button id="__fc_amz_export" style="
        display:none;width:100%;margin-top:6px;background:#16161F;color:#94A3B8;
        border:1px solid #2E2E42;border-radius:6px;font-size:11px;font-weight:600;
        padding:5px;cursor:pointer
      ">⬇ CSV Export</button>
    `;
    document.body.appendChild(wrap);
    document.getElementById('__fc_amz_close').onclick  = () => { wrap.remove(); _scanMode = false; };
    document.getElementById('__fc_amz_start').onclick  = startDealScan;
    document.getElementById('__fc_amz_export').onclick = exportScanCsv;
    return wrap;
  }

  function createFloatBtn() {
    if (document.getElementById('__fc_amz_scan_fab')) return;
    const btn = document.createElement('button');
    btn.id = '__fc_amz_scan_fab';
    btn.title = 'Flipcheck Amazon Deal Scanner';
    btn.style.cssText = [
      'position:fixed', 'bottom:20px', 'left:20px', 'z-index:2147483647',
      'background:#111118', 'border:1px solid #2E2E42', 'border-radius:22px',
      'box-shadow:0 4px 16px rgba(0,0,0,.6)',
      'font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif',
      'font-size:11px', 'font-weight:700', 'color:#6366F1',
      'padding:8px 14px', 'cursor:pointer',
      'display:flex', 'align-items:center', 'gap:6px',
      'transition:border-color .15s',
    ].join(';');
    btn.innerHTML = '<span>▲</span><span>AMZ Deals</span>';
    btn.addEventListener('click', () => { btn.remove(); createScannerUI(); });
    btn.addEventListener('mouseenter', () => btn.style.borderColor = '#6366F1');
    btn.addEventListener('mouseleave', () => btn.style.borderColor = '#2E2E42');
    document.body.appendChild(btn);
  }

  async function startDealScan() {
    _scanMode    = true;
    _scanResults = [];

    const startBtn  = document.getElementById('__fc_amz_start');
    const statusEl  = document.getElementById('__fc_amz_status');
    const resultsEl = document.getElementById('__fc_amz_results');
    const exportBtn = document.getElementById('__fc_amz_export');

    startBtn.disabled    = true;
    startBtn.textContent = '⏳ Scanne…';
    resultsEl.style.display = 'none';
    exportBtn.style.display = 'none';
    statusEl.textContent    = 'Scrolle durch Ergebnisse…';

    // Re-queue all cards
    const cards = document.querySelectorAll('[data-asin]');
    for (const c of cards) { delete c.dataset.fcAmzObserved; _processed.delete(c); }

    await autoScroll();

    statusEl.textContent = 'Warte auf API…';
    await new Promise(r => setTimeout(r, 2500));

    _scanMode = false;
    statusEl.textContent = `${_scanResults.length} BUY-Deals gefunden`;
    startBtn.disabled    = false;
    startBtn.textContent = '▶ Erneut scannen';

    if (_scanResults.length > 0) {
      resultsEl.style.display = 'block';
      exportBtn.style.display = 'block';
      resultsEl.innerHTML = _scanResults.map(({ d }) => `
        <div style="background:#16161F;border-radius:6px;padding:6px 8px;margin-bottom:4px">
          <div style="font-size:10px;color:#F1F5F9;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escT(d.title?.slice(0, 42) || '—')}</div>
          <div style="display:flex;gap:8px;margin-top:2px;font-size:10px">
            <span style="color:#10B981;font-weight:700">+${fmt(d.profit_median)}</span>
            <span style="color:#475569">${d.margin_pct != null ? Number(d.margin_pct).toFixed(1) + '%' : ''}</span>
            <span style="color:#475569">${d.sales_30d ?? 0}/30d</span>
          </div>
        </div>
      `).join('');
    }
  }

  function updateScanCounter() {
    const s = document.getElementById('__fc_amz_status');
    if (s) s.textContent = `${_scanResults.length} BUY-Deals bisher…`;
  }

  async function autoScroll() {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const total = document.documentElement.scrollHeight;
    const step  = window.innerHeight * 0.8;
    let pos = 0;
    while (pos < total) {
      window.scrollTo({ top: pos, behavior: 'smooth' });
      await delay(550);
      pos += step;
      observeCards();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function exportScanCsv() {
    const rows = [['ASIN', 'EAN', 'Titel', 'Profit', 'Marge%', 'Verk./30d', 'Buy Box']];
    for (const { d } of _scanResults) {
      rows.push([
        d.asin || '',
        d.ean  || '',
        (d.title || '').replace(/,/g, ' '),
        d.profit_median?.toFixed(2) || '',
        d.margin_pct?.toFixed(1) || '',
        d.sales_30d ?? '',
        (d.buy_box ?? d.sell_price_median)?.toFixed(2) || '',
      ]);
    }
    const csv  = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `flipcheck_amazon_deals_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  observeCards();

  chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }, res => {
    const s = res?.data || {};
    if (s.amazonSerpBadges === false) return;
    if (s.dealScannerFab !== false) createFloatBtn();
  });

})();
