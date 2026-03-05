/* Flipcheck v2 — Batch Flipcheck View */
const BatchView = (() => {
  let _container = null;
  let _results   = [];
  let _running   = false;
  let _vatMode   = "no_vat";
  let _ekMode    = "gross";

  // ─── eBay DE category fee structure (mirrors FlipcheckView) ──────────────
  const CATEGORIES = [
    // Geräte: 6,5 % bis €990, danach 3 %
    { id: "computer_tablets",  label: "Computer, Tablets & Netzwerk",   group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "drucker",           label: "Drucker",                         group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "foto_camcorder",    label: "Foto & Camcorder",                group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "handys",            label: "Handys & Kommunikation",          group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "haushaltsgeraete",  label: "Haushaltsgeräte",                 group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "konsolen",          label: "Konsolen / Videospiele",          group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "scanner",           label: "Scanner",                         group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "speicherkarten",    label: "Speicherkarten",                  group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "tv_video_audio",    label: "TV, Video & Audio",               group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "koerperpflege",     label: "Elektr. Körperpflege & Styling",  group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    // Zubehör: 11 % bis €990, danach 3 %
    { id: "drucker_zubehoer",  label: "Drucker- & Scanner-Zubehör",     group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "handy_zubehoer",    label: "Handy-Zubehör",                   group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "batterien",         label: "Haushaltsbatterien & Strom",      group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "kabel",             label: "Kabel & Steckverbinder",          group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "kameras_zubehoer",  label: "Kameras, Drohnen & Fotozubehör", group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "notebook_zubehoer", label: "Notebook- & Desktop-Zubehör",    group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "objektive",         label: "Objektive & Filter",              group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "stative",           label: "Stative & Zubehör",              group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "tablet_zubehoer",   label: "Tablet & eBook Zubehör",         group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "tastaturen_maeuse", label: "Tastaturen, Mäuse & Pointing",    group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "tv_zubehoer",       label: "TV- & Heim-Audio-Zubehör",       group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "pc_zubehoer",       label: "PC & Videospiele Zubehör",       group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "audio_zubehoer",    label: "Zubehör Audiogeräte",            group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    // Sonstige Flat-Rate
    { id: "mode",              label: "Mode / Bekleidung",               group: "Sonstiges (Flat)",    tiers: [[null, 0.15]]  },
    { id: "sport_freizeit",    label: "Sport & Freizeit",                group: "Sonstiges (Flat)",    tiers: [[null, 0.115]] },
    { id: "spielzeug",         label: "Spielzeug / LEGO",                group: "Sonstiges (Flat)",    tiers: [[null, 0.115]] },
    { id: "haushalt_garten",   label: "Haushalt & Garten",               group: "Sonstiges (Flat)",    tiers: [[null, 0.115]] },
    { id: "buecher",           label: "Bücher & Medien",                 group: "Sonstiges (Flat)",    tiers: [[null, 0.15]]  },
    { id: "sonstiges",         label: "Sonstiges",                       group: "Sonstiges (Flat)",    tiers: [[null, 0.13]]  },
  ];

  // ─── Tiered fee calculator ─────────────────────────────────────────────────
  function calcEbayFee(priceGross, catId) {
    const cat = CATEGORIES.find(c => c.id === catId) || CATEGORIES[CATEGORIES.length - 1];
    let fee = 0, remaining = Math.max(0, priceGross), prev = 0;
    for (const [threshold, rate] of cat.tiers) {
      if (threshold === null) { fee += remaining * rate; break; }
      const chunk = Math.min(remaining, threshold - prev);
      fee += chunk * rate;
      remaining -= chunk;
      prev = threshold;
      if (remaining <= 0) break;
    }
    return fee;
  }

  // ─── Full profit calc (frontend-side, no shipping for batch) ──────────────
  function calcProfit(vkGross, ekGross, catId, vatMode, ekMode) {
    if (!vkGross || vkGross <= 0) return null;
    const vat      = vatMode === "ust_19" ? 1.19 : 1.0;
    const feeGross = calcEbayFee(vkGross, catId);
    const feeNet   = feeGross / vat;
    const vkNet    = vkGross  / vat;
    const ekNet    = (vatMode === "ust_19" && ekMode === "gross") ? ekGross / vat : ekGross;
    const profit   = vkNet - feeNet - ekNet;
    const margin   = vkGross > 0 ? (profit / vkGross * 100) : 0;
    return { profit, margin, feeGross };
  }

  // ─── Build category <optgroup> HTML ────────────────────────────────────────
  function buildCatOptions(selectedId) {
    const groups = {};
    for (const c of CATEGORIES) {
      if (!groups[c.group]) groups[c.group] = [];
      groups[c.group].push(c);
    }
    return Object.entries(groups).map(([grp, cats]) =>
      `<optgroup label="${esc(grp)}">${
        cats.map(c => `<option value="${c.id}"${c.id === selectedId ? " selected" : ""}>${esc(c.label)}</option>`).join("")
      }</optgroup>`
    ).join("");
  }

  // ─── Scanner IPC callback (stable ref for add/remove) ─────────────────────
  function _onBatchScannerEan(ean) {
    if (!_container) return;
    const ta = _container.querySelector("#batchEanList");
    if (!ta) return;
    const current = ta.value.trim();
    ta.value = current ? current + "\n" + ean : ean;
    if (typeof Toast !== "undefined") Toast.success("EAN gescannt", `${ean} zur Liste hinzugefügt`);
  }

  // ─── Mount ─────────────────────────────────────────────────────────────────
  async function mount(container) {
    _container = container;
    _results   = [];
    _running   = false;

    // Load VAT / EK settings
    try {
      const s = await Storage.getSettings();
      _vatMode = s?.tax?.vat_mode || "no_vat";
      _ekMode  = s?.tax?.ek_mode  || "gross";
    } catch {}

    container.innerHTML = renderView();
    attachEvents(container);
    window.fc?.onScannerEan(_onBatchScannerEan);
  }

  function unmount() {
    _running   = false;
    window.fc?.offScannerEan(_onBatchScannerEan);
    _container = null;
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  function renderView() {
    const isVat = _vatMode === "ust_19";
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Batch Flipcheck</h1>
          <p>Mehrere Produkte gleichzeitig auf Profitabilität prüfen</p>
        </div>
        <div class="page-header-actions" id="batchHeaderActions">
          ${isVat
            ? `<div class="fc-info-pill fc-info-pill--accent">
                 <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#6366F1" stroke-width="1.2"/><path d="M8 5v3.5M8 10.5v.5" stroke="#6366F1" stroke-width="1.5" stroke-linecap="round"/></svg>
                 Regelbesteuerung 19%
               </div>`
            : ""
          }
        </div>
      </div>

      <div class="fc-split-380">

        <!-- Input Panel -->
        <div class="panel" id="batchInputPanel">
          <h3 class="panel-title">Produkte eingeben</h3>

          <!-- Drop Zone -->
          <div class="drop-zone" id="batchDropZone">
            <svg class="drop-zone-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <h3>CSV droppen</h3>
            <p>oder klicken zum Auswählen</p>
            <input type="file" id="batchFileInput" accept=".csv,.txt" style="display:none" />
          </div>

          <div class="row" style="margin:12px 0;gap:8px;align-items:center">
            <div style="flex:1;height:1px;background:var(--border)"></div>
            <span class="text-xs text-muted">oder manuell</span>
            <div style="flex:1;height:1px;background:var(--border)"></div>
          </div>

          <!-- Manual Input -->
          <div class="input-group" style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <label class="input-label" style="margin:0">EAN-Liste (eine pro Zeile)</label>
              <button class="btn btn-ghost btn-sm" id="batchScanBtn" title="Handy-Scanner — scannt in diese Liste" style="font-size:14px;padding:2px 8px">📷 Scanner</button>
            </div>
            <textarea id="batchEanList" class="textarea" rows="5" placeholder="4010355360205&#10;4006381333955&#10;4250538302777…"></textarea>
          </div>

          <div class="input-group" style="margin-bottom:12px">
            <label class="input-label">Standard-Einkaufspreis${isVat ? " <span style='color:var(--accent);font-weight:500'>(brutto)</span>" : " (€)"}</label>
            <div class="input-prefix-wrap">
              <span class="prefix">€</span>
              <input id="batchDefaultEk" class="input" type="number" step="0.01" min="0.01" placeholder="z.B. 18.50" />
            </div>
            <span class="input-hint">${isVat ? "Regelbesteuerung aktiv — Profit netto gerechnet" : "Wird für alle EANs verwendet"}</span>
          </div>

          <div class="input-group" style="margin-bottom:12px">
            <label class="input-label">eBay-Kategorie</label>
            <select id="batchCategory" class="select">
              ${buildCatOptions("sonstiges")}
            </select>
            <span class="input-hint">Gebühr wird für alle Produkte im Batch verwendet</span>
          </div>

          <div class="input-group" style="margin-bottom:16px">
            <label class="input-label">Modus</label>
            <select id="batchMode" class="select">
              <option value="mid">MID — Margin ≥20%, Profit ≥€7</option>
              <option value="high">HIGH — Margin ≥25%, Profit ≥€10</option>
              <option value="low">LOW — Margin ≥15%, Profit ≥€5</option>
            </select>
          </div>

          <button class="btn btn-primary" id="btnBatchRun" style="width:100%;justify-content:center">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><polygon points="4,2 14,8 4,14" fill="currentColor"/></svg>
            Batch starten
          </button>
          <button class="btn btn-ghost btn-sm" id="btnBatchStop" style="width:100%;justify-content:center;margin-top:6px;display:none">
            Abbrechen
          </button>
        </div>

        <!-- Results Panel -->
        <div id="batchResultsPanel">
          <div id="batchProgress" style="display:none" class="panel panel-sm mb-16">
            <div class="batch-progress">
              <div class="batch-progress-row">
                <span class="batch-progress-label" id="batchProgressLabel">Verarbeite…</span>
                <span class="batch-progress-count" id="batchProgressCount">0 / 0</span>
              </div>
              <div class="progress-wrap">
                <div class="progress-bar" id="batchProgressBar" style="width:0%"></div>
              </div>
            </div>
          </div>

          <div id="batchResults">
            ${renderResultsEmpty()}
          </div>
        </div>

      </div>
    `;
  }

  function renderResultsEmpty() {
    return `
      <div class="empty-state" style="padding:60px">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
        <p class="empty-title">Keine Ergebnisse</p>
        <p class="empty-sub">EAN-Liste eingeben oder CSV importieren und Batch starten.</p>
      </div>
    `;
  }

  // Shell rendered once at start of batch — tbody filled incrementally
  function renderResultsTableShell() {
    return `
      <div class="batch-summary-bar" id="batchSummaryPanel">
        <div class="batch-sum-kpi">
          <span class="batch-sum-val text-green" id="bSum-buy">0</span>
          <span class="batch-sum-label">BUY</span>
        </div>
        <div class="batch-sum-sep"></div>
        <div class="batch-sum-kpi">
          <span class="batch-sum-val text-yellow" id="bSum-hold">0</span>
          <span class="batch-sum-label">HOLD</span>
        </div>
        <div class="batch-sum-sep"></div>
        <div class="batch-sum-kpi">
          <span class="batch-sum-val text-red" id="bSum-skip">0</span>
          <span class="batch-sum-label">SKIP</span>
        </div>
        <div class="batch-sum-sep"></div>
        <div class="batch-sum-kpi">
          <span class="batch-sum-val" id="bSum-totalProfit">—</span>
          <span class="batch-sum-label">Ges. Profit</span>
        </div>
        <div class="batch-sum-sep"></div>
        <div class="batch-sum-kpi">
          <span class="batch-sum-val" id="bSum-avgMargin">—</span>
          <span class="batch-sum-label">⌀ Marge</span>
        </div>
        <div class="batch-sum-sep"></div>
        <div class="batch-sum-kpi">
          <span class="batch-sum-val text-muted" id="bSum-total">0</span>
          <span class="batch-sum-label">Gesamt</span>
        </div>
        <div class="batch-sum-actions">
          <button class="btn btn-secondary btn-sm" id="btnExportCsv">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 12v2h10v-2M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            CSV Export
          </button>
          <button class="btn btn-secondary btn-sm" id="btnAddBuyToInv">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="1" y="5" width="14" height="10" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M6 10h4M8 8v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            BUYs → Inventory
          </button>
        </div>
      </div>
      <div class="panel" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>EAN</th><th>Titel</th>
                <th class="col-right">EK</th><th class="col-right">Ø VK</th>
                <th class="col-right">Profit</th><th class="col-right">Marge</th>
                <th class="col-right">Verk./30d</th><th>Verdict</th><th></th>
              </tr>
            </thead>
            <tbody id="batchTbody"></tbody>
          </table>
        </div>
      </div>
    `;
  }

  // Loading skeleton row while API call is in flight
  function renderLoadingRow(ean) {
    return `
      <tr class="batch-row-loading" data-loading-ean="${esc(ean)}">
        <td style="font-family:var(--font-mono);font-size:11px;color:var(--dim)">${esc(ean)}</td>
        <td><span class="batch-skel" style="width:150px"></span></td>
        <td class="col-right"><span class="batch-skel" style="width:38px"></span></td>
        <td class="col-right"><span class="batch-skel" style="width:38px"></span></td>
        <td class="col-right"><span class="batch-skel" style="width:52px"></span></td>
        <td class="col-right"><span class="batch-skel" style="width:34px"></span></td>
        <td class="col-right"><span class="batch-skel" style="width:22px"></span></td>
        <td><span class="batch-skel" style="width:40px;height:18px;border-radius:9999px"></span></td>
        <td></td>
      </tr>
    `;
  }

  // Full re-render for when results are loaded after-the-fact (e.g. view re-mount)
  function renderResultsTable(results) {
    const html = renderResultsTableShell();
    const buy   = results.filter(r => r.verdict === "BUY").length;
    const hold  = results.filter(r => r.verdict === "HOLD").length;
    const skip  = results.filter(r => r.verdict === "SKIP").length;
    const error = results.filter(r => r.error).length;

    const buyResults  = results.filter(r => r.verdict === "BUY" && !r.error);
    const totalProfit = buyResults.reduce((s, r) => s + (r._calc?.profit ?? r.profit_median ?? 0), 0);
    const margins     = results.filter(r => !r.error).map(r => r._calc?.margin ?? r.margin_pct).filter(m => m != null);
    const avgMargin   = margins.length ? margins.reduce((s, m) => s + m, 0) / margins.length : null;

    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const tbody = wrap.querySelector("#batchTbody");
    if (tbody) tbody.innerHTML = results.map(r => renderResultRow(r)).join("");

    const bBuy    = wrap.querySelector("#bSum-buy");         if (bBuy)    bBuy.textContent    = buy;
    const bHold   = wrap.querySelector("#bSum-hold");        if (bHold)   bHold.textContent   = hold;
    const bSkip   = wrap.querySelector("#bSum-skip");        if (bSkip)   bSkip.textContent   = skip + error;
    const bTotal  = wrap.querySelector("#bSum-total");       if (bTotal)  bTotal.textContent  = results.length;
    const bProfit = wrap.querySelector("#bSum-totalProfit");
    if (bProfit) {
      bProfit.textContent = totalProfit !== 0 ? fmtEur(totalProfit) : "—";
      bProfit.style.color = totalProfit > 0 ? "var(--green)" : totalProfit < 0 ? "var(--red)" : "";
    }
    const bMargin = wrap.querySelector("#bSum-avgMargin");
    if (bMargin) {
      bMargin.textContent = avgMargin != null ? fmtPct(avgMargin) : "—";
      bMargin.style.color = avgMargin != null
        ? (avgMargin >= 20 ? "var(--green)" : avgMargin >= 10 ? "var(--yellow)" : "var(--red)") : "";
    }
    return wrap.innerHTML;
  }

  function updateBatchSummary(container) {
    const buy   = _results.filter(r => r.verdict === "BUY").length;
    const hold  = _results.filter(r => r.verdict === "HOLD").length;
    const skip  = _results.filter(r => r.verdict === "SKIP" || (!r.verdict && !r.error)).length;
    const error = _results.filter(r => r.error).length;

    // Aggregate: total BUY profit + avg margin across all non-error results
    const buyResults  = _results.filter(r => r.verdict === "BUY" && !r.error);
    const totalProfit = buyResults.reduce((s, r) => s + (r._calc?.profit ?? r.profit_median ?? 0), 0);
    const margins     = _results.filter(r => !r.error).map(r => r._calc?.margin ?? r.margin_pct).filter(m => m != null);
    const avgMargin   = margins.length ? margins.reduce((s, m) => s + m, 0) / margins.length : null;

    const bBuy    = container?.querySelector("#bSum-buy");         if (bBuy)    bBuy.textContent    = buy;
    const bHold   = container?.querySelector("#bSum-hold");        if (bHold)   bHold.textContent   = hold;
    const bSkip   = container?.querySelector("#bSum-skip");        if (bSkip)   bSkip.textContent   = skip + error;
    const bTotal  = container?.querySelector("#bSum-total");       if (bTotal)  bTotal.textContent  = _results.length;

    const bProfit = container?.querySelector("#bSum-totalProfit");
    if (bProfit) {
      bProfit.textContent  = totalProfit !== 0 ? fmtEur(totalProfit) : "—";
      bProfit.style.color  = totalProfit > 0 ? "var(--green)" : totalProfit < 0 ? "var(--red)" : "var(--text-primary)";
    }
    const bMargin = container?.querySelector("#bSum-avgMargin");
    if (bMargin) {
      bMargin.textContent = avgMargin != null ? fmtPct(avgMargin) : "—";
      bMargin.style.color = avgMargin != null
        ? (avgMargin >= 20 ? "var(--green)" : avgMargin >= 10 ? "var(--yellow)" : "var(--red)")
        : "var(--text-primary)";
    }
  }

  function renderResultRow(r) {
    if (r.error) {
      return `
        <tr>
          <td class="text-mono text-xs text-dim">${esc(r.ean)}</td>
          <td colspan="6" style="font-size:12px;color:var(--red)">${esc(r.error)}</td>
          <td><span class="batch-vrd batch-vrd-err">Fehler</span></td>
          <td></td>
        </tr>
      `;
    }

    const vc = (r.verdict || "SKIP").toLowerCase();
    const vrdClass = vc === "buy" ? "batch-vrd-buy" : vc === "hold" ? "batch-vrd-hold" : "batch-vrd-skip";

    // Use frontend-calculated profit/margin (stored in r._calc)
    const profit = r._calc?.profit ?? r.profit_median ?? r.profit_avg ?? null;
    const margin = r._calc?.margin ?? r.margin_pct ?? null;
    const vk     = r.sell_price_median ?? r.sell_price_avg;

    const profitHtml = profit != null
      ? profit > 0
        ? `<div class="batch-profit batch-profit-pos">+${fmtEur(profit)}</div>`
        : profit < 0
          ? `<div class="batch-profit batch-profit-neg">${fmtEur(profit)}</div>`
          : `<span class="batch-profit batch-profit-neu">${fmtEur(profit)}</span>`
      : `<span class="text-dim">—</span>`;

    const marginHtml = margin != null
      ? `<span class="batch-marg ${margin >= 20 ? "batch-marg-hi" : margin >= 10 ? "batch-marg-mid" : "batch-marg-lo"}">${fmtPct(margin)}</span>`
      : `<span class="text-dim">—</span>`;

    return `
      <tr>
        <td class="text-mono text-xs text-dim">${esc(r.ean)}</td>
        <td style="max-width:200px">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px" title="${esc(r.title||r.ean)}">${esc(r.title||"—")}</div>
        </td>
        <td class="col-right col-num" style="font-size:12px">${fmtEur(r.ek)}</td>
        <td class="col-right col-num" style="font-size:12px">${vk != null ? fmtEur(vk) : "—"}</td>
        <td class="col-right">${profitHtml}</td>
        <td class="col-right">${marginHtml}</td>
        <td class="col-right col-num" style="font-size:12px;color:var(--text-muted)">${r.sales_30d != null ? r.sales_30d : "—"}</td>
        <td><span class="batch-vrd ${vrdClass}">${r.verdict || "SKIP"}</span></td>
        <td style="text-align:right">
          ${vc !== "skip" ? `
          <button class="btn btn-ghost btn-sm batch-listing-btn" data-ean="${esc(r.ean)}"
            style="font-size:10px;padding:2px 8px;white-space:nowrap">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="2" width="10" height="13" rx="1.2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M4 6h4M4 9h3M11 10l2 2 2-2M13 8v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Listing
          </button>` : ""}
        </td>
      </tr>
    `;
  }

  // ─── Events ────────────────────────────────────────────────────────────────
  function attachEvents(container) {
    // Scanner button → open URL modal (reuse flipcheck helper if available)
    container.querySelector("#batchScanBtn")?.addEventListener("click", async () => {
      let scanInfo = null;
      try { scanInfo = await window.fc?.getScannerInfo(); } catch {}
      const url  = scanInfo?.url || "http://<IP>:8766";
      const body = `
        <div style="text-align:center">
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">
            Öffne diese URL auf deinem Handy. Gescannte EANs werden automatisch zur Liste hinzugefügt.
          </p>
          <div style="background:var(--bg-base);border:1px solid var(--border);border-radius:10px;padding:16px 20px;margin-bottom:16px">
            <div style="font-family:monospace;font-size:16px;font-weight:700;color:var(--accent);word-break:break-all">${esc(url)}</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="batchScanUrlCopy">📋 URL kopieren</button>
        </div>
      `;
      if (typeof Modal !== "undefined") {
        Modal.open({ title: "📷 Handy-Scanner (Batch)", body, buttons: [{ label: "Schließen", variant: "btn-ghost", value: false }] });
        setTimeout(() => {
          document.getElementById("batchScanUrlCopy")?.addEventListener("click", () => {
            navigator.clipboard?.writeText(url).then(() => {
              if (typeof Toast !== "undefined") Toast.success("Kopiert", url);
            }).catch(() => {});
          });
        }, 50);
      }
    });

    // Drop zone
    const dropZone = container.querySelector("#batchDropZone");
    const fileInput = container.querySelector("#batchFileInput");

    dropZone?.addEventListener("click", () => fileInput?.click());
    dropZone?.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
    dropZone?.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone?.addEventListener("drop", e => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file) parseFile(file, container);
    });

    fileInput?.addEventListener("change", e => {
      const file = e.target.files?.[0];
      if (file) parseFile(file, container);
    });

    container.querySelector("#btnBatchRun")?.addEventListener("click",  () => runBatch(container));
    container.querySelector("#btnBatchStop")?.addEventListener("click", () => { _running = false; });
  }

  function parseFile(file, container) {
    const reader = new FileReader();
    reader.onload = e => {
      const text  = e.target.result;
      const lines = text.split(/[\r\n]+/).filter(Boolean);

      // Detect EAN column (first numeric-looking column)
      const eans = [];
      lines.forEach(line => {
        const parts = line.split(/[,;\t]/);
        for (const part of parts) {
          const clean = part.trim().replace(/^["']|["']$/g, "");
          if (/^\d{8,14}$/.test(clean)) { eans.push(clean); break; }
        }
      });

      if (eans.length === 0) {
        Toast.warning("Keine EANs gefunden", "CSV enthält keine erkennbaren EAN-Nummern.");
        return;
      }

      const textarea = container.querySelector("#batchEanList");
      if (textarea) textarea.value = eans.join("\n");
      Toast.info("CSV importiert", `${eans.length} EANs erkannt.`);
    };
    reader.readAsText(file);
  }

  async function runBatch(container) {
    const textarea      = container.querySelector("#batchEanList");
    const defaultEkInput= container.querySelector("#batchDefaultEk");
    const categorySelect= container.querySelector("#batchCategory");
    const modeSelect    = container.querySelector("#batchMode");

    const rawEans    = (textarea?.value || "").split(/[\r\n,;]+/).map(e => e.trim()).filter(e => /^\d{8,14}$/.test(e));
    const uniqueEans = [...new Set(rawEans)];

    if (uniqueEans.length === 0) {
      Toast.warning("Keine EANs", "Bitte EAN-Nummern eingeben oder eine CSV-Datei importieren.");
      return;
    }
    const dupCount = rawEans.length - uniqueEans.length;
    if (dupCount > 0) {
      Toast.info("Duplikate entfernt", `${dupCount} doppelte EAN${dupCount > 1 ? "s" : ""} wurden entfernt.`);
    }

    const defaultEk = parseFloat(defaultEkInput?.value);
    if (!defaultEk || defaultEk <= 0) {
      Toast.error("EK fehlt", "Bitte einen Standard-Einkaufspreis eingeben (z.B. 18.50).");
      defaultEkInput?.focus();
      return;
    }

    const catId = categorySelect?.value || "sonstiges";
    const mode  = modeSelect?.value    || "mid";

    _running = true;
    _results = [];

    // Show progress
    const progressEl    = container.querySelector("#batchProgress");
    const progressBar   = container.querySelector("#batchProgressBar");
    const progressLabel = container.querySelector("#batchProgressLabel");
    const progressCount = container.querySelector("#batchProgressCount");
    const resultsEl     = container.querySelector("#batchResults");
    const btnRun        = container.querySelector("#btnBatchRun");
    const btnStop       = container.querySelector("#btnBatchStop");

    if (progressEl) progressEl.style.display = "block";
    if (btnRun)  btnRun.disabled = true;
    if (btnStop) btnStop.style.display = "flex";
    // Render table shell once — rows are appended incrementally
    if (resultsEl) resultsEl.innerHTML = renderResultsTableShell();

    for (let i = 0; i < uniqueEans.length; i++) {
      if (!_running) break;

      const ean = uniqueEans[i];
      const pct = Math.round(((i + 1) / uniqueEans.length) * 100);

      if (progressBar)   progressBar.style.width    = `${pct}%`;
      if (progressLabel) progressLabel.textContent  = `Prüfe ${ean}…`;
      if (progressCount) progressCount.textContent  = `${i + 1} / ${uniqueEans.length}`;

      // Insert skeleton loading row before API call
      const tbodyEl = resultsEl?.querySelector("#batchTbody");
      if (tbodyEl) tbodyEl.insertAdjacentHTML("beforeend", renderLoadingRow(ean));

      try {
        const { ok, data } = await API.flipcheck(ean, defaultEk, mode, {
          vat_mode:  _vatMode,
          ek_mode:   _ekMode,
          category:  catId,
        });
        if (!ok || !data) {
          const errMsg = data?.error || data?.detail || "Backend-Fehler";
          throw new Error(errMsg);
        }

        // Frontend profit calc (tiered fees + VAT applied to sell_price_median)
        const vk = data.sell_price_median ?? data.sell_price_avg ?? null;
        const calc = vk != null ? calcProfit(vk, defaultEk, catId, _vatMode, _ekMode) : null;

        _results.push({ ean, ek: defaultEk, _calc: calc, ...data });

        // Save price history — one point for today
        try {
          await Storage.savePrice({
            ean,
            title:          data.title || ean,
            browse_avg:     data.browse_avg,
            browse_median:  data.sell_price_median,
            research_avg:   data.sell_price_avg,
            sales_30d:      data.sales_30d,
          });
        } catch {}

        // Save 30-day Research series if available
        if (data.price_series?.length) {
          Storage.savePriceSeries({ ean, title: data.title || ean, price_series: data.price_series, qty_series: data.qty_series || [] });
        }

      } catch (err) {
        _results.push({ ean, ek: defaultEk, error: err.message });
      }

      // Replace skeleton row with actual result row
      const lastResult = _results[_results.length - 1];
      const skelRow = tbodyEl?.querySelector(`[data-loading-ean="${CSS.escape(ean)}"]`);
      if (skelRow && lastResult) {
        skelRow.outerHTML = renderResultRow(lastResult);
      } else if (tbodyEl && lastResult) {
        tbodyEl.insertAdjacentHTML("beforeend", renderResultRow(lastResult));
      }
      updateBatchSummary(resultsEl);

      // Small delay to not hammer API
      await new Promise(r => setTimeout(r, 300));
    }

    // Attach result action listeners ONCE after all results are in
    if (resultsEl) attachResultActions(resultsEl);

    // Done
    if (progressBar)   progressBar.style.width   = "100%";
    if (progressLabel) progressLabel.textContent = "Abgeschlossen";
    if (btnRun)  btnRun.disabled = false;
    if (btnStop) btnStop.style.display = "none";
    _running = false;

    const buyCount = _results.filter(r => r.verdict === "BUY").length;
    Toast.success("Batch abgeschlossen", `${uniqueEans.length} EANs geprüft · ${buyCount} BUY-Empfehlungen`);

    setTimeout(() => {
      if (progressEl) progressEl.style.display = "none";
    }, 2000);
  }

  function attachResultActions(resultsEl) {
    resultsEl?.addEventListener("click", (e) => {
      if (e.target.closest("#btnExportCsv"))    exportCsv();
      if (e.target.closest("#btnAddBuyToInv"))  addBuysToInventory();

      // Listing-Assistent aus Batch-Ergebnis öffnen
      const listingBtn = e.target.closest(".batch-listing-btn");
      if (listingBtn) {
        const ean = listingBtn.dataset.ean;
        const r   = _results.find(x => x.ean === ean);
        if (r && typeof ListingAssistant !== "undefined") {
          ListingAssistant.open(r, r.ean, r.ek);
        }
      }
    }, { once: false });
  }

  // ─── CSV Export ────────────────────────────────────────────────────────────
  function exportCsv() {
    if (!_results.length) return;

    const header = "EAN,Titel,EK,VK_Median,Profit,Margin,Verkäufe_30d,Verdict";
    const rows = _results.map(r => {
      const profit = r._calc?.profit ?? r.profit_median ?? r.profit_avg ?? "";
      const margin = r._calc?.margin ?? r.margin_pct ?? "";
      return [
        r.ean,
        `"${(r.title || "").replace(/"/g, '""')}"`,
        r.ek || "",
        r.sell_price_median ?? r.sell_price_avg ?? "",
        typeof profit === "number" ? profit.toFixed(2) : profit,
        typeof margin === "number" ? margin.toFixed(2)  : margin,
        r.sales_30d ?? "",
        r.error ? "ERROR" : (r.verdict || ""),
      ].join(",");
    });

    const csv  = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `flipcheck_batch_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    Toast.success("Exportiert", "CSV wurde heruntergeladen.");
  }

  // ─── Add BUYs to Inventory ─────────────────────────────────────────────────
  async function addBuysToInventory() {
    const buys = _results.filter(r => r.verdict === "BUY" && !r.error);
    if (!buys.length) { Toast.info("Keine BUYs", "Keine BUY-Empfehlungen zum Hinzufügen."); return; }

    let added = 0;
    for (const r of buys) {
      try {
        await Storage.upsertItem({
          ean:    r.ean,
          title:  r.title || r.ean,
          ek:     r.ek,
          market: "ebay",
          status: "IN_STOCK",
          qty:    1,
        });
        added++;
      } catch {}
    }
    Toast.success("Hinzugefügt", `${added} Artikel zum Inventory hinzugefügt.`);
  }

  return { mount, unmount };
})();
