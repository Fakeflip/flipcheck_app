/* Flipcheck v2 — Listing Assistant */
const ListingAssistant = (() => {

  // ── Zustand-Optionen (eBay DE) ────────────────────────────────────────────
  function _conditions() {
    return [
      { id: "new",        get label() { return I18N.t('lst.cond.new'); },        get desc() { return I18N.t('lst.cond.new_desc'); } },
      { id: "like_new",   get label() { return I18N.t('lst.cond.like_new'); },   get desc() { return I18N.t('lst.cond.like_new_desc'); } },
      { id: "very_good",  get label() { return I18N.t('lst.cond.very_good'); },  get desc() { return I18N.t('lst.cond.very_good_desc'); } },
      { id: "good",       get label() { return I18N.t('lst.cond.good'); },       get desc() { return I18N.t('lst.cond.good_desc'); } },
      { id: "acceptable", get label() { return I18N.t('lst.cond.acceptable'); }, get desc() { return I18N.t('lst.cond.acceptable_desc'); } },
    ];
  }

  // ── Shipping-Optionen ─────────────────────────────────────────────────────
  const SHIP_METHODS = [
    { id: "dhl",     label: "DHL Paket" },
    { id: "hermes",  label: "Hermes" },
    { id: "dpd",     label: "DPD" },
    { id: "gls",     label: "GLS" },
    { id: "persoenlich", label: "Nur Abholung" },
  ];

  // ── Beschreibung generieren ───────────────────────────────────────────────
  function generateDescription(title, ean, conditionId, shipMethod) {
    const CONDITIONS = _conditions();
    const cond     = CONDITIONS.find(c => c.id === conditionId) || CONDITIONS[2];
    const ship     = SHIP_METHODS.find(s => s.id === shipMethod) || SHIP_METHODS[0];
    const condLine = `${cond.label} — ${cond.desc}`;

    return `Zum Verkauf steht: ${title}

EAN / GTIN: ${ean}
Zustand: ${condLine}

Der Artikel ist voll funktionsfähig und wurde sorgfältig geprüft.

Versand: ${ship.label}, versichert und sicher verpackt.
Zahlung: PayPal, Überweisung oder eBay-Checkout.

──────────────────────────
PRIVATVERKAUF – KEINE RÜCKNAHME
Gemäß § 474 Abs. 2 BGB ist die Sachmängelhaftung ausgeschlossen.
──────────────────────────

Bei Fragen stehe ich gerne zur Verfügung!`;
  }

  // ── Live-Profit-Kalkulator ────────────────────────────────────────────────
  // Vereinfacht: ~13% eBay-Gebühr (kein genaues Tiering — nur Schnellüberblick)
  function liveCalc(vk, ek, shipOut) {
    const fee    = vk * 0.13;
    const profit = vk - ek - fee - (shipOut || 0);
    const margin = vk > 0 ? (profit / vk * 100) : 0;
    const roi    = ek > 0 ? (profit / ek  * 100) : 0;
    return { fee, profit, margin, roi };
  }

  // ── Profit-Box HTML ───────────────────────────────────────────────────────
  function renderProfitBox(profit, margin, roi, fee) {
    const c = (v, pos, mid) => v >= pos ? "var(--green)" : v >= mid ? "var(--yellow)" : "var(--red)";
    return `
      <div class="la-profit-label">${I18N.t('lst.lbl.profit_box')}</div>
      <div class="la-profit-grid">
        <div class="la-kpi">
          <div class="la-kpi-l">${I18N.t('lst.kpi.profit')}</div>
          <div class="la-kpi-v" style="color:${c(profit,7,0)}">${fmtEur(profit)}</div>
        </div>
        <div class="la-kpi">
          <div class="la-kpi-l">${I18N.t('lst.kpi.margin')}</div>
          <div class="la-kpi-v" style="color:${c(margin,20,10)}">${margin.toFixed(1)}%</div>
        </div>
        <div class="la-kpi">
          <div class="la-kpi-l">${I18N.t('lst.kpi.roi')}</div>
          <div class="la-kpi-v" style="color:${c(roi,20,0)}">${roi.toFixed(1)}%</div>
        </div>
        <div class="la-kpi">
          <div class="la-kpi-l">${I18N.t('lst.kpi.fee')}</div>
          <div class="la-kpi-v text-muted">−${fmtEur(fee)}</div>
        </div>
      </div>
    `;
  }

  // ── Modal Body ────────────────────────────────────────────────────────────
  function renderBody(data, ean, ek) {
    const suggestedVk = data.sell_price_median ?? data.sell_price_avg ?? 0;
    const title       = data.title || ean;
    const defaultDesc = generateDescription(title, ean, "very_good", "dhl");
    const { fee, profit, margin, roi } = liveCalc(suggestedVk, parseFloat(ek), 0);

    const condOptions = _conditions().map(c =>
      `<option value="${c.id}"${c.id === "very_good" ? " selected" : ""}>${c.label}</option>`
    ).join("");

    const shipOptions = SHIP_METHODS.map(s =>
      `<option value="${s.id}">${s.label}</option>`
    ).join("");

    return `
      <div class="la-body">

        <!-- ── Left: Produkt + Beschreibung ── -->
        <div class="la-left">
          ${data.image_url
            ? `<img class="la-img" src="${esc(data.image_url)}" loading="lazy" alt="">`
            : `<div class="la-img-placeholder"><svg width="32" height="32" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="12" rx="2" stroke="var(--text-muted)" stroke-width="1.2"/><circle cx="5.5" cy="6" r="1.5" stroke="var(--text-muted)" stroke-width="1.2"/><path d="M1 11l4-3 3 3 2-2 5 4" stroke="var(--text-muted)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`}

          <div class="la-product-title">${esc(title.slice(0, 90))}</div>
          <div class="text-xs text-muted mb-16">
            EAN: <span class="text-mono font-semibold" style="color:var(--text-secondary)">${esc(ean)}</span>
            ${data.verdict ? `&nbsp;·&nbsp;<span class="badge badge-${data.verdict === "BUY" ? "green" : data.verdict === "HOLD" ? "yellow" : "red"}" style="font-size:9px">${data.verdict}</span>` : ""}
          </div>

          <label class="input-label mb-4">${I18N.t('lst.lbl.description')}</label>
          <textarea id="laDesc" class="la-desc">${escHtml(defaultDesc)}</textarea>

          <div class="row gap-8 mt-8">
            <button class="btn btn-ghost btn-sm" id="laCopyDesc">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <rect x="5.5" y="1.5" width="9" height="11" rx="1.2" stroke="currentColor" stroke-width="1.4"/>
                <rect x="1.5" y="4.5" width="9" height="11" rx="1.2" stroke="currentColor" stroke-width="1.4" fill="var(--bg-panel)"/>
              </svg>
              ${I18N.t('lst.btn.copy_desc')}
            </button>
            <button class="btn btn-ghost btn-sm" id="laRegen">${I18N.t('lst.btn.regen')}</button>
          </div>
        </div>

        <!-- ── Right: Eingaben + Live-Calc ── -->
        <div class="la-right">

          <div class="la-field">
            <label class="input-label">${I18N.t('lst.lbl.sell_price')}</label>
            <div class="input-prefix-wrap">
              <span class="prefix">€</span>
              <input id="laVk" class="input" type="number" step="0.01" min="0"
                value="${suggestedVk > 0 ? suggestedVk.toFixed(2) : ""}" placeholder="0.00"/>
            </div>
            ${suggestedVk > 0 ? `<div class="input-hint">eBay Ø: ${fmtEur(suggestedVk)}</div>` : ""}
          </div>

          <div class="grid-2-md">
            <div class="la-field">
              <label class="input-label">${I18N.t('lst.lbl.condition')}</label>
              <select id="laCondition" class="select">${condOptions}</select>
            </div>
            <div class="la-field">
              <label class="input-label">${I18N.t('lst.lbl.qty')}</label>
              <input id="laQty" class="input" type="number" min="1" value="1"/>
            </div>
          </div>

          <div class="grid-2-md">
            <div class="la-field">
              <label class="input-label">${I18N.t('lst.lbl.ship_method')}</label>
              <select id="laShipMethod" class="select">${shipOptions}</select>
            </div>
            <div class="la-field">
              <label class="input-label">${I18N.t('lst.lbl.ship_cost')}</label>
              <div class="input-prefix-wrap">
                <span class="prefix">€</span>
                <input id="laShipOut" class="input" type="number" step="0.01" min="0" value="0.00"/>
              </div>
            </div>
          </div>

          <!-- Live Profit -->
          <div class="la-profit-box" id="laProfitBox">
            ${renderProfitBox(profit, margin, roi, fee)}
          </div>

          <div class="la-field">
            <label class="input-label">${I18N.t('lst.lbl.notes')}</label>
            <input id="laNotes" class="input" type="text" placeholder="${I18N.t('lst.ph.notes')}"/>
          </div>

          <div class="la-ctas">
            <button class="btn btn-secondary btn-sm" id="laOpenEbay" title="Kopiert Titel, EAN &amp; Preis — dann eBay Sell-Seite öffnen">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <rect x="5.5" y="1.5" width="9" height="11" rx="1.2" stroke="currentColor" stroke-width="1.4"/>
                <rect x="1.5" y="4.5" width="9" height="11" rx="1.2" stroke="currentColor" stroke-width="1.4" fill="var(--bg-panel)"/>
              </svg>
              ${I18N.t('lst.btn.copy_open')}
            </button>
            <button class="btn btn-primary btn-sm" id="laSaveInv">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="5" width="14" height="10" rx="1" stroke="currentColor" stroke-width="1.5"/>
                <path d="M5 5V4a3 3 0 0 1 6 0v1M6 10.5h4M8 8.5v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              ${I18N.t('lst.btn.save')}
            </button>
          </div>

        </div>
      </div>
    `;
  }

  // ── Events im Modal binden ────────────────────────────────────────────────
  function bindEvents(data, ean, ek) {
    // Kurz warten bis DOM fertig
    const tryBind = (attempts = 0) => {
      const overlay = document.getElementById("modal-overlay");
      if (!overlay || overlay.style.display === "none") {
        if (attempts < 10) setTimeout(() => tryBind(attempts + 1), 50);
        return;
      }

      const vkInp      = overlay.querySelector("#laVk");
      const shipOutInp = overlay.querySelector("#laShipOut");
      const condSel    = overlay.querySelector("#laCondition");
      const shipMeth   = overlay.querySelector("#laShipMethod");
      const descTa     = overlay.querySelector("#laDesc");
      const profitBox  = overlay.querySelector("#laProfitBox");

      // Live-Profit-Update
      const updateCalc = () => {
        const vk = parseFloat(vkInp?.value) || 0;
        const so = parseFloat(shipOutInp?.value) || 0;
        const { fee, profit, margin, roi } = liveCalc(vk, parseFloat(ek), so);
        if (profitBox) profitBox.innerHTML = renderProfitBox(profit, margin, roi, fee);
      };
      vkInp?.addEventListener("input", updateCalc);
      shipOutInp?.addEventListener("input", updateCalc);

      // Beschreibung regenerieren wenn Zustand oder Versand ändert
      const regenDesc = () => {
        if (!descTa) return;
        descTa.value = generateDescription(
          data.title || ean, ean,
          condSel?.value || "very_good",
          shipMeth?.value || "dhl"
        );
      };
      condSel?.addEventListener("change", regenDesc);
      shipMeth?.addEventListener("change", regenDesc);

      // Beschreibung kopieren
      overlay.querySelector("#laCopyDesc")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(descTa?.value || "");
          Toast.success(I18N.t('lst.toast.copied'), I18N.t('lst.toast.copy_ok'));
        } catch { Toast.error(I18N.t('lst.toast.copy_failed'), I18N.t('lst.toast.copy_err')); }
      });

      // Beschreibung neu generieren
      overlay.querySelector("#laRegen")?.addEventListener("click", regenDesc);

      // Auf eBay öffnen — eBay unterstützt kein URL-Pre-Filling, daher:
      // Titel + EAN + Preis in Zwischenablage → eBay Sell-Seite öffnen
      overlay.querySelector("#laOpenEbay")?.addEventListener("click", async () => {
        const vkVal  = parseFloat(vkInp?.value) || null;
        const cond   = _conditions().find(c => c.id === (condSel?.value || "very_good"))?.label || I18N.t('lst.cond.very_good');
        const clipLines = [
          data.title || ean,
          `EAN: ${ean}`,
          `Zustand: ${cond}`,
          vkVal ? `Preis: ${fmtEur(vkVal)}` : "",
        ].filter(Boolean).join("\n");

        try { await navigator.clipboard.writeText(clipLines); } catch {}
        window.open("https://www.ebay.de/sell", "_blank");
        Toast.info(I18N.t('lst.toast.ebay_opened'), I18N.t('lst.toast.ebay_sub'));
      });

      // In Inventory speichern
      overlay.querySelector("#laSaveInv")?.addEventListener("click", async () => {
        const vk    = parseFloat(vkInp?.value) || null;
        const cond  = condSel?.value || "very_good";
        const qty   = parseInt(overlay.querySelector("#laQty")?.value)  || 1;
        const notes = overlay.querySelector("#laNotes")?.value || "";
        await saveToInventory(data, ean, ek, vk, cond, qty, notes);
      });
    };

    requestAnimationFrame(() => tryBind());
  }

  // ── Speichern ─────────────────────────────────────────────────────────────
  async function saveToInventory(data, ean, ek, vk, condition, qty, notes) {
    try {
      await Storage.upsertItem({
        ean,
        title:      data.title || ean,
        ek:         parseFloat(ek),
        sell_price: vk ? parseFloat(vk) : null,
        qty:        qty || 1,
        market:     "ebay",
        status:     "IN_STOCK",
        notes:      notes || "",
        condition:  condition || "very_good",
      });
      Toast.success(I18N.t('lst.toast.saved'), `${(data.title || ean).slice(0, 40)} → ${I18N.t('nav.inventory')}`);
      Modal.close();
    } catch {
      Toast.error(I18N.t('lst.toast.save_failed'), I18N.t('lst.toast.save_err'));
    }
  }

  // ── Öffnen ────────────────────────────────────────────────────────────────
  function open(data, ean, ek) {
    Modal.open({
      title: I18N.t('lst.title'),
      body:  renderBody(data, ean, parseFloat(ek)),
      width: 860,
    });
    // Buttons sind im Body selbst (la-ctas), nicht im Modal-Footer
    // Footer bleibt leer → kein extra close-Button nötig
    bindEvents(data, ean, ek);
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
  function escHtml(s) {
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
  // Intl singleton — created once per IIFE
  const _fmtEurListing = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

  function fmtEur(val) {
    if (val == null || isNaN(val)) return "—";
    return _fmtEurListing.format(val);
  }

  return { open };
})();
