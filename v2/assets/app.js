// @ts-check
/* Flipcheck v2 — App Router & API Client */

// ─── Global state ─────────────────────────────────────────────────────────────

/**
 * Global application state — shared across all views.
 * @type {{
 *   token:            string|null,
 *   backendBase:      string|null,
 *   gateBase:         string|null,
 *   settings:         FC_Settings,
 *   currentView:      string|null,
 *   viewInstances:    Record<string, {mount: Function, unmount?: Function}>,
 *   _navId:           number,
 *   _navPayload:      Record<string, *>|null,
 *   _statusInterval:  number,
 *   _alertsInterval:  number,
 * }}
 */
const App = {
  token: null,
  backendBase: null,
  gateBase: null,
  settings: {},
  currentView: null,
  viewInstances: {},
  _ebaySellerUsername: null,   // eBay seller username (for own-listing highlight)
  _navId: 0,          // Navigation counter — lets async mounts detect stale renders
  _navPayload: null,  // One-shot payload passed between views (e.g. EAN for Flipcheck)
  _statusInterval: 0, // setInterval ID for backend-status polling (cleared on logout)
  _alertsInterval: 0, // setInterval ID for background alert checks (cleared on logout)
};

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * HTML-escape a value for safe insertion into innerHTML.
 * Converts null/undefined to empty string before escaping.
 * @param {*} str
 * @returns {string}
 */
function esc(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ── Intl formatter singletons — created once, reused on every render call ──
const _fmtEur  = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const _fmtDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });

/**
 * Format a number as a German-locale Euro amount (e.g. "1.234,56 €").
 * Returns "—" for null, undefined, or NaN.
 * @param {number|null|undefined} val
 * @returns {string}
 */
function fmtEur(val) {
  if (val == null || isNaN(val)) return "—";
  return _fmtEur.format(val);
}

/**
 * Format a number as a signed percentage string (e.g. "+12.5%" or "-3.2%").
 * Returns "—" for null, undefined, NaN, or Infinity.
 * @param {number|null|undefined} val
 * @returns {string}
 */
function fmtPct(val) {
  if (val == null || !isFinite(val) || isNaN(val)) return "—";
  return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
}

/**
 * Format an ISO date string as a short German date (e.g. "04.03.26").
 * Returns "—" for falsy input.
 * @param {string|null|undefined} iso
 * @returns {string}
 */
function fmtDate(iso) {
  if (!iso) return "—";
  return _fmtDate.format(new Date(iso));
}

/**
 * Format a number of days as a compact string (e.g. "14d").
 * Returns "—" for null, undefined, or NaN.
 * @param {number|null|undefined} n
 * @returns {string}
 */
function fmtDays(n) {
  if (n == null || isNaN(n)) return "—";
  return `${Math.round(n)}d`;
}

// ─── eBay DE fee calculator (tiered, shared across all views) ────────────────

/**
 * eBay Deutschland tiered fee table.
 * Each tier: [upper_threshold_eur | null, rate_decimal]
 * null threshold means "no upper limit" (applies to remainder).
 * @type {FC_EbayFeeCategory[]}
 */
const EBAY_FEE_CATEGORIES = [
  { id: "computer_tablets",  label: "Computer, Tablets & Netzwerk",         tiers: [[null, 0.07]] },
  { id: "drucker",           label: "Drucker",                               tiers: [[null, 0.07]] },
  { id: "foto_camcorder",    label: "Foto & Camcorder",                      tiers: [[null, 0.07]] },
  { id: "handys",            label: "Handys & Kommunikation",                tiers: [[null, 0.07]] },
  { id: "haushaltsgeraete",  label: "Haushaltsgeräte",                       tiers: [[null, 0.07]] },
  { id: "konsolen",          label: "Konsolen / Videospiele",                tiers: [[null, 0.07]] },
  { id: "scanner",           label: "Scanner",                               tiers: [[null, 0.07]] },
  { id: "speicherkarten",    label: "Speicherkarten",                        tiers: [[null, 0.07]] },
  { id: "tv_video_audio",    label: "TV, Video & Audio",                     tiers: [[null, 0.07]] },
  { id: "koerperpflege",     label: "Elektr. Körperpflege & Styling",        tiers: [[null, 0.07]] },
  { id: "drucker_zubehoer",  label: "Drucker- & Scanner-Zubehör",           tiers: [[null, 0.12]] },
  { id: "handy_zubehoer",    label: "Handy-Zubehör",                         tiers: [[null, 0.12]] },
  { id: "batterien",         label: "Haushaltsbatterien & Strom",            tiers: [[null, 0.12]] },
  { id: "kabel",             label: "Kabel & Steckverbinder",                tiers: [[null, 0.12]] },
  { id: "kameras_zubehoer",  label: "Kameras, Drohnen & Fotozubehör",       tiers: [[null, 0.12]] },
  { id: "notebook_zubehoer", label: "Notebook- & Desktop-Zubehör",          tiers: [[null, 0.12]] },
  { id: "objektive",         label: "Objektive & Filter",                    tiers: [[null, 0.07]] },
  { id: "stative",           label: "Stative & Zubehör",                    tiers: [[null, 0.12]] },
  { id: "tablet_zubehoer",   label: "Tablet & eBook Zubehör",               tiers: [[null, 0.12]] },
  { id: "tastaturen_maeuse", label: "Tastaturen, Mäuse & Pointing",          tiers: [[null, 0.12]] },
  { id: "tv_zubehoer",       label: "TV- & Heim-Audio-Zubehör",             tiers: [[null, 0.12]] },
  { id: "pc_zubehoer",       label: "PC & Videospiele Zubehör",             tiers: [[null, 0.12]] },
  { id: "audio_zubehoer",    label: "Zubehör Audiogeräte",                  tiers: [[null, 0.12]] },
  { id: "mode",              label: "Mode / Bekleidung",                     tiers: [[990, 0.12], [null, 0.03]]  },
  { id: "sport_freizeit",    label: "Sport & Freizeit",                      tiers: [[null, 0.14]] },
  { id: "spielzeug",         label: "Spielzeug / LEGO",                      tiers: [[990, 0.12], [null, 0.03]] },
  { id: "haushalt",          label: "Haushalt",                              tiers: [[null, 0.14]] },
  { id: "garten",            label: "Garten",                                tiers: [[null, 0.13]] },
  { id: "haushalt_garten",   label: "Haushalt & Garten",                     tiers: [[null, 0.14]] },  // legacy alias
  { id: "buecher",           label: "Bücher & Medien",                       tiers: [[990, 0.12], [null, 0.03]]  },
  { id: "sonstiges",         label: "Sonstiges",                             tiers: [[null, 0.14]]  },
  // ── Sonderkonditionen ────────────────────────────────────────────────────
  { id: "durchstarter",      label: "Durchstarter / Sonderaktion (0 %)",     tiers: [[null, 0.00]]  },
];

