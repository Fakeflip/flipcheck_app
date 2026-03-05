/* Flipcheck Extension — Popup v3 */

// ── HTML Escape (XSS guard — always use for API data in innerHTML) ─────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Categories ────────────────────────────────────────────────────────────────
const POPUP_CATS = [
  { id: 'computer_tablets',  label: 'Computer / Tablets' },
  { id: 'handys',            label: 'Smartphones' },
  { id: 'konsolen',          label: 'Gaming / Konsolen' },
  { id: 'foto_camcorder',    label: 'Foto & Camcorder' },
  { id: 'tv_video_audio',    label: 'TV, Video & Audio' },
  { id: 'haushaltsgeraete',  label: 'Haushaltsgeräte' },
  { id: 'drucker',           label: 'Drucker / Scanner' },
  { id: 'handy_zubehoer',    label: 'Handy-Zubehör' },
  { id: 'notebook_zubehoer', label: 'Notebook-Zubehör' },
  { id: 'kabel',             label: 'Kabel & Stecker' },
  { id: 'mode',              label: 'Mode / Bekleidung' },
  { id: 'sport_freizeit',    label: 'Sport & Freizeit' },
  { id: 'spielzeug',         label: 'Spielzeug / LEGO' },
  { id: 'buecher',           label: 'Bücher & Medien' },
  { id: 'sonstiges',         label: 'Sonstiges' },
];

const VERDICT_COLORS = {
  BUY:  { bg: 'rgba(16,185,129,.15)', border: 'rgba(16,185,129,.35)', text: '#10B981' },
  HOLD: { bg: 'rgba(245,158,11,.15)', border: 'rgba(245,158,11,.35)', text: '#F59E0B' },
  SKIP: { bg: 'rgba(239,68,68,.15)',  border: 'rgba(239,68,68,.35)',  text: '#EF4444' },
};

// ── State ─────────────────────────────────────────────────────────────────────
let _currentEan   = null;
let _currentData  = null;
let _hasToken     = false;
let _market       = 'ebay';    // 'ebay' | 'amazon' | 'kaufland'
let _asnMethod    = 'fba';     // 'fba' | 'fbm'
let _batchResults = [];
let _batchRunning = false;
let _detectedAsin = null;      // ASIN detected from current tab

// ── DOM ───────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Init ──────────────────────────────────────────────────────────────────────
(async function init() {
  buildCatOptions();
  await loadSettings();
  await Promise.all([checkToken(), checkBridge(), loadRecent(), detectCurrentTab()]);
  wireEvents();
})();

// ── Category Select ───────────────────────────────────────────────────────────
function buildCatOptions() {
  $('catSel').innerHTML = POPUP_CATS.map(c =>
    `<option value="${esc(c.id)}">${esc(c.label)}</option>`,
  ).join('');
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }, res => {
      if (res?.ok && res.data) {
        const s = res.data;
        if (s.defaultCat)     $('catSel').value   = s.defaultCat;
        if (s.defaultMode)    $('modeSel').value  = s.defaultMode;
        if (s.defaultShipOut != null) $('fcShipOut').value = s.defaultShipOut;
        if (s.defaultShipIn  != null) $('fcShipIn').value  = s.defaultShipIn;
      }
      resolve();
    });
  });
}

// ── Token ─────────────────────────────────────────────────────────────────────
async function checkToken() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'AUTH_GET_TOKEN' }, res => {
      _hasToken = !!(res?.token);
      $('authBanner').style.display = _hasToken ? 'none' : '';
      resolve();
    });
  });
}

// ── Bridge Status ─────────────────────────────────────────────────────────────
async function checkBridge() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'BRIDGE_STATUS' }, res => {
      const pill  = $('bridgePill');
      const label = $('bridgeLabel');
      if (res?.ok) {
        pill.classList.add('connected');
        label.textContent = 'Verbunden';
      } else {
        pill.classList.remove('connected');
        label.textContent = 'Desktop';
      }
      resolve();
    });
  });
}

// ── Current Tab Detection ─────────────────────────────────────────────────────
async function detectCurrentTab() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB' }, res => {
      if (!res?.ok) { resolve(); return; }
      const pill = $('pageDetectPill');
      if (!pill) { resolve(); return; }

      if (res.asin) {
        // Amazon product page — ASIN reliably extracted from URL
        _detectedAsin = res.asin;
        pill.textContent = `▲ ASIN: ${res.asin}`;
        pill.style.display = 'inline-flex';
        pill.title = res.title || '';
        $('eanInp').value = res.asin;
        setMarket('amazon');
      } else if (res.ean) {
        // Any supported shop — EAN already detected by the floating panel
        pill.textContent = `▲ EAN: ${res.ean}`;
        pill.style.display = 'inline-flex';
        pill.title = res.title || '';
        $('eanInp').value = res.ean;
        const mkt = res.market || _marketFromUrl(res.url || '');
        setMarket(mkt || 'ebay');
      } else {
        // No EAN yet — show which shop is open so user knows it's supported
        const shopLabel = _shopLabelFromUrl(res.url || '');
        if (shopLabel) {
          pill.textContent = `▲ ${shopLabel} erkannt`;
          pill.style.display = 'inline-flex';
        }
      }
      resolve();
    });
  });
}

