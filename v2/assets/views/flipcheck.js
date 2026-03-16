/* Flipcheck v2 — Single Flipcheck View */
const FlipcheckView = (() => {
  let _container = null;

  // ─── eBay DE category fee structure (Ohne Shop, official rates) ───────────
  // tiers: [[threshold_up_to, rate], ..., [null, rate_above]]
  // e.g. [[990, 0.065], [null, 0.03]] → 6,5% bis €990, 3% darüber
  const CATEGORIES = [
    // ── Geräte: 6,5 % bis €990, danach 3 % ──────────────────────────────
    { id: "computer_tablets",  label: "Computer, Tablets & Netzwerk",  group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "drucker",           label: "Drucker",                        group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "foto_camcorder",    label: "Foto & Camcorder",               group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "handys",            label: "Handys & Kommunikation",         group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "haushaltsgeraete",  label: "Haushaltsgeräte",                group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "konsolen",          label: "Konsolen / Videospiele",         group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "scanner",           label: "Scanner",                        group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "speicherkarten",    label: "Speicherkarten",                 group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "tv_video_audio",    label: "TV, Video & Audio",              group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    { id: "koerperpflege",     label: "Elektr. Körperpflege & Styling", group: "Geräte (6,5% + 3%)",  tiers: [[990, 0.065], [null, 0.03]] },
    // ── Zubehör: 11 % bis €990, danach 3 % ──────────────────────────────
    { id: "drucker_zubehoer",  label: "Drucker- & Scanner-Zubehör",    group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "handy_zubehoer",    label: "Handy-Zubehör",                  group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "batterien",         label: "Haushaltsbatterien & Strom",     group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "kabel",             label: "Kabel & Steckverbinder",         group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "kameras_zubehoer",  label: "Kameras, Drohnen & Fotozubehör",group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "notebook_zubehoer", label: "Notebook- & Desktop-Zubehör",   group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "objektive",         label: "Objektive & Filter",             group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "stative",           label: "Stative & Zubehör",             group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "tablet_zubehoer",   label: "Tablet & eBook Zubehör",        group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "tastaturen_maeuse", label: "Tastaturen, Mäuse & Pointing",   group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "tv_zubehoer",       label: "TV- & Heim-Audio-Zubehör",      group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "pc_zubehoer",       label: "PC & Videospiele Zubehör",      group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    { id: "audio_zubehoer",    label: "Zubehör Audiogeräte",           group: "Zubehör (11% + 3%)",  tiers: [[990, 0.11], [null, 0.03]] },
    // ── Sonstige Flat-Rate ───────────────────────────────────────────────
    { id: "mode",              label: "Mode / Bekleidung",              group: "Sonstiges (Flat)",     tiers: [[null, 0.15]]  },
    { id: "sport_freizeit",    label: "Sport & Freizeit",               group: "Sonstiges (Flat)",     tiers: [[null, 0.115]] },
    { id: "spielzeug",         label: "Spielzeug / LEGO",               group: "Sonstiges (Flat)",     tiers: [[null, 0.115]] },
    { id: "haushalt_garten",   label: "Haushalt & Garten",              group: "Sonstiges (Flat)",     tiers: [[null, 0.115]] },
    { id: "buecher",           label: "Bücher & Medien",                group: "Sonstiges (Flat)",        tiers: [[null, 0.15]]  },
    { id: "sonstiges",         label: "Sonstiges",                      group: "Sonstiges (Flat)",        tiers: [[null, 0.13]]  },
    { id: "durchstarter",      label: "Durchstarter / Sonderaktion",    group: "Sonderkonditionen (0 %)", tiers: [[null, 0.00]]  },
  ];

  // calcEbayFee is global (defined in app.js — EBAY_FEE_CATEGORIES + calcEbayFee)

  // ─── Full profit calc (frontend-side, tiered fees + VAT) ─────────────────
  // Returns { feeGross, feeNet, vkNet, ekNet, siNet, soNet, packNet, adFeeGross, adFeeNet, profit, margin }
  function calcProfit(vkGross, ekGross, catId, vatMode, ekMode, shipInGross, shipOutGross, packagingPerUnit = 0, qty = 1, market = "ebay", adRatePct = 0) {
    const vat      = vatMode === "ust_19" ? 1.19 : 1.0;
    const feeGross = calcMarketFee(vkGross, market, catId);
    const feeNet   = feeGross / vat;
    const vkNet    = vkGross  / vat;
    const ekNet    = (vatMode === "ust_19" && ekMode === "gross") ? ekGross / vat : ekGross;
    // Guard undefined/NaN shipping params (callers may omit them → default 0)
    const siNet    = (shipInGross  || 0) / vat;
    const soNet    = (shipOutGross || 0) / vat;
    const packNet  = packagingPerUnit; // packaging is already a net cost (no VAT recovery on packaging typically)
    // Advertising fee (eBay Promoted Listings): percentage of gross sell price
    const adFeeGross = vkGross * ((adRatePct || 0) / 100);
    const adFeeNet   = adFeeGross / vat;
    const profit   = vkNet - feeNet - ekNet - siNet - soNet - packNet - adFeeNet;
    // Margin: net profit / net revenue — consistent denominator regardless of VAT mode
    const margin   = vkNet > 0 ? (profit / vkNet * 100) : 0;
    return { feeGross, feeNet, vkNet, ekNet, siNet, soNet, packNet, adFeeGross, adFeeNet, profit, margin };
  }

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

  function _buildKlCatOptions(selectedId) {
    const cats = [
      ["kl_elektronik",  "Elektronik / Computer (8,5 %)"],
      ["kl_handys",      "Handys / Smartphones (8,5 %)"],
      ["kl_gaming",      "Gaming / Konsolen (8,5 %)"],
      ["kl_foto",        "Foto & Camcorder (8,5 %)"],
      ["kl_haushalt_el", "Haushaltsgeräte (8,5 %)"],
      ["kl_buecher",     "Bücher & Medien (8,5 %)"],
      ["kl_sport",       "Sport & Freizeit (10,5 %)"],
      ["kl_spielzeug",   "Spielzeug (10,5 %)"],
      ["kl_haushalt",    "Haushalt & Küche (10,5 %)"],
      ["kl_garten",      "Garten & DIY (10,5 %)"],
      ["kl_mode",        "Kleidung & Schuhe (17,5 %)"],
      ["kl_sonstiges",   "Sonstiges (10,5 %)"],
    ];
    const sel = selectedId || "kl_sonstiges";
    return cats.map(([v, l]) => `<option value="${v}"${v === sel ? " selected" : ""}>${esc(l)}</option>`).join("");
  }

  // ─── FBA tier table (DE, 2025 + DE-Aufschlag €0.26) ──────────────────────
  const DE_FBA_SURCHARGE = 0.26;
  const FBA_TIERS = [
    { label: "Klein Standard",   maxW: 0.20, maxSide: 20, fee: 2.70 + DE_FBA_SURCHARGE },
    { label: "Klein Standard+",  maxW: 0.40, maxSide: 30, fee: 3.00 + DE_FBA_SURCHARGE },
    { label: "Standard 1",       maxW: 0.90, maxSide: 33, fee: 3.40 + DE_FBA_SURCHARGE },
    { label: "Standard 2",       maxW: 1.50, maxSide: 33, fee: 3.80 + DE_FBA_SURCHARGE },
    { label: "Groß 1",           maxW: 3.00, maxSide: 45, fee: 4.70 + DE_FBA_SURCHARGE },
    { label: "Groß 2",           maxW: 5.00, maxSide: 61, fee: 5.40 + DE_FBA_SURCHARGE },
    { label: "Groß 3",           maxW: 9.00, maxSide: 61, fee: 6.50 + DE_FBA_SURCHARGE },
    { label: "Groß 4",           maxW:15.00, maxSide: 74, fee: 8.10 + DE_FBA_SURCHARGE },
    { label: "Schwer/Sperrig",   maxW: null, maxSide: null,fee:9.80 + DE_FBA_SURCHARGE },
  ];

  const AMZ_REFERRAL_FEES = {
    computer_tablets: 0.06, handys: 0.08, konsolen: 0.08,
    foto_camcorder: 0.08,   tv_video_audio: 0.08, haushaltsgeraete: 0.08,
    drucker: 0.08, handy_zubehoer: 0.15, notebook_zubehoer: 0.15,
    kabel: 0.15, mode: 0.15, sport_freizeit: 0.15,
    spielzeug: 0.15, buecher: 0.15, sonstiges: 0.15,
  };

  // Closing fee — media categories (Bücher, DVDs, Musik, Software, Games)
  const AMZ_CLOSING_FEE = 1.01;
  const AMZ_CLOSING_CATS = ['buecher'];

  // ─── Amazon Breadcrumb → Category Auto-Detect ─────────────────────────────
  const AMZ_CAT_MAP = [
    { keywords: ['computer', 'laptop', 'notebook', 'tablet', 'pc '], cat: 'computer_tablets' },
    { keywords: ['handy', 'smartphone', 'mobiltelefon'], cat: 'handys' },
    { keywords: ['konsole', 'playstation', 'xbox', 'nintendo', 'gaming', 'videospiel'], cat: 'konsolen' },
    { keywords: ['kamera', 'foto', 'camcorder', 'objektiv'], cat: 'foto_camcorder' },
    { keywords: ['fernseher', 'tv', 'audio', 'kopfhörer', 'lautsprecher'], cat: 'tv_video_audio' },
    { keywords: ['haushaltsgerät', 'kühlschrank', 'waschmaschine', 'staubsauger'], cat: 'haushaltsgeraete' },
    { keywords: ['drucker', 'scanner', 'toner', 'patrone'], cat: 'drucker' },
    { keywords: ['handyhülle', 'handyzubehör', 'schutzhülle'], cat: 'handy_zubehoer' },
    { keywords: ['notebookzubehör', 'laptopzubehör', 'tastatur', 'maus'], cat: 'notebook_zubehoer' },
    { keywords: ['kabel', 'adapter', 'stecker', 'usb', 'hdmi'], cat: 'kabel' },
    { keywords: ['bekleidung', 'mode', 'kleidung', 'schuhe'], cat: 'mode' },
    { keywords: ['sport', 'fitness', 'outdoor', 'fahrrad'], cat: 'sport_freizeit' },
    { keywords: ['spielzeug', 'lego', 'puppe', 'puzzle', 'brettspiel'], cat: 'spielzeug' },
    { keywords: ['buch', 'bücher', 'taschenbuch', 'dvd', 'blu-ray', 'musik', 'cd'], cat: 'buecher' },
  ];

  function _detectAmzCategory(categoryName) {
    if (!categoryName) return null;
    const lower = categoryName.toLowerCase();
    for (const entry of AMZ_CAT_MAP) {
      if (entry.keywords.some(kw => lower.includes(kw))) return entry.cat;
    }
    return null;
  }

  // ─── State ────────────────────────────────────────────────────────────────
  let selectedMarket = "ebay";   // "ebay" | "amazon" | "kaufland"
  let _vatMode   = "no_vat";
  let _ekMode    = "gross";
  let lastResult = null;
  let lastEan    = null;
  let lastEk     = null;
  let _miniChart = null;   // Chart.js instance for the inline price sparkline
  let _visibleFields = { ship_in: true, ship_out: true, packaging: false, ad_rate: false };

  // ─── Scanner IPC callback (stable ref for add/remove) ─────────────────────
  function _onScannerEan(ean) {
    if (!_container) return;
    const inp = _container.querySelector("#fcEan");
    if (!inp) return;
    inp.value = ean;
    inp.dispatchEvent(new Event("input"));
    inp.focus();
    if (typeof Toast !== "undefined") Toast.success(I18N.t('fc.scanner.toast_title'), ean);
  }

  // ─── Mount ────────────────────────────────────────────────────────────────
  async function mount(container, navId) {
    _container = container;

    // Load settings for VAT / EK mode + field visibility
    try {
      const s = await Storage.getSettings();
      _vatMode = s?.tax?.vat_mode  || "no_vat";
      _ekMode  = s?.tax?.ek_mode   || "gross";
      const ff = s?.flipcheck_fields || {};
      _visibleFields = {
        ship_in:   ff.ship_in   !== false,
        ship_out:  ff.ship_out  !== false,
        packaging: ff.packaging === true,
        ad_rate:   ff.ad_rate   === true,
      };
    } catch {}

    // Guard: user may have navigated away during async load
    if (navId !== undefined && navId !== null && typeof App !== "undefined" && App._navId !== navId) return;

    // Check for deep-link or inventory payload
    const _payload = typeof App !== "undefined" ? App._navPayload : null;
    if (_payload?.ean && _payload.autoRun) {
      // Deep-link (flipcheck://check): set market, pre-fill, auto-run
      App._navPayload = null;
      if (_payload.market) selectedMarket = _payload.market;
      container.innerHTML = renderForm({ ean: _payload.ean, ek: _payload.ek, category: _payload.cat });
      attachEvents(container);
      runCheck(container);
    } else {
      container.innerHTML = renderForm();
      attachEvents(container);
      // Pre-fill EAN from Inventory "Flipcheck" button (simple payload, no auto-run)
      if (_payload?.ean) {
        App._navPayload = null;
        const eanInp = container.querySelector("#fcEan");
        if (eanInp) {
          eanInp.value = _payload.ean;
          eanInp.dispatchEvent(new Event("input", { bubbles: true }));
          eanInp.focus();
        }
      }
    }

    // Register barcode scanner IPC listener
    window.fc?.onScannerEan(_onScannerEan);
  }

  function unmount() {
    if (_miniChart) { try { _miniChart.destroy(); } catch {} _miniChart = null; }
    window.fc?.offScannerEan(_onScannerEan);
    _container = null;
  }

  // ─── Market toggle HTML ───────────────────────────────────────────────────
  function renderMarketToggle() {
    return `
      <div style="display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap">
        <button class="btn btn-sm ${selectedMarket==="ebay"?"btn-primary":"btn-ghost"}" id="mktEbay" style="gap:6px">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M1 6h14" stroke="currentColor" stroke-width="1.5"/></svg>
          eBay
        </button>
        <button class="btn btn-sm ${selectedMarket==="amazon"?"btn-primary":"btn-ghost"}" id="mktAmazon" style="gap:6px">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 12c3-1 6.5-.5 9 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="6" r="4" stroke="currentColor" stroke-width="1.5"/></svg>
          Amazon
        </button>
        <button class="btn btn-sm ${selectedMarket==="kaufland"?"btn-primary":"btn-ghost"}" id="mktKaufland" style="gap:6px">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 13V7l5-4 5 4v6" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><rect x="6" y="9" width="4" height="4" rx=".5" stroke="currentColor" stroke-width="1.3"/></svg>
          Kaufland
        </button>
      </div>
    `;
  }

  // ─── Form ─────────────────────────────────────────────────────────────────
  function renderForm(state = {}) {
    const catId = state.category || "sonstiges";
    const vatBadge = _vatMode === "ust_19"
      ? `<div class="fc-info-pill fc-info-pill--accent mt-8">
           <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#6366F1" stroke-width="1.2"/><path d="M8 5v3.5M8 10.5v.5" stroke="#6366F1" stroke-width="1.5" stroke-linecap="round"/></svg>
           <span class="text-xs">${I18N.t('fc.vat.regelbesteuerung')}</span>
         </div>`
      : `<div class="fc-info-pill fc-info-pill--neutral mt-8">
           <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="var(--text-muted)" stroke-width="1.2"/><path d="M5 8h6" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round"/></svg>
           <span class="text-xs text-muted">${I18N.t('fc.vat.kleinunternehmer')}</span>
         </div>`;

    const isAmz = selectedMarket === "amazon";
    const isKl  = selectedMarket === "kaufland";
    return `
      <div class="page-header">
        <div class="page-header-left">
          <h1>${I18N.t('nav.flipcheck')}</h1>
          <p>${I18N.t('fc.subtitle')}</p>
        </div>
      </div>

      <div class="fc-split-420">
        <!-- Form -->
        <div class="panel">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h3 class="panel-title" style="margin:0">${I18N.t('fc.form.title')}</h3>
            ${renderMarketToggle()}
          </div>

          <div class="col gap-12">
            <div class="input-group">
              <label class="input-label">${isAmz ? "ASIN / EAN" : "EAN"}</label>
              <div style="display:flex;gap:6px">
                <input id="fcEan" class="input" type="text"
                  placeholder="${isAmz ? I18N.t('fc.form.ean_placeholder_amz') : I18N.t('fc.form.ean_placeholder')}"
                  value="${esc(state.ean||"")}" autocomplete="off" style="flex:1" />
                ${!isAmz ? `<button class="btn btn-ghost btn-sm" id="fcScanBtn" title="Handy-Scanner öffnen" style="flex-shrink:0;font-size:16px;padding:0 10px">📷</button>` : ""}
              </div>
              ${isAmz ? `
              <div id="fcConverterBox" style="display:none;margin-top:6px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border2);border-radius:var(--r-sm)">
                <div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px">${I18N.t('fc.converter.title')}</div>
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                  <div>
                    <div style="font-size:10px;color:var(--dim);margin-bottom:2px">EAN</div>
                    <span id="fcConvEan" class="text-mono" style="font-size:12px;color:var(--text)">—</span>
                  </div>
                  <span style="color:var(--border2);font-size:14px">↔</span>
                  <div>
                    <div style="font-size:10px;color:var(--dim);margin-bottom:2px">ASIN</div>
                    <span id="fcConvAsin" class="text-mono" style="font-size:12px;color:var(--accent)">—</span>
                  </div>
                  <button id="fcConvCopy" class="btn btn-ghost btn-xs" style="margin-left:auto;font-size:10px;padding:2px 8px" title="${I18N.t('fc.converter.copy_hint')}">${I18N.t('fc.converter.copy')}</button>
                </div>
              </div>` : ""}
            </div>

            <div class="input-group">
              <label class="input-label">${I18N.t('fc.form.ek_label')}</label>
              <div class="input-prefix-wrap">
                <span class="prefix">€</span>
                <input id="fcEk" class="input" type="number" step="0.01" min="0" placeholder="0.00"
                  value="${esc(state.ek||"")}" />
              </div>
            </div>

            <!-- eBay / Kaufland category field (hidden for Amazon) -->
            <div id="fcEbayFields" style="display:${isAmz?"none":"contents"}">
              <div class="input-group">
                <label class="input-label">${isKl ? I18N.t('fc.form.kl_category') : I18N.t('fc.form.ebay_category')}</label>
                <select id="fcCategory" class="select">
                  ${isKl ? _buildKlCatOptions(catId) : buildCatOptions(catId)}
                </select>
                ${isKl ? "" : vatBadge}
              </div>

              ${(_visibleFields.ship_in || _visibleFields.ship_out) ? `
              <div class="input-group">
                <label class="input-label">${I18N.t('fc.form.shipping')}${_vatMode==="ust_19"?" "+I18N.t('fc.form.gross_suffix'):""}</label>
                <div class="grid-2-sm">
                  ${_visibleFields.ship_in ? `<div>
                    <div class="text-xs text-muted mb-4">${I18N.t('fc.form.ship_in')}</div>
                    <div class="input-prefix-wrap">
                      <span class="prefix">€</span>
                      <input id="fcShipIn" class="input" type="number" step="0.01" min="0" placeholder="0.00"
                        value="${esc(state.shipping_in||"")}" />
                    </div>
                  </div>` : ""}
                  ${_visibleFields.ship_out ? `<div>
                    <div class="text-xs text-muted mb-4">${I18N.t('fc.form.ship_out')}</div>
                    <div class="input-prefix-wrap">
                      <span class="prefix">€</span>
                      <input id="fcShipOut" class="input" type="number" step="0.01" min="0" placeholder="0.00"
                        value="${esc(state.shipping_out||"")}" />
                    </div>
                  </div>` : ""}
                </div>
              </div>` : ""}

              ${_visibleFields.packaging ? `
              <div class="input-group">
                <label class="input-label">${I18N.t('fc.form.packaging')}</label>
                <div class="input-prefix-wrap">
                  <span class="prefix">€</span>
                  <input id="fcPackaging" class="input" type="number" step="0.01" min="0" placeholder="0.00"
                    value="${esc(state.packaging||"")}" />
                </div>
                <span class="input-hint">${I18N.t('fc.form.packaging_hint')}</span>
              </div>` : ""}

              ${_visibleFields.ad_rate ? `
              <div class="input-group">
                <label class="input-label">${I18N.t('fc.form.ad_rate')}</label>
                <div class="input-prefix-wrap">
                  <span class="prefix">%</span>
                  <input id="fcAdRate" class="input" type="number" step="0.1" min="0" max="30" placeholder="0"
                    value="${esc(state.ad_rate||"")}" />
                </div>
                <span class="input-hint">${I18N.t('fc.form.ad_rate_hint')}</span>
              </div>` : ""}
            </div>

            <!-- Amazon-only fields -->
            <div id="fcAmazonFields" style="display:${isAmz?"contents":"none"}">
              <div class="input-group">
                <label class="input-label">${I18N.t('fc.form.amz_category')}</label>
                <select id="fcAmzCategory" class="select">
                  ${Object.entries({ computer_tablets:"Computer / Tablets (7%)", handys:"Smartphones (7%)", konsolen:"Gaming / Konsolen (8%)", foto_camcorder:"Foto & Camcorder (7%)", tv_video_audio:"TV, Video & Audio (7%)", haushaltsgeraete:"Haushaltsgeräte (7%)", drucker:"Drucker (7%)", handy_zubehoer:"Handy-Zubehör (15%)", notebook_zubehoer:"Notebook-Zubehör (15%)", kabel:"Kabel & Stecker (15%)", mode:"Mode (15%)", sport_freizeit:"Sport & Freizeit (15%)", spielzeug:"Spielzeug (15%)", buecher:"Bücher (15%)", sonstiges:"Sonstiges (15%)" })
                    .map(([v,l]) => `<option value="${v}"${v==="sonstiges"?" selected":""}>${esc(l)}</option>`).join("")}
                </select>
              </div>

              <div class="input-group">
                <label class="input-label">${I18N.t('fc.form.amz_method')}</label>
                <div class="seg" id="fcAmzMethodSeg">
                  <button class="seg-btn active" data-method="fba">FBA</button>
                  <button class="seg-btn" data-method="fbm">${I18N.t('fc.form.amz_fbm')}</button>
                </div>
              </div>

              <div id="fcAmzShipInWrap" class="input-group" style="display:none">
                <label class="input-label">${I18N.t('fc.form.amz_ship_in')}</label>
                <div class="input-prefix-wrap">
                  <span class="prefix">€</span>
                  <input id="fcAmzShipIn" class="input" type="number" step="0.01" min="0" placeholder="4.99" />
                </div>
              </div>

              <div class="input-group">
                <label class="input-label">${I18N.t('fc.form.amz_prep')}
                  <span class="input-hint" style="display:inline;margin-left:6px">${I18N.t('fc.form.amz_prep_hint')}</span>
                </label>
                <div class="input-prefix-wrap">
                  <span class="prefix">€</span>
                  <input id="fcAmzPrepFee" class="input" type="number" step="0.01" min="0" placeholder="0.00" />
                </div>
              </div>
            </div>

            <div style="display:flex;gap:6px;margin-top:4px">
              <button class="btn btn-primary" id="btnCheck" style="flex:1;justify-content:center">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8.5 1.5L2 9h5.5L7 14.5L14 7H8.5L8.5 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
                ${I18N.t('fc.form.check_btn')}
              </button>
              <button class="btn btn-ghost btn-sm" id="btnCopyLink" title="${I18N.t('fc.form.link_hint')}" style="flex-shrink:0;white-space:nowrap;padding:0 10px">
                🔗 ${I18N.t('fc.form.link_btn')}
              </button>
            </div>
          </div>
        </div>

        <!-- Result -->
        <div id="fcResult">${renderResultPlaceholder()}</div>
      </div>
    `;
  }

  function renderResultPlaceholder() {
    return `<div class="empty-state">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      <p class="empty-title" style="font-size:14px">${I18N.t('fc.placeholder.title')}</p>
      <p class="empty-sub">${I18N.t('fc.placeholder.sub')}</p>
    </div>`;
  }

  function renderLoading(market = "ebay") {
    const label = market === "amazon"   ? I18N.t('fc.loading.amazon')
                : market === "kaufland" ? I18N.t('fc.loading.kaufland')
                :                        I18N.t('fc.loading.ebay');
    return `<div style="display:flex;align-items:center;justify-content:center;padding:60px;gap:12px">
      <div class="spinner"></div>
      <span class="text-secondary">${label}</span>
    </div>`;
  }

  // ─── Score derivation (client-side, used when backend doesn't send score) ───
  function _deriveScore(verdict, margin, profit, dtc) {
    const base  = verdict === "BUY" ? 68 : verdict === "HOLD" ? 44 : 18;
    const mBonus = Math.round(Math.min(20, Math.max(-10, (margin - 20) * 0.8)));
    const pBonus = Math.round(Math.min(10, Math.max(-5,  (profit - 7) * 0.8)));
    return Math.min(100, Math.max(5, base + mBonus + pBonus));
  }

  // ─── Result Card ──────────────────────────────────────────────────────────
  function renderResult(data, ean, ek, catId, shipIn, shipOut, adRate = 0) {
    const v  = data.verdict || "SKIP";
    const vc = v.toLowerCase();

    const vk    = data.sell_price_median ?? data.sell_price_avg ?? null;
    const days  = data.days_to_cash ?? null;
    const sales = data.sales_30d ?? null;
    const isVAT = _vatMode === "ust_19";
    const offers = data.offer_count ?? null;

    // ── Frontend-side profit calc ─────────────────────────────────────────
    const packagingCost = parseFloat(_container?.querySelector("#fcPackaging")?.value) || 0;
    const adRatePct     = parseFloat(adRate) || 0;
    const ekNum  = parseFloat(ek)  || 0;  // guard: empty input → 0, never NaN
    let calc = null;
    if (vk != null) {
      calc = calcProfit(vk, ekNum, catId, _vatMode, _ekMode,
        parseFloat(shipIn) || 0, parseFloat(shipOut) || 0, packagingCost, 1, selectedMarket, adRatePct);
    }

    const dispProfit = calc?.profit ?? (data.profit_median ?? data.profit_avg ?? null);
    const dispMargin = calc?.margin ?? (data.margin_pct ?? null);
    const dispVkNet  = calc?.vkNet  ?? vk;
    let   dispEkNet  = calc?.ekNet  ?? ekNum;
    if (!isFinite(dispEkNet)) dispEkNet = 0;
    const dispFee    = calc?.feeNet ?? null;
    const dispSoNet  = calc?.soNet  ?? 0;
    const dispSiNet  = calc?.siNet  ?? 0;

    // ── Score ─────────────────────────────────────────────────────────────
    const score     = _deriveScore(v, dispMargin ?? 0, dispProfit ?? 0, days ?? 14);
    const scoreColor = score >= 70 ? "var(--green)" : score >= 44 ? "var(--yellow)" : "var(--red)";

    // ── Market signals ────────────────────────────────────────────────────
    const compLevel = offers == null ? null : offers <= 5 ? [I18N.t('fc.level.low'),"badge-green"] : offers <= 20 ? [I18N.t('fc.level.mid'),"badge-yellow"] : [I18N.t('fc.level.high'),"badge-red"];
    const demLevel  = sales == null  ? null : sales  >= 40 ? [I18N.t('fc.level.high'),"badge-green"]  : sales >= 10  ? [I18N.t('fc.level.mid'),"badge-yellow"]  : [I18N.t('fc.level.low'),"badge-red"];

    // ── Verdict icon ──────────────────────────────────────────────────────
    const vIcon = v === "BUY"
      ? `<path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
      : v === "HOLD"
      ? `<path d="M8 2v7M5 12h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`
      : `<path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`;

    const profitColor  = dispProfit > 0 ? "text-green" : dispProfit < 0 ? "text-red" : "";
    const marginColor  = (dispMargin ?? 0) >= 20 ? "text-green" : (dispMargin ?? 0) >= 10 ? "text-yellow" : "text-red";

    return `
      <div class="result-card ${vc}">

        <!-- ── Hero: Verdict + Score ── -->
        <div class="fc-hero mb-16">
          <div class="fc-hero-left">
            <div class="verdict-badge ${vc}">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">${vIcon}</svg>
              ${v}
            </div>
            <div style="margin-top:6px">
              <div class="fc-product-title">${esc(data.title || "")}</div>
              <div class="fc-product-ean">${esc(ean)}</div>
            </div>
          </div>
          <div class="fc-score-block">
            <div class="fc-score-label">Score <strong style="color:${scoreColor}">${score}</strong><span style="color:var(--text-muted)">/100</span></div>
            <div class="fc-score-bar">
              <div class="fc-score-fill" style="width:${score}%;background:${scoreColor}"></div>
            </div>
            <div class="fc-score-sub">${v === "BUY" ? I18N.t('fc.score.buy') : v === "HOLD" ? I18N.t('fc.score.hold') : I18N.t('fc.score.skip')}</div>
          </div>
        </div>

        <!-- ── 4-KPI Strip ── -->
        <div class="fc-kpi-row mb-16">
          <div class="fc-kpi-card ${dispProfit > 0 ? "green" : dispProfit < 0 ? "red" : ""}">
            <div class="fc-kpi-label">${I18N.t('fc.kpi.profit')}${isVAT ? " "+I18N.t('fc.kpi.net_suffix') : ""}</div>
            <div class="fc-kpi-value ${profitColor}">${dispProfit != null ? fmtEur(dispProfit) : "—"}</div>
          </div>
          <div class="fc-kpi-card ${marginColor}">
            <div class="fc-kpi-label">${I18N.t('fc.kpi.margin')}</div>
            <div class="fc-kpi-value ${marginColor}">${dispMargin != null ? fmtPct(dispMargin) : "—"}</div>
          </div>
          <div class="fc-kpi-card">
            <div class="fc-kpi-label">Days to Cash</div>
            <div class="fc-kpi-value">${days != null ? fmtDays(days) : "—"}</div>
          </div>
          <div class="fc-kpi-card">
            <div class="fc-kpi-label">${I18N.t('fc.kpi.sales30d')}</div>
            <div class="fc-kpi-value">${sales != null ? sales : "—"}</div>
          </div>
        </div>

        <!-- ── Market Signals ── -->
        <div class="fc-market-row mb-16">
          <div class="fc-market-chip">
            <span class="fc-market-chip-l">${I18N.t('fc.chip.avg_vk')}${isVAT ? " "+I18N.t('fc.form.gross_suffix') : ""}</span>
            <span class="fc-market-chip-v">${fmtEur(vk)}</span>
          </div>
          ${offers != null ? `
          <div class="fc-market-chip">
            <span class="fc-market-chip-l">${I18N.t('fc.chip.offers')}</span>
            <span class="fc-market-chip-v">${offers}</span>
            ${compLevel ? `<span class="badge ${compLevel[1]}">${compLevel[0]}</span>` : ""}
          </div>` : ""}
          ${sales != null ? `
          <div class="fc-market-chip">
            <span class="fc-market-chip-l">${I18N.t('fc.chip.demand')}</span>
            ${demLevel ? `<span class="badge ${demLevel[1]}">${demLevel[0]}</span>` : ""}
          </div>` : ""}
          <div class="fc-market-chip">
            <span class="fc-market-chip-l">EK</span>
            <span class="fc-market-chip-v">${fmtEur(dispEkNet)}</span>
          </div>
        </div>

        <!-- ── Waterfall Profit Breakdown ── -->
        ${vk != null ? `
        <div class="fc-waterfall mb-16">
          <div class="fc-wf-title">${I18N.t('fc.waterfall.title')}${isVAT ? " "+I18N.t('fc.waterfall.vat_suffix') : ""}</div>
          <div class="fc-wf-flow">
            <div class="fc-wf-step">
              <div class="fc-wf-step-l">VK</div>
              <div class="fc-wf-step-v">${fmtEur(dispVkNet)}</div>
            </div>
            ${dispFee != null ? `
            <div class="fc-wf-arrow">→</div>
            <div class="fc-wf-step red">
              <div class="fc-wf-step-l">${I18N.t('fc.waterfall.fee')}</div>
              <div class="fc-wf-step-v">−${fmtEur(dispFee)}</div>
            </div>` : ""}
            ${dispSoNet > 0 ? `
            <div class="fc-wf-arrow">→</div>
            <div class="fc-wf-step red">
              <div class="fc-wf-step-l">${I18N.t('fc.waterfall.shipping')}</div>
              <div class="fc-wf-step-v">−${fmtEur(dispSoNet)}</div>
            </div>` : ""}
            ${dispSiNet > 0 ? `
            <div class="fc-wf-arrow">→</div>
            <div class="fc-wf-step red">
              <div class="fc-wf-step-l">${I18N.t('fc.waterfall.ship_in')}</div>
              <div class="fc-wf-step-v">−${fmtEur(dispSiNet)}</div>
            </div>` : ""}
            ${calc?.packNet > 0 ? `
            <div class="fc-wf-arrow">→</div>
            <div class="fc-wf-step red">
              <div class="fc-wf-step-l">${I18N.t('fc.waterfall.packaging')}</div>
              <div class="fc-wf-step-v">−${fmtEur(calc.packNet)}</div>
            </div>` : ""}
            ${calc?.adFeeNet > 0 ? `
            <div class="fc-wf-arrow">→</div>
            <div class="fc-wf-step red">
              <div class="fc-wf-step-l">${I18N.t('fc.detail.ad_fee')} (${adRatePct}%)</div>
              <div class="fc-wf-step-v">−${fmtEur(calc.adFeeNet)}</div>
            </div>` : ""}
            <div class="fc-wf-arrow">→</div>
            <div class="fc-wf-step red">
              <div class="fc-wf-step-l">EK</div>
              <div class="fc-wf-step-v">−${fmtEur(dispEkNet)}</div>
            </div>
            <div class="fc-wf-arrow">=</div>
            <div class="fc-wf-step result">
              <div class="fc-wf-step-l">Profit</div>
              <div class="fc-wf-step-v ${profitColor}">${dispProfit != null ? fmtEur(dispProfit) : "—"}</div>
            </div>
          </div>
        </div>` : ""}

        <!-- ── Reason ── -->
        ${(data.error || data.reason) ? `
          <div class="fc-reason mb-12">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <span>${esc(data.error || data.reason)}</span>
          </div>` : ""}

        <!-- ── Actions ── -->
        <div class="row" style="gap:8px;flex-wrap:wrap">
          ${v === "BUY" ? `
          <button class="btn btn-primary" id="btnCreateListing" style="flex:1;min-width:140px;justify-content:center">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="10" height="13" rx="1.2" stroke="currentColor" stroke-width="1.5"/><path d="M4 6h4M4 9h3M11 10l2 2 2-2M13 8v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            ${I18N.t('fc.action.create_listing')}
          </button>` : v === "HOLD" ? `
          <button class="btn btn-secondary btn-sm" id="btnCreateListing">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="10" height="13" rx="1.2" stroke="currentColor" stroke-width="1.5"/><path d="M4 6h4M4 9h3M11 10l2 2 2-2M13 8v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            ${I18N.t('fc.action.create_listing')}
          </button>` : ""}
          <button class="btn btn-secondary btn-sm" id="btnAddToInv">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="1" y="5" width="14" height="10" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M5 5V4a3 3 0 0 1 6 0v1M6 10h4M8 8v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            ${I18N.t('fc.action.add_inventory')}
          </button>
          <button class="btn btn-ghost btn-sm" id="btnReset">${I18N.t('fc.action.reset')}</button>
        </div>
        <div class="row mt-8" style="gap:6px;flex-wrap:wrap">
          <a class="btn btn-ghost btn-sm" href="https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(data.title || ean)}&LH_Sold=1&LH_Complete=1" target="_blank" rel="noopener" style="font-size:11px;opacity:0.75">
            🛒 ${I18N.t('fc.action.ebay_sales')} ↗
          </a>
          <a class="btn btn-ghost btn-sm" href="https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=${encodeURIComponent(ean)}" target="_blank" rel="noopener" style="font-size:11px;opacity:0.75">
            🏷 Idealo ↗
          </a>
          <a class="btn btn-ghost btn-sm" href="https://geizhals.de/?fs=${encodeURIComponent(ean)}" target="_blank" rel="noopener" style="font-size:11px;opacity:0.75">
            💰 Geizhals ↗
          </a>
        </div>
      </div>

      <!-- Inline price history chart -->
      <div id="fcPriceChart" data-market="ebay" class="mt-12"></div>
    `;
  }

  // ─── Kaufland Result Card ─────────────────────────────────────────────────
  function renderResultKaufland(data, ean, ek) {
    const v  = data.verdict || "SKIP";
    const vc = v.toLowerCase();

    const sell       = data.sell_price_avg ?? null;
    const profit     = data.profit_median ?? data.profit_avg ?? null;
    const margin     = data.margin_pct ?? null;
    const fee        = data.fees_median ?? null;
    const feeRate    = data.fee_rate ? `${(data.fee_rate * 100).toFixed(1)}%` : "—";
    const offers     = data.offers_count ?? null;
    const bestseller = data.bestseller;
    const score      = data.score ?? null;
    const label      = data.label;
    const rating     = data.rating ?? null;
    const reviews    = data.review_count ?? null;
    const usedPrice  = data.min_total_used ?? null;
    const sellerName = data.best_seller_name ?? null;
    const productUrl = data.product_url ?? null;
    const volEbay    = data.volume_hint_ebay ?? null;
    const volAmazon  = data.volume_hint_amazon ?? null;
    const isVAT      = _vatMode === "ust_19";

    const profitColor = profit > 0 ? "text-green" : profit < 0 ? "text-red" : "";
    const marginColor = (margin ?? 0) >= 20 ? "text-green" : (margin ?? 0) >= 10 ? "text-yellow" : "text-red";
    const scoreColor  = score >= 70 ? "var(--green)" : score >= 50 ? "var(--yellow)" : "var(--red)";
    const labelColor  = label === "HOT" ? "badge-green" : label === "OK" ? "badge-yellow" : "badge-red";

    const vIcon = v === "BUY"
      ? `<path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
      : v === "HOLD"
      ? `<path d="M8 2v7M5 12h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`
      : `<path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`;

    // Recalculate with Kaufland fee
    const ekNum  = parseFloat(ek) || 0;
    const shipIn  = parseFloat(_container?.querySelector("#fcShipIn")?.value) || 0;
    const shipOut = parseFloat(_container?.querySelector("#fcShipOut")?.value) || 0;

    return `
      <div class="result-card ${vc}">

        <!-- ── Hero: Verdict + Score ── -->
        <div class="fc-hero mb-16">
          <div class="fc-hero-left">
            <div class="verdict-badge ${vc}">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">${vIcon}</svg>
              ${v}
            </div>
            <div style="margin-top:6px">
              <div class="fc-product-title">${esc(data.title || ean)}</div>
              <div class="fc-product-ean">${esc(ean)}</div>
            </div>
          </div>
          ${score != null ? `
          <div class="fc-score-block">
            <div class="fc-score-label">Score <strong style="color:${scoreColor}">${score}</strong><span style="color:var(--text-muted)">/100</span></div>
            <div class="fc-score-bar">
              <div class="fc-score-fill" style="width:${score}%;background:${scoreColor}"></div>
            </div>
            <div class="fc-score-sub">${label === "HOT" ? "Hohe Nachfrage" : label === "OK" ? "Moderate Nachfrage" : "Geringes Interesse"}</div>
          </div>` : ""}
        </div>

        <!-- ── Badges ── -->
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          ${bestseller ? `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--yellow-bg, #fef3c7);color:var(--yellow, #b45309);border-radius:var(--r-sm);padding:3px 10px;font-size:11px;font-weight:600">⭐ Bestseller</span>` : ""}
          ${rating != null ? `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--bg-secondary);border-radius:var(--r-sm);padding:3px 10px;font-size:11px;font-weight:500">⭐ ${rating.toFixed(1)}${reviews ? ` (${reviews})` : ""}</span>` : ""}
          ${label ? `<span class="${labelColor}" style="display:inline-flex;align-items:center;border-radius:var(--r-sm);padding:3px 10px;font-size:11px;font-weight:600">${esc(label)}</span>` : ""}
        </div>

        <!-- ── 4-KPI Strip ── -->
        <div class="fc-kpi-row mb-16">
          <div class="fc-kpi-card ${profit > 0 ? "green" : profit < 0 ? "red" : ""}">
            <div class="fc-kpi-label">${I18N.t('fc.kpi.profit')}${isVAT ? " "+I18N.t('fc.kpi.net_suffix') : ""}</div>
            <div class="fc-kpi-value ${profitColor}">${profit != null ? fmtEur(profit) : "—"}</div>
          </div>
          <div class="fc-kpi-card ${marginColor}">
            <div class="fc-kpi-label">${I18N.t('fc.kpi.margin')}</div>
            <div class="fc-kpi-value ${marginColor}">${margin != null ? fmtPct(margin) : "—"}</div>
          </div>
          <div class="fc-kpi-card">
            <div class="fc-kpi-label">${I18N.t('fc.chip.offers')}</div>
            <div class="fc-kpi-value">${offers != null ? offers : "—"}</div>
          </div>
          <div class="fc-kpi-card">
            <div class="fc-kpi-label">Nachfrage</div>
            <div class="fc-kpi-value" style="color:${scoreColor}">${score != null ? score : "—"}</div>
          </div>
        </div>

        <!-- ── Market Signals ── -->
        <div class="fc-market-row mb-16">
          <div class="fc-market-chip">
            <span class="fc-market-chip-l">VK (günstigster Neu)</span>
            <span class="fc-market-chip-v">${sell != null ? fmtEur(sell) : "—"}</span>
          </div>
          <div class="fc-market-chip">
            <span class="fc-market-chip-l">Kaufland Gebühr (${feeRate})</span>
            <span class="fc-market-chip-v text-red">${fee != null ? "−" + fmtEur(fee) : "—"}</span>
          </div>
          ${usedPrice != null ? `
          <div class="fc-market-chip">
            <span class="fc-market-chip-l">Gebraucht ab</span>
            <span class="fc-market-chip-v">${fmtEur(usedPrice)}</span>
          </div>` : ""}
          ${sellerName ? `
          <div class="fc-market-chip">
            <span class="fc-market-chip-l">Günstigster Seller</span>
            <span class="fc-market-chip-v">${esc(sellerName)}</span>
          </div>` : ""}
        </div>

        <!-- ── Cross-Market Volume Hints ── -->
        ${(volEbay || volAmazon) ? `
        <div class="fc-market-row mb-16" style="opacity:.85">
          ${volEbay ? `
          <div class="fc-market-chip">
            <span class="fc-market-chip-l">eBay Verk./Mo</span>
            <span class="fc-market-chip-v">~${volEbay}</span>
          </div>` : ""}
          ${volAmazon ? `
          <div class="fc-market-chip">
            <span class="fc-market-chip-l">Amazon Verk./Mo</span>
            <span class="fc-market-chip-v">~${volAmazon}</span>
          </div>` : ""}
        </div>` : ""}

        <!-- ── Cost Breakdown ── -->
        <details class="fc-accordion mb-16" style="border:1px solid var(--border);border-radius:var(--r-sm);padding:0">
          <summary style="padding:8px 12px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text-secondary)">Kostenaufstellung</summary>
          <div style="padding:8px 12px;display:grid;grid-template-columns:1fr auto;gap:4px 12px;font-size:12px">
            <span>Verkaufspreis (brutto)</span><span style="text-align:right">${sell != null ? fmtEur(sell) : "—"}</span>
            <span>Kaufland Gebühr (${feeRate})</span><span style="text-align:right;color:var(--red)">−${fee != null ? fmtEur(fee) : "—"}</span>
            ${shipIn > 0 ? `<span>Versand Inbound</span><span style="text-align:right;color:var(--red)">−${fmtEur(shipIn)}</span>` : ""}
            ${shipOut > 0 ? `<span>Versand Outbound</span><span style="text-align:right;color:var(--red)">−${fmtEur(shipOut)}</span>` : ""}
            <span>EK</span><span style="text-align:right;color:var(--red)">−${fmtEur(ekNum)}</span>
            <div style="grid-column:1/-1;border-top:1px solid var(--border);margin:4px 0"></div>
            <span style="font-weight:700">Profit${isVAT ? " (netto)" : ""}</span>
            <span style="text-align:right;font-weight:700" class="${profitColor}">${profit != null ? fmtEur(profit) : "—"}</span>
          </div>
        </details>

        <!-- ── Actions ── -->
        <div class="row mt-16" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="btnAddToInv">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="1" y="5" width="14" height="10" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M5 5V4a3 3 0 0 1 6 0v1M6 10h4M8 8v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            ${I18N.t('fc.btn.add_inventory')}
          </button>
          ${productUrl ? `<a class="btn btn-ghost btn-sm" href="${productUrl}" target="_blank" rel="noopener" style="text-decoration:none">
            Kaufland öffnen ↗
          </a>` : ""}
          <button class="btn btn-ghost btn-sm" id="btnReset">${I18N.t('fc.btn.reset')}</button>
        </div>
        <div class="row mt-8" style="gap:6px;flex-wrap:wrap">
          <a class="btn btn-ghost btn-sm" href="https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=${encodeURIComponent(ean)}" target="_blank" rel="noopener" style="font-size:11px;opacity:0.75">
            🏷 Idealo ↗
          </a>
          <a class="btn btn-ghost btn-sm" href="https://geizhals.de/?fs=${encodeURIComponent(ean)}" target="_blank" rel="noopener" style="font-size:11px;opacity:0.75">
            💰 Geizhals ↗
          </a>
        </div>
      </div>
    `;
  }

  // ─── Amazon Result Card — SaaS redesign ──────────────────────────────────
  function renderResultAmazon(data, identifier, ek, shipInRaw = 0) {
    const v         = data.verdict || "SKIP";
    const vc        = v.toLowerCase();
    const profit    = data.profit_median ?? 0;
    const margin    = data.margin_pct ?? 0;
    const roiPct    = data.roi_pct ?? 0;
    const mtlGewinn = data.monthly_profit_est ?? 0;
    const buyBox    = data.buy_box;
    const buyBox30  = data.buy_box_avg30;
    const salesRank = data.sales_rank;
    const fbaCount  = data.fba_count ?? 0;
    const offers    = data.offer_count ?? 0;
    const sales30d  = data.sales_30d;
    const dtc       = data.days_to_cash;
    const bsrDrops    = data.bsr_drops_30d;
    const bsrMin      = data.bsr_min_30d;
    const bsrMax      = data.bsr_max_30d;
    const breakEven   = data.break_even;
    const netPayout   = data.net_payout;
    const salesSource = data.sales_30d_source; // "badge" | "bsr_estimate" | "bsr_drops"
    const refFee    = data.referral_fee ?? 0;
    const refPct    = data.referral_pct != null ? `${Number(data.referral_pct).toFixed(0)}%` : "—";
    const fbaFee    = data.fba_fee ?? 0;
    const prepFeeV  = data.prep_fee ?? 0;
    const shipInV   = data.ship_in ?? 0;                          // net ship_in from backend
    const ekDisp    = data.ek_net  ?? ek;                         // net EK (after VAT if active)
    const sellNet   = data.sell_net ?? null;                      // net revenue (buy_box / 1.19)
    const isVatAmz  = sellNet != null && buyBox != null && Math.abs(sellNet - buyBox) > 0.01;

    const profitColor = profit > 0 ? "text-green" : profit < 0 ? "text-red" : "";
    const marginColor = margin >= 20 ? "text-green" : margin >= 10 ? "text-yellow" : "text-red";
    const roiColor    = roiPct >= 50 ? "text-green" : roiPct >= 20 ? "text-yellow" : "text-red";
    const bsrDropColor = bsrDrops >= 10 ? "text-green" : bsrDrops >= 4 ? "text-yellow" : "";

    // Count warning signals for the badge
    const warnCount = !data.signals ? 0 : [
      data.signals.buybox_is_amazon,
      data.signals.ip_risk === "high",
      data.signals.ip_risk === "medium",
      data.signals.is_meltable,
      data.signals.is_hazmat,
      data.signals.is_oversize,
      data.signals.pl_risk === "likely",
    ].filter(Boolean).length;

    const vIcon = v === "BUY"
      ? `<path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
      : v === "HOLD"
      ? `<path d="M8 2v7M5 12h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`
      : `<path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`;

    return `
      <div class="result-card ${vc}">

        <!-- ── Header: Verdict + Title + ASIN link ── -->
        <div class="fc-hero mb-16">
          <div class="fc-hero-left">
            <div class="verdict-badge ${vc}">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">${vIcon}</svg>
              ${v}
            </div>
            <div class="mt-8">
              <div class="fc-product-title">${esc(data.title || identifier)}</div>
              <a href="https://www.amazon.de/dp/${esc(data.asin || identifier)}" target="_blank" rel="noopener"
                style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);text-decoration:none;transition:color .15s"
                onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text-muted)'">
                ${esc(data.asin || identifier)} ↗
              </a>
            </div>
          </div>
        </div>

        <!-- ── 4 Primary KPIs ── -->
        <div class="fc-amz-kpi-grid mb-16">
          ${_amzKpi(fmtEur(profit), I18N.t('fc.kpi.profit'), profitColor)}
          ${_amzKpi(fmtPct(margin), I18N.t('fc.kpi.margin'), marginColor)}
          ${_amzKpi(fmtPct(roiPct), "ROI", roiColor)}
          ${_amzKpi(mtlGewinn > 0 ? fmtEur(mtlGewinn) : "—", I18N.t('fc.kpi.monthly_profit'), mtlGewinn > 0 ? "text-green" : "")}
        </div>

        <!-- ── Secondary Metrics Strip ── -->
        <div class="fc-amz-metrics mb-16">
          ${_amzMetric("Buy Box", buyBox != null ? fmtEur(buyBox) : "—")}
          ${_amzMetric("BSR", salesRank ? `#${Number(salesRank).toLocaleString("de-DE")}` : "—")}
          ${_amzMetric("FBA / Ges.", `${fbaCount} / ${offers}`)}
          ${_amzMetric(
            salesSource === "badge" ? "Verk./Mo 🏷" : "Verk./Mo",
            sales30d != null
              ? (salesSource === "badge" ? `${sales30d}+` : `~${sales30d}`)
                + (bsrDrops > 0 && salesSource !== "badge" ? ` (${bsrDrops}↓)` : "")
              : "—",
            sales30d >= 30 ? "text-green" : sales30d >= 10 ? "text-yellow" : ""
          )}
          ${_amzMetric("Days to Cash", dtc != null ? fmtDays(dtc) : "—")}
        </div>

        <!-- ── Break-Even + Net Payout ── -->
        <div class="grid-2-md mb-16">
          <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--r);padding:10px 14px">
            <div class="text-xs text-muted mb-4" style="text-transform:uppercase;letter-spacing:.05em;font-weight:600">${I18N.t('fc.kpi.break_even')}</div>
            <div class="font-semibold" style="font-size:15px;font-variant-numeric:tabular-nums">${breakEven != null ? fmtEur(breakEven) : "—"}</div>
          </div>
          <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--r);padding:10px 14px">
            <div class="text-xs text-muted mb-4" style="text-transform:uppercase;letter-spacing:.05em;font-weight:600">${I18N.t('fc.kpi.net_payout')}</div>
            <div class="font-semibold ${netPayout != null && netPayout > 0 ? "text-green" : ""}" style="font-size:15px;font-variant-numeric:tabular-nums">${netPayout != null ? fmtEur(netPayout) : "—"}</div>
          </div>
        </div>

        <!-- ── Hinweise / Product Signals ── -->
        ${_renderSignals(data.signals, warnCount)}

        <!-- ── Kostenstruktur Accordion ── -->
        <details class="fc-accordion">
          <summary>
            <span class="text-xs text-muted font-semibold" style="text-transform:uppercase;letter-spacing:.06em">${I18N.t('fc.cost_structure.amz')}</span>
            ${_CHEV}
          </summary>
          <div style="background:var(--bg-base);border:1px solid var(--border);border-radius:var(--r);overflow:hidden">
            ${_brkRow("Buy Box (brutto)", buyBox != null ? fmtEur(buyBox) : "—", "")}
            ${isVatAmz && sellNet != null ? _brkRow("Netto Erlös (÷1.19)", fmtEur(sellNet), "text-muted") : ""}
            ${buyBox30 ? _brkRow("Ø 30T Buy Box", fmtEur(buyBox30), "text-muted") : ""}
            ${(bsrMin != null && bsrMax != null) ? _brkRow("BSR Range 30T", `#${Number(bsrMin).toLocaleString("de-DE")} → #${Number(bsrMax).toLocaleString("de-DE")}`, "text-muted") : ""}
            ${_brkRow(`Referral Fee (${refPct})`, "−" + fmtEur(refFee), "text-red")}
            ${fbaFee > 0 ? _brkRow("FBA Fee (netto)", "−" + fmtEur(fbaFee), "text-red") : ""}
            ${shipInV > 0 ? _brkRow("Versandkosten EK (netto)", "−" + fmtEur(shipInV), "text-red") : ""}
            ${prepFeeV > 0 ? _brkRow("PREP Gebühr", "−" + fmtEur(prepFeeV), "text-red") : ""}
            ${_brkRow(isVatAmz ? "EK (netto)" : "Einkaufspreis (EK)", "−" + fmtEur(ekDisp), "text-red")}
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-top:1px solid var(--border);background:var(--bg-elevated)">
              <span class="text-sm font-semibold text-primary">${I18N.t('fc.cost_structure.profit_net')}</span>
              <span class="text-sm font-semibold ${profitColor}">${fmtEur(profit)}</span>
            </div>
          </div>
        </details>

        <!-- Error / Reason -->
        ${(data.error || data.reason) ? `
          <div style="margin-top:14px;padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:var(--r);border:1px solid var(--border)">
            <span class="text-xs text-muted">Info: </span>
            <span class="text-xs text-secondary">${esc(data.error || data.reason)}</span>
          </div>` : ""}

        <!-- Actions -->
        <div class="row mt-16" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="btnAddToInv">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="1" y="5" width="14" height="10" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M5 5V4a3 3 0 0 1 6 0v1M6 10h4M8 8v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            ${I18N.t('fc.action.add_inventory')}
          </button>
          <a class="btn btn-ghost btn-sm" href="https://www.amazon.de/dp/${esc(data.asin||identifier)}" target="_blank" rel="noopener">
            ${I18N.t('fc.action.amazon_open')} ↗
          </a>
          <button class="btn btn-ghost btn-sm" id="btnReset">${I18N.t('fc.action.reset')}</button>
        </div>
        <div class="row mt-8" style="gap:6px;flex-wrap:wrap">
          <a class="btn btn-ghost btn-sm" href="https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(data.title || ean)}&LH_Sold=1&LH_Complete=1" target="_blank" rel="noopener" style="font-size:11px;opacity:0.75">
            🛒 eBay Verkäufe ↗
          </a>
          <a class="btn btn-ghost btn-sm" href="https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=${encodeURIComponent(data.ean||identifier)}" target="_blank" rel="noopener" style="font-size:11px;opacity:0.75">
            🏷 Idealo ↗
          </a>
          <a class="btn btn-ghost btn-sm" href="https://geizhals.de/?fs=${encodeURIComponent(data.ean||identifier)}" target="_blank" rel="noopener" style="font-size:11px;opacity:0.75">
            💰 Geizhals ↗
          </a>
        </div>
      </div>

      <!-- Price chart placeholder -->
      <div id="fcPriceChart" data-market="amazon" style="margin-top:12px"></div>
      <!-- BSR rank chart placeholder -->
      <div id="fcBsrChart" style="margin-top:8px"></div>
    `;
  }

  function _brkRow(label, value, valClass = "") {
    return `<div class="fc-section-bar">
      <span class="text-xs text-secondary">${esc(label)}</span>
      <span class="text-xs font-semibold ${valClass}">${value}</span>
    </div>`;
  }

  // ─── Amazon Signal Helpers ─────────────────────────────────────────────────
  const _WARN_ICON = `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" class="shrink-0"><path d="M8 1.5L1 14h14L8 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.5v3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="12.5" r=".75" fill="currentColor"/></svg>`;
  const _LOCK_ICON = `<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="8" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const _OPEN_ICON = `<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="8" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

  function _sigBadge(text, color, warn = false) {
    const cols = {
      red:    ["var(--red-sub)",    "var(--red-bdr)",    "var(--red)"   ],
      green:  ["var(--green-sub)",  "var(--green-bdr)",  "var(--green)" ],
      yellow: ["var(--yellow-sub)", "var(--yellow-bdr)", "var(--yellow)"],
      gray:   ["var(--surface2)",   "var(--border2)",    "var(--text2)" ],
    };
    const [bg, bdr, clr] = cols[color] || cols.gray;
    return `<span style="display:inline-flex;align-items:center;gap:4px;background:${bg};border:1px solid ${bdr};color:${clr};padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis">${warn ? _WARN_ICON : ""}${esc(text)}</span>`;
  }

  function _sigRow(label, text, color, warn = false) {
    return `<div class="fc-section-row">
      <span class="text-xs text-secondary row nowrap" style="gap:5px">${warn ? _WARN_ICON : ""}<span>${esc(label)}</span></span>
      ${_sigBadge(text, color, false)}
    </div>`;
  }

  function _buildUngatedFlags(markets) {
    const flags = { SE:"🇸🇪", PL:"🇵🇱", BE:"🇧🇪", IT:"🇮🇹", DE:"🇩🇪", ES:"🇪🇸", FR:"🇫🇷", NL:"🇳🇱", GB:"🇬🇧" };
    return Object.entries(markets).map(([code, status]) => {
      const open  = status === "open";
      const color = open ? "var(--green)" : "var(--red)";
      const icon  = open ? _OPEN_ICON : _LOCK_ICON;
      return `<span style="display:inline-flex;align-items:center;gap:2px;color:${color};font-size:14px" title="${code}">${flags[code] || code}<span style="color:${color}">${icon}</span></span>`;
    }).join("");
  }

  const _CHEV = `<svg class="fc-chev" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 5l5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // ─── Amazon SaaS KPI helpers ──────────────────────────────────────────────
  function _amzKpi(value, label, colorClass = "") {
    return `<div class="fc-amz-kpi">
      <div class="fc-amz-kpi-v ${colorClass}">${value}</div>
      <div class="fc-amz-kpi-l">${label}</div>
    </div>`;
  }

  function _amzMetric(label, value, colorClass = "") {
    return `<div class="fc-amz-metric">
      <span class="fc-amz-metric-l">${label}</span>
      <span class="fc-amz-metric-v ${colorClass}">${value}</span>
    </div>`;
  }

  function _renderSignals(signals, warnCount = 0) {
    if (!signals) return "";
    const vc = signals.variation_count;
    const varColor = vc === 0 ? "gray" : vc < 5 ? "green" : vc < 20 ? "yellow" : "red";
    const varText  = vc === 0 ? I18N.t('fc.signals.no_variations') : vc < 5 ? `${vc || I18N.t('fc.signals.no')} ${I18N.t('fc.signals.variations')}` : `${vc} ${I18N.t('fc.signals.variations')}`;

    const warnBadge = warnCount > 0
      ? `<span class="fc-warn-badge">${_WARN_ICON} ${warnCount}</span>`
      : "";

    return `
    <details class="fc-accordion" open>
      <summary>
        <span class="text-xs text-muted font-semibold" style="text-transform:uppercase;letter-spacing:.06em">${I18N.t('fc.signals.title')}${warnBadge}</span>
        ${_CHEV}
      </summary>
      <div style="background:var(--bg-base);border:1px solid var(--border);border-radius:var(--r);overflow:hidden">
        ${_sigRow(I18N.t('fc.signals.buybox'),
            signals.buybox_is_amazon ? I18N.t('fc.signals.buybox_amazon') : I18N.t('fc.signals.buybox_third'),
            signals.buybox_is_amazon ? "red" : "green",
            signals.buybox_is_amazon)}
        ${_sigRow(I18N.t('fc.signals.variations_label'), varText, varColor)}
        ${_sigRow(I18N.t('fc.signals.pl'), signals.pl_text,
            signals.pl_risk === "likely"   ? "yellow"
          : signals.pl_risk === "possible" ? "gray" : "green")}
        ${_sigRow(I18N.t('fc.signals.ip'), signals.ip_text,
            signals.ip_risk === "high"   ? "red"
          : signals.ip_risk === "medium" ? "yellow" : "green",
            signals.ip_risk === "high")}
        ${_sigRow(I18N.t('fc.signals.size'), signals.size_tier,
            signals.is_oversize ? "red" : "green",
            signals.is_oversize)}
        ${_sigRow(I18N.t('fc.signals.meltable'),
            signals.is_meltable ? I18N.t('fc.signals.meltable_yes') : I18N.t('fc.signals.meltable_no'),
            signals.is_meltable ? "red" : "green")}
        ${_sigRow(I18N.t('fc.signals.hazmat'),
            signals.is_hazmat ? I18N.t('fc.signals.hazmat_yes') : I18N.t('fc.signals.hazmat_no'),
            signals.is_hazmat ? "red" : "green")}
        ${signals.ungated_markets ? `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 14px;gap:8px">
          <span class="text-xs text-secondary">${I18N.t('fc.signals.ungated')}</span>
          <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">${_buildUngatedFlags(signals.ungated_markets)}</div>
        </div>` : ""}
      </div>
    </details>`;
  }

  function renderError(msg) {
    const { title, sub } = (typeof friendlyError === "function")
      ? friendlyError(new Error(msg))
      : { title: "Fehler", sub: msg };
    return renderErrorCard(title, sub, { retryId: "btnReset", retryLabel: "Erneut versuchen" });
  }

  function renderUpgradeWall() {
    return `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center;gap:20px">
        <div style="width:56px;height:56px;border-radius:14px;background:rgba(99,102,241,.12);display:flex;align-items:center;justify-content:center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <div>
          <div style="font-size:16px;font-weight:600;color:var(--text1);margin-bottom:6px">${I18N.t('fc.upgrade.title')}</div>
          <div style="font-size:13px;color:var(--text2);max-width:280px;line-height:1.5">
            ${I18N.t('fc.upgrade.sub')}
          </div>
        </div>
        <button id="btnUpgradeCheckout"
           style="display:inline-flex;align-items:center;gap:6px;padding:10px 22px;border-radius:8px;background:#6366f1;color:#fff;font-size:13px;font-weight:600;border:none;cursor:pointer;transition:opacity .15s"
           onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
          ${I18N.t('fc.upgrade.btn')}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </div>`;
  }

  async function bindUpgradeButton(container) {
    const btn = container.querySelector("#btnUpgradeCheckout");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = I18N.t('fc.upgrade.loading');
      try {
        const { ok, data } = await API.createCheckoutSession();
        if (ok && data?.checkout_url) {
          // Opens in default browser via Electron setWindowOpenHandler
          window.open(data.checkout_url, "_blank");
        } else {
          Toast.error(I18N.t('fc.upgrade.err_title'), I18N.t('fc.upgrade.err_checkout'));
        }
      } catch {
        Toast.error(I18N.t('fc.upgrade.err_title'), I18N.t('fc.upgrade.err_conn'));
      } finally {
        btn.disabled = false;
        btn.innerHTML = `${I18N.t('fc.upgrade.btn')} <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
      }
    });
  }

  // ─── Inline Price Chart ───────────────────────────────────────────────────
  // price_series (optional): [[epoch_ms, avg_price], ...] from Research API
  // qty_series   (optional): [[epoch_ms, qty], ...]
  // Falls back to stored history if no series provided.
  async function loadPriceChart(ean, resultEl, price_series, qty_series, refPrice = null) {
    const chartWrap = resultEl.querySelector("#fcPriceChart");
    if (!chartWrap) return;

    // ── Build chart entries ────────────────────────────────────────────────
    // Prefer fresh series from API response (31 daily data points, immediate)
    let chartEntries = [];

    if (Array.isArray(price_series) && price_series.length >= 2) {
      // Convert [[epoch_ms, price], ...] to chart entry objects
      const qtyMap = new Map((qty_series || []).map(([ts, q]) => [ts, q]));
      chartEntries = price_series
        .filter(([, p]) => p != null)
        .map(([epochMs, price]) => ({
          ts:           new Date(epochMs).toISOString(),
          research_avg: price,
          qty:          qtyMap.get(epochMs) ?? null,
        }));
    } else {
      // Fallback: load accumulated history from storage
      try {
        const histData = await Storage.getHistory(ean);
        chartEntries = (histData.entries || []).slice(-60);
      } catch { return; }
    }

    // ── Outlier filter ─────────────────────────────────────────────────────
    if (refPrice && refPrice > 0) {
      // Reference-price anchor (e.g. buy_box for Amazon): keep prices within ×4 / ÷4
      const lo = refPrice / 4;
      const hi = refPrice * 4;
      chartEntries = chartEntries.filter(e => {
        const p = e.research_avg ?? e.browse_median ?? e.browse_avg;
        return p != null && p > 0 && p >= lo && p <= hi;
      });
    } else if (chartEntries.length >= 4) {
      // IQR fallback for eBay data (no fixed reference price)
      const rawPrices = chartEntries
        .map(e => e.research_avg ?? e.browse_median ?? e.browse_avg)
        .filter(p => p != null && p > 0);
      if (rawPrices.length >= 4) {
        const sorted = [...rawPrices].sort((a, b) => a - b);
        const q1  = sorted[Math.floor(sorted.length * 0.25)];
        const q3  = sorted[Math.floor(sorted.length * 0.75)];
        const iqr = q3 - q1;
        const lo  = Math.max(0.01, q1 - 3 * iqr);
        const hi  = q3 + 3 * iqr;
        chartEntries = chartEntries.filter(e => {
          const p = e.research_avg ?? e.browse_median ?? e.browse_avg;
          return p != null && p >= lo && p <= hi;
        });
      }
    }

    if (chartEntries.length < 2) {
      chartWrap.innerHTML = `
        <div style="padding:10px 14px;background:var(--bg-panel);border:1px solid var(--border);border-radius:var(--r);display:flex;align-items:center;gap:8px">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#475569" stroke-width="1.2"/><path d="M8 5v3.5M8 10.5v.5" stroke="#475569" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span class="text-xs text-muted">${I18N.t('fc.chart.no_history')}</span>
        </div>`;
      return;
    }

    // ── Stats for header ───────────────────────────────────────────────────
    const prices    = chartEntries.map(e => e.research_avg ?? e.browse_median ?? e.browse_avg).filter(Boolean);
    const minPrice  = Math.min(...prices);
    const maxPrice  = Math.max(...prices);
    const firstPrc  = prices[0];
    const lastPrice = prices[prices.length - 1];
    const pctChange = firstPrc > 0 ? ((lastPrice - firstPrc) / firstPrc * 100) : 0;
    const trendDir  = pctChange > 1.5 ? "up" : pctChange < -1.5 ? "down" : "flat";
    const trendColor= trendDir === "up" ? "var(--green)" : trendDir === "down" ? "var(--red)" : "var(--text-muted)";
    const trendLabel= trendDir === "flat" ? "Stabil" : `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%`;
    const isFromSeries = Array.isArray(price_series) && price_series.length >= 2;
    const seriesSource = chartWrap.dataset.market === "amazon"   ? "Keepa/Buy Box"
                       : chartWrap.dataset.market === "kaufland" ? "Kaufland Research"
                       :                                           "eBay Research";
    let seriesDays = 30;
    if (isFromSeries && chartEntries.length >= 2) {
      const t0 = new Date(chartEntries[0].ts).getTime();
      const t1 = new Date(chartEntries[chartEntries.length - 1].ts).getTime();
      seriesDays = Math.max(1, Math.round((t1 - t0) / 86400000));
    }
    const periodLabel  = isFromSeries ? `Letzte ${seriesDays} Tage (${seriesSource})` : `${I18N.t('fc.chart.last')} ${chartEntries.length} ${I18N.t('fc.chart.checks')}`;

    chartWrap.innerHTML = `
      <div class="panel" style="padding:14px 16px">
        <div class="row-between mb-12">
          <div class="row gap-8" style="align-items:center">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><polyline points="1,12 5,7 9,10 15,3" stroke="#6366F1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span class="text-xs font-semibold text-secondary" style="text-transform:uppercase;letter-spacing:.06em">${I18N.t('fc.chart.price_history')} — ${periodLabel}</span>
          </div>
          <div class="row gap-12" style="align-items:center">
            <span class="text-xs text-muted">Min: <strong style="color:var(--green)">${fmtEur(minPrice)}</strong></span>
            <span class="text-xs text-muted">Max: <strong style="color:var(--red)">${fmtEur(maxPrice)}</strong></span>
            <span class="text-xs font-semibold" style="color:${trendColor}">${trendLabel}</span>
          </div>
        </div>
        <div style="height:110px;position:relative">
          <canvas id="fcMiniChart"></canvas>
        </div>
      </div>
    `;

    if (_miniChart) { try { _miniChart.destroy(); } catch {} _miniChart = null; }
    const ctx = chartWrap.querySelector("#fcMiniChart");
    if (!ctx) return;

    // When showing a series, also render a bar dataset for daily quantity
    const hasQty = isFromSeries && chartEntries.some(e => e.qty != null);

    _miniChart = new Chart(ctx, {
      type: "bar",  // mixed chart
      data: {
        labels: chartEntries.map(e => {
          const d = new Date(e.ts);
          return `${d.getDate()}.${d.getMonth()+1}.`;
        }),
        datasets: [
          // Qty bars (background, right y-axis)
          ...(hasQty ? [{
            type: "bar",
            label: I18N.t('fc.chart.sales_label'),
            data: chartEntries.map(e => e.qty ?? 0),
            backgroundColor: "rgba(99,102,241,0.12)",
            borderColor: "transparent",
            borderWidth: 0,
            yAxisID: "yQty",
            order: 2,
          }] : []),
          // Price line (foreground)
          {
            type: "line",
            label: I18N.t('fc.chart.avg_price'),
            data: chartEntries.map(e => e.research_avg ?? e.browse_median ?? e.browse_avg ?? null),
            borderColor: "#6366F1",
            backgroundColor: "rgba(99,102,241,0.06)",
            borderWidth: 2,
            fill: !hasQty,
            tension: 0.35,
            pointRadius: chartEntries.length <= 14 ? 3 : 1,
            pointHoverRadius: 5,
            pointBackgroundColor: "#6366F1",
            pointBorderColor: "transparent",
            spanGaps: true,
            yAxisID: "yPrice",
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: { font: { size: 10, family: "Inter, sans-serif" }, color: "#94A3B8", boxWidth: 8, boxHeight: 2, padding: 10 },
          },
          tooltip: {
            backgroundColor: "#16161F",
            borderColor: "#2E2E42",
            borderWidth: 1,
            titleColor: "#F1F5F9",
            bodyColor: "#94A3B8",
            titleFont: { size: 10 },
            bodyFont: { size: 10 },
            callbacks: {
              label: c => c.dataset.label === I18N.t('fc.chart.sales_label')
                ? ` ${I18N.t('fc.chart.sales_label')}: ${c.parsed.y}`
                : ` ${c.dataset.label}: ${fmtEur(c.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(30,30,46,0.5)", drawBorder: false },
            ticks: { font: { size: 9 }, color: "#475569", maxTicksLimit: 8, maxRotation: 0 },
          },
          yPrice: {
            position: "left",
            grid: { color: "rgba(30,30,46,0.5)", drawBorder: false },
            ticks: { font: { size: 9 }, color: "#475569", callback: v => fmtEur(v), maxTicksLimit: 4 },
          },
          ...(hasQty ? {
            yQty: {
              position: "right",
              grid: { drawOnChartArea: false },
              ticks: { font: { size: 9 }, color: "#475569", maxTicksLimit: 3 },
            },
          } : {}),
        },
      },
    });
  }

  // ─── BSR Rank Chart (Amazon) ──────────────────────────────────────────────
  let _bsrChart = null;
  function loadBsrChart(resultEl, rank_series) {
    const chartWrap = resultEl.querySelector("#fcBsrChart");
    if (!chartWrap || !Array.isArray(rank_series) || rank_series.length < 2) return;

    // Downsample to max 60 points for display
    const step = Math.max(1, Math.floor(rank_series.length / 60));
    const pts   = rank_series.filter((_, i) => i % step === 0 || i === rank_series.length - 1);

    const labels = pts.map(([ts]) => {
      const d = new Date(ts);
      return `${d.getDate()}.${d.getMonth() + 1}.`;
    });
    const ranks = pts.map(([, r]) => r);
    const minR  = Math.min(...ranks);
    const maxR  = Math.max(...ranks);
    const bsrDays = pts.length >= 2
      ? Math.max(1, Math.round((pts[pts.length - 1][0] - pts[0][0]) / 86400000))
      : 30;

    chartWrap.innerHTML = `
      <div class="panel" style="padding:14px 16px">
        <div class="row-between mb-12">
          <div class="row gap-8" style="align-items:center">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><polyline points="1,12 5,5 9,9 15,2" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span class="text-xs font-semibold text-secondary" style="text-transform:uppercase;letter-spacing:.06em">${I18N.t('fc.chart.bsr_history')} — Letzte ${bsrDays} Tage (Keepa)</span>
          </div>
          <div class="row gap-12" style="align-items:center">
            <span class="text-xs text-muted">Best: <strong style="color:var(--green)">#${Number(minR).toLocaleString("de-DE")}</strong></span>
            <span class="text-xs text-muted">Worst: <strong style="color:var(--text-muted)">#${Number(maxR).toLocaleString("de-DE")}</strong></span>
          </div>
        </div>
        <div style="height:80px;position:relative">
          <canvas id="fcBsrMiniChart"></canvas>
        </div>
        <p class="text-xs text-muted" style="margin-top:6px">${I18N.t('fc.chart.bsr_hint')}</p>
      </div>
    `;

    if (_bsrChart) { try { _bsrChart.destroy(); } catch {} _bsrChart = null; }
    const ctx = chartWrap.querySelector("#fcBsrMiniChart");
    if (!ctx) return;

    _bsrChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "BSR",
          data: ranks,
          borderColor: "#F59E0B",
          backgroundColor: "rgba(245,158,11,0.07)",
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0.3,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: "index",
            intersect: false,
            backgroundColor: "rgba(15,15,23,0.9)",
            borderColor: "#2E2E42",
            borderWidth: 1,
            bodyColor: "#94A3B8",
            titleFont: { size: 10 },
            bodyFont: { size: 10 },
            callbacks: { label: c => ` BSR: #${Number(c.parsed.y).toLocaleString("de-DE")}` },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(30,30,46,0.5)", drawBorder: false },
            ticks: { font: { size: 9 }, color: "#475569", maxTicksLimit: 8, maxRotation: 0 },
          },
          y: {
            reverse: true,  // Lower rank number = better → show at top
            grid: { color: "rgba(30,30,46,0.5)", drawBorder: false },
            ticks: {
              font: { size: 9 }, color: "#475569", maxTicksLimit: 4,
              callback: v => `#${Number(v).toLocaleString("de-DE")}`,
            },
          },
        },
      },
    });
  }

  // ─── Scanner Modal ────────────────────────────────────────────────────────
  async function openScannerModal() {
    let scanInfo = null;
    try { scanInfo = await window.fc?.getScannerInfo(); } catch {}
    const url  = scanInfo?.url || "http://<IP>:8766";
    const body = `
      <div style="text-align:center">
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">
          ${I18N.t('fc.scanner.modal_sub')}
        </p>
        <div style="background:var(--bg-base);border:1px solid var(--border);border-radius:10px;padding:16px 20px;margin-bottom:16px">
          <div style="font-family:monospace;font-size:16px;font-weight:700;color:var(--accent);letter-spacing:.02em;word-break:break-all">${esc(url)}</div>
        </div>
        <button class="btn btn-secondary btn-sm" id="scanUrlCopy" style="margin-bottom:12px">
          📋 ${I18N.t('fc.scanner.copy_url')}
        </button>
        <p style="font-size:11px;color:var(--text-muted)">
          ${I18N.t('fc.scanner.wifi_hint')}<br>
          ${I18N.t('fc.scanner.ean_hint')}
        </p>
      </div>
    `;
    if (typeof Modal !== "undefined") {
      Modal.open({ title: `📷 ${I18N.t('fc.scanner.modal_title')}`, body, buttons: [{ label: I18N.t('fc.scanner.close'), variant: "btn-ghost", value: false }] });
      // Copy button
      setTimeout(() => {
        document.getElementById("scanUrlCopy")?.addEventListener("click", () => {
          navigator.clipboard?.writeText(url).then(() => {
            if (typeof Toast !== "undefined") Toast.success(I18N.t('fc.scanner.copied'), url);
          }).catch(() => {});
        });
      }, 50);
    }
  }

  // ─── Events ───────────────────────────────────────────────────────────────
  function attachEvents(container) {
    // Market toggle
    container.querySelector("#mktEbay")?.addEventListener("click", () => {
      if (selectedMarket !== "ebay") { selectedMarket = "ebay"; container.innerHTML = renderForm(); attachEvents(container); }
    });
    container.querySelector("#mktAmazon")?.addEventListener("click", () => {
      if (selectedMarket !== "amazon") { selectedMarket = "amazon"; container.innerHTML = renderForm(); attachEvents(container); }
    });
    container.querySelector("#mktKaufland")?.addEventListener("click", () => {
      if (selectedMarket !== "kaufland") { selectedMarket = "kaufland"; container.innerHTML = renderForm(); attachEvents(container); }
    });

    // Amazon method toggle
    container.querySelectorAll("#fcAmzMethodSeg .seg-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        container.querySelectorAll("#fcAmzMethodSeg .seg-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const wrap = container.querySelector("#fcAmzShipInWrap");
        if (wrap) wrap.style.display = btn.dataset.method === "fbm" ? "" : "none";
      });
    });

    container.querySelector("#btnCheck")?.addEventListener("click", () => runCheck(container));
    container.querySelector("#fcEan")?.addEventListener("keydown", e => { if (e.key==="Enter") container.querySelector("#fcEk")?.focus(); });
    container.querySelector("#fcEk")?.addEventListener("keydown",  e => { if (e.key==="Enter") runCheck(container); });
    container.querySelector("#fcScanBtn")?.addEventListener("click", () => openScannerModal());

    // Auto-detect ASIN while in eBay mode → suggest switching to Amazon
    container.querySelector("#fcEan")?.addEventListener("input", e => {
      const v = e.target.value.trim().toUpperCase();
      const isAsin = /^[A-Z0-9]{10}$/.test(v) && /[A-Z]/.test(v);
      let hint = container.querySelector("#fcAsinHint");
      if (isAsin && selectedMarket === "ebay") {
        if (!hint) {
          hint = document.createElement("div");
          hint.id = "fcAsinHint";
          hint.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:6px;padding:7px 10px;background:var(--accent-sub);border:1px solid var(--accent-bdr);border-radius:var(--r);font-size:12px;color:var(--accent)";
          hint.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span>${I18N.t('fc.asin_hint')}</span><button id="fcSwitchAmz" class="btn btn-ghost btn-xs" style="font-size:11px;padding:2px 8px;margin-left:auto">→ Amazon</button>`;
          const inputGroup = e.target.closest(".input-group");
          if (inputGroup) inputGroup.appendChild(hint);
          container.querySelector("#fcSwitchAmz")?.addEventListener("click", () => {
            const curVal = container.querySelector("#fcEan")?.value;
            selectedMarket = "amazon";
            container.innerHTML = renderForm({ ean: curVal });
            attachEvents(container);
          });
        }
      } else if (hint) {
        hint.remove();
      }
    });

    // ── Link kopieren — https://gate.joinflipcheck.app/check?... (Discord-klickbar)
    container.querySelector("#btnCopyLink")?.addEventListener("click", () => {
      const ean = container.querySelector("#fcEan")?.value.trim();
      const ek  = container.querySelector("#fcEk")?.value.trim() || "0";
      const cat = container.querySelector("#fcCategory")?.value || "sonstiges";
      if (!ean) { Toast.error(I18N.t('fc.err.ean_missing'), I18N.t('fc.err.ean_missing_sub')); return; }
      const params = new URLSearchParams({ ean, ek, market: selectedMarket, cat });
      const url = `https://gate.joinflipcheck.app/check?${params}`;
      navigator.clipboard.writeText(url).then(() => {
        Toast.success(I18N.t('fc.link.copied'), I18N.t('fc.link.copied_sub'));
      }).catch(() => Toast.error(I18N.t('fc.link.copy_fail'), url));
    });

    // Amazon mode: auto-resolve EAN↔ASIN in converter box (debounced)
    if (selectedMarket === "amazon") {
      let _convTimer = null;
      container.querySelector("#fcEan")?.addEventListener("input", e => {
        const raw  = e.target.value.trim();
        const v    = raw.toUpperCase();
        const box  = container.querySelector("#fcConverterBox");
        if (!box) return;
        clearTimeout(_convTimer);
        const isAsin = /^[A-Z0-9]{10}$/.test(v) && /[A-Z]/.test(v);
        const isEan  = /^\d{8,14}$/.test(raw);
        if (!isAsin && !isEan) { box.style.display = "none"; return; }

        box.style.display = "block";
        const eanEl  = box.querySelector("#fcConvEan");
        const asinEl = box.querySelector("#fcConvAsin");
        if (eanEl)  eanEl.textContent  = isEan  ? raw : "…";
        if (asinEl) asinEl.textContent = isAsin ? v   : "…";

        _convTimer = setTimeout(async () => {
          try {
            let resolvedEan = isEan ? raw : null;
            let resolvedAsin = isAsin ? v : null;

            if (isEan) {
              // EAN → ASIN: use /compare which does Keepa lookup
              const { ok, data } = await API.compare(raw, 0);
              if (ok && data?.amazon?.asin) {
                resolvedAsin = data.amazon.asin;
              }
            } else {
              // ASIN → EAN: use /amazon-check which returns resolved EAN
              const { ok, data } = await API.amazonCheck(v, null, 0, "mid", "fba", 0, "sonstiges", 0);
              if (ok && data?.ean) {
                resolvedEan = data.ean;
              }
            }

            if (eanEl)  eanEl.textContent  = resolvedEan  || "—";
            if (asinEl) asinEl.textContent = resolvedAsin || "—";

            // Copy button: copies the OTHER identifier
            const copyBtn = box.querySelector("#fcConvCopy");
            if (copyBtn) {
              const copyVal = isAsin ? (resolvedEan || "") : (resolvedAsin || "");
              copyBtn.onclick = () => {
                if (!copyVal) return;
                navigator.clipboard.writeText(copyVal).then(() => {
                  copyBtn.textContent = "✓ " + I18N.t('fc.converter.copied');
                  setTimeout(() => { copyBtn.textContent = I18N.t('fc.converter.copy'); }, 1500);
                }).catch(() => {});
              };
            }
          } catch {}
        }, 700);
      });
    }
  }

  // ─── Run Check ────────────────────────────────────────────────────────────
  async function runCheck(container) {
    const identifier = container.querySelector("#fcEan")?.value.trim();
    const ekRaw      = container.querySelector("#fcEk")?.value.trim();
    const ek         = parseFloat(ekRaw);
    const mode       = "mid"; // fixed — verdict uses margin>=15% & DTC<=15 thresholds

    if (!identifier) { Toast.error(I18N.t('fc.err.ean_missing'), I18N.t('fc.err.ean_asin_sub')); return; }
    if (!ekRaw || isNaN(ek) || ek <= 0) { Toast.error(I18N.t('fc.err.ek_missing'), I18N.t('fc.err.ek_missing_sub')); return; }

    const resultEl = container.querySelector("#fcResult");
    resultEl.innerHTML = renderLoading(selectedMarket);
    const btn = container.querySelector("#btnCheck");
    if (btn) btn.disabled = true;

    try {
      // ── Amazon branch ────────────────────────────────────────────────────
      if (selectedMarket === "amazon") {
        const category = container.querySelector("#fcAmzCategory")?.value || "sonstiges";
        const methodBtn = container.querySelector("#fcAmzMethodSeg .seg-btn.active");
        const method   = methodBtn?.dataset.method || "fba";
        // FBA: ship_in = cost to send to Amazon warehouse (optional, default 0)
        // FBM: ship_in = cost per outgoing shipment (required, default 4.99)
        const shipIn   = method === "fbm"
          ? (parseFloat(container.querySelector("#fcAmzShipIn")?.value) || 4.99)
          : (parseFloat(container.querySelector("#fcAmzShipIn")?.value) || 0);
        const prepFee  = parseFloat(container.querySelector("#fcAmzPrepFee")?.value) || 0;

        // Detect if input looks like ASIN (B0...) or EAN (digits)
        const isAsin = /^[A-Z0-9]{10}$/.test(identifier.toUpperCase()) && /[A-Z]/.test(identifier.toUpperCase());
        const asin   = isAsin ? identifier.toUpperCase() : null;
        const ean    = isAsin ? null : identifier;

        const { ok, data } = await API.amazonCheck(asin, ean, ek, mode, method, shipIn, category, prepFee, _vatMode, _ekMode);
        if (!ok && data?.error === "no_plan") { resultEl.innerHTML = renderUpgradeWall(); bindUpgradeButton(container); if (btn) btn.disabled = false; return; }
        if (!ok || !data) throw new Error(data?.detail || "Backend nicht erreichbar");

        lastResult = data; lastEan = identifier; lastEk = ek;
        resultEl.innerHTML = renderResultAmazon(data, identifier, ek, shipIn);

        // Auto-detect category from Keepa response and pre-select dropdown for next check
        if (data.category_name) {
          const detectedCat = _detectAmzCategory(data.category_name);
          if (detectedCat) {
            const catSel = container.querySelector("#fcAmzCategory");
            if (catSel && catSel.value === "sonstiges") catSel.value = detectedCat;
          }
        }

        // Update EAN↔ASIN converter box with resolved values
        const box = container.querySelector("#fcConverterBox");
        if (box && (data.ean || data.asin)) {
          box.style.display = "block";
          const eanEl  = box.querySelector("#fcConvEan");
          const asinEl = box.querySelector("#fcConvAsin");
          if (eanEl)  eanEl.textContent  = data.ean  || (isAsin ? "—" : identifier);
          if (asinEl) asinEl.textContent = data.asin || (isAsin ? identifier : "—");
          const copyBtn = box.querySelector("#fcConvCopy");
          if (copyBtn) {
            const copyVal = isAsin ? (data.ean || "") : (data.asin || "");
            copyBtn.onclick = () => {
              if (!copyVal) return;
              navigator.clipboard.writeText(copyVal).then(() => {
                copyBtn.textContent = "✓ Kopiert";
                setTimeout(() => { copyBtn.textContent = "Kopieren"; }, 1500);
              }).catch(() => {});
            };
          }
        }

        // Save to inventory handler
        resultEl.querySelector("#btnAddToInv")?.addEventListener("click", () => addToInventory(identifier, ek, data, "amazon"));
        resultEl.querySelector("#btnReset")?.addEventListener("click", () => { resultEl.innerHTML = renderResultPlaceholder(); });

        // Amazon price chart (Buy Box series from Keepa)
        if (data.price_series?.length >= 2) {
          loadPriceChart(identifier, resultEl, data.price_series, null, data.buy_box ?? null);
        }
        // Amazon BSR rank chart (Sales Rank series from Keepa)
        if (data.rank_series?.length >= 2) {
          loadBsrChart(resultEl, data.rank_series);
        }
        return;
      }

      // ── Kaufland branch ──────────────────────────────────────────────────
      if (selectedMarket === "kaufland") {
        const klCat  = container.querySelector("#fcCategory")?.value || "kl_sonstiges";
        const shipIn  = parseFloat(container.querySelector("#fcShipIn")?.value)  || 0;
        const shipOut = parseFloat(container.querySelector("#fcShipOut")?.value) || 0;

        const { ok, data } = await API.flipcheck(identifier, ek, mode, {
          market:       "kaufland",
          category:     klCat,
          shipping_in:  shipIn,
          shipping_out: shipOut,
          vat_mode:     _vatMode,
          ek_mode:      _ekMode,
        });

        if (!ok && data?.error === "no_plan") { resultEl.innerHTML = renderUpgradeWall(); bindUpgradeButton(container); if (btn) btn.disabled = false; return; }
        if (!ok || !data) throw new Error(data?.detail || data?.error || "Backend nicht erreichbar");

        lastResult = data; lastEan = identifier; lastEk = ek;
        resultEl.innerHTML = renderResultKaufland(data, identifier, ek);

        resultEl.querySelector("#btnAddToInv")?.addEventListener("click", () => addToInventory(identifier, ek, data, "kaufland"));
        resultEl.querySelector("#btnReset")?.addEventListener("click",    () => { resultEl.innerHTML = renderResultPlaceholder(); });

        if (btn) btn.disabled = false;
        return;
      }

      // ── eBay branch ──────────────────────────────────────────────────────
      // Auto-resolve ASIN → EAN if user typed an ASIN while on eBay market
      let ean = identifier;
      const mightBeAsin = /^[A-Z0-9]{10}$/.test(identifier.toUpperCase()) && /[A-Z]/.test(identifier.toUpperCase());
      if (mightBeAsin) {
        resultEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text2);font-size:12px">ASIN wird zu EAN aufgelöst…</div>`;
        try {
          const { ok: aok, data: adata } = await API.amazonCheck(identifier.toUpperCase(), null, ek, mode, "fba", 0, "sonstiges", 0);
          if (aok && adata?.ean) {
            ean = adata.ean;
            const eanInp = container.querySelector("#fcEan");
            if (eanInp) eanInp.value = ean;
            Toast.info("ASIN → EAN", `${identifier.toUpperCase()} → EAN ${ean}`); // technical label — not translated
            resultEl.innerHTML = renderLoading("ebay");
          } else {
            resultEl.innerHTML = renderErrorCard(
              "ASIN nicht auflösbar",
              `Für ${esc(identifier.toUpperCase())} konnte keine EAN gefunden werden. Wechsle zu Amazon, um die ASIN direkt zu prüfen.`
            );
            if (btn) btn.disabled = false;
            return;
          }
        } catch {
          resultEl.innerHTML = renderErrorCard(
            "ASIN-Auflösung fehlgeschlagen",
            "Das Backend konnte die ASIN nicht in eine EAN umwandeln. Bitte prüfe deine Verbindung."
          );
          if (btn) btn.disabled = false;
          return;
        }
      }

      const cat      = container.querySelector("#fcCategory")?.value || "sonstiges";
      const shipIn   = parseFloat(container.querySelector("#fcShipIn")?.value)    || 0;
      const shipOut  = parseFloat(container.querySelector("#fcShipOut")?.value)   || 0;
      const packaging = parseFloat(container.querySelector("#fcPackaging")?.value) || 0;
      const adRate   = parseFloat(container.querySelector("#fcAdRate")?.value)    || 0;

      const { ok, data } = await API.flipcheck(ean, ek, mode, {
        category:     cat,
        shipping_in:  shipIn,
        shipping_out: shipOut,
        vat_mode:     _vatMode,
        ek_mode:      _ekMode,
      });

      if (!ok && data?.error === "no_plan") { resultEl.innerHTML = renderUpgradeWall(); bindUpgradeButton(container); if (btn) btn.disabled = false; return; }
      if (!ok || !data) throw new Error(data?.detail || "Backend nicht erreichbar");

      lastResult = data; lastEan = ean; lastEk = ek;
      resultEl.innerHTML = renderResult(data, ean, ek, cat, shipIn, shipOut, adRate);

      // Auto-save price history
      try {
        await Storage.savePrice({ ean, title: data.title || ean, browse_avg: data.browse_avg, browse_median: data.sell_price_median, research_avg: data.sell_price_avg, sales_30d: data.sales_30d });
      } catch {}

      if (data.price_series?.length) {
        Storage.savePriceSeries({ ean, title: data.title || ean, price_series: data.price_series, qty_series: data.qty_series || [] });
      }

      loadPriceChart(ean, resultEl, data.price_series, data.qty_series);

      resultEl.querySelector("#btnCreateListing")?.addEventListener("click", () => ListingAssistant.open(data, ean, ek));
      resultEl.querySelector("#btnAddToInv")?.addEventListener("click",     () => addToInventory(ean, ek, data, "ebay"));
      resultEl.querySelector("#btnReset")?.addEventListener("click",         () => { resultEl.innerHTML = renderResultPlaceholder(); });

    } catch (err) {
      ErrorReporter.report(err, `runCheck:${selectedMarket}`);
      resultEl.innerHTML = renderError(err.message || "Unbekannter Fehler");
      resultEl.querySelector("#btnReset")?.addEventListener("click", () => { resultEl.innerHTML = renderResultPlaceholder(); });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function addToInventory(identifier, ek, data, market = "ebay") {
    try {
      await Storage.upsertItem({ ean: identifier, title: data.title || identifier, ek, market, status: "IN_STOCK", qty: 1 });
      Toast.success(I18N.t('fc.inv.added'), `${data.title || identifier} ${I18N.t('fc.inv.added_sub')}`);
    } catch (err) {
      ErrorReporter.report(err, "addToInventory");
      Toast.error(I18N.t('fc.inv.err_title'), I18N.t('fc.inv.err_sub'));
    }
  }

  return { mount, unmount };
})();