/**
 * Calculate the eBay final value fee for a given gross sell price and category.
 * Applies the tiered structure from EBAY_FEE_CATEGORIES left-to-right.
 *
 * @param {number} priceGross - Gross sell price in EUR
 * @param {string} catId      - Category ID matching an entry in EBAY_FEE_CATEGORIES
 * @returns {number} Fee amount in EUR
 */
function calcEbayFee(priceGross, catId) {
  const cat = EBAY_FEE_CATEGORIES.find(c => c.id === catId) || EBAY_FEE_CATEGORIES[EBAY_FEE_CATEGORIES.length - 1];
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

/**
 * Market-specific flat fee rates for Amazon and Kaufland (fallback if no category set).
 * eBay uses the tiered calcEbayFee() instead.
 * @type {Record<string, number>}
 */
const MARKET_FEE_RATES = {
  amz:      0.15,   // Amazon: ~15% referral fee (varies by category, 15% is conservative)
  kaufland: 0.13,   // Kaufland: 13% default ("Alle anderen Kategorien") — fallback only, see KAUFLAND_FEE_CATEGORIES
  other:    0,
};

/**
 * Amazon referral fee rates by category (used in calcMarketFee + inventory profit calc).
 * @type {Record<string, number>}
 */
const AMAZON_FEE_CATEGORIES = {
  computer_tablets: 0.07, handys: 0.07, konsolen: 0.08, foto_camcorder: 0.07,
  tv_video_audio: 0.07, haushaltsgeraete: 0.07, drucker: 0.07,
  handy_zubehoer: 0.15, notebook_zubehoer: 0.15, kabel: 0.15,
  mode: 0.15, sport_freizeit: 0.15, spielzeug: 0.15, buecher: 0.15, sonstiges: 0.15,
};

/**
 * Kaufland seller commission rates by category — [pct, fixed_fee_eur].
 * Verified April 2026 against official Kaufland rate card (DE/AT/CZ/SK/FR/IT).
 * https://www.kaufland.de/haendler-infobereich/de/so-funktionierts/preise-konditionen
 * @type {Record<string, [number, number]>}
 */
const KAUFLAND_FEE_CATEGORIES = {
  // 7% — Consumer Electronics & Großgeräte
  kl_elektronik:     [0.07, 0.00],
  kl_handys:         [0.07, 0.00],
  kl_gaming:         [0.07, 0.00],
  kl_foto:           [0.07, 0.00],
  kl_haushalt_gross: [0.07, 0.00],
  // 10%
  kl_werkzeug:       [0.10, 0.00],
  kl_parfuem:        [0.10, 0.00],
  // 13% (default for "other")
  kl_haushalt_el:    [0.13, 0.00],  // Kleingeräte, PC/E-Zubehör, Fahrräder
  kl_koerperpflege:  [0.13, 0.00],
  kl_baumarkt:       [0.13, 0.00],
  kl_moebel:         [0.13, 0.00],
  kl_sport:          [0.13, 0.00],
  kl_baby:           [0.13, 0.00],
  kl_spielzeug:      [0.13, 0.00],
  kl_lebensmittel:   [0.13, 0.00],
  kl_sonstiges:      [0.13, 0.00],
  // 13% + 0,70 € fixed per item (Medien)
  kl_medien:         [0.13, 0.70],
  kl_buecher:        [0.13, 0.70],   // legacy alias
  // 14%
  kl_garten:         [0.14, 0.00],
  kl_mode:           [0.14, 0.00],
  kl_haushalt:       [0.14, 0.00],   // Küche & Haushalt, Matratzen
  kl_kueche:         [0.14, 0.00],
  kl_tier:           [0.14, 0.00],
  kl_camping:        [0.14, 0.00],
  // 16%
  kl_schmuck:        [0.16, 0.00],
};

/**
 * Calculate the platform fee for any market — single source of truth for all fee logic.
 * @param {number} vk      - Gross sell price
 * @param {string} market  - "ebay" | "amz" | "kaufland" | "other"
 * @param {string} [catId] - Category ID (eBay cat for eBay, kl_* for Kaufland, Amazon cat for amz)
 * @returns {number} Fee in EUR
 */
function calcMarketFee(vk, market, catId) {
  if (market === "ebay")     return calcEbayFee(vk, catId || "sonstiges");
  if (market === "amz")      return vk * (AMAZON_FEE_CATEGORIES[catId] ?? MARKET_FEE_RATES.amz);
  if (market === "kaufland") {
    const [pct, fixed] = KAUFLAND_FEE_CATEGORIES[catId] ?? [MARKET_FEE_RATES.kaufland, 0];
    return vk * pct + fixed;
  }
  return 0;
}

/**
 * Calculate the real per-unit profit for one inventory item.
 * Prefers real eBay fee data (from Finances API) over estimated fees.
 * - ebay_fee: real fee from eBay Finances API (if available)
 * - ebay_ship_cost: real shipping label cost from eBay (if available)
 * Falls back to estimated fees (category-based) when real data is unavailable.
 * Returns null if sell_price or ek are missing.
 *
 * MwSt-Logik (wenn User umsatzsteuerpflichtig — vat_mode: "ust_19"):
 * - VK, Fee, Shipping: netto = brutto / 1.19
 * - EK: netto = brutto / 1.19 (wenn ek_mode: "gross"), sonst schon netto
 * - Profit = vkNet - ekNet - shipInNet - shipOutNet - feeNet
 *
 * @param {FC_InventoryItem} item
 * @returns {number|null} Per-unit profit in EUR, or null if data is incomplete.
 */
function calcRealProfit(item) {
  if (!item || item.sell_price == null || item.ek == null) return null;
  const vk      = Number(item.sell_price) || 0;
  const ek      = Number(item.ek)         || 0;
  const shipIn  = Number(item.ship_in)    || 0;
  const market  = item.market || "ebay";

  // Prefer real eBay fee from Finances API, fall back to estimated
  const feeRaw  = item.ebay_fee != null ? Number(item.ebay_fee) : calcMarketFee(vk, market, item.cat_id);

  // Prefer real shipping label cost from eBay, fall back to manual ship_out
  const shipOut = item.ebay_ship_cost != null ? Number(item.ebay_ship_cost) : (Number(item.ship_out) || 0);

  // Refund adjustment: reduce revenue by refund amount, reduce fee by fee credit
  const refund    = Number(item.refund_amount) || 0;
  const feeCredit = Number(item.refund_fee_credit) || 0;
  const fee       = Math.max(0, feeRaw - feeCredit);
  const effectiveVk = vk - refund;

  // MwSt: if user is USt-pflichtig, compute everything netto
  const tax     = App.settings?.tax || {};
  const vatMode = tax.vat_mode || "no_vat";
  const ekMode  = tax.ek_mode  || "gross";

  if (vatMode === "ust_19") {
    const vat       = 1.19;
    const vkNet     = effectiveVk / vat;
    const feeNet    = fee    / vat;
    const shipInNet = shipIn / vat;
    const shipOutNet= shipOut/ vat;
    const ekNet     = ekMode === "gross" ? ek / vat : ek;
    return vkNet - ekNet - shipInNet - shipOutNet - feeNet;
  }

  return effectiveVk - ek - shipIn - shipOut - fee;
}

/**
 * Check if an item uses real fee data from eBay Finances API.
 * @param {FC_InventoryItem} item
 * @returns {boolean}
 */
function hasRealFees(item) {
  return item && item.ebay_fee != null;
}

// ─── API Client ───────────────────────────────────────────────────────────────

/**
 * Authenticated HTTP client for the Flipcheck backend API.
 * Automatically injects the `Authorization: Bearer` header when `App.token` is set.
 */
const API = {
  /**
   * Make an authenticated API request.
   * @param {string} path                     - URL path (e.g. "/flipcheck")
   * @param {{ method?: string, body?: * }}   [opts]
   * @returns {Promise<FC_ApiResponse>}
   */
  async call(path, { method = "GET", body = null, signal } = {}) {
    // Auth endpoints → gate server; everything else → backend API
    const isAuth = path.startsWith("/auth/");
    const base = isAuth
      ? (App.gateBase || App.backendBase || "http://127.0.0.1:9000")
      : (App.backendBase || "http://127.0.0.1:9000");
    /** @type {Record<string, string>} */
    const headers = { "Content-Type": "application/json" };
    if (App.token) headers["Authorization"] = `Bearer ${App.token}`;

    /** @type {Record<string, unknown>} */
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    if (signal) opts.signal = signal;

    const res = await fetch(`${base}${path}`, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { console.warn("[API] JSON parse error on", path, e); }
    return { ok: res.ok, status: res.status, data };
  },

  /**
   * Run a Flipcheck analysis for an EAN.
   * @param {string} ean
   * @param {number} ek         - Purchase price in EUR
   * @param {'low'|'mid'|'high'} [mode]
   * @param {Record<string, *>} [extra]  - Additional body fields (e.g. shipping_in, shipping_out)
   * @returns {Promise<FC_ApiResponse>}
   */
  async flipcheck(ean, ek, mode = "mid", extra = {}, signal) {
    return this.call("/flipcheck", { method: "POST", body: { ean, ek, mode, ...extra }, signal });
  },

  /**
   * Run an Amazon check for an ASIN.
   * @param {string}          asin
   * @param {string}          ean
   * @param {number}          ek
   * @param {'low'|'mid'|'high'} [mode]
   * @param {'fba'|'fbm'}     [method]
   * @param {number}          [shipIn]
   * @param {string}          [category]
   * @param {number}          [prepFee]
   * @returns {Promise<FC_ApiResponse>}
   */
  async amazonCheck(asin, ean, ek, mode = "mid", method = "fba", shipIn = 0, category = "sonstiges", prepFee = 0, vatMode = "no_vat", ekMode = "gross", sellCustom, shipMode = "gross") {
    const body = { asin, ean, ek, mode, method, ship_in: shipIn, category, prep_fee: prepFee, vat_mode: vatMode, ek_mode: ekMode, ship_mode: shipMode };
    if (sellCustom) body.sell_custom = sellCustom;
    return this.call("/amazon-check", { method: "POST", body });
  },

  /**
   * Run a Sneaker check (StockX + GOAT).
   * @param {string} sku        - Sneaker SKU (e.g. "FV5029-500")
   * @param {number} ek         - Purchase price in EUR
   * @param {string} [platform] - "stockx", "goat", or "both"
   * @returns {Promise<FC_ApiResponse>}
   */
  async sneakerCheck(sku, ek, platform = "both") {
    return this.call("/sneaker-check", { method: "POST", body: { sku, ek, platform } });
  },

  /** @returns {Promise<FC_ApiResponse>} */
  async health() {
    return this.call("/health");
  },

  /**
   * Creates a Stripe Checkout Session and returns { checkout_url }.
   * @param {number} [trialDays] - Number of free trial days (0 = no trial)
   */
  async createCheckoutSession(trialDays = 0) {
    return this.call("/create-checkout-session", { method: "POST", body: { trial_days: trialDays } });
  },

  /**
   * Trigger a deal scan with profitability filters.
   * @param {number} budget
   * @param {number} minMargin
   * @param {number} minRoi
   * @param {number} [limit]
   * @returns {Promise<FC_ApiResponse>}
   */
  async dealscan(budget, minMargin, minRoi, limit = 20) {
    return this.call("/deals/scan", {
      method: "POST",
      body: { budget, min_margin: minMargin, min_roi: minRoi, limit },
    });
  },

  /**
   * @param {string} sellerId
   * @param {number} [limit]
   * @param {string} [q]
   * @returns {Promise<FC_ApiResponse>}
   */
  async sellerListings(sellerId, limit = 50, q = "") {
    const p = new URLSearchParams({ seller_id: sellerId, limit: String(limit) });
    if (q && q.trim()) p.set("q", q.trim());
    return this._competitionCall(`/seller/listings?${p}`);
  },

  /**
   * @param {string} ean
   * @param {number} [limit]
   * @returns {Promise<FC_ApiResponse>}
   */
  async eanCompetition(ean, limit = 50) {
    return this._competitionCall(`/ean/competition?ean=${encodeURIComponent(ean)}&limit=${limit}`);
  },

  /**
   * Competition calls always go to api.joinflipcheck.app (not gate).
   * In local dev mode, the local backend is used instead.
   * @param {string} path
   * @returns {Promise<FC_ApiResponse>}
   */
  async _competitionCall(path) {
    const isLocal = App.backendBase && App.backendBase.startsWith("http://127.0.0.1");
    const base    = isLocal ? App.backendBase : "https://api.joinflipcheck.app";
    const headers = /** @type {Record<string,string>} */ ({ "Content-Type": "application/json" });
    if (App.token) headers["Authorization"] = `Bearer ${App.token}`;
    try {
      const res  = await fetch(`${base}${path}`, { method: "GET", headers });
      let   data = null;
      try { data = await res.json(); } catch {}
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: null };
    }
  },

  /**
   * @param {string} ean
   * @param {number} [ek]
   * @returns {Promise<FC_ApiResponse>}
   */
  async compare(ean, ek = 0) {
    const p = new URLSearchParams({ ean, ek: String(ek) });
    return this.call(`/compare?${p}`);
  },

  /** @returns {Promise<FC_ApiResponse>} */
  async verify() {
    return this.call("/auth/verify");
  },
};

// ─── Router ───────────────────────────────────────────────────────────────────
/** @type {Record<string, string>} */
const VIEW_TITLES = {
  analytics:   "Analytics",
  flipcheck:   "Flipcheck",
  batch:       "Batch Flipcheck",
  inventory:   "Inventory",
  history:     "Preishistorie",
  dealscan:    "Deal-Scanner",
  competition: "Konkurrenz-Monitor",
  repricer:    "Auto-Repricer",
  alerts:      "Preisalarm",
  marketplace: "Marktplatz-Vergleich",
  sales:       "Verkäufe",
  settings:    "Einstellungen",
};

/** @type {Record<string, {mount: Function, unmount?: Function}|null>} */
const VIEW_MAP = {
  analytics:   typeof AnalyticsView   !== "undefined" ? AnalyticsView   : null,
  flipcheck:   typeof FlipcheckView   !== "undefined" ? FlipcheckView   : null,
  batch:       typeof BatchView       !== "undefined" ? BatchView       : null,
  inventory:   typeof InventoryView   !== "undefined" ? InventoryView   : null,
  history:     typeof HistoryView     !== "undefined" ? HistoryView     : null,
  dealscan:    typeof DealScanView    !== "undefined" ? DealScanView    : null,
  competition: typeof CompetitionView !== "undefined" ? CompetitionView : null,
  repricer:    typeof RepricerView    !== "undefined" ? RepricerView    : null,
  alerts:      typeof AlertsView      !== "undefined" ? AlertsView      : null,
  marketplace: typeof MarketplaceView !== "undefined" ? MarketplaceView : null,
  sales:       typeof SalesView       !== "undefined" ? SalesView       : null,
  settings:    typeof SettingsView    !== "undefined" ? SettingsView    : null,
};

/**
 * Navigate to a named view, unmounting the previous one.
 * Updates the URL hash, nav active state, and page title.
 * Increments `App._navId` so async view mounts can detect stale renders.
 *
 * @param {string} viewKey - Key from VIEW_MAP / VIEW_TITLES (e.g. "flipcheck", "inventory")
 */
function navigateTo(viewKey) {
  const viewRoot = document.getElementById("view-root");
  const pageTitle = document.getElementById("page-title");
  if (!viewRoot) return;

  // Increment nav ID — async mounts can check if they're still current
  const navId = ++App._navId;

  // Update nav active state
  document.querySelectorAll(".nav-item[data-view]").forEach(el => {
    el.classList.toggle("active", /** @type {HTMLElement} */ (el).dataset.view === viewKey);
  });

  // Update page title
  if (pageTitle) pageTitle.textContent = VIEW_TITLES[viewKey] || viewKey;

  // Unmount current view
  if (App.currentView) {
    try { App.viewInstances[App.currentView]?.unmount?.(); } catch {}
  }

  // Mount new view
  viewRoot.innerHTML = "";
  const viewContainer = document.createElement("div");
  viewContainer.className = "view-enter";
  viewRoot.appendChild(viewContainer);

  App.currentView = viewKey;

  const ViewClass = VIEW_MAP[viewKey];
  if (ViewClass?.mount) {
    try {
      App.viewInstances[viewKey] = ViewClass;
      // Pass navId so async views can bail if navigation changed
      ViewClass.mount(viewContainer, navId);
    } catch (e) {
      console.error(`[Router] Failed to mount view "${viewKey}":`, e);
      ErrorReporter.report(e, `mount:${viewKey}`);
      if (navId === App._navId) {
        viewContainer.innerHTML = `<div style="padding:32px">${renderErrorCard(
          "View konnte nicht geladen werden",
          e.message ? e.message.slice(0, 120) : "Unbekannter Fehler beim Initialisieren."
        )}</div>`;
      }
    }
  } else {
    viewContainer.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
        <p class="empty-title">View nicht gefunden</p>
        <p class="empty-sub">"${esc(viewKey)}" ist noch nicht implementiert.</p>
      </div>
    `;
  }

  window.location.hash = viewKey;
}

// ─── Backend Status ───────────────────────────────────────────────────────────

/** Poll `/health` and update the connection status pill in the header. @returns {Promise<void>} */
async function updateBackendStatus() {
  const pill = document.getElementById("backendStatus");
  if (!pill) return;
  try {
    const { ok } = await API.health();
    pill.className = `status-pill ${ok ? "ok" : "err"}`;
    const t1 = pill.querySelector(".status-text");
    if (t1) t1.textContent = ok ? "Online" : "Offline";
  } catch {
    pill.className = "status-pill err";
    const t2 = pill.querySelector(".status-text");
    if (t2) t2.textContent = "Offline";
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Check whether the user is authenticated and show/hide the auth gate accordingly.
 * In dev/local mode (`requireAuth === false`) always returns true without checking the token.
 * @returns {Promise<boolean>} true if the user is (or doesn't need to be) authenticated.
 */
async function checkAuth() {
  const gate = document.getElementById("auth-gate");
  const appEl = document.getElementById("app");

  // In dev/local mode: skip auth gate entirely
  let authRequired = true;
  try { authRequired = await window.fc.requireAuth(); } catch {}

  if (!authRequired) {
    if (gate) gate.style.display = "none";
    if (appEl) appEl.style.display = "flex";
    return true;
  }

  let token = null;
  try { token = await window.fc.getToken(); } catch {}

  if (!token) {
    if (gate) gate.style.display = "flex";
    if (appEl) appEl.style.display = "none";
    return false;
  }

  App.token = token;
  if (gate) gate.style.display = "none";
  if (appEl) appEl.style.display = "flex";
  return true;
}

/**
 * Force-show the auth gate (e.g. after logout or session expiry).
 * @param {string} [message] - Optional hint text shown below the login button.
 */
function showGate(message) {
  const gate = document.getElementById("auth-gate");
  const appEl = document.getElementById("app");
  const hint = document.getElementById("gateHint");
  App.token = null;
  // Stop background timers so they don't fire after logout
  clearInterval(App._statusInterval);
  clearInterval(App._alertsInterval);
  App._statusInterval = 0;
  App._alertsInterval = 0;
  if (gate) gate.style.display = "flex";
  if (appEl) appEl.style.display = "none";
  if (hint && message) hint.textContent = message;
}

/**
 * Bind buttons inside #license-gate and show the gate.
 * @param {HTMLElement} licGate
 */
function showLicenseGate(licGate) {
  if (!licGate) return;
  licGate.style.display = "flex";
  document.getElementById("app").style.display = "none";

  // Zugang läuft über die Mitgliedschaft — „Verwalten" öffnet die Seite im Browser.
  document.getElementById("btnLicenseManage")?.addEventListener("click", () => {
    try { window.fc?.openExternal?.("https://keterflips.de"); } catch {}
  });
  document.getElementById("btnLicenseLogout")?.addEventListener("click", () => {
    window.fc?.logout?.();
    showGate();
    licGate.style.display = "none";
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

/**
 * Show changelog modal for a downloaded update.
 * Fetches release notes from GitHub if not already provided by electron-updater.
 * @param {string} version
 * @param {string|null} releaseNotesRaw
 */
async function _showUpdateChangelog(version, releaseNotesRaw, alreadyInstalled = false) {
  let notes = "";
  let notesAreHtml = false; // electron-updater sends HTML; GitHub API sends Markdown

  // 1. Use what electron-updater already sent (may be HTML)
  if (releaseNotesRaw && typeof releaseNotesRaw === "string" && releaseNotesRaw.trim()) {
    notes = releaseNotesRaw.trim();
    notesAreHtml = /<[a-z][\s\S]*?>/i.test(notes); // detect HTML tags
  }

  // 2. Fall back to GitHub Releases API (returns raw Markdown in `body`)
  if (!notes) {
    try {
      const resp = await fetch(
        `https://api.github.com/repos/Fakeflip/flipcheck_app/releases/tags/v${version}`,
        { headers: { Accept: "application/vnd.github+json" } }
      );
      if (resp.ok) {
        const rel = await resp.json();
        notes = rel.body || "";
        notesAreHtml = false; // GitHub API body is always Markdown
      }
    } catch { /* offline — proceed without notes */ }
  }

  // Strip trivial placeholders like "<p>FLIPCHECK 2.0.6</p>" or just the version string
  const stripped = notes.replace(/<[^>]+>/g, "").trim();
  if (!stripped || /^flipcheck\s*\d/i.test(stripped) || stripped.length < 10) notes = "";

  let notesHtml;
  if (!notes) {
    notesHtml = `<span style='color:var(--text-muted)'>Keine Changelog-Informationen verfügbar.</span>`;
  } else if (notesAreHtml) {
    // Already valid HTML from electron-updater — render directly
    notesHtml = notes;
  } else {
    // Markdown from GitHub API → lightweight HTML conversion
    notesHtml = notes
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/^#{1,3} (.+)$/gm, `<strong style='color:var(--text-primary)'>$1</strong>`)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/^[-*] (.+)$/gm, "• $1")
      .replace(/\n/g, "<br>");
  }

  Modal.open({
    title: alreadyInstalled ? `✅ Flipcheck v${version}` : `🚀 Flipcheck v${version}`,
    body: `
      <div class="col gap-12">
        <p class="text-secondary text-sm">${alreadyInstalled
          ? `Flipcheck wurde erfolgreich auf v${version} aktualisiert.`
          : "Eine neue Version wurde heruntergeladen und ist bereit zum Installieren."
        }</p>
        <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--r);padding:14px 16px;font-size:12px;line-height:1.7;color:var(--text-secondary);max-height:260px;overflow-y:auto">
          ${notesHtml}
        </div>
        ${alreadyInstalled ? "" : `<p class="text-muted" style="font-size:11px">Die App wird nach der Installation neu gestartet.</p>`}
      </div>`,
    buttons: alreadyInstalled
      ? [{ label: "Super, danke! 🎉", variant: "btn-primary", value: true }]
      : [
          { label: "Später", variant: "btn-ghost", value: false },
          { label: "Jetzt installieren & neu starten", variant: "btn-primary", action: () => window.fc?.installUpdate?.() },
        ],
  });
}

