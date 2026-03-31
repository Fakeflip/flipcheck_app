/* Flipcheck v2 — Preishistorie View */
const HistoryView = (() => {
  let _container = null;
  let _histList = [];
  let _selectedEan = null;
  let _chart = null;

  function mount(container) {
    _container = container;
    _selectedEan = null;
    container.innerHTML = renderShell();
    loadList(container);
  }

  function unmount() {
    if (_chart) { try { _chart.destroy(); } catch {} _chart = null; }
    _container = null;
  }

  function renderShell() {
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>${I18N.t('hist.title')}</h1>
          <p>${I18N.t('hist.subtitle')}</p>
        </div>
        <div class="page-header-right" style="gap:6px;flex-wrap:wrap">
          <input id="histScanEan" class="input" type="text" placeholder="${I18N.t('hist.scan_placeholder')}" style="width:155px;font-size:12px;padding:6px 10px" autocomplete="off" />
          <input id="histScanEk" class="input" type="number" step="0.01" min="0" placeholder="EK €" style="width:72px;font-size:12px;padding:6px 10px" />
          <select id="histScanMarket" class="select" style="font-size:12px;padding:6px 10px;width:auto">
            <option value="ebay">eBay</option>
            <option value="amz">Amazon</option>
            <option value="kaufland">Kaufland</option>
          </select>
          <button class="btn btn-primary btn-sm" id="btnHistScan">${I18N.t('hist.check_btn')}</button>
        </div>
      </div>

      <div class="fc-split-320">

        <!-- EAN List -->
        <div class="panel" style="padding:0;overflow:hidden">
          <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
            <input id="histSearch" class="input" type="search" placeholder="${I18N.t('hist.search_placeholder')}" style="font-size:12px;padding:6px 10px" />
          </div>
          <div id="histList" style="max-height:560px;overflow-y:auto">
            <div class="empty-state" style="padding:32px">
              <div class="spinner spinner-sm"></div>
            </div>
          </div>
        </div>

        <!-- Chart + Detail -->
        <div id="histDetail">
          ${renderDetailEmpty()}
        </div>

      </div>
    `;
  }

  function renderDetailEmpty() {
    return `
      <div class="empty-state" style="padding:80px">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <p class="empty-title">${I18N.t('hist.detail_empty.title')}</p>
        <p class="empty-sub">${I18N.t('hist.detail_empty.sub')}</p>
      </div>
    `;
  }

  async function loadList(container) {
    try {
      _histList = await Storage.listHistory();
    } catch {
      _histList = [];
    }
    renderList(container, _histList);

    const searchInput = container.querySelector("#histSearch");
    if (searchInput && !searchInput._histSearchBound) {
      searchInput._histSearchBound = true;
      searchInput.addEventListener("input", e => {
        const q = e.target.value.toLowerCase();
        const filtered = _histList.filter(h =>
          h.ean.includes(q) || (h.title||"").toLowerCase().includes(q)
        );
        renderList(container, filtered);
      });
    }

    // Scan form — EAN + EK → Flipcheck → save to history → reload
    const scanBtn = container.querySelector("#btnHistScan");
    const scanEan = container.querySelector("#histScanEan");
    const scanEk  = container.querySelector("#histScanEk");

    // Guard against duplicate listeners on reload
    if (scanBtn && !scanBtn._histScanBound) {
      scanBtn._histScanBound = true;

      async function runHistScan() {
        const ean    = scanEan?.value.trim();
        const ek     = parseFloat(scanEk?.value) || 0;
        const market = container.querySelector("#histScanMarket")?.value || "ebay";
        if (!ean) { Toast.error(I18N.t('hist.scan.ean_missing'), I18N.t('hist.scan.ean_missing_sub')); return; }
        if (scanBtn) scanBtn.disabled = true;
        const origLabel = scanBtn.textContent;
        scanBtn.innerHTML = `<div class="spinner spinner-sm" style="width:12px;height:12px;border-width:1.5px"></div>`;
        try {
          const { ok, data } = await API.flipcheck(ean, ek, "mid", { market });
          if (!ok || !data) throw new Error(data?.detail || "Backend nicht erreichbar");
          await Storage.savePrice({ ean, title: data.title || ean, browse_avg: data.browse_avg, browse_median: data.sell_price_median, research_avg: data.sell_price_avg, sales_30d: data.sales_30d });
          if (data.price_series?.length) {
            await Storage.savePriceSeries({ ean, title: data.title || ean, price_series: data.price_series, qty_series: data.qty_series || [] });
          }
          Toast.success(I18N.t('hist.scan.saved'), `${esc(data.title || ean)} — ${fmtEur(data.sell_price_median ?? data.browse_avg)}`);
          if (scanEan) scanEan.value = "";
          if (scanEk)  scanEk.value  = "";
          await loadList(container);
          loadDetail(ean, container);
        } catch (err) {
          Toast.error(I18N.t('hist.scan.err'), err.message || I18N.t('hist.scan.err_sub'));
        } finally {
          if (scanBtn) { scanBtn.disabled = false; scanBtn.textContent = origLabel; }
        }
      }

      scanBtn.addEventListener("click", runHistScan);
      scanEan?.addEventListener("keydown", e => { if (e.key === "Enter") scanEk?.focus(); });
      scanEk?.addEventListener("keydown",  e => { if (e.key === "Enter") runHistScan(); });
    }
  }

  function renderList(container, items) {
    const listEl = container.querySelector("#histList");
    if (!listEl) return;

    if (items.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding:32px">
          <p class="empty-title text-sm">${I18N.t('hist.list_empty.title')}</p>
          <p class="empty-sub" style="font-size:11px">${I18N.t('hist.list_empty.sub')}</p>
        </div>
      `;
      return;
    }

    // Remove previous click listener before re-render
    if (listEl._histDelegate) {
      listEl.removeEventListener("click", listEl._histDelegate);
    }

    listEl.innerHTML = items.map(h => `
      <div class="hist-list-item ${h.ean === _selectedEan ? "active" : ""}" data-ean="${esc(h.ean)}">
        <div class="hist-li-title">${esc(h.title || h.ean)}</div>
        <div class="hist-li-meta">
          <span style="font-size:11px;font-family:var(--font-mono);color:var(--dim)">${esc(h.ean)}</span>
          <span style="font-size:10px;color:var(--text-muted)">${h.count} ${I18N.t('hist.list.entries')}</span>
          ${h.last_price ? `<span class="hist-li-price">${fmtEur(h.last_price)}</span>` : ""}
        </div>
      </div>
    `).join("");

    // Event delegation — hover handled by CSS, only click needed
    listEl._histDelegate = e => {
      const item = e.target.closest(".hist-list-item");
      if (item) loadDetail(item.dataset.ean, container);
    };
    listEl.addEventListener("click", listEl._histDelegate);
  }

  async function loadDetail(ean, container) {
    _selectedEan = ean;

    // Update list highlight — CSS handles background, just toggle class
    container.querySelectorAll(".hist-list-item").forEach(el => {
      el.classList.toggle("active", el.dataset.ean === ean);
    });

    const detailEl = container.querySelector("#histDetail");
    if (!detailEl) return;
    detailEl.innerHTML = `<div class="empty-state" style="padding:60px"><div class="spinner"></div></div>`;

    if (_chart) { try { _chart.destroy(); } catch {} _chart = null; }

    const data = await Storage.getHistory(ean);

    if (!data.entries || data.entries.length === 0) {
      detailEl.innerHTML = `
        <div class="panel">
          <p class="text-secondary">${I18N.t('hist.no_data')} ${esc(ean)}.</p>
          <button class="btn btn-danger btn-sm mt-12" id="btnDeleteHist">${I18N.t('hist.delete_btn')}</button>
        </div>
      `;
      detailEl.querySelector("#btnDeleteHist")?.addEventListener("click", async () => {
        await Storage.deleteHistory(ean);
        _selectedEan = null;
        await loadList(container);
        detailEl.innerHTML = renderDetailEmpty();
        Toast.info(I18N.t('hist.toast.deleted'), `${I18N.t('hist.toast.deleted_sub')} ${ean}.`);
      });
      return;
    }

    const entries = data.entries.slice(-90); // last 90 entries (series = 31/check)
    // Use research_avg (daily avg sold) first, fall back to browse price
    const prices = entries.map(e => e.research_avg ?? e.browse_median ?? e.browse_avg ?? null).filter(Boolean);
    const trend = calcTrend(prices);

    detailEl.innerHTML = renderDetail(data, entries, trend);
    initChart(entries);

    detailEl.querySelector("#btnDeleteHist")?.addEventListener("click", async () => {
      const ok = await Modal.confirm(I18N.t('hist.modal.del_title'), `${I18N.t('hist.modal.del_body')} "${esc(data.title || ean)}"?`, { confirmLabel: I18N.t('hist.modal.del_confirm'), danger: true });
      if (!ok) return;
      await Storage.deleteHistory(ean);
      _selectedEan = null;
      await loadList(container);
      detailEl.innerHTML = renderDetailEmpty();
      Toast.success("Gelöscht");
    });

    // Per-entry delete — event delegation (remove old before attaching new)
    if (detailEl._delDelegate) detailEl.removeEventListener("click", detailEl._delDelegate);
    detailEl._delDelegate = async (e) => {
      const delBtn = e.target.closest(".btn-hist-del-entry");
      if (!delBtn) return;
      const ts = delBtn.dataset.ts;
      if (!ts) return;
      const ok = await Modal.confirm(I18N.t('hist.modal.del_entry_title'), `${I18N.t('hist.modal.del_entry_body')} ${fmtDate(ts)}?`, { confirmLabel: I18N.t('hist.modal.del_confirm'), danger: true });
      if (!ok) return;
      const res = await Storage.deleteHistoryEntry(ean, ts);
      if (res?.ok) {
        Toast.success(I18N.t('hist.toast.deleted'), I18N.t('hist.toast.entry_removed'));
        loadDetail(ean, container);
      } else {
        Toast.error(I18N.t('hist.toast.err'), I18N.t('hist.toast.err_sub'));
      }
    };
    detailEl.addEventListener("click", detailEl._delDelegate);
  }

  function calcTrend(prices) {
    if (prices.length < 2) return { dir: "flat", pct: 0, first: prices[0], last: prices[prices.length-1] };
    const first = prices[0];
    const last = prices[prices.length - 1];
    if (!first) return { dir: "flat", pct: 0, first, last }; // guard: division by zero
    const pct = ((last - first) / first) * 100;
    return { dir: pct > 1.5 ? "up" : pct < -1.5 ? "down" : "flat", pct, first, last };
  }

  function renderDetail(data, entries, trend) {
    const trendIcon = trend.dir === "up"
      ? `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 12L8 6l3 3 5-5M13 4h3v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : trend.dir === "down"
      ? `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4L8 10l3-3 5 5M13 12h3v-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

    const prices   = entries.map(e => e.research_avg ?? e.browse_median ?? e.browse_avg).filter(Boolean);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;
    const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    const lastEntry = entries[entries.length - 1];
    const curPrice  = lastEntry?.research_avg ?? lastEntry?.browse_median ?? lastEntry?.browse_avg;
    const totalQty  = entries.reduce((s, e) => s + (e.qty ?? 0), 0);

    // Range bar position: where current price sits between min and max (0–100%)
    const rangePos = (maxPrice > minPrice && curPrice != null)
      ? Math.min(100, Math.max(0, Math.round(((curPrice - minPrice) / (maxPrice - minPrice)) * 100)))
      : 50;

    const trendPillClass = trend.dir === "up" ? "hist-trend-up" : trend.dir === "down" ? "hist-trend-down" : "hist-trend-flat";
    const trendLabel = trend.dir === "flat" ? I18N.t('hist.trend.stable') : `${trend.pct > 0 ? "+" : ""}${trend.pct.toFixed(1)}%`;

    return `
      <div class="col gap-16">

        <!-- Header: title + current price + trend pill + range bar -->
        <div class="panel panel-sm">
          <div class="row-between" style="align-items:flex-start">
            <div style="flex:1;min-width:0;padding-right:16px">
              <div style="font-weight:700;font-size:15px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(data.title || data.ean)}</div>
              <div style="font-size:11px;color:var(--dim);font-family:var(--font-mono);margin-top:3px">${esc(data.ean)} · ${entries.length} ${I18N.t('hist.detail.datapoints')}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:7px;flex-shrink:0">
              <div style="font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;color:var(--text-primary)">${fmtEur(curPrice)}</div>
              <span class="hist-trend-pill ${trendPillClass}">${trendIcon} ${trendLabel}</span>
            </div>
          </div>

          <!-- Price range bar: Tief → Aktuell → Hoch -->
          <div class="hist-range-wrap">
            <div class="hist-range-labels">
              <span>${I18N.t('hist.range.low')} ${fmtEur(minPrice)}</span>
              <span style="color:var(--accent);font-weight:600">Ø ${fmtEur(avgPrice)}</span>
              <span>${I18N.t('hist.range.high')} ${fmtEur(maxPrice)}</span>
            </div>
            <div class="hist-range-track">
              <div class="hist-range-fill" style="width:${rangePos}%">
                <div class="hist-range-dot"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- KPI grid — reuse Amazon SaaS tile pattern -->
        <div class="fc-amz-kpi-grid">
          <div class="fc-amz-kpi">
            <div class="fc-amz-kpi-v">${fmtEur(curPrice)}</div>
            <div class="fc-amz-kpi-l">${I18N.t('hist.kpi.current')}</div>
          </div>
          <div class="fc-amz-kpi">
            <div class="fc-amz-kpi-v" style="color:var(--green)">${fmtEur(minPrice)}</div>
            <div class="fc-amz-kpi-l">${I18N.t('hist.kpi.lowest')}</div>
          </div>
          <div class="fc-amz-kpi">
            <div class="fc-amz-kpi-v" style="color:var(--red)">${fmtEur(maxPrice)}</div>
            <div class="fc-amz-kpi-l">${I18N.t('hist.kpi.highest')}</div>
          </div>
          <div class="fc-amz-kpi">
            <div class="fc-amz-kpi-v">${totalQty > 0 ? totalQty : "—"}</div>
            <div class="fc-amz-kpi-l">${I18N.t('hist.kpi.sales_total')}</div>
          </div>
        </div>

        <!-- Chart -->
        <div class="panel">
          <div class="row-between mb-8">
            <h3 class="panel-title" style="margin-bottom:0">${I18N.t('hist.chart.title')}</h3>
            <span class="badge badge-gray">${I18N.t('hist.chart.last')} ${entries.length} ${I18N.t('hist.chart.datapoints')}</span>
          </div>
          <div class="chart-container" style="height:200px">
            <canvas id="histChart"></canvas>
          </div>
        </div>

        <!-- Data table — color-coded vs. average -->
        <div class="panel" style="padding:0;overflow:hidden">
          <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
            <span class="panel-title" style="margin:0">${I18N.t('hist.table.title')}</span>
            <button class="btn btn-danger btn-sm" id="btnDeleteHist">${I18N.t('hist.delete_btn')}</button>
          </div>
          <div class="table-wrap" style="max-height:240px;overflow-y:auto">
            <table class="table">
              <thead>
                <tr>
                  <th>${I18N.t('hist.table.date')}</th>
                  <th class="col-right">${I18N.t('hist.table.avg_vk')}</th>
                  <th class="col-right">${I18N.t('hist.table.vs_avg')}</th>
                  <th class="col-right">${I18N.t('hist.table.browse')}</th>
                  <th class="col-right">${I18N.t('hist.table.qty')}</th>
                  <th class="col-right">${I18N.t('hist.table.source')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${[...entries].reverse().map(e => {
                  const price = e.research_avg;
                  const diff  = price != null && avgPrice ? ((price - avgPrice) / avgPrice * 100) : null;
                  const priceColor = price != null
                    ? price > avgPrice * 1.02 ? ";color:var(--green)" : price < avgPrice * 0.98 ? ";color:var(--red)" : ""
                    : "";
                  const diffColor = diff != null
                    ? diff > 2 ? "var(--green)" : diff < -2 ? "var(--red)" : "var(--text-muted)"
                    : "var(--text-muted)";
                  return `
                  <tr>
                    <td style="font-size:12px">${fmtDate(e.ts)}</td>
                    <td class="col-right col-num" style="font-size:12px${priceColor}">${fmtEur(price)}</td>
                    <td class="col-right" style="font-size:11px;color:${diffColor};font-variant-numeric:tabular-nums">
                      ${diff != null ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)}%` : "—"}
                    </td>
                    <td class="col-right col-num" style="font-size:12px;color:var(--text-muted)">${fmtEur(e.browse_median ?? e.browse_avg)}</td>
                    <td class="col-right col-num" style="font-size:12px">${e.qty != null ? e.qty : (e.sales_30d != null ? e.sales_30d : "—")}</td>
                    <td class="col-right"><span class="badge ${e.from_series ? "badge-gray" : "badge-green"}" style="font-size:9px">${e.from_series ? I18N.t('hist.table.research') : I18N.t('hist.table.live')}</span></td>
                    <td><button class="btn btn-ghost btn-icon btn-hist-del-entry" data-ts="${esc(e.ts)}" title="Eintrag löschen" style="padding:2px 5px;opacity:.5"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M13 4l-1 10H4L3 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></td>
                  </tr>
                `}).join("")}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    `;
  }

  function initChart(entries) {
    const ctx = document.getElementById("histChart");
    if (!ctx) return;

    const hasQty = entries.some(e => e.qty != null);

    const labels       = entries.map(e => fmtDate(e.ts));
    const researchData = entries.map(e => e.research_avg ?? null);
    const browseData   = entries.map(e => e.browse_median ?? e.browse_avg ?? null);
    const qtyData      = entries.map(e => e.qty ?? 0);

    _chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          // Qty bars — background
          ...(hasQty ? [{
            type: "bar",
            label: I18N.t('hist.chart.sales_day'),
            data: qtyData,
            backgroundColor: "rgba(99,102,241,0.12)",
            borderColor: "transparent",
            borderWidth: 0,
            yAxisID: "yQty",
            order: 3,
          }] : []),
          // Research / avg sold price line
          {
            type: "line",
            label: I18N.t('hist.chart.avg_price'),
            data: researchData,
            borderColor: "#6366F1",
            backgroundColor: "rgba(99,102,241,0.08)",
            borderWidth: 2,
            fill: !hasQty,
            tension: 0.3,
            pointRadius: entries.length <= 14 ? 3 : 1,
            pointHoverRadius: 5,
            pointBackgroundColor: "#6366F1",
            pointBorderColor: "transparent",
            spanGaps: true,
            yAxisID: "yPrice",
            order: 1,
          },
          // Browse price (secondary line — dashed, only when both sources present)
          ...(browseData.some(v => v != null) ? [{
            type: "line",
            label: I18N.t('hist.chart.browse_price'),
            data: browseData,
            borderColor: "#10B981",
            borderWidth: 1.5,
            fill: false,
            tension: 0.3,
            pointRadius: entries.length <= 14 ? 2 : 0,
            pointHoverRadius: 4,
            pointBackgroundColor: "#10B981",
            pointBorderColor: "transparent",
            borderDash: [4, 3],
            spanGaps: true,
            yAxisID: "yPrice",
            order: 2,
          }] : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        devicePixelRatio: window.devicePixelRatio || 1,
        animation: { duration: 300 },
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: { font: { size: 11, family: "Inter, sans-serif" }, color: "#94A3B8", boxWidth: 10, boxHeight: 2, padding: 12 },
          },
          tooltip: {
            backgroundColor: "#16161F",
            borderColor: "#2E2E42",
            borderWidth: 1,
            titleColor: "#F1F5F9",
            bodyColor: "#94A3B8",
            callbacks: {
              label: c => c.dataset.label === I18N.t('hist.chart.sales_day')
                ? ` ${I18N.t('hist.chart.sales_label')}: ${c.parsed.y} ${I18N.t('hist.chart.units')}`
                : ` ${c.dataset.label}: ${fmtEur(c.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(30,30,46,0.6)", drawBorder: false },
            ticks: { font: { size: 10 }, color: "#475569", maxTicksLimit: 10, maxRotation: 0 },
          },
          yPrice: {
            position: "left",
            grid: { color: "rgba(30,30,46,0.6)", drawBorder: false },
            ticks: { font: { size: 10 }, color: "#475569", callback: v => fmtEur(v) },
          },
          ...(hasQty ? {
            yQty: {
              position: "right",
              grid: { drawOnChartArea: false },
              ticks: { font: { size: 10 }, color: "#475569", maxTicksLimit: 4 },
              title: { display: true, text: I18N.t('hist.chart.units'), color: "#475569", font: { size: 9 } },
            },
          } : {}),
        },
      },
    });
  }

  return { mount, unmount };
})();
