/* Flipcheck Extension — Background Service Worker (MV3) v2
 *
 * Improvements:
 *  - Firefox/Chrome API polyfill (_cr)
 *  - L2 persistent cache (chrome.storage.local) survives SW dormancy
 *  - Context menu: "Mit Flipcheck prüfen" on text selection
 *  - New message types: INVENTORY_CHECK, PRICE_HISTORY_GET, ALERTS_CREATE
 */

// ── Firefox / Chrome polyfill ─────────────────────────────────────────────────
const _cr = (typeof browser !== 'undefined' && browser?.runtime) ? browser : chrome;

// ── In-Memory L1 Cache (5min TTL, max 200 entries) ───────────────────────────
const _cache    = new Map(); // key: "EAN:EK:mode" → { ts, data }
const _inflight = new Map(); // deduplication
let   _token    = null;

// ── API Concurrency Limiter (max 4 simultaneous requests) ────────────────────
// Prevents batch-checks from hammering the backend and triggering rate-limits.
const API_CONCURRENCY = 4;
let   _apiConcurrent  = 0;
/** @type {Array<() => void>} */
const _apiQueue       = [];

function _acquireSlot() {
  return new Promise(resolve => {
    if (_apiConcurrent < API_CONCURRENCY) { _apiConcurrent++; resolve(); }
    else { _apiQueue.push(resolve); }
  });
}

function _releaseSlot() {
  const next = _apiQueue.shift();
  if (next) { next(); } // hand slot directly to next waiter
  else { _apiConcurrent--; }
}

/**
 * Fetch with per-attempt timeout, the concurrency limiter, and 429 exponential-backoff retry.
 * Plan-limit 429s are returned immediately so the caller can show an upgrade prompt.
 * Timeout/abort errors break the retry loop (slow server, not rate-limited).
 *
 * @param {string}      url
 * @param {RequestInit} opts        - Must NOT include `signal` — a fresh one is created per attempt.
 * @param {number}      [timeoutMs] - Per-attempt timeout in ms (default 15 000).
 * @param {number}      [maxRetries]- Max 429-retry attempts beyond the first try (default 3).
 * @returns {Promise<Response>}
 */
async function _fetchWithRetry(url, opts, timeoutMs = 15000, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Exponential back-off before retries: 1 s, 2 s, 4 s
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));

    await _acquireSlot();
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429) {
        // Plan-limit 429: pass through immediately — caller shows upgrade prompt, no retry
        try {
          const body = await res.clone().json(); // clone keeps original body readable
          if (body.error === 'plan_limit') { _releaseSlot(); return res; }
        } catch (_) {}
        // Rate-limit 429 (burst throttle) → retry with back-off
        _releaseSlot();
        lastErr = new Error('HTTP 429');
        continue;
      }
      _releaseSlot();
      return res;
    } catch (e) {
      _releaseSlot();
      lastErr = e;
      if (e.name === 'AbortError' || e.name === 'TimeoutError') break; // don't retry timeouts
    }
  }
  throw lastErr || new Error('fetch failed');
}

// ── L2 Persistent Cache (chrome.storage.local) ───────────────────────────────
const L2_KEY    = 'fc_l2_cache';
const L2_TTL_MS = 30 * 60 * 1000; // 30 min (longer than L1)
const L2_MAX    = 500;

async function l2Get(key) {
  try {
    const store = await _cr.storage.local.get(L2_KEY);
    const l2    = store[L2_KEY] || {};
    const entry = l2[key];
    if (entry && Date.now() - entry.ts < L2_TTL_MS) return entry.data;
    return null;
  } catch { return null; }
}

async function l2Set(key, data) {
  try {
    const store = await _cr.storage.local.get(L2_KEY);
    const l2    = store[L2_KEY] || {};
    l2[key]     = { ts: Date.now(), data };
    const keys  = Object.keys(l2);
    if (keys.length > L2_MAX) {
      keys.sort((a, b) => l2[a].ts - l2[b].ts)
          .slice(0, keys.length - L2_MAX)
          .forEach(k => delete l2[k]);
    }
    await _cr.storage.local.set({ [L2_KEY]: l2 });
  } catch {}
}

