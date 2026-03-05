/* Flipcheck v2 — Analytics View */
const AnalyticsView = (() => {
  let charts = {};
  let _period = "weekly"; // "weekly" | "monthly"

  // Read CSS design tokens at runtime — single source of truth
  const _css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const C = {
    color:  _css("--accent"),   // #6366F1
    green:  _css("--green"),    // #10B981
    yellow: _css("--yellow"),   // #F59E0B
    red:    _css("--red"),      // #EF4444
    text:   _css("--text-muted"),
    font:   _css("--font"),
  };

  // Shared Chart.js palette — driven by CSS tokens (+ purple as 6th color)
  const CHART_PALETTE = [
    _css("--accent"), _css("--green"), _css("--yellow"),
    _css("--red"),    _css("--blue"),  _css("--purple"),
  ];

  // Shared Chart.js grid color — --border token at 60% opacity
  const CHART_GRID = { color: _css("--border") + "99", drawBorder: false };

  // Shared Chart.js tooltip config factory
  const _tooltip = (extra = {}) => ({
    backgroundColor: _css("--bg-elevated"),
    borderColor:     _css("--border-strong"),
    borderWidth:     1,
    titleColor:      _css("--text-primary"),
    bodyColor:       _css("--text-secondary"),
    ...extra,
  });

  // Chart hex colors and market labels come from the shared FC namespace.
  // This eliminates duplication and fixes the historical "amazon" vs "amz" key mismatch.
  const MARKET_COLORS = FC.MARKET_CHART_COLORS;  // { ebay, amz, kaufland, other }

  // CSS badge-class mapping (view-specific — not in FC).
  // Keys match item.market values ("amz", not "amazon").
  const MKT_BADGE = {
    ebay:     "badge-accent",
    amz:      "badge-yellow",
    kaufland: "badge-green",
    other:    "badge-gray",
  };

  // ── Market SVG icons (view-specific markup) ──────────────────────────────
  const MKT_SVG = {
    ebay: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="5" width="14" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
      <path d="M5 5V4a3 3 0 0 1 6 0v1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`,
    amz: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="5" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
      <path d="M5 5V3a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`,
    kaufland: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="3" width="4.5" height="10" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <rect x="5.75" y="1" width="4.5" height="12" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <rect x="10.5" y="5" width="4.5" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/>
    </svg>`,
    other: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/>
      <path d="M8 5v3l2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`,
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  function destroyCharts() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch {} });
    charts = {};
  }

  async function mount(container) {
    container.innerHTML = renderSkeleton();

    let items = [];
    try { items = await Storage.listInventory(); } catch {}

    const stats     = Storage.calcInventoryAnalytics(items);
    const soldItems = items.filter(i => i.status === "SOLD" && i.sell_price && i.ek);
    const extra     = calcExtra(soldItems, stats);

    container.innerHTML = renderView(stats, extra, items.length);

    initCharts(stats, soldItems, container);
    attachPeriodToggle(soldItems, container);

    container.querySelector("#btnRefreshAnalytics")?.addEventListener("click", async () => {
      destroyCharts();
      await mount(container);
    });
  }

  function unmount() { destroyCharts(); _period = "weekly"; }

  // ── Extra metrics (win rate, avg margin, MoM trend, market profit) ────────
  function calcExtra(soldItems) {
    const _rp = i => calcRealProfit(i) ?? 0;

    const winCount  = soldItems.filter(i => _rp(i) > 0).length;
    const winRate   = soldItems.length > 0 ? Math.round(winCount / soldItems.length * 100) : 0;

    const margins   = soldItems
      .map(i => i.ek > 0 ? (_rp(i) / i.ek * 100) : null)
      .filter(v => v != null && isFinite(v));
    const avgMargin = margins.length > 0
      ? Math.round(margins.reduce((a, b) => a + b, 0) / margins.length * 10) / 10
      : 0;

    // Month-over-month profit trend
    const now   = new Date();
    const thisM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevM = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;

    let thisProfit = 0, prevProfit = 0;
    for (const item of soldItems) {
      if (!item.sold_at) continue;
      const d   = new Date(item.sold_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const p   = _rp(item);
      if (key === thisM) thisProfit += p;
      if (key === prevM) prevProfit += p;
    }
    const profitTrend = prevProfit === 0
      ? null
      : Math.round((thisProfit - prevProfit) / Math.abs(prevProfit) * 100);

    // Per-market profit sum
    const marketProfit = {};
    for (const item of soldItems) {
      const mkt = item.market || "ebay";
      marketProfit[mkt] = (marketProfit[mkt] || 0) + _rp(item);
    }

    return { winCount, winRate, avgMargin, profitTrend, thisProfit, prevProfit, marketProfit };
  }

  // ── Period data builders ──────────────────────────────────────────────────
  function calcWeeklyPeriod(soldItems) {
    const weeks = [];
    const now   = new Date();
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now);
      start.setDate(now.getDate() - i * 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      weeks.push({ start, end, label: `KW${String(_isoWeek(start)).padStart(2, "0")}`, profit: 0, revenue: 0, cost: 0 });
    }
    for (const item of soldItems) {
      if (!item.sold_at) continue;
      const d   = new Date(item.sold_at);
      const qty = Math.max(1, item.qty || 1);
      for (const w of weeks) {
        if (d >= w.start && d < w.end) {
          w.profit  += (calcRealProfit(item) ?? 0) * qty;
          w.revenue += (item.sell_price || 0) * qty;
          w.cost    += (item.ek || 0) * qty;
          break;
        }
      }
    }
    return weeks.map(w => ({
      label:   w.label,
      profit:  _rnd(w.profit),
      revenue: _rnd(w.revenue),
      cost:    _rnd(w.cost),
    }));
  }

  function calcMonthlyPeriod(soldItems) {
    const now    = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key:    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label:  d.toLocaleDateString("de-DE", { month: "short", year: "2-digit" }),
        profit: 0, revenue: 0, cost: 0,
      });
    }
    const map = {};
    for (const m of months) map[m.key] = m;
    for (const item of soldItems) {
      if (!item.sold_at) continue;
      const d   = new Date(item.sold_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const qty = Math.max(1, item.qty || 1);
      if (map[key]) {
        map[key].profit  += (calcRealProfit(item) ?? 0) * qty;
        map[key].revenue += (item.sell_price || 0) * qty;
        map[key].cost    += (item.ek || 0) * qty;
      }
    }
    return months.map(m => ({
      label:   m.label,
      profit:  _rnd(m.profit),
      revenue: _rnd(m.revenue),
      cost:    _rnd(m.cost),
    }));
  }

  function _isoWeek(date) {
    const d = new Date(date);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    return Math.ceil((((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1) / 7);
  }
  function _rnd(v) { return Math.round(v * 100) / 100; }

  // ── Skeleton ──────────────────────────────────────────────────────────────
  function renderSkeleton() {
    return `
      <div class="page-header">
        <div class="page-header-left">
          <div class="skeleton" style="width:140px;height:22px;margin-bottom:8px"></div>
          <div class="skeleton" style="width:260px;height:13px"></div>
        </div>
      </div>
      <div class="an-kpi-strip mb-16">
        ${[1,2,3,4,5].map(() => `
          <div class="kpi-card an-kpi-card">
            <div class="skeleton" style="height:14px;width:80px;margin-bottom:14px"></div>
            <div class="skeleton" style="height:28px;width:110px;margin-bottom:10px"></div>
            <div class="skeleton" style="height:11px;width:70px"></div>
          </div>`).join("")}
      </div>
      <div class="grid-2 mb-16">
        <div class="panel"><div class="skeleton" style="height:220px"></div></div>
        <div class="panel"><div class="skeleton" style="height:220px"></div></div>
      </div>
    `;
  }

  // ── Main render ───────────────────────────────────────────────────────────
  function renderView(s, extra, totalCount) {
    const profitColor = s.totalProfit > 0 ? "text-green" : s.totalProfit < 0 ? "text-red" : "text-secondary";
    const marginColor = extra.avgMargin >= 20 ? "text-green" : extra.avgMargin >= 10 ? "text-yellow" : "text-secondary";
    const winColor    = extra.winRate >= 70 ? "text-green" : extra.winRate >= 50 ? "text-yellow" : "text-secondary";
    const winLabel    = extra.winRate >= 70 ? "Stark" : extra.winRate >= 50 ? "Gut" : s.soldCount > 0 ? "Verbesserbar" : "—";
    const marginLabel = extra.avgMargin >= 20 ? "Exzellent" : extra.avgMargin >= 10 ? "Gut" : s.soldCount > 0 ? "Ausbaufähig" : "—";

    // MoM trend badge with SVG arrow
    const trendBadge = extra.profitTrend === null ? "" : (() => {
      const up = extra.profitTrend >= 0;
      return `<span class="an-trend ${up ? "up" : "down"}">
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
          ${up
            ? `<path d="M2 8L8 2M8 2H4M8 2v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
            : `<path d="M2 2L8 8M8 8H4M8 8V4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
          }
        </svg>
        ${Math.abs(extra.profitTrend)}% MoM
      </span>`;
    })();

    return `
      <!-- Page Header -->
      <div class="page-header">
        <div class="page-header-left">
          <h1>Analytics</h1>
          <p>${s.soldCount} verkauft · ${s.activeCount} aktiv · ${totalCount} gesamt</p>
        </div>
        <div class="page-header-right">
          <div class="analytics-period-toggle">
            <button class="seg-btn ${_period === "weekly" ? "active" : ""}" data-period="weekly">Wöchentlich</button>
            <button class="seg-btn ${_period === "monthly" ? "active" : ""}" data-period="monthly">Monatlich</button>
          </div>
          <button class="btn btn-ghost btn-sm" id="btnRefreshAnalytics">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.86 4.4 2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M13.5 2.5v3h-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Aktualisieren
          </button>
        </div>
      </div>

      <!-- 5 KPI Cards -->
      <div class="an-kpi-strip mb-16">

        <!-- Gesamtprofit -->
        <div class="kpi-card an-kpi-card${s.totalProfit > 0 ? " an-kpi-green" : s.totalProfit < 0 ? " an-kpi-red" : ""}">
          <div class="an-kpi-top">
            <div class="kpi-label">Gesamtprofit</div>
            <div class="an-kpi-ico${s.totalProfit >= 0 ? " an-kpi-ico--green" : " an-kpi-ico--red"}">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                <polyline points="1,11 5,6 8,8 12,3 15,5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M13 3h2v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>
          <div class="kpi-value ${profitColor}">${fmtEur(s.totalProfit)}</div>
          <div class="kpi-meta">
            ${trendBadge}
            <span>${s.soldCount} Verkäufe</span>
          </div>
        </div>

        <!-- Win Rate -->
        <div class="kpi-card an-kpi-card">
          <div class="an-kpi-top">
            <div class="kpi-label">Win Rate</div>
            <div class="an-kpi-ico an-kpi-ico--accent">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                <path d="M8 1L10 6h5l-4 3 1.5 5L8 11.5 3.5 14 5 9 1 6h5z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            ${buildWinRing(extra.winRate)}
            <span class="kpi-value ${winColor}" style="margin-bottom:0;line-height:1">${extra.winRate}%</span>
          </div>
          <div class="kpi-meta">
            <span class="${winColor} font-semibold">${winLabel}</span>
            <span style="color:var(--text-disabled)">·</span>
            <span>${extra.winCount} profitabel</span>
          </div>
        </div>

        <!-- Ø Marge -->
        <div class="kpi-card an-kpi-card">
          <div class="an-kpi-top">
            <div class="kpi-label">Ø Marge</div>
            <div class="an-kpi-ico">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                <circle cx="4.5" cy="4.5" r="2.5" stroke="currentColor" stroke-width="1.3"/>
                <circle cx="11.5" cy="11.5" r="2.5" stroke="currentColor" stroke-width="1.3"/>
                <path d="M2 14L14 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            </div>
          </div>
          <div class="kpi-value ${marginColor}">${extra.avgMargin > 0 ? "+" : ""}${extra.avgMargin.toFixed(1)}%</div>
          <div class="kpi-meta">
            <span class="${marginColor} font-semibold">${marginLabel}</span>
          </div>
        </div>

        <!-- Aktives Kapital -->
        <div class="kpi-card an-kpi-card">
          <div class="an-kpi-top">
            <div class="kpi-label">Aktives Kapital</div>
            <div class="an-kpi-ico">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="4" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                <path d="M5 4V3a3 3 0 0 1 6 0v1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                <circle cx="8" cy="8.5" r="1.5" fill="currentColor"/>
              </svg>
            </div>
          </div>
          <div class="kpi-value">${fmtEur(s.activeCash)}</div>
          <div class="kpi-meta"><span>${s.activeCount} Artikel gebunden</span></div>
        </div>

        <!-- Ø Days to Cash -->
        <div class="kpi-card an-kpi-card">
          <div class="an-kpi-top">
            <div class="kpi-label">Ø Days to Cash</div>
            <div class="an-kpi-ico">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3"/>
                <path d="M8 4.5v3.7l2.5 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>
          <div class="kpi-value">${s.avgDaysToCash > 0 ? fmtDays(s.avgDaysToCash) : "—"}</div>
          <div class="kpi-meta"><span>Einkauf → Verkauf</span></div>
        </div>

      </div>

      <!-- Charts Row -->
      <div class="grid-2 mb-16">

        <div class="panel">
          <div class="an-panel-head">
            <div class="an-panel-ico">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <polyline points="1,11 5,6 8,8 12,3 15,5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M13 3h2v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="an-panel-title">Profit-Kurve</div>
            <span class="badge badge-gray an-panel-badge" id="profitChartPeriodLabel">
              ${_period === "monthly" ? "Monatlich" : "Wöchentlich"}
            </span>
          </div>
          ${s.soldCount === 0
            ? renderAnEmpty("Noch keine verkauften Artikel mit Verkaufspreis.")
            : `<div class="chart-container"><canvas id="chartProfit" height="200"></canvas></div>`}
        </div>

        <div class="panel">
          <div class="an-panel-head">
            <div class="an-panel-ico an-panel-ico--yellow">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="9" width="3" height="6" rx="1" fill="currentColor" opacity=".4"/>
                <rect x="6" y="5" width="3" height="10" rx="1" fill="currentColor" opacity=".7"/>
                <rect x="11" y="1" width="3" height="14" rx="1" fill="currentColor"/>
              </svg>
            </div>
            <div class="an-panel-title">Umsatz vs. Einkauf</div>
            <span class="badge badge-gray an-panel-badge">Cashflow</span>
          </div>
          ${s.soldCount === 0
            ? renderAnEmpty("Keine Verkaufsdaten vorhanden.")
            : `<div class="chart-container"><canvas id="chartRevCost" height="200"></canvas></div>`}
        </div>

      </div>

      <!-- Market Row -->
      <div class="grid-2 mb-16">

        <div class="panel">
          <div class="an-panel-head">
            <div class="an-panel-ico an-panel-ico--green">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 8V1a7 7 0 0 1 7 7H8z" fill="currentColor" opacity=".4"/>
                <path d="M8 8H1a7 7 0 0 0 7 7V8z" fill="currentColor" opacity=".7"/>
                <path d="M8 8H15a7 7 0 0 0-7-7" fill="currentColor"/>
              </svg>
            </div>
            <div class="an-panel-title">Portfolio-Split</div>
            <span class="badge badge-gray an-panel-badge">${totalCount} Artikel</span>
          </div>
          ${totalCount === 0
            ? renderAnEmpty("Keine Inventory-Daten.")
            : `<div class="an-doughnut-wrap"><canvas id="chartMarket"></canvas></div>`}
        </div>

        <div class="panel">
          <div class="an-panel-head">
            <div class="an-panel-ico an-panel-ico--accent">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <circle cx="5" cy="5" r="2.5" stroke="currentColor" stroke-width="1.4"/>
                <circle cx="11" cy="5" r="2.5" stroke="currentColor" stroke-width="1.4"/>
                <path d="M1 13c0-2.21 1.79-4 4-4M15 13c0-2.21-1.79-4-4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="an-panel-title">Profit by Marktplatz</div>
            <span class="badge badge-gray an-panel-badge">Verkäufe</span>
          </div>
          ${renderMarketBars(extra.marketProfit)}
        </div>

      </div>

      <!-- Best / Worst Flips -->
      <div class="grid-2">

        <div class="panel">
          <div class="an-panel-head">
            <div class="an-panel-ico an-panel-ico--green">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 1L10 6h5l-4 3 1.5 5L8 11.5 3.5 14 5 9 1 6h5z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="an-panel-title">Beste Flips</div>
          </div>
          ${renderFlipTable(s.bestFlips)}
        </div>

        <div class="panel">
          <div class="an-panel-head">
            <div class="an-panel-ico an-panel-ico--red">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v5M8 10.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M7.13 1.5L1.13 12a1 1 0 0 0 .87 1.5h12a1 1 0 0 0 .87-1.5L8.87 1.5a1 1 0 0 0-1.74 0z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="an-panel-title">Schlechteste Flips</div>
          </div>
          ${renderFlipTable(s.worstFlips)}
        </div>

      </div>
    `;
  }

  // ── Analytics empty state helper ──────────────────────────────────────────
  function renderAnEmpty(msg) {
    return `
      <div class="an-empty">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4M12 16h.01"/>
        </svg>
        <span>${msg}</span>
      </div>`;
  }

  // ── Win Rate SVG ring ─────────────────────────────────────────────────────
  function buildWinRing(pct) {
    const r     = 16;
    const circ  = 2 * Math.PI * r;
    const fill  = (Math.min(pct, 100) / 100) * circ;
    const color = pct >= 70 ? C.green : pct >= 50 ? C.yellow : C.red;
    return `<svg width="40" height="40" viewBox="0 0 40 40" class="shrink-0" style="transform:rotate(-90deg)">
      <circle cx="20" cy="20" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="4"/>
      <circle cx="20" cy="20" r="${r}" fill="none" stroke="${color}" stroke-width="4"
        stroke-dasharray="${fill.toFixed(1)} ${circ.toFixed(1)}"
        stroke-linecap="round"/>
    </svg>`;
  }

  // ── Market profit horizontal bars ─────────────────────────────────────────
  function renderMarketBars(marketProfit) {
    const entries = Object.entries(marketProfit).sort(([, a], [, b]) => b - a);
    if (!entries.length) {
      return renderAnEmpty("Noch keine Marktdaten.");
    }
    const maxAbs = Math.max(...entries.map(([, v]) => Math.abs(v)), 1);
    return `
      <div class="an-mkt-bars">
        ${entries.map(([mkt, profit]) => {
          const pct   = Math.abs(profit) / maxAbs * 100;
          const color = MARKET_COLORS[mkt] || C.color;
          const svg   = MKT_SVG[mkt] || MKT_SVG.ebay;
          const label = mkt.charAt(0).toUpperCase() + mkt.slice(1);
          const pc    = profit >= 0 ? "var(--green)" : "var(--red)";
          return `
            <div class="an-mkt-row">
              <div class="an-mkt-info">
                <div class="an-mkt-ico" style="background:${color}1A;border-color:${color}35;color:${color}">${svg}</div>
                <span class="an-mkt-label">${label}</span>
                <span class="an-mkt-profit" style="color:${pc}">${fmtEur(profit)}</span>
              </div>
              <div class="an-mkt-track">
                <div class="an-mkt-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div>
              </div>
            </div>`;
        }).join("")}
      </div>`;
  }

  // ── Flip table ────────────────────────────────────────────────────────────
  function renderFlipTable(flips) {
    if (!flips.length) {
      return renderAnEmpty("Noch keine verkauften Artikel.");
    }
    return `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Artikel</th>
              <th class="col-right">EK</th>
              <th class="col-right">VK</th>
              <th class="col-right">Profit</th>
              <th class="col-right">ROI</th>
            </tr>
          </thead>
          <tbody>
            ${flips.map(f => {
              const mkt      = f.market || "ebay";
              const mktBadge = MKT_BADGE[mkt] || "badge-gray";
              const mktSvg   = MKT_SVG[mkt]   || "";
              const mktLabel = FC.MARKET_LABELS[mkt] || mkt.toUpperCase();
              return `
                <tr>
                  <td style="max-width:150px">
                    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(f.title || f.ean)}">${esc(f.title || f.ean || "—")}</div>
                    <div style="display:flex;align-items:center;gap:4px;margin-top:2px">
                      ${f.ean ? `<span class="text-xs text-muted">${esc(f.ean)}</span>` : ""}
                      <span class="badge ${mktBadge}" style="font-size:9px;padding:1px 5px;line-height:14px">${mktSvg} ${mktLabel}</span>
                    </div>
                  </td>
                  <td class="col-right col-num">${fmtEur(f.ek)}</td>
                  <td class="col-right col-num">${fmtEur(f.sell_price)}</td>
                  <td class="col-right col-num ${f.profit >= 0 ? "text-green" : "text-red"}">${fmtEur(f.profit)}</td>
                  <td class="col-right"><span class="badge ${f.roi >= 15 ? "badge-green" : f.roi >= 0 ? "badge-yellow" : "badge-red"}">${fmtPct(f.roi)}</span></td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  }

  // ── Chart builders ────────────────────────────────────────────────────────
  function initCharts(stats, soldItems, container) {
    Chart.defaults.font.family = C.font;
    Chart.defaults.color       = C.text;

    const period = _period === "monthly"
      ? calcMonthlyPeriod(soldItems)
      : calcWeeklyPeriod(soldItems);

    buildProfitChart(period);
    buildRevCostChart(period);
    buildMarketChart(stats);
  }

  function buildProfitChart(period) {
    const ctx = document.getElementById("chartProfit");
    if (!ctx) return;

    // ── Update in place (no destroy/recreate) — only labels + data change ──
    if (charts.profit) {
      charts.profit.data.labels        = period.map(w => w.label);
      charts.profit.data.datasets[0].data = period.map(w => w.profit);
      charts.profit.update("none");   // "none" skips animation for instant feel
      return;
    }

    charts.profit = new Chart(ctx, {
      type: "line",
      data: {
        labels:   period.map(w => w.label),
        datasets: [{
          label:            "Profit",
          data:             period.map(w => w.profit),
          borderColor:      C.color,
          backgroundColor:  _css("--accent-subtle"),
          borderWidth:      2,
          fill:             true,
          tension:          0.4,
          pointRadius:      3,
          pointHoverRadius: 5,
          pointBackgroundColor: C.color,
          pointBorderColor: "transparent",
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: true,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: false },
          tooltip: _tooltip({ callbacks: { label: ctx => ` ${fmtEur(ctx.parsed.y)}` } }),
        },
        scales: {
          x: { grid: CHART_GRID, ticks: { font: { size: 10 }, color: C.text } },
          y: { grid: CHART_GRID, ticks: { font: { size: 10 }, color: C.text, callback: v => fmtEur(v) } },
        },
      },
    });
  }

  function buildRevCostChart(period) {
    const ctx = document.getElementById("chartRevCost");
    if (!ctx) return;

    // ── Update in place — only labels + data change on period toggle ──
    if (charts.revCost) {
      charts.revCost.data.labels           = period.map(w => w.label);
      charts.revCost.data.datasets[0].data = period.map(w => w.revenue);
      charts.revCost.data.datasets[1].data = period.map(w => w.cost);
      charts.revCost.update("none");
      return;
    }

    charts.revCost = new Chart(ctx, {
      type: "bar",
      data: {
        labels:   period.map(w => w.label),
        datasets: [
          {
            label:           "Umsatz",
            data:            period.map(w => w.revenue),
            backgroundColor: C.color + "B3",
            borderRadius:    4,
            borderSkipped:   false,
          },
          {
            label:           "Einkauf",
            data:            period.map(w => w.cost),
            backgroundColor: C.red + "73",
            borderRadius:    4,
            borderSkipped:   false,
          },
        ],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: true,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: {
            display:  true,
            position: "top",
            align:    "end",
            labels: { font: { size: 10 }, color: C.text, boxWidth: 10, boxHeight: 10, padding: 8 },
          },
          tooltip: _tooltip({ callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtEur(ctx.parsed.y)}` } }),
        },
        scales: {
          x: { grid: CHART_GRID, ticks: { font: { size: 10 }, color: C.text } },
          y: { grid: CHART_GRID, ticks: { font: { size: 10 }, color: C.text, callback: v => fmtEur(v) } },
        },
      },
    });
  }

  function buildMarketChart(s) {
    const ctx = document.getElementById("chartMarket");
    if (!ctx) return;
    if (charts.market) { charts.market.destroy(); delete charts.market; }

    const labels = Object.keys(s.marketSplit);
    const values = Object.values(s.marketSplit);
    const COLORS = CHART_PALETTE;

    charts.market = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data:             values,
          backgroundColor:  labels.map((_, i) => COLORS[i % COLORS.length]),
          borderColor:      _css("--bg-panel"),
          borderWidth:      3,
          hoverBorderWidth: 3,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: true,
        cutout:              "70%",
        plugins: {
          legend: {
            position: "right",
            labels: { font: { size: 11 }, padding: 12, color: C.text, boxWidth: 10, boxHeight: 10 },
          },
          tooltip: _tooltip({ callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} Artikel` } }),
        },
      },
    });
  }

  // ── Period toggle ─────────────────────────────────────────────────────────
  function attachPeriodToggle(soldItems, container) {
    container.querySelectorAll(".analytics-period-toggle .seg-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        _period = btn.dataset.period;
        container.querySelectorAll(".analytics-period-toggle .seg-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const lbl = container.querySelector("#profitChartPeriodLabel");
        if (lbl) lbl.textContent = _period === "monthly" ? "Monatlich" : "Wöchentlich";

        const period = _period === "monthly"
          ? calcMonthlyPeriod(soldItems)
          : calcWeeklyPeriod(soldItems);

        buildProfitChart(period);
        buildRevCostChart(period);
      });
    });
  }

  return { mount, unmount };
})();
