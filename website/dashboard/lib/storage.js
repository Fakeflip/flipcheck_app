// @ts-check
/* Flipcheck Web App — Storage (API-backed, mirrors v2/assets/lib/storage.js interface) */

const Storage = (() => {

  // ── Analytics memo cache ───────────────────────────────────────────────────
  let _analyticsCache = null;

  function _analyticsKey(items) {
    const n = items.length;
    if (n === 0) return "empty";
    return `${n}|${items[0].updated_at || ""}|${items[n - 1].updated_at || ""}|${items[n - 1].id || ""}`;
  }

  function _invalidateAnalytics() { _analyticsCache = null; }

  // ── Inventory ──────────────────────────────────────────────────────────────

  async function listInventory() {
    try { return await API.call("/inventory") || []; }
    catch { return []; }
  }

  async function upsertItem(item) {
    let result;
    if (item.id) {
      const { id, user_id, created_at, ...patch } = item;
      result = await API.call(`/inventory/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    } else {
      result = await API.call("/inventory", {
        method: "POST",
        body: JSON.stringify(item),
      });
    }
    _invalidateAnalytics();
    return result;
  }

  async function deleteItem(id) {
    const result = await API.call(`/inventory/${id}`, { method: "DELETE" });
    _invalidateAnalytics();
    return result;
  }

  // ── Price History ──────────────────────────────────────────────────────────

  async function getHistory(ean) {
    try { return await API.call(`/price-history/${encodeURIComponent(ean)}`) || { ean, title: ean, entries: [] }; }
    catch { return { ean, title: ean, entries: [] }; }
  }

  async function listHistory() {
    try { return await API.call("/price-history") || []; }
    catch { return []; }
  }

  async function savePriceSeries({ ean, title, price_series, qty_series }) {
    if (!ean || !price_series?.length) return null;
    try {
      return await API.call("/price-history", {
        method: "POST",
        body: JSON.stringify({ ean, title, entries: price_series }),
      });
    } catch { return null; }
  }

  async function deleteHistory(ean) {
    try { return await API.call(`/price-history/${encodeURIComponent(ean)}`, { method: "DELETE" }); }
    catch { return null; }
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  let _settings = null;

  async function getSettings() {
    if (!_settings) {
      try {
        const res = await API.call("/settings");
        _settings = res?.data || {};
      } catch { _settings = {}; }
    }
    return _settings;
  }

  async function saveSettings(patch) {
    const current = await getSettings();
    _settings = { ...current, ...patch };
    try {
      await API.call("/settings", {
        method: "PATCH",
        body: JSON.stringify({ data: patch }),
      });
    } catch {}
    return _settings;
  }

  // ── Alerts ─────────────────────────────────────────────────────────────────

  async function listAlerts() {
    try { return await API.call("/alerts") || []; }
    catch { return []; }
  }

  async function addAlert(data) {
    try {
      const item = await API.call("/alerts", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return await listAlerts();
    } catch { return []; }
  }

  async function removeAlert(id) {
    try {
      await API.call(`/alerts/${id}`, { method: "DELETE" });
      return await listAlerts();
    } catch { return []; }
  }

  async function updateAlert(patch) {
    const { id, ...body } = patch;
    try {
      await API.call(`/alerts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return await listAlerts();
    } catch { return []; }
  }

  async function resetAlert(id) {
    return updateAlert({ id, triggered_at: null });
  }

  // ── Analytics helpers ──────────────────────────────────────────────────────

  function calcInventoryAnalytics(items) {
    const key = _analyticsKey(items);
    if (_analyticsCache && _analyticsCache.key === key) return _analyticsCache.result;

    const sold   = items.filter(i => i.status === "SOLD" && i.sell_price && i.ek);
    const active = items.filter(i => FC.ACTIVE_STATUSES.includes(i.status));

    const _rp  = i => calcRealProfit(i) ?? 0;
    const _qty = i => Math.max(1, i.qty || 1);

    const totalProfit  = sold.reduce((s, i) => s + _rp(i)              * _qty(i), 0);
    const totalRevenue = sold.reduce((s, i) => s + (i.sell_price ?? 0) * _qty(i), 0);
    const totalCost    = sold.reduce((s, i) => s + (i.ek ?? 0)         * _qty(i), 0);
    const soldUnits    = sold.reduce((s, i) => s + _qty(i), 0);
    const avgRoi = soldUnits > 0
      ? sold.reduce((s, i) => {
          if (i.ek == null || i.ek <= 0) return s;
          return s + (_rp(i) / i.ek * 100) * _qty(i);
        }, 0) / soldUnits
      : 0;

    const activeCash = active.reduce((s, i) => s + (i.ek || 0) * _qty(i), 0);

    const soldWithDates = sold.filter(i => i.sold_at && (i.ek_date || i.created_at));
    const avgDaysToCash = soldWithDates.length > 0
      ? soldWithDates.reduce((s, i) => {
          const start = new Date(i.ek_date || i.created_at);
          const end   = new Date(i.sold_at);
          return s + Math.max(0, (end.getTime() - start.getTime()) / 86400000);
        }, 0) / soldWithDates.length
      : 0;

    const weeklyProfit = calcWeeklyProfit(sold);

    const marketSplit = {};
    items.forEach(i => {
      const m = i.market || "other";
      marketSplit[m] = (marketSplit[m] || 0) + 1;
    });

    const _roiOf = i => (i.ek != null && i.ek > 0) ? (_rp(i) / i.ek * 100) : null;
    const bestFlips  = [...sold].map(i => ({ ...i, profit: _rp(i) * _qty(i), roi: _roiOf(i) }))
      .sort((a, b) => b.profit - a.profit).slice(0, 5);
    const worstFlips = [...sold].map(i => ({ ...i, profit: _rp(i) * _qty(i), roi: _roiOf(i) }))
      .sort((a, b) => a.profit - b.profit).slice(0, 5);

    const result = {
      soldCount: soldUnits, soldRecords: sold.length,
      activeCount: active.length, totalCount: items.length,
      totalProfit, totalRevenue, totalCost,
      avgRoi, activeCash, avgDaysToCash,
      weeklyProfit, marketSplit, bestFlips, worstFlips,
    };
    _analyticsCache = { key, result };
    return result;
  }

  function calcWeeklyProfit(soldItems) {
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
          const d = new Date(i.sold_at || i.updated_at);
          return d >= start && d <= end;
        })
        .reduce((s, i) => s + (calcRealProfit(i) ?? 0) * Math.max(1, i.qty || 1), 0);
      weeks.push({ label, profit });
    }
    return weeks;
  }

  function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return String(Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)).padStart(2, "0");
  }

  return {
    listInventory, upsertItem, deleteItem,
    getHistory, listHistory, savePriceSeries, deleteHistory,
    getSettings, saveSettings,
    listAlerts, addAlert, removeAlert, updateAlert, resetAlert,
    calcInventoryAnalytics,
    _invalidateAnalytics,
  };
})();