async function l2Evict() {
  try {
    const store = await _cr.storage.local.get(L2_KEY);
    const l2    = store[L2_KEY] || {};
    const now   = Date.now();
    let changed = false;
    for (const k of Object.keys(l2)) {
      if (now - l2[k].ts > L2_TTL_MS) { delete l2[k]; changed = true; }
    }
    if (changed) await _cr.storage.local.set({ [L2_KEY]: l2 });
  } catch {}
}

// ── Token Management ──────────────────────────────────────────────────────────
async function getToken() {
  if (_token) return _token;
  const store = await _cr.storage.local.get(['fc_token', 'fc_token_exp']);
  if (store.fc_token && store.fc_token_exp > Date.now()) {
    _token = store.fc_token;
    return _token;
  }
  try {
    const r = await fetch('http://127.0.0.1:8766/token', {
      signal: AbortSignal.timeout(1500),
    });
    if (r.ok) {
      const { token, exp } = await r.json();
      if (token) {
        _token = token;
        const expiry = exp || (Date.now() + 7 * 24 * 3600 * 1000);
        await _cr.storage.local.set({ fc_token: token, fc_token_exp: expiry });
        return _token;
      }
    }
  } catch {}
  return null;
}

// ── Flipcheck API Call (L1 → L2 → Network) ───────────────────────────────────
async function apiFlipcheck({ ean, ek = 0, mode = 'mid', catId = 'sonstiges', shipIn = 0, shipOut = 0 }) {
  const ekNum      = parseFloat(ek)      || 0;
  const shipInNum  = parseFloat(shipIn)  || 0;
  const shipOutNum = parseFloat(shipOut) || 0;
  const key        = `${ean}:${ekNum}:${mode}:${shipInNum}:${shipOutNum}`;

  // L1 hit
  const l1 = _cache.get(key);
  if (l1 && Date.now() - l1.ts < 5 * 60 * 1000) return l1.data;

  // Dedup in-flight
  if (_inflight.has(key)) return _inflight.get(key);

  const promise = (async () => {
    // L2 hit (persisted from previous SW session)
    const l2data = await l2Get(key);
    if (l2data) {
      _cache.set(key, { ts: Date.now(), data: l2data });
      _inflight.delete(key);
      return l2data;
    }

    const token   = await getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await _fetchWithRetry('https://api.joinflipcheck.app/flipcheck', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ean, ek: ekNum, mode, category: catId, shipping_in: shipInNum, shipping_out: shipOutNum }),
    }, 15000);
    if (!res.ok) {
      // Free plan daily limit: parse 429 body and return a sentinel (don't cache)
      if (res.status === 429) {
        try {
          const errBody = await res.json();
          if (errBody.error === 'plan_limit') {
            _inflight.delete(key);
            return { _planLimit: true, upgradeUrl: errBody.upgrade_url, dailyLimit: errBody.daily_limit };
          }
        } catch (_) {}
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();

    // Write L1 + L2
    _cache.set(key, { ts: Date.now(), data });
    if (_cache.size > 200) _cache.delete(_cache.keys().next().value);
    await l2Set(key, data);
    _inflight.delete(key);
    return data;
  })();

  _inflight.set(key, promise);
  promise.catch(() => _inflight.delete(key));
  return promise;
}

