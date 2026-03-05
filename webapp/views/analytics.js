/* Flipcheck Web App — Analytics View (v2 quality) */
const AnalyticsView = (() => {
  let _el          = null;
  let _chartWeekly = null;
  let _chartMarket = null;
  let _period      = "weekly"; // "weekly" | "monthly"
  let _items       = [];

  /* ── Mount ───────────────────────────────────────────────────────── */
  async function mount(el, navId) {
    _el = el;
    el.innerHTML = `
      <div class="page-header">
        <div class="page-header-left"><h1>Analytics</h1><p>Übersicht deiner Flip-Performance</p></div>
      </div>
      <div class="view-loading">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" class="spin">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="28" stroke-dashoffset="10" stroke-linecap="round"/>
        </svg>
      </div>`;

    _items = await Storage.listInventory();
    if (App._navId !== navId) return;

    render();
  }

  /* ── Monthly profit helper ───────────────────────────────────────── */
  function calcMonthlyProfit(items) {
    const map = {};
    for (const i of items) {
      if (i.status !== "SOLD" || !i.sold_at) continue;
      const d    = new Date(i.sold_at);
      const key  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const p    = calcRealProfit(i) ?? 0;
      map[key]   = (map[key] || 0) + p;
    }
    // Last 12 months
    const now    = new Date();
    const result = [];
    for (let m = 11; m >= 0; m--) {
      const d   = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      result.push({ label: `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`, profit: map[key] || 0 });
    }
    return result;
  }

  /* ── Win rate ────────────────────────────────────────────────────── */
  function calcWinRate(items) {
    const sold = items.filter(i => i.status === "SOLD");
    if (!sold.length) return 0;
    const wins = sold.filter(i => (calcRealProfit(i) ?? 0) > 0).length;
    return wins / sold.length;
  }

  /* ── MoM trend ───────────────────────────────────────────────────── */
  function calcMoMTrend(monthly) {
    if (monthly.length < 2) return null;
    const cur  = monthly[monthly.length - 1].profit;
    const prev = monthly[monthly.length - 2].profit;
    if (prev === 0) return null;
    return (cur - prev) / Math.abs(prev);
  }

  /* ── Avg days to cash ────────────────────────────────────────────── */
  function calcAvgDays(items) {
    const sold = items.filter(i => i.status === "SOLD" && i.ek_date && i.sold_at);
    if (!sold.length) return null;
    const total = sold.reduce((acc, i) => {
      const d = (new Date(i.sold_at) - new Date(i.ek_date)) / 86400000;
      return acc + (d > 0 ? d : 0);
    }, 0);
    return total / sold.length;
  }

  /* ── SVG win rate ring ───────────────────────────────────────────── */
  function winRateSvg(rate) {
    const pct  = Math.round(rate * 100);
    const r    = 24;
    const circ = 2 * Math.PI * r;
    const dash = (pct / 100) * circ;
    const color = pct >= 70 ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444";
    return `
      <div class="an-win-ring">
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="${r}" stroke="#1E1E2E" stroke-width="6" fill="none"/>
          <circle cx="32" cy="32" r="${r}" stroke="${color}" stroke-width="6" fill="none"
            stroke-dasharray="${dash.toFixed(1)} ${(circ - dash).toFixed(1)}"
            stroke-dashoffset="${(circ * 0.25).toFixed(1)}"
            stroke-linecap="round" transform="rotate(-90 32 32)"/>
        </svg>
        <div class="an-win-ring-text" style="color:${color}">${pct}%</div>
      </div>`;
  }

  /* ── Trend badge ─────────────────────────────────────────────────── */
  function trendBadge(mom) {
    if (mom == null) return "";
    const up    = mom > 0;
    const color = up ? "var(--green)" : "var(--red)";
    const arrow = up ? "↑" : "↓";
    return `<span class="an-kpi-trend" style="color:${color}">${arrow} ${Math.abs(Math.round(mom * 100))}% MoM</span>`;
  }

  /* ── Market profit bars ──────────────────────────────────────────── */
  function marketBars(items) {
    const map = {};
    for (const i of items) {
      if (i.status !== "SOLD" || !i.market) continue;
      const p = calcRealProfit(i) ?? 0;
      map[i.market] = (map[i.market] || 0) + p;
    }
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return "";
    const maxVal = Math.max(...entries.map(([, v]) => Math.abs(v)), 1);
    return `
      <div class="an-mkt-bars">
        ${entries.map(([mkt, val]) => {
          const pct   = Math.round(Math.abs(val) / maxVal * 100);
          const color = val >= 0 ? "#10B981" : "#EF4444";
          return `
            <div class="an-mkt-row">
              <div class="an-mkt-label">${esc(FC.MARKET_LABELS[mkt] || mkt)}</div>
              <div class="an-mkt-bar-wrap">
                <div class="an-mkt-bar" style="width:${pct}%;background:${color}"></div>
              </div>
              <div class="an-mkt-val" style="color:${color}">${fmtEur(val)}</div>
            </div>`;
        }).join("")}
      </div>`;
  }

  /* ── Flip table ──────────────────────────────────────────────────── */
  function flipTable(flips) {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Artikel</th><th>Profit</th><th>ROI</th><th>VK</th><th>Markt</th>
          </tr></thead>
          <tbody>
            ${flips.map(i => {
              const p     = calcRealProfit(i) ?? 0;
              const roi   = i.ek > 0 ? p / (i.ek * (i.qty || 1)) : null;
              const color = p >= 0 ? "var(--green)" : "var(--red)";
              return `<tr>
                <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.title || i.ean || "—")}</td>
                <td style="color:${color};font-variant-numeric:tabular-nums">${fmtEur(p)}</td>
                <td style="font-variant-numeric:tabular-nums">${roi != null ? fmtPct(roi) : "—"}</td>
                <td style="font-variant-numeric:tabular-nums">${i.sell_price != null ? fmtEurPlain(i.sell_price) : "—"}</td>
                <td style="font-size:11px;color:var(--text-secondary)">${esc(FC.MARKET_LABELS[i.market] || i.market || "—")}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  }

  /* ── Render ──────────────────────────────────────────────────────── */
  function render() {
    const a       = Storage.calcInventoryAnalytics(_items);
    const monthly = calcMonthlyProfit(_items);
    const winRate = calcWinRate(_items);
    const mom     = calcMoMTrend(monthly);
    const avgDays = calcAvgDays(_items);

    const soldItems = _items.filter(i => i.status === "SOLD");
    const bestFlips  = [...soldItems].sort((a, b) => (calcRealProfit(b) ?? -Infinity) - (calcRealProfit(a) ?? -Infinity)).slice(0, 5);
    const worstFlips = [...soldItems].sort((a, b) => (calcRealProfit(a) ?? Infinity)  - (calcRealProfit(b) ?? Infinity)).slice(0, 5).filter(i => (calcRealProfit(i) ?? 0) < 0);

    const profitColor = a.totalProfit >= 0 ? "var(--green)" : "var(--red)";

    _el.innerHTML = `
      <div class="page-header">
        <div class="page-header-left"><h1>Analytics</h1><p>Übersicht deiner Flip-Performance</p></div>
        <div class="page-header-right">
          <div class="an-period-toggle">
            <button class="an-period-btn${_period === "weekly" ? " active" : ""}" data-period="weekly">KW</button>
            <button class="an-period-btn${_period === "monthly" ? " active" : ""}" data-period="monthly">Monat</button>
          </div>
        </div>
      </div>

      <!-- 5-KPI Strip -->
      <div class="an-kpi-strip">
        <div class="an-kpi-card">
          <div class="an-kpi-val" style="color:${profitColor}">${fmtEur(a.totalProfit)}</div>
          <div class="an-kpi-label">Gesamt-Profit</div>
          ${trendBadge(mom)}
        </div>
        <div class="an-kpi-card" style="align-items:center">
          ${winRateSvg(winRate)}
          <div class="an-kpi-label" style="text-align:center;margin-top:4px">Win Rate</div>
        </div>
        <div class="an-kpi-card">
          <div class="an-kpi-val">${a.avgRoi > 0 ? fmtPct(a.avgRoi) : "—"}</div>
          <div class="an-kpi-label">Ø ROI</div>
        </div>
        <div class="an-kpi-card">
          <div class="an-kpi-val">${fmtEurPlain(a.activeCash)}</div>
          <div class="an-kpi-label">Aktives Kapital</div>
        </div>
        <div class="an-kpi-card">
          <div class="an-kpi-val">${avgDays != null ? `${Math.round(avgDays)}T` : "—"}</div>
          <div class="an-kpi-label">Ø Tage zu Cash</div>
        </div>
      </div>

      <!-- Charts -->
      <div class="analytics-grid">
        <div class="card">
          <div style="font-size:12px;font-weight:600;margin-bottom:12px;color:var(--text-secondary)">${_period === "weekly" ? "WÖCHENTLICHER PROFIT" : "MONATLICHER PROFIT"}</div>
          <div class="chart-wrap"><canvas id="chartWeekly"></canvas></div>
        </div>
        <div class="card">
          <div style="font-size:12px;font-weight:600;margin-bottom:12px;color:var(--text-secondary)">MARKT-SPLIT</div>
          <div class="chart-wrap"><canvas id="chartMarket"></canvas></div>
        </div>
      </div>

      <!-- Market profit bars -->
      ${soldItems.length ? `
      <div class="card" style="margin-top:16px">
        <div style="font-size:12px;font-weight:600;margin-bottom:12px;color:var(--text-secondary)">PROFIT NACH MARKT</div>
        ${marketBars(_items)}
      </div>` : ""}

      <!-- Best flips -->
      ${bestFlips.length ? `
      <div class="card" style="margin-top:16px">
        <div style="font-size:12px;font-weight:600;margin-bottom:12px;color:var(--text-secondary)">BESTE FLIPS</div>
        ${flipTable(bestFlips)}
      </div>` : ""}

      <!-- Worst flips -->
      ${worstFlips.length ? `
      <div class="card" style="margin-top:16px">
        <div style="font-size:12px;font-weight:600;margin-bottom:12px;color:var(--text-secondary)">SCHLECHTESTE FLIPS</div>
        ${flipTable(worstFlips)}
      </div>` : ""}

      ${_items.length === 0 ? `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M20 6l14 24H6L20 6z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M20 16v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="20" cy="27" r="1" fill="currentColor"/></svg>
        <p>Noch keine Inventardaten vorhanden</p>
      </div>` : ""}
    `;

    drawCharts(a, monthly);
    bindPeriodToggle(a, monthly);
  }

  /* ── Period toggle ───────────────────────────────────────────────── */
  function bindPeriodToggle(a, monthly) {
    _el.querySelectorAll(".an-period-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        _period = btn.dataset.period;
        _el.querySelectorAll(".an-period-btn").forEach(b => b.classList.toggle("active", b.dataset.period === _period));
        // Update chart title
        const title = _el.querySelector(".analytics-grid .card .an-kpi-label, .analytics-grid .card div");
        // Redraw just the weekly chart
        const wcv = _el.querySelector("#chartWeekly");
        if (!wcv) return;
        if (_chartWeekly) { _chartWeekly.destroy(); _chartWeekly = null; }
        const data   = _period === "monthly" ? monthly : a.weeklyProfit.map(w => ({ label: w.label, profit: +w.profit.toFixed(2) }));
        const labels = data.map(d => d.label);
        const profits = data.map(d => d.profit);
        _el.querySelector(".analytics-grid .card div:first-child").textContent = _period === "weekly" ? "WÖCHENTLICHER PROFIT" : "MONATLICHER PROFIT";
        _chartWeekly = new Chart(wcv, {
          type: "bar",
          data: {
            labels,
            datasets: [{
              data: profits,
              backgroundColor: profits.map(v => v >= 0 ? "rgba(16,185,129,0.5)" : "rgba(239,68,68,0.5)"),
              borderColor:     profits.map(v => v >= 0 ? "#10B981" : "#EF4444"),
              borderWidth: 1, borderRadius: 3,
            }],
          },
          options: chartOptions(true),
        });
      });
    });
  }

  /* ── Chart options helper ────────────────────────────────────────── */
  function chartOptions(isBar) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => fmtEur(ctx.parsed.y) },
          backgroundColor: "#111118", borderColor: "#2E2E42", borderWidth: 1,
          titleColor: "#94A3B8", bodyColor: "#F1F5F9",
        },
      },
      scales: isBar ? {
        x: { ticks: { color: "#475569", font: { size: 10 } }, grid: { color: "#1E1E2E" } },
        y: { ticks: { color: "#475569", font: { size: 10 }, callback: v => fmtEurPlain(v) }, grid: { color: "#1E1E2E" } },
      } : {},
    };
  }

  /* ── Draw charts ─────────────────────────────────────────────────── */
  function drawCharts(a, monthly) {
    if (typeof Chart === "undefined") return;

    // Weekly/monthly profit bar
    const wcv = _el.querySelector("#chartWeekly");
    if (wcv) {
      if (_chartWeekly) _chartWeekly.destroy();
      const data    = _period === "monthly" ? monthly : a.weeklyProfit.map(w => ({ label: w.label, profit: +w.profit.toFixed(2) }));
      const labels  = data.map(d => d.label);
      const profits = data.map(d => d.profit);
      _chartWeekly = new Chart(wcv, {
        type: "bar",
        data: {
          labels,
          datasets: [{
            data: profits,
            backgroundColor: profits.map(v => v >= 0 ? "rgba(16,185,129,0.5)" : "rgba(239,68,68,0.5)"),
            borderColor:     profits.map(v => v >= 0 ? "#10B981" : "#EF4444"),
            borderWidth: 1, borderRadius: 3,
          }],
        },
        options: chartOptions(true),
      });
    }

    // Market doughnut
    const mcv = _el.querySelector("#chartMarket");
    if (mcv) {
      if (_chartMarket) _chartMarket.destroy();
      const entries  = Object.entries(a.marketSplit);
      const labels   = entries.map(([m]) => FC.MARKET_LABELS[m] || m);
      const data     = entries.map(([, v]) => v);
      const bgColors = entries.map(([m]) => FC.MARKET_CHART_COLORS[m] || "#94A3B8");
      _chartMarket = new Chart(mcv, {
        type: "doughnut",
        data: { labels, datasets: [{ data, backgroundColor: bgColors, borderWidth: 0 }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "right", labels: { color: "#94A3B8", font: { size: 11 }, padding: 12 } },
            tooltip: { backgroundColor: "#111118", borderColor: "#2E2E42", borderWidth: 1,
                       titleColor: "#94A3B8", bodyColor: "#F1F5F9" },
          },
          cutout: "65%",
        },
      });
    }
  }

  /* ── Unmount ─────────────────────────────────────────────────────── */
  function unmount() {
    if (_chartWeekly) { _chartWeekly.destroy(); _chartWeekly = null; }
    if (_chartMarket) { _chartMarket.destroy(); _chartMarket = null; }
    _el = null;
  }

  return { mount, unmount };
})();