// Helper: map URL → selling market for the popup's market toggle
function _marketFromUrl(url) {
  if (url.includes('amazon.de'))   return 'amazon';
  if (url.includes('kaufland.de')) return 'kaufland';
  return 'ebay';
}

// Helper: map URL → human-readable shop name for the pill label
function _shopLabelFromUrl(url) {
  const shops = [
    ['ebay.de',              'eBay'],
    ['amazon.de',            'Amazon'],
    ['kaufland.de',          'Kaufland'],
    ['mediamarkt.de',        'MediaMarkt'],
    ['saturn.de',            'Saturn'],
    ['otto.de',              'Otto'],
    ['conrad.de',            'Conrad'],
    ['alternate.de',         'Alternate'],
    ['notebooksbilliger.de', 'NBB'],
    ['cyberport.de',         'Cyberport'],
    ['idealo.de',            'Idealo'],
    ['thalia.de',            'Thalia'],
    ['hugendubel.de',        'Hugendubel'],
    ['dm.de',                'dm'],
    ['rossmann.de',          'Rossmann'],
    ['zalando.de',           'Zalando'],
    ['aboutyou.de',          'About You'],
    ['decathlon.de',         'Decathlon'],
    ['bauhaus.info',         'Bauhaus'],
    ['hornbach.de',          'Hornbach'],
    ['tchibo.de',            'Tchibo'],
    ['lidl.de',              'Lidl'],
    ['obi.de',               'OBI'],
    ['metro.de',             'Metro'],
  ];
  for (const [host, label] of shops) {
    if (url.includes(host)) return label;
  }
  return null;
}

// ── Recent ────────────────────────────────────────────────────────────────────
async function loadRecent() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'RECENT_GET' }, res => {
      renderRecent(res?.data || []);
      resolve();
    });
  });
}

