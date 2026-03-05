/* Flipcheck Web App — Preisverlauf View (v2 quality) */
const HistoryView = (() => {
  let _el    = null;
  let _chart = null;
  let _list  = [];
  let _activeEan = null;

  /* ── Mount ───────────────────────────────────────────────────────── */
  async function mount(el, navId) {
    _el = el;
    el.innerHTML = `
      <div class="page-header">
        <div class="page-header-left"><h1>Preisverlauf</h1><p>Historische eBay-Preise pro EAN</p></div>
      </div>
      <div class="view-loading">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" class="spin">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="28" stroke-dashoffset="10" stroke-linecap="round"/>
        </svg>
      </div>`;

    _list = await Storage.listHistory();
    if (App._navId !== navId) return;

    renderShell();
  }

  /* ── Trend calc ──────────────────────────────────────────────────── */
  function calcTrend(entries) {
    if (entries.length < 2) return { dir: "flat", pct: 0 };
    const recent = entries.slice(-7);
    const old    = entries.slice(-14, -7);
    if (!old.length) return { dir: "flat", pct: 0 };
    const avgRecent = recent.reduce((s, e) => s + (e[1] ?? e.price ?? 0), 0) / recent.length;
    const avgOld    = old.reduce((s, e) => s + (e[1] ?? e.price ?? 0), 0)    / old.length;
    if (avgOld === 0) return { dir: "flat", pct: 0 };
    const pct = ((avgRecent - avgOld) / Math.abs(avgOld)) * 100;
    return { dir: pct > 2 ? "up" : pct < -2 ? "down" : "flat", pct };
  }

  /* ── Trend pill ──────────────────────────────────────────────────── */
  function trendPill(trend) {
    if (trend.dir === "flat") return `<span class="hist-trend-pill hist-trend-flat">→ stabil</span>`;
    if (trend.dir === "up")   return `<span class="hist-trend-pill hist-trend-up">↑ +${Math.abs(trend.pct).toFixed(1)}%</span>`;
    return `<span class="hist-trend-pill hist-trend-down">↓ −${Math.abs(trend.pct).toFixed(1)}%</span>`;
  }

  /* ── Shell with split layout ─────────────────────────────────────── */
  function renderShell() {
    if (!_list.length) {
      _el.innerHTML = `
        <div class="page-header">
          <div class="page-header-left"><h1>Preisverlauf</h1><p>Historische eBay-Preise pro EAN</p></div>
        </div>
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M6 30L14 20l8 6 8-14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <p>Noch kein Preisverlauf vorhanden. Prüfe EANs mit Flipcheck, um Daten zu sammeln.</p>
        </div>`;
      return;
    }

    _el.innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Preisverlauf</h1>
          <p>${_list.length} EAN${_list.length !== 1 ? "s" : ""} gespeichert</p>
        </div>
      </div>
      <div class="hist-split">
        <div class="hist-split-list" id="histList">
          ${_list.map(h => {
            const entries = h.entries || [];
            const trend   = calcTrend(entries.slice(-14));
            const last    = entries.length ? (entries[entries.length - 1][1] ?? entries[entries.length - 1].price ?? 0) : null;
            const isActive = h.ean === _activeEan;
            return `
              <div class="hist-list-item${isActive ? " active" : ""}" data-ean="${esc(h.ean)}">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                  <div>
                    <div class="hist-list-ean">${esc(h.ean)}</div>
                    <div class="hist-list-title">${esc(h.title || "—")}</div>
                    <div class="hist-list-date">${fmtDate(h.updated_at)}</div>
                  </div>
                  <div style="text-align:right;flex-shrink:0">
                    ${last != null ? `<div style="font-weight:700;font-size:13px">${fmtEurPlain(last)}</div>` : ""}
                    ${trendPill(trend)}
                  </div>
                </div>
              </div>`;
          }).join("")}
        </div>
        <div class="hist-split-detail" id="histDetail">
          <div class="empty-state" style="margin:auto">
            <svg width="32" height="32" viewBox="0 0 40 40" fill="none"><path d="M6 30L14 20l8 6 8-14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <p style="font-size:13px">EAN auswählen</p>
          </div>
        </div>
      </div>
    `;

    // Bind list items
    _el.querySelectorAll(".hist-list-item").forEach(item => {
      item.addEventListener("click", () => {
        _el.querySelectorAll(".hist-list-item").forEach(i => i.classList.remove("active"));
        item.classList.add("active");
        loadDetail(item.dataset.ean);
      });
    });

    // Auto-load first if set
    if (_activeEan) {
      loadDetail(_activeEan);
    } else if (_list.length) {
      _activeEan = _list[0].ean;
      _el.querySelector(`.hist-list-item[data-ean="${CSS.escape(_activeEan)}"]`)?.classList.add("active");
      loadDetail(_activeEan);
    }
  }

  /* ── Detail pane ─────────────────────────────────────────────────── */
  async function loadDetail(ean) {
    _activeEan = ean;
    const detailEl = _el.querySelector("#histDetail");
    if (!detailEl) return;

    detailEl.innerHTML = `<div class="view-loading"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="spin"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="28" stroke-dashoffset="10" stroke-linecap="round"/></svg></div>`;

    try {
      const h       = await Storage.getHistory(ean);
      const entries = (h.entries || []).slice(-90);

      if (!entries.length) {
        detailEl.innerHTML = `<div class="card"><p style="color:var(--text-muted)">Keine Einträge für ${esc(ean)}</p></div>`;
        return;
      }

      const vals    = entries.map(e => e[1] ?? e.price ?? 0);
      const minVal  = Math.min(...vals);
      const maxVal  = Math.max(...vals);
      const avgVal  = vals.reduce((s, v) => s + v, 0) / vals.length;
      const curVal  = vals[vals.length - 1];
      const trend   = calcTrend(entries);
      const range   = maxVal - minVal;
      const curPct  = range > 0 ? ((curVal - minVal) / range) * 100 : 50;

      detailEl.innerHTML = `
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <div>
              <div style="font-weight:700;font-size:14px">${esc(h.title || ean)}</div>
              <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${esc(ean)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              ${trendPill(trend)}
              <button class="btn btn-danger btn-sm" id="histDelBtn" data-ean="${esc(ean)}">Löschen</button>
            </div>
          </div>

          <!-- 4 KPIs -->
          <div class="grid-2-sm" style="margin-bottom:12px">
            <div class="fc-kpi-card">
              <div class="fc-kpi-value">${fmtEurPlain(curVal)}</div>
              <div class="fc-kpi-label">Aktuell</div>
            </div>
            <div class="fc-kpi-card">
              <div class="fc-kpi-value">${fmtEurPlain(avgVal)}</div>
              <div class="fc-kpi-label">Durchschnitt</div>
            </div>
            <div class="fc-kpi-card">
              <div class="fc-kpi-value" style="color:var(--green)">${fmtEurPlain(minVal)}</div>
              <div class="fc-kpi-label">Minimum</div>
            </div>
            <div class="fc-kpi-card">
              <div class="fc-kpi-value" style="color:var(--red)">${fmtEurPlain(maxVal)}</div>
              <div class="fc-kpi-label">Maximum</div>
            </div>
          </div>

          <!-- Price range bar -->
          <div class="hist-range-wrap" style="margin-bottom:14px">
            <div class="hist-range-bar">
              <div class="hist-range-fill"></div>
              <div class="hist-range-dot" style="left:${curPct.toFixed(1)}%"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:4px">
              <span class="hist-range-label" style="color:var(--green)">${fmtEurPlain(minVal)}</span>
              <span class="hist-range-label" style="color:var(--text-secondary)">${entries.length} Datenpunkte</span>
              <span class="hist-range-label" style="color:var(--red)">${fmtEurPlain(maxVal)}</span>
            </div>
          </div>

          <!-- Chart -->
          <div style="position:relative;height:180px"><canvas id="histChart"></canvas></div>
        </div>
      `;

      // Draw chart
      if (_chart) { _chart.destroy(); _chart = null; }
      if (typeof Chart !== "undefined") {
        const cv  = detailEl.querySelector("#histChart");
        const pts = entries.map(e => Array.isArray(e) ? e : [e.date, e.price]);
        const labels = pts.map(p => {
          const ts = typeof p[0] === "number" ? p[0] * 1000 : new Date(p[0]).getTime();
          const d  = new Date(ts);
          return `${d.getDate()}.${d.getMonth() + 1}.`;
        });
        const data = pts.map(p => p[1]);
        _chart = new Chart(cv, {
          type: "line",
          data: {
            labels,
            datasets: [{
              data,
              borderColor: "#6366F1",
              backgroundColor: "rgba(99,102,241,0.08)",
              borderWidth: 2,
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 4,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: { label: ctx => fmtEurPlain(ctx.parsed.y) },
                backgroundColor: "#111118", borderColor: "#2E2E42", borderWidth: 1,
                titleColor: "#94A3B8", bodyColor: "#F1F5F9",
              },
            },
            scales: {
              x: { ticks: { color: "#475569", font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: "#1E1E2E" } },
              y: { ticks: { color: "#475569", font: { size: 10 }, callback: v => fmtEurPlain(v) }, grid: { color: "#1E1E2E" } },
            },
          },
        });
      }

      // Delete button
      detailEl.querySelector("#histDelBtn")?.addEventListener("click", async () => {
        const ok = await Modal.confirm("Verlauf löschen", `Alle ${entries.length} Einträge für EAN ${ean} löschen?`, { confirmLabel: "Löschen", danger: true });
        if (!ok) return;
        try {
          await Storage.deleteHistory(ean);
          if (_chart) { _chart.destroy(); _chart = null; }
          _list = _list.filter(i => i.ean !== ean);
          _activeEan = null;
          renderShell();
          Toast.success("Verlauf gelöscht");
        } catch (e) { Toast.error("Fehler", e.message); }
      });

    } catch (e) {
      detailEl.innerHTML = `<div class="card" style="color:var(--red)">${esc(e.message)}</div>`;
    }
  }

  /* ── Unmount ─────────────────────────────────────────────────────── */
  function unmount() {
    if (_chart) { _chart.destroy(); _chart = null; }
    _el = null;
  }

  return { mount, unmount };
})();
