// @ts-check
/* Flipcheck v2 — App Router & API Client */

// ─── Global state ─────────────────────────────────────────────────────────────

/**
 * Global application state — shared across all views.
 * @type {{
 *   token:            string|null,
 *   backendBase:      string|null,
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
  settings: {},
  currentView: null,
  viewInstances: {},
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
  { id: "computer_tablets",  label: "Computer, Tablets & Netzwerk",         tiers: [[990, 0.065], [null, 0.03]] },
  { id: "drucker",           label: "Drucker",                               tiers: [[990, 0.065], [null, 0.03]] },
  { id: "foto_camcorder",    label: "Foto & Camcorder",                      tiers: [[990, 0.065], [null, 0.03]] },
  { id: "handys",            label: "Handys & Kommunikation",                tiers: [[990, 0.065], [null, 0.03]] },
  { id: "haushaltsgeraete",  label: "Haushaltsgeräte",                       tiers: [[990, 0.065], [null, 0.03]] },
  { id: "konsolen",          label: "Konsolen / Videospiele",                tiers: [[990, 0.065], [null, 0.03]] },
  { id: "scanner",           label: "Scanner",                               tiers: [[990, 0.065], [null, 0.03]] },
  { id: "speicherkarten",    label: "Speicherkarten",                        tiers: [[990, 0.065], [null, 0.03]] },
  { id: "tv_video_audio",    label: "TV, Video & Audio",                     tiers: [[990, 0.065], [null, 0.03]] },
  { id: "koerperpflege",     label: "Elektr. Körperpflege & Styling",        tiers: [[990, 0.065], [null, 0.03]] },
  { id: "drucker_zubehoer",  label: "Drucker- & Scanner-Zubehör",           tiers: [[990, 0.11],  [null, 0.03]] },
  { id: "handy_zubehoer",    label: "Handy-Zubehör",                         tiers: [[990, 0.11],  [null, 0.03]] },
  { id: "batterien",         label: "Haushaltsbatterien & Strom",            tiers: [[990, 0.11],  [null, 0.03]] },
  { id: "kabel",             label: "Kabel & Steckverbinder",                tiers: [[990, 0.11],  [null, 0.03]] },
  { id: "kameras_zubehoer",  label: "Kameras, Drohnen & Fotozubehör",       tiers: [[990, 0.11],  [null, 0.03]] },
  { id: "notebook_zubehoer", label: "Notebook- & Desktop-Zubehör",          tiers: [[990, 0.11],  [null, 0.03]] },
  { id: "objektive",         label: "Objektive & Filter",                    tiers: [[990, 0.11],  [null, 0.03]] },
  { id: "stative",           label: "Stative & Zubehör",                    tiers: [[990, 0.11],  [null, 0.03]] },
  { id: "tablet_zubehoer",   label: "Tablet & eBook Zubehör",               tiers: [[990, 0.11],  [null, 0.03]] },
  { id: "tastaturen_maeuse", label: "Tastaturen, Mäuse & Pointing",          tiers: [[990, 0.11],  [null, 0.03]] },
  { id: "tv_zubehoer",       label: "TV- & Heim-Audio-Zubehör",             tiers: [[990, 0.11],  [null, 0.03]] },
  { id: "pc_zubehoer",       label: "PC & Videospiele Zubehör",             tiers: [[990, 0.11],  [null, 0.03]] },
  { id: "audio_zubehoer",    label: "Zubehör Audiogeräte",                  tiers: [[990, 0.11],  [null, 0.03]] },
  { id: "mode",              label: "Mode / Bekleidung",                     tiers: [[null, 0.15]]  },
  { id: "sport_freizeit",    label: "Sport & Freizeit",                      tiers: [[null, 0.115]] },
  { id: "spielzeug",         label: "Spielzeug / LEGO",                      tiers: [[null, 0.115]] },
  { id: "haushalt_garten",   label: "Haushalt & Garten",                     tiers: [[null, 0.115]] },
  { id: "buecher",           label: "Bücher & Medien",                       tiers: [[null, 0.15]]  },
  { id: "sonstiges",         label: "Sonstiges",                             tiers: [[null, 0.13]]  },
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
 * Market-specific flat fee rates for Amazon and Kaufland.
 * eBay uses the tiered calcEbayFee() instead.
 * @type {Record<string, number>}
 */
const MARKET_FEE_RATES = {
  amz:      0.15,   // Amazon: ~15% referral fee (varies by category, 15% is conservative)
  kaufland: 0.105,  // Kaufland: ~10.5% seller commission
  other:    0,
};

/**
 * Calculate the real per-unit profit for one inventory item.
 * - eBay: uses tiered calcEbayFee() (category-aware)
 * - Amazon: 15% flat referral fee
 * - Kaufland: 10.5% flat commission
 * - other: no fee
 * Returns null if sell_price or ek are missing.
 *
 * @param {FC_InventoryItem} item
 * @returns {number|null} Per-unit profit in EUR, or null if data is incomplete.
 */