/**
 * Application entry point — wires up event listeners, resolves config, checks auth.
 * Called once on `DOMContentLoaded`.
 * @returns {Promise<void>}
 */
async function boot() {
  Modal.init();

  // Setup logout button
  document.getElementById("btnLogout")?.addEventListener("click", async () => {
    const ok = await Modal.confirm("Ausloggen", "Möchtest du dich wirklich ausloggen?", { confirmLabel: "Ausloggen", danger: true });
    if (ok) {
      try { await window.fc.logout(); } catch {}
      showGate("Erfolgreich ausgeloggt.");
    }
  });

  // Login button (Discord — ausgeblendeter Alt-Weg)
  document.getElementById("btnLogin")?.addEventListener("click", () => {
    try { window.fc.login(); } catch {}
    const hint = document.getElementById("gateHint");
    if (hint) hint.textContent = "Browser geöffnet — bitte anmelden…";
  });

  // Key-Login (Flipcheck-Lizenz-Key) — der Hauptweg
  {
    const keyInput = /** @type {HTMLInputElement|null} */ (document.getElementById("keyInput"));
    const keyErr   = document.getElementById("keyError");
    const btnKey   = document.getElementById("btnKeyLogin");
    const showKeyErr = (m) => { if (keyErr) { keyErr.textContent = m; keyErr.style.display = ""; } };
    async function doKeyLogin() {
      const key = (keyInput?.value || "").trim().toUpperCase();
      if (keyErr) { keyErr.style.display = "none"; keyErr.textContent = ""; }
      if (!key || key.length < 10) { showKeyErr("Bitte gib deinen Lizenz-Key ein (FC-XXXX-XXXX-XXXX)."); return; }
      if (btnKey) { btnKey.disabled = true; btnKey.textContent = "Prüfe…"; }
      let res;
      try { res = await window.fc.loginKey(key); } catch { res = { ok: false, error: "network" }; }
      if (btnKey) { btnKey.disabled = false; btnKey.textContent = "Freischalten"; }
      if (res && res.ok && res.token) { completeLogin(res.token); return; }
      showKeyErr(
        res?.error === "inactive" ? "Dieser Zugang ist aktuell nicht aktiv." :
        res?.error === "invalid"  ? "Key ungültig – bitte prüfe deine Eingabe." :
        res?.error === "network"  ? "Keine Verbindung – bitte prüfe dein Internet." :
                                    "Login fehlgeschlagen – bitte versuch es erneut."
      );
    }
    btnKey?.addEventListener("click", doKeyLogin);
    keyInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doKeyLogin(); } });
  }

  // Listen for deep-link auth token (Discord flow → shared login handler)
  try {
    window.fc.onAuthToken((token) => { completeLogin(token); });
  } catch {}

  // Listen for eBay seller token received (after OAuth deep link) → refresh current view
  try {
    window.fc.onEbaySellerTokenReceived(() => {
      Toast.success("eBay verbunden", "Seller-Token erfolgreich empfangen");
      // Re-mount current view to refresh connection status
      if (App.currentView && App._views[App.currentView]?.unmount) {
        try { App._views[App.currentView].unmount(); } catch {}
      }
      const container = document.getElementById("main-content");
      if (container && App.currentView && App._views[App.currentView]?.mount) {
        App._views[App.currentView].mount(container);
      }
    });
  } catch {}

  // Backend unavailable banner (local/dev mode only — never fires in production)
  try {
    window.fc.onBackendUnavailable(() => {
      if (document.getElementById("__fc_offline_banner")) return; // already shown
      const banner = document.createElement("div");
      banner.id = "__fc_offline_banner";
      banner.style.cssText = [
        "position:fixed", "top:32px", "left:0", "right:0", "z-index:9999",
        "background:rgba(239,68,68,.10)", "border-bottom:1px solid rgba(239,68,68,.28)",
        "color:#EF4444", "font-size:12px", "font-weight:600",
        "padding:8px 16px", "display:flex", "align-items:center", "gap:8px",
      ].join(";");
      banner.innerHTML =
        `<svg width="14" height="14" viewBox="0 0 20 20" fill="none">` +
          `<path d="M10 2.5L18 17H2L10 2.5z" stroke="#EF4444" stroke-width="1.5" stroke-linejoin="round"/>` +
          `<path d="M10 8.5v3.5" stroke="#EF4444" stroke-width="1.5" stroke-linecap="round"/>` +
          `<circle cx="10" cy="14.5" r=".75" fill="#EF4444"/>` +
        `</svg>` +
        `<span>Backend nicht erreichbar — Flipcheck-Analyse nicht verfügbar. App neu starten.</span>` +
        `<button onclick="this.parentElement.remove()" style="margin-left:auto;background:none;border:none;color:#EF4444;cursor:pointer;font-size:16px;line-height:1;" aria-label="Schließen">✕</button>`;
      document.body.appendChild(banner);
      Toast.error("Backend nicht erreichbar", "Der lokale Flipcheck-Server konnte nicht gestartet werden.");
    });
  } catch {}

  // Nav click handlers
  document.querySelectorAll(".nav-item[data-view]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo(/** @type {HTMLElement} */ (el).dataset.view ?? "");
    });
  });

  // Tag platform on <html> for platform-specific CSS
  try {
    const plat = await window.fc.platform();
    if (plat) document.documentElement.dataset.platform = plat;
  } catch {}

  // Load backend base + settings in parallel (independent IPC calls)
  try {
    const [base, gate, settings] = await Promise.all([
      window.fc.backendBase().catch(() => null),
      window.fc.gateBase().catch(() => null),
      (/** @type {any} */ (Storage)).getSettings().catch(() => ({})),
    ]);
    if (base) App.backendBase = base;
    if (gate) App.gateBase = gate;
    App.settings = settings || {};
    // Apply saved language
    if (settings?.language && typeof I18N !== 'undefined') {
      I18N.setLang(settings.language, { save: false });
    }
    // Apply saved theme
    applyTheme(settings?.theme);
    // Listen for system theme changes
    window.matchMedia?.("(prefers-color-scheme: light)")?.addEventListener("change", () => {
      if (App.settings?.theme === "system") applyTheme("system");
    });
  } catch {}

  // Load version
  try {
    const v = await window.fc.version();
    const el = document.getElementById("appVersion");
    if (el && v) el.textContent = `v${v}`;
  } catch {}

  // Check auth
  const authed = await checkAuth();
  if (!authed) return;

  // Check min version — server can block outdated clients
  try {
    const { ok, data } = await API.health();
    if (ok && data?.min_version) {
      const cur = (v || "0.0.0").split(".").map(Number);
      const min = data.min_version.split(".").map(Number);
      const outdated = cur[0] < min[0] || (cur[0] === min[0] && cur[1] < min[1]) ||
                       (cur[0] === min[0] && cur[1] === min[1] && (cur[2] || 0) < min[2]);
      if (outdated) {
        const gate = document.getElementById("update-gate");
        const msg  = document.getElementById("updateGateMsg");
        if (msg) msg.textContent = `Version ${v} wird nicht mehr unterstützt. Starte die App neu — das Update wird automatisch installiert.`;
        if (gate) { gate.style.display = "flex"; }
        document.getElementById("app").style.display = "none";
        document.getElementById("btnUpdateRestart")?.addEventListener("click", () => window.fc?.relaunch?.());
        return;
      }
    }
  } catch {}

  // Check license — block entire app without active plan
  try {
    const { ok, data } = await API.call("/auth/me");
    if (ok && data && !data.license_ok) {
      showLicenseGate(document.getElementById("license-gate"));
      return;
    }
  } catch {}

  initApp();
}

