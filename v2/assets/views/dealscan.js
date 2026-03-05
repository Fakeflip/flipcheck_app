/* Flipcheck v2 — Deal-Scanner View (SSE Streaming) */
const DealScanView = (() => {
  let _container  = null;
  let _results    = [];
  let _evtSource  = null;
  let _scanning   = false;
  let _sortKey    = "score";
  let _filterV    = "all";
  let _source     = "ebay";  // "ebay" | "amazon"

  // eBay scan categories
  const EBAY_CATS = [
    { id: "gaming",      label: "Gaming",       icon: "🎮" },
    { id: "smartphones", label: "Smartphones",  icon: "📱" },
    { id: "audio",       label: "Audio",        icon: "🎧" },
    { id: "foto",        label: "Foto & Video", icon: "📷" },
    { id: "spielzeug",   label: "Spielzeug",    icon: "🧸" },
    { id: "sport",       label: "Sport",        icon: "🏃" },
    { id: "computer",    label: "Computer",     icon: "💻" },
  ];

  // Amazon categories — must match AMZ_SCAN_CATS keys in backend
  const AMZ_CATS = [
    { id: "gaming",     label: "Gaming",     icon: "🎮" },
    { id: "elektronik", label: "Elektronik", icon: "⚡" },
    { id: "computer",   label: "Computer",   icon: "💻" },
    { id: "spielzeug",  label: "Spielzeug",  icon: "🧸" },
    { id: "sport",      label: "Sport",      icon: "🏃" },
  ];

  let _selectedCats    = new Set(EBAY_CATS.map(c => c.id));
  let _selectedAmzCats = new Set(AMZ_CATS.map(c => c.id));

  function _activeCats()     { return _source === "amazon" ? AMZ_CATS : EBAY_CATS; }
  function _activeSelected() { return _source === "amazon" ? _selectedAmzCats : _selectedCats; }
  function _dealId(deal)     { return deal.item_id || deal.asin || String(deal.rank); }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  function mount(container) {
    _container = container;
    _results   = [];
    _scanning  = false;
    _sortKey   = "score";
    _filterV   = "all";
    container.innerHTML = renderView();
    attachEvents(container);
  }

  function unmount() {
    if (_evtSource) { _evtSource.close(); _evtSource = null; }
    _scanning  = false;
    _container = null;
  }

  // ── Render: shell ────────────────────────────────────────────────────────
  function renderView() {
    const isAmz = _source === "amazon";
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Deal-Scanner</h1>
          <p id="dsSubtitle">${isAmz
            ? "Findet Amazon-Preisdrops und prüft den eBay-Resale-Gewinn"
            : "Scannt eBay automatisch nach profitablen Produkten in deinem Budget"}</p>
        </div>
      </div>

      <div class="fc-split-290">

        <!-- ─── Left: Config ─────────────────────────────────── -->
        <div style="position:sticky;top:20px">

          <!-- Source toggle -->
          <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:3px;display:flex;gap:3px;margin-bottom:12px" id="dsSrcToggle">
            <button class="ds-src-btn ${!isAmz ? "active" : ""}" data-src="ebay">🛒 eBay</button>
            <button class="ds-src-btn ${isAmz  ? "active" : ""}" data-src="amazon">📦 Amazon</button>
          </div>

          <div class="panel mb-12">
            <h3 class="panel-title">Scanner</h3>
            <div class="col gap-10">

              <div class="input-group">
                <label class="input-label">Budget</label>
                <div class="input-prefix-wrap">
                  <span class="prefix">€</span>
                  <input id="dsBudget" class="input" type="number" step="5" min="5" value="${isAmz ? 150 : 100}"/>
                </div>
                <span class="input-hint">Max. Einkaufspreis pro Artikel</span>
              </div>

              <div class="grid-2-sm">
                <div class="input-group">
                  <label class="input-label">Min. Margin</label>
                  <div class="input-prefix-wrap">
                    <span class="prefix">%</span>
                    <input id="dsMinMargin" class="input" type="number" step="1" min="1" max="100" value="20"/>
                  </div>
                </div>
                <div class="input-group">
                  <label class="input-label">Min. ROI</label>
                  <div class="input-prefix-wrap">
                    <span class="prefix">%</span>
                    <input id="dsMinRoi" class="input" type="number" step="1" min="1" max="500" value="15"/>
                  </div>
                </div>
              </div>

              <!-- Amazon-only: Min. Preisdrop -->
              <div class="input-group" id="dsDropRow" style="display:${isAmz ? "block" : "none"}">
                <label class="input-label">Min. Preisdrop</label>
                <div class="input-prefix-wrap">
                  <span class="prefix">%</span>
                  <input id="dsMinDrop" class="input" type="number" step="1" min="5" max="80" value="15"/>
                </div>
                <span class="input-hint">Unter 90-Tage-Schnitt (Amazon)</span>
              </div>

              <div class="grid-2-sm">
                <div class="input-group">
                  <label class="input-label">Max. Deals</label>
                  <select id="dsLimit" class="select">
                    <option value="10">10</option>
                    <option value="15" selected>15</option>
                    <option value="20">20</option>
                    <option value="30">30</option>
                  </select>
                </div>
                <div class="input-group">
                  <label class="input-label">Modus</label>
                  <select id="dsMode" class="select">
                    <option value="mid" selected>Standard</option>
                    <option value="high">Konservativ</option>
                    <option value="low">Aggressiv</option>
                  </select>
                </div>
              </div>

            </div>
          </div>

          <!-- Category chips -->
          <div class="panel mb-12">
            <div class="row-between mb-10">
              <h3 class="panel-title" style="margin:0">Kategorien</h3>
              <button class="btn btn-ghost btn-sm" id="btnDsToggleAll" style="font-size:10px;padding:2px 8px">Alle</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px" id="dsCatChips">
              ${renderCatChips()}
            </div>
          </div>

          <button class="btn btn-primary" id="btnDsScan" style="width:100%;justify-content:center;height:40px">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="margin-right:6px">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M10.5 10.5L14.5 14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            Scan starten
          </button>
          <button class="btn btn-ghost" id="btnDsStop" style="width:100%;justify-content:center;margin-top:6px;display:none">
            Abbrechen
          </button>
        </div>

        <!-- ─── Right: Results ─────────────────────────────────── -->
        <div>
          <!-- Progress bar -->
          <div id="dsScanStatus" class="panel mb-12" style="padding:12px 16px;display:none">
            <div class="row-between mb-8">
              <div class="row gap-8">
                <div class="ds-pulse"></div>
                <span class="text-sm font-semibold text-primary" id="dsStatusText">Suche läuft…</span>
              </div>
              <span class="text-xs text-muted" id="dsFoundCount">0 gefunden</span>
            </div>
            <div class="ds-progress-track">
              <div class="ds-progress-bar" id="dsProgressBar" style="width:0%"></div>
            </div>
          </div>

          <!-- Sort + filter bar -->
          <div id="dsSortBar" class="row-between mb-12" style="display:none">
            <div class="row gap-5">
              <span class="text-xs text-muted" style="white-space:nowrap">Sort:</span>
              ${[
                { k:"score",   l:"Score ↓"  },
                { k:"profit",  l:"Profit ↓" },
                { k:"roi_pct", l:"ROI ↓"    },
                { k:"ek",      l:"EK ↑"     },
              ].map(s => `<button class="ds-sort-btn ${s.k === "score" ? "active" : ""}" data-sort="${s.k}">${s.l}</button>`).join("")}
            </div>
            <div class="row gap-4">
              ${["all","BUY","HOLD"].map(v => `
                <button class="ds-filter-btn ${v === "all" ? "active" : ""}" data-filter="${v}">
                  ${v === "all" ? "Alle" : v}
                </button>
              `).join("")}
            </div>
          </div>

          <div id="dsResults">${renderEmpty()}</div>
        </div>
      </div>
    `;
  }

  function renderCatChips() {
    const cats = _activeCats();
    const sel  = _activeSelected();
    return cats.map(c => `
      <button class="ds-cat-chip ${sel.has(c.id) ? "active" : ""}" data-cat="${c.id}">
        <span style="font-size:12px">${c.icon}</span> ${c.label}
      </button>
    `).join("");
  }

  // ── Render: empty state ──────────────────────────────────────────────────
  function renderEmpty() {
    return `
      <div class="empty-state" style="padding:80px 40px">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <path d="M2 12C2 12 5 5 12 5s10 7 10 7-3 7-10 7S2 12 2 12z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <p class="empty-title">Bereit zum Scannen</p>
        <p class="empty-sub">Kategorie wählen, Budget setzen, Scan starten.</p>
      </div>
    `;
  }

  // ── Score ring ───────────────────────────────────────────────────────────
  function renderScoreRing(score) {
    const s     = Math.min(100, Math.max(0, score || 0));
    const color = s >= 70 ? "#10B981" : s >= 45 ? "#F59E0B" : "#EF4444";
    const circ  = 2 * Math.PI * 16;  // r=16 → exact circumference ≈ 100.53
    const dash  = (s / 100) * circ;
    return `
      <svg width="44" height="44" viewBox="0 0 44 44" style="flex-shrink:0">
        <circle cx="22" cy="22" r="16" fill="none" stroke="var(--bg-elevated)" stroke-width="3.5"/>
        <circle cx="22" cy="22" r="16" fill="none" stroke="${color}" stroke-width="3.5"
          stroke-dasharray="${dash.toFixed(2)} ${circ.toFixed(2)}"
          stroke-linecap="round" transform="rotate(-90 22 22)"/>
        <text x="22" y="27" text-anchor="middle" font-size="11" font-weight="700"
          fill="${color}" font-family="Inter,sans-serif">${Math.round(s)}</text>
      </svg>
    `;
  }

  // ── Deal card ────────────────────────────────────────────────────────────
  function renderDealCard(deal) {
    const isAmz  = deal.source === "amazon";
    const dealId = _dealId(deal);
    const vc     = (deal.verdict || "HOLD").toUpperCase();
    const bc     = vc === "BUY" ? "badge-green" : vc === "HOLD" ? "badge-yellow" : "badge-red";
    const pc     = deal.profit > 0 ? "var(--green)" : deal.profit < 0 ? "var(--red)" : "";

    const imgHtml = deal.image_url
      ? `<img src="${esc(deal.image_url)}" alt="" class="ds-card-img" loading="lazy" onerror="this.style.display='none'">`
      : `<div class="ds-card-img ds-card-img-fallback">
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5">
             <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
           </svg>
         </div>`;

    const chips = [
      isAmz && deal.drop_pct   != null ? `<span class="ds-chip ds-chip-accent">▼ ${deal.drop_pct.toFixed(1)}% Drop</span>` : "",
      isAmz && deal.avg90_price != null ? `<span class="ds-chip">Ø ${fmtEur(deal.avg90_price)}</span>` : "",
      deal.sales_30d   != null          ? `<span class="ds-chip">📊 ${deal.sales_30d}/Mo</span>` : "",
      deal.days_to_cash != null         ? `<span class="ds-chip">⚡ ~${deal.days_to_cash}d</span>` : "",
      !isAmz && deal.offer_count != null ? `<span class="ds-chip">🏷 ${deal.offer_count} Ang.</span>` : "",
      isAmz
        ? `<span class="ds-chip">📦 Amazon</span>`
        : (deal.has_research ? `<span class="ds-chip ds-chip-accent">Research</span>` : `<span class="ds-chip">Browse</span>`),
    ].filter(Boolean).join("");

    const linkLabel = isAmz ? "Amazon" : "eBay";
    const linkUrl   = deal.item_url || (isAmz && deal.asin ? `https://www.amazon.de/dp/${deal.asin}` : null);

    return `
      <div class="deal-card" data-item="${esc(dealId)}" data-verdict="${vc}">

        <!-- Top: image + title + score -->
        <div class="row gap-10 mb-10">
          ${imgHtml}
          <div style="flex:1;min-width:0">
            <div class="ds-card-title" title="${esc(deal.title)}">${esc(deal.title || deal.ean || "—")}</div>
            <div class="row gap-6 mt-4">
              <span class="badge ${bc}" style="font-size:10px;padding:2px 7px">${vc}</span>
              ${deal.ean ? `<span class="text-xs text-muted" style="font-variant-numeric:tabular-nums">${esc(deal.ean)}</span>` : ""}
            </div>
          </div>
          ${renderScoreRing(deal.score)}
        </div>

        <!-- KPI grid -->
        <div class="ds-kpi-grid mb-10">
          <div class="ds-kpi">
            <div class="ds-kpi-lbl">${isAmz ? "Amazon EK" : "Kaufpreis"}</div>
            <div class="ds-kpi-val">${fmtEur(deal.ek)}</div>
          </div>
          <div class="ds-kpi">
            <div class="ds-kpi-lbl">eBay VK</div>
            <div class="ds-kpi-val">${fmtEur(deal.sell_price)}</div>
          </div>
          <div class="ds-kpi">
            <div class="ds-kpi-lbl">Profit</div>
            <div class="ds-kpi-val" style="color:${pc}">${fmtEur(deal.profit)}</div>
          </div>
          <div class="ds-kpi">
            <div class="ds-kpi-lbl">ROI</div>
            <div class="ds-kpi-val">${fmtPct(deal.roi_pct ?? deal.roi)}</div>
          </div>
        </div>

        <!-- Meta chips -->
        ${chips ? `<div class="row" style="flex-wrap:wrap;gap:5px;margin-bottom:10px">${chips}</div>` : ""}

        <!-- Actions -->
        <div class="row" style="gap:6px;margin-top:auto">
          <button class="btn btn-secondary btn-sm" style="flex:1;justify-content:center" data-add-deal="${esc(dealId)}">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="5" width="14" height="10" rx="1" stroke="currentColor" stroke-width="1.5"/>
              <path d="M6 10h4M8 8v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            Inventory
          </button>
          ${linkUrl ? `
            <a href="${esc(linkUrl)}" class="btn btn-ghost btn-sm" style="gap:4px" target="_blank">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <path d="M10 3H13V6M13 3L7 9M6 4H3v9h9v-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              ${linkLabel}
            </a>` : ""}
        </div>
      </div>
    `;
  }

  // ── Events ───────────────────────────────────────────────────────────────
  function attachEvents(container) {
    container.querySelector("#btnDsScan")?.addEventListener("click", () => startScan(container));
    container.querySelector("#btnDsStop")?.addEventListener("click", () => stopScan(container));

    // Source toggle
    container.querySelector("#dsSrcToggle")?.addEventListener("click", e => {
      const btn = e.target.closest(".ds-src-btn");
      if (!btn || btn.dataset.src === _source) return;
      _source = btn.dataset.src;

      // Button states
      container.querySelectorAll(".ds-src-btn").forEach(b => b.classList.toggle("active", b === btn));

      // Subtitle
      const sub = container.querySelector("#dsSubtitle");
      if (sub) sub.textContent = _source === "amazon"
        ? "Findet Amazon-Preisdrops und prüft den eBay-Resale-Gewinn"
        : "Scannt eBay automatisch nach profitablen Produkten in deinem Budget";

      // Show/hide drop input
      const dropRow = container.querySelector("#dsDropRow");
      if (dropRow) dropRow.style.display = _source === "amazon" ? "block" : "none";

      // Budget default (only if not yet edited by user)
      const budgetInp = container.querySelector("#dsBudget");
      if (budgetInp && !budgetInp._touched) budgetInp.value = _source === "amazon" ? 150 : 100;

      // Re-render category chips
      const chipsEl = container.querySelector("#dsCatChips");
      if (chipsEl) chipsEl.innerHTML = renderCatChips();
    });

    // Track if user has manually changed budget
    container.querySelector("#dsBudget")?.addEventListener("input", e => { e.target._touched = true; });

    // Category chips
    container.querySelector("#dsCatChips")?.addEventListener("click", e => {
      const chip = e.target.closest("[data-cat]");
      if (!chip) return;
      const sel = _activeSelected();
      const cat = chip.dataset.cat;
      if (sel.has(cat)) { sel.delete(cat); chip.classList.remove("active"); }
      else              { sel.add(cat);    chip.classList.add("active"); }
    });

    // Toggle all
    container.querySelector("#btnDsToggleAll")?.addEventListener("click", () => {
      const cats = _activeCats();
      const sel  = _activeSelected();
      if (sel.size === cats.length) {
        sel.clear();
        container.querySelectorAll(".ds-cat-chip").forEach(c => c.classList.remove("active"));
      } else {
        cats.forEach(c => sel.add(c.id));
        container.querySelectorAll(".ds-cat-chip").forEach(c => c.classList.add("active"));
      }
    });
  }

  function attachSortFilterEvents(container) {
    container.querySelectorAll(".ds-sort-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        _sortKey = btn.dataset.sort;
        container.querySelectorAll(".ds-sort-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        rerenderGrid(container);
      });
    });
    container.querySelectorAll(".ds-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        _filterV = btn.dataset.filter;
        container.querySelectorAll(".ds-filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        rerenderGrid(container);
      });
    });
  }

  // ── Scan ─────────────────────────────────────────────────────────────────
  function startScan(container) {
    if (_scanning) return;
    const sel = _activeSelected();
    if (sel.size === 0) { Toast.warning("Kategorien", "Bitte mind. eine Kategorie wählen."); return; }

    const budget    = parseFloat(container.querySelector("#dsBudget")?.value)    || (_source === "amazon" ? 150 : 100);
    const minMargin = parseFloat(container.querySelector("#dsMinMargin")?.value)  || 20;
    const minRoi    = parseFloat(container.querySelector("#dsMinRoi")?.value)     || 15;
    const minDrop   = parseFloat(container.querySelector("#dsMinDrop")?.value)    || 15;
    const limit     = parseInt(container.querySelector("#dsLimit")?.value)        || 15;
    const mode      = container.querySelector("#dsMode")?.value                   || "mid";

    _results  = [];
    _scanning = true;

    const btnScan   = container.querySelector("#btnDsScan");
    const btnStop   = container.querySelector("#btnDsStop");
    const statusEl  = container.querySelector("#dsScanStatus");
    const sortBar   = container.querySelector("#dsSortBar");
    const resultsEl = container.querySelector("#dsResults");

    if (btnScan)   btnScan.disabled = true;
    if (btnStop)   btnStop.style.display = "flex";
    if (statusEl)  statusEl.style.display = "block";
    if (sortBar)   sortBar.style.display = "none";
    if (resultsEl) resultsEl.innerHTML = `<div class="deal-grid" id="dsGrid"></div>`;
    updateProgress(0, limit);

    // Build SSE URL
    const base = App.backendBase || "http://127.0.0.1:9000";
    let endpoint, params;

    if (_source === "amazon") {
      endpoint = `${base}/deals/amazon/stream`;
      params   = new URLSearchParams({
        budget, min_margin: minMargin, min_roi: minRoi,
        min_drop_pct: minDrop, limit,
        categories: [...sel].join(","), mode,
      });
    } else {
      endpoint = `${base}/deals/stream`;
      params   = new URLSearchParams({
        budget, min_margin: minMargin, min_roi: minRoi,
        limit, categories: [...sel].join(","), mode,
      });
    }

    _evtSource = new EventSource(`${endpoint}?${params}`);

    _evtSource.onmessage = e => {
      try {
        const deal = JSON.parse(e.data);
        _results.push(deal);
        appendDealCard(deal, container);
        updateProgress(_results.length, limit);
      } catch {}
    };

    _evtSource.addEventListener("done", () => finishScan(container));
    _evtSource.onerror = () => {
      if (!_evtSource || !_scanning) return;
      finishScan(container, _results.length === 0);
    };
  }

  function stopScan(container) {
    if (_evtSource) { _evtSource.close(); _evtSource = null; }
    _scanning = false;
    if (_results.length > 0) {
      Toast.info("Abgebrochen", `${_results.length} Deal${_results.length !== 1 ? "s" : ""} vor Abbruch gefunden.`);
      finishScan(container, false);
    } else {
      const btnScan  = container?.querySelector("#btnDsScan");
      const btnStop  = container?.querySelector("#btnDsStop");
      const statusEl = container?.querySelector("#dsScanStatus");
      if (btnScan)  btnScan.disabled = false;
      if (btnStop)  btnStop.style.display = "none";
      if (statusEl) statusEl.style.display = "none";
    }
  }

  function finishScan(container, isError = false) {
    if (_evtSource) { _evtSource.close(); _evtSource = null; }
    _scanning = false;

    const btnScan     = container?.querySelector("#btnDsScan");
    const btnStop     = container?.querySelector("#btnDsStop");
    const statusEl    = container?.querySelector("#dsScanStatus");
    const sortBar     = container?.querySelector("#dsSortBar");
    const progressBar = container?.querySelector("#dsProgressBar");

    if (btnScan)     btnScan.disabled = false;
    if (btnStop)     btnStop.style.display = "none";
    if (statusEl)    statusEl.style.display = "none";
    if (progressBar) progressBar.style.width = "100%";

    if (isError) {
      const resultsEl = container?.querySelector("#dsResults");
      if (resultsEl) resultsEl.innerHTML = `
        <div class="empty-state" style="padding:60px">
          <p class="empty-title">Backend nicht erreichbar</p>
          <p class="empty-sub">Stelle sicher, dass das Backend läuft.</p>
        </div>`;
      ErrorReporter.report(new Error("Deal-Scanner: Backend nicht erreichbar"), "dealscan:scan");
      Toast.error("Verbindungsfehler", "Backend nicht erreichbar. Bitte Verbindung prüfen.");
      return;
    }

    if (_results.length > 0) {
      if (sortBar) { sortBar.style.display = "flex"; attachSortFilterEvents(container); }
      Toast.success("Scan abgeschlossen", `${_results.length} Deal${_results.length !== 1 ? "s" : ""} gefunden.`);
    } else {
      const resultsEl = container?.querySelector("#dsResults");
      if (resultsEl) resultsEl.innerHTML = `
        <div class="empty-state" style="padding:60px">
          <p class="empty-title">Keine Deals gefunden</p>
          <p class="empty-sub">Budget erhöhen oder Mindestkriterien senken.</p>
        </div>`;
      Toast.info("Scan abgeschlossen", "Keine Deals gefunden.");
    }
  }

  // ── Grid helpers ─────────────────────────────────────────────────────────
  function appendDealCard(deal, container) {
    const grid = container.querySelector("#dsGrid");
    if (!grid) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = renderDealCard(deal);
    const card = wrap.firstElementChild;
    card.style.animation = "dsCardIn 0.25s ease";
    grid.appendChild(card);
    bindCardBtn(card);
  }

  function rerenderGrid(container) {
    const resultsEl = container?.querySelector("#dsResults");
    if (!resultsEl) return;
    let list = [..._results];
    if (_filterV !== "all") list = list.filter(d => (d.verdict || "HOLD") === _filterV);
    const asc = _sortKey === "ek";
    list.sort((a, b) => asc ? a[_sortKey] - b[_sortKey] : b[_sortKey] - a[_sortKey]);
    if (!list.length) {
      resultsEl.innerHTML = `<div class="empty-state" style="padding:60px"><p class="empty-title">Keine Deals für diesen Filter</p></div>`;
      return;
    }
    resultsEl.innerHTML = `<div class="deal-grid">${list.map(renderDealCard).join("")}</div>`;
    resultsEl.querySelectorAll("[data-add-deal]").forEach(btn => {
      btn.addEventListener("click", e => handleAddDeal(e.currentTarget));
    });
  }

  function bindCardBtn(card) {
    card.querySelector("[data-add-deal]")?.addEventListener("click", e => handleAddDeal(e.currentTarget));
  }

  async function handleAddDeal(btn) {
    const dealId = btn.dataset.addDeal;
    const deal   = _results.find(d => _dealId(d) === dealId);
    if (!deal) return;
    btn.disabled = true;
    try {
      await Storage.upsertItem({
        ean:    deal.ean    || "",
        title:  deal.title  || "Deal",
        ek:     deal.ek,
        market: deal.source || "ebay",
        status: "IN_STOCK",
        qty:    1,
      });
      Toast.success("Hinzugefügt", `${(deal.title || "Deal").slice(0, 45)} → Inventory`);
      btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><polyline points="2,8 6,12 14,4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> OK`;
      btn.style.opacity = "0.55";
    } catch {
      Toast.error("Inventory-Fehler", "Artikel konnte nicht zum Inventory hinzugefügt werden.");
      btn.disabled = false;
    }
  }

  function updateProgress(found, total) {
    const statusText  = _container?.querySelector("#dsStatusText");
    const foundCount  = _container?.querySelector("#dsFoundCount");
    const progressBar = _container?.querySelector("#dsProgressBar");
    const src = _source === "amazon" ? "Amazon" : "eBay";
    if (statusText)  statusText.textContent  = `${src} wird durchsucht… ${found} / ${total}`;
    if (foundCount)  foundCount.textContent  = `${found} gefunden`;
    if (progressBar) progressBar.style.width = `${Math.min(100, (found / Math.max(1, total)) * 100)}%`;
  }

  // Helpers
  function esc(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function fmtEur(v) { return v != null && !isNaN(v) ? `€${Number(v).toFixed(2)}` : "—"; }
  function fmtPct(v) { return v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : "—"; }

  return { mount, unmount };
})();
