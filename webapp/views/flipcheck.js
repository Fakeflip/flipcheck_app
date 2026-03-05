/* Flipcheck Web App — Flipcheck View (v2 quality) */
const FlipcheckView = (() => {
  let _container = null;
  let _miniChart = null;
  let _market    = "ebay";   // "ebay" | "amazon"
  let _ekMode    = "gross";
  let _vatMode   = "no_vat";
  let _lastResult = null;

  /* ── eBay fee categories ─────────────────────────────────────────── */
  const CATEGORIES = [
    { id:"computer_tablets",  label:"Computer, Tablets & Netzwerk",   group:"Geräte (6,5%+3%)",   tiers:[[990,0.065],[null,0.03]] },
    { id:"drucker",           label:"Drucker",                         group:"Geräte (6,5%+3%)",   tiers:[[990,0.065],[null,0.03]] },
    { id:"foto_camcorder",    label:"Foto & Camcorder",                group:"Geräte (6,5%+3%)",   tiers:[[990,0.065],[null,0.03]] },
    { id:"handys",            label:"Handys & Kommunikation",          group:"Geräte (6,5%+3%)",   tiers:[[990,0.065],[null,0.03]] },
    { id:"haushaltsgeraete",  label:"Haushaltsgeräte",                 group:"Geräte (6,5%+3%)",   tiers:[[990,0.065],[null,0.03]] },
    { id:"konsolen",          label:"Konsolen / Videospiele",          group:"Geräte (6,5%+3%)",   tiers:[[990,0.065],[null,0.03]] },
    { id:"tv_video_audio",    label:"TV, Video & Audio",               group:"Geräte (6,5%+3%)",   tiers:[[990,0.065],[null,0.03]] },
    { id:"handy_zubehoer",    label:"Handy-Zubehör",                   group:"Zubehör (11%+3%)",   tiers:[[990,0.11],[null,0.03]]  },
    { id:"notebook_zubehoer", label:"Notebook- & Desktop-Zubehör",    group:"Zubehör (11%+3%)",   tiers:[[990,0.11],[null,0.03]]  },
    { id:"kabel",             label:"Kabel & Steckverbinder",          group:"Zubehör (11%+3%)",   tiers:[[990,0.11],[null,0.03]]  },
    { id:"tablet_zubehoer",   label:"Tablet & eBook Zubehör",         group:"Zubehör (11%+3%)",   tiers:[[990,0.11],[null,0.03]]  },
    { id:"mode",              label:"Mode / Bekleidung",               group:"Sonstiges (Flat)",    tiers:[[null,0.15]]             },
    { id:"sport_freizeit",    label:"Sport & Freizeit",                group:"Sonstiges (Flat)",    tiers:[[null,0.115]]            },
    { id:"spielzeug",         label:"Spielzeug / LEGO",                group:"Sonstiges (Flat)",    tiers:[[null,0.115]]            },
    { id:"haushalt_garten",   label:"Haushalt & Garten",               group:"Sonstiges (Flat)",    tiers:[[null,0.115]]            },
    { id:"buecher",           label:"Bücher & Medien",                 group:"Sonstiges (Flat)",    tiers:[[null,0.15]]             },
    { id:"sonstiges",         label:"Sonstiges",                       group:"Sonstiges (Flat)",    tiers:[[null,0.13]]             },
  ];

  /* ── FBA tiers (DE 2024) ─────────────────────────────────────────── */
  const FBA_TIERS = [
    { label:"Klein & Leicht",  maxG:100,  fee:1.78 },
    { label:"Envelope",        maxG:400,  fee:2.59 },
    { label:"Großbriefpaket",  maxG:900,  fee:3.39 },
    { label:"Kleines Paket",   maxG:1800, fee:3.99 },
    { label:"Standard S",      maxG:3000, fee:4.99 },
    { label:"Standard M",      maxG:6000, fee:5.99 },
    { label:"Standard L",      maxG:15000,fee:7.99 },
    { label:"Übergroß",        maxG:null, fee:12.99 },
  ];

  /* ── Helpers ─────────────────────────────────────────────────────── */
  function fmtDays(d) {
    if (d == null || d < 0) return "—";
    if (d === 0) return "heute";
    return `${Math.round(d)}T`;
  }

  function buildCatOptions(sel = "sonstiges") {
    const groups = {};
    for (const c of CATEGORIES) {
      if (!groups[c.group]) groups[c.group] = [];
      groups[c.group].push(c);
    }
    return Object.entries(groups).map(([g, cats]) =>
      `<optgroup label="${esc(g)}">${
        cats.map(c => `<option value="${c.id}"${c.id === sel ? " selected" : ""}>${esc(c.label)}</option>`).join("")
      }</optgroup>`
    ).join("");
  }

  function calcProfit(vkGross, ekGross, catId, shipIn, shipOut) {
    const cat   = CATEGORIES.find(c => c.id === catId) || CATEGORIES[CATEGORIES.length - 1];
    let fee = 0;
    let rem = vkGross;
    for (const [limit, pct] of cat.tiers) {
      if (limit == null) { fee += rem * pct; break; }
      const chunk = Math.min(rem, limit);
      fee += chunk * pct;
      rem  = Math.max(0, rem - limit);
      if (rem <= 0) break;
    }
    fee = Math.max(fee, 0.35);
    const ekNet = _ekMode === "net" ? ekGross * 1.19 : ekGross;
    return vkGross - fee - (shipIn || 0) - (shipOut || 0) - ekNet;
  }

  function _deriveScore(d) {
    if (!d) return 0;
    const v = d.verdict;
    const p = d.profit_median ?? 0;
    const m = d.margin_pct   ?? 0;
    if (v === "BUY")  return Math.min(100, Math.max(60, 60 + Math.round(m * 1.2 + p * 0.5)));
    if (v === "HOLD") return Math.min(59,  Math.max(30, 30 + Math.round(m * 0.8 + p * 0.3)));
    return Math.min(29, Math.max(5, 5 + Math.round(m * 0.3)));
  }

  /* ── Form HTML ───────────────────────────────────────────────────── */
  function renderForm() {
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Flipcheck</h1>
          <p>eBay &amp; Amazon Profitabilitätsanalyse</p>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <!-- Market Toggle -->
        <div class="seg" id="fcMarketSeg" style="margin-bottom:14px">
          <button class="seg-btn active" data-mkt="ebay">🛒 eBay</button>
          <button class="seg-btn"        data-mkt="amazon">📦 Amazon</button>
        </div>

        <!-- EAN -->
        <div class="field" style="margin-bottom:10px">
          <label class="input-label">EAN / ASIN</label>
          <input id="fcEan" class="input" type="text" placeholder="z.B. 4010355040672 oder B0CX4F5P1S"
                 maxlength="20" inputmode="numeric" autocomplete="off"/>
        </div>

        <!-- EK + Mode row -->
        <div class="field-row" style="margin-bottom:10px">
          <div class="field">
            <label class="input-label">EK (€)</label>
            <div class="input-prefix-wrap">
              <span class="prefix">€</span>
              <input id="fcEk" class="input" type="number" step="0.01" min="0" placeholder="0.00"/>
            </div>
          </div>
          <div class="field" id="fcModeWrap">
            <label class="input-label">Modus</label>
            <select id="fcMode" class="select">
              <option value="low">Vorsichtig (LOW)</option>
              <option value="mid" selected>Ausgewogen (MID)</option>
              <option value="high">Aggressiv (HIGH)</option>
            </select>
          </div>
        </div>

        <!-- eBay fields -->
        <div id="fcEbayFields">
          <div class="field-row" style="margin-bottom:10px">
            <div class="field">
              <label class="input-label">Versand rein (€)</label>
              <div class="input-prefix-wrap">
                <span class="prefix">€</span>
                <input id="fcShipIn" class="input" type="number" step="0.01" min="0" placeholder="0.00"/>
              </div>
            </div>
            <div class="field">
              <label class="input-label">Versand raus (€)</label>
              <div class="input-prefix-wrap">
                <span class="prefix">€</span>
                <input id="fcShipOut" class="input" type="number" step="0.01" min="0" placeholder="4.99"/>
              </div>
            </div>
          </div>
          <div class="field" style="margin-bottom:10px">
            <label class="input-label">Kategorie</label>
            <select id="fcCat" class="select">${buildCatOptions()}</select>
          </div>
        </div>

        <!-- Amazon fields -->
        <div id="fcAmzFields" style="display:none">
          <div class="field" style="margin-bottom:10px">
            <label class="input-label">Methode</label>
            <div class="seg" id="fcAmzMethodSeg">
              <button class="seg-btn active" data-method="fba">FBA</button>
              <button class="seg-btn"        data-method="fbm">FBM</button>
            </div>
          </div>
          <div class="field-row" style="margin-bottom:10px">
            <div class="field">
              <label class="input-label">PREP-Gebühr (€)</label>
              <div class="input-prefix-wrap">
                <span class="prefix">€</span>
                <input id="fcPrep" class="input" type="number" step="0.01" min="0" placeholder="0.00"/>
              </div>
            </div>
            <div class="field">
              <label class="input-label">Versand rein (€)</label>
              <div class="input-prefix-wrap">
                <span class="prefix">€</span>
                <input id="fcShipInAmz" class="input" type="number" step="0.01" min="0" placeholder="0.00"/>
              </div>
            </div>
          </div>
        </div>

        <button class="btn btn-primary" id="fcCheck" style="width:100%;margin-top:4px;min-height:44px">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 8l3 3 3-3M8 3v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Prüfen
        </button>
      </div>

      <div id="fcResult"></div>
    `;
  }

  /* ── eBay Result ─────────────────────────────────────────────────── */
  function renderResult(d, ean) {
    if (!d) return "";
    const vc     = FC.VERDICT_COLORS[d.verdict] || FC.VERDICT_COLORS.SKIP;
    const profit = d.profit_median ?? null;
    const margin = d.margin_pct   ?? null;
    const vk     = d.sell_price_median ?? null;
    const sales  = d.sales_30d ?? "—";
    const score  = _deriveScore(d);
    const pColor = profit != null ? (profit >= 0 ? "var(--green)" : "var(--red)") : "var(--text-secondary)";
    const sColor = score >= 60 ? "var(--green)" : score >= 30 ? "var(--yellow)" : "var(--red)";
    const fee    = vk != null ? (vk - (profit ?? 0) - (d.ek ?? 0)) : null;

    /* Waterfall steps */
    const wfSteps = [];
    if (vk != null) wfSteps.push({ label:"Median VK", val: vk, color:"var(--text-primary)", plus:true });
    if (fee != null && fee > 0) wfSteps.push({ label:"eBay-Gebühr", val:-Math.abs(fee), color:"var(--red)" });
    if (d.ship_in  > 0) wfSteps.push({ label:"Versand rein",  val:-d.ship_in,  color:"var(--red)" });
    if (d.ship_out > 0) wfSteps.push({ label:"Versand raus",  val:-d.ship_out, color:"var(--red)" });
    if (d.ek != null)   wfSteps.push({ label:"EK",            val:-d.ek,       color:"var(--red)" });
    if (profit != null) wfSteps.push({ label:"Profit",        val: profit,     color: pColor, bold:true });

    const wfHtml = wfSteps.length ? `
      <div class="fc-waterfall">
        <div class="fc-wf-title">Kostenaufschlüsselung</div>
        <div class="fc-wf-flow">
          ${wfSteps.map((s, i) => `
            <div class="fc-wf-step">
              <span style="color:var(--text-secondary);font-size:11px">${esc(s.label)}</span>
              <span style="color:${s.color};font-weight:${s.bold ? 700 : 400};font-variant-numeric:tabular-nums">
                ${s.val >= 0 && s.plus ? "+" : ""}${fmtEurPlain(s.val)}
              </span>
            </div>
            ${i < wfSteps.length - 1 ? `<div class="fc-wf-arrow">↓</div>` : ""}
          `).join("")}
        </div>
      </div>` : "";

    /* Signals */
    const signals = [];
    if (d.competition_count != null) signals.push(`${d.competition_count} Konkurrenten`);
    if (d.days_to_sell  != null) signals.push(`Ø ${fmtDays(d.days_to_sell)} bis Verkauf`);
    if (d.sell_through  != null) signals.push(`${Math.round(d.sell_through * 100)}% Sell-Through`);

    return `
      <div class="result-card ${(d.verdict||"SKIP").toLowerCase()}">
        <!-- Hero -->
        <div class="fc-hero">
          <div class="fc-hero-left">
            <span class="verdict-badge ${(d.verdict||"SKIP").toLowerCase()}">${esc(d.verdict || "SKIP")}</span>
            ${d.title ? `<div class="fc-product-title">${esc(d.title)}</div>` : ""}
            ${ean ? `<div class="fc-product-ean">${esc(ean)}</div>` : ""}
          </div>
          <div class="fc-score-block">
            <div class="fc-score-bar">
              <div class="fc-score-fill" style="width:${score}%;background:${sColor}"></div>
            </div>
            <div class="fc-score-label" style="color:${sColor}">${score}</div>
            <div class="fc-score-sub">Score</div>
          </div>
        </div>

        <!-- KPI strip -->
        <div class="fc-kpi-row">
          <div class="fc-kpi-card ${vk != null ? "" : ""}">
            <div class="fc-kpi-value">${vk != null ? fmtEurPlain(vk) : "—"}</div>
            <div class="fc-kpi-label">Median VK</div>
          </div>
          <div class="fc-kpi-card ${profit != null && profit >= 0 ? "green" : profit != null ? "red" : ""}">
            <div class="fc-kpi-value" style="color:${pColor}">${profit != null ? fmtEur(profit) : "—"}</div>
            <div class="fc-kpi-label">Profit</div>
          </div>
          <div class="fc-kpi-card">
            <div class="fc-kpi-value">${margin != null ? fmtPct(margin) : "—"}</div>
            <div class="fc-kpi-label">Marge</div>
          </div>
          <div class="fc-kpi-card">
            <div class="fc-kpi-value">${esc(String(sales))}</div>
            <div class="fc-kpi-label">Verk./30d</div>
          </div>
        </div>

        <!-- Market chips -->
        ${d.sell_price_low != null || d.sell_price_high != null ? `
        <div class="fc-market-row">
          ${d.sell_price_low  != null ? `<div class="fc-market-chip"><span class="fc-market-chip-l">LOW</span><span class="fc-market-chip-v">${fmtEurPlain(d.sell_price_low)}</span></div>` : ""}
          ${d.sell_price_median != null ? `<div class="fc-market-chip"><span class="fc-market-chip-l">MID</span><span class="fc-market-chip-v">${fmtEurPlain(d.sell_price_median)}</span></div>` : ""}
          ${d.sell_price_high != null ? `<div class="fc-market-chip"><span class="fc-market-chip-l">HIGH</span><span class="fc-market-chip-v">${fmtEurPlain(d.sell_price_high)}</span></div>` : ""}
        </div>` : ""}

        <!-- Waterfall -->
        ${wfHtml}

        <!-- Signals -->
        ${signals.length ? `
        <div class="fc-signals">
          ${signals.map(s => `<span class="fc-signal-chip">${esc(s)}</span>`).join("")}
        </div>` : ""}

        <!-- Mini chart -->
        ${d.price_series?.length ? `<canvas id="fcMiniChart" height="60" style="margin-top:14px;border-radius:var(--r);max-height:60px"></canvas>` : ""}

        <!-- Actions -->
        <div class="result-actions" style="margin-top:14px">
          <button class="btn btn-ghost btn-sm" id="fcAddInv">+ Inventar</button>
          <button class="btn btn-ghost btn-sm" id="fcAddAlert">🔔 Alarm</button>
        </div>
      </div>
    `;
  }

  /* ── Amazon Result ───────────────────────────────────────────────── */
  function _amzMetric(label, val, color) {
    return `
      <div class="fc-amz-metric">
        <span class="fc-amz-metric-l">${esc(label)}</span>
        <span class="fc-amz-metric-v" style="color:${color || "var(--text-primary)"}">${esc(String(val ?? "—"))}</span>
      </div>`;
  }

  function renderResultAmazon(d, ean) {
    if (!d) return "";
    const vc     = FC.VERDICT_COLORS[d.verdict] || FC.VERDICT_COLORS.SKIP;
    const profit = d.profit ?? null;
    const pColor = profit != null ? (profit >= 0 ? "var(--green)" : "var(--red)") : "var(--text-secondary)";
    const score  = _deriveScore({ verdict: d.verdict, profit_median: profit, margin_pct: d.margin_pct });

    const fbaFee = d.fba_fee ?? null;
    const refFee = d.referral_fee ?? null;
    const buyBox = d.buy_box_price ?? null;

    const sColor = score >= 60 ? "var(--green)" : score >= 30 ? "var(--yellow)" : "var(--red)";

    return `
      <div class="result-card ${(d.verdict||"SKIP").toLowerCase()}">
        <!-- Hero -->
        <div class="fc-hero">
          <div class="fc-hero-left">
            <span class="verdict-badge ${(d.verdict||"SKIP").toLowerCase()}">${esc(d.verdict || "SKIP")}</span>
            ${d.title ? `<div class="fc-product-title">${esc(d.title)}</div>` : ""}
            ${ean ? `<div class="fc-product-ean">${esc(ean)}</div>` : ""}
          </div>
          <div class="fc-score-block">
            <div class="fc-score-bar">
              <div class="fc-score-fill" style="width:${score}%;background:${sColor}"></div>
            </div>
            <div class="fc-score-label" style="color:${sColor}">${score}</div>
            <div class="fc-score-sub">Score</div>
          </div>
        </div>

        <!-- KPI strip -->
        <div class="fc-kpi-row">
          <div class="fc-kpi-card">
            <div class="fc-kpi-value">${buyBox != null ? fmtEurPlain(buyBox) : "—"}</div>
            <div class="fc-kpi-label">Buy Box</div>
          </div>
          <div class="fc-kpi-card ${profit != null && profit >= 0 ? "green" : profit != null ? "red" : ""}">
            <div class="fc-kpi-value" style="color:${pColor}">${profit != null ? fmtEur(profit) : "—"}</div>
            <div class="fc-kpi-label">Profit</div>
          </div>
          <div class="fc-kpi-card">
            <div class="fc-kpi-value">${d.margin_pct != null ? fmtPct(d.margin_pct) : "—"}</div>
            <div class="fc-kpi-label">Marge</div>
          </div>
          <div class="fc-kpi-card">
            <div class="fc-kpi-value">${d.bsr != null ? `#${d.bsr.toLocaleString("de")}` : "—"}</div>
            <div class="fc-kpi-label">BSR</div>
          </div>
        </div>

        <!-- Amazon metrics -->
        <div class="fc-amz-metrics">
          ${_amzMetric("Referral Fee", refFee != null ? fmtEurPlain(refFee) : "—", "var(--red)")}
          ${_amzMetric("FBA Gebühr",   fbaFee != null ? fmtEurPlain(fbaFee) : "—", "var(--red)")}
          ${d.prep_fee > 0 ? _amzMetric("PREP",  fmtEurPlain(d.prep_fee), "var(--red)") : ""}
          ${d.ship_in  > 0 ? _amzMetric("Versand rein", fmtEurPlain(d.ship_in), "var(--red)") : ""}
          ${_amzMetric("Seller Count", d.seller_count ?? "—")}
          ${_amzMetric("Review Ø", d.review_score != null ? `${d.review_score.toFixed(1)} ★` : "—")}
        </div>

        <!-- Chart -->
        ${d.price_series?.length ? `<canvas id="fcMiniChart" height="60" style="margin-top:14px;border-radius:var(--r);max-height:60px"></canvas>` : ""}

        <!-- Actions -->
        <div class="result-actions" style="margin-top:14px">
          <button class="btn btn-ghost btn-sm" id="fcAddInv">+ Inventar</button>
          <button class="btn btn-ghost btn-sm" id="fcAddAlert">🔔 Alarm</button>
        </div>
      </div>
    `;
  }

  /* ── Mini chart ──────────────────────────────────────────────────── */
  function drawMiniChart(priceSeries) {
    const canvas = _container?.querySelector("#fcMiniChart");
    if (!canvas || typeof Chart === "undefined") return;
    if (_miniChart) { _miniChart.destroy(); _miniChart = null; }

    const labels = priceSeries.map(p => {
      const d = new Date(p[0] * 1000);
      return `${d.getDate()}.${d.getMonth() + 1}`;
    });
    const data = priceSeries.map(p => p[1]);

    _miniChart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data,
          borderColor: "#6366F1",
          backgroundColor: "rgba(99,102,241,0.08)",
          borderWidth: 1.5,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
      },
    });
  }

  /* ── Run check ───────────────────────────────────────────────────── */
  async function runCheck() {
    const ean  = _container.querySelector("#fcEan").value.trim();
    const ek   = parseFloat(_container.querySelector("#fcEk").value) || 0;
    const mode = _container.querySelector("#fcMode").value;
    const cat  = _container.querySelector("#fcCat")?.value || "sonstiges";
    const shipIn  = parseFloat(_container.querySelector(_market === "ebay" ? "#fcShipIn"  : "#fcShipInAmz")?.value) || 0;
    const shipOut = parseFloat(_container.querySelector("#fcShipOut")?.value) || 0;
    const prep    = parseFloat(_container.querySelector("#fcPrep")?.value)    || 0;
    const method  = _container.querySelector(".seg-btn.active[data-method]")?.dataset.method || "fba";

    if (!ean) { Toast.error("EAN fehlt", "Bitte EAN oder ASIN eingeben"); return; }

    const btn = _container.querySelector("#fcCheck");
    btn.disabled = true;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" class="spin"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="28" stroke-dashoffset="10" stroke-linecap="round"/></svg> Prüfe…`;

    const resEl = _container.querySelector("#fcResult");
    resEl.innerHTML = `<div class="view-loading"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" class="spin"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="28" stroke-dashoffset="10" stroke-linecap="round"/></svg></div>`;

    try {
      let d;
      if (_market === "amazon") {
        d = await API.amazonCheck(ean, ean, ek, mode, method, { prep_fee: prep, shipping_in: shipIn });
      } else {
        d = await API.flipcheck(ean, ek, mode, { category: cat, shipping_in: shipIn, shipping_out: shipOut });
      }

      _lastResult = d ? { ...d, ean, ek, market: _market } : null;

      if (_market === "amazon") {
        resEl.innerHTML = d ? renderResultAmazon(d, ean) : `<p style="color:var(--red)">Kein Ergebnis</p>`;
      } else {
        resEl.innerHTML = d ? renderResult(d, ean) : `<p style="color:var(--red)">Kein Ergebnis</p>`;
      }

      if (d) {
        if (d.price_series?.length) drawMiniChart(d.price_series);
        if (d.price_series?.length && ean) {
          Storage.savePriceSeries({ ean, title: d.title, price_series: d.price_series }).catch(() => {});
        }
        _bindResultEvents(d, ean, ek);
      }
    } catch (e) {
      resEl.innerHTML = `<div class="card" style="color:var(--red)">${esc(e.message || "Fehler")}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 8l3 3 3-3M8 3v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Prüfen`;
    }
  }

  function _bindResultEvents(d, ean, ek) {
    _container.querySelector("#fcAddInv")?.addEventListener("click", () => addToInventory(d, ean, ek));
    _container.querySelector("#fcAddAlert")?.addEventListener("click", () => addAlert(d, ean));
  }

  /* ── Add to inventory ────────────────────────────────────────────── */
  async function addToInventory(d, ean, ek) {
    try {
      await Storage.upsertItem({
        ean,
        title:  d.title || "",
        ek:     ek || 0,
        status: "IN_STOCK",
        market: _market,
        qty:    1,
      });
      Toast.success("Zum Inventar hinzugefügt", ean);
    } catch (e) {
      Toast.error("Fehler", e.message);
    }
  }

  /* ── Add alert ───────────────────────────────────────────────────── */
  async function addAlert(d, ean) {
    const target = d.sell_price_median ? (d.sell_price_median * 0.9).toFixed(2) : "";
    await Modal.open({
      title: "Preisalarm",
      body: `
        <div class="field"><label class="input-label">EAN</label><input class="input" id="alEanM" value="${esc(ean)}" readonly/></div>
        <div class="field"><label class="input-label">Zielpreis (€)</label><div class="input-prefix-wrap"><span class="prefix">€</span><input class="input" id="alTargetM" type="number" step="0.01" value="${esc(target)}" placeholder="0.00"/></div></div>
        <div class="field"><label class="input-label">Bezeichnung</label><input class="input" id="alTitleM" value="${esc(d.title || "")}"/></div>
      `,
      buttons: [
        { label: "Abbrechen", variant: "btn-ghost", value: false },
        { label: "Alarm setzen", variant: "btn-primary", action: async () => {
          const t = parseFloat(document.getElementById("alTargetM").value) || 0;
          const n = document.getElementById("alTitleM").value;
          await Storage.addAlert({ ean, title: n, target_price: t, market: _market });
          Toast.success("Alarm gesetzt", ean);
          Modal.close(true);
        }},
      ],
    });
  }

  /* ── Market toggle ───────────────────────────────────────────────── */
  function setMarket(mkt) {
    _market = mkt;
    _container.querySelectorAll("#fcMarketSeg .seg-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.mkt === mkt);
    });
    const ebayFields = _container.querySelector("#fcEbayFields");
    const amzFields  = _container.querySelector("#fcAmzFields");
    const modeWrap   = _container.querySelector("#fcModeWrap");
    if (ebayFields) ebayFields.style.display = mkt === "ebay"   ? "" : "none";
    if (amzFields)  amzFields.style.display  = mkt === "amazon" ? "" : "none";
    // Clear result when switching market
    const ean = _container.querySelector("#fcEan").value.trim();
    if (!ean) _container.querySelector("#fcResult").innerHTML = "";
  }

  /* ── Auto-detect ASIN ────────────────────────────────────────────── */
  function autoDetectMarket(val) {
    const upper = val.trim().toUpperCase();
    if (/^[A-Z0-9]{10}$/.test(upper) && /[A-Z]/.test(upper)) {
      if (_market !== "amazon") setMarket("amazon");
    } else if (/^\d{8,14}$/.test(upper)) {
      if (_market !== "ebay") setMarket("ebay");
    }
  }

  /* ── Bind events ─────────────────────────────────────────────────── */
  function attachEvents(container) {
    container.querySelector("#fcCheck").addEventListener("click", runCheck);
    container.querySelector("#fcEan").addEventListener("keydown", e => {
      if (e.key === "Enter") runCheck();
    });
    container.querySelector("#fcEan").addEventListener("input", e => {
      autoDetectMarket(e.target.value);
    });

    // Market toggle
    container.querySelectorAll("#fcMarketSeg .seg-btn").forEach(btn => {
      btn.addEventListener("click", () => setMarket(btn.dataset.mkt));
    });

    // Amazon method seg
    container.querySelectorAll("#fcAmzMethodSeg .seg-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        container.querySelectorAll("#fcAmzMethodSeg .seg-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  }

  /* ── Mount / unmount ─────────────────────────────────────────────── */
  async function mount(container, navId) {
    _container = container;
    if (_miniChart) { _miniChart.destroy(); _miniChart = null; }

    try {
      const s = await Storage.getSettings();
      _vatMode = s?.tax?.vat_mode || "no_vat";
      _ekMode  = s?.tax?.ek_mode  || "gross";
    } catch {}

    if (navId !== undefined && App._navId !== navId) return;

    container.innerHTML = renderForm();
    attachEvents(container);

    // Handle nav payload (e.g. EAN from inventory quick-launch)
    const payload = App._navPayload;
    if (payload?.ean) {
      App._navPayload = null;
      const inp = container.querySelector("#fcEan");
      if (inp) {
        inp.value = payload.ean;
        autoDetectMarket(payload.ean);
        // Auto-run check
        setTimeout(runCheck, 100);
      }
    }
  }

  function unmount() {
    if (_miniChart) { _miniChart.destroy(); _miniChart = null; }
    _container = null;
  }

  return { mount, unmount };
})();
