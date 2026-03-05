/* Flipcheck Extension — eBay SERP Badge Injection + Deal Scanner
 *
 * Improvements v2:
 *  - Badges show PROFIT (€) instead of VK
 *  - Hover tooltip with all KPIs (VK, Profit, Margin, Sales/30d)
 *  - Deal Scanner mode: floating button → auto-scroll + collect all BUY cards
 *  - Batch deduplicated API calls (same EAN on multiple cards = 1 request)
 */

(function () {
  const _processed = new WeakSet();
  const _pending   = new Map();   // ean → [cardEl, ...]
  const _results   = new Map();   // ean → resultData (for tooltip re-use)
  let   _timer     = null;
  let   _scanMode  = false;
  let   _scanResults = [];

  // ── Palette ──────────────────────────────────────────────────────────────────
  const PAL = {
    BUY:  { bg: '#10B98133', border: '#10B98166', text: '#10B981' },
    HOLD: { bg: '#F59E0B33', border: '#F59E0B66', text: '#F59E0B' },
    SKIP: { bg: '#EF444433', border: '#EF444466', text: '#EF4444' },
    NONE: { bg: '#1E1E2E',   border: '#2E2E42',   text: '#475569' },
  };

  const fmt = v => (v != null && !isNaN(v)) ? `€${Number(v).toFixed(2)}` : '—';
  const fmtShort = v => (v != null && !isNaN(v)) ? `€${Math.abs(Number(v)).toFixed(0)}` : '—';

  // ── Tooltip ─────────────────────────────────────────────────────────────────
  let _tooltip = null;

  function getTooltip() {
    if (_tooltip) return _tooltip;
    _tooltip = document.createElement('div');
    _tooltip.id = '__fc_tooltip';
    Object.assign(_tooltip.style, {
      position:   'fixed',
      zIndex:     '2147483646',
      background: '#111118',
      border:     '1px solid #2E2E42',
      borderRadius: '8px',
      boxShadow:  '0 8px 24px rgba(0,0,0,.7)',
      padding:    '8px 10px',
      fontFamily: '-apple-system, BlinkMacSystemFont, Inter, sans-serif',
      fontSize:   '11px',
      color:      '#F1F5F9',
      pointerEvents: 'none',
      opacity:    '0',
      transition: 'opacity .12s',
      minWidth:   '140px',
      lineHeight: '1.6',
    });
    document.body.appendChild(_tooltip);
    return _tooltip;
  }

  function showTooltip(e, d) {
    const t  = getTooltip();
    const vc = PAL[d.verdict] || PAL.NONE;
    const profitColor = d.profit_median > 0 ? '#10B981' : d.profit_median < 0 ? '#EF4444' : '#94A3B8';
    t.innerHTML = `
      <div style="font-weight:800;font-size:12px;color:${vc.text};margin-bottom:4px;letter-spacing:.04em">${d.verdict || '—'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 10px">
        <span style="color:#475569">Median VK</span><span style="font-weight:600">${fmt(d.sell_price_median)}</span>
        <span style="color:#475569">Profit</span><span style="font-weight:700;color:${profitColor}">${fmt(d.profit_median)}</span>
        <span style="color:#475569">Marge</span><span style="font-weight:600">${d.margin_pct != null ? Number(d.margin_pct).toFixed(1) + '%' : '—'}</span>
        <span style="color:#475569">Verk./30d</span><span style="font-weight:600">${d.sales_30d ?? '—'}</span>
      </div>
      ${d.title ? `<div style="color:#475569;font-size:9px;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px">${d.title.slice(0, 50)}</div>` : ''}
    `;
    const x = Math.min(e.clientX + 12, window.innerWidth - 180);
    const y = Math.min(e.clientY + 12, window.innerHeight - 120);
    t.style.left = x + 'px';
    t.style.top  = y + 'px';
    t.style.opacity = '1';
  }

  function hideTooltip() {
    if (_tooltip) _tooltip.style.opacity = '0';
  }

  // ── Badge Renderers ──────────────────────────────────────────────────────────

  function _getImgContainer(card) {
    return card.querySelector(
      '.s-card__link.image-treatment, .s-card__media-wrapper, ' +
      '.s-item__image-section, .s-item__image'
    );
  }

  function injectLoadingBadge(card) {
    const img = _getImgContainer(card);
    if (!img) return;
    removeBadge(card);
    const b = _makeBadge('#1E1E2E', '#2E2E42', '#475569');
    b.innerHTML = '<span style="animation:fc-spin .7s linear infinite;display:inline-block">↻</span>';
    b.style.cssText += ';font-size:11px';
    _mountBadge(img, b);
  }

  function injectResultBadge(card, d) {
    removeBadge(card);
    const img = _getImgContainer(card);
    if (!img) return;

    if (!d) { injectNoBadge(card); return; }

    const vc = PAL[d.verdict] || PAL.NONE;
    const b  = _makeBadge(vc.bg, vc.border, vc.text);

    // Show PROFIT prominently (not VK)
    if (d.verdict && d.profit_median != null) {
      const sign   = d.profit_median >= 0 ? '+' : '';
      const profit = `${sign}${fmtShort(d.profit_median)}`;
      b.innerHTML = `<span style="font-weight:800">${d.verdict}</span><span style="opacity:.75;font-size:9px;margin-left:3px">${profit}</span>`;
    } else if (d.verdict) {
      b.textContent = d.verdict;
    } else {
      b.style.opacity = '0.3';
      b.textContent = 'FC';
    }

    // Hover tooltip
    b.style.pointerEvents = 'auto';
    b.addEventListener('mouseenter', ev => showTooltip(ev, d));
    b.addEventListener('mousemove',  ev => showTooltip(ev, d));
    b.addEventListener('mouseleave', hideTooltip);

    _mountBadge(img, b);

    // Deal scanner collection
    if (_scanMode && d.verdict === 'BUY') {
      _scanResults.push({ card, d });
      updateScanCounter();
    }
  }

  function injectNoBadge(card) {
    const img = _getImgContainer(card);
    if (!img) return;
    const b = _makeBadge('#1E1E2E', '#2E2E42', '#334155');
    b.style.opacity = '0.25';
    b.textContent = 'FC';
    _mountBadge(img, b);
  }

  function removeBadge(card) {
    card.querySelector('.__fc_badge')?.remove();
  }

  function _makeBadge(bg, border, color) {
    const b = document.createElement('div');
    b.className = '__fc_badge';
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

  function _mountBadge(img, b) {
    if (getComputedStyle(img).position === 'static') img.style.position = 'relative';
    img.appendChild(b);
  }

  // ── Spin keyframe (injected once) ────────────────────────────────────────────
  if (!document.getElementById('__fc_spin_style')) {
    const s = document.createElement('style');
    s.id = '__fc_spin_style';
    s.textContent = '@keyframes fc-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(s);
  }

  // ── EAN from SERP card ───────────────────────────────────────────────────────

  function getEanFromCard(card) {
    try {
      const ean = extractEanFromSerpCard(card);
      if (ean) return ean;
    } catch {}
    for (const el of card.querySelectorAll('[data-ean],[data-gtin],[itemprop="gtin13"]')) {
      const v = (el.dataset?.ean || el.dataset?.gtin || el.getAttribute('content') || '').trim();
      if (isValidEan(v)) return v;
    }
    return null;
  }

  // ── Batch Flush ──────────────────────────────────────────────────────────────

  function flushBatch() {
    _timer = null;
    if (_pending.size === 0) return;
    const batch = new Map(_pending);
    _pending.clear();

    for (const [ean, cards] of batch) {
      // Show loading
      cards.forEach(c => injectLoadingBadge(c));

      // Re-use cached result if already fetched this session
      if (_results.has(ean)) {
        cards.forEach(c => injectResultBadge(c, _results.get(ean)));
        continue;
      }

      chrome.runtime.sendMessage(
        { type: 'FLIPCHECK', ean, ek: 0, mode: 'mid' },
        res => {
          if (chrome.runtime.lastError) return;
          const d = res?.ok ? res.data : null;
          if (d) _results.set(ean, d);
          cards.forEach(c => injectResultBadge(c, d));
        },
      );
    }
  }

  // ── Queue Card ───────────────────────────────────────────────────────────────

  function queueCard(card) {
    if (_processed.has(card)) return;
    _processed.add(card);
    const ean = getEanFromCard(card);
    if (!ean) return; // No EAN in this listing — skip silently (no cluttering badge)
    const arr = _pending.get(ean) || [];
    arr.push(card);
    _pending.set(ean, arr);
    clearTimeout(_timer);
    _timer = setTimeout(flushBatch, 300);
  }

  // ── IntersectionObserver ─────────────────────────────────────────────────────

  const _io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) { _io.unobserve(e.target); queueCard(e.target); }
    }
  }, { rootMargin: '300px' });

  function observeCards() {
    document.querySelectorAll(
      // new layout (2024+): li[id*="item"].s-card
      // old layout fallback: .s-item, .srp-item
      'li[id*="item"].s-card:not([data-fc-observed]),' +
      '.s-item:not([data-fc-observed]),.srp-item:not([data-fc-observed])',
    ).forEach(card => {
      if (card.classList.contains('s-item--watch-at-corner')) return;
      if (!card.querySelector('.s-card__title,.s-card__link,.s-item__title,.s-item__link')) return;
      card.dataset.fcObserved = '1';
      _io.observe(card);
    });
  }

  // ── MutationObserver ─────────────────────────────────────────────────────────

  new MutationObserver(muts => {
    if (muts.some(m => m.addedNodes.length)) observeCards();
  }).observe(
    document.querySelector('#srp-river-results, .srp-results, #ResultSetItems, .b-list__items_nofooter') || document.body,
    { childList: true, subtree: true },
  );

  // ── SPA nav watch ────────────────────────────────────────────────────────────
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) { _lastUrl = location.href; setTimeout(observeCards, 600); }
  }).observe(document, { subtree: true, childList: true });

  // ── Deal Scanner ─────────────────────────────────────────────────────────────

  function createScannerUI() {
    const wrap = document.createElement('div');
    wrap.id = '__fc_scanner_ui';
    wrap.style.cssText = [
      'position:fixed', 'bottom:20px', 'left:20px', 'z-index:2147483647',
      'background:#111118', 'border:1px solid #2E2E42', 'border-radius:10px',
      'box-shadow:0 8px 24px rgba(0,0,0,.7)',
      'font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif',
      'padding:10px 14px', 'min-width:180px',
    ].join(';');
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="color:#6366F1;font-weight:800;font-size:12px;letter-spacing:.06em">▲ DEAL SCAN</span>
        <button id="__fc_scan_close" style="margin-left:auto;background:none;border:none;color:#475569;cursor:pointer;font-size:14px;line-height:1">✕</button>
      </div>
      <button id="__fc_scan_start" style="
        width:100%;background:#6366F1;color:#fff;border:none;border-radius:6px;
        font-size:12px;font-weight:700;padding:7px 12px;cursor:pointer;margin-bottom:6px
      ">▶ Scan starten</button>
      <div id="__fc_scan_status" style="font-size:11px;color:#475569;text-align:center"></div>
      <div id="__fc_scan_results" style="display:none;margin-top:8px;max-height:160px;overflow-y:auto"></div>
      <button id="__fc_scan_export" style="
        display:none;width:100%;margin-top:6px;background:#16161F;color:#94A3B8;
        border:1px solid #2E2E42;border-radius:6px;font-size:11px;font-weight:600;
        padding:5px;cursor:pointer
      ">⬇ CSV Export</button>
    `;
    document.body.appendChild(wrap);

    document.getElementById('__fc_scan_close').onclick  = () => { wrap.remove(); _scanMode = false; };
    document.getElementById('__fc_scan_start').onclick  = startDealScan;
    document.getElementById('__fc_scan_export').onclick = exportScanCsv;
    return wrap;
  }

  function createFloatBtn() {
    if (document.getElementById('__fc_scan_fab')) return;
    const btn = document.createElement('button');
    btn.id = '__fc_scan_fab';
    btn.title = 'Flipcheck Deal Scanner';
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
    btn.innerHTML = '<span>▲</span><span>Deal Scanner</span>';
    btn.addEventListener('click', () => {
      btn.remove();
      createScannerUI();
    });
    btn.addEventListener('mouseenter', () => btn.style.borderColor = '#6366F1');
    btn.addEventListener('mouseleave', () => btn.style.borderColor = '#2E2E42');
    document.body.appendChild(btn);
  }

  async function startDealScan() {
    _scanMode    = true;
    _scanResults = [];

    const startBtn   = document.getElementById('__fc_scan_start');
    const statusEl   = document.getElementById('__fc_scan_status');
    const resultsEl  = document.getElementById('__fc_scan_results');
    const exportBtn  = document.getElementById('__fc_scan_export');

    startBtn.disabled   = true;
    startBtn.textContent = '⏳ Scanne…';
    resultsEl.style.display = 'none';
    exportBtn.style.display  = 'none';
    statusEl.textContent     = 'Scrolle durch Ergebnisse…';

    // Reset processed set so all visible cards get re-queued
    const cards = document.querySelectorAll('li[id*="item"].s-card,.s-item,.srp-item');
    for (const c of cards) { delete c.dataset.fcObserved; _processed.delete(c); }

    // Scroll through page to trigger IntersectionObserver
    await autoScroll();

    // Wait for pending requests to complete
    statusEl.textContent = 'Warte auf API…';
    await new Promise(r => setTimeout(r, 2000));

    // Show results
    _scanMode = false;
    statusEl.textContent = `${_scanResults.length} BUY-Deals gefunden`;
    startBtn.disabled    = false;
    startBtn.textContent = '▶ Erneut scannen';

    if (_scanResults.length > 0) {
      resultsEl.style.display = 'block';
      exportBtn.style.display  = 'block';
      resultsEl.innerHTML = _scanResults.map(({ d }) => `
        <div style="background:#16161F;border-radius:6px;padding:6px 8px;margin-bottom:4px">
          <div style="font-size:10px;color:#F1F5F9;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.title?.slice(0, 40) || '—'}</div>
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
    const s = document.getElementById('__fc_scan_status');
    if (s) s.textContent = `${_scanResults.length} BUY-Deals bisher…`;
  }

  async function autoScroll() {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const total = document.documentElement.scrollHeight;
    const step  = window.innerHeight * 0.8;
    let pos = 0;
    while (pos < total) {
      window.scrollTo({ top: pos, behavior: 'smooth' });
      await delay(600);
      pos += step;
      // Re-observe new cards that appeared
      observeCards();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function exportScanCsv() {
    const rows = [['EAN', 'Titel', 'Profit', 'Marge%', 'Verk./30d', 'Median VK']];
    for (const { d } of _scanResults) {
      rows.push([
        d.ean || '',
        (d.title || '').replace(/,/g, ' '),
        d.profit_median?.toFixed(2) || '',
        d.margin_pct?.toFixed(1) || '',
        d.sales_30d ?? '',
        d.sell_price_median?.toFixed(2) || '',
      ]);
    }
    const csv  = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `flipcheck_deals_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  observeCards();

  // Check settings before showing FAB
  chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }, res => {
    const s = res?.data || {};
    if (s.serpBadges === false) return; // badges disabled
    if (s.dealScannerFab !== false) createFloatBtn(); // show by default
  });

})();
