/* Flipcheck v2 — Verkaufs-Tracker */
const SalesView = (() => {
  let _el       = null;
  let _chart    = null;
  let _chartDnt = null;
  let _allSold  = [];
  let _sort     = { key: "sold_at", dir: -1 };
  let _filterMonth    = "";
  let _filterPlatform = "";

  // Flat fees for non-eBay markets; eBay uses tiered calcEbayFee() from app.js
  const FLAT_FEES = { amz: 0.15, kaufland: 0.105, other: 0 };
  const PLATFORM_LABELS = { ebay: "eBay", amz: "Amazon", kaufland: "Kaufland", other: "Sonstige" };
  const MONTH_DE = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];

  // ── Helpers ──────────────────────────────────────────────────────────────
  // Intl formatter singletons — created once per IIFE, reused on every render/tooltip call
  const _fmtEurSales  = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const _fmtEurNoFrac = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const _collator     = new Intl.Collator("de-DE");  // reused for string sort comparisons

  function fmtEur(v) {
    if (v == null || isNaN(v)) return "—";
    return _fmtEurSales.format(v);
  }
  function fmtPct(v) {
    if (v == null || isNaN(v)) return "—";
    return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
  }
  function esc(s) {
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function fmtDate(s) {
    if (!s) return "—";
    try { return new Date(s).toLocaleDateString("de-DE", { day:"2-digit", month:"2-digit", year:"numeric" }); }
    catch { return s; }
  }

  function netProfit(item) {
    if (item.sell_price == null || item.ek == null) return 0;
    // Use the same formula as calcRealProfit in app.js (includes ship_in/ship_out + calcMarketFee)
    const single = (typeof calcRealProfit === "function" ? calcRealProfit(item) : null) ?? 0;
    return single * (item.qty || 1);
  }
  function itemRoi(item) {
    const cost = (item.ek || 0) * (item.qty || 1);
    // Return null for free/gifted items — ROI is undefined, not 0%
    return cost > 0 ? (netProfit(item) / cost) * 100 : null;
  }

  function last6Months() {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return months;
  }

  function calcMonthly(sold) {
    const map = {};
    sold.forEach(item => {
      const m = (item.sold_at || "").slice(0, 7);
      if (!m) return;
      if (!map[m]) map[m] = { revenue: 0, profit: 0, count: 0 };
      map[m].revenue += (item.sell_price || 0) * (item.qty || 1);
      map[m].profit  += netProfit(item);
      map[m].count++;
    });
    return last6Months().map(m => {
      const [y, mo] = m.split("-");
      return {
        month: m,
        label: `${MONTH_DE[parseInt(mo,10)-1]} ${y.slice(2)}`,
        ...(map[m] || { revenue: 0, profit: 0, count: 0 }),
      };
    });
  }

  function buildMonthOptions(sold) {
    const seen = new Set();
    sold.forEach(i => { const m = (i.sold_at || "").slice(0, 7); if (/^\d{4}-\d{2}$/.test(m)) seen.add(m); });
    return [...seen].sort().reverse().map(m => {
      const [y, mo] = m.split("-");
      const monthIdx = parseInt(mo, 10) - 1;
      const label = isNaN(monthIdx) || !MONTH_DE[monthIdx] ? m : `${MONTH_DE[monthIdx]} ${y}`;
      return `<option value="${m}">${label}</option>`;
    }).join("");
  }

  function applyFilters(sold) {
    return sold.filter(i => {
      if (_filterMonth    && !(i.sold_at || "").startsWith(_filterMonth))    return false;
      if (_filterPlatform && i.market !== _filterPlatform) return false;
      return true;
    });
  }

  function sortedSold(sold) {
    const k = _sort.key;
    return [...sold].sort((a, b) => {
      let va = a[k] ?? (k === "profit" ? netProfit(a) : k === "roi" ? itemRoi(a) : "");
      let vb = b[k] ?? (k === "profit" ? netProfit(b) : k === "roi" ? itemRoi(b) : "");
      if (k === "profit")     { va = netProfit(a); vb = netProfit(b); }
      if (k === "roi")        { va = itemRoi(a);   vb = itemRoi(b); }
      if (k === "sold_at")    { va = va || ""; vb = vb || ""; }
      if (typeof va === "string") return _sort.dir * _collator.compare(va, vb);
      return _sort.dir * ((va || 0) - (vb || 0));
    });
  }

  function exportCSV(sold) {
    const rows = [
      ["Produkt","EAN","EK","VK","Plattform","Fee %","Gewinn (netto)","ROI %","Datum"],
    ];
    sold.forEach(i => {
      const _vk2    = i.sell_price || 0;
      const _feeAmt = typeof calcMarketFee === "function"
        ? calcMarketFee(_vk2, i.market || "ebay", i.cat_id)
        : (i.market === "ebay" || !i.market)
          ? calcEbayFee(_vk2, i.cat_id || "sonstiges")
          : _vk2 * (FLAT_FEES[i.market || "other"] ?? 0);
      const fee = _vk2 > 0 ? ((_feeAmt / _vk2) * 100).toFixed(1) : "0.0";
      const prof = netProfit(i).toFixed(2).replace(".",",");
      const r    = (itemRoi(i) ?? 0).toFixed(1).replace(".",",");
      rows.push([
        `"${(i.title||i.ean||"").replace(/"/g,'""')}"`,
        i.ean || "",
        String(i.ek||0).replace(".",","),
        String(i.sell_price||0).replace(".",","),
        PLATFORM_LABELS[i.market] || i.market || "—",
        fee,
        prof,
        r,
        fmtDate(i.sold_at),
      ]);
    });
    const csv  = rows.map(r => r.join(";")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `flipcheck-verkäufe-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Steuerexport ─────────────────────────────────────────────────────────
  function _calcFeeAmt(item) {
    const vk = item.sell_price || 0;
    if (typeof calcMarketFee === "function") return calcMarketFee(vk, item.market || "ebay", item.cat_id);
    if (item.market === "ebay" || !item.market) return calcEbayFee(vk, item.cat_id || "sonstiges");
    return vk * (FLAT_FEES[item.market || "other"] ?? 0);
  }

  function exportTaxCSV(sold, year) {
    const yearItems = sold.filter(i => i.sold_at && new Date(i.sold_at).getFullYear() === year);
    if (yearItems.length === 0) { Toast.warning("Keine Daten", `Keine Verkäufe für ${year} gefunden.`); return; }
    yearItems.sort((a, b) => new Date(a.sold_at) - new Date(b.sold_at));

    const cols = [
      "Datum","Artikel","EAN","SKU","Zustand","Plattform",
      "Einkaufspreis (EK)","Verkaufspreis (VK)","Menge",
      "Marktplatz-Gebuehr","Versandeinnahme","Versandkosten",
      "Erstattung","Gebuehren-Rueckerstattung",
      "Netto-Gewinn","ROI %","Status",
      "Bestellnummer","Sendungsnummer",
    ];

    let totEk=0, totVk=0, totFee=0, totShipIn=0, totShipOut=0, totRefund=0, totProfit=0;

    const rows = yearItems.map(i => {
      const qty      = i.qty || 1;
      const ek       = (i.ek || 0) * qty;
      const vk       = (i.sell_price || 0) * qty;
      const fee      = _calcFeeAmt(i) * qty;
      const shipIn   = (i.ship_in  || 0) * qty;
      const shipOut  = (i.ship_out || 0) * qty;
      const refund   = i.refund_amount      || 0;
      const feeCredit= i.refund_fee_credit  || 0;
      const profit   = vk - ek - fee - shipOut + shipIn + feeCredit - refund;
      totEk += ek; totVk += vk; totFee += fee; totShipIn += shipIn;
      totShipOut += shipOut; totRefund += refund; totProfit += profit;
      const roi = ek > 0 ? ((profit / ek) * 100).toFixed(1) : "";
      const n = v => v !== 0 ? v.toFixed(2).replace(".",",") : "0,00";
      const q = s => `"${String(s ?? "").replace(/"/g,'""')}"`;
      return [
        fmtDate(i.sold_at), q(i.title||i.ean||""), i.ean||"", i.sku||"",
        FC?.CONDITION_LABELS?.[i.condition]||i.condition||"",
        PLATFORM_LABELS[i.market]||i.market||"Sonstige",
        n(ek), n(vk), qty, n(fee), n(shipIn), n(shipOut), n(refund), n(feeCredit),
        n(profit), roi?roi.replace(".",","):"",
        i.status==="RETURN"?"Retoure":"Verkauft",
        i.ebay_order_id||i.kaufland_order_id||"",
        i.tracking_number||"",
      ].join(";");
    });

    const n = v => v.toFixed(2).replace(".",",");
    const sumRow = [
      `GESAMT ${year}`, `"${yearItems.length} Artikel"`, "","","","",
      n(totEk), n(totVk), "", n(totFee), n(totShipIn), n(totShipOut),
      n(totRefund), "", n(totProfit), "", "", "", "",
    ].join(";");

    const csv  = [cols.join(";"), ...rows, "", sumRow].join("\r\n");
    const blob = new Blob(["\uFEFF"+csv], { type:"text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `flipcheck-steuerexport-${year}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    Toast.success("Steuerexport", `${yearItems.length} Verkäufe für ${year} exportiert.`);
  }

  function openTaxExportModal() {
    const years = [...new Set(
      _allSold.filter(i => i.sold_at).map(i => new Date(i.sold_at).getFullYear())
    )].sort((a, b) => b - a);
    if (years.length === 0) { Toast.warning("Keine Daten", "Noch keine Verkäufe vorhanden."); return; }

    const curYear    = new Date().getFullYear();
    const defaultYear = years.includes(curYear - 1) ? curYear - 1 : years[0];

    const statsHtml = years.map(y => {
      const items   = _allSold.filter(i => i.sold_at && new Date(i.sold_at).getFullYear() === y);
      const profit  = items.reduce((s, i) => s + netProfit(i), 0);
      const returns = items.filter(i => i.status === "RETURN").length;
      return `<label style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-elevated);margin-bottom:6px">
        <input type="radio" name="taxYear" value="${y}" ${y===defaultYear?"checked":""} style="accent-color:var(--accent)" />
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">${y}</div>
          <div style="font-size:12px;color:var(--text-muted)">${items.length} Verkäufe${returns>0?` · ${returns} Retouren`:""}</div>
        </div>
        <div style="font-size:13px;font-weight:600;color:${profit>=0?"var(--green)":"var(--red)"}">${fmtEur(profit)}</div>
      </label>`;
    }).join("");

    const body = `<div class="col gap-12">
      <div style="padding:10px 12px;border-radius:8px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.25);font-size:13px;color:var(--text-primary)">
        Export enthält alle steuerrelevanten Felder: EK, VK, Gebühren, Versand, Erstattungen, Nettogewinn und eine Summenzeile.
      </div>
      <div>
        <div class="text-xs text-muted font-semibold mb-8">Steuerjahr wählen</div>
        ${statsHtml}
      </div>
      <div class="text-xs text-muted" style="line-height:1.7">
        Felder: Datum · Artikel · EAN · SKU · Zustand · Plattform · EK · VK · Menge · Gebühr · Versandeinnahme · Versandkosten · Erstattung · Gebührenrückerstattung · <strong>Netto-Gewinn</strong> · ROI · Status · Bestellnr. · Sendungsnr.
      </div>
    </div>`;

    Modal.open({
      title: "📄 Steuerexport",
      body,
      width: 460,
      buttons: [
        { label: "Abbrechen", variant: "btn-ghost", action: () => Modal.close() },
        { label: "CSV exportieren", variant: "btn-primary", action: () => {
          const sel = document.querySelector('input[name="taxYear"]:checked');
          if (!sel) return;
          Modal.close();
          exportTaxCSV(_allSold, parseInt(sel.value));
        }},
      ],
    });
  }

  // ── Main render ──────────────────────────────────────────────────────────
  async function mount(el) {
    _el = el;
    _el.innerHTML = `<div class="sales-loading">
      <div class="skeleton" style="height:40px;width:200px;margin-bottom:16px"></div>
      <div class="skeleton" style="height:80px;border-radius:12px;margin-bottom:12px"></div>
      <div class="skeleton" style="height:220px;border-radius:12px"></div>
    </div>`;

    const { listInventory } = Storage;
    const items = await listInventory();
    _allSold = items.filter(i => (i.status === "SOLD" || i.status === "RETURN") && i.sell_price != null && i.ek != null);
    render();
  }

  function render() {
    if (!_el) return;
    const filtered = applyFilters(_allSold);
    _el.innerHTML = buildHTML(filtered);
    attachEvents(filtered);
    initCharts(filtered);
  }

  function buildHTML(filtered) {
    if (_allSold.length === 0) return buildEmpty();

    const totalCount   = filtered.length;
    const totalRevenue = filtered.reduce((s,i) => s + (i.sell_price||0)*(i.qty||1), 0);
    const totalProfit  = filtered.reduce((s,i) => s + netProfit(i), 0);
    const avgRoi       = filtered.length > 0
      ? filtered.reduce((s,i) => s + (itemRoi(i) ?? 0), 0) / filtered.length
      : 0;

    // All-time stats for stats bar pills
    const allCount  = _allSold.length;
    const allProfit = _allSold.reduce((s,i) => s + netProfit(i), 0);
    const allRoi    = allCount > 0 ? _allSold.reduce((s,i) => s + (itemRoi(i) ?? 0), 0) / allCount : 0;
    const isFiltered = _filterMonth || _filterPlatform;
    const returnItems   = _allSold.filter(i => i.status === "RETURN");
    const returnCount   = returnItems.length;
    const totalRefunded = returnItems.reduce((s, i) => s + (Number(i.refund_amount) || 0), 0);

    // Platform split (from filtered)
    const pSplit = {};
    filtered.forEach(i => { const m = i.market || "other"; pSplit[m] = (pSplit[m]||0)+1; });

    // Top 5 flips
    const top5 = [...filtered]
      .map(i => ({ ...i, _profit: netProfit(i), _roi: itemRoi(i) }))
      .sort((a,b) => b._profit - a._profit)
      .slice(0,5);

    return `
    <div class="page-header">
      <div class="page-header-left">
        <h1>${I18N.t('sal.title')}</h1>
        <p>${I18N.t('sal.subtitle')}</p>
        <div class="sales-stats-bar">
          <span class="sales-stat-pill"><b>${allCount}</b> ${I18N.t('sal.stats.total_sales')}</span>
          <span class="sales-stat-pill ${allProfit >= 0 ? "sales-stat-pill-green" : "sales-stat-pill-red"}">
            <b>${fmtEur(allProfit)}</b> ${I18N.t('sal.stats.total_profit')}
          </span>
          <span class="sales-stat-pill ${allRoi >= 15 ? "sales-stat-pill-yellow" : ""}">
            <b>Ø ${fmtPct(allRoi)}</b> ${I18N.t('sal.stats.roi')}
          </span>
          ${returnCount > 0 ? `<span class="sales-stat-pill sales-stat-pill-red"><b>${returnCount}</b> Rücksendung${returnCount !== 1 ? "en" : ""} · ${fmtEur(totalRefunded)} erstattet</span>` : ""}
          ${isFiltered ? `<span class="sales-stat-pill sales-stat-pill-accent"><b>${totalCount}</b> ${I18N.t('sal.stats.filtered')}</span>` : ""}
        </div>
      </div>
      <div class="page-header-right">
        <select class="input input-sm" id="selFilterMonth" style="width:130px">
          <option value="">${I18N.t('sal.filter.all_months')}</option>
          ${buildMonthOptions(_allSold)}
        </select>
        <select class="input input-sm" id="selFilterPlatform" style="width:120px">
          <option value="">${I18N.t('sal.filter.all_plat')}</option>
          <option value="ebay">eBay</option>
          <option value="amz">Amazon</option>
          <option value="kaufland">Kaufland</option>
          <option value="other">${I18N.t('sal.filter.other')}</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="btnExportCSV">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="margin-right:4px">
            <path d="M14 10v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          CSV
        </button>
        <button class="btn btn-secondary btn-sm" id="btnTaxExport">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="margin-right:4px">
            <rect x="2" y="1" width="10" height="13" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
            <path d="M5 5h5M5 8h5M5 11h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            <path d="M11 10l2 2-2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Steuerexport
        </button>
      </div>
    </div>

    <!-- KPI Cards -->
    <div class="sales-kpi-grid mb-16">
      <div class="comp-kpi-tile${totalCount > 0 ? " comp-kpi-accent" : ""}">
        <div class="comp-kpi-val">${totalCount}</div>
        <div class="comp-kpi-lbl">${I18N.t('sal.kpi.sales')}${isFiltered ? ` ${I18N.t('sal.kpi.filtered')}` : ""}</div>
      </div>
      <div class="comp-kpi-tile">
        <div class="comp-kpi-val">${fmtEur(totalRevenue)}</div>
        <div class="comp-kpi-lbl">${I18N.t('sal.kpi.revenue')}</div>
      </div>
      <div class="comp-kpi-tile${totalProfit > 0 ? " comp-kpi-green" : totalProfit < 0 ? " comp-kpi-red" : ""}">
        <div class="comp-kpi-val">${fmtEur(totalProfit)}</div>
        <div class="comp-kpi-lbl">${I18N.t('sal.kpi.profit')}</div>
      </div>
      <div class="comp-kpi-tile${avgRoi >= 15 ? " comp-kpi-green" : avgRoi < 0 ? " comp-kpi-red" : ""}">
        <div class="comp-kpi-val">${fmtPct(avgRoi)}</div>
        <div class="comp-kpi-lbl">${I18N.t('sal.kpi.avg_roi')}</div>
      </div>
    </div>

    <!-- Charts Row -->
    <div class="sales-charts-row mb-16">
      <div class="panel sales-chart-main">
        <div class="kpi-label mb-12">${I18N.t('sal.chart.monthly')}</div>
        <div class="chart-wrap" style="height:180px">
          <canvas id="salesChartBar"></canvas>
        </div>
      </div>
      <div class="panel sales-chart-side">
        <div class="kpi-label mb-12">${I18N.t('sal.chart.platform')}</div>
        ${Object.keys(pSplit).length > 0 ? `
          <div class="chart-wrap" style="height:140px">
            <canvas id="salesChartDnt"></canvas>
          </div>
        ` : `<div class="sales-empty-mini">${I18N.t('sal.chart.no_data')}</div>`}
      </div>
    </div>

    <!-- Top 5 + Table row -->
    <div class="sales-bottom-row mb-16">
      <div class="panel">
        <div class="kpi-label mb-12">${I18N.t('sal.top5.title')}</div>
        ${top5.length > 0 ? `
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th>${I18N.t('sal.th.product')}</th>
            <th class="col-right">EK</th>
            <th class="col-right">VK</th>
            <th class="col-right">${I18N.t('sal.th.profit')}</th>
            <th class="col-right">${I18N.t('sal.th.roi')}</th>
          </tr></thead>
          <tbody>
            ${top5.map(f => `<tr>
              <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(f.title||f.ean)}">${esc((f.title||f.ean||"—").slice(0,28))}</td>
              <td class="col-right col-num text-muted">${fmtEur(f.ek)}</td>
              <td class="col-right col-num">${fmtEur(f.sell_price)}</td>
              <td class="col-right col-num ${f._profit >= 0 ? "text-green" : "text-red"}">${fmtEur(f._profit)}</td>
              <td class="col-right"><span class="badge ${f._roi>=15?"badge-green":f._roi>=0?"badge-yellow":"badge-red"}">${fmtPct(f._roi)}</span></td>
            </tr>`).join("")}
          </tbody>
        </table>` : `<div class="sales-empty-mini">${I18N.t('sal.empty.period')}</div>`}
      </div>
    </div>

    <!-- Full Sales Table -->
    <div class="panel">
      <div class="row-between mb-12">
        <div class="kpi-label">${I18N.t('sal.all.title')}</div>
        <div class="text-xs text-muted">${filtered.length} ${I18N.t('sal.entries')}</div>
      </div>
      ${filtered.length > 0 ? buildTable(filtered) : `<div class="sales-empty-mini">${I18N.t('sal.empty.filter')}</div>`}
    </div>
    `;
  }

  function buildTable(filtered) {
    const rows = sortedSold(filtered);
    const sortIcon = (k) => _sort.key === k
      ? (_sort.dir === -1 ? " ↓" : " ↑") : "";

    return `
    <div style="overflow-x:auto">
    <table class="data-table sales-table">
      <thead><tr>
        <th data-sort="title" style="cursor:pointer">${I18N.t('sal.th.product')}${sortIcon("title")}</th>
        <th data-sort="ean"   style="cursor:pointer">EAN${sortIcon("ean")}</th>
        <th class="col-right" data-sort="ek"        style="cursor:pointer">EK${sortIcon("ek")}</th>
        <th class="col-right" data-sort="sell_price" style="cursor:pointer">VK${sortIcon("sell_price")}</th>
        <th data-sort="market" style="cursor:pointer">${I18N.t('sal.th.platform')}${sortIcon("market")}</th>
        <th class="col-right">${I18N.t('sal.th.fee')}</th>
        <th class="col-right" data-sort="profit"    style="cursor:pointer">${I18N.t('sal.th.profit')}${sortIcon("profit")}</th>
        <th class="col-right" data-sort="roi"       style="cursor:pointer">${I18N.t('sal.th.roi')}${sortIcon("roi")}</th>
        <th class="col-right" data-sort="sold_at"   style="cursor:pointer">${I18N.t('sal.th.date')}${sortIcon("sold_at")}</th>
        <th class="col-right"></th>
      </tr></thead>
      <tbody>
        ${rows.map(i => {
          const profit  = netProfit(i);
          const roi     = itemRoi(i);
          const _vk     = i.sell_price || 0;
          const _feeAmt = typeof calcMarketFee === "function"
            ? calcMarketFee(_vk, i.market || "ebay", i.cat_id)
            : (i.market === "ebay" || !i.market)
              ? calcEbayFee(_vk, i.cat_id || "sonstiges")
              : _vk * (FLAT_FEES[i.market || "other"] ?? 0);
          const fee     = _vk > 0 ? _feeAmt / _vk : 0;
          const plat    = PLATFORM_LABELS[i.market] || i.market || "—";
          const isReturn  = i.status === "RETURN";
          const isPartial = isReturn && i.refund_amount > 0 && i.refund_amount < (i.sell_price || 0);
          const returnBadge = isReturn
            ? `<span style="display:inline-block;font-size:9px;padding:1px 5px;border-radius:4px;background:var(--red,#ef4444);color:#fff;margin-left:6px;vertical-align:middle">${isPartial ? "Teilerstattung" : "Rücksendung"}</span>`
            : "";
          return `<tr${isReturn ? ' style="opacity:0.75"' : ""}>
            <td style="max-width:200px">
              <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(i.title||i.ean)}">${esc((i.title||i.ean||"—").slice(0,32))}${returnBadge}</div>
            </td>
            <td class="text-mono text-muted" style="font-size:11px">${esc(i.ean||"—")}</td>
            <td class="col-right col-num text-muted">${fmtEur(i.ek)}</td>
            <td class="col-right col-num">${fmtEur(i.sell_price)}</td>
            <td><span class="sales-plat-badge sales-plat-${esc(i.market||"other")}">${esc(plat)}</span></td>
            <td class="col-right text-muted text-xs">${(fee*100).toFixed(1)}%</td>
            <td class="col-right col-num ${profit >= 0 ? "sales-profit-pos" : "sales-profit-neg"}">${fmtEur(profit)}</td>
            <td class="col-right"><span class="badge ${roi==null?"badge-neutral":roi>=15?"badge-green":roi>=0?"badge-yellow":"badge-red"}">${roi!=null?fmtPct(roi):"—"}</span></td>
            <td class="col-right text-muted text-sm">${fmtDate(i.sold_at)}</td>
            <td class="col-right">
              <button class="btn btn-ghost btn-icon btn-undo-sale" data-id="${esc(i.id)}" title="Verkauf rückgängig">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 1 1 1.5 4M2 3v5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>`;
  }

  function buildEmpty() {
    return `
    <div class="sales-empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" class="text-muted">
        <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM9 9l6 6M15 9l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <div class="sales-empty-title">${I18N.t('sal.empty.title')}</div>
      <div class="sales-empty-sub">${I18N.t('sal.empty.sub')}</div>
      <button class="btn btn-primary mt-12" id="btnGoInventory">${I18N.t('sal.btn.inventory')}</button>
    </div>`;
  }

  // ── Events ───────────────────────────────────────────────────────────────
  function attachEvents(filtered) {
    if (!_el) return;

    const selMonth = _el.querySelector("#selFilterMonth");
    if (selMonth) {
      selMonth.value = _filterMonth;
      selMonth.addEventListener("change", e => { _filterMonth = e.target.value; render(); });
    }
    const selPlat = _el.querySelector("#selFilterPlatform");
    if (selPlat) {
      selPlat.value = _filterPlatform;
      selPlat.addEventListener("change", e => { _filterPlatform = e.target.value; render(); });
    }

    const btnExport = _el.querySelector("#btnExportCSV");
    if (btnExport) btnExport.addEventListener("click", () => exportCSV(filtered));

    const btnTaxExport = _el.querySelector("#btnTaxExport");
    if (btnTaxExport) btnTaxExport.addEventListener("click", () => openTaxExportModal());

    const btnGoInv = _el.querySelector("#btnGoInventory");
    if (btnGoInv) btnGoInv.addEventListener("click", () => {
      if (typeof navigateTo === "function") navigateTo("inventory");
    });

    // Sort headers
    _el.querySelectorAll("[data-sort]").forEach(th => {
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        if (_sort.key === k) _sort.dir *= -1;
        else { _sort.key = k; _sort.dir = -1; }
        render();
      });
    });

    // Undo sale
    _el.addEventListener("click", async e => {
      const btn = e.target.closest(".btn-undo-sale");
      if (!btn) return;
      const id = btn.dataset.id;
      const item = _allSold.find(i => i.id === id);
      if (!item) return;

      const name = (item.title || item.ean || "Artikel").slice(0, 30);
      // Use Modal.confirm if available (design-system), fall back to native confirm
      const confirmed = typeof Modal !== "undefined"
        ? await Modal.confirm(I18N.t('sal.confirm.undo'), `"${name}" ${I18N.t('sal.toast.undo_sub')}`)
        : confirm(`${I18N.t('sal.confirm.undo')} "${name}"?\n${I18N.t('sal.toast.undo_sub')}`);
      if (!confirmed) return;

      try {
        const { upsertItem } = Storage;
        await upsertItem({ ...item, status: "IN_STOCK", sell_price: null, sold_at: null, refund_amount: 0, refund_date: null, refund_fee_credit: 0, ebay_order_id: null });
        _allSold = _allSold.filter(i => i.id !== id);
        if (typeof Toast !== "undefined") Toast.success(I18N.t('sal.toast.undo'), I18N.t('sal.toast.undo_sub'));
        render();
      } catch {
        if (typeof Toast !== "undefined") Toast.error(I18N.t('sal.toast.undo_failed'), I18N.t('sal.toast.undo_err'));
      }
    });
  }

  // ── Charts ───────────────────────────────────────────────────────────────
  function initCharts(filtered) {
    if (!_el) return;

    // Destroy previous charts
    if (_chart)    { try { _chart.destroy();    } catch {} _chart    = null; }
    if (_chartDnt) { try { _chartDnt.destroy(); } catch {} _chartDnt = null; }

    // Read CSS design tokens at runtime — single source of truth
    const _css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

    const C = {
      accent: _css("--accent"),
      green:  _css("--green"),
      red:    _css("--red"),
      text:   _css("--text-muted"),
      font:   _css("--font"),
    };

    const CHART_PALETTE = [
      _css("--accent"), _css("--green"), _css("--yellow"),
      _css("--red"),    _css("--blue"),  _css("--purple"),
    ];

    const CHART_GRID = { color: _css("--border") + "99", drawBorder: false };

    const _tooltip = (extra = {}) => ({
      backgroundColor: _css("--bg-elevated"),
      borderColor:     _css("--border-strong"),
      borderWidth:     1,
      titleColor:      _css("--text-primary"),
      bodyColor:       _css("--text-secondary"),
      ...extra,
    });

    if (typeof Chart === "undefined") return;
    Chart.defaults.font.family    = C.font;
    Chart.defaults.color          = C.text;
    Chart.defaults.devicePixelRatio = window.devicePixelRatio || 1;
    Chart.defaults.animation      = { duration: 300 };
    Chart.defaults.resize         = { delay: 100 };

    // ── Bar Chart: Gewinn/Monat ──────────────────────────────────────────
    const ctxBar = _el.querySelector("#salesChartBar");
    if (ctxBar) {
      const monthly = calcMonthly(filtered);
      _chart = new Chart(ctxBar, {
        type: "bar",
        data: {
          labels: monthly.map(m => m.label),
          datasets: [
            {
              label: I18N.t('sal.ds.profit'),
              data:  monthly.map(m => +m.profit.toFixed(2)),
              backgroundColor: monthly.map(m => m.profit >= 0 ? C.accent + "BF" : C.red + "99"),
              borderColor:     monthly.map(m => m.profit >= 0 ? C.accent : C.red),
              borderWidth: 1.5,
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: _tooltip({ callbacks: { label: ctx => ` ${_fmtEurSales.format(ctx.parsed.y)}` } }),
          },
          scales: {
            x: { grid: CHART_GRID, ticks: { font: { size: 10 }, color: C.text } },
            y: {
              grid: CHART_GRID,
              ticks: {
                font: { size: 10 },
                color: C.text,
                callback: v => _fmtEurNoFrac.format(v),
              },
            },
          },
        },
      });
    }

    // ── Donut Chart: Plattform-Split ─────────────────────────────────────
    const ctxDnt = _el.querySelector("#salesChartDnt");
    if (ctxDnt) {
      const pSplit = {};
      filtered.forEach(i => { const m = i.market || "other"; pSplit[m] = (pSplit[m]||0)+1; });
      const labels = Object.keys(pSplit).map(k => PLATFORM_LABELS[k] || k);
      const values = Object.values(pSplit);
      const COLORS = CHART_PALETTE;

      if (values.length > 0) {
        _chartDnt = new Chart(ctxDnt, {
          type: "doughnut",
          data: {
            labels,
            datasets: [{
              data:            values,
              backgroundColor: COLORS.slice(0, values.length),
              borderWidth:     0,
              hoverOffset:     4,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "68%",
            plugins: {
              legend: {
                position: "right",
                labels: { font: { size: 11, family: C.font }, color: C.text, boxWidth: 10, padding: 10 },
              },
              tooltip: _tooltip({ callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} ${I18N.t('an.chart.items')}` } }),
            },
          },
        });
      }
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  function unmount() {
    if (_chart)    { try { _chart.destroy();    } catch {} _chart    = null; }
    if (_chartDnt) { try { _chartDnt.destroy(); } catch {} _chartDnt = null; }
    _el = null;
  }

  return { mount, unmount };
})();
