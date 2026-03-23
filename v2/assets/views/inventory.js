/* Flipcheck v2 — Inventory View
 *
 * Manages the full inventory lifecycle: display, filter, sort, virtual
 * scrolling, add/edit/sell modals, CSV import/export, and Flipcheck
 * deep-link navigation.
 *
 * External dependencies (globals from app.js / lib/):
 *   FC, Toast, Modal, Storage, App, navigateTo,
 *   calcRealProfit, calcEbayFee, fmtEur, esc, EBAY_FEE_CATEGORIES
 */

/**
 * @namespace InventoryView
 * @property {function(HTMLElement): Promise<void>} mount   - Initialise the view inside container.
 * @property {function(): void}                     unmount - Tear down (clear container ref).
 */
const InventoryView = (() => {

  // ── State ────────────────────────────────────────────────────────────────
  // All mutable view state lives in one object — easy to reset, inspect and test.
  /**
   * @type {{
   *   container: HTMLElement|null,
   *   items:     object[],
   *   selected:  Set<string>,
   *   filter:    { q: string, status: string, market: string },
   *   sort:      { col: string, dir: 'asc'|'desc' },
   *   vs:        { data: object[], wrap: HTMLElement|null, busy: boolean },
   * }}
   */
  const _state = {
    container: null,
    items:     [],
    selected:  new Set(),
    filter:    { q: "", status: "", market: "", source: "", shipped: "" },
    sort:      { col: "age", dir: "asc" },
    vs:        { data: [], wrap: null, busy: false },
  };

  // Virtual scroller constants come from the shared FC namespace.
  const { VS_ROW_H, VS_BUF } = FC;

  // Convenience aliases — FC values used heavily inside this module.
  const STATUSES     = FC.STATUSES;
  const STATUS_LABELS = FC.STATUS_LABELS;
  const MARKETS      = FC.MARKETS;

  // ── Virtual Scroller helpers ───────────────────────────────────────────
  function _vsRender() {
    _state.vs.busy = false;
    const el = _state.vs.wrap;
    if (!el) return;

    const scrollTop = el.scrollTop;
    const height    = el.clientHeight || 480;
    const total     = _state.vs.data.length;

    // Calculate the window of rows to materialise
    const first = Math.floor(scrollTop / VS_ROW_H);
    const start = Math.max(0, first - VS_BUF);
    const end   = Math.min(total, first + Math.ceil(height / VS_ROW_H) + VS_BUF);

    // Spacer heights hold the invisible rows in place
    const topH = start * VS_ROW_H;
    const botH = Math.max(0, (total - end) * VS_ROW_H);

    const tbody = el.querySelector("tbody");
    if (!tbody) return;

    let html = "";
    if (topH > 0)
      html += `<tr class="inv-vs-spacer"><td colspan="13" style="height:${topH}px"></td></tr>`;
    html += _state.vs.data.slice(start, end).map(renderRow).join("");
    if (botH > 0)
      html += `<tr class="inv-vs-spacer"><td colspan="13" style="height:${botH}px"></td></tr>`;

    tbody.innerHTML = html;
  }

  function _vsScroll() {
    if (_state.vs.busy) return;
    _state.vs.busy = true;
    requestAnimationFrame(_vsRender);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Mount the inventory view into the given container.
   * Resets all state (filter, sort, selection) on each navigation.
   * @param {HTMLElement} container - The view root element.
   * @returns {Promise<void>}
   */
  // Scanner IPC callback — fills EAN field in whichever modal is currently open
  function _onInvScannerEan(ean) {
    const inp = document.getElementById("mEan") || document.getElementById("invScanEan");
    if (!inp) return;
    inp.value = ean;
    inp.dispatchEvent(new Event("input"));
    inp.focus();
    if (typeof Toast !== "undefined") Toast.success(I18N.t('inv.scanner.toast_title'), ean);
  }

  async function mount(container) {
    // Reset state fresh on every mount
    _state.container = container;
    _state.selected  = new Set();
    _state.filter    = { q: "", status: "", market: "", source: "", shipped: "" };
    _state.sort      = { col: "age", dir: "asc" };
    _state.vs        = { data: [], wrap: null, busy: false };

    container.innerHTML = renderShell();
    attachFilterEvents(container);
    attachTableDelegation(container); // delegated once on stable parent — survives re-renders

    await loadItems(container);

    // Barcode scanner IPC listener
    window.fc?.onScannerEan(_onInvScannerEan);

    // Extension Bridge — live push from browser extension via POST /inventory
    window.fc?.onInventoryUpsertExt?.((item) => {
      if (item && _state.container) {
        Storage.upsertItem(item)
          .then(() => loadItems(_state.container))
          .catch(() => {});
      }
    });
  }

  /**
   * Tear down the view — drop the container reference so async callbacks stop.
   */
  function unmount() {
    window.fc?.offScannerEan(_onInvScannerEan);
    _state.container = null;
    _state.vs.wrap   = null;
  }

  function renderShell() {
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>${I18N.t('nav.inventory')}</h1>
          <p id="invCount">${I18N.t('inv.loading')}</p>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-ghost btn-sm" id="btnImportCsv" title="CSV importieren">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            ${I18N.t('inv.btn.import')}
          </button>
          <button class="btn btn-ghost btn-sm" id="btnExportCsv" title="CSV exportieren">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 10V2M5 5l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            ${I18N.t('inv.btn.export')}
          </button>
          <button class="btn btn-primary btn-sm" id="btnAddItem">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            ${I18N.t('inv.btn.add')}
          </button>
          <button class="btn btn-secondary btn-sm" id="btnRefreshInv">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 2v4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>

      <!-- Stats Bar -->
      <div id="invStatsBar" class="inv-stats-bar" style="display:none"></div>

      <!-- Filters -->
      <div class="inv-filters">
        <input id="invSearch" class="input" type="search" placeholder="${I18N.t('inv.filter.search_placeholder')}" style="flex:1;max-width:280px" />
        <select id="invStatusFilter" class="select">
          <option value="">${I18N.t('inv.filter.all_status')}</option>
          ${STATUSES.map(s => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join("")}
        </select>
        <select id="invMarketFilter" class="select">
          <option value="">${I18N.t('inv.filter.all_markets')}</option>
          ${MARKETS.map(m => `<option value="${m}">${m.toUpperCase()}</option>`).join("")}
        </select>
        <select id="invSourceFilter" class="select">
          <option value="">Alle Quellen</option>
          <option value="manual">Manuell</option>
          <option value="ebay_sync">eBay Sync</option>
          <option value="extension">Extension</option>
          <option value="csv">CSV Import</option>
        </select>
        <select id="invShippedFilter" class="select">
          <option value="">Versand: Alle</option>
          <option value="pending">📦 Ausstehend</option>
          <option value="shipped">✅ Versendet</option>
        </select>
      </div>

      <!-- Bulk Bar -->
      <div id="invBulkBar" class="inv-bulk-bar" style="display:none">
        <span id="invBulkCount">0 ${I18N.t('inv.bulk.selected')}</span>
        <select id="invBulkStatus" class="select" style="max-width:160px;font-size:12px;padding:4px 8px;height:28px">
          <option value="">${I18N.t('inv.bulk.set_status')}</option>
          ${STATUSES.map(s => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join("")}
        </select>
        <button class="btn btn-secondary btn-sm" id="btnBulkApply">${I18N.t('inv.bulk.apply')}</button>
        <button class="btn btn-danger btn-sm" id="btnBulkDelete">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          ${I18N.t('inv.bulk.delete')}
        </button>
        <button class="btn btn-ghost btn-sm" id="btnBulkCancel" style="margin-left:auto">${I18N.t('inv.bulk.cancel')}</button>
      </div>

      <!-- Table -->
      <div class="panel" style="padding:0;overflow:hidden">
        <div id="invTableWrap">
          <div class="empty-state" style="padding:40px">
            <div class="spinner"></div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Data layer ───────────────────────────────────────────────────────────

  /**
   * Fetch all inventory items from storage and re-render the table.
   * @param {HTMLElement} container
   * @returns {Promise<void>}
   */
  async function loadItems(container) {
    try {
      _state.items = await Storage.listInventory();
    } catch {
      _state.items = [];
    }
    renderTable(container);
    updateCount(container);
  }

  // ── Business logic ───────────────────────────────────────────────────────

  /**
   * Return items matching the active filter and sorted per _state.sort.
   * Delegates to InventoryData.getFilteredItems — view state is injected explicitly.
   * @returns {object[]}
   */
  function getFiltered() {
    return InventoryData.getFilteredItems(_state.items, _state.filter, _state.sort, calcRealProfit);
  }

  // ── Render layer ─────────────────────────────────────────────────────────

  /**
   * @param {HTMLElement} container
   */
  function updateStatsBar(container) {
    const bar = container?.querySelector("#invStatsBar");
    if (!bar) return;
    if (_state.items.length === 0) { bar.style.display = "none"; return; }

    const inStock  = _state.items.filter(i => i.status === "IN_STOCK").length;
    const listed   = _state.items.filter(i => i.status === "LISTED").length;
    const inbound  = _state.items.filter(i => i.status === "INBOUND").length;
    const sold     = _state.items.filter(i => i.status === "SOLD").length;

    const invested = _state.items
      .filter(i => i.status !== "SOLD" && i.status !== "ARCHIVED" && i.ek)
      .reduce((s, i) => {
        const ekVal  = isFinite(+i.ek)  ? +i.ek  : 0;
        const qtyVal = isFinite(+i.qty) ? +i.qty : 1;
        return s + ekVal * (qtyVal || 1);
      }, 0);

    const soldProfits = _state.items
      .filter(i => i.status === "SOLD")
      .map(i => calcRealProfit(i))
      .filter(p => p != null);
    const avgProfit = soldProfits.length
      ? soldProfits.reduce((a, b) => a + b, 0) / soldProfits.length
      : null;

    bar.style.display = "flex";
    bar.innerHTML = `
      <div class="batch-sum-kpi">
        <span class="batch-sum-val">${inStock}</span>
        <span class="batch-sum-label">${I18N.t('inv.stats.in_stock')}</span>
      </div>
      <div class="batch-sum-sep"></div>
      <div class="batch-sum-kpi">
        <span class="batch-sum-val" style="color:var(--accent)">${listed}</span>
        <span class="batch-sum-label">${I18N.t('inv.stats.listed')}</span>
      </div>
      ${inbound > 0 ? `
      <div class="batch-sum-sep"></div>
      <div class="batch-sum-kpi">
        <span class="batch-sum-val" style="color:var(--yellow)">${inbound}</span>
        <span class="batch-sum-label">${I18N.t('inv.stats.inbound')}</span>
      </div>` : ""}
      <div class="batch-sum-sep"></div>
      <div class="batch-sum-kpi">
        <span class="batch-sum-val" style="color:var(--green)">${sold}</span>
        <span class="batch-sum-label">${I18N.t('inv.stats.sold')}</span>
      </div>
      <div class="batch-sum-sep"></div>
      <div class="batch-sum-kpi">
        <span class="batch-sum-val" style="${invested > 0 ? "" : "color:var(--text-muted)"}">${invested > 0 ? fmtEur(invested) : "—"}</span>
        <span class="batch-sum-label">${I18N.t('inv.stats.invested')}</span>
      </div>
      ${avgProfit != null ? `
      <div class="batch-sum-sep"></div>
      <div class="batch-sum-kpi">
        <span class="batch-sum-val" style="color:${avgProfit >= 0 ? "var(--green)" : "var(--red)"}">${fmtEur(avgProfit)}</span>
        <span class="batch-sum-label">${I18N.t('inv.stats.avg_profit')}</span>
      </div>` : ""}
    `;
  }

  function renderTable(container) {
    const wrap = container?.querySelector("#invTableWrap");
    if (!wrap) return;
    const filtered = getFiltered();

    // Sync virtual scroller data and invalidate old scroller
    _state.vs.data = filtered;
    _state.vs.wrap = null;

    if (filtered.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2M12 12v4M10 14h4"/></svg>
          <p class="empty-title">${I18N.t('inv.empty.title')}</p>
          <p class="empty-sub">${_state.filter.q || _state.filter.status || _state.filter.market || _state.filter.source || _state.filter.shipped ? I18N.t('inv.empty.sub_filtered') : I18N.t('inv.empty.sub_empty')}</p>
        </div>
      `;
      return;
    }

    const allChecked = filtered.every(i => _state.selected.has(i.id));

    // Render shell with an EMPTY tbody — virtual scroller fills it
    wrap.innerHTML = `
      <div class="table-wrap inv-vscroll" id="invVScroll">
        <table class="table">
          <thead>
            <tr>
              <th style="width:36px"><input type="checkbox" id="invSelectAll" ${allChecked ? "checked" : ""} /></th>
              <th class="inv-sort-th${_state.sort.col==="title"  ?" inv-sort-active":""}" data-sort="title" >${I18N.t('inv.col.article')} ${_sortIcon("title")}</th>
              <th class="inv-sort-th" data-sort="ean" style="width:120px">EAN ${_sortIcon("ean")}</th>
              <th class="inv-sort-th col-right" data-sort="qty" style="width:50px">Menge ${_sortIcon("qty")}</th>
              <th class="inv-sort-th${_state.sort.col==="market" ?" inv-sort-active":""}" data-sort="market">${I18N.t('inv.col.market')} ${_sortIcon("market")}</th>
              <th class="inv-sort-th col-right${_state.sort.col==="ek"     ?" inv-sort-active":""}" data-sort="ek"    >EK ${_sortIcon("ek")}</th>
              <th class="inv-sort-th col-right${_state.sort.col==="vk"     ?" inv-sort-active":""}" data-sort="vk"    >VK ${_sortIcon("vk")}</th>
              <th class="inv-sort-th col-right${_state.sort.col==="profit" ?" inv-sort-active":""}" data-sort="profit">Profit ${_sortIcon("profit")}</th>
              <th class="inv-sort-th${_state.sort.col==="status" ?" inv-sort-active":""}" data-sort="status">Status ${_sortIcon("status")}</th>
              <th class="inv-sort-th col-right${_state.sort.col==="sold_at" ?" inv-sort-active":""}" data-sort="sold_at">Verkauft ${_sortIcon("sold_at")}</th>
              <th class="inv-sort-th${_state.sort.col==="condition"?" inv-sort-active":""}" data-sort="condition">${I18N.t('inv.th.condition')} ${_sortIcon("condition")}</th>
              <th class="inv-sort-th col-right${_state.sort.col==="age"    ?" inv-sort-active":""}" data-sort="age"   >${I18N.t('inv.col.age')} ${_sortIcon("age")}</th>
              <th style="width:100px"></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    `;

    // Wire up virtual scroller on the new scroll container
    const scroller = wrap.querySelector("#invVScroll");
    _state.vs.wrap = scroller;
    _state.vs.busy = false;
    scroller.addEventListener("scroll", _vsScroll, { passive: true });
    _vsRender(); // paint initial window synchronously

    updateStatsBar(container);
  }

  // ── Market icon SVGs (view-specific markup — colors come from FC.MARKET_COLORS) ──
  // Only the SVG path data lives here; chip bg/border/text come from FC.MARKET_COLORS.
  const _MKT_SVG = {
    ebay:     `<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M1 2h2l2.5 9h7l2.5-7H5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.5" cy="13.5" r="1" fill="currentColor"/><circle cx="12.5" cy="13.5" r="1" fill="currentColor"/></svg>`,
    amz:      `<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="2" y="6" width="12" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 6V4.5a3 3 0 0 1 6 0V6M2 9.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    kaufland: `<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M1.5 14.5h13M3 14.5V8l5-4.5 5 4.5v6.5M6.5 14.5V11h3v3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    other:    `<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  };

  // ── Sort icon (dual-chevron, active direction lit up) ────────────────────
  function _sortIcon(col) {
    const active = _state.sort.col === col;
    const asc    = _state.sort.dir === "asc";
    const upOp   = active ? (asc  ? 1 : 0.18) : 0.28;
    const downOp = active ? (!asc ? 1 : 0.18) : 0.28;
    const fill   = active ? "var(--accent)" : "currentColor";
    return `<span class="inv-sort-ico${active ? " inv-sort-ico--on" : ""}">
      <svg width="7" height="9" viewBox="0 0 7 9">
        <path d="M3.5 0L0 3h7L3.5 0z" fill="${fill}" opacity="${upOp}"/>
        <path d="M3.5 9L0 6h7L3.5 9z" fill="${fill}" opacity="${downOp}"/>
      </svg>
    </span>`;
  }

  function renderRow(item) {
    const profit  = (item.status === "SOLD" || item.status === "LISTED") ? calcRealProfit(item) : null;
    const isEstimated = item.status === "LISTED" && profit != null;
    const usesRealFee = item.ebay_fee != null;
    const age     = item.created_at ? Math.floor((Date.now() - new Date(item.created_at)) / 86400000) : null;
    const checked = _state.selected.has(item.id);

    // Payout estimate for LISTED items (VK - fees - shipping)
    let payoutHtml = "";
    if (item.status === "LISTED" && item.sell_price != null) {
      const vk      = Number(item.sell_price) || 0;
      const shipOut = Number(item.ship_out)   || 0;
      const fee     = calcMarketFee(vk, item.market || "ebay", item.cat_id);
      const payout  = vk - fee - shipOut;
      payoutHtml = `<div style="font-size:10px;color:var(--text-muted);margin-top:1px" title="VK ${fmtEur(vk)} − Gebühr ${fmtEur(fee)} − Versand ${fmtEur(shipOut)}">~${fmtEur(payout)} Payout</div>`;
    }
    // Real fee badge for SOLD items
    let feeInfoHtml = "";
    if (item.status === "SOLD" && profit != null && usesRealFee) {
      feeInfoHtml = `<div style="font-size:9px;color:var(--accent);margin-top:1px" title="Echte Gebühr: ${fmtEur(item.ebay_fee)}${item.ebay_ship_cost != null ? ' · Versand: ' + fmtEur(item.ebay_ship_cost) : ''}">✓ echte Fees</div>`;
    }

    // Profit chip (reuse batch classes)
    const profitHtml = profit != null
      ? profit > 0
        ? `<div class="batch-profit batch-profit-pos">${isEstimated ? "~" : "+"}${fmtEur(profit)}</div>${payoutHtml}${feeInfoHtml}`
        : `<div class="batch-profit batch-profit-neg">${isEstimated ? "~" : ""}${fmtEur(profit)}</div>${payoutHtml}${feeInfoHtml}`
      : (payoutHtml || `<span class="text-dim">—</span>`);

    // Market badge — SVG icon + colors from FC.MARKET_COLORS (single source of truth)
    const mktKey   = (item.market || "other").toLowerCase();
    const mktSvg   = _MKT_SVG[mktKey] || _MKT_SVG.other;
    const mktColor = FC.MARKET_COLORS[mktKey] || FC.MARKET_COLORS.other;
    const mktStyle = `background:${mktColor.bg};border-color:${mktColor.border};color:${mktColor.text}`;
    const mktText  = FC.MARKET_LABELS[mktKey] || mktKey.toUpperCase();

    // Age — color by staleness for non-sold items
    let ageHtml = "—";
    if (age != null) {
      if (item.status === "SOLD") {
        ageHtml = `<span style="color:var(--text-muted)">${age}d</span>`;
      } else if (age < 7) {
        ageHtml = `<span style="color:var(--green)">${age}d</span>`;
      } else if (age < 30) {
        ageHtml = `<span style="color:var(--text-muted)">${age}d</span>`;
      } else {
        ageHtml = `<span style="color:var(--red)" title="${age} Tage im Bestand">${age}d !</span>`;
      }
    }

    return `
      <tr>
        <td><input type="checkbox" class="inv-row-check" data-id="${esc(item.id)}" ${checked ? "checked" : ""} /></td>
        <td>
          <div style="display:flex;align-items:center;gap:6px">
            <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px" title="${esc(item.title||item.ean)}">${esc(item.title||item.ean||"—")}</div>
          </div>
          ${item.source === "ebay_sync" ? `<span class="badge" style="margin-top:3px;font-size:9px;background:rgba(99,102,241,.12);color:#818CF8;border:1px solid rgba(99,102,241,.25);padding:1px 5px" title="Automatisch von eBay importiert">⟳ eBay Sync</span>` : ""}
          ${item.label ? `<span class="badge badge-gray" style="margin-top:3px;font-size:10px">${esc(item.label)}</span>` : ""}
        </td>
        <td style="font-size:11px;color:var(--dim);font-family:var(--font-mono)">${esc(item.ean||"—")}</td>
        <td class="col-right" style="font-size:12px;font-weight:600">${item.qty || 1}</td>
        <td><span class="inv-mkt" style="${mktStyle}">${mktSvg} ${mktText}</span></td>
        <td class="col-right col-num" style="font-size:12px">${item.ek != null ? `<span class="btn-ek-quick" data-id="${esc(item.id)}" title="EK bearbeiten" style="cursor:pointer;border-bottom:1px dashed var(--border)">${fmtEur(item.ek)}</span>` : `<button class="btn-ek-quick" data-id="${esc(item.id)}" title="EK eingeben" style="background:rgba(245,158,11,.12);color:#F59E0B;border:1px solid rgba(245,158,11,.3);padding:1px 7px;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer">+ EK</button>`}</td>
        <td class="col-right col-num" style="font-size:12px">${item.sell_price != null ? fmtEur(item.sell_price) : "—"}</td>
        <td class="col-right">${profitHtml}</td>
        <td><span class="badge status-${item.status||"IN_STOCK"}">${esc(STATUS_LABELS[item.status] || item.status || "—")}</span></td>
        <td class="col-right text-sm" style="color:var(--text-muted)">${item.sold_at ? new Date(item.sold_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"}</td>
        <td><span class="badge badge-muted" style="font-size:10px">${esc(FC.CONDITION_LABELS[item.condition] || item.condition || "Neu")}</span></td>
        <td class="col-right text-sm">${ageHtml}</td>
        <td>
          <div class="row" style="gap:4px;justify-content:flex-end">
            ${item.ean ? `<button class="btn btn-ghost btn-icon btn-inv-flip" data-id="${esc(item.id)}" data-ean="${esc(item.ean)}" data-ek="${esc(item.ek ?? 0)}" title="Flipcheck prüfen">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 4.5v5M4.5 7h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            </button>` : ""}
            ${item.status !== "SOLD" ? `<button class="btn btn-ghost btn-icon btn-inv-sold" data-id="${esc(item.id)}" title="Als verkauft markieren">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>` : ""}
            ${item.status === "SOLD" ? `<button class="btn btn-ghost btn-icon btn-inv-return" data-id="${esc(item.id)}" title="Retoure erfassen" style="color:var(--yellow)">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 2v4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>` : ""}
            ${item.status === "SOLD" && !item.shipped ? `<button class="btn btn-ghost btn-icon btn-inv-ship" data-id="${esc(item.id)}" title="Versenden">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M1 3h9v8H1zM10 6h3l2 3v3h-5V6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="4" cy="12" r="1.2" stroke="currentColor" stroke-width="1.3"/><circle cx="12.5" cy="12" r="1.2" stroke="currentColor" stroke-width="1.3"/></svg>
            </button>` : ""}
            ${item.shipped && item.tracking_number ? `<span class="badge badge-shipped" title="Versendet: ${esc(item.tracking_number)}">📦</span>` : ""}
            <button class="btn btn-ghost btn-icon btn-inv-edit" data-id="${esc(item.id)}" title="Bearbeiten">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  function updateCount(container) {
    const el = container?.querySelector("#invCount");
    if (!el) return;
    const f = getFiltered();
    el.textContent = `${_state.items.length} ${I18N.t('inv.count.items')} · ${f.length} ${I18N.t('inv.count.shown')}`;
  }

  function updateBulkBar(container) {
    const bar = container?.querySelector("#invBulkBar");
    const count = container?.querySelector("#invBulkCount");
    if (!bar) return;
    if (_state.selected.size > 0) {
      bar.style.display = "flex";
      if (count) count.textContent = `${_state.selected.size} ${I18N.t('inv.bulk.selected')}`;
    } else {
      bar.style.display = "none";
    }
  }

  // ── Event wiring ─────────────────────────────────────────────────────────

  /**
   * Wire up filter inputs, header action buttons, and bulk-action controls.
   * Called once per mount.
   * @param {HTMLElement} container
   */
  function attachFilterEvents(container) {
    // Debounce the free-text search: fire renderTable 250ms after the user stops typing.
    // select/sort events are instant (discrete, not per-keystroke).
    let _searchDebounce = 0;
    container.querySelector("#invSearch")?.addEventListener("input", e => {
      _state.filter.q = e.target.value;
      clearTimeout(_searchDebounce);
      _searchDebounce = setTimeout(() => {
        renderTable(container);
        updateCount(container);
      }, 250);
    });

    container.querySelector("#invStatusFilter")?.addEventListener("change", e => {
      _state.filter.status = e.target.value;
      renderTable(container);
      updateCount(container);
    });

    container.querySelector("#invMarketFilter")?.addEventListener("change", e => {
      _state.filter.market = e.target.value;
      renderTable(container);
      updateCount(container);
    });

    container.querySelector("#invSourceFilter")?.addEventListener("change", e => {
      _state.filter.source = e.target.value;
      renderTable(container);
      updateCount(container);
    });

    container.querySelector("#invShippedFilter")?.addEventListener("change", e => {
      _state.filter.shipped = e.target.value;
      renderTable(container);
      updateCount(container);
    });

    container.querySelector("#btnAddItem")?.addEventListener("click", () => openAddModal(container));
    container.querySelector("#btnRefreshInv")?.addEventListener("click", () => loadItems(container));
    container.querySelector("#btnImportCsv")?.addEventListener("click", () => openImportModal(container));
    container.querySelector("#btnExportCsv")?.addEventListener("click", () => exportCsv());

    container.querySelector("#btnBulkApply")?.addEventListener("click", async () => {
      const status = container.querySelector("#invBulkStatus")?.value;
      if (!status) { Toast.warning(I18N.t('inv.bulk.no_status'), I18N.t('inv.bulk.no_status_sub')); return; }
      const ids = [..._state.selected];
      await Storage.bulkUpdate(ids, { status });
      _state.selected.clear();
      await loadItems(container);
      updateBulkBar(container);
      Toast.success(I18N.t('inv.bulk.updated'), `${ids.length} ${I18N.t('inv.bulk.updated_sub')} "${STATUS_LABELS[status]}"`);
    });

    container.querySelector("#btnBulkDelete")?.addEventListener("click", async () => {
      const ok = await Modal.confirm(I18N.t('inv.bulk.del_title'), `${_state.selected.size} ${I18N.t('inv.bulk.del_body')}`, { confirmLabel: I18N.t('inv.bulk.del_confirm'), danger: true });
      if (!ok) return;
      const ids = [..._state.selected];
      for (const id of ids) await Storage.deleteItem(id);
      _state.selected.clear();
      await loadItems(container);
      updateBulkBar(container);
      Toast.success(I18N.t('inv.bulk.del_done'), `${ids.length} ${I18N.t('inv.bulk.del_done_sub')}`);
    });

    container.querySelector("#btnBulkCancel")?.addEventListener("click", () => {
      _state.selected.clear();
      renderTable(container);
      updateBulkBar(container);
    });
  }

  /**
   * Attach a single delegated click/change listener on the stable container.
   * Handles all dynamic table events (checkboxes, sort headers, row action buttons).
   * Must be called ONCE per mount — survives virtual scroller re-renders.
   * @param {HTMLElement} container
   */
  function attachTableDelegation(container) {
    // Single delegated listener on the stable container — handles all dynamic table events
    container.addEventListener("change", e => {
      // Select-all checkbox
      if (e.target.id === "invSelectAll") {
        const filtered = getFiltered();
        if (e.target.checked) filtered.forEach(i => _state.selected.add(i.id));
        else filtered.forEach(i => _state.selected.delete(i.id));
        renderTable(container);
        updateBulkBar(container);
        return;
      }
      // Row checkbox
      if (e.target.classList.contains("inv-row-check")) {
        const id = e.target.dataset.id;
        if (e.target.checked) _state.selected.add(id);
        else _state.selected.delete(id);
        updateBulkBar(container);
      }
    });

    container.addEventListener("click", e => {
      // ── Column sort ────────────────────────────────────────────────────
      const sortTh = e.target.closest("th[data-sort]");
      if (sortTh) {
        const col = sortTh.dataset.sort;
        _state.sort = { col, dir: _state.sort.col === col && _state.sort.dir === "asc" ? "desc" : "asc" };
        renderTable(container);
        updateCount(container);
        return;
      }

      const editBtn = e.target.closest(".btn-inv-edit");
      if (editBtn) { openEditModal(editBtn.dataset.id, container); return; }

      const soldBtn = e.target.closest(".btn-inv-sold");
      if (soldBtn) { openSoldModal(soldBtn.dataset.id, container); return; }

      const shipBtn = e.target.closest(".btn-inv-ship");
      if (shipBtn) { openShipModal(shipBtn.dataset.id, container); return; }

      const returnBtn = e.target.closest(".btn-inv-return");
      if (returnBtn) { openReturnModal(returnBtn.dataset.id, container); return; }

      const flipBtn = e.target.closest(".btn-inv-flip");
      if (flipBtn) {
        const ean = flipBtn.dataset.ean;
        const ek  = parseFloat(flipBtn.dataset.ek) || 0;
        if (ean) openPricecheckModal(ean, ek, flipBtn);
        return;
      }

      const ekBtn = e.target.closest(".btn-ek-quick");
      if (ekBtn) { openQuickEkModal(ekBtn.dataset.id, container); return; }
    });
  }

  // ── Modals ───────────────────────────────────────────────────────────────

  async function openQuickEkModal(itemId, container) {
    const item = _state.items.find(i => i.id === itemId);
    if (!item) return;

    let _ekVal = item.ek != null ? item.ek : null;
    let _ekDate = item.ek_date || new Date().toISOString().slice(0, 10);
    let _shipOut = item.ship_out != null ? item.ship_out : null;

    const result = await Modal.open({
      title: item.ek != null ? "Einkaufspreis bearbeiten" : "Einkaufspreis eingeben",
      width: 400,
      body: `
        <div style="margin-bottom:12px">
          <div style="font-weight:600;font-size:13px;margin-bottom:2px">${esc(item.title || item.ean || "—")}</div>
          ${item.ean ? `<div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">${esc(item.ean)}</div>` : ""}
          ${item.sell_price != null ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">VK: ${fmtEur(item.sell_price)}</div>` : ""}
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <div class="input-prefix-wrap" style="flex:1">
            <span class="prefix">€</span>
            <input id="quickEkInput" class="input" type="number" min="0" step="0.01" placeholder="EK"
              value="${item.ek != null ? item.ek : ""}" style="text-align:right;padding-right:12px;padding-left:26px" />
          </div>
          <div class="input-prefix-wrap" style="flex:1">
            <span class="prefix">€</span>
            <input id="quickShipOut" class="input" type="number" min="0" step="0.01" placeholder="Versand" value="${item.ship_out || ""}"
              style="text-align:right;padding-right:12px;padding-left:26px" />
          </div>
        </div>
        <div>
          <input id="quickEkDate" class="input" type="date" value="${_ekDate}" style="width:100%" />
        </div>
      `,
      buttons: [
        { label: "Abbrechen", variant: "btn-ghost", value: null },
        { label: "Speichern", variant: "btn-primary", action: () => {
          const inp = document.getElementById("quickEkInput");
          const dateInp = document.getElementById("quickEkDate");
          const shipInp = document.getElementById("quickShipOut");
          _ekVal   = parseFloat(inp?.value);
          _ekDate  = dateInp?.value || null;
          _shipOut = shipInp?.value ? parseFloat(shipInp.value) : null;
          Modal.close("save");
        }},
      ],
    });

    if (result !== "save") return;
    if (_ekVal == null || isNaN(_ekVal)) _ekVal = item.ek;  // keep old EK if input was cleared

    try {
      const updates = { ...item, ek_date: _ekDate };
      if (_ekVal != null) updates.ek = _ekVal;
      if (_shipOut != null && !isNaN(_shipOut)) updates.ship_out = _shipOut;
      await Storage.upsertItem(updates);
      Toast.success("Gespeichert", `${_ekVal != null ? fmtEur(_ekVal) + " EK" : ""}${_shipOut != null ? " · " + fmtEur(_shipOut) + " Versand" : ""} — ${item.title || item.ean}`);
      await loadItems(container);
    } catch (e) {
      Toast.error("Fehler", e.message || "EK konnte nicht gespeichert werden.");
    }
  }

  async function openPricecheckModal(ean, ek, btn) {
    // Briefly show loading state on the trigger button
    const origHtml = btn ? btn.innerHTML : "";
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<div class="spinner spinner-sm" style="width:11px;height:11px;border-width:1.5px"></div>`;
    }

    try {
      const { ok, data } = await API.flipcheck(ean, ek || 0, "mid");
      if (!ok || !data) throw new Error(data?.detail || "Backend nicht erreichbar");

      const verdict = data.verdict || "—";
      const vc = { BUY: "var(--green)", HOLD: "var(--yellow)", SKIP: "var(--red)" }[verdict] || "var(--dim)";
      const vb = { BUY: "var(--green-sub)", HOLD: "var(--yellow-sub)", SKIP: "var(--red-sub)" }[verdict] || "transparent";
      const profit = data.profit_median ?? data.profit;
      const margin = data.margin_pct;

      await Modal.open({
        title: `🔍 ${esc(data.title || ean)}`,
        body: `<div class="col gap-14">
          <div class="row" style="align-items:center;gap:14px">
            <div style="background:${vb};border:1px solid ${vc}44;border-radius:10px;padding:8px 18px;font-size:18px;font-weight:800;color:${vc};flex-shrink:0">${esc(verdict)}</div>
            <div>
              <div style="font-size:22px;font-weight:800;line-height:1;color:var(--text-primary)">${profit != null ? fmtEur(profit) : "—"}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${margin != null ? `${margin.toFixed(1)} % ${I18N.t('inv.pc.margin')}` : I18N.t('inv.pc.no_profit')}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
            <div class="fc-amz-kpi"><div class="fc-amz-kpi-v">${fmtEur(data.sell_price_median)}</div><div class="fc-amz-kpi-l">${I18N.t('inv.pc.median_vk')}</div></div>
            <div class="fc-amz-kpi"><div class="fc-amz-kpi-v">${profit != null ? fmtEur(profit) : "—"}</div><div class="fc-amz-kpi-l">${I18N.t('inv.pc.profit')}</div></div>
            <div class="fc-amz-kpi"><div class="fc-amz-kpi-v">${margin != null ? margin.toFixed(1) + " %" : "—"}</div><div class="fc-amz-kpi-l">${I18N.t('inv.pc.margin')}</div></div>
            <div class="fc-amz-kpi"><div class="fc-amz-kpi-v">${data.sales_30d ?? "—"}</div><div class="fc-amz-kpi-l">${I18N.t('fc.kpi.sales30')}</div></div>
          </div>
          <div style="font-size:11px;color:var(--dim);padding-top:8px;border-top:1px solid var(--border);display:flex;gap:16px;flex-wrap:wrap">
            <span>EAN: <strong style="color:var(--text-secondary)">${esc(ean)}</strong></span>
            <span>EK: <strong style="color:var(--text-secondary)">${fmtEur(ek)}</strong></span>
            ${data.competition != null ? `<span>Konkurrenten: <strong style="color:var(--text-secondary)">${data.competition}</strong></span>` : ""}
            ${data.sales_last_day != null ? `<span>Ø/Tag: <strong style="color:var(--text-secondary)">${data.sales_last_day.toFixed(1)}</strong></span>` : ""}
          </div>
        </div>`,
        buttons: [{ label: I18N.t('inv.pc.close'), variant: "btn-ghost", value: false }],
      });
    } catch (err) {
      Toast.error(I18N.t('inv.pc.err'), err.message || I18N.t('inv.pc.err_sub'));
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
    }
  }

  function openAddModal(container) {
    const body = `
      <div class="col gap-12">
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.add.ean')}</label>
          <div style="display:flex;gap:6px">
            <input id="mEan" class="input" type="text" placeholder="Barcode / EAN" autocomplete="off" style="flex:1" />
            <button type="button" class="btn btn-ghost btn-sm" id="invScanBtn" title="Handy-Scanner öffnen" style="flex-shrink:0;font-size:16px;padding:0 10px">📷</button>
          </div>
        </div>
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.add.title')}</label>
          <input id="mTitle" class="input" type="text" placeholder="${I18N.t('inv.add.title_placeholder')}" />
        </div>
        <div class="grid-2 gap-12">
          <div class="input-group">
            <label class="input-label">${I18N.t('inv.add.ek')}</label>
            <input id="mEk" class="input" type="number" step="0.01" min="0" placeholder="0.00" />
          </div>
          <div class="input-group">
            <label class="input-label">${I18N.t('inv.add.qty')}</label>
            <input id="mQty" class="input" type="number" min="1" value="1" />
          </div>
        </div>
        <div class="grid-2 gap-12">
          <div class="input-group">
            <label class="input-label">${I18N.t('inv.add.market')}</label>
            <select id="mMarket" class="select">
              ${MARKETS.map(m => `<option value="${m}">${m.toUpperCase()}</option>`).join("")}
            </select>
          </div>
          <div class="input-group">
            <label class="input-label">${I18N.t('inv.add.status')}</label>
            <select id="mStatus" class="select">
              ${STATUSES.map(s => `<option value="${s}" ${s==="IN_STOCK"?"selected":""}>${STATUS_LABELS[s]}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.modal.condition')}</label>
          <select id="mCondition" class="select">
            ${FC.CONDITIONS.map(c => `<option value="${c}" ${c === "new" ? "selected" : ""}>${FC.CONDITION_LABELS[c]}</option>`).join("")}
          </select>
        </div>
        ${_buildCatRowHtml("ebay", null)}
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.add.label')}</label>
          <input id="mLabel" class="input" type="text" placeholder="${I18N.t('inv.add.label_placeholder')}" />
        </div>
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.add.source')}</label>
          <input id="mSource" class="input" type="text" placeholder="${I18N.t('inv.add.source_placeholder')}" />
        </div>
      </div>
    `;

    Modal.open({
      title: I18N.t('inv.add.modal_title'),
      body,
      buttons: [
        { label: I18N.t('inv.add.cancel'), variant: "btn-ghost", value: false },
        { label: I18N.t('inv.add.submit'), variant: "btn-primary", action: async () => {
          const ean = document.getElementById("mEan")?.value.trim();
          if (!ean) { Toast.error(I18N.t('inv.add.err_ean'), I18N.t('inv.add.err_ean_sub')); return; }
          await Storage.upsertItem({
            ean,
            title:     document.getElementById("mTitle")?.value.trim() || "",
            ek:        parseFloat(document.getElementById("mEk")?.value) || null,
            qty:       parseInt(document.getElementById("mQty")?.value) || 1,
            market:    document.getElementById("mMarket")?.value || "ebay",
            status:    document.getElementById("mStatus")?.value || "IN_STOCK",
            condition: document.getElementById("mCondition")?.value || "new",
            cat_id:    document.getElementById("invCatSel")?.value || null,
            label:     document.getElementById("mLabel")?.value.trim() || "",
            source:    document.getElementById("mSource")?.value.trim() || "",
          });
          Modal.close(true);
          await loadItems(container);
          Toast.success(I18N.t('inv.add.added'), `${ean} ${I18N.t('inv.add.added_sub')}`);
        }},
      ],
    });
    setTimeout(() => {
      _bindCatRowUpdater("mMarket");
      document.getElementById("invScanBtn")?.addEventListener("click", () => {
        window.fc?.openScanner?.();
      });
    }, 0);
  }

  function openEditModal(id, container) {
    const item = _state.items.find(i => i.id === id);
    if (!item) return;

    const body = `
      <div class="col gap-12">
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.add.title')}</label>
          <input id="eTitle" class="input" type="text" value="${esc(item.title||"")}" />
        </div>
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.add.ean')}</label>
          <input id="eEan" class="input" type="text" value="${esc(item.ean||"")}" />
        </div>
        <div class="grid-2 gap-12">
          <div class="input-group">
            <label class="input-label">${I18N.t('inv.edit.ek')}</label>
            <input id="eEk" class="input" type="number" step="0.01" value="${item.ek||""}" />
          </div>
          <div class="input-group">
            <label class="input-label">${I18N.t('inv.add.qty')}</label>
            <input id="eQty" class="input" type="number" min="1" value="${item.qty||1}" />
          </div>
        </div>
        <div class="grid-2 gap-12">
          <div class="input-group">
            <label class="input-label">${I18N.t('inv.add.market')}</label>
            <select id="eMarket" class="select">
              ${MARKETS.map(m => `<option value="${m}" ${item.market===m?"selected":""}>${m.toUpperCase()}</option>`).join("")}
            </select>
          </div>
          <div class="input-group">
            <label class="input-label">${I18N.t('inv.add.status')}</label>
            <select id="eStatus" class="select">
              ${STATUSES.map(s => `<option value="${s}" ${item.status===s?"selected":""}>${STATUS_LABELS[s]}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.modal.condition')}</label>
          <select id="eCondition" class="select">
            ${FC.CONDITIONS.map(c => `<option value="${c}" ${(item.condition||"new")===c?"selected":""}>${FC.CONDITION_LABELS[c]}</option>`).join("")}
          </select>
        </div>
        ${_buildCatRowHtml(item.market || "ebay", item.cat_id)}
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.add.label')}</label>
          <input id="eLabel" class="input" type="text" value="${esc(item.label||"")}" />
        </div>
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.add.source')}</label>
          <input id="eSource" class="input" type="text" value="${esc(item.source||"")}" placeholder="${I18N.t('inv.add.source_placeholder')}" />
        </div>
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.edit.notes')}</label>
          <textarea id="eNotes" class="textarea" rows="2">${esc(item.notes||"")}</textarea>
        </div>
      </div>
    `;

    Modal.open({
      title: I18N.t('inv.edit.modal_title'),
      body,
      buttons: [
        { label: I18N.t('inv.edit.delete'), variant: "btn-danger", action: async () => {
          const ok = await Modal.confirm(I18N.t('inv.edit.del_title'), `"${item.title||item.ean}" ${I18N.t('inv.edit.del_body')}`, { confirmLabel: I18N.t('inv.edit.del_confirm'), danger: true });
          if (!ok) return;
          await Storage.deleteItem(id);
          await loadItems(container);
          Toast.success(I18N.t('inv.edit.del_done'));
        }},
        { label: I18N.t('inv.edit.cancel'), variant: "btn-ghost", value: false },
        { label: I18N.t('inv.edit.save'), variant: "btn-primary", action: async () => {
          const newStatus = document.getElementById("eStatus")?.value || item.status;
          await Storage.upsertItem({
            ...item,
            title:     document.getElementById("eTitle")?.value.trim() || item.title,
            ean:       document.getElementById("eEan")?.value.trim()   || item.ean,
            ek:        parseFloat(document.getElementById("eEk")?.value) || item.ek,
            qty:       parseInt(document.getElementById("eQty")?.value)  || item.qty,
            market:    document.getElementById("eMarket")?.value || item.market,
            status:    newStatus,
            condition: document.getElementById("eCondition")?.value || item.condition || "new",
            cat_id:    document.getElementById("invCatSel")?.value || item.cat_id || null,
            label:     document.getElementById("eLabel")?.value.trim()  || "",
            source:    document.getElementById("eSource")?.value.trim() || "",
            notes:     document.getElementById("eNotes")?.value.trim()  || "",
            // Auto-stamp sold_at when status changes to SOLD and it wasn't set before
            sold_at: newStatus === "SOLD" && !item.sold_at ? new Date().toISOString() : item.sold_at,
          });
          Modal.close(true);
          await loadItems(container);
          Toast.success(I18N.t('inv.edit.saved'));
        }},
      ],
    });
    setTimeout(() => _bindCatRowUpdater("eMarket"), 0);
  }

  function _buildCatOptions(selectedId) {
    const GROUPS = {
      "Geräte (6,5% + 3%)":        ["computer_tablets","drucker","foto_camcorder","handys","haushaltsgeraete","konsolen","scanner","speicherkarten","tv_video_audio","koerperpflege"],
      "Zubehör (11% + 3%)":        ["drucker_zubehoer","handy_zubehoer","batterien","kabel","kameras_zubehoer","notebook_zubehoer","objektive","stative","tablet_zubehoer","tastaturen_maeuse","tv_zubehoer","pc_zubehoer","audio_zubehoer"],
      "Sonstiges (Flat)":          ["mode","sport_freizeit","spielzeug","haushalt_garten","buecher","sonstiges"],
      "Sonderkonditionen (0 %)":   ["durchstarter"],
    };
    const sel = selectedId || "sonstiges";
    return Object.entries(GROUPS).map(([grp, ids]) =>
      `<optgroup label="${grp}">${ids.map(id => {
        const cat = EBAY_FEE_CATEGORIES.find(c => c.id === id);
        return cat ? `<option value="${cat.id}" ${cat.id === sel ? "selected" : ""}>${cat.label}</option>` : "";
      }).join("")}</optgroup>`
    ).join("");
  }

  function _buildAmzCatOptions(selectedId) {
    const cats = [
      ["computer_tablets",  "Computer / Tablets (7 %)"],
      ["handys",            "Smartphones (7 %)"],
      ["konsolen",          "Gaming / Konsolen (8 %)"],
      ["foto_camcorder",    "Foto & Camcorder (7 %)"],
      ["tv_video_audio",    "TV, Video & Audio (7 %)"],
      ["haushaltsgeraete",  "Haushaltsgeräte (7 %)"],
      ["drucker",           "Drucker (7 %)"],
      ["handy_zubehoer",    "Handy-Zubehör (15 %)"],
      ["notebook_zubehoer", "Notebook-Zubehör (15 %)"],
      ["kabel",             "Kabel & Stecker (15 %)"],
      ["mode",              "Mode (15 %)"],
      ["sport_freizeit",    "Sport & Freizeit (15 %)"],
      ["spielzeug",         "Spielzeug (15 %)"],
      ["buecher",           "Bücher (15 %)"],
      ["sonstiges",         "Sonstiges (15 %)"],
    ];
    const sel = selectedId || "sonstiges";
    return cats.map(([v, l]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
  }

  function _buildKlCatOptions(selectedId) {
    const cats = [
      ["kl_elektronik",  "Elektronik / Computer (8,5 %)"],
      ["kl_handys",      "Handys / Smartphones (8,5 %)"],
      ["kl_gaming",      "Gaming / Konsolen (8,5 %)"],
      ["kl_foto",        "Foto & Camcorder (8,5 %)"],
      ["kl_haushalt_el", "Haushaltsgeräte (8,5 %)"],
      ["kl_buecher",     "Bücher & Medien (8,5 %)"],
      ["kl_sport",       "Sport & Freizeit (10,5 %)"],
      ["kl_spielzeug",   "Spielzeug (10,5 %)"],
      ["kl_haushalt",    "Haushalt & Küche (10,5 %)"],
      ["kl_garten",      "Garten & DIY (10,5 %)"],
      ["kl_mode",        "Kleidung & Schuhe (17,5 %)"],
      ["kl_sonstiges",   "Sonstiges (10,5 %)"],
    ];
    const sel = selectedId || "kl_sonstiges";
    return cats.map(([v, l]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
  }

  function _buildCatRowHtml(market, catId) {
    if (market === "other") return `<div id="invCatRow" style="display:none"></div>`;
    let opts;
    if (market === "amz") opts = _buildAmzCatOptions(catId);
    else if (market === "kaufland") opts = _buildKlCatOptions(catId);
    else opts = _buildCatOptions(catId);
    return `<div id="invCatRow" class="input-group">
      <label class="input-label">${I18N.t('inv.add.category')}</label>
      <select id="invCatSel" class="select">${opts}</select>
    </div>`;
  }

  function _bindCatRowUpdater(marketSelId) {
    const mkt = document.getElementById(marketSelId);
    if (!mkt) return;
    mkt.addEventListener("change", (e) => {
      const row = document.getElementById("invCatRow");
      const catSel = document.getElementById("invCatSel");
      if (!row) return;
      const newMkt = e.target.value;
      if (newMkt === "other") { row.style.display = "none"; return; }
      row.style.display = "";
      if (catSel) {
        if (newMkt === "amz")      catSel.innerHTML = _buildAmzCatOptions("");
        else if (newMkt === "kaufland") catSel.innerHTML = _buildKlCatOptions("");
        else catSel.innerHTML = _buildCatOptions("");
      }
    });
  }

  function openSoldModal(id, container) {
    const item = _state.items.find(i => i.id === id);
    if (!item) return;

    const totalQty = Number(item.qty) || 1;

    const body = `
      <div class="col gap-12">
        <p class="text-secondary text-sm">"${esc(item.title||item.ean)}" ${I18N.t('inv.sold.subtitle')}</p>

        ${totalQty > 1 ? `
        <div class="input-group">
          <label class="input-label">
            ${I18N.t('inv.sold.qty_label')}
            <span style="color:var(--text-muted);font-weight:400;margin-left:4px">${I18N.t('inv.sold.qty_stock')}: ${totalQty}×</span>
          </label>
          <div style="display:flex;align-items:center;gap:10px">
            <input id="soldQtyInp" class="input" type="number" min="1" max="${totalQty}" value="${totalQty}"
              style="max-width:90px;text-align:center;font-size:15px;font-weight:600" />
            <div id="soldQtyHint" class="inv-sold-qty-hint inv-sold-qty-hint--all">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              ${I18N.t('inv.sold.qty_all_prefix')} ${totalQty} ${I18N.t('inv.sold.qty_all_suffix')}
            </div>
          </div>
        </div>
        ` : ""}

        <div class="grid-2 gap-12">
          <div class="input-group">
            <label class="input-label">${I18N.t('inv.sold.vk_label')}</label>
            <div class="input-prefix-wrap">
              <span class="prefix">€</span>
              <input id="soldVk" class="input" type="number" step="0.01" min="0" placeholder="0.00" />
            </div>
          </div>
          <div class="input-group">
            <label class="input-label">${I18N.t('inv.sold.ship_out_label')}</label>
            <div class="input-prefix-wrap">
              <span class="prefix">€</span>
              <input id="soldShipOut" class="input" type="number" step="0.01" min="0" placeholder="0.00" value="${item.ship_out || ""}" />
            </div>
          </div>
        </div>
        ${(!item.market || item.market === "ebay") ? `
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.sold.cat_ebay')}</label>
          <select id="soldCatId" class="select">${_buildCatOptions(item.cat_id)}</select>
        </div>` : item.market === "amz" ? `
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.sold.cat_amz')}</label>
          <select id="soldCatId" class="select">${_buildAmzCatOptions(item.cat_id)}</select>
        </div>` : item.market === "kaufland" ? `
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.sold.cat_kl')}</label>
          <select id="soldCatId" class="select">${_buildKlCatOptions(item.cat_id)}</select>
        </div>` : `<input type="hidden" id="soldCatId" value=""/>`}
        <div class="input-group">
          <label class="input-label">${I18N.t('inv.sold.date_label')}</label>
          <input id="soldDate" class="input" type="date" value="${new Date().toISOString().slice(0,10)}" />
        </div>
        <div id="soldProfitPreview" style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--r);padding:10px 14px;font-size:12px;color:var(--text-secondary)">
          ${I18N.t('inv.sold.preview_empty')}
        </div>
      </div>
    `;

    Modal.open({
      title: I18N.t('inv.sold.modal_title'),
      body,
      buttons: [
        { label: I18N.t('inv.sold.cancel'), variant: "btn-ghost", value: false },
        { label: I18N.t('inv.sold.confirm'), variant: "btn-success", action: async () => {
          const vk = parseFloat(document.getElementById("soldVk")?.value);
          if (!vk || vk <= 0) { Toast.error(I18N.t('inv.sold.err_vk'), I18N.t('inv.sold.err_vk_sub')); return; }

          const soldDate = document.getElementById("soldDate")?.value;
          const shipOut  = parseFloat(document.getElementById("soldShipOut")?.value) || 0;
          const catId    = document.getElementById("soldCatId")?.value || item.cat_id || "sonstiges";
          const soldAt   = soldDate ? new Date(soldDate).toISOString() : new Date().toISOString();

          // How many are being sold
          const soldQty   = totalQty > 1
            ? Math.min(totalQty, Math.max(1, parseInt(document.getElementById("soldQtyInp")?.value) || totalQty))
            : 1;
          const remainQty = totalQty - soldQty;

          if (remainQty > 0) {
            // ── PARTIAL SELL ─────────────────────────────────────────────
            // 1) Create a brand-new SOLD record (no id → backend generates one)
            await Storage.upsertItem({
              title:  item.title,  ean:    item.ean,
              ek:     item.ek,     market: item.market,
              label:  item.label,  source: item.source,
              notes:  item.notes,  cat_id: catId,
              qty:        soldQty,
              status:     "SOLD",
              sell_price: vk,
              ship_out:   shipOut,
              sold_at:    soldAt,
            });
            // 2) Decrement the original item, keep its status
            await Storage.upsertItem({ ...item, qty: remainQty });
          } else {
            // ── FULL SELL ────────────────────────────────────────────────
            await Storage.upsertItem({
              ...item,
              qty:        soldQty,
              status:     "SOLD",
              sell_price: vk,
              ship_out:   shipOut,
              cat_id:     catId,
              sold_at:    soldAt,
            });
          }

          Modal.close(true);
          await loadItems(container);

          const perUnitProfit = calcRealProfit({
            ...item, sell_price: vk, ship_out: shipOut, cat_id: catId,
          });
          if (remainQty > 0) {
            Toast.success(
              `${soldQty}× ${I18N.t('inv.sold.toast_partial')}`,
              `${remainQty}× ${I18N.t('inv.sold.toast_remain')}${perUnitProfit != null ? ` · ${I18N.t('inv.sold.toast_profit')}: ${fmtEur(perUnitProfit)}/${I18N.t('inv.sold.toast_piece')}` : ""}`
            );
          } else {
            Toast.success(
              I18N.t('inv.sold.toast_done'),
              perUnitProfit != null ? `${I18N.t('inv.sold.toast_profit_full')}: ${fmtEur(perUnitProfit)}` : I18N.t('inv.sold.toast_done_sub')
            );
          }
        }},
      ],
    });

    // ── Live profit preview + qty hint ──────────────────────────────────
    setTimeout(() => {
      const getQty = () => totalQty > 1
        ? Math.min(totalQty, Math.max(1, parseInt(document.getElementById("soldQtyInp")?.value) || totalQty))
        : 1;

      const MKT_FEE_LABELS = { ebay: I18N.t('inv.sold.fee_ebay'), amz: I18N.t('inv.sold.fee_amz'), kaufland: I18N.t('inv.sold.fee_kl'), other: I18N.t('inv.sold.fee_other') };

      const updatePreview = () => {
        const vk      = parseFloat(document.getElementById("soldVk")?.value)      || 0;
        const shipOut = parseFloat(document.getElementById("soldShipOut")?.value) || 0;
        const catId   = document.getElementById("soldCatId")?.value               || item.cat_id || "sonstiges";
        const soldQty = getQty();
        const el      = document.getElementById("soldProfitPreview");
        if (!el) return;
        if (!vk || !item.ek) { el.textContent = I18N.t('inv.sold.preview_empty'); return; }
        const market     = item.market || "ebay";
        const fee        = calcMarketFee(vk, market, catId);
        const feeLabel   = MKT_FEE_LABELS[market] || "Gebühr";
        const unitProfit = vk - item.ek - shipOut - fee;
        const roi        = item.ek > 0 ? (unitProfit / item.ek * 100) : 0;
        const color      = unitProfit >= 0 ? "var(--green)" : "var(--red)";
        el.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span>${I18N.t('inv.sold.preview_profit')}${soldQty > 1 ? " " + I18N.t('inv.sold.preview_per_unit') : ""} (${I18N.t('inv.sold.preview_after_fees')})</span>
            <strong style="color:${color};font-size:14px">${fmtEur(unitProfit)}</strong>
          </div>
          ${soldQty > 1 ? `
          <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:12px">
            <span style="color:var(--text-muted)">${soldQty}× ${I18N.t('inv.sold.preview_total')}</span>
            <strong style="color:${color}">${unitProfit >= 0 ? "+" : ""}${fmtEur(unitProfit * soldQty)}</strong>
          </div>` : ""}
          <div style="display:flex;justify-content:space-between;margin-top:4px;color:var(--text-muted);font-size:11px">
            <span>${feeLabel}: −${fmtEur(fee)} · Versand: −${fmtEur(shipOut)} · EK: −${fmtEur(item.ek)}</span>
            <span style="color:${color}">${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%</span>
          </div>`;
      };

      const updateQtyHint = () => {
        const hint  = document.getElementById("soldQtyHint");
        if (!hint) return;
        const soldQ = getQty();
        const remQ  = totalQty - soldQ;
        if (remQ > 0) {
          hint.className = "inv-sold-qty-hint inv-sold-qty-hint--partial";
          hint.innerHTML = `
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
              <path d="M8 5v3l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            ${remQ}× ${I18N.t('inv.sold.hint_remain')}`;
        } else {
          hint.className = "inv-sold-qty-hint inv-sold-qty-hint--all";
          hint.innerHTML = `
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
              <path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            ${I18N.t('inv.sold.qty_all_prefix')} ${totalQty} ${I18N.t('inv.sold.qty_all_suffix')}`;
        }
        updatePreview();
      };

      document.getElementById("soldVk")?.addEventListener("input", updatePreview);
      document.getElementById("soldShipOut")?.addEventListener("input", updatePreview);
      document.getElementById("soldCatId")?.addEventListener("change", updatePreview);
      if (totalQty > 1) {
        document.getElementById("soldQtyInp")?.addEventListener("input", updateQtyHint);
      }
    }, 50);
  }

  // ── CSV Import / Export ─────────────────────────────────────────────────

  /**
   * Download the currently-filtered inventory items as a UTF-8 CSV file.
   * Includes a BOM prefix so Excel auto-detects encoding.
   */
  function exportCsv() {
    const rows = getFiltered();
    if (rows.length === 0) { Toast.warning(I18N.t('inv.export.empty'), I18N.t('inv.export.empty_sub')); return; }

    const cols   = ["ean","title","ek","qty","status","condition","market","sell_price","ship_out","cat_id","label","source","notes","created_at","sold_at"];
    const header = ["EAN","Titel","EK","Menge","Status","Zustand","Markt","VK","Versand raus","Kategorie","Label","Quelle","Notiz","Erstellt","Verkauft am"];

    const escCsv = v => {
      if (v == null) return "";
      const s = String(v);
      return (s.includes(",") || s.includes('"') || s.includes("\n")) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [
      header.join(","),
      ...rows.map(i => cols.map(k => escCsv(i[k])).join(",")),
    ];

    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `flipcheck-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    Toast.success(I18N.t('inv.export.done'), `${rows.length} ${I18N.t('inv.export.done_sub')}`);
  }

  // ── CSV Import ──────────────────────────────────────────────────────────
  // parseCsvLine lives in InventoryData (inventory-data.js); retained here as
  // a local alias so existing internal callers keep working without change.

  function openImportModal(container) {
    const fileInp = document.createElement("input");
    fileInp.type  = "file";
    fileInp.accept = ".csv,text/csv";
    fileInp.style.display = "none";
    document.body.appendChild(fileInp);

    fileInp.addEventListener("change", () => {
      const file = fileInp.files?.[0];
      document.body.removeChild(fileInp);
      if (!file) return;
      const reader = new FileReader();
      reader.onload  = e => parseAndPreviewCsv(e.target.result, container);
      reader.onerror = () => Toast.error(I18N.t('inv.import.read_err'), I18N.t('inv.import.read_err_sub'));
      reader.readAsText(file, "utf-8");
    });

    fileInp.click();
  }

  function parseAndPreviewCsv(text, container) {
    const { items, skipped, error } = InventoryData.parseCsv(text, STATUSES);

    if (error === "too_few_lines") { Toast.error(I18N.t('inv.import.empty_file'), I18N.t('inv.import.empty_file_sub')); return; }
    if (error === "no_ean_column") {
      Toast.error(I18N.t('inv.import.format_err'), I18N.t('inv.import.format_err_sub'));
      return;
    }

    if (items.length === 0) {
      Toast.error(I18N.t('inv.import.no_items'), skipped.length ? skipped[0] : I18N.t('inv.import.no_items_sub'));
      return;
    }

    const errNote = skipped.length
      ? `<div style="color:var(--yellow);font-size:11px;margin-top:8px">${skipped.length} Zeile(n) übersprungen (kein EAN)</div>`
      : "";

    const previewRows = items.slice(0, 6).map(i => `
      <tr>
        <td style="font-family:var(--font-mono);font-size:11px">${esc(i.ean)}</td>
        <td style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.title || "")}</td>
        <td class="col-right" style="font-size:11px">${i.ek != null ? fmtEur(i.ek) : "—"}</td>
        <td style="font-size:11px;text-align:center">${i.qty}</td>
        <td><span class="badge status-${i.status}" style="font-size:10px">${STATUS_LABELS[i.status] || i.status}</span></td>
      </tr>`).join("");
    // Note: table headers EAN, Titel, EK, Menge, Status are technical CSV field names — not translated

    const moreNote = items.length > 6
      ? `<div style="color:var(--text-muted);font-size:11px;padding:6px 0">… und ${items.length - 6} weitere Artikel</div>` : "";

    const previewBody = `
      <div class="col gap-12">
        <p class="text-secondary text-sm"><strong style="color:var(--text)">${items.length}</strong> ${I18N.t('inv.import.preview_sub')}:</p>
        <div class="table-wrap" style="max-height:220px;overflow-y:auto">
          <table class="table">
            <thead><tr><th>EAN</th><th>Titel</th><th class="col-right">EK</th><th style="text-align:center">Menge</th><th>Status</th></tr></thead>
            <tbody>${previewRows}</tbody>
          </table>
        </div>
        ${moreNote}
        ${errNote}
        <p class="text-secondary" style="font-size:11px;border-top:1px solid var(--border);padding-top:8px">Bestehende Artikel (gleiche EAN) werden aktualisiert, nicht doppelt angelegt.</p>
      </div>
    `;

    Modal.open({
      title: I18N.t('inv.import.modal_title'),
      body: previewBody,
      buttons: [
        { label: I18N.t('inv.import.cancel'), variant: "btn-ghost", value: false },
        { label: `${items.length} ${I18N.t('inv.import.submit')}`, variant: "btn-primary", action: async () => {
          Modal.close(true);
          let done = 0, failed = 0;
          for (const item of items) {
            try { await Storage.upsertItem(item); done++; }
            catch { failed++; }
          }
          await loadItems(container);
          if (failed > 0) {
            Toast.warning(I18N.t('inv.import.done_warn'), `${done} ${I18N.t('inv.import.done_warn_sub')}, ${failed} ${I18N.t('inv.import.failed')}`);
          } else {
            Toast.success(I18N.t('inv.import.done'), `${done} ${I18N.t('inv.import.done_sub')}`);
          }
        }},
      ],
    });
  }

  // ── Versand Modal ─────────────────────────────────────────────────────────
  async function openReturnModal(id, container) {
    const item = _state.items.find(i => i.id === id);
    if (!item) return;

    const sellPrice = item.sell_price || 0;

    const body = `
      <div class="col gap-12">
        <div class="repr-alert repr-alert--warn">
          <span class="repr-alert-icon">↩</span>
          Retoure für <strong>${esc(item.title || item.ean || "Artikel")}</strong> erfassen
        </div>

        <div class="col gap-8">
          <div class="col gap-4">
            <label class="text-xs text-muted">Rückerstattungsbetrag (€)</label>
            <input type="number" id="retRefund" class="input" value="${sellPrice.toFixed(2)}" min="0" step="0.01" placeholder="0.00" />
            <span class="text-xs text-muted">Verkaufspreis war ${fmtEur(sellPrice)} — Voll- oder Teilerstattung eintragen</span>
          </div>
          <div class="col gap-4">
            <label class="text-xs text-muted">eBay Gebühren-Rückerstattung (€)</label>
            <input type="number" id="retFeeCredit" class="input" value="0" min="0" step="0.01" placeholder="0.00" />
          </div>
          <div class="col gap-4">
            <label class="text-xs text-muted">Artikel danach wieder einlagern?</label>
            <select id="retRestock" class="select">
              <option value="return">Ja — Status auf RETURN setzen</option>
              <option value="in_stock">Ja — zurück auf IN_STOCK</option>
              <option value="archived">Nein — archivieren</option>
            </select>
          </div>
        </div>
      </div>
    `;

    Modal.open({
      title: "↩ Retoure erfassen",
      body,
      buttons: [
        { label: "Abbrechen", variant: "btn-ghost", action: () => Modal.close() },
        { label: "Retoure speichern", variant: "btn-primary", action: async () => {
          const refundAmt  = parseFloat(document.querySelector("#retRefund")?.value) || 0;
          const feeCredit  = parseFloat(document.querySelector("#retFeeCredit")?.value) || 0;
          const restock    = document.querySelector("#retRestock")?.value || "return";

          const newStatus = restock === "in_stock" ? "IN_STOCK"
                          : restock === "archived"  ? "ARCHIVED"
                          : "RETURN";

          const updates = {
            ...item,
            status:            newStatus,
            refund_amount:     refundAmt,
            refund_date:       new Date().toISOString(),
            refund_fee_credit: feeCredit,
          };

          // If restocking, clear sale fields
          if (restock === "in_stock") {
            updates.sell_price   = null;
            updates.sold_at      = null;
            updates.shipped      = false;
            updates.ebay_order_id = null;
          }

          await Storage.upsertItem(updates);
          Modal.close();
          Toast.success("Retoure gespeichert", `${fmtEur(refundAmt)} erstattet · Status: ${newStatus}`);
          await loadItems(container);
          renderAll(container);
        }},
      ],
    });
  }

  async function openShipModal(id, container) {
    const item = _state.items.find(i => i.id === id);
    if (!item) return;

    const settings = await Storage.getSettings().catch(() => ({}));
    const ship = settings.shipping || {};
    const sender = {
      name:   ship.sender_name   || "",
      street: ship.sender_street || "",
      zip:    ship.sender_zip    || "",
      city:   ship.sender_city   || "",
      country: ship.sender_country || "DE",
    };
    const defaultWeight = ship.default_weight || 1.0;
    const defaultProduct = ship.default_product || "V01PAK";
    const hasSender = sender.name && sender.street && sender.zip && sender.city;

    // Try to extract recipient from eBay order data (if synced)
    const recipientName   = item.buyer_name   || "";
    const recipientStreet = item.buyer_street  || "";
    const recipientZip    = item.buyer_zip     || "";
    const recipientCity   = item.buyer_city    || "";

    const body = `
      <div class="col gap-12">
        ${!hasSender ? `<div class="repr-alert repr-alert--warn"><span class="repr-alert-icon">⚠</span> Bitte Absender-Adresse in Settings → Versand hinterlegen</div>` : ""}

        <div class="st-sub-header"><div class="st-sub-label">Empfänger</div></div>
        <div class="col gap-8">
          <input type="text" id="shipRecipName" class="input" placeholder="Name / Firma" value="${esc(recipientName)}" />
          <input type="text" id="shipRecipStreet" class="input" placeholder="Straße + Nr." value="${esc(recipientStreet)}" />
          <div class="row gap-8">
            <input type="text" id="shipRecipZip" class="input" placeholder="PLZ" value="${esc(recipientZip)}" style="width:100px" />
            <input type="text" id="shipRecipCity" class="input" placeholder="Stadt" value="${esc(recipientCity)}" style="flex:1" />
          </div>
        </div>

        <div class="st-sub-header"><div class="st-sub-label">Paket</div></div>
        <div class="row gap-12">
          <div class="col gap-4" style="flex:1">
            <label class="text-xs text-muted">Gewicht (kg)</label>
            <input type="number" id="shipWeight" class="input" value="${defaultWeight}" min="0.1" step="0.1" />
          </div>
          <div class="col gap-4" style="flex:1">
            <label class="text-xs text-muted">Produkt</label>
            <select id="shipProduct" class="select">
              <option value="V01PAK" ${defaultProduct === "V01PAK" ? "selected" : ""}>DHL Paket</option>
              <option value="V62WP" ${defaultProduct === "V62WP" ? "selected" : ""}>Warenpost</option>
              <option value="V01PRIO" ${defaultProduct === "V01PRIO" ? "selected" : ""}>Paket Prio</option>
              <option value="V86PARCEL" ${defaultProduct === "V86PARCEL" ? "selected" : ""}>Kleinpaket</option>
            </select>
          </div>
        </div>

        <div class="row gap-8 mt-4">
          <span class="text-xs text-muted">Artikel: <strong>${esc(item.title || item.ean || "—")}</strong></span>
        </div>
      </div>
    `;

    Modal.open({
      title: "📦 Versenden",
      body,
      buttons: [
        { label: "Abbrechen", variant: "btn-ghost", action: () => Modal.close() },
        { label: "Label erstellen & versenden", variant: "btn-primary", action: async () => {
          const recipName   = document.querySelector("#shipRecipName")?.value?.trim();
          const recipStreet = document.querySelector("#shipRecipStreet")?.value?.trim();
          const recipZip    = document.querySelector("#shipRecipZip")?.value?.trim();
          const recipCity   = document.querySelector("#shipRecipCity")?.value?.trim();
          const weight      = parseFloat(document.querySelector("#shipWeight")?.value) || defaultWeight;
          const product     = document.querySelector("#shipProduct")?.value || defaultProduct;

          if (!recipName || !recipStreet || !recipZip || !recipCity) {
            Toast.error("Fehler", "Bitte alle Empfänger-Felder ausfüllen.");
            return;
          }
          if (!hasSender) {
            Toast.error("Fehler", "Absender-Adresse fehlt. Bitte in Settings → Versand hinterlegen.");
            return;
          }

          Modal.close();
          Toast.info("Label wird erstellt…", "Bitte warten");

          try {
            // 1. Create DHL label
            const labelResult = await window.fc.dhlCreateLabel({
              sender,
              recipient: { name: recipName, street: recipStreet, zip: recipZip, city: recipCity, country: "DE" },
              weight_kg: weight,
              product,
              reference: item.ean || item.title || item.id,
            });

            if (!labelResult?.ok) {
              Toast.error("Label-Fehler", labelResult?.error || "Label konnte nicht erstellt werden.");
              return;
            }

            const trackingNo = labelResult.shipment_no;

            // 2. Mark item as shipped in inventory
            item.shipped = true;
            item.tracking_number = trackingNo;
            item.tracking_carrier = "DHL";
            await Storage.upsertItem(item);

            // 3. Upload tracking to marketplace
            if (item.market === "ebay" && item.ebay_offer_id) {
              try {
                const txnId = item.ebay_transaction_id || (item.ebay_order_id ? item.ebay_order_id.split("-")[1] : "0");
                await window.fc.ebayCompleteSale({
                  item_id: item.ebay_offer_id,
                  transaction_id: txnId,
                  tracking_number: trackingNo,
                  carrier: "DHL",
                });
              } catch (e) {
                console.warn("[Ship] eBay CompleteSale failed:", e);
                Toast.warning("Hinweis", "Label erstellt, aber eBay-Tracking konnte nicht hochgeladen werden.");
              }
            } else if (item.market === "kaufland" && item.kaufland_order_id) {
              try {
                await window.fc.kauflandCompleteSale({
                  order_unit_id: item.kaufland_unit_id || item.kaufland_order_id,
                  tracking_number: trackingNo,
                  carrier: "DHL",
                });
              } catch (e) {
                console.warn("[Ship] Kaufland CompleteSale failed:", e);
                Toast.warning("Hinweis", "Label erstellt, aber Kaufland-Tracking konnte nicht hochgeladen werden.");
              }
            }

            // 4. Open label PDF if available
            if (labelResult.label_pdf_b64) {
              const pdfBlob = _b64toBlob(labelResult.label_pdf_b64, "application/pdf");
              const url = URL.createObjectURL(pdfBlob);
              window.open(url, "_blank");
            } else if (labelResult.label_url) {
              window.open(labelResult.label_url, "_blank");
            }

            Toast.success("Versendet!", `Sendungsnr.: ${trackingNo}`);
            await loadItems(container);

          } catch (e) {
            Toast.error("Versand-Fehler", e.message || "Unbekannter Fehler");
          }
        }},
      ],
    });
  }

  // Base64 to Blob helper
  function _b64toBlob(b64, type) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type });
  }

  // ── Batch Ship (all pending) ─────────────────────────────────────────────
  async function batchShipAll() {
    const pending = _state.items.filter(i => i.status === "SOLD" && !i.shipped);
    if (pending.length === 0) { Toast.info("Alles versendet", "Keine ausstehenden Sendungen."); return; }

    const settings = await Storage.getSettings().catch(() => ({}));
    const ship = settings.shipping || {};
    const sender = {
      name: ship.sender_name || "", street: ship.sender_street || "",
      zip: ship.sender_zip || "", city: ship.sender_city || "", country: ship.sender_country || "DE",
    };
    if (!sender.name || !sender.street || !sender.zip || !sender.city) {
      Toast.error("Fehler", "Absender-Adresse fehlt. Bitte in Settings → Versand hinterlegen.");
      return;
    }

    // Check if all items have recipient data
    const missingRecipient = pending.filter(i => !i.buyer_name || !i.buyer_street || !i.buyer_zip || !i.buyer_city);
    if (missingRecipient.length > 0) {
      Toast.error("Empfänger fehlt", `${missingRecipient.length} Artikel haben keine Empfänger-Adresse. Bitte einzeln versenden.`);
      return;
    }

    const ok = await Modal.confirm(
      "Alle Labels erstellen",
      `${pending.length} Versandlabel${pending.length > 1 ? "s" : ""} erstellen und an eBay melden?`,
      { confirmLabel: `${pending.length} Labels erstellen`, danger: false }
    );
    if (!ok) return;

    Toast.info("Labels werden erstellt…", `${pending.length} Sendungen`);
    let success = 0, failed = 0;
    const pdfParts = [];

    for (const item of pending) {
      try {
        const result = await window.fc.dhlCreateLabel({
          sender,
          recipient: { name: item.buyer_name, street: item.buyer_street, zip: item.buyer_zip, city: item.buyer_city, country: "DE" },
          weight_kg: ship.default_weight || 1.0,
          product: ship.default_product || "V01PAK",
          reference: item.ean || item.title || item.id,
        });

        if (result?.ok && result.shipment_no) {
          item.shipped = true;
          item.tracking_number = result.shipment_no;
          item.tracking_carrier = "DHL";
          await Storage.upsertItem(item);

          if (result.label_pdf_b64) pdfParts.push(result.label_pdf_b64);

          // Marketplace tracking upload
          if (item.market === "ebay" && item.ebay_offer_id) {
            try {
              const txnId = item.ebay_transaction_id || (item.ebay_order_id ? item.ebay_order_id.split("-")[1] : "0");
              await window.fc.ebayCompleteSale({
                item_id: item.ebay_offer_id,
                transaction_id: txnId,
                tracking_number: result.shipment_no,
                carrier: "DHL",
              });
            } catch {}
          } else if (item.market === "kaufland" && item.kaufland_order_id) {
            try {
              await window.fc.kauflandCompleteSale({
                order_unit_id: item.kaufland_unit_id || item.kaufland_order_id,
                tracking_number: result.shipment_no,
                carrier: "DHL",
              });
            } catch {}
          }
          success++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    // Open first label as PDF (batch PDF merge would need a lib)
    if (pdfParts.length > 0) {
      const blob = _b64toBlob(pdfParts[0], "application/pdf");
      window.open(URL.createObjectURL(blob), "_blank");
      if (pdfParts.length > 1) {
        Toast.info("Hinweis", `${pdfParts.length} Labels erstellt — einzelne PDFs werden nacheinander geöffnet.`);
        for (let i = 1; i < pdfParts.length; i++) {
          setTimeout(() => {
            const b = _b64toBlob(pdfParts[i], "application/pdf");
            window.open(URL.createObjectURL(b), "_blank");
          }, i * 500);
        }
      }
    }

    if (failed > 0) {
      Toast.warning("Teilweise erfolgreich", `${success} Labels erstellt, ${failed} fehlgeschlagen.`);
    } else {
      Toast.success("Alle Labels erstellt!", `${success} Sendungen versendet.`);
    }
  }

  return { mount, unmount, batchShipAll };
})();
