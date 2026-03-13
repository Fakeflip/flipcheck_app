/* Flipcheck v2 — Auto-Repricer View */
const RepricerView = (() => {
  let _container  = null;
  let _items      = [];
  let _log        = [];
  let _selected   = null;
  let _connected  = false;
  let _status     = null;
  let _settings   = {};
  let _inventory  = [];
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

  const STRATEGY_LABELS = {
    cheapest:  "Günstigster (Rang 1)",
    rank_2:    "2. Günstigster (Rang 2)",
    rank_3:    "3. Günstigster (Rang 3)",
    avg_top3:  "Ø Durchschnitt Top 3",
    avg_top5:  "Ø Durchschnitt Top 5",
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
          <button class="btn btn-ghost btn-sm" id="btnReprDisconnect" title="eBay-Konto trennen" style="display:none;color:var(--text-muted);font-size:11px">Trennen</button>
          <button class="btn btn-secondary btn-sm" id="btnReprSync" title="eBay-Listings synchronisieren">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Listings sync
          </button>
          <button class="btn btn-secondary btn-sm" id="btnReprSettings" title="Einstellungen">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.2 3.2l.7.7M12.1 12.1l.7.7M12.1 3.9l-.7.7M4.6 11.4l-.7.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            Einstellungen
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
        <div class="comp-left" id="reprLeft">
          <div class="comp-list-header">
            <span class="text-xs text-muted" id="reprItemCount">0 Artikel</span>
            <button class="btn btn-ghost btn-xs" id="btnReprAdd">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              Hinzufügen
            </button>
          </div>
          <div id="reprItemList" class="comp-seller-list"></div>
        </div>

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
    [_items, _log, _status, _settings, _inventory] = await Promise.all([
      Storage.repricerList(),
      Storage.repricerLog(),
      Storage.repricerStatus(),
      Storage.getSettings(),
      Storage.listInventory().then(r => r.items || []).catch(() => []),
    ]);
    _connected = await Storage.repricerIsConnected();
    _render();
    _wireEvents();
  }

  function _render() {
    if (!_container) return;

    const badge = _container.querySelector("#reprConnBadge");
    if (badge) {
      badge.textContent = _connected ? "● Verbunden" : "Nicht verbunden";
      badge.className   = _connected ? "badge badge-success" : "badge badge-muted";
      badge.style.fontSize = "11px";
    }
    const disconnBtn = _container.querySelector("#btnReprDisconnect");
    if (disconnBtn) disconnBtn.style.display = _connected ? "" : "none";

    const countEl = _container.querySelector("#reprItemCount");
    if (countEl) countEl.textContent = `${_items.length} Artikel`;

    const listEl = _container.querySelector("#reprItemList");
    if (listEl) listEl.innerHTML = _renderItemList();

    if (_selected) _renderDetail(_items.find(i => i.sku === _selected));
  }

  function _renderItemList() {
    if (!_items.length) {
      return `<div class="comp-empty-state">
        <p class="text-xs text-muted" style="padding:16px;text-align:center">Noch keine Artikel.<br>Klicke "Hinzufügen" oder sync deine eBay-Listings.</p>
      </div>`;
    }
    return _items.map(item => {
      const isSelected = _selected === item.sku;
      const statusChip = _renderStatusChip(item);
      const pausedDot  = item.enabled === false
        ? `<span style="color:var(--text-muted);font-size:10px" title="Deaktiviert">⏸ </span>`
        : "";
      return `
        <div class="comp-seller-row ${isSelected ? "active" : ""}" data-sku="${_esc(item.sku)}">
          <div style="flex:1;min-width:0">
            <div class="text-sm font-medium text-primary" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${pausedDot}${_esc(item.title || item.ean || item.sku)}</div>
            <div class="text-xs text-muted" style="margin-top:2px">${_esc(item.ean || item.sku)}${item.quantity != null ? ` · ${item.quantity}x` : ""}</div>
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
    if (s === "RAISED") {
      const diff = item.last_price != null && item.old_price != null ? item.last_price - item.old_price : null;
      return `<span class="badge" style="font-size:10px;background:rgba(99,102,241,.18);color:#818cf8">↑ ${diff != null ? Math.abs(diff).toFixed(2)+"€" : "OK"}</span>`;
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
    const repricer           = _settings?.repricer || {};
    const rule               = item.rule || {};
    const minMargin          = rule.min_margin_pct           ?? repricer.global_min_margin_pct           ?? 15;
    const strategy           = rule.price_strategy           ?? repricer.global_price_strategy           ?? "cheapest";
    const raiseWhenCheapest  = rule.raise_when_cheapest      ?? repricer.global_raise_when_cheapest      ?? true;
    const commercialOnly     = rule.commercial_only          ?? repricer.global_commercial_only          ?? false;
    const commercialMinFb    = rule.commercial_min_feedback  ?? repricer.global_commercial_min_feedback  ?? 10;
    const isEnabled          = item.enabled !== false;
    const itemLog            = _log.filter(e => e.ean === item.ean || e.sku === item.sku).slice(0, 10);
    // Look up EK+ship_out from inventory for live floor calculation
    const invMatch = _inventory.find(i => (item.ean && i.ean === item.ean) || (item.sku && i.sku === item.sku));
    const itemEk   = invMatch?.ek   ?? null;
    const itemShip = invMatch?.ship_out ?? 0;

    const strategyOpts = Object.entries(STRATEGY_LABELS).map(([v, l]) =>
      `<option value="${v}" ${strategy === v ? "selected" : ""}>${l}</option>`
    ).join("");

    const noEanWarning = !item.ean ? `
      <div style="padding:8px 20px;background:rgba(245,158,11,.08);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <span style="font-size:13px">⚠️</span>
        <span class="text-xs" style="color:#f59e0b">Keine EAN — Konkurrenzsuche nicht möglich. EAN im Inventar ergänzen.</span>
      </div>` : "";
    const ebayFailedBanner = item.status === "EBAY_FAILED" && item.ebay_error ? `
      <div style="padding:8px 20px;background:rgba(239,68,68,.08);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <span style="font-size:13px">❌</span>
        <span class="text-xs" style="color:#f87171">eBay-Fehler: ${_esc(String(item.ebay_error).slice(0, 120))}</span>
      </div>` : "";

    el.innerHTML = `
      <div style="padding:16px 20px;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div class="text-base font-semibold text-primary">${_esc(item.title || item.ean || item.sku)}</div>
          <label class="toggle-switch" title="${isEnabled ? "Aktiv" : "Pausiert"}">
            <input type="checkbox" id="reprToggleEnabled" ${isEnabled ? "checked" : ""}>
            <span class="toggle-track"></span>
          </label>
        </div>
        <div class="text-xs text-muted">
          EAN: ${_esc(item.ean || "—")} · SKU: ${_esc(item.sku || "—")}
          ${item.quantity != null ? ` · <strong style="color:var(--text-primary)">${item.quantity}x</strong> auf Lager` : ""}
          ${item.ebay_item_id ? ` · <a href="https://www.ebay.de/itm/${_esc(item.ebay_item_id)}" target="_blank" style="color:var(--indigo)">eBay #${_esc(item.ebay_item_id)}</a>` : ""}
        </div>
      </div>
      ${noEanWarning}
      ${ebayFailedBanner}

      <!-- Stats row -->
      <div style="padding:12px 20px;border-bottom:1px solid var(--border)">
        <div class="row gap-20" style="flex-wrap:wrap">
          <div>
            <div class="text-xs text-muted">Aktueller Preis</div>
            <div class="text-sm font-semibold text-primary">${fmt(item.last_price)}</div>
          </div>
          <div>
            <div class="text-xs text-muted">Günstigster</div>
            <div class="text-sm font-semibold ${item.competitor_min != null ? "text-primary" : "text-muted"}">${fmt(item.competitor_min)}</div>
          </div>
          <div>
            <div class="text-xs text-muted">2. Günstigster</div>
            <div class="text-sm font-semibold text-muted">${fmt(item.competitor_2nd)}</div>
          </div>
          <div>
            <div class="text-xs text-muted">Konkurrenten</div>
            <div class="text-sm font-semibold text-muted">${item.candidate_count ?? "—"}</div>
          </div>
          <div>
            <div class="text-xs text-muted">Floor</div>
            <div class="text-sm font-semibold text-muted">${fmt(item.floor_price)}</div>
          </div>
          <div>
            <div class="text-xs text-muted">Letzter Run</div>
            <div class="text-sm text-secondary">${fmtAgo(item.last_repriced_at)}</div>
          </div>
          <div>
            <div class="text-xs text-muted">Status</div>
            <div>${_renderStatusChip(item)}</div>
          </div>
        </div>
      </div>

      <!-- Rule editor -->
      <div style="padding:12px 20px;border-bottom:1px solid var(--border)">
        <div class="text-xs font-semibold text-secondary" style="margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">Regel (artikel-spezifisch)</div>
        <div style="display:flex;flex-direction:column;gap:10px">

          <div class="row gap-12" style="align-items:center;flex-wrap:wrap">
            <label class="text-xs text-muted" style="min-width:110px">Preis-Strategie</label>
            <select id="ruleStrategy" class="input-sm" style="min-width:200px">${strategyOpts}</select>
          </div>

          <div id="ruleRaiseRow" class="row gap-12" style="align-items:center;flex-wrap:wrap;${strategy !== "cheapest" ? "opacity:.4;pointer-events:none" : ""}">
            <label class="text-xs text-muted" style="min-width:110px">Wenn günstigster</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" id="ruleRaiseWhenCheapest" ${raiseWhenCheapest ? "checked" : ""}>
              <span class="text-xs">Auf 2. Günstigsten anheben</span>
            </label>
          </div>

          <div class="row gap-12" style="align-items:center;flex-wrap:wrap">
            <label class="text-xs text-muted" style="min-width:110px">Nur Gewerbliche</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" id="ruleCommercialOnly" ${commercialOnly ? "checked" : ""}>
              <span class="text-xs">Private Verkäufer ignorieren</span>
            </label>
            <div id="ruleCommFbRow" style="${commercialOnly ? "" : "opacity:.4;pointer-events:none"}display:flex;align-items:center;gap:4px">
              <span class="text-xs text-muted">min. Feedback</span>
              <input type="number" id="ruleCommFb" class="input-sm" value="${commercialMinFb}" min="1" max="9999" style="width:64px">
            </div>
          </div>

          <div class="row gap-12" style="align-items:center;flex-wrap:wrap">
            <label class="text-xs text-muted" style="min-width:110px">Mindest-Marge</label>
            <div style="display:flex;align-items:center;gap:4px">
              <input type="number" id="ruleMinMargin" class="input-sm" value="${minMargin}" min="0" max="200" step="1" style="width:64px"
                data-ek="${itemEk ?? ""}" data-ship="${itemShip}">
              <span class="text-xs text-muted">% → Floor: <span id="floorDisplay">${item.floor_price != null ? fmt(item.floor_price) : "—"}</span></span>
            </div>
          </div>
        </div>

        <div class="row gap-8" style="margin-top:12px">
          <button class="btn btn-primary btn-sm" id="btnSaveRule">Speichern</button>
          <button class="btn btn-ghost btn-sm" id="btnRemoveItem" style="color:var(--red)">Entfernen</button>
        </div>
      </div>

      <!-- History -->
      ${itemLog.length ? `
      <div style="padding:12px 20px">
        <div class="text-xs font-semibold text-secondary" style="margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Verlauf</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${itemLog.map(e => {
            const raised  = e.status === "RAISED";
            const lowered = (e.new_price || 0) < (e.old_price || 0);
            const arrow = raised ? "↑" : (lowered ? "↓" : "→");
            const color = raised ? "#818cf8" : (lowered ? "var(--green)" : "var(--text-secondary)");
            const stratLabel = e.price_strategy ? `<span class="badge badge-muted" style="font-size:9px">${STRATEGY_LABELS[e.price_strategy] || e.price_strategy}</span>` : "";
            return `
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:4px 8px;background:var(--bg-panel);border-radius:4px;border:1px solid var(--border)">
                <span class="text-xs text-muted" style="flex-shrink:0">${fmtDate(e.ts)}</span>
                <span class="text-xs text-secondary">${fmt(e.old_price)} ${arrow} <strong style="color:${color}">${fmt(e.new_price)}</strong></span>
                <span class="text-xs" style="color:${color};flex-shrink:0">
                  ${raised ? "+" : (lowered ? "−" : "")}${Math.abs((e.new_price||0)-(e.old_price||0)).toFixed(2)}€
                </span>
                ${stratLabel}
                <span class="badge badge-muted" style="font-size:9px">${e.status}</span>
              </div>
            `;
          }).join("")}
        </div>
      </div>` : ""}
    `;

    // Wire rule section dynamics
    const stratSel  = el.querySelector("#ruleStrategy");
    const raiseRow  = el.querySelector("#ruleRaiseRow");
    const commCheck = el.querySelector("#ruleCommercialOnly");
    const commFbRow = el.querySelector("#ruleCommFbRow");

    stratSel?.addEventListener("change", () => {
      const isCheapest = stratSel.value === "cheapest";
      if (raiseRow) { raiseRow.style.opacity = isCheapest ? "1" : ".4"; raiseRow.style.pointerEvents = isCheapest ? "" : "none"; }
    });
    commCheck?.addEventListener("change", () => {
      if (commFbRow) { commFbRow.style.opacity = commCheck.checked ? "1" : ".4"; commFbRow.style.pointerEvents = commCheck.checked ? "" : "none"; }
    });

    // Live floor price recalculation
    const marginInput  = el.querySelector("#ruleMinMargin");
    const floorDisplay = el.querySelector("#floorDisplay");
    if (marginInput && floorDisplay) {
      marginInput.addEventListener("input", () => {
        const ek   = parseFloat(marginInput.dataset.ek);
        const ship = parseFloat(marginInput.dataset.ship || "0");
        const pct  = parseFloat(marginInput.value);
        if (!isNaN(ek) && !isNaN(pct)) {
          const EBAY_FEE = 0.13;
          const floor = (ek * (1 + pct / 100) + ship) / (1 - EBAY_FEE);
          floorDisplay.textContent = `€${floor.toFixed(2)}`;
        }
      });
    }

    el.querySelector("#btnSaveRule")?.addEventListener("click", () => _saveRule(item));
    el.querySelector("#btnRemoveItem")?.addEventListener("click", () => _removeItem(item));
    el.querySelector("#reprToggleEnabled")?.addEventListener("change", async (e) => {
      await Storage.repricerUpdate(item.sku, { enabled: e.target.checked });
      await _refreshData();
      Toast.success(e.target.checked ? "Aktiviert" : "Pausiert");
    });
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  function _wireEvents() {
    if (!_container) return;

    _container.querySelector("#btnReprRun")?.addEventListener("click", async () => {
      const btn = _container.querySelector("#btnReprRun");
      if (btn) { btn.disabled = true; btn.textContent = "Läuft…"; }
      try {
        await Storage.repricerRunNow();
        await _refreshData();
        Toast.success("Repricer ausgeführt");
      } catch {
        Toast.error("Fehler beim Ausführen");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><polygon points="3,2 13,8 3,14" fill="currentColor"/></svg> Jetzt ausführen`;
        }
      }
    });

    _container.querySelector("#btnReprSettings")?.addEventListener("click", _showSettings);
    _container.querySelector("#btnReprAdd")?.addEventListener("click", _showAddModal);
    _container.querySelector("#btnReprSync")?.addEventListener("click", _syncListings);

    _container.querySelector("#btnReprDisconnect")?.addEventListener("click", async () => {
      const ok = confirm("eBay-Verbindung trennen? Der gespeicherte Token wird gelöscht. Du musst dich erneut verbinden, um den Repricer zu nutzen.");
      if (!ok) return;
      const btn = _container.querySelector("#btnReprDisconnect");
      if (btn) { btn.disabled = true; btn.textContent = "…"; }
      try {
        await Storage.repricerDisconnect();
        _connected = false;
        _render();
        Toast.success("Getrennt", "eBay-Verbindung wurde entfernt");
      } catch {
        Toast.error("Fehler", "Trennen fehlgeschlagen");
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Trennen"; }
      }
    });

    _container.querySelector("#reprItemList")?.addEventListener("click", e => {
      const row = e.target.closest(".comp-seller-row");
      if (!row) return;
      const sku = row.dataset.sku;
      _selected = _selected === sku ? null : sku;
      _render();
      if (_selected) _renderDetail(_items.find(i => i.sku === sku));
    });

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
    [_items, _log, _status, _inventory] = await Promise.all([
      Storage.repricerList(),
      Storage.repricerLog(),
      Storage.repricerStatus(),
      Storage.listInventory().then(r => r.items || []).catch(() => []),
    ]);
    _connected = await Storage.repricerIsConnected();
    _render();
    if (_selected) _renderDetail(_items.find(i => i.sku === _selected));
  }

  async function _saveRule(item) {
    const el = _container?.querySelector("#reprDetail");
    if (!el) return;
    const strategy       = el.querySelector("#ruleStrategy")?.value           || "cheapest";
    const raise          = el.querySelector("#ruleRaiseWhenCheapest")?.checked ?? true;
    const commOnly       = el.querySelector("#ruleCommercialOnly")?.checked    ?? false;
    const commFb         = parseInt(el.querySelector("#ruleCommFb")?.value     || "10");
    const minMargin      = parseFloat(el.querySelector("#ruleMinMargin")?.value || "15");
    await Storage.repricerUpdate(item.sku, {
      rule: {
        price_strategy:          strategy,
        raise_when_cheapest:     raise,
        commercial_only:         commOnly,
        commercial_min_feedback: commFb,
        min_margin_pct:          minMargin,
      }
    });
    await _refreshData();
    Toast.success("Regel gespeichert");
  }

  async function _removeItem(item) {
    if (!confirm(`"${item.title || item.ean}" aus Repricer entfernen?`)) return;
    await Storage.repricerRemove(item.sku);
    _selected = null;
    await _refreshData();
    Toast.success("Artikel entfernt");
  }

  async function _connectEbay() {
    const url = await Storage.repricerAuthUrl();
    if (!url) { Toast.error("eBay OAuth nicht konfiguriert"); return; }
    window.open(url, "_blank");
    Toast.info("eBay-Login im Browser geöffnet");
  }

  // ── Sync eBay listings ─────────────────────────────────────────────────────
  async function _syncListings() {
    if (!_connected) {
      Toast.warning("Zuerst mit eBay verbinden");
      _connectEbay();
      return;
    }
    const btn = _container?.querySelector("#btnReprSync");
    if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
    try {
      const result = await Storage.repricerSyncListings();
      await _refreshData();
      const added   = result?.added   ?? 0;
      const updated = result?.updated ?? 0;
      const total   = result?.total   ?? 0;
      Toast.success(`Sync: ${total} Listings · ${added} neu · ${updated} aktualisiert`);
    } catch (e) {
      Toast.error("Sync fehlgeschlagen");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Listings sync`;
      }
    }
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
      <div id="reprAddList" style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
        ${listed.map(inv => {
          const added = alreadyAdded.has(inv.ean);
          return `
            <div class="comp-seller-row${added ? " opacity-50" : ""}"
                 data-inv-id="${inv.id}" data-ean="${_esc(inv.ean)}"
                 data-sku="${_esc(inv.sku || inv.ean)}" data-title="${_esc(inv.title || "")}">
              <div style="flex:1;min-width:0">
                <div class="text-sm text-primary" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(inv.title || inv.ean)}</div>
                <div class="text-xs text-muted">EAN: ${_esc(inv.ean)} · VK: ${fmt(inv.sell_price)}</div>
              </div>
              ${added
                ? `<span class="badge badge-muted" style="font-size:10px">Bereits hinzugefügt</span>`
                : `<div style="display:flex;align-items:center;gap:6px">
                     <input type="text" class="input-sm repr-ebay-id" placeholder="eBay-ID (opt.)" style="width:120px;font-size:11px" title="eBay ItemID aus ebay.de/itm/XXXXXXXXX">
                     <button class="btn btn-primary btn-xs btn-repr-add-item">Hinzufügen</button>
                   </div>`
              }
            </div>
          `;
        }).join("") || `<p class="text-sm text-muted" style="padding:12px;text-align:center">Keine LISTED-Artikel mit EAN gefunden.<br><small>Tipp: "Listings sync" zieht alle eBay-Artikel automatisch rein.</small></p>`}
      </div>
      <div style="margin-top:10px;padding:8px 10px;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px">
        <p class="text-xs text-muted">
          💡 <strong>eBay-ID</strong> optional — wird für automatische Preisaktualisierungen gebraucht.
          Zu finden in: <em>ebay.de/itm/<strong>123456789</strong></em> — oder nutze "Listings sync" für automatisches Matching.
        </p>
      </div>
    `;

    Modal.open({
      title: "Artikel zum Repricer hinzufügen",
      body:  bodyHtml,
      actions: [{ label: "Schließen", type: "secondary", onClick: () => Modal.close() }],
    });

    document.getElementById("reprAddSearch")?.addEventListener("input", e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll("#reprAddList .comp-seller-row").forEach(row => {
        const text = (row.dataset.title + row.dataset.ean).toLowerCase();
        row.style.display = text.includes(q) ? "" : "none";
      });
    });

    document.querySelectorAll(".btn-repr-add-item").forEach(btn => {
      btn.addEventListener("click", async () => {
        const row        = btn.closest(".comp-seller-row");
        const ean        = row.dataset.ean;
        const sku        = row.dataset.sku;
        const title      = row.dataset.title;
        const ebayItemId = row.querySelector(".repr-ebay-id")?.value?.trim() || null;
        await Storage.repricerAdd({ sku, ean, title: title || ean, ebay_item_id: ebayItemId, rule: null, enabled: true });
        btn.closest("div[style]").innerHTML = `<span class="badge badge-success" style="font-size:10px">✓ Hinzugefügt</span>`;
        Toast.success(`"${title || ean}" hinzugefügt`);
        await _refreshData();
      });
    });
  }

  // ── Settings Modal ─────────────────────────────────────────────────────────
  function _showSettings() {
    const repricer = _settings?.repricer || {};
    const strategyOpts = Object.entries(STRATEGY_LABELS).map(([v, l]) =>
      `<option value="${v}" ${(repricer.global_price_strategy || "cheapest") === v ? "selected" : ""}>${l}</option>`
    ).join("");
    const commOnly = repricer.global_commercial_only ?? false;

    const bodyHtml = `
      <div style="display:flex;flex-direction:column;gap:16px">

        <div>
          <label class="text-xs font-semibold text-secondary" style="display:block;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Ausführung</label>
          <div class="row gap-8" style="align-items:center">
            <label class="text-xs text-muted">Intervall</label>
            <input type="number" id="reprIntervalMin" class="input-sm" value="${repricer.interval_min || 30}" min="10" max="1440" style="width:80px">
            <span class="text-xs text-muted">Minuten (min. 10)</span>
          </div>
        </div>

        <hr style="border:none;border-top:1px solid var(--border)">

        <div>
          <label class="text-xs font-semibold text-secondary" style="display:block;margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">Repricing-Strategie (Global)</label>
          <div style="display:flex;flex-direction:column;gap:12px">

            <div class="row gap-12" style="align-items:center">
              <label class="text-xs text-muted" style="min-width:110px">Preis-Strategie</label>
              <select id="reprGlobalStrategy" class="input-sm" style="min-width:200px">${strategyOpts}</select>
            </div>

            <div id="settRaiseRow" style="padding:10px;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px">
              <div class="text-xs font-semibold text-secondary" style="margin-bottom:6px">Wenn du der günstigste bist (nur bei Rang 1):</div>
              <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
                <input type="checkbox" id="reprGlobalRaiseWhenCheapest" ${repricer.global_raise_when_cheapest !== false ? "checked" : ""} style="margin-top:2px">
                <div>
                  <div class="text-xs">Preis auf 2. Günstigsten anheben</div>
                  <div class="text-xs text-muted" style="margin-top:2px">Verhindert, dass du den Marktpreis nach unten ziehst.</div>
                </div>
              </label>
            </div>

            <div class="row gap-12" style="align-items:center">
              <label class="text-xs text-muted" style="min-width:110px">Mindest-Marge</label>
              <div style="display:flex;align-items:center;gap:4px">
                <input type="number" id="reprGlobalMargin" class="input-sm" value="${repricer.global_min_margin_pct ?? 15}" min="0" max="200" step="1" style="width:64px">
                <span class="text-xs text-muted">%  (Floor = (EK × (1 + Marge%) + Versand) ÷ 0,87)</span>
              </div>
            </div>

          </div>
        </div>

        <hr style="border:none;border-top:1px solid var(--border)">

        <div>
          <label class="text-xs font-semibold text-secondary" style="display:block;margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">Gewerblich-Filter (Global)</label>
          <div style="display:flex;flex-direction:column;gap:8px">
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
              <input type="checkbox" id="reprGlobalCommOnly" ${commOnly ? "checked" : ""} style="margin-top:2px">
              <div>
                <div class="text-xs">Nur gewerbliche Verkäufer berücksichtigen</div>
                <div class="text-xs text-muted" style="margin-top:2px">Filtert Privatverkäufer mit wenig Feedback heraus.</div>
              </div>
            </label>
            <div id="settCommFbRow" style="${commOnly ? "" : "opacity:.4;pointer-events:none"}display:flex;align-items:center;gap:8px;padding-left:24px">
              <label class="text-xs text-muted">Min. Feedback-Punkte</label>
              <input type="number" id="reprGlobalCommFb" class="input-sm" value="${repricer.global_commercial_min_feedback ?? 10}" min="1" max="9999" style="width:72px">
              <span class="text-xs text-muted">(Verkäufer darunter werden ignoriert)</span>
            </div>
          </div>
        </div>

        <hr style="border:none;border-top:1px solid var(--border)">

        <div>
          <label class="text-xs font-semibold text-secondary" style="display:block;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Discord-Benachrichtigungen</label>
          <div style="display:flex;flex-direction:column;gap:8px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="reprWebhookRepriced" ${repricer.webhook_repriced !== false ? "checked" : ""}>
              <span class="text-xs">Bei Preisanpassung (gesenkt oder angehoben)</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="reprWebhookFloor" ${repricer.webhook_floor !== false ? "checked" : ""}>
              <span class="text-xs">Wenn Mindestpreis erreicht (🔒 Floor)</span>
            </label>
          </div>
        </div>

        <hr style="border:none;border-top:1px solid var(--border)">

        ${!_connected ? `
        <div style="padding:12px;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px">
          <p class="text-xs text-muted" style="margin-bottom:8px">eBay-Konto nicht verbunden — Preisaktualisierungen + Listing-Sync nicht möglich.</p>
          <button class="btn btn-primary btn-sm" id="btnConnectEbaySettings">Mit eBay verbinden →</button>
        </div>` : `
        <div style="padding:12px;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px">
          <p class="text-xs" style="color:var(--green)">● eBay-Konto verbunden — Preisaktualisierungen + Listing-Sync aktiv</p>
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
            interval_min:                    parseInt(document.getElementById("reprIntervalMin")?.value      || "30"),
            global_price_strategy:           document.getElementById("reprGlobalStrategy")?.value            || "cheapest",
            global_raise_when_cheapest:      document.getElementById("reprGlobalRaiseWhenCheapest")?.checked ?? true,
            global_min_margin_pct:           parseFloat(document.getElementById("reprGlobalMargin")?.value   || "15"),
            global_commercial_only:          document.getElementById("reprGlobalCommOnly")?.checked           ?? false,
            global_commercial_min_feedback:  parseInt(document.getElementById("reprGlobalCommFb")?.value      || "10"),
            webhook_repriced:                document.getElementById("reprWebhookRepriced")?.checked           ?? true,
            webhook_floor:                   document.getElementById("reprWebhookFloor")?.checked              ?? true,
          };
          await Storage.saveSettings({ ...s, repricer: newRepricer });
          await Storage.repricerSetInterval(newRepricer.interval_min);
          _settings = { ...s, repricer: newRepricer };
          Modal.close();
          Toast.success("Einstellungen gespeichert");
        }},
      ],
    });

    // Settings modal dynamics
    const globalStratEl = document.getElementById("reprGlobalStrategy");
    const raiseRowEl    = document.getElementById("settRaiseRow");
    const commOnlyEl    = document.getElementById("reprGlobalCommOnly");
    const commFbRowEl   = document.getElementById("settCommFbRow");

    globalStratEl?.addEventListener("change", () => {
      const dim = globalStratEl.value !== "cheapest";
      if (raiseRowEl) { raiseRowEl.style.opacity = dim ? ".4" : "1"; raiseRowEl.style.pointerEvents = dim ? "none" : ""; }
    });
    commOnlyEl?.addEventListener("change", () => {
      if (commFbRowEl) { commFbRowEl.style.opacity = commOnlyEl.checked ? "1" : ".4"; commFbRowEl.style.pointerEvents = commOnlyEl.checked ? "" : "none"; }
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
