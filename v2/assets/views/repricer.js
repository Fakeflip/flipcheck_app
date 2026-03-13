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
    cheapest:   "Günstigster (Rang 1)",
    rank_2:     "2. Günstigster (Rang 2)",
    rank_3:     "3. Günstigster (Rang 3)",
    avg_top3:   "Ø Durchschnitt Top 3",
    avg_top5:   "Ø Durchschnitt Top 5",
    avg_30d:    "Ø 30-Tage-Ø (verkauft)",
    median_30d: "Median 30 Tage (verkauft)",
  };

  const STATUS_COLORS = {
    UPDATED:     "#22c55e",
    RAISED:      "#818cf8",
    AT_FLOOR:    "#f59e0b",
    HOLD:        "var(--text-muted)",
    EBAY_FAILED: "#ef4444",
    NO_EBAY_ID:  "#f59e0b",
  };

  const EBAY_CATEGORIES = {
    sonstiges:         { label: "Sonstiges / Standard",    fee: 0.13  },
    handy_zubehoer:    { label: "Handy-Zubehör",           fee: 0.11  },
    kabel:             { label: "Kabel & Adapter",         fee: 0.11  },
    audio_zubehoer:    { label: "Audio-Zubehör",           fee: 0.11  },
    pc_zubehoer:       { label: "PC-Zubehör",              fee: 0.11  },
    tv_zubehoer:       { label: "TV-Zubehör",              fee: 0.11  },
    tastaturen_maeuse: { label: "Tastaturen & Mäuse",      fee: 0.11  },
    drucker_zubehoer:  { label: "Drucker-Zubehör",         fee: 0.11  },
    batterien:         { label: "Batterien",               fee: 0.11  },
    kameras_zubehoer:  { label: "Kamera-Zubehör",          fee: 0.11  },
    notebook_zubehoer: { label: "Notebook-Zubehör",        fee: 0.11  },
    objektive:         { label: "Objektive",               fee: 0.11  },
    stative:           { label: "Stative",                 fee: 0.11  },
    tablet_zubehoer:   { label: "Tablet-Zubehör",          fee: 0.11  },
    sport_freizeit:    { label: "Sport & Freizeit",        fee: 0.115 },
    spielzeug:         { label: "Spielzeug",               fee: 0.115 },
    haushalt_garten:   { label: "Haushalt & Garten",       fee: 0.115 },
  };

  function _calcFloor(ek, ship, marginPct, categoryId) {
    const feeRate = EBAY_CATEGORIES[categoryId || "sonstiges"]?.fee ?? 0.13;
    return Math.round(((ek * (1 + marginPct / 100) + ship) / (1 - feeRate)) * 100) / 100;
  }

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
    const connStatus = await Storage.repricerIsConnected();
    _connected = typeof connStatus === "object" ? connStatus.connected : !!connStatus;
    if (typeof connStatus === "object" && _status) _status.is_legacy = connStatus.is_legacy;
    _render();
    _wireEvents();
  }

  function _render() {
    if (!_container) return;

    const badge = _container.querySelector("#reprConnBadge");
    if (badge) {
      const isLegacy = _status?.is_legacy;
      badge.textContent = _connected
        ? (isLegacy ? "● Verbunden (Team)" : "● Verbunden")
        : "Nicht verbunden";
      badge.className   = _connected ? "badge badge-success" : "badge badge-muted";
      badge.style.fontSize = "11px";
      badge.title = isLegacy ? "Legacy Auth'n'Auth Token (Teamzugang)" : "";
    }
    const disconnBtn = _container.querySelector("#btnReprDisconnect");
    if (disconnBtn) disconnBtn.style.display = _connected ? "" : "none";

    const countEl = _container.querySelector("#reprItemCount");
    if (countEl) countEl.textContent = `${_items.length} Artikel`;

    const listEl = _container.querySelector("#reprItemList");
    if (listEl) listEl.innerHTML = _renderItemList();

    _renderDetail(_selected ? (_items.find(i => i.sku === _selected) || null) : null);
  }

  function _renderItemList() {
    const active  = _items.filter(i => i.enabled !== false).length;
    const updated = _items.filter(i => i.status === "UPDATED" || i.status === "RAISED").length;
    const lastRun = _status?.lastRun ? fmtAgo(_status.lastRun) : "—";
    const statsBar = `
      <div style="padding:8px 12px;display:flex;gap:16px;border-bottom:1px solid var(--border);background:var(--bg-panel)">
        <span class="text-xs text-muted"><span class="font-semibold text-primary">${_items.length}</span> Gesamt</span>
        <span class="text-xs text-muted"><span class="font-semibold" style="color:var(--green)">${active}</span> Aktiv</span>
        <span class="text-xs text-muted"><span class="font-semibold" style="color:#818cf8">${updated}</span> Angepasst</span>
        <span class="text-xs text-muted" style="margin-left:auto">Letzter Run: ${lastRun}</span>
      </div>`;

    if (!_items.length) {
      return statsBar + `<div class="comp-empty-state">
        <p class="text-xs text-muted" style="padding:16px;text-align:center">
          ${_connected
            ? `Noch keine Artikel.<br>Klicke <strong>+ Hinzufügen</strong> oder <strong>Listings sync</strong>.`
            : `eBay nicht verbunden.<br>Klicke auf <strong>● Nicht verbunden</strong> um dich zu verbinden.`
          }
        </p>
      </div>`;
    }

    return statsBar + _items.map(item => {
      const isSelected  = _selected === item.sku;
      const statusChip  = _renderStatusChip(item);
      const stripeColor = STATUS_COLORS[item.status] || "transparent";
      const pausedDot   = item.enabled === false
        ? `<span style="color:var(--text-muted);font-size:10px" title="Deaktiviert">⏸ </span>`
        : "";
      const priceDelta = item.last_price != null && item.old_price != null
        ? item.last_price - item.old_price : null;
      const deltaStr = priceDelta != null && Math.abs(priceDelta) >= 0.01
        ? `<span style="font-size:10px;color:${priceDelta > 0 ? "#22c55e" : "#f87171"}">${priceDelta > 0 ? "+" : ""}${priceDelta.toFixed(2)}€</span>`
        : "";
      return `
        <div class="comp-seller-row ${isSelected ? "active" : ""}" data-sku="${_esc(item.sku)}"
             style="border-left:3px solid ${stripeColor};padding-left:9px">
          <div style="flex:1;min-width:0">
            <div class="text-sm font-medium text-primary" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${pausedDot}${_esc(item.title || item.ean || item.sku)}</div>
            <div class="text-xs text-muted" style="margin-top:2px">${_esc(item.ean || item.sku)}${item.quantity != null ? ` · ${item.quantity}x` : ""}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:2px">
            ${statusChip}
            <div style="display:flex;gap:4px;align-items:center">
              ${deltaStr}
              ${item.last_price != null ? `<span class="text-xs text-muted">${fmt(item.last_price)}</span>` : ""}
            </div>
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
    if (s === "NO_EBAY_ID")  return `<span class="badge badge-warning" style="font-size:10px">⚠ Keine ID</span>`;
    return `<span class="badge badge-muted" style="font-size:10px">${s}</span>`;
  }

  function _renderDetail(item) {
    const el = _container?.querySelector("#reprDetail");
    if (!el) return;
    if (!item) {
      el.innerHTML = `
        <div class="comp-detail-empty">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" style="opacity:.2;margin-bottom:10px">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <p class="text-sm text-muted">Artikel auswählen</p>
          <p class="text-xs text-muted" style="margin-top:4px;opacity:.6">Details, Regel und Verlauf</p>
        </div>`;
      return;
    }

    const repricer          = _settings?.repricer || {};
    const rule              = item.rule || {};
    const minMargin         = rule.min_margin_pct           ?? repricer.global_min_margin_pct           ?? 15;
    const strategy          = rule.price_strategy           ?? repricer.global_price_strategy           ?? "cheapest";
    const raiseWhenCheapest = rule.raise_when_cheapest      ?? repricer.global_raise_when_cheapest      ?? true;
    const commercialOnly    = rule.commercial_only          ?? repricer.global_commercial_only          ?? false;
    const commercialMinFb   = rule.commercial_min_feedback  ?? repricer.global_commercial_min_feedback  ?? 10;
    const ebayCategory      = rule.ebay_category            ?? repricer.global_ebay_category            ?? "sonstiges";
    const isEnabled         = item.enabled !== false;
    const itemLog           = _log.filter(e => e.ean === item.ean || e.sku === item.sku).slice(0, 15);
    const invMatch          = _inventory.find(i => (item.ean && i.ean === item.ean) || (item.sku && i.sku === item.sku));
    const itemEk            = invMatch?.ek   ?? null;
    const itemShip          = invMatch?.ship_out ?? 0;
    const currentFloor      = itemEk != null ? _calcFloor(itemEk, itemShip, minMargin, ebayCategory) : item.floor_price;
    const feeRate           = EBAY_CATEGORIES[ebayCategory]?.fee ?? 0.13;
    const feePct            = Math.round(feeRate * 100 * 10) / 10;

    const strategyOpts = Object.entries(STRATEGY_LABELS).map(([v, l]) =>
      `<option value="${v}" ${strategy === v ? "selected" : ""}>${l}</option>`
    ).join("");
    const categoryOpts = Object.entries(EBAY_CATEGORIES).map(([v, c]) =>
      `<option value="${v}" ${ebayCategory === v ? "selected" : ""}>${c.label} (${Math.round(c.fee*100*10)/10}%)</option>`
    ).join("");

    // Banners
    const noEanBanner = !item.ean ? `
      <div style="padding:8px 16px;background:rgba(245,158,11,.08);border-bottom:1px solid rgba(245,158,11,.2);display:flex;gap:8px;align-items:flex-start">
        <span style="font-size:12px;flex-shrink:0;margin-top:1px">⚠️</span>
        <span class="text-xs" style="color:#fbbf24;line-height:1.4">Keine EAN — Konkurrenzsuche nicht möglich. EAN im Inventar ergänzen.</span>
      </div>` : "";
    const errorBanner = item.status === "EBAY_FAILED" && item.ebay_error ? `
      <div style="padding:8px 16px;background:rgba(239,68,68,.08);border-bottom:1px solid rgba(239,68,68,.2);display:flex;gap:8px;align-items:flex-start">
        <span style="font-size:12px;flex-shrink:0;margin-top:1px">❌</span>
        <span class="text-xs" style="color:#f87171;line-height:1.4">eBay-Fehler: ${_esc(String(item.ebay_error).slice(0, 160))}</span>
      </div>` :
      item.status === "NO_EBAY_ID" ? `
      <div style="padding:8px 16px;background:rgba(245,158,11,.08);border-bottom:1px solid rgba(245,158,11,.2);display:flex;gap:8px;align-items:flex-start">
        <span style="font-size:12px;flex-shrink:0;margin-top:1px">⚠️</span>
        <span class="text-xs" style="color:#fbbf24;line-height:1.4">Keine eBay-Item-ID — klicke <strong>Listings sync</strong> oder trage die eBay-ID manuell ein.</span>
      </div>` : "";

    // Price comparison color
    const cmpColor = item.competitor_min != null && item.last_price != null
      ? (item.last_price > item.competitor_min + 0.01 ? "#f87171" : item.last_price < item.competitor_min - 0.01 ? "#22c55e" : "var(--text-primary)")
      : "var(--text-muted)";

    el.innerHTML = `
      <!-- ─ Header ────────────────────────────────────────────── -->
      <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">
          <div class="text-sm font-semibold text-primary" style="line-height:1.3;flex:1;min-width:0">${_esc(item.title || item.ean || item.sku)}</div>
          <label class="toggle-switch" style="flex-shrink:0;margin-top:1px" title="${isEnabled ? "Aktiv — klicken zum Pausieren" : "Pausiert — klicken zum Aktivieren"}">
            <input type="checkbox" id="reprToggleEnabled" ${isEnabled ? "checked" : ""}>
            <span class="toggle-track"></span>
          </label>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
          ${item.ean ? `<span class="badge badge-muted" style="font-size:10px">EAN: ${_esc(item.ean)}</span>` : ""}
          ${item.quantity != null ? `<span class="badge badge-muted" style="font-size:10px">${item.quantity}x Lager</span>` : ""}
          ${item.ebay_item_id
            ? `<a href="https://www.ebay.de/itm/${_esc(item.ebay_item_id)}" target="_blank"
                 style="font-size:10px;color:var(--indigo);text-decoration:none;background:rgba(99,102,241,.1);padding:2px 6px;border-radius:4px;border:1px solid rgba(99,102,241,.2)">
                 eBay #${_esc(item.ebay_item_id)} ↗
               </a>`
            : `<span class="badge badge-muted" style="font-size:10px;opacity:.5">Keine eBay-ID</span>`}
          ${_renderStatusChip(item)}
        </div>
      </div>

      ${noEanBanner}${errorBanner}

      <!-- ─ Metrics grid ─────────────────────────────────────── -->
      <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
          <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
            <div class="text-xs text-muted" style="margin-bottom:3px">Aktueller Preis</div>
            <div class="text-sm font-semibold text-primary">${fmt(item.last_price ?? item.current_price)}</div>
          </div>
          <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
            <div class="text-xs text-muted" style="margin-bottom:3px">Günstigster</div>
            <div class="text-sm font-semibold" style="color:${cmpColor}">${fmt(item.competitor_min)}</div>
          </div>
          <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
            <div class="text-xs text-muted" style="margin-bottom:3px">2. Günstigster</div>
            <div class="text-sm font-semibold text-muted">${fmt(item.competitor_2nd)}</div>
          </div>
          <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
            <div class="text-xs text-muted" style="margin-bottom:3px">Floor</div>
            <div class="text-sm font-semibold" style="color:var(--text-secondary)">${item.floor_price != null ? fmt(item.floor_price) : fmt(currentFloor)}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px">
          <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
            <div class="text-xs text-muted" style="margin-bottom:3px">Konkurrenten</div>
            <div class="text-sm font-semibold text-muted">${item.candidate_count ?? "—"}</div>
          </div>
          <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
            <div class="text-xs text-muted" style="margin-bottom:3px">Letzter Run</div>
            <div class="text-sm text-secondary">${fmtAgo(item.last_repriced_at)}</div>
          </div>
          <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
            <div class="text-xs text-muted" style="margin-bottom:3px">eBay-Gebühr</div>
            <div class="text-sm font-semibold text-muted">${feePct}%</div>
          </div>
        </div>
      </div>

      <!-- ─ Rule editor ──────────────────────────────────────── -->
      <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span class="text-xs font-semibold text-secondary" style="text-transform:uppercase;letter-spacing:.06em">Regel (Artikel-spezifisch)</span>
          <span class="text-xs text-muted">${item.rule ? "Eigene Regel" : "Global-Einstellungen"}</span>
        </div>
        <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px">

          <div style="display:grid;grid-template-columns:100px 1fr;gap:8px;align-items:center">
            <label class="text-xs text-muted">Strategie</label>
            <select id="ruleStrategy" class="input-sm">${strategyOpts}</select>
          </div>

          <div id="ruleRaiseRow" style="display:grid;grid-template-columns:100px 1fr;gap:8px;align-items:center;${strategy !== "cheapest" ? "opacity:.35;pointer-events:none" : ""}">
            <label class="text-xs text-muted">Wenn günstigster</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" id="ruleRaiseWhenCheapest" ${raiseWhenCheapest ? "checked" : ""}>
              <span class="text-xs">Auf 2. Günstigsten anheben</span>
            </label>
          </div>

          <div style="height:1px;background:var(--border);margin:0 -12px"></div>

          <div style="display:grid;grid-template-columns:100px 1fr;gap:8px;align-items:center">
            <label class="text-xs text-muted">Nur Gewerbliche</label>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" id="ruleCommercialOnly" ${commercialOnly ? "checked" : ""}>
                <span class="text-xs">Private ignorieren</span>
              </label>
              <div id="ruleCommFbRow" style="${commercialOnly ? "" : "opacity:.35;pointer-events:none;"}display:flex;align-items:center;gap:4px">
                <span class="text-xs text-muted">min.</span>
                <input type="number" id="ruleCommFb" class="input-sm" value="${commercialMinFb}" min="1" max="9999" style="width:56px">
                <span class="text-xs text-muted">Feedback</span>
              </div>
            </div>
          </div>

          <div style="height:1px;background:var(--border);margin:0 -12px"></div>

          <div style="display:grid;grid-template-columns:100px 1fr;gap:8px;align-items:center">
            <label class="text-xs text-muted">Mindest-Marge</label>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <input type="number" id="ruleMinMargin" class="input-sm" value="${minMargin}" min="0" max="200" step="1" style="width:56px"
                data-ek="${itemEk ?? ""}" data-ship="${itemShip}" data-cat="${ebayCategory}">
              <span class="text-xs text-muted">%</span>
              <span class="text-xs" style="color:var(--text-secondary)">→ Floor: <strong id="floorDisplay">${currentFloor != null ? fmt(currentFloor) : "—"}</strong></span>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:100px 1fr;gap:8px;align-items:center">
            <label class="text-xs text-muted">eBay-Kategorie</label>
            <select id="ruleEbayCategory" class="input-sm">${categoryOpts}</select>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-primary btn-sm" id="btnSaveRule">Speichern</button>
          <button class="btn btn-ghost btn-sm" id="btnRemoveItem" style="color:var(--red)">Entfernen</button>
        </div>
      </div>

      <!-- ─ History ────────────────────────────────────────── -->
      ${itemLog.length ? `
      <div style="padding:12px 16px">
        <div class="text-xs font-semibold text-secondary" style="margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Verlauf</div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid var(--border)">
              <th class="text-xs text-muted" style="text-align:left;padding:0 6px 5px 0;font-weight:500">Zeit</th>
              <th class="text-xs text-muted" style="text-align:left;padding:0 6px 5px;font-weight:500">Preisänderung</th>
              <th class="text-xs text-muted" style="text-align:right;padding:0 0 5px 6px;font-weight:500">Status</th>
            </tr>
          </thead>
          <tbody>
            ${itemLog.map((e, i) => {
              const raised  = e.status === "RAISED";
              const lowered = (e.new_price || 0) < (e.old_price || 0);
              const color   = raised ? "#818cf8" : (lowered ? "#22c55e" : "var(--text-muted)");
              const arrow   = raised ? "↑" : (lowered ? "↓" : "→");
              const delta   = Math.abs((e.new_price||0)-(e.old_price||0));
              const statusBadge = _renderStatusChip({ status: e.status });
              const stratBadge  = e.price_strategy
                ? `<span style="font-size:9px;color:var(--text-muted)">${STRATEGY_LABELS[e.price_strategy] || e.price_strategy}</span>`
                : "";
              return `
                <tr style="border-bottom:${i < itemLog.length-1 ? "1px solid var(--border)" : "none"}">
                  <td class="text-xs text-muted" style="padding:6px 6px 6px 0;white-space:nowrap">${fmtDate(e.ts)}</td>
                  <td style="padding:6px">
                    <div style="display:flex;align-items:center;gap:6px">
                      <span class="text-xs text-secondary">${fmt(e.old_price)}</span>
                      <span style="font-size:11px;color:${color}">${arrow}</span>
                      <span class="text-xs font-semibold" style="color:${color}">${fmt(e.new_price)}</span>
                      ${delta >= 0.01 ? `<span class="text-xs" style="color:${color};opacity:.8">${raised ? "+" : "−"}${delta.toFixed(2)}€</span>` : ""}
                    </div>
                    ${stratBadge}
                  </td>
                  <td style="padding:6px 0 6px 6px;text-align:right;white-space:nowrap">${statusBadge}</td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>` : `
      <div style="padding:20px 16px;text-align:center">
        <p class="text-xs text-muted" style="opacity:.5">Noch kein Verlauf vorhanden</p>
      </div>`}
    `;

    // Wire dynamics
    const stratSel   = el.querySelector("#ruleStrategy");
    const raiseRow   = el.querySelector("#ruleRaiseRow");
    const commCheck  = el.querySelector("#ruleCommercialOnly");
    const commFbRow  = el.querySelector("#ruleCommFbRow");
    const catSel     = el.querySelector("#ruleEbayCategory");
    const marginInp  = el.querySelector("#ruleMinMargin");
    const floorDisp  = el.querySelector("#floorDisplay");

    const updateFloor = () => {
      const ek  = parseFloat(marginInp?.dataset.ek || "");
      const sh  = parseFloat(marginInp?.dataset.ship || "0");
      const pct = parseFloat(marginInp?.value || "0");
      const cat = catSel?.value || "sonstiges";
      if (!isNaN(ek) && !isNaN(pct) && floorDisp) {
        floorDisp.textContent = fmt(_calcFloor(ek, sh, pct, cat));
      }
      if (marginInp) marginInp.dataset.cat = catSel?.value || "sonstiges";
    };

    stratSel?.addEventListener("change", () => {
      const ok = stratSel.value === "cheapest";
      if (raiseRow) { raiseRow.style.opacity = ok ? "1" : ".35"; raiseRow.style.pointerEvents = ok ? "" : "none"; }
    });
    commCheck?.addEventListener("change", () => {
      if (commFbRow) { commFbRow.style.opacity = commCheck.checked ? "1" : ".35"; commFbRow.style.pointerEvents = commCheck.checked ? "" : "none"; }
    });
    marginInp?.addEventListener("input", updateFloor);
    catSel?.addEventListener("change", updateFloor);

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
    [[_items, _log, _status, _inventory], connStatus] = await Promise.all([
      Promise.all([
        Storage.repricerList(),
        Storage.repricerLog(),
        Storage.repricerStatus(),
        Storage.listInventory().then(r => r.items || []).catch(() => []),
      ]),
      Storage.repricerIsConnected(),
    ]);
    _connected = typeof connStatus === "object" ? connStatus.connected : !!connStatus;
    if (typeof connStatus === "object" && _status) _status.is_legacy = connStatus.is_legacy;
    _render();
  }

  async function _saveRule(item) {
    const el = _container?.querySelector("#reprDetail");
    if (!el) return;
    const strategy       = el.querySelector("#ruleStrategy")?.value           || "cheapest";
    const raise          = el.querySelector("#ruleRaiseWhenCheapest")?.checked ?? true;
    const commOnly       = el.querySelector("#ruleCommercialOnly")?.checked    ?? false;
    const commFb         = parseInt(el.querySelector("#ruleCommFb")?.value     || "10");
    const minMargin      = parseFloat(el.querySelector("#ruleMinMargin")?.value || "15");
    const ebayCategory   = el.querySelector("#ruleEbayCategory")?.value        || "sonstiges";
    await Storage.repricerUpdate(item.sku, {
      rule: {
        price_strategy:          strategy,
        raise_when_cheapest:     raise,
        commercial_only:         commOnly,
        commercial_min_feedback: commFb,
        min_margin_pct:          minMargin,
        ebay_category:           ebayCategory,
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

        <div style="padding:12px;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px">
          ${_connected
            ? `<div style="display:flex;justify-content:space-between;align-items:center">
                 <p class="text-xs" style="color:var(--green)">● eBay-Konto verbunden${_status?.is_legacy ? " <span style=\"color:#818cf8\">(Team-Token)</span>" : ""}</p>
                 <button class="btn btn-ghost btn-xs" id="btnConnectEbaySettings" style="color:var(--text-muted)">Neu verbinden</button>
               </div>`
            : `<p class="text-xs text-muted" style="margin-bottom:8px">eBay-Konto nicht verbunden — Preisaktualisierungen + Listing-Sync nicht möglich.</p>
               <button class="btn btn-primary btn-sm" id="btnConnectEbaySettings">Mit eBay verbinden →</button>`
          }
        </div>

        <hr style="border:none;border-top:1px solid var(--border)">

        <div>
          <label class="text-xs font-semibold text-secondary" style="display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em">
            Team-Zugang / Sub-Account
          </label>
          <p class="text-xs text-muted" style="margin-bottom:10px;line-height:1.5">
            Falls du als Mitverkäufer arbeitest: Legacy Auth'n'Auth Token des <strong>Hauptkontos</strong> eingeben.<br>
            Zu finden unter: <em>Mein eBay → Konto → API-Zugriff → Auth'n'Auth Token</em>
          </p>
          ${_status?.is_legacy
            ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                 <span class="badge" style="background:rgba(99,102,241,.18);color:#818cf8;font-size:10px">● Team-Token aktiv</span>
                 <button class="btn btn-ghost btn-xs" id="btnRemoveLegacyToken" style="color:#f87171">Token entfernen</button>
               </div>`
            : ""
          }
          <div style="display:flex;gap:8px;align-items:flex-start">
            <textarea id="reprLegacyToken" class="input-sm" placeholder="AgAAAA... (optional)" rows="2"
              style="flex:1;font-size:10px;font-family:monospace;resize:vertical;min-height:36px"></textarea>
            <button class="btn btn-secondary btn-sm" id="btnSaveLegacyToken" style="flex-shrink:0;margin-top:1px">Speichern</button>
          </div>
        </div>

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

    document.getElementById("btnSaveLegacyToken")?.addEventListener("click", async () => {
      const token = document.getElementById("reprLegacyToken")?.value?.trim();
      if (!token) { Toast.warning("Token leer", "Bitte einen Token eingeben"); return; }
      const btn = document.getElementById("btnSaveLegacyToken");
      if (btn) { btn.disabled = true; btn.textContent = "…"; }
      try {
        const res = await Storage.repricerSetLegacyToken(token);
        if (res?.ok) {
          Modal.close();
          _connected = true;
          if (_status) _status.is_legacy = true;
          _render();
          Toast.success("Team-Token gespeichert", "eBay Teamzugang ist jetzt aktiv");
        } else {
          Toast.error("Fehler", res?.error || "Token konnte nicht gespeichert werden");
        }
      } catch { Toast.error("Fehler", "Token konnte nicht gespeichert werden"); }
      finally { if (btn) { btn.disabled = false; btn.textContent = "Speichern"; } }
    });

    document.getElementById("btnRemoveLegacyToken")?.addEventListener("click", async () => {
      await Storage.repricerRemoveLegacyToken();
      if (_status) _status.is_legacy = false;
      Modal.close();
      await _refreshData();
      Toast.success("Token entfernt", "Team-Token wurde gelöscht");
    });
  }

  // ── Utils ──────────────────────────────────────────────────────────────────
  function _esc(s) {
    if (s == null) return "";
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  return { mount, unmount };
})();