/**
 * Shared post-login flow — used by both the key-login and the Discord deep-link.
 * Stores the token, hides the auth gate, enforces the license, then boots the app.
 * @param {string} token
 * @returns {Promise<void>}
 */
async function completeLogin(token) {
  App.token = token;
  const gate = document.getElementById("auth-gate");
  if (gate) gate.style.display = "none";
  // Check license before showing the app
  try {
    const { ok, data } = await API.call("/auth/me");
    if (ok && data && !data.license_ok) {
      showLicenseGate(document.getElementById("license-gate"));
      return;
    }
  } catch {}
  const appEl = document.getElementById("app");
  if (appEl) appEl.style.display = "flex";
  try { Toast.success("Angemeldet", "Willkommen bei Flipcheck!"); } catch {}
  initApp();
}

/**
 * Post-auth initialisation: onboarding check, initial view, polling timers.
 * Called after a successful `checkAuth()` or deep-link auth token arrival.
 * @returns {Promise<void>}
 */
async function initApp() {
  // ── Onboarding: show wizard on first run ──────────────────────────────────
  const settings = await (/** @type {any} */ (Storage)).getSettings();
  if (!settings.onboarding_done && typeof OnboardingWizard !== "undefined") {
    const firstEan = await OnboardingWizard.show();
    // Wizard saved settings (incl. onboarding_done: true) before resolving
    if (firstEan) {
      // User entered an EAN on the done screen → go straight to Flipcheck
      navigateTo("flipcheck");
      // Pre-fill the EAN input after the view has mounted (short delay)
      setTimeout(() => {
        const inp = /** @type {HTMLInputElement|null} */ (document.querySelector("#fcEan"));
        if (inp) { inp.value = firstEan; inp.dispatchEvent(new Event("input")); }
      }, 150);
    } else {
      navigateTo("flipcheck");
    }
  } else {
    // Normal start: restore last view from hash or default to Flipcheck
    const hash    = window.location.hash.replace("#", "");
    const initial = VIEW_MAP[hash] ? hash : "flipcheck";
    navigateTo(initial);
  }

  // Start backend status polling — store ID so logout can clear it
  updateBackendStatus();
  App._statusInterval = /** @type {number} */ (/** @type {unknown} */ (setInterval(updateBackendStatus, 15000)));

  // Populate topbar user pill with username
  try {
    const meRes = await API.call("/auth/me");
    const name = meRes.ok && meRes.data ? (meRes.data.username || meRes.data.discord_username || "") : "";
    if (name) {
      const pill = document.getElementById("userPill");
      const text = document.getElementById("userPillText");
      if (pill && text) { text.textContent = name; pill.style.display = ""; }
    }
  } catch {
    // JWT fallback
    try {
      const claims = JSON.parse(atob((App.token || "").split(".")[1]));
      const name = claims.discord_username || claims.sub || "";
      if (name) {
        const pill = document.getElementById("userPill");
        const text = document.getElementById("userPillText");
        if (pill && text) { text.textContent = name; pill.style.display = ""; }
      }
    } catch {}
  }

  // Fetch eBay seller username for own-listing highlight in competition view
  try {
    const syncStatus = await window.fc.ebaySyncStatus();
    if (syncStatus?.username) App._ebaySellerUsername = syncStatus.username;
  } catch {}

  // Start price alert background timer (every 15 minutes) — store ID for cleanup
  if (typeof runAlertChecks === "function") {
    // Initial check after 30s (give backend time to start)
    setTimeout(() => runAlertChecks(), 30_000);
    App._alertsInterval = /** @type {number} */ (/** @type {unknown} */ (setInterval(() => runAlertChecks(), 15 * 60 * 1000)));
  }

  // ── First-launch changelog — show once per app version on first boot ────────
  setTimeout(async () => {
    try {
      const currentVersion = await window.fc.version();
      const settings = await Storage.getSettings();
      if (currentVersion && currentVersion !== settings.lastChangelogVersion) {
        await Storage.saveSettings({ lastChangelogVersion: currentVersion });
        _showUpdateChangelog(currentVersion, null, true); // already installed — no install button
      }
    } catch { /* non-critical — skip silently */ }
  }, 1500);

  // ── Keyboard shortcuts — Cmd/Ctrl + 1-9 for view navigation ─────────────────
  document.addEventListener("keydown", (e) => {
    // Skip if user is typing in an input/textarea/select
    const tag = /** @type {HTMLElement} */ (e.target)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    // Skip if modal is open
    if (document.getElementById("modal-overlay")?.style.display !== "none") return;

    const isMod = navigator.platform?.includes("Mac") ? e.metaKey : e.ctrlKey;
    if (!isMod || e.shiftKey || e.altKey) return;

    const viewShortcuts = {
      "1": "flipcheck",
      "2": "competition",
      "3": "marketplace",
      "4": "settings",
    };
    const view = viewShortcuts[e.key];
    if (view && VIEW_MAP[view]) {
      e.preventDefault();
      navigateTo(view);
    }
  });

  // ── Deep-link check handler — navigate to Flipcheck + auto-run ───────────────
  if (window.fc?.onCheckLink) {
    window.fc.onCheckLink((p) => {
      App._navPayload = p; // { ean, ek, market, cat, autoRun: true }
      navigateTo("flipcheck");
    });
  }

  // ── Sync Status helpers ───────────────────────────────────────────────────
  function _syncSetState(platform, state, timeStr) {
    // state: "syncing" | "ok" | "error" | "idle"
    const dot  = document.getElementById(`syncDot${platform}`);
    const time = document.getElementById(`syncTime${platform}`);
    if (dot)  { dot.className = "sync-dot" + (state !== "idle" ? " " + state : ""); }
    if (time) { time.textContent = timeStr || "—"; }
  }

  function _syncRelativeTime(isoStr) {
    if (!isoStr) return "—";
    const diffMs  = Date.now() - new Date(isoStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1)   return "gerade eben";
    if (diffMin < 60)  return `vor ${diffMin} Min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24)    return `vor ${diffH} Std`;
    return `vor ${Math.floor(diffH / 24)} Tag${Math.floor(diffH / 24) > 1 ? "en" : ""}`;
  }

  // Initialise from last sync times stored in settings
  window.fc?.ebaySyncStatus?.().then(s => {
    if (s?.last_sync_at) _syncSetState("Ebay", "ok", _syncRelativeTime(s.last_sync_at));
  }).catch(() => {});
  window.fc?.kauflandSyncStatus?.().then(s => {
    if (s?.last_sync_at) _syncSetState("Kaufland", "ok", _syncRelativeTime(s.last_sync_at));
  }).catch(() => {});

  // ── eBay Sync events ──────────────────────────────────────────────────────
  if (window.fc?.onEbaySyncStarted) {
    window.fc.onEbaySyncStarted(() => _syncSetState("Ebay", "syncing", "läuft…"));
  }
  if (window.fc?.onEbaySyncCompleted) {
    window.fc.onEbaySyncCompleted((stats) => {
      _syncSetState("Ebay", "ok", "gerade eben");
      if (typeof Toast === "undefined") return;
      const parts = [];
      if (stats.new_items)         parts.push(`${stats.new_items} neu`);
      if (stats.updated)           parts.push(`${stats.updated} aktualisiert`);
      if (stats.sold_marked)       parts.push(`${stats.sold_marked} verkauft`);
      if (stats.returns_detected)  parts.push(`${stats.returns_detected} Retoure${stats.returns_detected > 1 ? "n" : ""}`);
      if (stats.archived)          parts.push(`${stats.archived} archiviert`);
      const msg = parts.length > 0 ? parts.join(" · ") : "Keine Änderungen";
      Toast.success("eBay Sync", msg);
    });
  }
  if (window.fc?.onEbaySyncError) {
    window.fc.onEbaySyncError((info) => {
      _syncSetState("Ebay", "error", "Fehler");
      const errMsg = info?.error || "Unbekannter Fehler";
      if (typeof Toast !== "undefined") Toast.error("eBay Sync fehlgeschlagen", errMsg);
      window.fc?.notify?.("eBay Sync fehlgeschlagen", errMsg);
    });
  }

  // ── Kaufland Sync events ──────────────────────────────────────────────────
  if (window.fc?.onKauflandSyncStarted) {
    window.fc.onKauflandSyncStarted(() => _syncSetState("Kaufland", "syncing", "läuft…"));
  }
  if (window.fc?.onKauflandSyncCompleted) {
    window.fc.onKauflandSyncCompleted((stats) => {
      _syncSetState("Kaufland", "ok", "gerade eben");
    });
  }
  if (window.fc?.onKauflandSyncError) {
    window.fc.onKauflandSyncError((info) => {
      _syncSetState("Kaufland", "error", "Fehler");
      const errMsg = info?.error || "Unbekannter Fehler";
      window.fc?.notify?.("Kaufland Sync fehlgeschlagen", errMsg);
    });
  }

  // ── Global auto-update listeners — shown immediately, no matter which view is active
  if (window.fc?.onUpdateAvailable) {
    window.fc.onUpdateAvailable((info) => {
      const bar  = document.getElementById("update-bar");
      const text = document.getElementById("updateBarText");
      if (bar && text) {
        text.textContent = `⬇ Update v${info?.version || "?"} wird heruntergeladen…`;
        bar.classList.add("visible");
      }
    });
    window.fc.onUpdateDownloaded(async (info) => {
      const version = info?.version || "?";

      // ── Show update banner ────────────────────────────────────────────
      const bar  = document.getElementById("update-bar");
      const text = document.getElementById("updateBarText");
      const btn  = document.getElementById("btnInstallUpdate");
      if (bar && text) {
        text.textContent = `🚀 Update v${version} bereit`;
        bar.classList.add("visible", "ready");
      }
      if (btn) {
        btn.style.display = "flex";
        btn.onclick = () => _showUpdateChangelog(version, info?.releaseNotes);
      }

      // ── Auto-show changelog modal ─────────────────────────────────────
      _showUpdateChangelog(version, info?.releaseNotes);
    });
  }
}

// ─── Theme ───────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  let effective = theme || "dark";
  if (effective === "system") {
    effective = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.dataset.theme = effective === "light" ? "light" : "";
  // Remove attribute entirely for dark (default)
  if (effective !== "light") document.documentElement.removeAttribute("data-theme");
}

// ─── Global Error Handlers ────────────────────────────────────────────────────
window.addEventListener("unhandledrejection", (e) => {
  const err = e.reason instanceof Error ? e.reason : new Error(String(e.reason ?? "Unhandled rejection"));
  // Skip AbortError (user-triggered cancellations) and plain fetch failures (handled per-view)
  if (err.name === "AbortError") return;
  ErrorReporter.report(err, "unhandledrejection");
  // Only surface a toast for non-network errors to avoid double-messaging
  const msg = err.message || "";
  if (!msg.includes("fetch") && !msg.includes("NetworkError") && !msg.includes("Failed to fetch")) {
    const { title, sub } = friendlyError(err);
    Toast.error(title, sub, 6000);
  }
});

window.addEventListener("error", (e) => {
  if (!e.error) return;
  ErrorReporter.report(e.error, `${e.filename || "?"}:${e.lineno || "?"}`);
});

// ─── Error utilities ──────────────────────────────────────────────────────────

/**
 * Map a raw error to a user-friendly German title + subtitle pair.
 * Recognises common HTTP status codes, network errors, and auth failures.
 *
 * @param {Error|string|unknown} err
 * @returns {{ title: string, sub: string }}
 */
function friendlyError(err) {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("backend nicht erreichbar") || msg.includes("load failed")) {
    return { title: "Verbindungsfehler", sub: "Backend nicht erreichbar. Stelle sicher, dass Flipcheck läuft." };
  }
  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("token")) {
    return { title: "Sitzung abgelaufen", sub: "Bitte neu einloggen." };
  }
  if (msg.includes("403") || msg.includes("forbidden")) {
    return { title: "Keine Berechtigung", sub: "Dein Plan hat keinen Zugriff auf diese Funktion." };
  }
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many")) {
    return { title: "Limit erreicht", sub: "Zu viele Anfragen — bitte kurz warten." };
  }
  if (msg.includes("500") || msg.includes("internal server")) {
    return { title: "Serverfehler", sub: "Das Backend hat einen Fehler zurückgegeben. Bitte erneut versuchen." };
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return { title: "Zeitüberschreitung", sub: "Die Anfrage hat zu lange gedauert. Bitte erneut versuchen." };
  }
  const rawMsg = (err instanceof Error ? err.message : String(err ?? "")).slice(0, 100);
  return { title: "Fehler", sub: rawMsg || "Ein unbekannter Fehler ist aufgetreten." };
}

/**
 * Render a consistent error card HTML string for inline display inside a view container.
 *
 * @param {string} title  - Bold error headline
 * @param {string} sub    - Descriptive sentence (detail / hint)
 * @param {{ retryLabel?: string, retryId?: string|null }} [opts]
 *   retryId: if provided, renders a retry button with this DOM id so callers can bind a click handler.
 * @returns {string} HTML string
 */
function renderErrorCard(title, sub, { retryLabel = "Erneut versuchen", retryId = null } = {}) {
  return `
    <div class="err-card">
      <div class="err-card-icon">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path d="M10 2.5L18 17H2L10 2.5z" stroke="var(--red)" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M10 8.5v3.5" stroke="var(--red)" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="10" cy="14.5" r=".75" fill="var(--red)"/>
        </svg>
      </div>
      <div class="err-card-body">
        <div class="err-card-title">${esc(title)}</div>
        <div class="err-card-sub">${esc(sub)}</div>
      </div>
      ${retryId ? `<button class="btn btn-secondary btn-sm err-card-retry" id="${retryId}">${esc(retryLabel)}</button>` : ""}
    </div>
  `;
}

// ─── Start ────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", boot);
