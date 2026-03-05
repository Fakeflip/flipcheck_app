/* Flipcheck Web App — Inventory View (v2 quality) */
const InventoryView = (() => {
  let _el    = null;
  let _items = [];
  let _filter = { q: "", status: "", market: "" };
  let _sort   = { key: "updated_at", dir: "desc" };

  /* ── Filtering + Sorting ─────────────────────────────────────────── */
  function getFiltered() {
    let rows = [..._items];
    const q = _filter.q.toLowerCase();
    if (q) rows = rows.filter(i =>
      (i.ean || "").toLowerCase().includes(q) ||
      (i.title || "").toLowerCase().includes(q)
    );
    if (_filter.status) rows = rows.filter(i => i.status === _filter.status);
    if (_filter.market) rows = rows.filter(i => i.market === _filter.market);

    rows.sort((a, b) => {
      const k = _sort.key;
      const dir = _sort.dir === "asc" ? 1 : -1;
      if (k === "profit") {
        const pa = calcRealProfit(a) ?? -Infinity;
        const pb = calcRealProfit(b) ?? -Infinity;
        return pa < pb ? -dir : pa > pb ? dir : 0;
      }
      let va = a[k] ?? "";
      let vb = b[k] ?? "";
      if (k === "ek" || k === "sell_price" || k === "qty") {
        va = parseFloat(va) || 0;
        vb = parseFloat(vb) || 0;
      }
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    return rows;
  }

  /* ── Stats ───────────────────────────────────────────────────────── */
  function calcStats(items) {
    let inStock = 0, listed = 0, sold = 0, invested = 0, profit = 0;
    for (const i of items) {
      if (FC.ACTIVE_STATUSES.includes(i.status)) inStock++;
      if (i.status === "LISTED" || i.status === "LISTING_PENDING") listed++;
      if (i.status === "SOLD") {
        sold++;
        const p = calcRealProfit(i);
        if (p != null) profit += p;
      }
      if (FC.ACTIVE_STATUSES.includes(i.status) && i.ek != null) {
        invested += (i.ek || 0) * (i.qty || 1);
      }
    }
    return { inStock, listed, sold, invested, profit };
  }

  /* ── Status badge ────────────────────────────────────────────────── */
  function statusBadge(status) {
    const colors = {
      IN_STOCK:        "background:rgba(16,185,129,.12);color:#10B981;border:1px solid rgba(16,185,129,.28)",
      LISTED:          "background:rgba(99,102,241,.12);color:#A5B4FC;border:1px solid rgba(99,102,241,.28)",
      LISTING_PENDING: "background:rgba(139,92,246,.12);color:#C4B5FD;border:1px solid rgba(139,92,246,.28)",
      INBOUND:         "background:rgba(59,130,246,.12);color:#93C5FD;border:1px solid rgba(59,130,246,.28)",
      SOLD:            "background:rgba(245,158,11,.12);color:#FCD34D;border:1px solid rgba(245,158,11,.28)",
      RETURN:          "background:rgba(239,68,68,.12);color:#FCA5A5;border:1px solid rgba(239,68,68,.28)",
      ARCHIVED:        "background:rgba(71,85,105,.20);color:#94A3B8;border:1px solid rgba(71,85,105,.4)",
    };
    const label = FC.STATUS_LABELS[status] || status;
    const style = colors[status] || colors.ARCHIVED;
    return `<span class="badge" style="${style}">${esc(label)}</span>`;
  }

  /* ── Market badge ────────────────────────────────────────────────── */
  function marketBadge(market) {
    if (!market) return "—";
    const colors = {
      ebay:     "background:rgba(255,204,0,.10);color:#FFCC00;border:1px solid rgba(255,204,0,.25)",
      amazon:   "background:rgba(255,153,0,.10);color:#FF9900;border:1px solid rgba(255,153,0,.25)",
      kaufland: "background:rgba(239,68,68,.10);color:#F87171;border:1px solid rgba(239,68,68,.25)",
    };
    const label = FC.MARKET_LABELS[market] || market;
    const style = colors[market] || "background:rgba(71,85,105,.20);color:#94A3B8;border:1px solid rgba(71,85,105,.4)";
    return `<span class="badge" style="${style}">${esc(label)}</span>`;
  }

  /* ── Age color ───────────────────────────────────────────────────── */
  function ageColor(dateStr) {
    if (!dateStr) return "var(--text-muted)";
    const days = (Date.now() - new Date(dateStr).getTime()) / 86400000;
    if (days < 7)  return "var(--green)";
    if (days < 30) return "var(--text-secondary)";
    return "var(--red)";
  }

  /* ── Sort icon ───────────────────────────────────────────────────── */
  function sortIcon(key) {
    if (_sort.key !== key) return `<span class="inv-sort-icon">⇅</span>`;
    return `<span class="inv-sort-icon active">${_sort.dir === "asc" ? "↑" : "↓"}</span>`;
  }

  /* ── Render table ────────────────────────────────────────────────── */
  function renderTable(rows) {
    if (!rows.length) {
      return `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="6" y="6" width="28" height="28" rx="4" stroke="currentColor" stroke-width="2"/><path d="M13 20h14M13 14h14M13 26h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <p>${_items.length ? "Keine Treffer für deine Filter" : "Noch keine Artikel im Inventar"}</p>
        </div>`;
    }

    return `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th class="inv-sort-th" data-sort="ean">EAN</th>
            <th class="inv-sort-th" data-sort="title">Bezeichnung</th>
            <th class="inv-sort-th" data-sort="ek">EK ${sortIcon("ek")}</th>
            <th class="inv-sort-th" data-sort="qty">Menge</th>
            <th>Status</th>
            <th>Markt</th>
            <th class="inv-sort-th" data-sort="sell_price">VK ${sortIcon("sell_price")}</th>
            <th class="inv-sort-th" data-sort="profit">Profit ${sortIcon("profit")}</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${rows.map(i => {
              const profit = calcRealProfit(i);
              const pColor = profit != null ? (profit >= 0 ? "var(--green)" : "var(--red)") : "var(--text-secondary)";
              return `
              <tr data-id="${esc(i.id)}">
                <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary)">${esc(i.ean || "—")}</td>
                <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(i.title || "")}">${esc(i.title || "—")}</td>
                <td style="font-variant-numeric:tabular-nums">${i.ek != null ? fmtEurPlain(i.ek) : "—"}</td>
                <td>${i.qty || 1}</td>
                <td>${statusBadge(i.status)}</td>
                <td>${marketBadge(i.market)}</td>
                <td style="font-variant-numeric:tabular-nums">${i.sell_price != null ? fmtEurPlain(i.sell_price) : "—"}</td>
                <td style="font-variant-numeric:tabular-nums;color:${pColor}">${profit != null ? fmtEur(profit) : "—"}</td>
                <td style="text-align:right">
                  <div style="display:flex;gap:4px;justify-content:flex-end">
                    <button class="btn btn-ghost btn-sm inv-fc-btn" data-id="${esc(i.id)}" data-ean="${esc(i.ean || "")}" title="Flipcheck" style="color:var(--accent)">▲</button>
                    <button class="btn btn-ghost btn-sm inv-edit-btn" data-id="${esc(i.id)}" title="Bearbeiten">✏️</button>
                    <button class="btn btn-ghost btn-sm inv-del-btn" data-id="${esc(i.id)}" title="Löschen" style="color:var(--red)">🗑</button>
                  </div>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  /* ── Shell ───────────────────────────────────────────────────────── */
  function buildShell() {
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Inventar</h1>
          <p id="invCount" style="color:var(--text-secondary);font-size:12px;margin-top:4px"></p>
        </div>
        <div class="page-header-right">
          <button class="btn btn-primary btn-sm" id="btnAddItem">+ Artikel</button>
        </div>
      </div>

      <!-- Stats bar -->
      <div class="inv-stats-bar" id="invStats"></div>

      <div class="inv-toolbar">
        <input class="input" id="invSearch" placeholder="Suche EAN, Bezeichnung…" type="search" style="min-height:36px"/>
        <div class="inv-filters">
          <select class="select" id="invStatus" style="min-height:36px;min-width:130px;padding:5px 10px">
            <option value="">Alle Status</option>
            ${FC.STATUSES.map(s => `<option value="${s}">${FC.STATUS_LABELS[s]}</option>`).join("")}
          </select>
          <select class="select" id="invMarket" style="min-height:36px;min-width:120px;padding:5px 10px">
            <option value="">Alle Märkte</option>
            ${FC.MARKETS.map(m => `<option value="${m}">${FC.MARKET_LABELS[m]}</option>`).join("")}
          </select>
        </div>
      </div>

      <div id="invTableWrap"></div>
    `;
  }

  /* ── Render stats bar ────────────────────────────────────────────── */
  function renderStats() {
    const statsEl = _el?.querySelector("#invStats");
    if (!statsEl) return;
    const s = calcStats(_items);
    statsEl.innerHTML = `
      <div class="inv-stat-pill">
        <span style="color:var(--text-secondary);font-size:11px">Aktiv</span>
        <span style="font-weight:700">${s.inStock}</span>
      </div>
      <div class="inv-stat-pill">
        <span style="color:var(--text-secondary);font-size:11px">Listed</span>
        <span style="font-weight:700">${s.listed}</span>
      </div>
      <div class="inv-stat-pill">
        <span style="color:var(--text-secondary);font-size:11px">Investiert</span>
        <span style="font-weight:700">${fmtEurPlain(s.invested)}</span>
      </div>
      <div class="inv-stat-pill">
        <span style="color:var(--text-secondary);font-size:11px">Verkauft</span>
        <span style="font-weight:700">${s.sold}</span>
      </div>
      <div class="inv-stat-pill">
        <span style="color:var(--text-secondary);font-size:11px">Profit</span>
        <span style="font-weight:700;color:${s.profit >= 0 ? "var(--green)" : "var(--red)"}">${fmtEur(s.profit)}</span>
      </div>
    `;
  }

  /* ── Render all ──────────────────────────────────────────────────── */
  function renderAll() {
    const rows = getFiltered();
    const wrap = _el?.querySelector("#invTableWrap");
    if (wrap) wrap.innerHTML = renderTable(rows);
    const cnt = _el?.querySelector("#invCount");
    if (cnt) cnt.textContent = `${rows.length} von ${_items.length} Artikeln`;
    renderStats();
    bindSortHeaders();
    bindRowEvents();
  }

  /* ── Sort headers ────────────────────────────────────────────────── */
  function bindSortHeaders() {
    _el?.querySelectorAll(".inv-sort-th[data-sort]").forEach(th => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (_sort.key === key) {
          _sort.dir = _sort.dir === "asc" ? "desc" : "asc";
        } else {
          _sort.key = key;
          _sort.dir = key === "updated_at" ? "desc" : "asc";
        }
        renderAll();
      });
    });
  }

  /* ── Row events ──────────────────────────────────────────────────── */
  function bindRowEvents() {
    // Flipcheck quick-launch
    _el?.querySelectorAll(".inv-fc-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const ean = btn.dataset.ean;
        if (!ean) return;
        App._navPayload = { ean };
        App.navigateTo("flipcheck");
      });
    });

    // Edit
    _el?.querySelectorAll(".inv-edit-btn").forEach(btn => {
      btn.addEventListener("click", () => openEditModal(btn.dataset.id));
    });

    // Delete
    _el?.querySelectorAll(".inv-del-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id   = btn.dataset.id;
        const item = _items.find(i => i.id === id);
        const ok   = await Modal.confirm("Artikel löschen", `"${item?.title || item?.ean || id}" wirklich löschen?`, { confirmLabel: "Löschen", danger: true });
        if (!ok) return;
        try {
          await Storage.deleteItem(id);
          _items = _items.filter(i => i.id !== id);
          renderAll();
          Toast.success("Gelöscht");
        } catch (e) { Toast.error("Fehler", e.message); }
      });
    });
  }

  /* ── Edit modal ──────────────────────────────────────────────────── */
  async function openEditModal(id) {
    const item  = _items.find(i => i.id === id) || {};
    const isNew = !id;

    const bodyHtml = `
      <div class="field-row">
        <div class="field"><label class="input-label">EAN</label><input class="input" id="iEan" value="${esc(item.ean || "")}" placeholder="EAN" inputmode="numeric"/></div>
        <div class="field"><label class="input-label">Menge</label><input class="input" id="iQty" type="number" min="1" value="${esc(item.qty || 1)}"/></div>
      </div>
      <div class="field"><label class="input-label">Bezeichnung</label><input class="input" id="iTitle" value="${esc(item.title || "")}" placeholder="Produktbezeichnung"/></div>
      <div class="field-row">
        <div class="field"><label class="input-label">EK (€)</label><div class="input-prefix-wrap"><span class="prefix">€</span><input class="input" id="iEk" type="number" step="0.01" value="${esc(item.ek || "")}"/></div></div>
        <div class="field"><label class="input-label">VK (€)</label><div class="input-prefix-wrap"><span class="prefix">€</span><input class="input" id="iVk" type="number" step="0.01" value="${esc(item.sell_price || "")}"/></div></div>
      </div>
      <div class="field-row">
        <div class="field"><label class="input-label">Status</label><select class="select" id="iStatus">${FC.STATUSES.map(s => `<option value="${s}"${s === item.status ? " selected" : ""}>${FC.STATUS_LABELS[s]}</option>`).join("")}</select></div>
        <div class="field"><label class="input-label">Markt</label><select class="select" id="iMarket">${FC.MARKETS.map(m => `<option value="${m}"${m === item.market ? " selected" : ""}>${FC.MARKET_LABELS[m]}</option>`).join("")}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label class="input-label">Versand raus (€)</label><div class="input-prefix-wrap"><span class="prefix">€</span><input class="input" id="iShipOut" type="number" step="0.01" value="${esc(item.ship_out || "")}"/></div></div>
        <div class="field"><label class="input-label">EK-Datum</label><input class="input" id="iEkDate" type="date" value="${esc(item.ek_date || "")}"/></div>
      </div>
      ${item.status === "SOLD" || isNew ? "" : `
      <div class="field-row">
        <div class="field"><label class="input-label">Verkauft am</label><input class="input" id="iSoldAt" type="date" value="${esc(item.sold_at || "")}"/></div>
        <div class="field"></div>
      </div>`}
      <div class="field"><label class="input-label">Notiz</label><input class="input" id="iNotes" value="${esc(item.notes || "")}" placeholder="Optional"/></div>
    `;

    await Modal.open({
      title:   isNew ? "Neuer Artikel" : "Artikel bearbeiten",
      body:    bodyHtml,
      buttons: [
        { label: "Abbrechen", variant: "btn-ghost", value: null },
        { label: isNew ? "Hinzufügen" : "Speichern", variant: "btn-primary", action: async () => {
          const patch = {
            ...(id ? { id } : {}),
            ean:        document.getElementById("iEan").value.trim()         || undefined,
            title:      document.getElementById("iTitle").value.trim()       || undefined,
            ek:         parseFloat(document.getElementById("iEk").value)     || undefined,
            qty:        parseInt(document.getElementById("iQty").value)      || 1,
            sell_price: parseFloat(document.getElementById("iVk").value)     || undefined,
            status:     document.getElementById("iStatus").value,
            market:     document.getElementById("iMarket").value,
            ship_out:   parseFloat(document.getElementById("iShipOut").value) || undefined,
            ek_date:    document.getElementById("iEkDate")?.value            || undefined,
            sold_at:    document.getElementById("iSoldAt")?.value            || undefined,
            notes:      document.getElementById("iNotes").value.trim()       || undefined,
          };
          try {
            const saved = await Storage.upsertItem(patch);
            if (id) {
              const idx = _items.findIndex(i => i.id === id);
              if (idx >= 0) _items[idx] = { ..._items[idx], ...saved };
            } else {
              _items.unshift(saved);
            }
            renderAll();
            Toast.success(isNew ? "Artikel hinzugefügt" : "Gespeichert");
            Modal.close(true);
          } catch (e) { Toast.error("Fehler", e.message); }
        }},
      ],
    });
  }

  /* ── Mount / unmount ─────────────────────────────────────────────── */
  async function mount(el, navId) {
    _el = el;
    el.innerHTML = buildShell();

    _items = await Storage.listInventory();
    if (App._navId !== navId) return;

    renderAll();

    el.querySelector("#invSearch").addEventListener("input", e => {
      _filter.q = e.target.value;
      renderAll();
    });
    el.querySelector("#invStatus").addEventListener("change", e => {
      _filter.status = e.target.value;
      renderAll();
    });
    el.querySelector("#invMarket").addEventListener("change", e => {
      _filter.market = e.target.value;
      renderAll();
    });
    el.querySelector("#btnAddItem").addEventListener("click", () => openEditModal(null));
  }

  function unmount() { _el = null; }

  return { mount, unmount };
})();
