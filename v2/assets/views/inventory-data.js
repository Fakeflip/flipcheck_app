/* Flipcheck v2 — InventoryData
 *
 * Pure data-processing functions for the Inventory view.
 * No DOM access, no _state closure, no side-effects.
 * Loaded before inventory.js so InventoryView can call InventoryData.*.
 */

const InventoryData = (() => {

  /**
   * Parse a single RFC-4180 CSV line, handling quoted fields and escaped quotes.
   * @param {string} line
   * @returns {string[]}
   */
  function parseCsvLine(line) {
    const result = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === '"')      inQ = true;
        else if (c === ',') { result.push(cur); cur = ""; }
        else cur += c;
      }
    }
    result.push(cur);
    return result;
  }

  /**
   * Parse a full CSV text (with BOM stripping) into inventory items.
   *
   * Returns:
   *   - items   — rows that passed validation (EAN present, types coerced).
   *   - skipped — human-readable descriptions of skipped rows.
   *   - error   — structural error code, or null if none:
   *               "too_few_lines"   — fewer than 2 lines after split
   *               "no_ean_column"   — no EAN/Barcode/GTIN column found
   *
   * @param {string}            text     - Raw CSV file content (may start with BOM).
   * @param {readonly string[]} statuses - Valid FC status strings for validation.
   * @returns {{ items: object[], skipped: string[], error: string|null }}
   */
  function parseCsv(text, statuses) {
    const raw   = text.replace(/^\uFEFF/, "");
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { items: [], skipped: [], error: "too_few_lines" };

    const HEADER_MAP = {
      "ean": "ean", "barcode": "ean", "gtin": "ean",
      "titel": "title", "title": "title", "name": "title", "produkt": "title",
      "ek": "ek", "einkaufspreis": "ek", "purchase price": "ek", "cost": "ek",
      "menge": "qty", "quantity": "qty", "qty": "qty", "anzahl": "qty",
      "markt": "market", "market": "market", "platform": "market",
      "status": "status",
      "vk": "sell_price", "verkaufspreis": "sell_price", "sell price": "sell_price", "sell_price": "sell_price",
      "versand raus": "ship_out", "ship_out": "ship_out", "shipping": "ship_out", "versand": "ship_out",
      "label": "label", "tag": "label",
      "quelle": "source", "source": "source", "bezugsquelle": "source",
      "notiz": "notes", "notes": "notes", "note": "notes",
    };

    const rawHeaders = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
    const colMap     = rawHeaders.map(h => HEADER_MAP[h] || null);
    const eanIdx     = colMap.indexOf("ean");

    if (eanIdx === -1) return { items: [], skipped: [], error: "no_ean_column" };

    const items = [], skipped = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCsvLine(lines[i]);
      const item = {};
      colMap.forEach((field, idx) => {
        if (field && vals[idx] != null) item[field] = vals[idx].trim();
      });
      if (!item.ean) { skipped.push(`Zeile ${i + 1}: EAN fehlt`); continue; }

      // Coerce numeric / status fields
      if (item.ek)         item.ek         = parseFloat(item.ek)         || null;
      if (item.qty)        item.qty        = parseInt(item.qty)          || 1;  else item.qty = 1;
      if (item.sell_price) item.sell_price = parseFloat(item.sell_price) || null;
      if (item.ship_out)   item.ship_out   = parseFloat(item.ship_out)   || 0;

      const rawStatus = (item.status || "").toUpperCase();
      item.status = statuses.includes(rawStatus) ? rawStatus : "IN_STOCK";
      if (item.market) item.market = item.market.toLowerCase();

      items.push(item);
    }

    return { items, skipped, error: null };
  }

  /**
   * Filter and sort inventory items without any closed-over state.
   *
   * @param {object[]} items             - All inventory items.
   * @param {{ q: string, status: string, market: string }} filter - Active filter.
   * @param {{ col: string, dir: 'asc'|'desc' }} sort             - Active sort.
   * @param {function(object): number|null} calcRealProfitFn       - Injected profit calculator.
   * @returns {object[]}
   */
  function getFilteredItems(items, filter, sort, calcRealProfitFn) {
    const q = filter.q.toLowerCase();
    let rows = items.filter(i => {
      if (filter.status && i.status !== filter.status) return false;
      if (filter.market && i.market !== filter.market) return false;
      if (q) {
        const hay = `${i.title} ${i.ean} ${i.sku} ${i.label}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // ── Client-side sort ──────────────────────────────────────────────────
    if (sort.col) {
      const d = sort.dir === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        switch (sort.col) {
          case "title": {
            const av = (a.title || a.ean || "").toLowerCase();
            const bv = (b.title || b.ean || "").toLowerCase();
            return av < bv ? -d : av > bv ? d : 0;
          }
          case "market": {
            const av = (a.market || "").toLowerCase();
            const bv = (b.market || "").toLowerCase();
            return av < bv ? -d : av > bv ? d : 0;
          }
          case "ek":     return ((a.ek || 0) - (b.ek || 0)) * d;
          case "vk":     return ((a.sell_price || 0) - (b.sell_price || 0)) * d;
          case "profit": {
            // Non-SOLD and items with uncalculated profit always sort last
            const _profitOf = item => {
              if (item.status !== "SOLD") return null;
              const p = calcRealProfitFn(item);
              return (p != null && isFinite(p)) ? p : null;
            };
            const ap = _profitOf(a);
            const bp = _profitOf(b);
            if (ap === null && bp === null) return 0;
            if (ap === null) return 1;    // a is null → a goes after b
            if (bp === null) return -1;   // b is null → b goes after a
            return (ap - bp) * d;
          }
          case "status": {
            const av = a.status || ""; const bv = b.status || "";
            return av < bv ? -d : av > bv ? d : 0;
          }
          case "age": {
            // asc = youngest (largest created_at timestamp) first
            const av = a.created_at ? new Date(a.created_at).getTime() : 0;
            const bv = b.created_at ? new Date(b.created_at).getTime() : 0;
            return (bv - av) * d;
          }
          default: return 0;
        }
      });
    }

    return rows;
  }

  return { parseCsvLine, parseCsv, getFilteredItems };
})();
