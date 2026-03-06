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
    filter:    { q: "", status: "", market: "" },
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
      html += `<tr class="inv-vs-spacer"><td colspan="9" style="height:${topH}px"></td></tr>`;
    html += _state.vs.data.slice(start, end).map(renderRow).join("");
    if (botH > 0)
      html += `<tr class="inv-vs-spacer"><td colspan="9" style="height:${botH}px"></td></tr>`;

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
  async function mount(container) {
    // Reset state fresh on every mount
    _state.container = container;
    _state.selected  = new Set();
    _state.filter    = { q: "", status: "", market: "" };
    _state.sort      = { col: "age", dir: "asc" };
    _state.vs        = { data: [], wrap: null, busy: false };

    container.innerHTML = renderShell();
    attachFilterEvents(container);
    attachTableDelegation(container); // delegated once on stable parent — survives re-renders

    await loadItems(container);

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
    _state.container = null;
    _state.vs.wrap   = null;
  }

  function renderShell() {
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Inventory</h1>
          <p id="invCount">Lade…</p>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-ghost btn-sm" id="btnImportCsv" title="CSV importieren">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            Import
          </button>
          <button class="btn btn-ghost btn-sm" id="btnExportCsv" title="CSV exportieren">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 10V2M5 5l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            Export
          </button>
          <button class="btn btn-primary btn-sm" id="btnAddItem">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Hinzufügen
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
        <input id="invSearch" class="input" type="search" placeholder="Suche nach Titel, EAN, SKU…" style="flex:1;max-width:280px" />
        <select id="invStatusFilter" class="select">
          <option value="">Alle Status</option>
          ${STATUSES.map(s => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join("")}
        </select>
        <select id="invMarketFilter" class="select">
          <option value="">Alle Märkte</option>
          ${MARKETS.map(m => `<option value="${m}">${m.toUpperCase()}</option>`).join("")}
        </select>
      </div>

      <!-- Bulk Bar -->
      <div id="invBulkBar" class="inv-bulk-bar" style="display:none">
        <span id="invBulkCount">0 ausgewählt</span>
        <select id="invBulkStatus" class="select" style="max-width:160px;font-size:12px;padding:4px 8px;height:28px">
          <option value="">Status setzen…</option>
          ${STATUSES.map(s => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join("")}
        </select>
        <button class="btn btn-secondary btn-sm" id="btnBulkApply">Anwenden</button>
        <button class="btn btn-danger btn-sm" id="btnBulkDelete">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Löschen
        </button>
        <button class="btn btn-ghost btn-sm" id="btnBulkCancel" style="margin-left:auto">Abbrechen</button>
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
        <span class="batch-sum-label">Auf Lager</span>
      </div>
      <div class="batch-sum-sep"></div>
      <div class="batch-sum-kpi">
        <span class="batch-sum-val" style="color:var(--accent)">${listed}</span>
        <span class="batch-sum-label">Gelistet</span>
      </div>
      ${inbound > 0 ? `
      <div class="batch-sum-sep"></div>
      <div class="batch-sum-kpi">
        <span class="batch-sum-val" style="color:var(--yellow)">${inbound}</span>
        <span class="batch-sum-label">Unterwegs</span>
      </div>` : ""}
      <div class="batch-sum-sep"></div>
      <div class="batch-sum-kpi">
        <span class="batch-sum-val" style="color:var(--green)">${sold}</span>
        <span class="batch-sum-label">Verkauft</span>
      </div>
      <div class="batch-sum-sep"></div>
      <div class="batch-sum-kpi">
        <span class="batch-sum-val" style="${invested > 0 ? "" : "color:var(--text-muted)"}">${invested > 0 ? fmtEur(invested) : "—"}</span>
        <span class="batch-sum-label">Investiert</span>
      </div>
      ${avgProfit != null ? `
      <div class="batch-sum-sep"></div>
      <div class="batch-sum-kpi">
        <span class="batch-sum-val" style="color:${avgProfit >= 0 ? "var(--green)" : "var(--red)"}">${fmtEur(avgProfit)}</span>
        <span class="batch-sum-label">Ø Profit</span>
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
          <p class="empty-title">Keine Artikel</p>
          <p class="empty-sub">${_state.filter.q || _state.filter.status || _state.filter.market ? "Keine Artikel mit diesen Filtern gefunden." : "Noch keine Artikel im Inventory. Klicke auf \"Hinzufügen\"."}</p>
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
              <th class="inv-sort-th${_state.sort.col==="title"  ?" inv-sort-active":""}" data-sort="title" >Artikel ${_sortIcon("title")}</th>
              <th class="inv-sort-th${_state.sort.col==="market" ?" inv-sort-active":""}" data-sort="market">Markt ${_sortIcon("market")}</th>
              <th class="inv-sort-th col-right${_state.sort.col==="ek"     ?" inv-sort-active":""}" data-sort="ek"    >EK ${_sortIcon("ek")}</th>
              <th class="inv-sort-th col-right${_state.sort.col==="vk"     ?" inv-sort-active":""}" data-sort="vk"    >VK ${_sortIcon("vk")}</th>
              <th class="inv-sort-th col-right${_state.sort.col==="profit" ?" inv-sort-active":""}" data-sort="profit">Profit ${_sortIcon("profit")}</th>
              <th class="inv-sort-th${_state.sort.col==="status" ?" inv-sort-active":""}" data-sort="status">Status ${_sortIcon("status")}</th>
              <th class="inv-sort-th col-right${_state.sort.col==="age"    ?" inv-sort-active":""}" data-sort="age"   >Alter ${_sortIcon("age")}</th>
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
    const profit  = item.status === "SOLD" ? calcRealProfit(item) : null;
    const age     = item.created_at ? Math.floor((Date.now() - new Date(item.created_at)) / 86400000) : null;
    const checked = _state.selected.has(item.id);

    // Profit chip (reuse batch classes)
    const profitHtml = profit != null
      ? profit > 0
        ? `<div class="batch-profit batch-profit-pos">+${fmtEur(profit)}</div>`
        : `<div class="batch-profit batch-profit-neg">${fmtEur(profit)}</div>`
      : `<span class="text-dim">—</span>`;

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
            ${(item.qty || 1) > 1 ? `<span style="flex-shrink:0;font-size:10px;font-weight:700;color:var(--accent);background:var(--accent-subtle);padding:1px 5px;border-radius:4px">×${item.qty}</span>` : ""}
          </div>
          <div style="font-size:11px;color:var(--dim);margin-top:1px;font-family:var(--font-mono)">${esc(item.ean||"")}</div>
          ${item.label ? `<span class="badge badge-gray" style="margin-top:3px;font-size:10px">${esc(item.label)}</span>` : ""}
        </td>
        <td><span class="inv-mkt" style="${mktStyle}">${mktSvg} ${mktText}</span></td>
        <td class="col-right col-num" style="font-size:12px">${fmtEur(item.ek)}</td>
        <td class="col-right col-num" style="font-size:12px">${item.sell_price != null ? fmtEur(item.sell_price) : "—"}</td>
        <td class="col-right">${profitHtml}</td>
        <td><span class="badge status-${item.status||"IN_STOCK"}">${esc(STATUS_LABELS[item.status] || item.status || "—")}</span></td>
        <td class="col-right text-sm">${ageHtml}</td>
        <td>
          <div class="row" style="gap:4px;justify-content:flex-end">
            ${item.ean ? `<button class="btn btn-ghost btn-icon btn-inv-flip" data-id="${esc(item.id)}" data-ean="${esc(item.ean)}" data-ek="${esc(item.ek ?? 0)}" title="Flipcheck prüfen">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 4.5v5M4.5 7h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            </button>` : ""}
            ${item.status !== "SOLD" ? `<button class="btn btn-ghost btn-icon btn-inv-sold" data-id="${esc(item.id)}" title="Als verkauft markieren">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>` : ""}
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
    el.textContent = `${_state.items.length} Artikel · ${f.length} angezeigt`;
  }

  function updateBulkBar(container) {
    const bar = container?.querySelector("#invBulkBar");
    const count = container?.querySelector("#invBulkCount");
    if (!bar) return;
    if (_state.selected.size > 0) {
      bar.style.display = "flex";
      if (count) count.textContent = `${_state.selected.size} ausgewählt`;
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

    container.querySelector("#btnAddItem")?.addEventListener("click", () => openAddModal(container));
    container.querySelector("#btnRefreshInv")?.addEventListener("click", () => loadItems(container));
    container.querySelector("#btnImportCsv")?.addEventListener("click", () => openImportModal(container));
    container.querySelector("#btnExportCsv")?.addEventListener("click", () => exportCsv());

    container.querySelector("#btnBulkApply")?.addEventListener("click", async () => {
      const status = container.querySelector("#invBulkStatus")?.value;
      if (!status) { Toast.warning("Kein Status", "Bitte einen Status auswählen."); return; }
      const ids = [..._state.selected];
      await Storage.bulkUpdate(ids, { status });
      _state.selected.clear();
      await loadItems(container);
      updateBulkBar(container);
      Toast.success("Aktualisiert", `${ids.length} Artikel auf "${STATUS_LABELS[status]}" gesetzt.`);
    });

    container.querySelector("#btnBulkDelete")?.addEventListener("click", async () => {
      const ok = await Modal.confirm("Löschen bestätigen", `${_state.selected.size} Artikel wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`, { confirmLabel: "Löschen", danger: true });
      if (!ok) return;
      const ids = [..._state.selected];
      for (const id of ids) await Storage.deleteItem(id);
      _state.selected.clear();
      await loadItems(container);
      updateBulkBar(container);
      Toast.success("Gelöscht", `${ids.length} Artikel gelöscht.`);
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

      const flipBtn = e.target.closest(".btn-inv-flip");
      if (flipBtn) {
        const ean = flipBtn.dataset.ean;
        const ek  = parseFloat(flipBtn.dataset.ek) || 0;
        if (ean) openPricecheckModal(ean, ek, flipBtn);
        return;
      }
    });
  }

  // ── Modals ───────────────────────────────────────────────────────────────

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
              <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${margin != null ? `${margin.toFixed(1)} % Marge` : "EK = 0 → kein Profit"}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
            <div class="fc-amz-kpi"><div class="fc-amz-kpi-v">${fmtEur(data.sell_price_median)}</div><div class="fc-amz-kpi-l">Median VK</div></div>
            <div class="fc-amz-kpi"><div class="fc-amz-kpi-v">${profit != null ? fmtEur(profit) : "—"}</div><div class="fc-amz-kpi-l">Profit</div></div>
            <div class="fc-amz-kpi"><div class="fc-amz-kpi-v">${margin != null ? margin.toFixed(1) + " %" : "—"}</div><div class="fc-amz-kpi-l">Marge</div></div>
            <div class="fc-amz-kpi"><div class="fc-amz-kpi-v">${data.sales_30d ?? "—"}</div><div class="fc-amz-kpi-l">Verk./30d</div></div>
          </div>
          <div style="font-size:11px;color:var(--dim);padding-top:8px;border-top:1px solid var(--border);display:flex;gap:16px;flex-wrap:wrap">
            <span>EAN: <strong style="color:var(--text-secondary)">${esc(ean)}</strong></span>
            <span>EK: <strong style="color:var(--text-secondary)">${fmtEur(ek)}</strong></span>
            ${data.competition != null ? `<span>Konkurrenten: <strong style="color:var(--text-secondary)">${data.competition}</strong></span>` : ""}
            ${data.sales_last_day != null ? `<span>Ø/Tag: <strong style="color:var(--text-secondary)">${data.sales_last_day.toFixed(1)}</strong></span>` : ""}
          </div>
        </div>`,
        buttons: [{ label: "Schließen", variant: "btn-ghost", value: false }],
      });
    } catch (err) {
      Toast.error("Flipcheck fehlgeschlagen", err.message || "Backend nicht erreichbar");
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
    }
  }

  function openAddModal(container) {
    const body = `
      <div class="col gap-12">
        <div class="input-group">
          <label class="input-label">EAN *</label>
          <input id="mEan" class="input" type="text" placeholder="Barcode" autocomplete="off" />
        </div>
        <div class="input-group">
          <label class="input-label">Titel</label>
          <input id="mTitle" class="input" type="text" placeholder="Produktname" />
        </div>
        <div class="grid-2 gap-12">
          <div class="input-group">
            <label class="input-label">Einkaufspreis (€)</label>
            <input id="mEk" class="input" type="number" step="0.01" min="0" placeholder="0.00" />
          </div>
          <div class="input-group">
            <label class="input-label">Menge</label>
            <input id="mQty" class="input" type="number" min="1" value="1" />
          </div>
        </div>
        <div class="grid-2 gap-12">
          <div class="input-group">
            <label class="input-label">Markt</label>
            <select id="mMarket" class="select">
              ${MARKETS.map(m => `<option value="${m}">${m.toUpperCase()}</option>`).join("")}
            </select>
          </div>
          <div class="input-group">
            <label class="input-label">Status</label>
            <select id="mStatus" class="select">
              ${STATUSES.map(s => `<option value="${s}" ${s==="IN_STOCK"?"selected":""}>${STATUS_LABELS[s]}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="input-group">
          <label class="input-label">Label</label>
          <input id="mLabel" class="input" type="text" placeholder="Tag, Kategorie…" />
        </div>
        <div class="input-group">
          <label class="input-label">Bezugsquelle</label>
          <input id="mSource" class="input" type="text" placeholder="z.B. Amazon, Lidl, OBI…" />
        </div>
      </div>
    `;

    Modal.open({
      title: "Artikel hinzufügen",
      body,
      buttons: [
        { label: "Abbrechen", variant: "btn-ghost", value: false },
        { label: "Hinzufügen", variant: "btn-primary", action: async () => {
          const ean = document.getElementById("mEan")?.value.trim();
          if (!ean) { Toast.error("EAN fehlt", "Bitte eine EAN eingeben."); return; }
          await Storage.upsertItem({
            ean,
            title: document.getElementById("mTitle")?.value.trim() || "",
            ek: parseFloat(document.getElementById("mEk")?.value) || null,
            qty: parseInt(document.getElementById("mQty")?.value) || 1,
            market: document.getElementById("mMarket")?.value || "ebay",
            status: document.getElementById("mStatus")?.value || "IN_STOCK",
            label: document.getElementById("mLabel")?.value.trim() || "",
            source: document.getElementById("mSource")?.value.trim() || "",
          });
          Modal.close(true);
          await loadItems(container);
          Toast.success("Hinzugefügt", `${ean} wurde zum Inventory hinzugefügt.`);
        }},
      ],
    });
  }

  function openEditModal(id, container) {
    const item = _state.items.find(i => i.id === id);
    if (!item) return;

    const body = `
      <div class="col gap-12">
        <div class="input-group">
          <label class="input-label">Titel</label>
          <input id="eTitle" class="input" type="text" value="${esc(item.title||"")}" />
        </div>
        <div class="input-group">
          <label class="input-label">EAN</label>
          <input id="eEan" class="input" type="text" value="${esc(item.ean||"")}" />
        </div>
        <div class="grid-2 gap-12">
          <div class="input-group">
            <label class="input-label">EK (€)</label>
            <input id="eEk" class="input" type="number" step="0.01" value="${item.ek||""}" />
          </div>
          <div class="input-group">
            <label class="input-label">Menge</label>
            <input id="eQty" class="input" type="number" min="1" value="${item.qty||1}" />
          </div>
        </div>
        <div class="grid-2 gap-12">
          <div class="input-group">
            <label class="input-label">Markt</label>
            <select id="eMarket" class="select">
              ${MARKETS.map(m => `<option value="${m}" ${item.market===m?"selected":""}>${m.toUpperCase()}</option>`).join("")}
            </select>
          </div>
          <div class="input-group">
            <label class="input-label">Status</label>
            <select id="eStatus" class="select">
              ${STATUSES.map(s => `<option value="${s}" ${item.status===s?"selected":""}>${STATUS_LABELS[s]}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="input-group">
          <label class="input-label">Label</label>
          <input id="eLabel" class="input" type="text" value="${esc(item.label||"")}" />
        </div>
        <div class="input-group">
          <label class="input-label">Bezugsquelle</label>
          <input id="eSource" class="input" type="text" value="${esc(item.source||"")}" placeholder="z.B. Amazon, Lidl, OBI" />
        </div>
        <div class="input-group">
          <label class="input-label">Notiz</label>
          <textarea id="eNotes" class="textarea" rows="2">${esc(item.notes||"")}</textarea>
        </div>
      </div>
    `;

    Modal.open({
      title: `Artikel bearbeiten`,
      body,
      buttons: [
        { label: "Löschen", variant: "btn-danger", action: async () => {
          const ok = await Modal.confirm("Löschen?", `"${item.title||item.ean}" wirklich löschen?`, { confirmLabel: "Löschen", danger: true });
          if (!ok) return;
          await Storage.deleteItem(id);
          await loadItems(container);
          Toast.success("Gelöscht");
        }},
        { label: "Abbrechen", variant: "btn-ghost", value: false },
        { label: "Speichern", variant: "btn-primary", action: async () => {
          const newStatus = document.getElementById("eStatus")?.value || item.status;
          await Storage.upsertItem({
            ...item,
            title:  document.getElementById("eTitle")?.value.trim() || item.title,
            ean:    document.getElementById("eEan")?.value.trim()   || item.ean,
            ek:     parseFloat(document.getElementById("eEk")?.value) || item.ek,
            qty:    parseInt(document.getElementById("eQty")?.value)  || item.qty,
            market: document.getElementById("eMarket")?.value || item.market,
            status: newStatus,
            label:  document.getElementById("eLabel")?.value.trim()  || "",
            source: document.getElementById("eSource")?.value.trim() || "",
            notes:  document.getElementById("eNotes")?.value.trim()  || "",
            // Auto-stamp sold_at when status changes to SOLD and it wasn't set before
            sold_at: newStatus === "SOLD" && !item.sold_at ? new Date().toISOString() : item.sold_at,
          });
          Modal.close(true);
          await loadItems(container);
          Toast.success("Gespeichert");
        }},
      ],
    });
  }

  function _buildCatOptions(selectedId) {
    const GROUPS = {
      "Geräte (6,5% + 3%)":  ["computer_tablets","drucker","foto_camcorder","handys","haushaltsgeraete","konsolen","scanner","speicherkarten","tv_video_audio","koerperpflege"],
      "Zubehör (11% + 3%)":  ["drucker_zubehoer","handy_zubehoer","batterien","kabel","kameras_zubehoer","notebook_zubehoer","objektive","stative","tablet_zubehoer","tastaturen_maeuse","tv_zubehoer","pc_zubehoer","audio_zubehoer"],
      "Sonstiges (Flat)":    ["mode","sport_freizeit","spielzeug","haushalt_garten","buecher","sonstiges"],
    };
    const sel = selectedId || "sonstiges";
    return Object.entries(GROUPS).map(([grp, ids]) =>
      `<optgroup label="${grp}">${ids.map(id => {
        const cat = EBAY_FEE_CATEGORIES.find(c => c.id === id);
        return cat ? `<option value="${cat.id}" ${cat.id === sel ? "selected" : ""}>${cat.label}</option>` : "";
      }).join("")}</optgroup>`
    ).join("");
  }

  function openSoldModal(id, container) {
    const item = _state.items.find(i => i.id === id);
    if (!item) return;

    const totalQty = Number(item.qty) || 1;

    const body = `
      <div class="col gap-12">
        <p class="text-secondary text-sm">"${esc(item.title||item.ean)}" als verkauft markieren.</p>

        ${totalQty > 1 ? `
        <div class="input-group">
          <label class="input-label">
            Menge verkaufen
            <span style="color:var(--text-muted);font-weight:400;margin-left:4px">auf Lager: ${totalQty}×</span>
          </label>
          <div style="display:flex;align-items:center;gap:10px">
            <input id="soldQtyInp" class="input" type="number" min="1" max="${totalQty}" value="${totalQty}"
              style="max-width:90px;text-align:center;font-size:15px;font-weight:600" />
            <div id="soldQtyHint" class="inv-sold-qty-hint inv-sold-qty-hint--all">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Alle ${totalQty} Stück als verkauft
            </div>
          </div>
        </div>
        ` : ""}

        <div class="grid-2 gap-12">
          <div class="input-group">
            <label class="input-label">Verkaufspreis (€) *</label>
            <div class="input-prefix-wrap">
              <span class="prefix">€</span>
              <input id="soldVk" class="input" type="number" step="0.01" min="0" placeholder="0.00" />
            </div>
          </div>
          <div class="input-group">
            <label class="input-label">Versand raus (€)</label>
            <div class="input-prefix-wrap">
              <span class="prefix">€</span>
              <input id="soldShipOut" class="input" type="number" step="0.01" min="0" placeholder="0.00" value="${item.ship_out || ""}" />
            </div>
          </div>
        </div>
        ${(!item.market || item.market === "ebay") ? `
        <div class="input-group">
          <label class="input-label">Kategorie (für eBay-Gebühr)</label>
          <select id="soldCatId" class="select">${_buildCatOptions(item.cat_id)}</select>
        </div>` : `
        <div class="input-group">
          <label class="input-label">Marktgebühr</label>
          <div class="input-prefix-wrap" style="cursor:default;pointer-events:none;opacity:.7">
            <span class="prefix">%</span>
            <input class="input" type="text" readonly value="${item.market === "amz" ? "15,0 (Amazon Referral)" : item.market === "kaufland" ? "10,5 (Kaufland Provision)" : "0"}"/>
          </div>
        </div>`}
        <input type="hidden" id="soldCatId" value="${esc(item.cat_id || "sonstiges")}"/>
        <div class="input-group">
          <label class="input-label">Verkaufsdatum</label>
          <input id="soldDate" class="input" type="date" value="${new Date().toISOString().slice(0,10)}" />
        </div>
        <div id="soldProfitPreview" style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--r);padding:10px 14px;font-size:12px;color:var(--text-secondary)">
          Profit-Vorschau erscheint nach VK-Eingabe
        </div>
      </div>
    `;

    Modal.open({
      title: "Als verkauft markieren",
      body,
      buttons: [
        { label: "Abbrechen", variant: "btn-ghost", value: false },
        { label: "Verkauft", variant: "btn-success", action: async () => {
          const vk = parseFloat(document.getElementById("soldVk")?.value);
          if (!vk || vk <= 0) { Toast.error("VK fehlt", "Bitte einen Verkaufspreis eingeben."); return; }

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
              `${soldQty}× verkauft`,
              `${remainQty}× bleibt auf Lager${perUnitProfit != null ? ` · Profit: ${fmtEur(perUnitProfit)}/Stück` : ""}`
            );
          } else {
            Toast.success(
              "Verkauft",
              perUnitProfit != null ? `Profit (nach Gebühren): ${fmtEur(perUnitProfit)}` : "Artikel als verkauft markiert."
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

      const MKT_FEE_RATES_INV = { amz: 0.15, kaufland: 0.105, other: 0 };
      const MKT_FEE_LABELS    = { ebay: "eBay-Gebühr", amz: "Amazon-Gebühr", kaufland: "Kaufland-Gebühr", other: "Gebühr" };

      const updatePreview = () => {
        const vk      = parseFloat(document.getElementById("soldVk")?.value)      || 0;
        const shipOut = parseFloat(document.getElementById("soldShipOut")?.value) || 0;
        const catId   = document.getElementById("soldCatId")?.value               || "sonstiges";
        const soldQty = getQty();
        const el      = document.getElementById("soldProfitPreview");
        if (!el) return;
        if (!vk || !item.ek) { el.textContent = "Profit-Vorschau erscheint nach VK-Eingabe"; return; }
        const market     = item.market || "ebay";
        const fee        = market === "ebay"
          ? calcEbayFee(vk, catId)
          : vk * (MKT_FEE_RATES_INV[market] ?? 0);
        const feeLabel   = MKT_FEE_LABELS[market] || "Gebühr";
        const unitProfit = vk - item.ek - shipOut - fee;
        const roi        = item.ek > 0 ? (unitProfit / item.ek * 100) : 0;
        const color      = unitProfit >= 0 ? "var(--green)" : "var(--red)";
        el.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span>Profit${soldQty > 1 ? " pro Stück" : ""} (nach Geb. + Versand)</span>
            <strong style="color:${color};font-size:14px">${fmtEur(unitProfit)}</strong>
          </div>
          ${soldQty > 1 ? `
          <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:12px">
            <span style="color:var(--text-muted)">${soldQty}× gesamt</span>
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
            ${remQ}× bleibt auf Lager`;
        } else {
          hint.className = "inv-sold-qty-hint inv-sold-qty-hint--all";
          hint.innerHTML = `
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
              <path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Alle ${totalQty} Stück als verkauft`;
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
    if (rows.length === 0) { Toast.warning("Keine Daten", "Keine Artikel zum Exportieren."); return; }

    const cols   = ["ean","title","ek","qty","status","market","sell_price","ship_out","cat_id","label","source","notes","created_at","sold_at"];
    const header = ["EAN","Titel","EK","Menge","Status","Markt","VK","Versand raus","Kategorie","Label","Quelle","Notiz","Erstellt","Verkauft am"];

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
    Toast.success("Exportiert", `${rows.length} Artikel als CSV gespeichert.`);
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
      reader.onerror = () => Toast.error("Lesefehler", "CSV konnte nicht gelesen werden.");
      reader.readAsText(file, "utf-8");
    });

    fileInp.click();
  }

  function parseAndPreviewCsv(text, container) {
    const { items, skipped, error } = InventoryData.parseCsv(text, STATUSES);

    if (error === "too_few_lines") { Toast.error("Leere Datei", "CSV enthält keine Daten."); return; }
    if (error === "no_ean_column") {
      Toast.error("Format-Fehler", "Keine EAN-Spalte. Erwartet: EAN, Barcode oder GTIN als Spaltenname.");
      return;
    }

    if (items.length === 0) {
      Toast.error("Keine Artikel", skipped.length ? skipped[0] : "Keine gültigen Artikel in der CSV.");
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

    const moreNote = items.length > 6
      ? `<div style="color:var(--text-muted);font-size:11px;padding:6px 0">… und ${items.length - 6} weitere Artikel</div>` : "";

    const previewBody = `
      <div class="col gap-12">
        <p class="text-secondary text-sm"><strong style="color:var(--text)">${items.length}</strong> Artikel bereit zum Import:</p>
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
      title: "CSV Import",
      body: previewBody,
      buttons: [
        { label: "Abbrechen", variant: "btn-ghost", value: false },
        { label: `${items.length} importieren`, variant: "btn-primary", action: async () => {
          Modal.close(true);
          let done = 0, failed = 0;
          for (const item of items) {
            try { await Storage.upsertItem(item); done++; }
            catch { failed++; }
          }
          await loadItems(container);
          if (failed > 0) {
            Toast.warning("Import fertig", `${done} importiert, ${failed} fehlgeschlagen.`);
          } else {
            Toast.success("Import abgeschlossen", `${done} Artikel erfolgreich importiert.`);
          }
        }},
      ],
    });
  }

  return { mount, unmount };
})();
