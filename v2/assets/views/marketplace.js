/* Flipcheck v2 — Marktplatz-Vergleich (live: eBay + Kaufland + Amazon via Keepa) */
const MarketplaceView = (() => {

  // ── Plattform-Definitionen ────────────────────────────────────────────────
  const PLATFORMS = [
    {
      id:     "ebay",
      name:   "eBay.de",
      short:  "eBay",
      fee:    13.0,
      color:  "#E53238",
      bg:     "rgba(229,50,56,.08)",
      border: "rgba(229,50,56,.25)",
      live:   true,
      note:   "FVF + Checkout ≈ 13%",
      icon: `<svg width="26" height="14" viewBox="0 0 52 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <text x="0"  y="22" font-family="Arial Black,Arial" font-weight="900" font-size="26" fill="#E53238">e</text>
        <text x="13" y="22" font-family="Arial Black,Arial" font-weight="900" font-size="26" fill="#0064D2">b</text>
        <text x="27" y="22" font-family="Arial Black,Arial" font-weight="900" font-size="26" fill="#F5AF02">a</text>
        <text x="40" y="22" font-family="Arial Black,Arial" font-weight="900" font-size="26" fill="#86B817">y</text>
      </svg>`,
    },
    {
      id:     "kaufland",
      name:   "Kaufland.de",
      short:  "Kaufland",
      fee:    10.5,
      color:  "#CC0000",
      bg:     "rgba(204,0,0,.08)",
      border: "rgba(204,0,0,.25)",
      live:   true,
      note:   "Provision ≈ 10.5% (kategoriabhängig)",
      icon: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="5" fill="#CC0000"/>
        <text x="14" y="21" font-family="Arial Black,Arial" font-weight="900" font-size="16" fill="white" text-anchor="middle">K</text>
      </svg>`,
    },
    {
      id:     "amazon",
      name:   "Amazon.de",
      short:  "Amazon",
      fee:    15.0,
      color:  "#FF9900",
      bg:     "rgba(255,153,0,.08)",
      border: "rgba(255,153,0,.25)",
      live:   true,
      note:   "Verkaufsgebühr ≈ 15% FBM",
      icon: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="5" fill="#232F3E"/>
        <text x="14" y="19" font-family="Arial Black,Arial" font-weight="900" font-size="15" fill="#FF9900" text-anchor="middle">a</text>
        <path d="M7 22.5 Q14 26 21 22.5" stroke="#FF9900" stroke-width="1.6" stroke-linecap="round" fill="none"/>
      </svg>`,
    },
  ];

  let _el                = null;
  let _ek                = 0;
  let _cmpData           = null;   // raw /compare response
  let _prices            = {};     // { ebay: null|float, kaufland: null|float, amazon: null|float }
  let _selectedPlatforms = new Set(["ebay", "kaufland", "amazon"]);

  // ── Mount / Unmount ───────────────────────────────────────────────────────
  function mount(el) {
    _el = el;
    _cmpData = null;
    _prices  = { ebay: null, kaufland: null, amazon: null };
    _el.innerHTML = renderShell();
    bindSearch();
    bindPlatToggle();
  }

  function unmount() { _el = null; _cmpData = null; }

  // ── Shell ─────────────────────────────────────────────────────────────────
  function renderShell() {
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>Marktplatz</h1>
          <p>Live-Preisvergleich — eBay, Kaufland & Amazon in einer Ansicht</p>
          <div class="mp-stats-bar" id="mpStatsBar" style="display:none"></div>
        </div>
        <div class="page-header-right" style="align-items:flex-end;flex-direction:column;gap:8px">
          <div class="mp-plat-toggle" id="mpPlatToggle">
            <button class="mp-plat-btn${_selectedPlatforms.has("ebay")     ? " active" : ""}" data-plat="ebay">
              <svg width="10" height="10" viewBox="0 0 52 28" fill="none"><text x="0" y="20" font-family="Arial Black,Arial" font-weight="900" font-size="22" fill="#E53238">e</text><text x="11" y="20" font-family="Arial Black,Arial" font-weight="900" font-size="22" fill="#0064D2">b</text><text x="23" y="20" font-family="Arial Black,Arial" font-weight="900" font-size="22" fill="#F5AF02">a</text><text x="35" y="20" font-family="Arial Black,Arial" font-weight="900" font-size="22" fill="#86B817">y</text></svg>
              eBay
            </button>
            <button class="mp-plat-btn${_selectedPlatforms.has("kaufland") ? " active" : ""}" data-plat="kaufland">
              <svg width="11" height="11" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="5" fill="#CC0000"/><text x="14" y="21" font-family="Arial Black,Arial" font-weight="900" font-size="16" fill="white" text-anchor="middle">K</text></svg>
              Kaufland
            </button>
            <button class="mp-plat-btn${_selectedPlatforms.has("amazon")   ? " active" : ""}" data-plat="amazon">
              <svg width="11" height="11" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="5" fill="#232F3E"/><text x="14" y="19" font-family="Arial Black,Arial" font-weight="900" font-size="15" fill="#FF9900" text-anchor="middle">a</text></svg>
              Amazon
            </button>
          </div>
        </div>
      </div>

      <div class="mp-search-bar">
        <div class="input-prefix-wrap" style="flex:1;max-width:260px">
          <span class="prefix text-mono" id="mpTypePrefix" style="font-size:10px;letter-spacing:.04em">EAN</span>
          <input id="mpEan" class="input" type="text" placeholder="EAN oder ASIN (B0…)" maxlength="20" autocomplete="off"/>
        </div>
        <div class="input-prefix-wrap" style="max-width:150px">
          <span class="prefix">€ EK</span>
          <input id="mpEk" class="input" type="number" step="0.01" min="0" placeholder="0.00"/>
        </div>
        <button class="btn btn-primary" id="mpSearch">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M10.5 10.5L14.5 14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          Vergleichen
        </button>
      </div>

      <div id="mpEmpty" class="empty-state" style="margin-top:48px">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="2" y="3" width="6" height="18" rx="1.5"/>
          <rect x="9" y="3" width="6" height="18" rx="1.5"/>
          <rect x="16" y="3" width="6" height="18" rx="1.5"/>
        </svg>
        <p class="empty-title">Marktplatz-Vergleich</p>
        <p class="empty-sub">EAN + Einkaufspreis eingeben — Live-Preise der ausgewählten Plattformen werden geladen</p>
      </div>

      <div id="mpResults" style="display:none">
        <div id="mpProduct" class="mp-product-strip"></div>
        <div id="mpCards"   class="mp-cards-grid"></div>
        <div id="mpTable"   class="mp-table-card"></div>
      </div>
    `;
  }

  // ── Platform Toggle ───────────────────────────────────────────────────────
  function bindPlatToggle() {
    _el.querySelectorAll(".mp-plat-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const plat = btn.dataset.plat;
        if (_selectedPlatforms.has(plat)) {
          if (_selectedPlatforms.size <= 1) return; // keep at least 1
          _selectedPlatforms.delete(plat);
          btn.classList.remove("active");
        } else {
          _selectedPlatforms.add(plat);
          btn.classList.add("active");
        }
        if (_cmpData) { renderCards(); renderTable(); updateStatsBar(); }
      });
    });
  }

  function updateStatsBar() {
    const bar = _el?.querySelector("#mpStatsBar");
    if (!bar) return;
    if (!_cmpData) { bar.style.display = "none"; return; }
    const fmt = v => v != null && !isNaN(v) ? _fmtEurMp.format(v) : "—";
    const fmtP = v => v != null ? (v >= 0 ? "+" : "") + fmt(v) : "—";

    const rows = PLATFORMS
      .filter(p => _selectedPlatforms.has(p.id))
      .map(p => {
        const price = _prices[p.id];
        return { p, price, profit: price != null ? calcPlatform(price, _ek, p.fee).profit : null };
      })
      .filter(r => r.profit != null);

    if (!rows.length) { bar.style.display = "none"; return; }

    const best   = rows.reduce((a, b) => a.profit > b.profit ? a : b);
    const prices = rows.map(r => r.price).filter(Boolean);
    const spread = prices.length >= 2 ? Math.max(...prices) - Math.min(...prices) : null;
    const ean    = _cmpData.ean;
    const asin   = _cmpData.amazon?.asin;

    bar.style.display = "flex";
    bar.innerHTML = `
      <span class="sales-stat-pill ${best.profit >= 5 ? "sales-stat-pill-green" : "sales-stat-pill-yellow"}">⭐ <b>${best.p.short}</b> (${fmtP(best.profit)})</span>
      ${spread ? `<span class="sales-stat-pill"><b>${fmt(spread)}</b> Preisspanne</span>` : ""}
      <span class="sales-stat-pill"><b>${rows.length}</b> Plattformen</span>
      ${asin ? `<span class="sales-stat-pill" style="font-family:monospace;font-size:10px">ASIN: ${esc(asin)}</span>` : ""}
      ${ean  ? `<span class="sales-stat-pill" style="font-family:monospace;font-size:10px">EAN: ${esc(ean)}</span>` : ""}
    `;
  }

  // ── Search ────────────────────────────────────────────────────────────────
  function _isAsin(s) {
    const u = String(s || "").trim().toUpperCase();
    return /^[A-Z0-9]{10}$/.test(u) && /[A-Z]/.test(u);
  }
  function _isEan(s) { return /^\d{8,14}$/.test(String(s || "").trim()); }

  function bindSearch() {
    _el.querySelector("#mpSearch")?.addEventListener("click", doSearch);
    _el.querySelector("#mpEan")?.addEventListener("keydown", e => {
      if (e.key === "Enter") doSearch();
    });
    _el.querySelector("#mpEan")?.addEventListener("input", e => {
      const v = e.target.value.trim();
      const prefix = _el.querySelector("#mpTypePrefix");
      if (!prefix) return;
      if (_isAsin(v)) {
        prefix.textContent = "ASIN";
        prefix.style.color = "var(--accent)";
      } else {
        prefix.textContent = "EAN";
        prefix.style.color = "";
      }
    });
  }

  async function doSearch() {
    const rawInput = _el.querySelector("#mpEan")?.value.trim();
    const ek       = parseFloat(_el.querySelector("#mpEk")?.value) || 0;

    if (!rawInput) {
      Toast.error("EAN / ASIN fehlt", "Bitte EAN oder ASIN eingeben.");
      return;
    }
    const asinDetected = _isAsin(rawInput);
    const eanDetected  = _isEan(rawInput);
    if (!asinDetected && !eanDetected) {
      Toast.error("Ungültige Eingabe", "Bitte eine gültige EAN (8–14 Ziffern) oder ASIN (z.B. B0CX4F5P1S) eingeben.");
      return;
    }

    _ek = ek;
    const btn = _el.querySelector("#mpSearch");
    const btnOrigHTML = btn.innerHTML;
    btn.disabled = true;

    let ean = rawInput;

    // ── ASIN → EAN Resolution ───────────────────────────────────────────────
    if (asinDetected) {
      btn.innerHTML = `<span class="mp-spinner"></span> ASIN auflösen…`;
      try {
        const { ok: aok, data: adata } = await API.amazonCheck(rawInput.toUpperCase(), null, 0, "mid", "fba", 0, "sonstiges", 0);
        if (aok && adata?.ean) {
          ean = adata.ean;
          const inp    = _el.querySelector("#mpEan");
          const prefix = _el.querySelector("#mpTypePrefix");
          if (inp) inp.value = ean;
          if (prefix) { prefix.textContent = "EAN"; prefix.style.color = ""; }
          Toast.info("ASIN aufgelöst", `${rawInput.toUpperCase()} → EAN ${ean}`);
        } else {
          Toast.error("EAN nicht gefunden", `ASIN ${rawInput.toUpperCase()} hat keine EAN. Amazon-Karte zeigt ASIN-Daten.`);
          btn.disabled = false;
          btn.innerHTML = btnOrigHTML;
          return;
        }
      } catch {
        ErrorReporter.report(new Error("ASIN-Auflösung fehlgeschlagen"), "marketplace:doSearch:asinResolve");
        Toast.error("ASIN-Auflösung fehlgeschlagen", "Backend nicht erreichbar oder ASIN unbekannt.");
        btn.disabled = false;
        btn.innerHTML = btnOrigHTML;
        return;
      }
    }

    btn.innerHTML = `<span class="mp-spinner"></span> Lädt alle Märkte…`;

    let ok, data;
    try {
      ({ ok, data } = await API.compare(ean, ek));
    } catch (e) {
      console.warn("[Marketplace] compare error:", e);
      ok = false; data = null;
    } finally {
      if (btn && _el) {
        btn.disabled = false;
        btn.innerHTML = btnOrigHTML;
      }
    }

    if (!ok || !data) {
      ErrorReporter.report(new Error("Vergleich fehlgeschlagen"), "marketplace:doSearch:compare");
      Toast.error("Vergleich fehlgeschlagen", "Marktdaten konnten nicht geladen werden. Backend erreichbar?");
      return;
    }

    _cmpData = data;

    // Set live prices (null = not available → user can override manually)
    _prices.ebay     = data.ebay?.price     ?? null;
    _prices.kaufland = data.kaufland?.price  ?? null;
    _prices.amazon   = data.amazon?.price    ?? null;

    _el.querySelector("#mpEmpty").style.display   = "none";
    _el.querySelector("#mpResults").style.display = "block";

    renderProduct(data);
    renderCards();
    renderTable();
    updateStatsBar();
  }

  // ── Product Strip ─────────────────────────────────────────────────────────
  function renderProduct(d) {
    const title   = d.title || d.ean;
    const verdict = d.ebay?.verdict;

    _el.querySelector("#mpProduct").innerHTML = `
      <div class="mp-product-inner">
        ${d.image_url
          ? `<img class="mp-prod-img" src="${esc(d.image_url)}" alt="" loading="lazy"/>`
          : `<div class="mp-prod-img mp-prod-img-ph">
               <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
                 <rect x="1" y="2" width="14" height="12" rx="2" stroke="var(--text-muted)" stroke-width="1.2"/>
                 <circle cx="5.5" cy="6" r="1.5" stroke="var(--text-muted)" stroke-width="1.2"/>
                 <path d="M1 11l4-3 3 3 2-2 5 4" stroke="var(--text-muted)" stroke-width="1.2" stroke-linecap="round"/>
               </svg>
             </div>`}
        <div class="mp-prod-info">
          <div class="mp-prod-title">${esc(title.slice(0, 90))}</div>
          <div class="mp-prod-meta">
            <span class="text-mono text-muted" style="font-size:11px">EAN: ${esc(d.ean)}</span>
            ${verdict ? `&nbsp;·&nbsp;<span class="badge badge-${verdict === "BUY" ? "green" : verdict === "HOLD" ? "yellow" : "red"}" style="font-size:9px">${verdict}</span>` : ""}
            ${_ek > 0 ? `&nbsp;·&nbsp;<span style="font-size:11px;color:var(--text-muted)">EK: <strong style="color:var(--text-secondary)">${fmtEur(_ek)}</strong></span>` : ""}
          </div>
          <div class="mp-prod-stats">
            ${d.ebay?.sales_30d   != null ? `<span>📦 <strong>${d.ebay.sales_30d}</strong> eBay Verk./30d</span>` : ""}
            ${d.ebay?.days_to_cash != null ? `<span>⏱ <strong>${d.ebay.days_to_cash}d</strong> Ø Cashflow</span>` : ""}
            ${["HOT","OK","RISK"].includes(d.kaufland?.demand_label)
              ? `<span>🏪 Kaufland: <strong style="color:${d.kaufland.demand_label === "HOT" ? "var(--green)" : d.kaufland.demand_label === "OK" ? "var(--yellow)" : "var(--red)"}">${d.kaufland.demand_label}</strong> (${d.kaufland.demand_score})</span>`
              : ""}
            ${d.amazon?.asin
              ? `<a href="https://www.amazon.de/dp/${esc(d.amazon.asin)}" target="_blank" style="font-size:10px;color:var(--text-muted);text-decoration:none" title="Amazon Produktseite">🔗 ASIN: <span class="text-mono">${esc(d.amazon.asin)}</span></a>`
              : `<a href="https://www.amazon.de/s?k=${encodeURIComponent(d.ean)}" target="_blank" style="font-size:10px;color:var(--text-muted);text-decoration:none" title="Amazon nach EAN suchen">🔍 Amazon suchen →</a>`
            }
          </div>
        </div>
      </div>
    `;
  }

  // ── Platform Cards ────────────────────────────────────────────────────────
  function renderCards() {
    const grid = _el.querySelector("#mpCards");
    const visible = PLATFORMS.filter(p => _selectedPlatforms.has(p.id));
    grid.innerHTML = visible.map(p => buildCard(p)).join("");

    // Bind manual price overrides (when live price unavailable)
    PLATFORMS.forEach(p => {
      const inp = grid.querySelector(`#mpPriceInp_${p.id}`);
      if (!inp) return;
      inp.addEventListener("input", () => {
        _prices[p.id] = parseFloat(inp.value) || null;
        updateCardCalc(p);
        renderTable();
      });
    });
  }

  function buildCard(p) {
    const price  = _prices[p.id];
    const calc   = (price != null && _ek >= 0) ? calcPlatform(price, _ek, p.fee) : null;
    const d      = _cmpData;
    const best   = isBestPlatform(p.id);
    const isLive = p.live && price != null;

    // Platform-specific extra info
    let extraInfo = "";
    if (p.id === "kaufland" && d?.kaufland) {
      const kd = d.kaufland;
      extraInfo = `
        <div class="mp-card-extra">
          ${kd.offers_count != null ? `<span>${kd.offers_count} Angebote</span>` : ""}
          ${kd.bestseller   != null ? `<span>${kd.bestseller ? "⭐ Bestseller" : ""}</span>` : ""}
          ${kd.min_shipping != null && kd.min_shipping > 0 ? `<span>+ ${fmtEur(kd.min_shipping)} Versand</span>` : kd.min_shipping === 0 ? `<span>Kostenloser Versand</span>` : ""}
        </div>
      `;
    }
    if (p.id === "amazon" && d?.amazon) {
      const ad = d.amazon;
      extraInfo = `
        <div class="mp-card-extra">
          ${ad.buybox_price    != null ? `<span>BuyBox: ${fmtEur(ad.buybox_price)}</span>` : ""}
          ${ad.marketplace_new != null ? `<span>Marktplatz: ${fmtEur(ad.marketplace_new)}</span>` : ""}
          ${ad.amazon_direct   != null ? `<span>Amazon direkt: ${fmtEur(ad.amazon_direct)}</span>` : ""}
          ${ad.asin
            ? `<a href="https://www.amazon.de/dp/${esc(ad.asin)}" target="_blank" class="mp-asin-link">Produktseite: ${esc(ad.asin)} →</a>`
            : `<a href="https://www.amazon.de/s?k=${encodeURIComponent(d.ean)}" target="_blank" class="mp-asin-link">Auf Amazon nach EAN suchen →</a>`
          }
        </div>
      `;
    }
    if (p.id === "ebay" && d?.ebay) {
      const ed = d.ebay;
      extraInfo = `
        <div class="mp-card-extra">
          ${ed.listing_count  != null ? `<span>${ed.listing_count} Listings</span>` : ""}
          ${ed.price_avg      != null && ed.price_avg !== ed.price ? `<span>Ø ${fmtEur(ed.price_avg)}</span>` : ""}
          ${ed.price_min != null ? `<span>Min: ${fmtEur(ed.price_min)}</span>` : ""}
        </div>
      `;
    }

    return `
      <div class="mp-card${best ? " mp-card-best" : ""}" id="mpCard_${p.id}"
           style="--plat-color:${p.color};--plat-bg:${p.bg};--plat-border:${p.border}">
        ${best ? `<div class="mp-card-best-badge">⭐ Bestes Angebot</div>` : ""}

        <div class="mp-card-header">
          <div class="mp-card-icon">${p.icon}</div>
          <div>
            <div class="mp-card-name">${p.name}</div>
            <div class="mp-card-fee-pill">${p.fee.toFixed(1)}% Gebühr</div>
          </div>
        </div>

        <div class="mp-card-fee-note">${p.note}</div>

        <!-- Price -->
        <div class="mp-card-price-wrap">
          ${price != null ? `
            <div class="mp-card-price-label">${isLive ? "Live-Preis" : "Eingegebener Preis"}</div>
            <div class="mp-card-price-value">${fmtEur(price)}</div>
          ` : (() => {
            // Determine why price is unavailable → show helpful hint
            const err = (p.id === "kaufland" ? d?.kaufland?.error_reason : d?.amazon?.error_reason) || null;
            let hint = "";
            if (err === "NOT_FOUND" || err === "NO_MATCH") {
              hint = `<div class="mp-unavail-hint">${p.id === "amazon" ? "Nicht auf Amazon.de gelistet" : "Produkt nicht auf Kaufland gefunden"}</div>`;
            } else if (err && (err.includes("BLOCK") || err.includes("block") || err.includes("429") || err.includes("403"))) {
              hint = `<div class="mp-unavail-hint mp-unavail-blocked">⚠ Kaufland geblockt — Proxy erneuern</div>`;
            } else if (err === "NO_PRICE") {
              hint = `<div class="mp-unavail-hint">Preis wird von Keepa nicht getrackt</div>`;
            } else if (err) {
              hint = `<div class="mp-unavail-hint">Nicht verfügbar</div>`;
            }
            return `
              ${hint}
              <div class="mp-card-price-label" style="margin-top:${hint ? "6px" : "0"}">Manuell eingeben</div>
              <div class="input-prefix-wrap" style="margin-top:4px">
                <span class="prefix">€</span>
                <input id="mpPriceInp_${p.id}" class="input" type="number" step="0.01" min="0" placeholder="0.00"/>
              </div>
            `;
          })()}
        </div>

        ${extraInfo}

        <!-- Calculated metrics -->
        <div class="mp-card-metrics" id="mpMetrics_${p.id}">
          ${calc ? renderMetrics(calc, p) : renderMetricsEmpty(price == null)}
        </div>
      </div>
    `;
  }

  function renderMetrics(calc, p) {
    const { profit, margin, roi, fee } = calc;
    const profitColor = profit >= 7 ? "var(--green)" : profit >= 0 ? "var(--yellow)" : "var(--red)";
    const marginColor = margin >= 20 ? "var(--green)" : margin >= 10 ? "var(--yellow)" : "var(--red)";
    const roiColor    = roi    >= 20 ? "var(--green)" : roi    >= 0  ? "var(--yellow)" : "var(--red)";
    return `
      <div class="mp-metric">
        <span class="mp-metric-l">Gewinn</span>
        <span class="mp-metric-v" style="color:${profitColor}">${fmtEur(profit)}</span>
      </div>
      <div class="mp-metric">
        <span class="mp-metric-l">Margin</span>
        <span class="mp-metric-v" style="color:${marginColor}">${margin.toFixed(1)}%</span>
      </div>
      <div class="mp-metric">
        <span class="mp-metric-l">ROI</span>
        <span class="mp-metric-v" style="color:${roiColor}">${roi.toFixed(1)}%</span>
      </div>
      <div class="mp-metric">
        <span class="mp-metric-l">${p.short}-Gebühr</span>
        <span class="mp-metric-v text-muted">−${fmtEur(fee)}</span>
      </div>
    `;
  }

  function renderMetricsEmpty(noPrice) {
    return `<div class="mp-metrics-empty">${noPrice ? "Preis eingeben für<br>Gewinnberechnung" : "—"}</div>`;
  }

  function updateCardCalc(p) {
    const price     = _prices[p.id];
    const calc      = price != null ? calcPlatform(price, _ek, p.fee) : null;
    const metricsEl = _el.querySelector(`#mpMetrics_${p.id}`);
    if (metricsEl) metricsEl.innerHTML = calc ? renderMetrics(calc, p) : renderMetricsEmpty(price == null);

    // Refresh best-badge on all visible cards
    PLATFORMS.filter(pl => _selectedPlatforms.has(pl.id)).forEach(pl => {
      const card = _el.querySelector(`#mpCard_${pl.id}`);
      if (!card) return;
      const best = isBestPlatform(pl.id);
      card.classList.toggle("mp-card-best", best);
      let badge = card.querySelector(".mp-card-best-badge");
      if (best && !badge) {
        badge = document.createElement("div");
        badge.className = "mp-card-best-badge";
        badge.textContent = "⭐ Bestes Angebot";
        card.prepend(badge);
      } else if (!best && badge) {
        badge.remove();
      }
    });
  }

  // ── Comparison Table ──────────────────────────────────────────────────────
  function renderTable() {
    const tableEl = _el.querySelector("#mpTable");
    if (!tableEl) return;

    const rows = PLATFORMS.filter(p => _selectedPlatforms.has(p.id)).map(p => {
      const price = _prices[p.id];
      const calc  = price != null ? calcPlatform(price, _ek, p.fee) : null;
      return { platform: p, price, fee: calc?.fee ?? null, profit: calc?.profit ?? null, margin: calc?.margin ?? null, roi: calc?.roi ?? null };
    });

    const maxProfit = Math.max(...rows.map(r => r.profit).filter(v => v != null));

    tableEl.innerHTML = `
      <div class="mp-table-title">Vergleichsübersicht</div>
      <table class="mp-table">
        <thead>
          <tr>
            <th>Plattform</th>
            <th>Verkaufspreis</th>
            <th>Gebühr</th>
            <th>Gewinn</th>
            <th>Margin</th>
            <th>ROI</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const isBest = r.profit != null && r.profit === maxProfit && isFinite(maxProfit);
            return `
              <tr class="${isBest ? "mp-table-best" : ""}">
                <td>
                  <div class="mp-table-plat">
                    <span class="mp-table-dot" style="background:${r.platform.color}"></span>
                    ${r.platform.name}
                    ${isBest ? `<span class="al-chip al-chip-active" style="font-size:8px;padding:1px 5px">Best</span>` : ""}
                  </div>
                </td>
                <td>${r.price != null ? fmtEur(r.price) : `<span class="text-muted">—</span>`}</td>
                <td class="text-muted">${r.fee != null ? `−${fmtEur(r.fee)}` : "—"}</td>
                <td style="font-weight:600;color:${r.profit != null ? (r.profit >= 7 ? "var(--green)" : r.profit >= 0 ? "var(--yellow)" : "var(--red)") : "var(--text-muted)"}">
                  ${r.profit != null ? fmtEur(r.profit) : "—"}
                </td>
                <td style="color:${r.margin != null ? (r.margin >= 20 ? "var(--green)" : r.margin >= 10 ? "var(--yellow)" : "var(--red)") : "var(--text-muted)"}">
                  ${r.margin != null ? r.margin.toFixed(1) + "%" : "—"}
                </td>
                <td style="color:${r.roi != null ? (r.roi >= 20 ? "var(--green)" : r.roi >= 0 ? "var(--yellow)" : "var(--red)") : "var(--text-muted)"}">
                  ${r.roi != null ? r.roi.toFixed(1) + "%" : "—"}
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
      <div class="mp-table-hint">
        Live-Preise: eBay via eBay-API · Kaufland via Marketplace-Scraper · Amazon via Keepa API
        &nbsp;·&nbsp; Gebühren: Schätzwerte (tatsächliche Gebühr ist kategoriabhängig)
      </div>
    `;
  }

  // ── Calculation ───────────────────────────────────────────────────────────
  function calcPlatform(price, ek, feePct) {
    const fee    = price * (feePct / 100);
    const profit = price - ek - fee;
    const margin = price > 0 ? (profit / price * 100) : 0;
    const roi    = ek    > 0 ? (profit / ek    * 100) : 0;
    return { fee, profit, margin, roi };
  }

  function isBestPlatform(id) {
    const profits = PLATFORMS
      .filter(p => _selectedPlatforms.has(p.id))
      .map(p => ({ id: p.id, profit: _prices[p.id] != null ? calcPlatform(_prices[p.id], _ek, p.fee).profit : null }))
      .filter(x => x.profit != null);
    if (profits.length < 2) return false;
    const max  = Math.max(...profits.map(x => x.profit));
    const best = profits.find(x => x.profit === max);
    return best?.id === id;
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
  // ── Intl singleton — created once per IIFE ─────────────────────────────
  const _fmtEurMp = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

  function fmtEur(val) {
    if (val == null || isNaN(val)) return "—";
    return _fmtEurMp.format(val);
  }

  return { mount, unmount };
})();