// ── Amazon Check API Call (L1 → L2 → Network) ────────────────────────────────
async function apiAmazonCheck({ asin, ean, ek = 0, mode = 'mid', method = 'fba', shipIn = 4.99, catId = 'sonstiges', prepFee = 0 }) {
  const ekNum    = parseFloat(ek) || 0;
  const prepNum  = parseFloat(prepFee) || 0;
  const key      = `amz:${asin}:${ekNum}:${mode}:${method}:${prepNum}`;

  // L1 hit
  const l1 = _cache.get(key);
  if (l1 && Date.now() - l1.ts < 5 * 60 * 1000) return l1.data;
  if (_inflight.has(key)) return _inflight.get(key);

  const promise = (async () => {
    // L2 hit
    const l2data = await l2Get(key);
    if (l2data) {
      _cache.set(key, { ts: Date.now(), data: l2data });
      _inflight.delete(key);
      return l2data;
    }

    const token   = await getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await _fetchWithRetry('https://api.joinflipcheck.app/amazon-check', {
      method:  'POST',
      headers,
      body:    JSON.stringify({ asin, ean, ek: ekNum, mode, method, ship_in: shipIn, category: catId, prep_fee: prepNum }),
    }, 20000);

    if (!res.ok) {
      if (res.status === 429) {
        try {
          const errBody = await res.json();
          if (errBody.error === 'plan_limit') {
            _inflight.delete(key);
            return { _planLimit: true, upgradeUrl: errBody.upgrade_url, dailyLimit: errBody.daily_limit };
          }
        } catch (_) {}
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();

    _cache.set(key, { ts: Date.now(), data });
    if (_cache.size > 200) _cache.delete(_cache.keys().next().value);
    await l2Set(key, data);
    _inflight.delete(key);
    return data;
  })();

  _inflight.set(key, promise);
  promise.catch(() => _inflight.delete(key));
  return promise;
}

// ── Bridge Helpers ────────────────────────────────────────────────────────────
async function bridgeGet(path) {
  const r = await fetch(`http://127.0.0.1:8766${path}`, {
    signal: AbortSignal.timeout(2000),
  });
  if (!r.ok) throw new Error(`bridge_err_${r.status}`);
  return r.json();
}

async function bridgePost(path, body) {
  const r = await fetch(`http://127.0.0.1:8766${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2000),
  });
  if (!r.ok) throw new Error(`bridge_err_${r.status}`);
  return r.json();
}

// ── Save Recent ───────────────────────────────────────────────────────────────
async function saveRecent(ean, result) {
  const store    = await _cr.storage.local.get('fc_recent');
  const recent   = store.fc_recent || [];
  const filtered = recent.filter(r => r.ean !== ean);
  filtered.unshift({
    ean,
    verdict: result.verdict,
    profit:  result.profit_median,
    vk:      result.sell_price_median,
    title:   result.title ? result.title.slice(0, 60) : '',
    ts:      Date.now(),
  });
  await _cr.storage.local.set({ fc_recent: filtered.slice(0, 20) });
}

// ── Context Menu ──────────────────────────────────────────────────────────────
function setupContextMenu() {
  _cr.contextMenus.create({
    id:       'fc_check_selection',
    title:    'Mit Flipcheck prüfen: "%s"',
    contexts: ['selection'],
  }, () => { if (_cr.runtime.lastError) {} }); // suppress already-exists errors on reload
}

_cr.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'fc_check_selection') return;
  const text = (info.selectionText || '').trim().replace(/\s/g, '');
  if (!/^\d{8,14}$/.test(text)) {
    _cr.tabs.sendMessage(tab.id, { type: 'CONTEXT_EAN_INVALID', text }).catch(() => {});
    return;
  }
  _cr.tabs.sendMessage(tab.id, { type: 'CONTEXT_EAN_PROBE', ean: text })
    .catch(() => { _cr.action.openPopup?.(); });
});

// ── Message Handler ───────────────────────────────────────────────────────────
_cr.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    try {
      switch (msg.type) {

        case 'FLIPCHECK': {
          const data = await apiFlipcheck(msg);
          if (data?._planLimit) {
            // Free plan exhausted — forward upgrade info to the caller
            reply({ ok: false, error: 'plan_limit', upgradeUrl: data.upgradeUrl, dailyLimit: data.dailyLimit });
          } else {
            await saveRecent(msg.ean, data).catch(() => {});
            reply({ ok: true, data });
          }
          break;
        }

        case 'AMAZON_CHECK': {
          const data = await apiAmazonCheck(msg);
          if (data?._planLimit) {
            reply({ ok: false, error: 'plan_limit', upgradeUrl: data.upgradeUrl, dailyLimit: data.dailyLimit });
          } else {
            reply({ ok: true, data });
          }
          break;
        }

        case 'BRIDGE_STATUS': {
          try { reply({ ok: true,  data: await bridgeGet('/status') }); }
          catch { reply({ ok: false, data: null }); }
          break;
        }

        case 'INVENTORY_GET': {
          try { reply({ ok: true,  data: await bridgeGet('/inventory') }); }
          catch { reply({ ok: false, error: 'bridge_unavailable' }); }
          break;
        }

        case 'INVENTORY_ADD': {
          try { reply({ ok: true, data: await bridgePost('/inventory', msg.item) }); }
          catch { reply({ ok: false, error: 'bridge_unavailable' }); }
          break;
        }

        case 'INVENTORY_CHECK': {
          try {
            const inv   = await bridgeGet('/inventory');
            const items = Array.isArray(inv?.items) ? inv.items
                        : Array.isArray(inv) ? inv : [];
            const found = items.find(i => i.ean === msg.ean);
            reply({ ok: true, found: !!found, item: found || null });
          } catch {
            reply({ ok: false, found: false, item: null });
          }
          break;
        }

        case 'PRICE_HISTORY_GET': {
          try {
            const data = await bridgeGet(`/price-history?ean=${encodeURIComponent(msg.ean)}`);
            reply({ ok: true, data });
          } catch {
            reply({ ok: false, data: null });
          }
          break;
        }

        case 'ALERTS_CREATE': {
          try {
            const data = await bridgePost('/alerts', msg.alert);
            reply({ ok: true, data });
          } catch {
            reply({ ok: false, error: 'bridge_unavailable' });
          }
          break;
        }

        // ── Amazon SERP quick-check (ek=0, no cost inputs needed) ─────────────
        case 'AMAZON_SERP_CHECK': {
          const serpData = await apiAmazonCheck({ asin: msg.asin, ean: '', ek: 0, mode: 'mid' });
          if (serpData?._planLimit) {
            reply({ ok: false, error: 'plan_limit', upgradeUrl: serpData.upgradeUrl });
          } else {
            reply({ ok: true, data: serpData });
          }
          break;
        }

        // ── ASIN → EAN: resolve via amazon-check (response contains ean field) ─
        case 'ASIN_TO_EAN': {
          try {
            const asinData = await apiAmazonCheck({ asin: msg.asin, ean: '', ek: 0, mode: 'mid' });
            reply({ ok: true, ean: asinData?.ean || null, asin: msg.asin, title: asinData?.title || null });
          } catch {
            reply({ ok: false, ean: null });
          }
          break;
        }

        // ── EAN → ASIN: fetch Amazon search page, extract first product ASIN ──
        case 'EAN_TO_ASIN': {
          try {
            const searchUrl = `https://www.amazon.de/s?k=${encodeURIComponent(msg.ean)}&i=aps`;
            const searchRes = await fetch(searchUrl, {
              signal: AbortSignal.timeout(8000),
              headers: { 'Accept-Language': 'de-DE,de;q=0.9', 'Accept': 'text/html' },
            });
            if (!searchRes.ok) throw new Error(`HTTP ${searchRes.status}`);
            const html  = await searchRes.text();
            const match = html.match(/data-asin="([A-Z0-9]{10})"/);
            reply({ ok: true, asin: match ? match[1] : null });
          } catch {
            reply({ ok: false, asin: null });
          }
          break;
        }

        // ── Trigger EAN scan in the active tab's content script ───────────
        case 'TRIGGER_EAN_SCAN': {
          try {
            const tabs = await _cr.tabs.query({ active: true, currentWindow: true });
            const tab  = tabs?.[0];
            if (!tab) { reply({ ok: false }); break; }
            await _cr.tabs.sendMessage(tab.id, { type: 'TRIGGER_EAN_SCAN' });
            reply({ ok: true });
          } catch {
            reply({ ok: false }); // content script not loaded on this tab
          }
          break;
        }

        // ── Toggle the floating panel in the active tab ───────────────────
        case 'TOGGLE_PANEL': {
          try {
            const tabs = await _cr.tabs.query({ active: true, currentWindow: true });
            const tab  = tabs?.[0];
            if (tab) await _cr.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(() => {});
            reply({ ok: true });
          } catch {
            reply({ ok: false });
          }
          break;
        }

        // ── Get active tab info (URL + ASIN + panel EAN detection) ──────────
        case 'GET_ACTIVE_TAB': {
          try {
            const tabs = await _cr.tabs.query({ active: true, currentWindow: true });
            const tab  = tabs?.[0];
            if (!tab) { reply({ ok: false }); break; }
            const url   = tab.url || '';
            const asinM = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
            const asin  = asinM ? asinM[1].toUpperCase() : null;

            // Ask the content-script panel for its currently detected EAN
            let ean    = null;
            let market = null;
            try {
              const panelRes = await _cr.tabs.sendMessage(tab.id, { type: 'GET_PANEL_EAN' });
              if (panelRes?.ean) { ean = panelRes.ean; market = panelRes.market || 'ebay'; }
            } catch { /* content script not present on this tab — ignore */ }

            reply({ ok: true, asin, ean, market, url, title: tab.title || '' });
          } catch {
            reply({ ok: false });
          }
          break;
        }

        case 'AUTH_GET_TOKEN':
          reply({ ok: true, token: await getToken() });
          break;

        case 'AUTH_SET_TOKEN':
          _token = msg.token;
          await _cr.storage.local.set({
            fc_token:     msg.token,
            fc_token_exp: Date.now() + 7 * 24 * 3600 * 1000,
          });
          reply({ ok: true });
          break;

        case 'AUTH_CLEAR':
          _token = null;
          await _cr.storage.local.remove(['fc_token', 'fc_token_exp']);
          reply({ ok: true });
          break;

        case 'LOGIN': {
          // Chrome identity OAuth flow (no Electron required)
          try {
            const redirectBase = 'https://api.joinflipcheck.app/auth/discord/login';
            const authUrl = redirectBase;
            _cr.tabs.create({ url: authUrl });
            reply({ ok: true });
          } catch (e) {
            reply({ ok: false, error: e.message });
          }
          break;
        }

        case 'SETTINGS_GET': {
          const s = await _cr.storage.local.get('fc_settings');
          reply({ ok: true, data: s.fc_settings || {} });
          break;
        }

        case 'SETTINGS_SET':
          await _cr.storage.local.set({ fc_settings: msg.settings });
          reply({ ok: true });
          break;

        case 'RECENT_GET': {
          const s = await _cr.storage.local.get('fc_recent');
          reply({ ok: true, data: s.fc_recent || [] });
          break;
        }

        default:
          reply({ ok: false, error: 'unknown_msg_type' });
      }
    } catch (e) {
      reply({ ok: false, error: e.message });
    }
  })();
  return true; // keep async channel open
});

// ── Startup ───────────────────────────────────────────────────────────────────
_cr.runtime.onInstalled.addListener(() => setupContextMenu());
_cr.runtime.onStartup.addListener(() => setupContextMenu());

// ── Alt+F global shortcut → toggle floating panel in active tab ──────────────
_cr.commands.onCommand.addListener(async command => {
  if (command !== 'toggle-panel') return;
  try {
    const tabs = await _cr.tabs.query({ active: true, currentWindow: true });
    const tab  = tabs?.[0];
    if (tab) _cr.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(() => {});
  } catch {}
});

// ── Periodic Cache Eviction (every 5 min) ────────────────────────────────────
_cr.alarms.create('fc_cache_evict', { periodInMinutes: 5 });
_cr.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'fc_cache_evict') return;
  const now = Date.now();
  for (const [k, v] of _cache) {
    if (now - v.ts > 5 * 60 * 1000) _cache.delete(k);
  }
  l2Evict();
  if (_token) {
    _cr.storage.local.get('fc_token_exp').then(({ fc_token_exp }) => {
      if (fc_token_exp && fc_token_exp < Date.now()) _token = null;
    });
  }
});
