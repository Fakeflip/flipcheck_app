/* Flipcheck v2 — Auto-Repricer View */
const RepricerView = (() => {
  let _container  = null;
  let _items      = [];     // repricer_items.json entries
  let _log        = [];     // repricer_log.json entries
  let _selected   = null;   // selected item sku
  let _connected  = false;
  let _status     = null;
  let _settings   = {};
  let _inventory  = [];     // full inventory for "add item" modal
  let _debounce   = null;

  const fmt = (v) => v != null ? `€${parseFloat(v).toFixed(2)}` : "—";
  const fmtDate = (ts) => {
    if (!ts) return "—";
    const d = new Date(typeof ts === "number" ? ts : ts);
    return `${d.getDate()}.${d.getMonth()+1}. ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };
  const fmtAgo = (ts) => {
    if (!ts) return "—";
    const s = Math.floor((Date.now() - new Date(typeof ts === "number" ? ts : ts).getTime()) / 1000);
    if (s < 60)  return `vor ${s}s`;
    if (s < 3600) return `vor ${Math.round(s/60)}m`;
    return `vor ${Math.round(s/3600)}h`;
  };

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  function mount(container) {
    _container = container;
    _selected  = null;
    container.innerHTML = _renderShell();
    _init();
  }

  function unmount() {
    if (_debounce) { clearTimeout(_debounce); _debounce = null; }
    _container = null;
  }

  // ── Shell ──────────────────────────────────────────────────────────────────
  function _renderShell() {
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Auto-Repricer</h1>
          <p>eBay-Preise automatisch an Konkurrenz anpassen</p>
        </div>
        <div class="page-header-right" id="reprHeaderRight">
          <span id="reprConnBadge" class="badge badge-muted" style="font-size:11px">Nicht verbunden</span>
          <button class="btn btn-secondary btn-sm" id="btnReprSettings" title="Einstellungen">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.2 3.2l.7.7M12.1 12.1l.7.7M12.1 3.9l-.7.7M4.6 11.4l-.7.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="btn btn-primary btn-sm" id="btnReprRun">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <polygon points="3,2 13,8 3,14" fill="currentColor"/>
            </svg>
            Jetzt ausführen
          </button>
        </div>
      </div>

      <div class="comp-layout" id="reprLayout">
        <!-- Left panel: item list -->
        <div class="comp-left" id="reprLeft">
          <div class="comp-list-header">
            <span class="text-xs text-muted" id="reprItemCount">0 Artikel</span>
            <button class="btn btn-ghost btn-xs" id="btnReprAdd">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              Artikel hinzufügen
            </button>
          </div>
          <div id="reprItemList" class="comp-seller-list"></div>
        </div>

        <!-- Right panel: detail -->
        <div class="comp-right" id="reprRight">
          <div id="reprDetail" class="comp-detail-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style="opacity:.25;margin-bottom:8px">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <p class="text-sm text-muted">Artikel auswählen</p>
          </div>
        </div>
      </div>
    `;
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function _init() {
    if (!_container) return;
    [_items, _log, _status, _settings] = await Promise.all([
      Storage.repricerList(),
      Storage.repricerLog(),
      Storage.repricerStatus(),
      Storage.getSettings(),
    ]);
    _connected = await Storage.repricerIsConnected();
    _render();
    _wireEvents();
  }

  function _render() {
    if (!_container) return;

    // Connection badge
    const badge = _container.querySelector("#reprConnBadge");
    if (badge) {
      badge.textContent = _connected ? "● Verbunden" : "Nicht verbunden";
      badge.className   = _connected ? "badge badge-success" : "badge badge-muted";
      badge.style.fontSize = "11px";
    }

    // Item count
    const countEl = _container.querySelector("#reprItemCount");
    if (countEl) countEl.textContent = `${_items.length} Artikel`;

    // Item list
    const listEl = _container.querySelector("#reprItemList");
    if (listEl) listEl.innerHTML = _renderItemList();

    // Re-select if applicable
    if (_selected) _renderDetail(_items.find(i => i.sku === _selected));
  }

  function _renderItemList() {
    if (!_items.length) {
      return `<div class="comp-empty-state">
        <p class="text-xs text-muted" style="padding:16px;text-align:center">Noch keine Artikel hinzugefügt.<br>Klicke "+ Artikel hinzufügen" um zu starten.</p>
      </div>`;
    }
    return _items.map(item => {
      const isSelected = _selected === item.sku;
      const statusChip = _renderStatusChip(item);
      return `
        <div class="comp-seller-row ${isSelected ? "active" : ""}" data-sku="${_esc(item.sku)}">
          <div style="flex:1;min-width:0">
            <div class="text-sm font-medium text-primary" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(item.title || item.ean || item.sku)}</div>
            <div class="text-xs text-muted" style="margin-top:2px">${_esc(item.ean || item.sku)}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            ${statusChip}
            ${item.last_price != null ? `<div class="text-xs text-muted" style="margin-top:2px">${fmt(item.last_price)}</div>` : ""}
          </div>
        </div>
      `;
    }).join("");
  }

  function _renderStatusChip(item) {
    const s = item.status;
    if (!s || s === "PENDING") return `<span class="badge badge-muted" style="font-size:10px">—</span>`;
    if (s === "UPDATED") {
      const diff = item.last_price != null && item.old_price != null ? item.last_price - item.old_price : null;
      return `<span class="badge badge-success" style="font-size:10px">↓ ${diff != null ? Math.abs(diff).toFixed(2)+"€" : "OK"}</span>`;
    }
    if (s === "AT_FLOOR") return `<span class="badge badge-warning" style="font-size:10px">🔒 Floor</span>`;
    if (s === "HOLD")     return `<span class="badge badge-muted"    style="font-size:10px">= Halten</span>`;
    if (s === "EBAY_FAILED") return `<span class="badge badge-danger" style="font-size:10px">✗ Fehler</span>`;
    return `<span class="badge badge-muted" style="font-size:10px">${s}</span>`;
  }

  function _renderDetail(item) {
    const el = _container?.querySelector("#reprDetail");
    if (!el) return;
    if (!item) {
      el.innerHTML = `<div class="comp-detail-empty"><p class="text-sm text-muted">Artikel auswählen</p></div>`;
      return;
    }
    const repricer  = _settings?.repricer || {};
    const rule      = item.rule || {};
    const undercut  = rule.undercut_pct   ?? repricer.global_undercut_pct   ?? 2;
    const minMargin = rule.min_margin_pct ?? repricer.global_min_margin_pct ?? 15;
    const itemLog   = _log.filter(e => e.ean === item.ean || e.sku === item.sku).slice(0, 10);

    el.innerHTML = `
      <div style="padding:16px 20px;border-bottom:1px solid var(--border)">
        <div class="text-base font-semibold text-primary" style="margin-bottom:4px">${_esc(item.title || item.ean || item.sku)}</div>
        <div class="text-xs text-muted">EAN: ${_esc(item.ean || "—")} · SKU: ${_esc(item.sku || "—")}</div>
      </div>

      <div style="padding:12px 20px;border-bottom:1px solid var(--border)">
        <div class="row gap-20" style="flex-wrap:wrap">
          <div>
            <div class="text-xs text-muted">Aktueller Preis</div>
            <div class="text-sm font-semibold text-primary">${fmt(item.last_price)}</div>
          </div>
          <div>
            <div class="text-xs text-muted">Konkurrent Min</div>
            <div class="text-sm font-semibold ${item.competitor_min != null ? "text-primary" : "text-muted"}">${fmt(item.competitor_min)}</div>
          </div>
          <div>
            <div class="text-xs text-muted">Floor-Preis</div>
            <div class="text-sm font-semibold text-muted">${fmt(item.floor_price)}</div>
          </div>
          <div>
            <div class="text-xs text-muted">Letzter Run</div>
            <div class="text-sm font-semibold text-secondary">${fmtAgo(item.last_repriced_at)}</div>
          </div>
          <div>
            <div class="text-xs text-muted">Status</div>
            <div>${_renderStatusChip(item)}</div>
          </div>
        </div>
      </div>

      <div style="padding:12px 20px;border-bottom:1px solid var(--border)">
        <div class="text-xs font-semibold text-secondary" style="margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Regel</div>
        <div class="row gap-12 mb-8" style="align-items:center;flex-wrap:wrap">
          <label class="text-xs text-muted">Undercut</label>
          <div style="display:flex;align-items:center;gap:4px">
            <input type="number" class="input-sm" id="ruleUndercut" value="${undercut}" min="0" max="50" step="0.5" style="width:60px">
            <span class="text-xs text-muted">%</span>
          </div>
          <label class="text-xs text-muted" style="margin-left:8px">Min. Marge</label>
          <div style="display:flex;align-items:center;gap:4px">
            <input type="number" class="input-sm" id="ruleMinMargin" value="${minMargin}" min="0" max="200" step="1" style="width:60px">
            <span class="text-xs text-muted">%</span>
          </div>
        </div>
        <div class="row gap-8">
          <button class="btn btn-primary btn-sm" id="btnSaveRule">Speichern</button>
          <button class="btn btn-ghost btn-sm" id="btnRemoveItem" style="color:var(--red)">Entfernen</button>
        </div>
      </div>

      ${itemLog.length ? `
      <div style="padding:12px 20px">
        <div class="text-xs font-semibold text-secondary" style="margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Verlauf</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${itemLog.map(e => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--bg-panel);border-radius:4px;border:1px solid var(--border)">
              <span class="text-xs text-muted">${fmtDate(e.ts)}</span>
              <span class="text-xs text-secondary">${fmt(e.old_price)} → <strong style="color:${e.new_price < e.old_price ? "var(--green)" : "var(--text-primary)"}">${fmt(e.new_price)}</strong></span>
              <span class="text-xs" style="color:${e.new_price < e.old_price ? "var(--green)" : "var(--red)"}">
                ${e.new_price < e.old_price ? "−" : "+"}${Math.abs(e.new_price - e.old_price).toFixed(2)}€
              </span>
              <span class="badge badge-muted" style="font-size:10px">${e.status}</span>
            </div>
          `).join("")}
        </div>
      </div>` : ""}
    `;

    // Wire rule buttons
    el.querySelector("#btnSaveRule")?.addEventListener("click", () => _saveRule(item));
    el.querySelector("#btnRemoveItem")?.addEventListener("click", () => _removeItem(item));
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  function _wireEvents() {
    if (!_container) return;

    // Run now
    _container.querySelector("#btnReprRun")?.addEventListener("click", async () => {
      const btn = _container.querySelector("#btnReprRun");
      if (btn) { btn.disabled = true; btn.textContent = "Läuft…"; }
      try {
        await Storage.repricerRunNow();
        await _refreshData();
        Toast.show("Repricer ausgeführt", "success");
      } catch (e) {
        Toast.show("Fehler beim Ausführen", "error");
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><polygon points="3,2 13,8 3,14" fill="currentColor"/></svg> Jetzt ausführen`; }
      }
    });

    // Settings
    _container.querySelector("#btnReprSettings")?.addEventListener("click", _showSettings);

    // Add item
    _container.querySelector("#btnReprAdd")?.addEventListener("click", _showAddModal);

    // Item list click
    _container.querySelector("#reprItemList")?.addEventListener("click", e => {
      const row = e.target.closest(".comp-seller-row");
      if (!row) return;
      const sku = row.dataset.sku;
      _selected = _selected === sku ? null : sku;
      _render();
      if (_selected) {
        const item = _items.find(i => i.sku === sku);
        _renderDetail(item);
      }
    });

    // Connect eBay button (if not connected)
    if (!_connected) {
      const badge = _container.querySelector("#reprConnBadge");
      if (badge) {
        badge.style.cursor = "pointer";
        badge.title = "Mit eBay verbinden";
        badge.addEventListener("click", _connectEbay);
      }
    }
  }

  async function _refreshData() {
    [_items, _log, _status] = await Promise.all([
      Storage.repricerList(),
      Storage.repricerLog(),
      Storage.repricerStatus(),
    ]);
    _connected = await Storage.repricerIsConnected();
    _render();
    if (_selected) _renderDetail(_items.find(i => i.sku === _selected));
  }

  async function _saveRule(item) {
    const undercut  = parseFloat(_container.querySelector("#ruleUndercut")?.value  || "2");
    const minMargin = parseFloat(_container.querySelector("#ruleMinMargin")?.value || "15");
    await Storage.repricerUpdate(item.sku, { rule: { undercut_pct: undercut, min_margin_pct: minMargin } });
    await _refreshData();
    Toast.show("Regel gespeichert", "success");
  }

  async function _removeItem(item) {
    if (!confirm(`"${item.title || item.ean}" aus Repricer entfernen?`)) return;
    await Storage.repricerRemove(item.sku);
    _selected = null;
    await _refreshData();
    Toast.show("Artikel entfernt", "success");
  }

  async function _connectEbay() {
    const url = await Storage.repricerAuthUrl();
    if (!url) { Toast.show("eBay OAuth nicht konfiguriert", "error"); return; }
    // Open in system browser (shell.openExternal equivalent via window.open)
    window.open(url, "_blank");
    Toast.show("eBay-Login im Browser geöffnet", "info");
  }

  // ── Add Item Modal ─────────────────────────────────────────────────────────
  async function _showAddModal() {
    _inventory = await Storage.listInventory();
    const listed = _inventory.filter(i =>
      ["LISTED", "IN_STOCK", "LISTING_PENDING"].includes(i.status) && i.ean
    );
    const alreadyAdded = new Set(_items.map(i => i.ean));

    const bodyHtml = `
      <div style="margin-bottom:12px">
        <input type="text" id="reprAddSearch" class="input-sm" placeholder="Suche nach Titel oder EAN…" style="width:100%">
      </div>
      <div id="reprAddList" style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
        ${listed.map(inv => `
          <div class="comp-seller-row ${alreadyAdded.has(inv.ean) ? "opacity-50" : ""}" data-inv-id="${inv.id}" data-ean="${_esc(inv.ean)}" data-sku="${_esc(inv.sku || inv.ean)}" data-title="${_esc(inv.title || "")}">
            <div style="flex:1;min-width:0">
              <div class="text-sm text-primary" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(inv.title || inv.ean)}</div>
              <div class="text-xs text-muted">EAN: ${_esc(inv.ean)} · VK: ${fmt(inv.sell_price)}</div>
            </div>
            ${alreadyAdded.has(inv.ean)
              ? `<span class="badge badge-muted" style="font-size:10px">Bereits hinzugefügt</span>`
              : `<button class="btn btn-primary btn-xs btn-repr-add-item">Hinzufügen</button>`
            }
          </div>
        `).join("") || `<p class="text-sm text-muted" style="padding:12px;text-align:center">Keine LISTED-Artikel mit EAN gefunden</p>`}
      </div>
    `;

    Modal.open({
      title: "Artikel zum Repricer hinzufügen",
      body:  bodyHtml,
      actions: [{ label: "Schließen", type: "secondary", onClick: () => Modal.close() }],
    });

    // Search filter
    document.getElementById("reprAddSearch")?.addEventListener("input", e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll("#reprAddList .comp-seller-row").forEach(row => {
        const text = (row.dataset.title + row.dataset.ean).toLowerCase();
        row.style.display = text.includes(q) ? "" : "none";
      });
    });

    // Add buttons
    document.querySelectorAll(".btn-repr-add-item").forEach(btn => {
      btn.addEventListener("click", async () => {
        const row   = btn.closest(".comp-seller-row");
        const ean   = row.dataset.ean;
        const sku   = row.dataset.sku;
        const title = row.dataset.title;
        const inv   = _inventory.find(i => i.id === row.dataset.invId);
        await Storage.repricerAdd({
          sku,
          ean,
          title:   title || ean,
          rule:    null,  // use global defaults
          enabled: true,
        });
        btn.textContent = "✓ Hinzugefügt";
        btn.disabled    = true;
        btn.className   = "btn btn-ghost btn-xs";
        Toast.show(`"${title || ean}" hinzugefügt`, "success");
        await _refreshData();
      });
    });
  }

  // ── Settings Modal ─────────────────────────────────────────────────────────
  function _showSettings() {
    const repricer = _settings?.repricer || {};
    const bodyHtml = `
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <label class="text-xs text-muted" style="display:block;margin-bottom:4px">Ausführungs-Intervall (Minuten, min. 10)</label>
          <input type="number" id="reprIntervalMin" class="input-sm" value="${repricer.interval_min || 30}" min="10" max="1440" style="width:100px">
        </div>
        <div>
          <label class="text-xs text-muted" style="display:block;margin-bottom:4px">Globaler Undercut (%)</label>
          <input type="number" id="reprGlobalUndercut" class="input-sm" value="${repricer.global_undercut_pct ?? 2}" min="0" max="50" step="0.5" style="width:100px">
        </div>
        <div>
          <label class="text-xs text-muted" style="display:block;margin-bottom:4px">Globale Mindest-Marge (%)</label>
          <input type="number" id="reprGlobalMargin" class="input-sm" value="${repricer.global_min_margin_pct ?? 15}" min="0" max="200" step="1" style="width:100px">
        </div>
        <div>
          <label class="text-xs text-muted" style="display:block;margin-bottom:4px">Discord Webhook bei Preisänderung</label>
          <input type="checkbox" id="reprWebhookRepriced" ${repricer.webhook_repriced !== false ? "checked" : ""}>
          <label class="text-xs" for="reprWebhookRepriced"> Benachrichtigung bei Preisanpassung</label>
        </div>
        <div>
          <label class="text-xs text-muted" style="display:block;margin-bottom:4px"></label>
          <input type="checkbox" id="reprWebhookFloor" ${repricer.webhook_floor !== false ? "checked" : ""}>
          <label class="text-xs" for="reprWebhookFloor"> Benachrichtigung bei Mindestpreis-Erreichen</label>
        </div>
        ${!_connected ? `
        <div style="padding:10px;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px">
          <p class="text-xs text-muted" style="margin-bottom:8px">eBay-Verkäufer-Konto noch nicht verbunden</p>
          <button class="btn btn-primary btn-sm" id="btnConnectEbaySettings">Mit eBay verbinden →</button>
        </div>` : `
        <div style="padding:10px;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px">
          <p class="text-xs" style="color:var(--green)">● eBay-Konto verbunden</p>
        </div>`}
      </div>
    `;

    Modal.open({
      title: "Repricer-Einstellungen",
      body:  bodyHtml,
      actions: [
        { label: "Abbrechen", type: "secondary", onClick: () => Modal.close() },
        { label: "Speichern", type: "primary", onClick: async () => {
          const s = await Storage.getSettings();
          const newRepricer = {
            ...(s.repricer || {}),
            interval_min:          parseInt(document.getElementById("reprIntervalMin")?.value || "30"),
            global_undercut_pct:   parseFloat(document.getElementById("reprGlobalUndercut")?.value || "2"),
            global_min_margin_pct: parseFloat(document.getElementById("reprGlobalMargin")?.value || "15"),
            webhook_repriced:      document.getElementById("reprWebhookRepriced")?.checked ?? true,
            webhook_floor:         document.getElementById("reprWebhookFloor")?.checked ?? true,
          };
          await Storage.saveSettings({ ...s, repricer: newRepricer });
          await Storage.repricerSetInterval(newRepricer.interval_min);
          _settings = { ...s, repricer: newRepricer };
          Modal.close();
          Toast.show("Einstellungen gespeichert", "success");
        }},
      ],
    });

    document.getElementById("btnConnectEbaySettings")?.addEventListener("click", () => {
      Modal.close();
      _connectEbay();
    });
  }

  // ── Utils ──────────────────────────────────────────────────────────────────
  function _esc(s) {
    if (s == null) return "";
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  return { mount, unmount };
})();