function calcRealProfit(item) {
  if (!item || item.sell_price == null || item.ek == null) return null;
  const vk      = Number(item.sell_price) || 0;
  const ek      = Number(item.ek)         || 0;
  const shipOut = Number(item.ship_out)   || 0;
  const market  = item.market || "ebay";
  let fee = 0;
  if (market === "ebay") {
    fee = calcEbayFee(vk, item.cat_id || "sonstiges");
  } else {
    fee = vk * (MARKET_FEE_RATES[market] ?? 0);
  }
  return vk - ek - shipOut - fee;
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
  async call(path, { method = "GET", body = null } = {}) {
    const base = App.backendBase || "http://127.0.0.1:9000";
    /** @type {Record<string, string>} */
    const headers = { "Content-Type": "application/json" };
    if (App.token) headers["Authorization"] = `Bearer ${App.token}`;

    /** @type {Record<string, unknown>} */
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

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
  async flipcheck(ean, ek, mode = "mid", extra = {}) {
    return this.call("/flipcheck", { method: "POST", body: { ean, ek, mode, ...extra } });
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
  async amazonCheck(asin, ean, ek, mode = "mid", method = "fba", shipIn = 4.99, category = "sonstiges", prepFee = 0) {
    return this.call("/amazon-check", {
      method: "POST",
      body: { asin, ean, ek, mode, method, ship_in: shipIn, category, prep_fee: prepFee },
    });
  },

  /** @returns {Promise<FC_ApiResponse>} */
  async health() {
    return this.call("/health");
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
    return this.call(`/seller/listings?${p}`);
  },

  /**
   * @param {string} ean
   * @param {number} [limit]
   * @returns {Promise<FC_ApiResponse>}
   */
  async eanCompetition(ean, limit = 50) {
    return this.call(`/ean/competition?ean=${encodeURIComponent(ean)}&limit=${limit}`);
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

// ─── Boot ─────────────────────────────────────────────────────────────────────

/**
 * Show changelog modal for a downloaded update.
 * Fetches release notes from GitHub if not already provided by electron-updater.
 * @param {string} version
 * @param {string|null} releaseNotesRaw
 */
async function _showUpdateChangelog(version, releaseNotesRaw) {
  let notes = "";

  // Try to use what electron-updater already sent
  if (releaseNotesRaw && typeof releaseNotesRaw === "string" && releaseNotesRaw.trim()) {
    notes = releaseNotesRaw.trim();
  } else {
    // Fetch from GitHub Releases API (repo is public)
    try {
      const resp = await fetch(
        `https://api.github.com/repos/Fakeflip/flipcheck_app/releases/tags/v${version}`,
        { headers: { Accept: "application/vnd.github+json" } }
      );
      if (resp.ok) {
        const rel = await resp.json();
        notes = rel.body || "";
      }
    } catch { /* offline — proceed without notes */ }
  }

  // Convert Markdown-ish plain text to simple HTML for display
  const notesHtml = notes
    ? notes
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/^#{1,3} (.+)$/gm, "<strong style='color:var(--text-primary)'>$1</strong>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/^[-*] (.+)$/gm, "• $1")
        .replace(/\n/g, "<br>")
    : "<span style='color:var(--text-muted)'>Keine Changelog-Informationen verfügbar.</span>";

  Modal.open({
    title: `🚀 Flipcheck v${version}`,
    body: `
      <div class="col gap-12">
        <p class="text-secondary text-sm">Eine neue Version wurde heruntergeladen und ist bereit zum Installieren.</p>
        <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--r);padding:14px 16px;font-size:12px;line-height:1.7;color:var(--text-secondary);max-height:260px;overflow-y:auto">
          ${notesHtml}
        </div>
        <p class="text-muted" style="font-size:11px">Die App wird nach der Installation neu gestartet.</p>
      </div>`,
    buttons: [
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

  // Login button
  document.getElementById("btnLogin")?.addEventListener("click", () => {
    try { window.fc.login(); } catch {}
    const hint = document.getElementById("gateHint");
    if (hint) hint.textContent = "Browser geöffnet — bitte anmelden…";
  });

  // Listen for deep-link auth token
  try {
    window.fc.onAuthToken(async (token) => {
      App.token = token;
      const gate = document.getElementById("auth-gate");
      const appEl = document.getElementById("app");
      if (gate) gate.style.display = "none";
      if (appEl) appEl.style.display = "flex";
      Toast.success("Angemeldet", "Willkommen bei Flipcheck!");
      initApp();
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
    const [base, settings] = await Promise.all([
      window.fc.backendBase().catch(() => null),
      (/** @type {any} */ (Storage)).getSettings().catch(() => ({})),
    ]);
    if (base) App.backendBase = base;
    App.settings = settings || {};
  } catch {}

  // Load version
  try {
    const v = await window.fc.version();
    const el = document.getElementById("appVersion");
    if (el && v) el.textContent = `v${v}`;
  } catch {}

  // Check auth
  const authed = await checkAuth();
  if (authed) initApp();
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
      navigateTo("analytics");
    }
  } else {
    // Normal start: restore last view from hash or default to analytics
    const hash    = window.location.hash.replace("#", "");
    const initial = VIEW_MAP[hash] ? hash : "analytics";
    navigateTo(initial);
  }

  // Start backend status polling — store ID so logout can clear it
  updateBackendStatus();
  App._statusInterval = /** @type {number} */ (/** @type {unknown} */ (setInterval(updateBackendStatus, 15000)));

  // Start price alert background timer (every 15 minutes) — store ID for cleanup
  if (typeof runAlertChecks === "function") {
    // Initial check after 30s (give backend time to start)
    setTimeout(() => runAlertChecks(), 30_000);
    App._alertsInterval = /** @type {number} */ (/** @type {unknown} */ (setInterval(() => runAlertChecks(), 15 * 60 * 1000)));
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
