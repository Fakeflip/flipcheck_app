/* Flipcheck v2 — Konkurrenz-Monitor View */
const CompetitionView = (() => {
  let _container      = null;
  let _tab            = "sellers";
  let _sellers        = [];
  let _sellerSelected = null;
  let _inventory      = [];
  let _invSelected    = null;
  let _debounce       = null;
  const _compCache    = new Map();  // itemId → { total, items, fetchedAt }

  // Webhook state (loaded from settings)
  let _wh = {
    url:    "",
    events: { undercut: true, new_listing: true, price_drop: false, verdict_change: false, new_seller: false },
  };

  // ── Lifecycle ────────────────────────────────────────────────────────────
  function mount(container) {
    _container      = container;
    _tab            = "sellers";
    _sellerSelected = null;
    _invSelected    = null;
    container.innerHTML = renderShell();
    init(container);
  }

  function unmount() {
    if (_debounce) { clearTimeout(_debounce); _debounce = null; }
    _container = null;
  }

  // ── Shell ────────────────────────────────────────────────────────────────
  function renderShell() {
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Konkurrenz-Monitor</h1>
          <p>Verkäufer beobachten · Marktposition deiner Produkte checken</p>
          <div class="comp-stats-bar" id="compStatsBar" style="display:none"></div>
        </div>
        <div class="page-header-right">
          <button class="btn btn-secondary btn-sm" id="btnWebhookTab" title="Webhook-Einstellungen">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M6.5 1.5A5 5 0 0 1 14.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <circle cx="5" cy="11" r="2.5" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="11" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M7.5 10.5l-1-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M8.5 5.5l1 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            Webhooks
          </button>
        </div>
      </div>

      <div class="comp-tabs mb-16">
        <button class="comp-tab active" data-tab="sellers">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="5.5" r="3" stroke="currentColor" stroke-width="1.5"/>
            <path d="M2 14c0-3.31 2.69-6 6-6s6 2.69 6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          Verkäufer
        </button>
        <button class="comp-tab" data-tab="inventory">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="5" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M5 5V3.5A3 3 0 0 1 11 3.5V5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M5.5 9.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          Mein Inventory
        </button>
        <button class="comp-tab" data-tab="webhooks">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M6.5 1.5A5 5 0 0 1 14.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="5" cy="11" r="2.5" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="11" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M7.5 10.5l-1-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M8.5 5.5l1 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          Webhooks
        </button>
      </div>

      <div class="comp-split" id="compContent">
        ${renderSellersPanel()}
      </div>
    `;
  }

  async function init(container) {
    // Fetch sellers + settings in parallel (both are independent IPC calls)
    const [sellers, settings] = await Promise.all([
      Storage.listSellers(),
      Storage.getSettings(),
    ]);
    _sellers = sellers;
    if (settings?.webhook_url)    _wh.url    = settings.webhook_url;
    if (settings?.webhook_events) _wh.events = { ..._wh.events, ...settings.webhook_events };
    rerenderSellerLeft();
    updateStatsBar();
    bindTabs(container);
    bindSellerForm(container);
    bindSellerList(container);
    // "Webhooks" shortcut button in page-header-right
    container.querySelector("#btnWebhookTab")?.addEventListener("click", () => {
      _tab = "webhooks";
      container.querySelectorAll(".comp-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === "webhooks"));
      const content = container.querySelector("#compContent");
      content.style.display = "block";
      content.innerHTML = renderWebhookPanel();
      bindWebhookPanel(container);
      renderWebhookPanelAsync();
    });
  }

  function updateStatsBar() {
    const bar = _container?.querySelector("#compStatsBar");
    if (!bar) return;
    if (!_sellers.length) { bar.style.display = "none"; return; }
    const lastCheck = _sellers.reduce((latest, s) => {
      if (!s.last_checked) return latest;
      const t = new Date(s.last_checked).getTime();
      return t > latest ? t : latest;
    }, 0);
    const lastCheckStr = lastCheck ? `vor ${timeSince(new Date(lastCheck).toISOString())}` : "—";
    const totalListings = _sellers.reduce((sum, s) => sum + (s.listing_count || 0), 0);
    bar.style.display = "flex";
    bar.innerHTML = `
      <span class="comp-stats-pill"><b>${_sellers.length}</b> Verkäufer</span>
      ${totalListings ? `<span class="comp-stats-pill"><b>${totalListings.toLocaleString("de-DE")}</b> Listings gesamt</span>` : ""}
      <span class="comp-stats-pill">letzter Check <b>${lastCheckStr}</b></span>
      ${_wh.url ? `<span class="comp-stats-pill" style="color:var(--green);border-color:var(--green-bdr);background:var(--green-sub)">● Webhook aktiv</span>` : ""}
    `;
  }

  // ── Tab logic ────────────────────────────────────────────────────────────
  function bindTabs(container) {
    container.querySelector(".comp-tabs")?.addEventListener("click", async e => {
      const btn = e.target.closest(".comp-tab");
      if (!btn || btn.dataset.tab === _tab) return;
      _tab = btn.dataset.tab;
      container.querySelectorAll(".comp-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === _tab));
      const content = container.querySelector("#compContent");
      if (!content) return;
      if (_tab === "sellers") {
        content.style.display = "";
        content.innerHTML = renderSellersPanel();
        rerenderSellerLeft();
        bindSellerForm(container);
        bindSellerList(container);
      } else if (_tab === "inventory") {
        content.style.display = "";
        content.innerHTML = renderLoadingFull("Inventory wird geladen…");
        _inventory = await Storage.listInventory();
        content.innerHTML = renderInventoryPanel();
        bindInvList(container);
      } else if (_tab === "webhooks") {
        content.style.display = "block";
        content.innerHTML = renderWebhookPanel();
        bindWebhookPanel(container);
        renderWebhookPanelAsync(); // load monitor status then re-render
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SELLERS TAB
  // ──────────────────────────────────────────────────────────────────────────
  function renderSellersPanel() {
    return `
      <div class="comp-left" id="sellerLeft">
        <div class="comp-add-wrap">
          <input class="input" id="sellerInput" placeholder="eBay Username…" style="flex:1;min-width:0"/>
          <button class="btn btn-primary btn-sm" id="btnAddSeller" style="white-space:nowrap">+ Hinzufügen</button>
        </div>
        <div id="sellerList" class="comp-list"></div>
      </div>
      <div class="comp-right" id="compRight">${renderRightEmpty("Verkäufer auswählen", "Links einen Verkäufer auswählen oder per Username hinzufügen.")}</div>
    `;
  }

  const _AVATAR_CLASSES = ["comp-avatar-a","comp-avatar-b","comp-avatar-c","comp-avatar-d"];

  function renderSellerListItems() {
    if (!_sellers.length) return `<div class="comp-list-empty">Noch keine Verkäufer.<br>Username oben eingeben.</div>`;
    return _sellers.map((s, idx) => {
      const fbStr   = s.feedback_score != null ? `${Number(s.feedback_score).toLocaleString("de-DE")} Bew.` : null;
      const listStr = s.listing_count  != null ? `${s.listing_count} Listings` : null;
      const sub     = [listStr, fbStr].filter(Boolean).join(" · ") || "noch nicht geladen";
      const avatarCls = _AVATAR_CLASSES[idx % _AVATAR_CLASSES.length];
      return `
        <div class="comp-list-item ${_sellerSelected === s.username ? "active" : ""}" data-seller="${esc(s.username)}">
          <div class="comp-avatar ${avatarCls}">${(s.username[0] || "?").toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div class="comp-item-name">@${esc(s.username)}</div>
            <div class="text-xs text-muted">
              ${sub}${s.last_checked ? ` · vor ${timeSince(s.last_checked)}` : ""}
            </div>
          </div>
          <button class="comp-del-btn" data-remove="${esc(s.username)}" title="Entfernen">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>
      `;
    }).join("");
  }

  function rerenderSellerLeft() {
    const list = _container?.querySelector("#sellerList");
    if (list) list.innerHTML = renderSellerListItems();
    bindSellerList(_container);
    updateStatsBar();
  }

  function bindSellerForm(container) {
    const btn   = container?.querySelector("#btnAddSeller");
    const input = container?.querySelector("#sellerInput");
    if (!btn || !input) return;
    const doAdd = async () => {
      const username = input.value.trim().replace(/^@/, "");
      if (!username) return;
      input.value = "";
      btn.disabled = true;
      try {
        _sellers = await Storage.addSeller(username);
        rerenderSellerLeft();
        await loadSellerListings(username);
      } catch (err) { ErrorReporter.report(err, "competition:addSeller"); Toast.error("Hinzufügen fehlgeschlagen", "Verkäufer konnte nicht hinzugefügt werden."); }
      finally  { btn.disabled = false; }
    };
    btn.addEventListener("click", doAdd);
    input.addEventListener("keydown", e => { if (e.key === "Enter") doAdd(); });
  }

  function bindSellerList(container) {
    if (!container) return;
    container.querySelectorAll("[data-seller]").forEach(el => {
      el.addEventListener("click", e => {
        if (e.target.closest("[data-remove]")) return;
        loadSellerListings(el.dataset.seller);
      });
    });
    container.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const u = btn.dataset.remove;
        _sellers = await Storage.removeSeller(u);
        if (_sellerSelected === u) {
          _sellerSelected = null;
          const right = _container?.querySelector("#compRight");
          if (right) right.innerHTML = renderRightEmpty("Verkäufer auswählen", "Links einen Verkäufer auswählen.");
        }
        rerenderSellerLeft();
      });
    });
  }

  async function loadSellerListings(username, q = "") {
    _sellerSelected = username;
    rerenderSellerLeft();
    const right = _container?.querySelector("#compRight");
    if (right) right.innerHTML = renderRightLoading(`@${username} wird geladen…`);
    try {
      const { ok, data } = await API.sellerListings(username, 100, q);
      if (!ok || !data?.ok) throw new Error(data?.error || "API-Fehler");
      const items         = data.items || [];
      const feedbackScore = items[0]?.seller_feedback ?? null;
      const feedbackPct   = items[0]?.seller_pct      ?? null;
      if (!q) {
        await Storage.updateSellerCount(username, data.total, feedbackScore, feedbackPct);
        const s = _sellers.find(x => x.username === username);
        if (s) {
          s.listing_count  = data.total;
          s.last_checked   = new Date().toISOString();
          s.feedback_score = feedbackScore;
          s.feedback_pct   = feedbackPct;
        }
        rerenderSellerLeft();
      }
      if (right) right.innerHTML = renderSellerListings(username, data.total, items, q, feedbackScore, feedbackPct);
      bindRightRefresh();
    } catch (err) {
      if (right) right.innerHTML = renderRightError(err.message);
    }
  }

  function renderSellerListings(username, total, items, activeQ = "", feedbackScore = null, feedbackPct = null) {
    const rows = items.map(it => `
      <tr>
        <td>
          <div class="row gap-8">
            ${it.image_url ? `<img src="${esc(it.image_url)}" style="width:30px;height:30px;object-fit:contain;border-radius:4px;flex-shrink:0" loading="lazy">` : ""}
            <span class="comp-listing-title" title="${esc(it.title)}">${esc(it.title)}</span>
          </div>
        </td>
        <td class="text-right font-bold" style="font-variant-numeric:tabular-nums;white-space:nowrap">${fmtEur(it.price)}</td>
        <td class="text-muted text-sm text-right" style="white-space:nowrap">${it.shipping != null ? `+${fmtEur(it.shipping)}` : "—"}</td>
        <td><span class="badge badge-muted" style="font-size:10px;white-space:nowrap">${esc(it.condition || "—")}</span></td>
        <td style="text-align:right">${it.item_url ? `<a href="${esc(it.item_url)}" class="btn btn-ghost btn-sm" target="_blank" style="padding:2px 8px;font-size:10px">eBay →</a>` : ""}</td>
      </tr>
    `).join("");

    const totalLabel = activeQ
      ? `${total} Treffer für „${esc(activeQ)}"`
      : `${total} Listings · gerade abgerufen`;

    const fbParts = [];
    if (feedbackScore != null) fbParts.push(`<span class="comp-stat-pill">⭐ ${Number(feedbackScore).toLocaleString("de-DE")} Bew.</span>`);
    if (feedbackPct   != null) fbParts.push(`<span class="comp-stat-pill">${parseFloat(feedbackPct).toFixed(1)}% positiv</span>`);
    const statsHtml = fbParts.length ? `<div class="comp-seller-strip">${fbParts.join("")}</div>` : "";

    return `
      <div class="comp-right-hdr">
        <div>
          <div class="font-semibold" style="font-size:14px">@${esc(username)}</div>
          <div class="text-xs text-muted">${totalLabel}</div>
          ${statsHtml}
        </div>
        <div class="row gap-8">
          <div class="comp-search-wrap">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" class="shrink-0 text-muted">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M10.5 10.5L14.5 14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <input class="comp-search-input" id="sellerSearchInput" placeholder="Listings durchsuchen…"
              value="${esc(activeQ)}" data-seller="${esc(username)}"/>
          </div>
          <button class="btn btn-secondary btn-sm" data-refresh-seller="${esc(username)}">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M13 8A5 5 0 1 1 3.07 5.65M3 2v4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Alle laden
          </button>
        </div>
      </div>
      <div class="comp-table-wrap">
        <table class="comp-table">
          <thead><tr>
            <th>Titel</th>
            <th class="text-right">Preis</th>
            <th class="text-right">Versand</th>
            <th>Zustand</th>
            <th></th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="text-center text-muted" style="padding:32px">Keine Listings gefunden.</td></tr>`}</tbody>
        </table>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INVENTORY TAB
  // ──────────────────────────────────────────────────────────────────────────
  function renderInventoryPanel() {
    const active = _inventory.filter(i => ["IN_STOCK", "LISTED", "LISTING_PENDING"].includes(i.status));
    const leftRows = active.length
      ? active.map(item => {
          const cache = _compCache.get(item.id);
          const statusHtml = cache ? renderInvStatusChip(item, cache) : "";
          return `
            <div class="comp-list-item ${_invSelected?.id === item.id ? "active" : ""}" data-inv="${esc(item.id)}">
              <div style="flex:1;min-width:0">
                <div class="comp-item-name" style="font-size:12px">${esc((item.title || item.ean || "—").slice(0, 38))}</div>
                <div class="text-xs text-muted">${esc(item.ean || "keine EAN")}</div>
                ${statusHtml}
              </div>
              <button class="btn btn-ghost btn-sm comp-check-btn" style="font-size:10px;padding:2px 7px;flex-shrink:0" data-check="${esc(item.id)}">Check</button>
            </div>
          `;
        }).join("")
      : `<div class="comp-list-empty">Keine aktiven Items im Inventory.</div>`;

    return `
      <div class="comp-left">
        <div class="row-between mb-10">
          <span class="text-xs text-muted font-semibold">${active.length} aktive Produkte</span>
          <button class="btn btn-secondary btn-sm" id="btnCheckAll" style="font-size:11px">Alle prüfen</button>
        </div>
        <div class="comp-list" id="invList">${leftRows}</div>
      </div>
      <div class="comp-right" id="compRight">${renderRightEmpty("Produkt wählen", "Links ein Inventory-Item wählen um die Konkurrenz zu sehen.")}</div>
    `;
  }

  function renderInvStatusChip(item, cache) {
    const { total, items } = cache;
    const myPrice = item.sell_price || null;
    if (!myPrice) return `<div class="comp-status-chip comp-status-neutral">${total} Anbieter</div>`;
    const cheapest = items[0]?.total_price;
    if (cheapest && cheapest < myPrice - 0.01)
      return `<div class="comp-status-chip comp-status-danger">⚠ unterboten ${fmtEur(cheapest)}</div>`;
    const rank = items.filter(i => i.total_price < myPrice).length + 1;
    if (rank === 1)
      return `<div class="comp-status-chip comp-status-good">✓ günstigster</div>`;
    return `<div class="comp-status-chip comp-status-neutral">#${rank} von ${total}</div>`;
  }

  function bindInvList(container) {
    if (!container) return;
    container.querySelectorAll("[data-inv]").forEach(el => {
      el.addEventListener("click", e => {
        if (e.target.closest("[data-check]")) return;
        const item = _inventory.find(i => i.id === el.dataset.inv);
        if (item) loadInvCompetition(item);
      });
    });
    container.querySelectorAll("[data-check]").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const item = _inventory.find(i => i.id === btn.dataset.check);
        if (item) loadInvCompetition(item);
      });
    });
    container.querySelector("#btnCheckAll")?.addEventListener("click", checkAllInventory);
  }

  async function checkAllInventory() {
    const active = _inventory.filter(i => ["IN_STOCK","LISTED","LISTING_PENDING"].includes(i.status) && i.ean);
    if (!active.length) { Toast.info("Keine EANs", "Keine aktiven Items mit EAN."); return; }
    Toast.info("Prüfe alle…", `${active.length} Items werden geprüft.`);
    for (const item of active) {
      await loadInvCompetition(item, true);
      await new Promise(r => setTimeout(r, 400));
    }
    Toast.success("Fertig", `${active.length} Items geprüft.`);
    rerenderInvLeft();
  }

  async function loadInvCompetition(item, silent = false) {
    if (!item.ean) { if (!silent) Toast.warning("EAN fehlt", "Dieses Item hat keine EAN hinterlegt."); return; }
    _invSelected = item;
    rerenderInvLeft();
    const right = _container?.querySelector("#compRight");
    if (right && !silent) right.innerHTML = renderRightLoading(`Konkurrenz für "${(item.title || item.ean).slice(0, 30)}" laden…`);
    try {
      const { ok, data } = await API.eanCompetition(item.ean, 50);
      if (!ok || !data?.ok) throw new Error(data?.error || "API-Fehler");
      const items = data.items || [];
      _compCache.set(item.id, { total: data.total, items, fetchedAt: Date.now() });
      rerenderInvLeft();
      if (right && !silent) { right.innerHTML = renderInvCompetition(item, data.total, items); bindRightRefresh(); }
      // Check if undercut → fire webhook if enabled
      if (_wh.url && _wh.events.undercut) {
        const myPrice  = item.sell_price || null;
        const cheapest = items[0]?.total_price ?? null;
        if (myPrice && cheapest && cheapest < myPrice - 0.01) {
          fireWebhook("undercut", { item, cheapest, myPrice, total: data.total });
        }
      }
    } catch (err) {
      if (right && !silent) right.innerHTML = renderRightError(err.message);
    }
  }

  function rerenderInvLeft() {
    const list = _container?.querySelector("#invList");
    if (!list) return;
    const active = _inventory.filter(i => ["IN_STOCK","LISTED","LISTING_PENDING"].includes(i.status));
    list.innerHTML = active.length
      ? active.map(item => {
          const cache = _compCache.get(item.id);
          const statusHtml = cache ? renderInvStatusChip(item, cache) : "";
          return `
            <div class="comp-list-item ${_invSelected?.id === item.id ? "active" : ""}" data-inv="${esc(item.id)}">
              <div style="flex:1;min-width:0">
                <div class="comp-item-name" style="font-size:12px">${esc((item.title || item.ean || "—").slice(0, 38))}</div>
                <div class="text-xs text-muted">${esc(item.ean || "keine EAN")}</div>
                ${statusHtml}
              </div>
              <button class="btn btn-ghost btn-sm comp-check-btn" style="font-size:10px;padding:2px 7px;flex-shrink:0" data-check="${esc(item.id)}">Check</button>
            </div>
          `;
        }).join("")
      : `<div class="comp-list-empty">Keine aktiven Items.</div>`;
    bindInvList(_container);
  }

  function renderInvCompetition(item, total, items) {
    const myPrice  = item.sell_price || null;
    const cheapest = items[0]?.total_price ?? null;
    const highest  = items[items.length - 1]?.total_price ?? null;
    const myRank   = myPrice != null
      ? items.filter(i => (i.total_price || 0) < myPrice).length + 1
      : null;

    // Position banner
    let banner = "";
    if (myPrice != null && cheapest != null) {
      if (cheapest < myPrice - 0.01) {
        banner = `<div class="comp-banner comp-banner-danger">
          ⚠️  Du wirst unterboten — günstigster Konkurrent: <strong>${fmtEur(cheapest)}</strong>
          (dein VK: ${fmtEur(myPrice)}, Differenz: ${fmtEur(myPrice - cheapest)})
        </div>`;
      } else if (myRank === 1) {
        banner = `<div class="comp-banner comp-banner-success">
          ✅  Du bist der günstigste Anbieter (${fmtEur(myPrice)}) — ${total - 1} Anbieter teurer als du.
        </div>`;
      } else {
        banner = `<div class="comp-banner comp-banner-neutral">
          📊  Du bist Rang <strong>#${myRank}</strong> von ${total} Anbietern (${fmtEur(myPrice)}).
        </div>`;
      }
    }

    // KPI tiles
    const kpiBar = `
      <div class="comp-kpi-grid">
        <div class="comp-kpi-tile comp-kpi-green">
          <div class="comp-kpi-val">${fmtEur(cheapest)}</div>
          <div class="comp-kpi-lbl">Günstigster</div>
        </div>
        <div class="comp-kpi-tile comp-kpi-red">
          <div class="comp-kpi-val">${fmtEur(highest)}</div>
          <div class="comp-kpi-lbl">Teuerster</div>
        </div>
        <div class="comp-kpi-tile">
          <div class="comp-kpi-val">${myRank != null ? `#${myRank} / ${total}` : total}</div>
          <div class="comp-kpi-lbl">${myRank != null ? "Mein Rang" : "Anbieter"}</div>
        </div>
        <div class="comp-kpi-tile comp-kpi-accent">
          <div class="comp-kpi-val">${myPrice != null ? fmtEur(myPrice) : "—"}</div>
          <div class="comp-kpi-lbl">Mein VK</div>
        </div>
      </div>
    `;

    const rows = items.map((it, idx) => {
      const isCheapest = idx === 0;
      const isMe = myPrice != null && Math.abs((it.total_price || 0) - myPrice) < 0.02;
      const rowClass = isMe ? "comp-row-me" : isCheapest ? "comp-row-cheapest" : "";
      return `
        <tr class="${rowClass}">
          <td class="text-xs font-semibold nowrap">
            ${isMe ? `<span class="badge badge-blue" style="font-size:9px;margin-right:4px">ich</span>` : ""}
            ${esc(it.seller_id || "—")}
          </td>
          <td class="text-right font-bold tabular-nums nowrap">${fmtEur(it.price)}</td>
          <td class="text-muted text-right text-sm nowrap">${it.shipping != null ? `+${fmtEur(it.shipping)}` : "inkl."}</td>
          <td class="text-right font-bold" style="font-variant-numeric:tabular-nums;white-space:nowrap;color:${isCheapest && !isMe ? "var(--red)" : "var(--text-primary)"}">${fmtEur(it.total_price)}</td>
          <td><span class="badge badge-muted" style="font-size:9px">${esc(it.condition || "—")}</span></td>
          <td class="text-xs nowrap">
            ${it.seller_feedback != null
              ? `<span class="font-semibold text-secondary">${Number(it.seller_feedback).toLocaleString("de-DE")}</span>`
              : ""}
            ${it.seller_pct
              ? `<span class="text-muted"> ${parseFloat(it.seller_pct).toFixed(1)}%</span>`
              : it.seller_feedback == null ? `<span class="text-muted">—</span>` : ""}
          </td>
          <td style="text-align:right">${it.item_url ? `<a href="${esc(it.item_url)}" class="btn btn-ghost btn-sm" target="_blank" style="padding:2px 8px;font-size:10px">eBay →</a>` : ""}</td>
        </tr>
      `;
    }).join("");

    return `
      <div class="comp-right-hdr">
        <div>
          <div class="font-semibold" style="font-size:14px">${esc((item.title || item.ean || "—").slice(0, 60))}</div>
          <div class="text-xs text-muted">EAN: ${esc(item.ean || "—")} · ${total} Angebote · gerade abgerufen</div>
        </div>
        <button class="btn btn-secondary btn-sm" data-refresh-inv="${esc(item.id)}">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M13 8A5 5 0 1 1 3.07 5.65M3 2v4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Aktualisieren
        </button>
      </div>
      ${banner}
      ${kpiBar}
      <div class="comp-table-wrap">
        <table class="comp-table">
          <thead><tr>
            <th>Verkäufer</th>
            <th class="text-right">Preis</th>
            <th class="text-right">Versand</th>
            <th class="text-right">Gesamt</th>
            <th>Zustand</th>
            <th>Bewertungen</th>
            <th></th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="7" class="text-center text-muted" style="padding:32px">Keine Angebote gefunden.</td></tr>`}</tbody>
        </table>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // WEBHOOKS TAB
  // ──────────────────────────────────────────────────────────────────────────
  const _WH_EVENTS = [
    {
      id: "undercut", label: "Günstigster Konkurrent unterboten",
      desc: "Wenn ein Konkurrent deinen Listenpreis unterbietet",
      tag: "ALERT", tagCls: "comp-wh-event-tag-red",
    },
    {
      id: "new_listing", label: "Neues Listing von beobachtetem Verkäufer",
      desc: "Wenn ein überwachter Verkäufer ein neues Angebot einstellt",
      tag: "NEU", tagCls: "comp-wh-event-tag-yellow",
    },
    {
      id: "price_drop", label: "Preis deutlich gesunken",
      desc: "Wenn der Marktpreis eines deiner Produkte stark fällt",
      tag: "PREIS", tagCls: "comp-wh-event-tag-yellow",
    },
    {
      id: "verdict_change", label: "Flipcheck Verdict geändert",
      desc: "Wenn ein Produkt von BUY zu HOLD oder SKIP wechselt",
      tag: "VERDICT", tagCls: "comp-wh-event-tag-accent",
    },
    {
      id: "new_seller", label: "Neuer Konkurrent aufgetaucht",
      desc: "Wenn ein neuer Anbieter für dein Produkt erscheint",
      tag: "KONKURRENZ", tagCls: "comp-wh-event-tag-accent",
    },
  ];

  async function renderWebhookPanelAsync() {
    const status = await Storage.monitorStatus();
    _container.querySelector("#compContent").innerHTML = renderWebhookPanel(status);
    bindWebhookPanel(_container);
  }

  function renderWebhookPanel(monStatus = null) {
    const urlVal = esc(_wh.url || "");
    const hasUrl = !!_wh.url;

    const eventRows = _WH_EVENTS.map(ev => `
      <label class="comp-wh-event">
        <input type="checkbox" data-wh-event="${ev.id}" ${_wh.events[ev.id] ? "checked" : ""}/>
        <div class="comp-wh-event-info">
          <div class="comp-wh-event-label">${ev.label}</div>
          <div class="comp-wh-event-desc">${ev.desc}</div>
        </div>
        <span class="comp-wh-event-tag ${ev.tagCls}">${ev.tag}</span>
      </label>
    `).join("");

    return `
      <div class="comp-wh-panel" style="width:100%">

        <!-- URL Section -->
        <div class="comp-wh-section">
          <div class="comp-wh-section-hdr">
            <span class="comp-wh-section-title">Discord Webhook URL</span>
            <span class="comp-wh-status ${hasUrl ? "comp-wh-status-ok" : "comp-wh-status-idle"}" id="whStatusPill">
              ${hasUrl ? "● Gespeichert" : "○ Nicht konfiguriert"}
            </span>
          </div>
          <div class="comp-wh-section-body">
            <div class="comp-wh-url-row">
              <input class="input" id="whUrlInput" type="text"
                placeholder="https://discord.com/api/webhooks/…"
                value="${urlVal}" autocomplete="off" spellcheck="false"/>
              <button class="btn btn-primary btn-sm" id="btnSaveWh" style="white-space:nowrap">Speichern</button>
              <button class="btn btn-secondary btn-sm" id="btnTestWh" style="white-space:nowrap" ${hasUrl ? "" : "disabled"}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Test
              </button>
            </div>
            <p class="text-xs text-muted" style="margin:0">
              Discord: Server-Einstellungen → Integrationen → Webhooks → Neuer Webhook → URL kopieren.
            </p>
          </div>
        </div>

        <!-- Events Section -->
        <div class="comp-wh-section">
          <div class="comp-wh-section-hdr">
            <span class="comp-wh-section-title">Benachrichtigungen</span>
            <span class="text-xs text-muted">Wähle welche Ereignisse eine Nachricht auslösen</span>
          </div>
          <div class="comp-wh-section-body" style="padding:6px 8px">
            <div class="comp-wh-events">${eventRows}</div>
          </div>
        </div>

        <!-- Monitor Status Section -->
        <div class="comp-wh-section">
          <div class="comp-wh-section-hdr">
            <span class="comp-wh-section-title">Hintergrund-Monitor</span>
            ${monStatus
              ? `<span class="comp-wh-status ${monStatus.active ? "comp-wh-status-ok" : "comp-wh-status-idle"}">
                   ${monStatus.active ? "● Aktiv" : "○ Gestoppt"}
                 </span>`
              : `<span class="comp-wh-status comp-wh-status-idle">○ Wird geladen…</span>`
            }
          </div>
          <div class="comp-wh-section-body">
            <div class="grid-2-md mb-4">
              <div>
                <div class="text-xs text-muted" style="margin-bottom:4px">Letzter Check</div>
                <div class="font-semibold" style="font-size:13px" id="monLastRun">
                  ${monStatus?.lastRun
                    ? `vor ${timeSinceStatic(monStatus.lastRun)}`
                    : "—"
                  }
                </div>
              </div>
              <div>
                <div class="text-xs text-muted" style="margin-bottom:4px">Prüf-Intervall</div>
                <select class="input" id="monIntervalSelect" style="font-size:12px;padding:4px 8px">
                  <option value="5"  ${(monStatus?.intervalMin||15)===5  ?"selected":""}>alle 5 Min.</option>
                  <option value="10" ${(monStatus?.intervalMin||15)===10 ?"selected":""}>alle 10 Min.</option>
                  <option value="15" ${(monStatus?.intervalMin||15)===15 ?"selected":""}>alle 15 Min.</option>
                  <option value="30" ${(monStatus?.intervalMin||15)===30 ?"selected":""}>alle 30 Min.</option>
                  <option value="60" ${(monStatus?.intervalMin||15)===60 ?"selected":""}>stündlich</option>
                </select>
              </div>
            </div>
            <p class="text-xs text-muted" style="margin:0">
              Der Monitor läuft im Hintergrund — auch wenn die App minimiert ist.
              Ohne Webhook-URL werden keine Checks ausgeführt.
            </p>
          </div>
        </div>

        <!-- Embed Preview Section -->
        <div class="comp-wh-section">
          <div class="comp-wh-section-hdr">
            <span class="comp-wh-section-title">Discord Embed Vorschau</span>
            <span class="text-xs text-muted">So sieht die Benachrichtigung aus</span>
          </div>
          <div class="comp-wh-section-body">
            ${renderEmbedPreview()}
          </div>
        </div>

      </div>
    `;
  }

  function renderEmbedPreview(eventId = "undercut", data = {}) {
    const presets = {
      undercut: {
        color: "#EF4444", icon: "⚠️",
        title: "Günstigster Konkurrent unterboten",
        fields: [
          { name: "Dein VK",       value: data.myPrice   ? fmtEur(data.myPrice)   : "€89.99" },
          { name: "Konkurrent",    value: data.cheapest  ? fmtEur(data.cheapest)  : "€84.50" },
          { name: "Differenz",     value: data.myPrice && data.cheapest ? fmtEur(data.myPrice - data.cheapest) : "€5.49" },
        ],
        product: data.product || "Samsung UE43TU7090 43\" 4K",
      },
      new_listing: {
        color: "#F59E0B", icon: "🆕",
        title: "Neues Listing von beobachtetem Verkäufer",
        fields: [
          { name: "Verkäufer",    value: "@top-seller-de" },
          { name: "Preis",        value: "€45.00" },
          { name: "Listings ges.",value: "142" },
        ],
        product: "MacBook Pro Ladekabel USB-C",
      },
      price_drop: {
        color: "#F59E0B", icon: "📉",
        title: "Preis deutlich gesunken",
        fields: [
          { name: "Vorher",       value: "€59.99" },
          { name: "Jetzt",        value: "€44.90" },
          { name: "Veränderung",  value: "−25%" },
        ],
        product: "Bosch Akkuschrauber PSR 14",
      },
      verdict_change: {
        color: "#6366F1", icon: "🔄",
        title: "Flipcheck Verdict geändert",
        fields: [
          { name: "Vorher",       value: "BUY" },
          { name: "Jetzt",        value: "HOLD" },
          { name: "Profit",       value: "+€2.10" },
        ],
        product: "LEGO Technic 42161",
      },
      new_seller: {
        color: "#6366F1", icon: "👤",
        title: "Neuer Konkurrent aufgetaucht",
        fields: [
          { name: "Verkäufer",    value: "@new-reseller" },
          { name: "Preis",        value: "€79.99" },
          { name: "Anbieter ges.",value: "8" },
        ],
        product: "Dyson V11 Staubsauger",
      },
    };
    const p = presets[eventId] || presets.undercut;
    const fieldsHtml = p.fields.map(f => `
      <div class="comp-wh-embed-field">
        <div class="comp-wh-embed-field-name">${f.name}</div>
        <div class="comp-wh-embed-field-value">${f.value}</div>
      </div>
    `).join("");
    const now = new Date().toLocaleString("de-DE", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
    return `
      <div class="comp-wh-embed-wrap">
        <div class="comp-wh-embed">
          <div class="comp-wh-embed-bar" style="background:${p.color}"></div>
          <div class="comp-wh-embed-content">
            <div class="comp-wh-embed-author">
              <span style="font-size:14px">▲</span> FLIPCHECK
            </div>
            <div class="comp-wh-embed-title">${p.icon} ${p.title}</div>
            <div style="font-size:12px;color:#b5bac1;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.product)}</div>
            <div class="comp-wh-embed-grid">${fieldsHtml}</div>
            <div class="comp-wh-embed-footer">Flipcheck · ${now}</div>
          </div>
        </div>
      </div>

      <!-- Preview event selector -->
      <div style="margin-top:10px;display:flex;align-items:center;gap:8px">
        <span class="text-xs text-muted">Vorschau für:</span>
        <select class="input" id="whPreviewSelect" style="font-size:11px;padding:4px 8px;width:auto">
          ${_WH_EVENTS.map(e => `<option value="${e.id}" ${e.id===eventId?"selected":""}>${e.label}</option>`).join("")}
        </select>
      </div>
    `;
  }

  function bindWebhookPanel(container) {
    const c = container;

    // Save URL
    c.querySelector("#btnSaveWh")?.addEventListener("click", async () => {
      const url = c.querySelector("#whUrlInput")?.value.trim() || "";
      _wh.url = url;
      await Storage.saveSettings({ webhook_url: url, webhook_events: _wh.events });
      const pill = c.querySelector("#whStatusPill");
      if (pill) {
        pill.className = `comp-wh-status ${url ? "comp-wh-status-ok" : "comp-wh-status-idle"}`;
        pill.textContent = url ? "● Gespeichert" : "○ Nicht konfiguriert";
      }
      const testBtn = c.querySelector("#btnTestWh");
      if (testBtn) testBtn.disabled = !url;
      updateStatsBar();
      Toast.success("Gespeichert", url ? "Webhook URL gespeichert." : "Webhook URL geleert.");
    });

    // Test webhook
    c.querySelector("#btnTestWh")?.addEventListener("click", async () => {
      const btn = c.querySelector("#btnTestWh");
      if (!_wh.url) { Toast.error("Kein URL", "Bitte erst eine Webhook-URL eintragen."); return; }
      btn.disabled = true;
      btn.textContent = "Sende…";
      try {
        await fireWebhook("undercut", {
          product: "Samsung UE43TU7090 43\" — Testbenachrichtigung",
          myPrice: 89.99, cheapest: 84.50, total: 7,
        });
        Toast.success("Test gesendet", "Benachrichtigung wurde an Discord gesendet.");
      } catch (e) {
        ErrorReporter.report(e, "competition:webhookTest");
        Toast.error("Webhook-Fehler", e.message || "Test-Nachricht konnte nicht gesendet werden.");
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Test`;
      }
    });

    // Event checkboxes
    c.querySelectorAll("[data-wh-event]").forEach(cb => {
      cb.addEventListener("change", async () => {
        _wh.events[cb.dataset.whEvent] = cb.checked;
        await Storage.saveSettings({ webhook_url: _wh.url, webhook_events: _wh.events });
      });
    });

    // Monitor interval change
    c.querySelector("#monIntervalSelect")?.addEventListener("change", async e => {
      const min = parseInt(e.target.value);
      await Storage.setMonitorInterval(min);
      Toast.success("Gespeichert", `Monitor läuft jetzt alle ${min} Minuten.`);
    });

    // Preview selector
    const previewSel = c.querySelector("#whPreviewSelect");
    if (previewSel) {
      previewSel.addEventListener("change", () => {
        const embedWrap = previewSel.closest(".comp-wh-section-body");
        if (!embedWrap) return;
        // Re-render just the embed portion
        const embedEl = embedWrap.querySelector(".comp-wh-embed-wrap");
        if (embedEl) {
          const newHtml = document.createElement("div");
          newHtml.innerHTML = renderEmbedPreview(previewSel.value);
          const newWrap = newHtml.querySelector(".comp-wh-embed-wrap");
          if (newWrap) embedEl.replaceWith(newWrap);
        }
        // Keep the select with the same value
        const newSel = embedWrap.querySelector("#whPreviewSelect");
        if (newSel) newSel.value = previewSel.value;
        // Re-bind (only needs the preview select handler)
        bindWebhookPanel(container);
      });
    }
  }

  // ── Webhook Fire ──────────────────────────────────────────────────────────
  async function fireWebhook(eventId, data = {}) {
    if (!_wh.url) return;
    const colors = { undercut: 0xEF4444, new_listing: 0xF59E0B, price_drop: 0xF59E0B, verdict_change: 0x6366F1, new_seller: 0x6366F1 };
    const icons  = { undercut: "⚠️", new_listing: "🆕", price_drop: "📉", verdict_change: "🔄", new_seller: "👤" };
    const labels = {
      undercut:       "Günstigster Konkurrent unterboten",
      new_listing:    "Neues Listing von beobachtetem Verkäufer",
      price_drop:     "Preis deutlich gesunken",
      verdict_change: "Flipcheck Verdict geändert",
      new_seller:     "Neuer Konkurrent aufgetaucht",
    };

    const productName = data.product || data.item?.title || data.item?.ean || "Unbekanntes Produkt";
    const fields = [];

    if (eventId === "undercut") {
      if (data.myPrice  != null) fields.push({ name: "Dein VK",     value: fmtEur(data.myPrice),  inline: true });
      if (data.cheapest != null) fields.push({ name: "Konkurrent",  value: fmtEur(data.cheapest), inline: true });
      if (data.myPrice  != null && data.cheapest != null)
        fields.push({ name: "Differenz", value: fmtEur(data.myPrice - data.cheapest), inline: true });
      if (data.total    != null) fields.push({ name: "Anbieter",    value: String(data.total),     inline: true });
    } else if (eventId === "new_listing") {
      if (data.username != null) fields.push({ name: "Verkäufer",  value: `@${data.username}`,    inline: true });
      if (data.price    != null) fields.push({ name: "Preis",       value: fmtEur(data.price),     inline: true });
    } else if (eventId === "price_drop") {
      if (data.before   != null) fields.push({ name: "Vorher",     value: fmtEur(data.before),    inline: true });
      if (data.after    != null) fields.push({ name: "Jetzt",       value: fmtEur(data.after),     inline: true });
      if (data.pct      != null) fields.push({ name: "Veränderung", value: `${data.pct.toFixed(1)}%`, inline: true });
    } else if (eventId === "verdict_change") {
      if (data.from     != null) fields.push({ name: "Vorher",     value: data.from,               inline: true });
      if (data.to       != null) fields.push({ name: "Jetzt",       value: data.to,                 inline: true });
    } else if (eventId === "new_seller") {
      if (data.seller   != null) fields.push({ name: "Verkäufer",  value: `@${data.seller}`,       inline: true });
      if (data.price    != null) fields.push({ name: "Preis",       value: fmtEur(data.price),      inline: true });
      if (data.total    != null) fields.push({ name: "Anbieter ges.", value: String(data.total),    inline: true });
    }

    const payload = {
      username: "Flipcheck",
      avatar_url: "https://api.joinflipcheck.app/static/icon128.png",
      embeds: [{
        color:       colors[eventId] || 0x6366F1,
        author:      { name: "▲ FLIPCHECK" },
        title:       `${icons[eventId] || "🔔"} ${labels[eventId] || eventId}`,
        description: `**${productName}**`,
        fields,
        footer:      { text: `Flipcheck · ${new Date().toLocaleString("de-DE")}` },
        timestamp:   new Date().toISOString(),
      }],
    };

    const r = await fetch(_wh.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok && r.status !== 204) throw new Error(`Discord: HTTP ${r.status}`);
  }

  // ── Shared right-panel helpers ───────────────────────────────────────────
  function renderRightEmpty(title, sub) {
    return `
      <div class="empty-state" style="padding:80px 40px">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <p class="empty-title">${esc(title)}</p>
        <p class="empty-sub">${esc(sub)}</p>
      </div>
    `;
  }

  function renderRightLoading(text) {
    return `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px;gap:14px">
        <div class="spinner"></div>
        <p class="text-secondary text-sm">${esc(text)}</p>
      </div>
    `;
  }

  function renderRightError(msg) {
    return `
      <div class="empty-state" style="padding:60px">
        <p class="empty-title text-red">Fehler</p>
        <p class="empty-sub">${esc(msg)}</p>
      </div>
    `;
  }

  function renderLoadingFull(text) {
    return `
      <div style="display:flex;align-items:center;justify-content:center;padding:120px;gap:14px;flex-direction:column">
        <div class="spinner"></div>
        <p class="text-secondary text-sm">${esc(text)}</p>
      </div>
    `;
  }

  function bindRightRefresh() {
    const c = _container;

    c?.querySelector("[data-refresh-seller]")?.addEventListener("click", e => {
      const username = e.currentTarget.dataset.refreshSeller;
      const inp = c.querySelector("#sellerSearchInput");
      if (inp) inp.value = "";
      loadSellerListings(username, "");
    });

    const searchInp = c?.querySelector("#sellerSearchInput");
    if (searchInp) {
      const doSearch = () => {
        const q = searchInp.value.trim();
        const username = searchInp.dataset.seller;
        loadSellerListings(username, q);
      };
      searchInp.addEventListener("keydown", e => {
        if (e.key === "Enter") { clearTimeout(_debounce); doSearch(); }
      });
      searchInp.addEventListener("input", () => {
        clearTimeout(_debounce);
        _debounce = setTimeout(doSearch, 650);
      });
    }

    c?.querySelector("[data-refresh-inv]")?.addEventListener("click", e => {
      const item = _inventory.find(i => i.id === e.currentTarget.dataset.refreshInv);
      if (item) loadInvCompetition(item);
    });
  }

  // ── Utility ──────────────────────────────────────────────────────────────
  function timeSinceStatic(isoStr) { return timeSince(isoStr); }

  function timeSince(isoStr) {
    const secs = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (secs < 60)    return "gerade eben";
    if (secs < 3600)  return `${Math.floor(secs / 60)} Min.`;
    if (secs < 86400) return `${Math.floor(secs / 3600)} Std.`;
    return `${Math.floor(secs / 86400)} Tagen`;
  }

  return { mount, unmount };
})();
