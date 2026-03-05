// @ts-check
/* Flipcheck v2 — Storage helpers (wraps window.fc IPC calls) */

// @ts-ignore — "Storage" shadows the DOM lib's WebStorage API; our type is declared in globals.d.ts
const Storage = (() => {

  // ── Analytics memo cache ──────────────────────────────────────────────────
  // calcInventoryAnalytics is O(n) and called on every filter/sort change in
  // Inventory view and on every Analytics mount. Cache the result and reuse
  // it when the inventory has not changed since the last call.
  /** @type {{ key: string, result: * } | null} */
  let _analyticsCache = null;

  /**
   * Build a fast O(1) cache key from the items array.
   * Catches additions, deletions, and any field updates (via updated_at).
   * @param {FC_InventoryItem[]} items
   * @returns {string}
   */
  function _analyticsKey(items) {
    const n = items.length;
    if (n === 0) return "empty";
    // Mix: count + first/last updated_at + last id (catches most mutations)
    return `${n}|${items[0].updated_at || ""}|${items[n - 1].updated_at || ""}|${items[n - 1].id || ""}`;
  }

  /** Discard the memoised analytics result (call after any inventory write). */
  function _invalidateAnalytics() { _analyticsCache = null; }

  // ── Inventory ─────────────────────────────────────────────────────────────

  /**
   * Return all inventory items, sorted by `updated_at` descending.
   * @returns {Promise<FC_InventoryItem[]>}
   */
  async function listInventory() {
    try { return await window.fc.inventoryList(); }
    catch { return []; }
  }

  /**
   * Insert or update a single inventory item.
   * The main process runs `normalizeItem()` before persisting.
   * @param {Partial<FC_InventoryItem>} item
   * @returns {Promise<FC_InventoryItem>}
   */
  async function upsertItem(item) {
    try {
      const result = await window.fc.inventoryUpsert(item);
      _invalidateAnalytics();
      return result;
    } catch (e) {
      console.error("[Storage] upsertItem failed:", e);
      throw e; // re-throw so callers can show error feedback
    }
  }

  /**
   * Permanently delete one inventory item by ID.
   * @param {string} id
   * @returns {Promise<{ok: boolean}>}
   */
  async function deleteItem(id) {
    const result = await window.fc.inventoryDelete(id);
    _invalidateAnalytics();
    return result;
  }

  /**
   * Apply a partial patch to multiple items at once (e.g. bulk status change).
   * @param {string[]}                  ids   - Item IDs to update
   * @param {Partial<FC_InventoryItem>} patch - Fields to merge into each item
   * @returns {Promise<{ok: boolean, count: number}>}
   */
  async function bulkUpdate(ids, patch) {
    const result = await window.fc.inventoryBulkUpdate(ids, patch);
    _invalidateAnalytics();
    return result;
  }

  // ── Price History ─────────────────────────────────────────────────────────

  /**
   * Append a single price check entry to the history for one EAN.
   * @param {FC_PriceEntry & {ean: string, title?: string}} entry
   * @returns {Promise<{ok: boolean}|null>}
   */
  async function savePrice(entry) {
    try { return await window.fc.priceHistorySave(entry); }
    catch { return null; }
  }

  /**
   * Save a full 30-day Research series (from metricsTrends) at once.
   * Entries are deduped by calendar day — existing days are NOT overwritten.
   *
   * @param {{ ean: string, title?: string, price_series: Array<[number, number]>, qty_series?: Array<[number, number]> }} params
   * @returns {Promise<{ok: boolean, added: number}|null>}
   */
  async function savePriceSeries({ ean, title, price_series, qty_series }) {
    if (!ean || !price_series?.length) return null;
    try { return await window.fc.priceHistorySaveSeries({ ean, title, price_series, qty_series }); }
    catch { return null; }
  }

  /**
   * Retrieve the full price history for one EAN.
   * Returns an empty entries array if no history exists.
   * @param {string} ean
   * @returns {Promise<FC_PriceHistory>}
   */
  async function getHistory(ean) {
    try { return await window.fc.priceHistoryGet(ean); }
    catch { return { ean, title: ean, entries: [] }; }
  }

  /**
   * Return a lightweight summary list of all tracked EANs.
   * @returns {Promise<FC_PriceHistorySummary[]>}
   */
  async function listHistory() {
    try { return await window.fc.priceHistoryList(); }
    catch { return []; }
  }

  /**
   * Delete all stored history for one EAN.
   * @param {string} ean
   * @returns {Promise<{ok: boolean}|null>}
   */
  async function deleteHistory(ean) {
    try { return await window.fc.priceHistoryDeleteEan(ean); }
    catch { return null; }
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  /** @type {FC_Settings|null} */
  let _settings = null;

  /**
   * Load app settings (result is cached after the first successful call).
   * @returns {Promise<FC_Settings>}
   */
  async function getSettings() {
    if (!_settings) {
      try { _settings = await window.fc.getSettings(); }
      catch { _settings = {}; }
    }
    return _settings;
  }

  /**
   * Merge `patch` into the current settings and persist.
   * @param {Partial<FC_Settings>} patch
   * @returns {Promise<FC_Settings>}
   */
  async function saveSettings(patch) {
    const current = await getSettings();
    _settings = { ...current, ...patch };
    try { await window.fc.setSettings(_settings); }
    catch {}
    return _settings;
  }

  // ── Analytics helpers ─────────────────────────────────────────────────────

  /**
   * Compute all analytics KPIs from a flat array of inventory items.
   * All monetary aggregates are qty-weighted (profit × qty, revenue × qty, etc.).
   *
   * @param {FC_InventoryItem[]} items - Full inventory snapshot
   * @returns {FC_InventoryAnalytics}
   */
  function calcInventoryAnalytics(items) {
    // ── Memo cache ────────────────────────────────────────────────────────────
    const key = _analyticsKey(items);
    if (_analyticsCache && _analyticsCache.key === key) return _analyticsCache.result;
    // ─────────────────────────────────────────────────────────────────────────

    const sold   = items.filter(i => i.status === "SOLD" && i.sell_price && i.ek);
    const active = items.filter(i => FC.ACTIVE_STATUSES.includes(i.status));

    // Real profit = sell_price - ek - ship_out - ebay_fee (uses global calcRealProfit from app.js)
    // NOTE: _rp() is per-unit profit. All aggregates must multiply by qty.
    /** @param {FC_InventoryItem} i @returns {number} */
    const _rp  = i => calcRealProfit(i) ?? 0;
    /** @param {FC_InventoryItem} i @returns {number} */
    const _qty = i => Math.max(1, i.qty || 1);
    const totalProfit  = sold.reduce((s, i) => s + _rp(i)              * _qty(i), 0);
    const totalRevenue = sold.reduce((s, i) => s + (i.sell_price ?? 0) * _qty(i), 0);
    const totalCost    = sold.reduce((s, i) => s + (i.ek ?? 0)         * _qty(i), 0);
    const soldUnits    = sold.reduce((s, i) => s + _qty(i), 0);  // unit count (not record count)
    // avgROI: per-unit ROI × qty, then divide by total qty — guard ek=0 to avoid Infinity
    const avgRoi = soldUnits > 0
      ? sold.reduce((s, i) => {
          if (i.ek == null || i.ek <= 0) return s;  // ek=0, null, NaN → skip (no meaningful ROI)
          return s + (_rp(i) / i.ek * 100) * _qty(i);
        }, 0) / soldUnits
      : 0;

    const activeCash = active.reduce((s, i) => s + (i.ek || 0) * _qty(i), 0);

    // Days to cash: sold_at minus purchase date (ek_date if set, else created_at)
    const soldWithDates = sold.filter(i => i.sold_at && (i.ek_date || i.created_at));
    const avgDaysToCash = soldWithDates.length > 0
      ? soldWithDates.reduce((s, i) => {
          const start = new Date(i.ek_date || i.created_at);
          const end   = new Date(/** @type {string} */ (i.sold_at));
          const days  = (end.getTime() - start.getTime()) / 86400000;
          if (days < 0) console.warn("[Storage] sold_at liegt vor ek_date/created_at:", i.ean, i.sold_at);
          return s + Math.max(0, days);
        }, 0) / soldWithDates.length
      : 0;

    // Profit over time (last 12 weeks)
    const weeklyProfit = calcWeeklyProfit(sold);

    // Market split
    /** @type {Record<string, number>} */
    const marketSplit = {};
    items.forEach(i => {
      const m = i.market || "other";
      marketSplit[m] = (marketSplit[m] || 0) + 1;
    });

    // Best / worst flips — total profit (unit-profit × qty), ROI stays per-unit
    // roi: guard ek=0 to avoid Infinity; null means "no meaningful ROI"
    /** @param {FC_InventoryItem} i */
    const _roiOf = i => (i.ek != null && i.ek > 0) ? (_rp(i) / i.ek * 100) : null;
    const bestFlips = /** @type {FC_InventoryItem[]} */ (
      [...sold]
        .map(i => ({ ...i, profit: _rp(i) * _qty(i), roi: _roiOf(i) }))
        .sort((a, b) => /** @type {any} */ (b).profit - /** @type {any} */ (a).profit)
        .slice(0, 5)
    );

    const worstFlips = /** @type {FC_InventoryItem[]} */ (
      [...sold]
        .map(i => ({ ...i, profit: _rp(i) * _qty(i), roi: _roiOf(i) }))
        .sort((a, b) => /** @type {any} */ (a).profit - /** @type {any} */ (b).profit)
        .slice(0, 5)
    );

    const result = {
      soldCount: soldUnits,          // unit-level count (e.g. 3×qty=2 → 6)
      soldRecords: sold.length,      // record count (for bestFlips/worstFlips lists)
      activeCount: active.length,
      totalCount: items.length,
      totalProfit,
      totalRevenue,
      totalCost,
      avgRoi,
      activeCash,
      avgDaysToCash,
      weeklyProfit,
      marketSplit,
      bestFlips,
      worstFlips,
    };
    _analyticsCache = { key, result };
    return result;
  }

  /**
   * Compute per-week profit totals for the last 12 calendar weeks.
   * @param {FC_InventoryItem[]} soldItems - Items with status === "SOLD"
   * @returns {FC_WeeklyProfitEntry[]}
   */
  function calcWeeklyProfit(soldItems) {
    /** @type {FC_WeeklyProfitEntry[]} */
    const weeks = [];
    const now = new Date();

    for (let w = 11; w >= 0; w--) {
      const start = new Date(now);
      start.setDate(start.getDate() - (w + 1) * 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(end.getDate() - w * 7);
      end.setHours(23, 59, 59, 999);

      const label = `KW${getISOWeek(start)}`;
      const profit = soldItems
        .filter(i => {
          const d = new Date(/** @type {string} */ (i.sold_at || i.updated_at));
          return d >= start && d <= end;
        })
        .reduce((s, i) => s + (calcRealProfit(i) ?? 0) * Math.max(1, i.qty || 1), 0);

      weeks.push({ label, profit });
    }
    return weeks;
  }

  /**
   * Return the ISO week number (01–53) for a given date.
   * @param {Date} date
   * @returns {string} Zero-padded ISO week string, e.g. "07"
   */
  function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return String(Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)).padStart(2, "0");
  }

  // ── Seller Tracker ────────────────────────────────────────────────────────

  /**
   * Return all tracked sellers.
   * @returns {Promise<FC_TrackedSeller[]>}
   */
  async function listSellers() {
    try { return await window.fc.competitionList(); }
    catch { return []; }
  }

  /**
   * Start tracking a new seller by eBay username.
   * @param {string} username
   * @returns {Promise<FC_TrackedSeller[]>} Updated full list of tracked sellers.
   */
  async function addSeller(username) {
    try { return await window.fc.competitionAdd(username); }
    catch { return []; }
  }

  /**
   * Stop tracking a seller.
   * @param {string} username
   * @returns {Promise<FC_TrackedSeller[]>} Updated full list of tracked sellers.
   */
  async function removeSeller(username) {
    try { return await window.fc.competitionRemove(username); }
    catch { return []; }
  }

  /**
   * Update the cached listing count (and optional feedback stats) for one seller.
   * Called by the competition monitor after each API check.
   * @param {string}      username
   * @param {number}      count
   * @param {number|null} feedbackScore
   * @param {number|null} feedbackPct
   * @returns {Promise<{ok: boolean}|null>}
   */
  async function updateSellerCount(username, count, feedbackScore, feedbackPct) {
    try { return await window.fc.competitionUpdateCount(username, count, feedbackScore ?? null, feedbackPct ?? null); }
    catch { return null; }
  }

  // ── Price Alerts ──────────────────────────────────────────────────────────

  /**
   * Return all configured price alerts.
   * @returns {Promise<FC_Alert[]>}
   */
  async function listAlerts() {
    try { return await window.fc.alertsList(); }
    catch { return []; }
  }

  /**
   * Create a new price alert.
   * @param {Partial<FC_Alert>} data
   * @returns {Promise<FC_Alert[]>} Updated full list of alerts.
   */
  async function addAlert(data) {
    try { return await window.fc.alertsAdd(data); }
    catch { return []; }
  }

  /**
   * Delete a price alert by ID.
   * @param {string} id
   * @returns {Promise<FC_Alert[]>} Updated full list of alerts.
   */
  async function removeAlert(id) {
    try { return await window.fc.alertsRemove(id); }
    catch { return []; }
  }

  /**
   * Apply a partial patch to one alert (e.g. update target price).
   * @param {Partial<FC_Alert> & {id: string}} patch
   * @returns {Promise<FC_Alert[]>} Updated full list of alerts.
   */
  async function updateAlert(patch) {
    try { return await window.fc.alertsUpdate(patch); }
    catch { return []; }
  }

  /**
   * Clear the `triggered_at` timestamp on an alert (re-arm it for the next trigger).
   * @param {string} id
   * @returns {Promise<FC_Alert[]>} Updated full list of alerts.
   */
  async function resetAlert(id) {
    try { return await window.fc.alertsReset(id); }
    catch { return []; }
  }

  /**
   * Return the current status of the background competition monitor.
   * @returns {Promise<FC_MonitorStatus|null>}
   */
  async function monitorStatus() {
    try { return await window.fc.competitionMonitorStatus(); }
    catch { return null; }
  }

  /**
   * Change the competition monitor check interval.
   * @param {number} min - Interval in minutes (minimum enforced to 5 in main process)
   * @returns {Promise<{ok: boolean}|null>}
   */
  async function setMonitorInterval(min) {
    try { return await window.fc.competitionSetMonitorInterval(min); }
    catch { return null; }
  }

  return {
    listInventory, upsertItem, deleteItem, bulkUpdate,
    savePrice, savePriceSeries, getHistory, listHistory, deleteHistory,
    getSettings, saveSettings,
    calcInventoryAnalytics,
    /** Discard memoised result (exposed for tests and external forced-refresh). */
    _invalidateAnalytics,
    listSellers, addSeller, removeSeller, updateSellerCount,
    monitorStatus, setMonitorInterval,
    listAlerts, addAlert, removeAlert, updateAlert, resetAlert,
  };
})();