function renderRecent(items) {
  const list = $('recentList');
  if (!items.length) {
    list.innerHTML = '<div class="fc-empty">Noch keine Checks.</div>';
    return;
  }
  list.innerHTML = items.slice(0, 6).map(r => {
    const vc = VERDICT_COLORS[r.verdict] || { bg: '#1E1E2E', border: '#2E2E42', text: '#475569' };
    const profitColor = r.profit > 0 ? '#10B981' : r.profit < 0 ? '#EF4444' : '#475569';
    const profitStr = r.profit != null
      ? `<span class="fc-recent-profit" style="color:${profitColor}">${r.profit > 0 ? '+' : ''}€${Number(r.profit).toFixed(2)}</span>`
      : '';
    // Show title (truncated) if available, else EAN
    const displayName = r.title
      ? `<span class="fc-recent-title">${esc(r.title.slice(0, 28))}</span><span class="fc-recent-ean">${esc(r.ean)}</span>`
      : `<span class="fc-recent-ean fc-recent-ean--mono">${esc(r.ean)}</span>`;

    return `<div class="fc-recent-row" data-ean="${esc(r.ean)}" data-market="${esc(r.market || 'ebay')}">
      <div class="fc-recent-left">${displayName}</div>
      <div class="fc-recent-right">
        ${r.verdict ? `<span class="fc-recent-badge" style="background:${vc.bg};color:${vc.text};border:1px solid ${vc.border}">${esc(r.verdict)}</span>` : ''}
        ${profitStr}
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.fc-recent-row').forEach(row =>
    row.addEventListener('click', () => {
      const mkt = row.dataset.market || 'ebay';
      setMarket(mkt);
      $('eanInp').value = row.dataset.ean;
      runSingleCheck();
    }),
  );
}

// ── Market Toggle ─────────────────────────────────────────────────────────────
function setMarket(market) {
  _market = market;
  document.querySelectorAll('.fc-mkt-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.market === market);
  });
  const isAmz = market === 'amazon';
  $('ebayFeeRow').style.display = isAmz ? 'none' : '';
  $('amzFeeRow').style.display  = isAmz ? '' : 'none';
  $('amzExtras').classList.toggle('visible', isAmz);
  // Sync EK across markets
  if (isAmz && $('ekInp').value)    $('ekInpAmz').value = $('ekInp').value;
  if (!isAmz && $('ekInpAmz').value) $('ekInp').value   = $('ekInpAmz').value;
  // Update conversion button visibility after market switch
  const raw = ($('eanInp')?.value || '').trim();
  const isAsin = /^[A-Z0-9]{10}$/.test(raw.toUpperCase()) && /[A-Z]/.test(raw);
  const isEan  = /^\d{8,14}$/.test(raw);
  const e2a = $('eanToAsinBtn');  const a2e = $('asinToEanBtn');
  if (e2a) e2a.style.display = (isEan  && isAmz)  ? '' : 'none';
  if (a2e) a2e.style.display = (isAsin && !isAmz) ? '' : 'none';
}

function wireMarketToggle() {
  document.querySelectorAll('.fc-mkt-btn').forEach(btn => {
    btn.addEventListener('click', () => setMarket(btn.dataset.market));
  });
}

function wireAmzFbmToggle() {
  document.querySelectorAll('.fc-fbm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _asnMethod = btn.dataset.method;
      document.querySelectorAll('.fc-fbm-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
}

// ── Tab Switching ─────────────────────────────────────────────────────────────
function wireTabSwitch() {
  document.querySelectorAll('.fc-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fc-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('panelSingle').style.display  = btn.id === 'tabSingle' ? '' : 'none';
      $('panelBatch').style.display   = btn.id === 'tabBatch'  ? '' : 'none';
    });
  });
}

// ── EAN → ASIN lookup button ──────────────────────────────────────────────────
function wireEanToAsinBtn() {
  const btn = $('eanToAsinBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const ean = $('eanInp').value.trim();
    if (!/^\d{8,14}$/.test(ean)) return;
    btn.textContent = '…';
    btn.disabled = true;
    chrome.runtime.sendMessage({ type: 'EAN_TO_ASIN', ean }, res => {
      if (res?.ok && res.asin) {
        $('eanInp').value = res.asin;
        setMarket('amazon');
        btn.textContent = '✓ ASIN';
        btn.style.display = 'none';
        const a2e = $('asinToEanBtn');
        if (a2e) a2e.style.display = '';
      } else {
        btn.textContent = '✗ n.a.';
      }
      setTimeout(() => { btn.textContent = 'EAN → ASIN'; btn.disabled = false; }, 2000);
    });
  });
}

// ── ASIN → EAN lookup button ──────────────────────────────────────────────────
function wireAsinToEanBtn() {
  const btn = $('asinToEanBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const asin = $('eanInp').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin) || !/[A-Z]/.test(asin)) return;
    btn.textContent = '…';
    btn.disabled = true;
    chrome.runtime.sendMessage({ type: 'ASIN_TO_EAN', asin }, res => {
      if (res?.ok && res.ean) {
        $('eanInp').value = res.ean;
        setMarket('ebay');
        btn.textContent = '✓ EAN';
        btn.style.display = 'none';
      } else {
        btn.textContent = '✗ n.a.';
      }
      setTimeout(() => { btn.textContent = 'ASIN → EAN'; btn.disabled = false; }, 2000);
    });
  });
}

// ── Scan current page for EAN ─────────────────────────────────────────────────
async function scanCurrentPage() {
  const btn = $('scanPageBtn');
  btn.disabled = true;
  btn.className = 'fc-scan-page-btn scanning';
  btn.textContent = '⟳ Scanne…';

  // Ask the content script to re-run EAN extraction (fires fc-manual-ean)
  await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'TRIGGER_EAN_SCAN' }, () => resolve());
  });

  // Give the content script up to 2.5 s to extract the EAN (SPA latency)
  let ean = null; let market = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise(r => setTimeout(r, 500));
    const res = await new Promise(r =>
      chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB' }, r),
    );
    if (res?.ean) { ean = res.ean; market = res.market; break; }
    if (res?.asin) { ean = res.asin; market = 'amazon'; break; }
  }

  btn.disabled = false;
  if (ean) {
    $('eanInp').value = ean;
    setMarket(market || 'ebay');
    const pill = $('pageDetectPill');
    if (pill) {
      pill.textContent = `▲ EAN: ${ean}`;
      pill.style.display = 'inline-flex';
    }
    btn.className = 'fc-scan-page-btn found';
    btn.textContent = '✓ EAN erkannt';
    setTimeout(() => {
      btn.className = 'fc-scan-page-btn';
      btn.textContent = '🔍 Seite scannen';
    }, 2500);
  } else {
    btn.className = 'fc-scan-page-btn';
    btn.textContent = '✗ Kein EAN';
    setTimeout(() => { btn.textContent = '🔍 Seite scannen'; }, 2000);
  }
}

// ── Wire All Events ───────────────────────────────────────────────────────────
function wireEvents() {
  wireTabSwitch();
  wireMarketToggle();
  wireAmzFbmToggle();
  wireEanToAsinBtn();
  wireAsinToEanBtn();

  $('checkBtn').addEventListener('click', runSingleCheck);
  $('eanInp').addEventListener('keydown', e => { if (e.key === 'Enter') runSingleCheck(); });

  // ── 🔍 Seite scannen ──────────────────────────────────────────────────────
  $('scanPageBtn').addEventListener('click', scanCurrentPage);

  // Auto-detect ASIN → switch market
  $('eanInp').addEventListener('input', e => {
    const raw  = e.target.value.trim();
    const val  = raw.toUpperCase();
    const isAsin = /^[A-Z0-9]{10}$/.test(val) && /[A-Z]/.test(val);
    const isEan  = /^\d{8,14}$/.test(raw);
    if (isAsin) setMarket('amazon');
    // Show/hide conversion buttons based on what's in the input
    const eanToAsinBtn  = $('eanToAsinBtn');
    const asinToEanBtn  = $('asinToEanBtn');
    if (eanToAsinBtn)  eanToAsinBtn.style.display  = (isEan  && _market === 'amazon') ? '' : 'none';
    if (asinToEanBtn)  asinToEanBtn.style.display  = (isAsin && _market === 'ebay')   ? '' : 'none';
  });

  $('settingsBtn').addEventListener('click', () => {
    const isOpen = $('panelSettings').style.display !== 'none';
    $('panelSingle').style.display   = isOpen ? '' : 'none';
    $('panelBatch').style.display    = 'none';
    $('panelSettings').style.display = isOpen ? 'none' : '';
    $('settingsBtn').style.opacity   = isOpen ? '' : '0.5';
  });

  $('authLink').addEventListener('click', e => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

  $('cookieSaveBtn').addEventListener('click', async () => {
    const cookie = $('cookieTa').value.trim();
    const status = $('cookieStatus');
    if (!cookie) { status.textContent = '⚠ Cookie fehlt'; status.className = 'fc-settings-status err'; return; }
    $('cookieSaveBtn').disabled = true;
    status.textContent = '…';
    status.className = 'fc-settings-status';
    try {
      const token = await new Promise(r =>
        chrome.runtime.sendMessage({ type: 'AUTH_GET_TOKEN' }, res => r(res?.token)),
      );
      const res = await fetch('https://api.joinflipcheck.app/admin/update-research-cookie', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ cookie }),
      });
      const json = await res.json();
      if (json.ok) {
        status.textContent = '✓ Gespeichert';
        status.className = 'fc-settings-status ok';
        $('cookieTa').value = '';
      } else {
        status.textContent = `✗ ${esc(json.error || 'Fehler')}`;
        status.className = 'fc-settings-status err';
      }
    } catch {
      status.textContent = '✗ Netzwerk-Fehler';
      status.className = 'fc-settings-status err';
    }
    $('cookieSaveBtn').disabled = false;
  });

  // Batch
  $('batchTa').addEventListener('input', updateBatchCount);
  $('batchRunBtn').addEventListener('click', runBatchCheck);
  $('batchCsvBtn').addEventListener('click', exportBatchCsv);
  $('batchCopyBtn').addEventListener('click', copyBatchText);
}

// ═════════════════════════════════════════════════════════════════════════════
// SINGLE CHECK
// ═════════════════════════════════════════════════════════════════════════════

function runSingleCheck() {
  const raw   = $('eanInp').value.trim();
  const upper = raw.toUpperCase();
  const isAsin    = /^[A-Z0-9]{10}$/.test(upper) && /[A-Z]/.test(upper);
  const isEan     = /^\d{8,14}$/.test(raw);
  const isKeyword = !isAsin && !isEan && raw.length >= 2; // model codes, keywords, etc.

  if (!raw || raw.length < 2) {
    setSingleError('Bitte EAN, ASIN oder Suchbegriff eingeben.');
    return;
  }

  const identifier = isAsin ? upper : raw;
  if (isAsin && _market !== 'amazon') setMarket('amazon');

  const mode  = $('modeSel').value || 'mid';
  const catId = $('catSel').value  || 'sonstiges';

  let msg;
  if (_market === 'amazon') {
    const ek      = parseFloat($('ekInpAmz').value)    || 0;
    const shipIn  = parseFloat($('fcAmzShipIn').value) || 0;
    const prepFee = parseFloat($('fcPrepFee').value)   || 0;
    msg = { type: 'AMAZON_CHECK', asin: identifier, ean: identifier, ek, mode,
            method: _asnMethod, catId, shipIn, prepFee };
  } else {
    const ek      = parseFloat($('ekInp').value)    || 0;
    const shipIn  = parseFloat($('fcShipIn').value)  || 0;
    const shipOut = parseFloat($('fcShipOut').value) || 0;
    msg = { type: 'FLIPCHECK', ean: identifier, ek, mode, catId, shipIn, shipOut };
  }

  _currentEan  = identifier;
  _currentData = null;

  setLoading(true);
  clearSingleResult();
  clearSingleError();
  hideUpgradeBanner();

  chrome.runtime.sendMessage(msg, res => {
    setLoading(false);
    if (chrome.runtime.lastError || !res?.ok || !res.data) {
      if (res?.error === 'plan_limit') {
        showUpgradeBanner(res.upgradeUrl);
        setSingleError(`Tageslimit: ${res.dailyLimit || 20} kostenlose Checks/Tag verbraucht.`);
      } else {
        setSingleError('Fehler — Backend nicht erreichbar oder kein Token.');
      }
      return;
    }
    _currentData = res.data;
    renderSingleResult(res.data);
    loadRecent();
  });
}

// ── renderSingleResult ────────────────────────────────────────────────────────
function renderSingleResult(d) {
  const vc = VERDICT_COLORS[d.verdict] || { bg: '#1E1E2E', border: '#2E2E42', text: '#475569' };
  const isAmz = d.market === 'amazon';

  const fmt    = v => (v != null && !isNaN(v)) ? `€${Number(v).toFixed(2)}` : '—';
  const fmtPct = v => (v != null && !isNaN(v)) ? `${Number(v).toFixed(1)}%` : '—';
  const fmtRed = v => (v != null && !isNaN(v) && v > 0) ? `−€${Number(v).toFixed(2)}` : '—';
  const profit    = d.profit_median ?? null;
  const profitCls = profit > 0 ? 'green' : profit < 0 ? 'red' : '';
  const profitStr = profit != null ? `${profit > 0 ? '+' : ''}€${Number(profit).toFixed(2)}` : '—';

  // Fee rows
  let feeRows = '';
  if (isAmz) {
    if (d.referral_fee > 0) feeRows += _feeRow('Referral', fmtRed(d.referral_fee), `(${(d.referral_pct||0).toFixed(1)}%)`);
    if (d.fba_fee      > 0) feeRows += _feeRow('FBA Gebühr', fmtRed(d.fba_fee));
    if (d.prep_fee     > 0) feeRows += _feeRow('PREP', fmtRed(d.prep_fee));
    if (d.ship_in      > 0) feeRows += _feeRow('Versand Lager', fmtRed(d.ship_in));
    if (d.total_fees   > 0) feeRows += _feeRow('Total Gebühren', fmtRed(d.total_fees), '', true);
  } else {
    if (d.fee          > 0) feeRows += _feeRow('eBay Gebühr', fmtRed(d.fee), d.fee_pct ? `(${Number(d.fee_pct).toFixed(1)}%)` : '');
    if (d.shipping_in  > 0) feeRows += _feeRow('Versand rein', fmtRed(d.shipping_in));
    if (d.shipping_out > 0) feeRows += _feeRow('Versand raus', fmtRed(d.shipping_out));
  }

  // EAN↔ASIN cross-reference row
  const xrefHtml = (isAmz && d.ean)
    ? `<div class="fc-xref-row"><span class="fc-xref-lbl">EAN</span><span class="fc-xref-val">${esc(d.ean)}</span></div>`
    : (!isAmz && d.asin)
    ? `<div class="fc-xref-row"><span class="fc-xref-lbl">ASIN</span><span class="fc-xref-val">${esc(d.asin)}</span></div>`
    : '';

  // ROI
  const roiHtml = (isAmz && d.roi_pct != null)
    ? `<div class="fc-kpi"><span class="fc-kpi-v">${Number(d.roi_pct).toFixed(0)}%</span><span class="fc-kpi-l">ROI</span></div>`
    : '';

  const sparkSrc  = d.price_series;
  const refPrice  = isAmz ? (d.buy_box ?? null) : (d.sell_price_median ?? null);
  const sparkHtml = buildSparklineHtml(sparkSrc, refPrice);

  const html = `
    <div class="fc-result-card">
      <div class="fc-verdict-row">
        <span class="fc-verdict-badge" style="background:${vc.bg};color:${vc.text};border:1px solid ${vc.border}">${esc(d.verdict || '—')}</span>
        <span class="fc-profit-big ${profitCls}">${esc(profitStr)}</span>
        ${d.margin_pct != null ? `<span class="fc-margin-tag">· ${fmtPct(d.margin_pct)}</span>` : ''}
      </div>

      ${d.title ? `<div class="fc-result-title">${esc(d.title)}</div>` : ''}
      ${xrefHtml}

      <div class="fc-kpi-grid">
        <div class="fc-kpi">
          <span class="fc-kpi-v">${esc(fmt(d.sell_price_median))}</span>
          <span class="fc-kpi-l">${isAmz ? 'Buy Box' : 'VK Median'}</span>
        </div>
        <div class="fc-kpi">
          <span class="fc-kpi-v ${profitCls}">${esc(profitStr)}</span>
          <span class="fc-kpi-l">Profit</span>
        </div>
        <div class="fc-kpi">
          <span class="fc-kpi-v">${fmtPct(d.margin_pct)}</span>
          <span class="fc-kpi-l">Marge</span>
        </div>
        ${roiHtml || `<div class="fc-kpi">
          <span class="fc-kpi-v">${d.sales_30d != null ? esc(String(d.sales_30d)) : '—'}</span>
          <span class="fc-kpi-l">Verk./30d</span>
        </div>`}
      </div>

      ${feeRows ? `
      <details class="fc-fee-acc">
        <summary>Gebührendetails <span class="fc-acc-arrow">▸</span></summary>
        <div class="fc-fee-rows">${feeRows}</div>
      </details>` : ''}

      ${sparkHtml}

      <div class="fc-result-actions">
        <button class="fc-act-btn" id="fcInvBtn">+ Inventar</button>
        <button class="fc-act-btn" id="fcAlertBtn">Alarm</button>
        ${isAmz && d.ean ? `<button class="fc-act-btn" id="fcEanCopyBtn" title="${esc(d.ean)}">EAN kopieren</button>` : ''}
      </div>
    </div>`;

  const resultEl = $('fcResult');
  resultEl.innerHTML = html;
  resultEl.classList.add('visible');

  resultEl.querySelector('#fcInvBtn')?.addEventListener('click', addToInventory);
  resultEl.querySelector('#fcAlertBtn')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  resultEl.querySelector('#fcEanCopyBtn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(d.ean).then(() => {
      const btn = resultEl.querySelector('#fcEanCopyBtn');
      if (btn) { btn.textContent = '✓ Kopiert'; setTimeout(() => { btn.textContent = 'EAN kopieren'; }, 1500); }
    });
  });
}

function _feeRow(label, val, note = '', bold = false) {
  // label is always a hardcoded string literal — no escaping needed
  // val comes from fmt functions (numeric) — safe
  return `<div class="fc-fee-row">
    <span class="fc-fee-lbl">${label}${note ? ` <span style="opacity:.6;font-size:10px">${note}</span>` : ''}</span>
    <span class="fc-fee-val red"${bold ? ' style="font-weight:800"' : ''}>${val}</span>
  </div>`;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function buildSparklineHtml(series, refPrice) {
  if (!Array.isArray(series) || series.length < 3) {
    return `<div class="fc-sparkline-wrap">
      <div class="fc-sparkline-hdr"><span class="fc-sparkline-lbl">Preisverlauf</span></div>
      <div class="fc-sparkline-empty">Noch keine Preishistorie verfügbar.</div>
    </div>`;
  }

  let pts = series.map(entry => {
    if (Array.isArray(entry) && entry.length >= 2) return { ts: entry[0], p: entry[1] };
    if (Array.isArray(entry) && entry.length === 1) return { ts: 0, p: entry[0] };
    return { ts: 0, p: entry };
  }).filter(e => e.p != null && e.p > 0);

  pts.sort((a, b) => a.ts - b.ts);

  if (refPrice && refPrice > 0) {
    pts = pts.filter(e => e.p >= refPrice / 4 && e.p <= refPrice * 4);
  } else if (pts.length >= 4) {
    const sorted = [...pts.map(e => e.p)].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    pts = pts.filter(e => e.p >= Math.max(0.01, q1 - 3 * iqr) && e.p <= q3 + 3 * iqr);
  }
  if (pts.length < 3) {
    return `<div class="fc-sparkline-wrap">
      <div class="fc-sparkline-hdr"><span class="fc-sparkline-lbl">Preisverlauf</span></div>
      <div class="fc-sparkline-empty">Unzureichende Preisdaten.</div>
    </div>`;
  }

  const prices  = pts.map(e => e.p);
  const minP    = Math.min(...prices);
  const maxP    = Math.max(...prices);
  const range   = maxP - minP || 1;
  const W = 332; const H = 44; const PAD = 4;
  const minTs   = pts[0].ts;
  const maxTs   = pts[pts.length - 1].ts;
  const tsRange = (maxTs - minTs) || 1;
  const useTimeX = minTs > 0 && tsRange > 0;

  const svgPts = pts.map((e, i) => {
    const x = useTimeX
      ? Math.round(((e.ts - minTs) / tsRange) * W)
      : Math.round((i / (pts.length - 1)) * W);
    const y = Math.round(PAD + (1 - (e.p - minP) / range) * (H - PAD * 2));
    return { x, y };
  });

  const pointsStr = svgPts.map(p => `${p.x},${p.y}`).join(' ');
  const lastPt    = svgPts[svgPts.length - 1];
  const lastP     = prices[prices.length - 1];
  const dotColor  = lastP >= (refPrice || lastP) * 0.95 ? '#10B981' : '#6366F1';
  const minLabel  = `€${Number(minP).toFixed(0)}`;
  const maxLabel  = `€${Number(maxP).toFixed(0)}`;

  const fmtDateLabel = ts => {
    if (!ts || ts <= 0) return '';
    const d   = new Date(ts);
    const mon = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'][d.getMonth()];
    return `${d.getDate()}. ${mon}`;
  };
  const dateFrom  = useTimeX ? fmtDateLabel(minTs) : '';
  const dateTo    = useTimeX ? fmtDateLabel(maxTs)  : '';
  const datesHtml = (dateFrom || dateTo)
    ? `<div class="fc-sparkline-dates"><span>${dateFrom}</span><span>${dateTo}</span></div>`
    : '';

  return `<div class="fc-sparkline-wrap">
    <div class="fc-sparkline-hdr">
      <span class="fc-sparkline-lbl">Preisverlauf (${pts.length}d)</span>
      <span class="fc-sparkline-range">${minLabel} – ${maxLabel}</span>
    </div>
    <svg class="fc-sparkline-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="fcSparkGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#6366F1" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#6366F1" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon points="${pointsStr} ${lastPt.x},${H} 0,${H}" fill="url(#fcSparkGrad)"/>
      <polyline points="${pointsStr}" fill="none" stroke="#6366F1" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${lastPt.x}" cy="${lastPt.y}" r="3" fill="${dotColor}" stroke="#0A0A0F" stroke-width="1.5"/>
    </svg>
    ${datesHtml}
  </div>`;
}

// ── addToInventory ─────────────────────────────────────────────────────────────
function addToInventory() {
  if (!_currentEan || !_currentData) return;
  const btn = $('fcResult')?.querySelector('#fcInvBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = '…';

  const ekVal = _market === 'amazon'
    ? parseFloat($('ekInpAmz')?.value) || 0
    : parseFloat($('ekInp')?.value)    || 0;

  chrome.runtime.sendMessage({
    type: 'INVENTORY_ADD',
    item: {
      ean:    _currentEan,
      title:  _currentData.title || '',
      ek:     ekVal,
      status: 'IN_STOCK',
      market: _currentData.market || _market,
      qty:    1,
    },
  }, res => {
    btn.textContent = res?.ok ? '✓ Gespeichert' : 'Desktop inaktiv';
    btn.classList.toggle('success', !!res?.ok);
    setTimeout(() => {
      btn.textContent = '+ Inventar';
      btn.classList.remove('success');
      btn.disabled = false;
    }, 2000);
  });
}

// ── UI Helpers ────────────────────────────────────────────────────────────────
function setLoading(on) {
  $('fcLoading').classList.toggle('visible', on);
  $('checkBtn').disabled = on;
}
function clearSingleResult() {
  const r = $('fcResult');
  r.classList.remove('visible');
  r.innerHTML = '';
}
function setSingleError(msg) {
  const el = $('fcError');
  el.textContent = msg;
  el.classList.add('visible');
}
function clearSingleError() { $('fcError').classList.remove('visible'); }
function showUpgradeBanner(url) {
  if (url) $('upgradeLink').href = url;
  $('upgradeBanner').style.display = '';
}
function hideUpgradeBanner() { $('upgradeBanner').style.display = 'none'; }

// ═════════════════════════════════════════════════════════════════════════════
// BATCH CHECK
// ═════════════════════════════════════════════════════════════════════════════

function updateBatchCount() {
  const eans  = parseBatchEans();
  const count = eans.length;
  const el    = $('batchTaCount');
  el.textContent = count === 0 ? '0 EANs' : `${count} EAN${count !== 1 ? 's' : ''}`;
  el.className = 'fc-batch-count' + (count > 50 ? ' over' : '');
}

function parseBatchEans() {
  return $('batchTa').value
    .split(/[\n,;|\s]+/)
    .map(s => s.trim().replace(/\D/g, ''))
    .filter(s => /^\d{8,14}$/.test(s))
    .slice(0, 50);
}

async function runBatchCheck() {
  if (_batchRunning) return;
  const eans = parseBatchEans();
  if (!eans.length) {
    showBatchError('Keine gültigen EANs gefunden (8–14 Ziffern, eine pro Zeile).');
    return;
  }

  clearBatchError();
  hideUpgradeBanner();
  _batchRunning = true;
  _batchResults = [];

  const ek   = parseFloat($('batchEkInp').value) || 0;
  const mode = $('batchModeSel').value || 'mid';

  const btn = $('batchRunBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Prüfe…';

  const prog      = $('batchProgress');
  const progBar   = $('batchProgressBar');
  const progLabel = $('batchProgressLabel');
  prog.style.display = 'flex';
  progBar.style.width = '0%';
  progLabel.textContent = `0 / ${eans.length}`;

  $('batchResultWrap').style.display = 'none';
  $('batchTbody').innerHTML = '';

  let done = 0;
  const CONCURRENCY = 6;

  for (let i = 0; i < eans.length; i += CONCURRENCY) {
    const chunk = eans.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(ean => new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'FLIPCHECK', ean, ek, mode, catId: 'sonstiges' }, res => {
        done++;
        const pct = Math.round((done / eans.length) * 100);
        progBar.style.width   = pct + '%';
        progLabel.textContent = `${done} / ${eans.length}`;

        if (res?.ok && res.data) {
          const d = res.data;
          _batchResults.push({
            ean, verdict: d.verdict || null, vk: d.sell_price_median,
            profit: d.profit_median, margin: d.margin_pct, sales: d.sales_30d,
            title: d.title || '', error: false,
          });
        } else if (res?.error === 'plan_limit') {
          _batchResults.push({ ean, error: true, planLimit: true });
          showUpgradeBanner(res.upgradeUrl);
        } else {
          _batchResults.push({ ean, error: true });
        }
        resolve();
      });
    })));
  }

  const ORDER = { BUY: 0, HOLD: 1, SKIP: 2 };
  _batchResults.sort((a, b) => {
    if (a.error !== b.error) return a.error ? 1 : -1;
    const oa = ORDER[a.verdict] ?? 3;
    const ob = ORDER[b.verdict] ?? 3;
    if (oa !== ob) return oa - ob;
    return (b.profit ?? -Infinity) - (a.profit ?? -Infinity);
  });

  renderBatchResults();
  btn.disabled = false;
  btn.textContent = '→ Alle prüfen';
  _batchRunning = false;
}

function renderBatchResults() {
  const tbody = $('batchTbody');
  const wrap  = $('batchResultWrap');

  const buy  = _batchResults.filter(r => r.verdict === 'BUY').length;
  const hold = _batchResults.filter(r => r.verdict === 'HOLD').length;
  const skip = _batchResults.filter(r => r.verdict === 'SKIP').length;
  const err  = _batchResults.filter(r => r.error).length;

  $('batchResultCount').textContent = `${_batchResults.length} Ergebnisse`;
  $('batchSummary').innerHTML = [
    buy  ? `<span class="fc-sum-pill buy">${buy} BUY</span>`    : '',
    hold ? `<span class="fc-sum-pill hold">${hold} HOLD</span>` : '',
    skip ? `<span class="fc-sum-pill skip">${skip} SKIP</span>` : '',
    err  ? `<span class="fc-sum-pill err">${err} Fehler</span>` : '',
  ].join('');

  const fmtCur = v => v != null && !isNaN(v) ? `€${Math.round(v)}` : '—';
  const fmtPct = v => v != null && !isNaN(v) ? `${Number(v).toFixed(0)}%` : '—';
  const fmtProfit = v => {
    if (v == null || isNaN(v)) return '—';
    return `${v > 0 ? '+' : ''}€${Number(v).toFixed(2)}`;
  };

  tbody.innerHTML = _batchResults.map(r => {
    if (r.error) {
      const errColor = r.planLimit ? '#6366F1' : '#475569';
      const errText  = r.planLimit ? 'Limit' : 'Fehler';
      return `<tr class="err">
        <td><span class="fc-tbl-ean" title="${esc(r.ean)}">${esc(r.ean.slice(-8))}</span></td>
        <td colspan="5" style="color:${errColor};font-size:10px">${errText}</td>
      </tr>`;
    }
    const vc = VERDICT_COLORS[r.verdict] || { bg: '#1E1E2E', border: '#2E2E42', text: '#475569' };
    const pColor = r.profit > 0 ? '#10B981' : r.profit < 0 ? '#EF4444' : '#94A3B8';
    return `<tr title="${esc(r.title ? r.title.slice(0, 80) : r.ean)}">
      <td><span class="fc-tbl-ean">${esc(r.ean.slice(-8))}</span></td>
      <td><span class="fc-tbl-badge" style="background:${vc.bg};color:${vc.text};border:1px solid ${vc.border}">${esc(r.verdict || '—')}</span></td>
      <td>${fmtCur(r.vk)}</td>
      <td style="color:${pColor}">${fmtProfit(r.profit)}</td>
      <td>${fmtPct(r.margin)}</td>
      <td style="text-align:right">${r.sales ?? '—'}</td>
    </tr>`;
  }).join('');

  wrap.style.display = '';
}

function exportBatchCsv() {
  if (!_batchResults.length) return;
  const header = 'EAN,Titel,Verdict,VK (€),Profit (€),Marge (%),Verk./30d';
  const rows = _batchResults.map(r => {
    if (r.error) return `${r.ean},"","ERROR","","","",""`;
    const q = s => `"${String(s || '').replace(/"/g, '""')}"`;
    return [r.ean, q(r.title), r.verdict || '',
      r.vk     != null ? Number(r.vk).toFixed(2) : '',
      r.profit != null ? Number(r.profit).toFixed(2) : '',
      r.margin != null ? Number(r.margin).toFixed(1) : '',
      r.sales  ?? ''].join(',');
  });
  const csv  = [header, ...rows].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `flipcheck_batch_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  const btn = $('batchCsvBtn');
  btn.textContent = '✓ CSV';
  setTimeout(() => { btn.textContent = '↓ CSV'; }, 1500);
}

function copyBatchText() {
  if (!_batchResults.length) return;
  const lines = _batchResults.map(r => {
    if (r.error) return `${r.ean} | ERROR`;
    const profit = r.profit != null ? `${r.profit > 0 ? '+' : ''}€${Number(r.profit).toFixed(2)}` : '—';
    return `${r.ean} | ${r.verdict || '?'} | ${profit} | ${r.margin != null ? Number(r.margin).toFixed(0) + '%' : '—'} | ${r.sales ?? '—'}/30d`;
  });
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    const btn = $('batchCopyBtn');
    btn.textContent = '✓ Kopiert';
    setTimeout(() => { btn.textContent = '⎘ Copy'; }, 1500);
  });
}

function showBatchError(msg) {
  const el = $('batchError');
  el.textContent = msg;
  el.classList.add('visible');
}
function clearBatchError() { $('batchError').classList.remove('visible'); }
