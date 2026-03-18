/* Flipcheck Web App — Flipcheck View (v2 quality) */
const FlipcheckView = (() => {
  let _container = null;
  let _miniChart = null;
  let _market    = "ebay";   // "ebay" | "amazon" | "kaufland"
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
    const vat    = _vatMode === "ust_19" ? 1.19 : 1.0;
    const vkNet  = vkGross / vat;
    const feeNet = fee / vat;
    const ekNet  = (_vatMode === "ust_19" && _ekMode === "gross") ? ekGross / vat : ekGross;
    return vkNet - feeNet - (shipIn || 0) - (shipOut || 0) - ekNet;
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
          <p>eBay, Amazon &amp; Kaufland Profitabilitätsanalyse</p>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <!-- Market Toggle -->
        <div class="seg" id="fcMarketSeg" style="margin-bottom:14px">
          <button class="seg-btn active" data-mkt="ebay">🛒 eBay</button>
          <button class="seg-btn"        data-mkt="kaufland">🏪 Kaufland</button>
          <button class="seg-btn"        data-mkt="amazon">📦 Amazon</button>
        </div>

        <!-- EAN -->
        <div class="field" style="margin-bottom:10px">
          <label class="input-label">EAN / ASIN</label>
          <div style="display:flex;gap:6px">
            <input id="fcEan" class="input" type="text" placeholder="z.B. 4010355040672 oder B0CX4F5P1S"
                   maxlength="20" inputmode="numeric" autocomplete="off" style="flex:1"/>
            <button class="btn btn-ghost" id="fcScanBtn" title="Barcode scannen" style="padding:8px 10px;font-size:16px">📷</button>
          </div>
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
    /* Calculate eBay fee directly from category tiers */
    let fee = null;
    if (vk != null) {
      const fcat = CATEGORIES.find(c => c.id === (d.category || "sonstiges")) || CATEGORIES[CATEGORIES.length - 1];
      fee = 0; let fRem = vk;
      for (const [limit, pct] of fcat.tiers) {
        if (limit == null) { fee += fRem * pct; break; }
        const chunk = Math.min(fRem, limit); fee += chunk * pct; fRem = Math.max(0, fRem - limit);
        if (fRem <= 0) break;
      }
      fee = Math.max(fee, 0.35);
    }

    /* Waterfall steps */
    const wfSteps = [];
    if (vk != null) wfSteps.push({ label:"Median VK", val: vk, color:"var(--text-primary)", plus:true });
    if (fee != null && fee > 0) wfSteps.push({ label:"eBay-Gebühr", val:-fee, color:"var(--red)" });
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
    const profit = d.profit_median ?? d.profit ?? null;
    const margin = d.margin_pct ?? null;
    const pColor = profit != null ? (profit >= 0 ? "var(--green)" : "var(--red)") : "var(--text-secondary)";
    const mColor = margin != null ? (margin >= 20 ? "var(--green)" : margin >= 10 ? "var(--yellow)" : "var(--red)") : "var(--text-secondary)";
    const score  = _deriveScore({ verdict: d.verdict, profit_median: profit, margin_pct: margin });

    const fbaFee  = d.fba_fee ?? null;
    const refFee  = d.referral_fee ?? null;
    const buyBox  = d.buy_box ?? d.buy_box_price ?? null;
    const bbAvg30 = d.buy_box_avg30 ?? null;
    const roi     = d.roi_pct ?? null;
    const brkEven = d.break_even ?? null;
    const netPay  = d.net_payout ?? null;
    const monthP  = d.monthly_profit_est ?? null;
    const dtc     = d.days_to_cash ?? null;
    const sales   = d.sales_30d ?? null;
    const salesSrc= d.sales_30d_source ?? null;
    const bsr     = d.sales_rank ?? d.bsr ?? null;
    const bsrDrops= d.bsr_drops_30d ?? null;
    const offers  = d.offer_count ?? d.seller_count ?? null;
    const fbaC    = d.fba_count ?? null;
    const varC    = d.variation_count ?? null;
    const catName = d.category_name ?? null;
    const signals = d.signals ?? {};
    const intl    = d.intl_prices ?? {};
    const asin    = d.asin ?? null;

    const sColor  = score >= 60 ? "var(--green)" : score >= 30 ? "var(--yellow)" : "var(--red)";
    const roiC    = roi != null ? (roi >= 30 ? "var(--green)" : roi >= 0 ? "var(--yellow)" : "var(--red)") : "";

    // Gated flags
    const ungated = signals.ungated_markets || {};
    const FLAGS   = { SE:"🇸🇪", PL:"🇵🇱", BE:"🇧🇪", IT:"🇮🇹", DE:"🇩🇪", ES:"🇪🇸", FR:"🇫🇷", NL:"🇳🇱", GB:"🇬🇧" };
    const gatedHtml = Object.keys(ungated).length > 0
      ? Object.entries(ungated).map(([code, st]) => {
          const open = st === "open";
          return `<span style="display:inline-flex;align-items:center;gap:1px;font-size:13px;opacity:${open ? 1 : 0.5}" title="${code}: ${open ? "Ungated" : "Gated"}">${FLAGS[code]||code}<span style="font-size:9px;color:${open ? "var(--green)" : "var(--red)"}">${open ? "🔓" : "🔒"}</span></span>`;
        }).join(" ")
      : "";

    // Intl prices
    const INTL_FLAGS = { de:"🇩🇪", fr:"🇫🇷", it:"🇮🇹", es:"🇪🇸", nl:"🇳🇱", be:"🇧🇪", pl:"🇵🇱", se:"🇸🇪", gb:"🇬🇧" };
    const intlHtml = Object.entries(intl).length > 0
      ? Object.entries(intl).map(([cc, price]) =>
          `<span class="badge badge-muted" style="font-size:10px">${INTL_FLAGS[cc]||cc.toUpperCase()} ${fmtEurPlain(price)}</span>`
        ).join(" ")
      : "";

    // Signal warnings
    const warnChips = [];
    if (signals.buybox_is_amazon) warnChips.push(`<span class="badge" style="background:var(--red-subtle);color:var(--red);font-size:10px;border:1px solid var(--red-border)">⚠ Amazon hält Buy Box</span>`);
    if (signals.is_hazmat)        warnChips.push(`<span class="badge" style="background:var(--yellow-subtle);color:var(--yellow);font-size:10px;border:1px solid var(--yellow-border)">☢ Gefahrgut</span>`);
    if (signals.is_meltable)      warnChips.push(`<span class="badge" style="background:var(--yellow-subtle);color:var(--yellow);font-size:10px;border:1px solid var(--yellow-border)">🫠 Schmelzbar</span>`);
    if (signals.is_oversize)      warnChips.push(`<span class="badge" style="background:var(--yellow-subtle);color:var(--yellow);font-size:10px;border:1px solid var(--yellow-border)">📦 Übergröße</span>`);
    if (signals.pl_risk === "likely") warnChips.push(`<span class="badge" style="background:var(--red-subtle);color:var(--red);font-size:10px;border:1px solid var(--red-border)">🏷 Private Label</span>`);
    if (signals.ip_risk === "high")   warnChips.push(`<span class="badge" style="background:var(--red-subtle);color:var(--red);font-size:10px;border:1px solid var(--red-border)">⚖ IP-Risiko</span>`);

    return `
      <div class="card" style="border-left:3px solid ${vc.text}">
        <!-- Hero -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <span class="badge" style="background:${vc.bg};color:${vc.text};border:1px solid ${vc.border};font-weight:700;font-size:11px;padding:3px 12px;border-radius:var(--r-full)">${d.verdict || "SKIP"}</span>
            ${d.product_image ? `<img src="${esc(d.product_image)}" style="width:48px;height:48px;border-radius:var(--r);object-fit:contain;margin-left:10px;vertical-align:middle;background:var(--bg-elevated)"/>` : ""}
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:var(--text-muted)">Score</div>
            <div style="font-size:22px;font-weight:700;color:${sColor}">${score}</div>
            <div style="width:60px;height:3px;background:var(--bg-elevated);border-radius:2px;margin-top:2px"><div style="width:${score}%;height:100%;background:${sColor};border-radius:2px"></div></div>
          </div>
        </div>
        <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(d.title || ean)}</div>
        <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:4px">${asin ? esc(asin) : esc(ean)}</div>
        ${catName ? `<div style="font-size:10px;color:var(--text-muted);margin-bottom:12px">${esc(catName)}</div>` : ""}

        <!-- Warning Badges -->
        ${warnChips.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${warnChips.join("")}</div>` : ""}

        <!-- 6-KPI Strip -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
          <div class="card" style="padding:10px;text-align:center;background:var(--bg-elevated)">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Buy Box</div>
            <div style="font-size:16px;font-weight:700;color:var(--text-primary)">${buyBox != null ? fmtEurPlain(buyBox) : "—"}</div>
            ${bbAvg30 ? `<div style="font-size:9px;color:var(--text-muted)">Ø30T: ${fmtEurPlain(bbAvg30)}</div>` : ""}
          </div>
          <div class="card" style="padding:10px;text-align:center;background:var(--bg-elevated)">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Profit</div>
            <div style="font-size:16px;font-weight:700;color:${pColor}">${profit != null ? fmtEurPlain(profit) : "—"}</div>
            ${monthP ? `<div style="font-size:9px;color:var(--text-muted)">~${fmtEurPlain(monthP)}/Mo</div>` : ""}
          </div>
          <div class="card" style="padding:10px;text-align:center;background:var(--bg-elevated)">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Marge</div>
            <div style="font-size:16px;font-weight:700;color:${mColor}">${margin != null ? fmtPct(margin) : "—"}</div>
          </div>
          <div class="card" style="padding:10px;text-align:center;background:var(--bg-elevated)">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">ROI</div>
            <div style="font-size:16px;font-weight:700;color:${roiC}">${roi != null ? fmtPct(roi) : "—"}</div>
          </div>
          <div class="card" style="padding:10px;text-align:center;background:var(--bg-elevated)">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Sales/Mo</div>
            <div style="font-size:16px;font-weight:700;color:var(--text-primary)">${sales ?? "—"}</div>
            ${salesSrc ? `<div style="font-size:9px;color:var(--text-muted)">${salesSrc}</div>` : ""}
          </div>
          <div class="card" style="padding:10px;text-align:center;background:var(--bg-elevated)">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">BSR</div>
            <div style="font-size:16px;font-weight:700;color:var(--text-primary)">${bsr != null ? `#${bsr.toLocaleString("de")}` : "—"}</div>
            ${bsrDrops ? `<div style="font-size:9px;color:var(--green)">${bsrDrops} Drops/30T</div>` : ""}
          </div>
        </div>

        <!-- Fee Breakdown -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          ${_chip("Referral Fee", refFee, "var(--red)")}
          ${_chip("FBA Gebühr", fbaFee, "var(--red)")}
          ${d.prep_fee > 0 ? _chip("PREP", d.prep_fee, "var(--red)") : ""}
          ${_chip("Seller", offers)}
          ${fbaC != null ? _chip("FBA Seller", fbaC) : ""}
          ${varC ? _chip("Varianten", varC, varC > 10 ? "var(--yellow)" : "") : ""}
          ${brkEven ? _chip("Break Even", brkEven, "var(--accent)") : ""}
          ${netPay ? _chip("Netto Auszahlung", netPay, "var(--green)") : ""}
          ${dtc ? _chip("Days to Cash", `${dtc}d`) : ""}
        </div>

        <!-- Gated Status -->
        ${gatedHtml ? `
        <div style="margin-bottom:12px">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em">Gated/Ungated Status</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${gatedHtml}</div>
        </div>` : ""}

        <!-- Signals -->
        ${signals.pl_text || signals.ip_text || signals.size_tier ? `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          ${signals.size_tier ? `<span class="badge badge-muted" style="font-size:10px">📦 ${esc(signals.size_tier)}${signals.weight_kg ? ` · ${signals.weight_kg}kg` : ""}</span>` : ""}
          ${signals.pl_text ? `<span class="badge badge-muted" style="font-size:10px">🏷 ${esc(signals.pl_text)}</span>` : ""}
          ${signals.ip_text ? `<span class="badge badge-muted" style="font-size:10px">⚖ ${esc(signals.ip_text)}</span>` : ""}
        </div>` : ""}

        <!-- Intl Prices -->
        ${intlHtml ? `
        <div style="margin-bottom:12px">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em">EU Buy Box Preise</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${intlHtml}</div>
        </div>` : ""}

        <!-- Chart -->
        ${d.price_series?.length ? `<canvas id="fcMiniChart" height="60" style="margin-top:8px;border-radius:var(--r);max-height:60px"></canvas>` : ""}

        <!-- Actions -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button class="btn btn-secondary btn-sm" id="fcAddInv">+ Inventar</button>
          <button class="btn btn-ghost btn-sm" id="fcAddAlert">🔔 Alarm</button>
          ${asin ? `<a class="btn btn-ghost btn-sm" href="https://www.amazon.de/dp/${esc(asin)}" target="_blank" rel="noopener" style="text-decoration:none;font-size:11px">Amazon öffnen ↗</a>` : ""}
        </div>
      </div>
    `;
  }

  function _chip(label, value, color) {
    if (value == null) return "";
    const v = typeof value === "number" ? fmtEurPlain(value) : value;
    return `<span class="badge badge-muted" style="font-size:11px">${esc(label)} <strong${color ? ` style="color:${color}"` : ""}>${v}</strong></span>`;
  }

  /* ── Kaufland Result ─────────────────────────────────────────────── */
  function renderResultKaufland(d, ean) {
    if (!d) return "";
    const vc     = FC.VERDICT_COLORS[d.verdict] || FC.VERDICT_COLORS.SKIP;
    const sell   = d.sell_price_avg ?? null;
    const profit = d.profit_median ?? d.profit_avg ?? null;
    const margin = d.margin_pct ?? null;
    const fee    = d.fees_median ?? null;
    const feeRate= d.fee_rate ? `${(d.fee_rate * 100).toFixed(1)}%` : "~10.5%";
    const offers = d.offers_count ?? null;
    const bestseller = d.bestseller;
    const score  = d.score ?? null;
    const label  = d.label;
    const productUrl = d.product_url ?? null;
    const sellerName = d.best_seller_name ?? null;
    const volEbay    = d.volume_hint_ebay ?? null;

    const profitColor = profit > 0 ? "var(--green)" : profit < 0 ? "var(--red)" : "var(--text-secondary)";
    const marginColor = (margin ?? 0) >= 20 ? "var(--green)" : (margin ?? 0) >= 10 ? "var(--yellow)" : "var(--red)";
    const scoreColor  = score >= 70 ? "var(--green)" : score >= 50 ? "var(--yellow)" : "var(--red)";
    const labelText   = label === "HOT" ? "Hohe Nachfrage" : label === "OK" ? "Moderate Nachfrage" : "Geringes Interesse";

    return `
      <div class="card" style="border-left:3px solid ${vc.text}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <span class="badge" style="background:${vc.bg};color:${vc.text};border:1px solid ${vc.border};font-weight:700;font-size:11px;padding:3px 12px;border-radius:var(--r-full)">✕ ${d.verdict || "SKIP"}</span>
            ${score != null ? `<span style="font-size:11px;color:var(--text-muted);margin-left:8px">Score <strong style="color:${scoreColor}">${score}</strong>/100</span>` : ""}
          </div>
          ${label ? `<span class="badge" style="background:${score >= 70 ? "var(--green-subtle)" : score >= 50 ? "var(--yellow-subtle)" : "var(--red-subtle)"};color:${scoreColor};font-size:10px">${esc(label)} — ${labelText}</span>` : ""}
        </div>
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:2px">${esc(d.title || ean)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:16px;font-family:var(--font-mono)">${esc(ean)}</div>

        ${bestseller ? `<div style="margin-bottom:12px"><span style="background:#fef3c7;color:#b45309;border-radius:4px;padding:3px 10px;font-size:11px;font-weight:600">⭐ Bestseller</span></div>` : ""}

        <!-- KPI Strip -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">
          <div class="card" style="padding:10px;text-align:center;background:var(--bg-elevated)">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Profit (netto)</div>
            <div style="font-size:18px;font-weight:700;color:${profitColor}">${profit != null ? fmtEurPlain(profit) : "—"}</div>
          </div>
          <div class="card" style="padding:10px;text-align:center;background:var(--bg-elevated)">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Marge</div>
            <div style="font-size:18px;font-weight:700;color:${marginColor}">${margin != null ? fmtPct(margin) : "—"}</div>
          </div>
          <div class="card" style="padding:10px;text-align:center;background:var(--bg-elevated)">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Angebote</div>
            <div style="font-size:18px;font-weight:700;color:var(--text-primary)">${offers ?? "—"}</div>
          </div>
          <div class="card" style="padding:10px;text-align:center;background:var(--bg-elevated)">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Nachfrage</div>
            <div style="font-size:18px;font-weight:700;color:${scoreColor}">${score ?? "—"}</div>
          </div>
        </div>

        <!-- Market Chips -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <span class="badge badge-muted" style="font-size:11px">VK (günstigster Neu) <strong>${sell != null ? fmtEurPlain(sell) : "—"}</strong></span>
          <span class="badge badge-muted" style="font-size:11px">Kaufland Gebühr (${feeRate}) <strong style="color:var(--red)">−${fee != null ? fmtEurPlain(fee) : "—"}</strong></span>
          ${sellerName ? `<span class="badge badge-muted" style="font-size:11px">Günstigster Seller <strong>${esc(sellerName)}</strong></span>` : ""}
          ${volEbay ? `<span class="badge badge-muted" style="font-size:11px">eBay Verk./Mo <strong>~${volEbay}</strong></span>` : ""}
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
          <button class="btn btn-secondary btn-sm" id="fcAddInv">+ Inventar</button>
          ${productUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(productUrl)}" target="_blank" rel="noopener" style="text-decoration:none">Kaufland öffnen ↗</a>` : ""}
          <button class="btn btn-ghost btn-sm" id="fcAddAlert">🔔 Alarm</button>
          <a class="btn btn-ghost btn-sm" href="https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=${encodeURIComponent(ean)}" target="_blank" rel="noopener" style="font-size:11px">🏷 Idealo ↗</a>
          <a class="btn btn-ghost btn-sm" href="https://geizhals.de/?fs=${encodeURIComponent(ean)}" target="_blank" rel="noopener" style="font-size:11px">💰 Geizhals ↗</a>
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
        d = await API.amazonCheck(ean, ean, ek, mode, method, { prep_fee: prep, ship_in: shipIn });
      } else if (_market === "kaufland") {
        d = await API.flipcheck(ean, ek, mode, { category: cat, shipping_in: shipIn, shipping_out: shipOut, market: "kaufland" });
        if (d && d.sell_price_median != null) {
          d.ek = ek; d.ship_in = shipIn; d.ship_out = shipOut; d.category = cat;
          const klFee = d.sell_price_median * 0.105;
          d.profit_median = +(d.sell_price_median - ek - shipIn - shipOut - klFee).toFixed(2);
          d.margin_pct = d.sell_price_median > 0 ? +(d.profit_median / d.sell_price_median * 100).toFixed(1) : 0;
        }
      } else {
        d = await API.flipcheck(ean, ek, mode, { category: cat, shipping_in: shipIn, shipping_out: shipOut });
        // Local profit recalc (server doesn't include shipping + VAT)
        if (d && d.sell_price_median != null) {
          d.ek       = ek;
          d.ship_in  = shipIn;
          d.ship_out = shipOut;
          d.category = cat;
          d.profit_median = +calcProfit(d.sell_price_median, ek, cat, shipIn, shipOut).toFixed(2);
          d.margin_pct    = d.sell_price_median > 0 ? +(d.profit_median / d.sell_price_median * 100).toFixed(1) : 0;
        }
      }

      _lastResult = d ? { ...d, ean, ek, market: _market } : null;

      if (_market === "amazon") {
        resEl.innerHTML = d ? renderResultAmazon(d, ean) : `<p style="color:var(--red)">Kein Ergebnis</p>`;
      } else if (_market === "kaufland") {
        resEl.innerHTML = d ? renderResultKaufland(d, ean) : `<p style="color:var(--red)">Kein Ergebnis</p>`;
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
    if (ebayFields) ebayFields.style.display = (mkt === "ebay" || mkt === "kaufland") ? "" : "none";
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

    // Barcode scanner
    container.querySelector("#fcScanBtn")?.addEventListener("click", () => openBarcodeScanner(container));

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

  /* ── Barcode Scanner (html5-qrcode — works on Safari, Chrome, Firefox) */
  let _html5Scanner = null;

  async function openBarcodeScanner(container) {
    if (typeof Html5Qrcode === "undefined") {
      Toast.error("Scanner nicht verfügbar", "Barcode-Library konnte nicht geladen werden.");
      return;
    }

    const body = `
      <div style="text-align:center">
        <div id="scannerRegion" style="width:100%;max-width:400px;margin:0 auto;border-radius:var(--r);overflow:hidden"></div>
        <div id="scannerStatus" style="font-size:12px;color:var(--text-muted);margin-top:8px">Kamera wird gestartet…</div>
      </div>
    `;

    Modal.open({
      title: "📷 Barcode Scanner",
      body,
      buttons: [{ label: "Schließen", variant: "btn-ghost", value: false }],
    });

    await new Promise(r => setTimeout(r, 200));
    const region = document.getElementById("scannerRegion");
    const status = document.getElementById("scannerStatus");
    if (!region) return;

    try {
      _html5Scanner = new Html5Qrcode("scannerRegion");

      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

      await _html5Scanner.start(
        { facingMode: "environment" },
        {
          fps: isIOS ? 5 : 15,
          // No qrbox on iOS — scan entire frame for better detection
          ...(isIOS ? {} : { qrbox: { width: 280, height: 150 } }),
          aspectRatio: isIOS ? 1.0 : 1.333,
          disableFlip: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
          ],
        },
        (code) => {
          if (/^\d{8,14}$/.test(code)) {
            const inp = container.querySelector("#fcEan");
            if (inp) inp.value = code;
            autoDetectMarket(code);
            Toast.success("Barcode erkannt", code);
            stopScanner();
            try { Modal.close(true); } catch {}
          }
        },
        () => {} // ignore scan failures
      );

      if (status) status.textContent = "Halte einen Barcode vor die Kamera…";
    } catch (e) {
      if (status) status.textContent = `Kamera-Fehler: ${e.message || e}`;
    }

    // Cleanup on modal close
    const overlay = document.getElementById("modal-overlay");
    if (overlay) {
      const obs = new MutationObserver(() => {
        if (overlay.style.display === "none" || !overlay.classList.contains("open")) {
          stopScanner();
          obs.disconnect();
        }
      });
      obs.observe(overlay, { attributes: true, attributeFilter: ["style", "class"] });
    }
  }

  function stopScanner() {
    if (_html5Scanner) {
      _html5Scanner.stop().catch(() => {});
      _html5Scanner.clear();
      _html5Scanner = null;
    }
  }

  return { mount, unmount };
})();
