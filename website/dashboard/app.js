// @ts-check
/* Flipcheck Dashboard — Auth + API Client + Router */
"use strict";

const BACKEND      = "https://gate.joinflipcheck.app";
const DASHBOARD_URL = "https://joinflipcheck.app/dashboard";

// ── Auth ───────────────────────────────────────────────────────────────────
const Auth = {
  getToken() { return localStorage.getItem("fc_web_token"); },
  setToken(t) { localStorage.setItem("fc_web_token", t); },
  clear()    { localStorage.removeItem("fc_web_token"); },
  login()    { location.href = BACKEND + "/auth/web/login?return_url=" + encodeURIComponent(DASHBOARD_URL); },

  /** Decode JWT payload (no signature verification — server handles that). */
  getPayload() {
    const t = this.getToken();
    if (!t) return null;
    try {
      return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    } catch { return null; }
  },

  isLoggedIn() { return !!this.getToken(); },

  /** Pick up token from URL hash after Discord OAuth redirect. */
  init() {
    const p = new URLSearchParams(location.hash.slice(1));
    const tok = p.get("token");
    if (tok) {
      this.setToken(tok);
      history.replaceState(null, "", location.pathname);
    }
  },
};

// ── API Client ─────────────────────────────────────────────────────────────
const API = {
  async call(path, opts = {}) {
    const r = await fetch(BACKEND + path, {
      ...opts,
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${Auth.getToken()}`,
        ...(opts.headers || {}),
      },
    });
    if (r.status === 401) {
      Auth.clear();
      App.showLogin();
      return null;
    }
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body?.detail || `HTTP ${r.status}`);
    }
    // 204 No Content (DELETE etc.)
    if (r.status === 204) return { ok: true };
    return r.json();
  },

  flipcheck: (ean, ek, mode, extra = {}) =>
    API.call("/flipcheck", {
      method: "POST",
      body:   JSON.stringify({ ean, ek, mode, ...extra }),
    }),

  amazonCheck: (asin, ean, ek, mode, method, extra = {}) =>
    API.call("/amazon-check", {
      method: "POST",
      body:   JSON.stringify({ asin, ean, ek, mode, method, ...extra }),
    }),
};

// ── Utility globals (mirrors v2/assets/app.js) ────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function fmtEur(v) {
  if (v == null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2).replace(".", ",") + " €";
}

function fmtEurPlain(v) {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(2).replace(".", ",") + " €";
}

function fmtPct(v) {
  if (v == null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(1) + " %";
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return iso; }
}

// ── eBay fee calc (mirrors v2) ────────────────────────────────────────────
const EBAY_FEE_CATEGORIES = [
  { id:"computer_tablets",  tiers:[[990,0.065],[null,0.03]] },
  { id:"drucker",           tiers:[[990,0.065],[null,0.03]] },
  { id:"foto_camcorder",    tiers:[[990,0.065],[null,0.03]] },
  { id:"handys",            tiers:[[990,0.065],[null,0.03]] },
  { id:"haushaltsgeraete",  tiers:[[990,0.065],[null,0.03]] },
  { id:"konsolen",          tiers:[[990,0.065],[null,0.03]] },
  { id:"scanner",           tiers:[[990,0.065],[null,0.03]] },
  { id:"speicherkarten",    tiers:[[990,0.065],[null,0.03]] },
  { id:"tv_video_audio",    tiers:[[990,0.065],[null,0.03]] },
  { id:"koerperpflege",     tiers:[[990,0.065],[null,0.03]] },
  { id:"drucker_zubehoer",  tiers:[[990,0.11],[null,0.03]]  },
  { id:"handy_zubehoer",    tiers:[[990,0.11],[null,0.03]]  },
  { id:"batterien",         tiers:[[990,0.11],[null,0.03]]  },
  { id:"kabel",             tiers:[[990,0.11],[null,0.03]]  },
  { id:"kameras_zubehoer",  tiers:[[990,0.11],[null,0.03]]  },
  { id:"notebook_zubehoer", tiers:[[990,0.11],[null,0.03]]  },
  { id:"objektive",         tiers:[[990,0.11],[null,0.03]]  },
  { id:"stative",           tiers:[[990,0.11],[null,0.03]]  },
  { id:"tablet_zubehoer",   tiers:[[990,0.11],[null,0.03]]  },
  { id:"tastaturen_maeuse", tiers:[[990,0.11],[null,0.03]]  },
  { id:"tv_zubehoer",       tiers:[[990,0.11],[null,0.03]]  },
  { id:"pc_zubehoer",       tiers:[[990,0.11],[null,0.03]]  },
  { id:"audio_zubehoer",    tiers:[[990,0.11],[null,0.03]]  },
  { id:"mode",              tiers:[[null,0.15]]              },
  { id:"sport_freizeit",    tiers:[[null,0.115]]             },
  { id:"spielzeug",         tiers:[[null,0.115]]             },
  { id:"haushalt_garten",   tiers:[[null,0.115]]             },
  { id:"buecher",           tiers:[[null,0.15]]              },
  { id:"sonstiges",         tiers:[[null,0.13]]              },
];

function calcEbayFee(priceGross, catId) {
  const cat = EBAY_FEE_CATEGORIES.find(c => c.id === catId) || EBAY_FEE_CATEGORIES.find(c => c.id === "sonstiges");
  if (!cat) return priceGross * 0.13;
  let fee = 0;
  let remaining = priceGross;
  for (const [threshold, rate] of cat.tiers) {
    if (threshold === null) { fee += remaining * rate; break; }
    const taxable = Math.min(remaining, threshold);
    fee += taxable * rate;
    remaining -= taxable;
    if (remaining <= 0) break;
  }
  return fee;
}

function calcRealProfit(item) {
  if (!item?.sell_price || !item?.ek) return null;
  const vk     = item.sell_price;
  const ek     = item.ek;
  const shipOut= item.ship_out || 0;
  const catId  = item.category || "sonstiges";
  const fee    = calcEbayFee(vk, catId);
  return vk - ek - shipOut - fee;
}

// ── Router ─────────────────────────────────────────────────────────────────
// ── Market fee helper (used by Sales, Batch etc.) ──────────────────────
function calcMarketFee(vk, market, catId) {
  if (market === "ebay" || !market) return calcEbayFee(vk, catId || "sonstiges");
  const FLAT = { amz: 0.15, kaufland: 0.105, other: 0 };
  return vk * (FLAT[market] || 0);
}

const VIEWS = {
  flipcheck:   () => FlipcheckView,
  batch:       () => BatchView,
  marketplace: () => MarketplaceView,
  sales:       () => SalesView,
  inventory:   () => InventoryView,
  analytics:   () => AnalyticsView,
  history:     () => HistoryView,
  alerts:      () => AlertsView,
  repricer:    () => RepricerView,
  competition: () => CompetitionView,
  settings:    () => SettingsView,
};

// ── API helpers ────────────────────────────────────────────────────────────
async function createCheckoutSession(trialDays = 0) {
  return API.call("/create-checkout-session", {
    method: "POST",
    body:   JSON.stringify({ trial_days: trialDays }),
  });
}

function showLicenseGate() {
  document.getElementById("login-screen").style.display  = "none";
  document.getElementById("app-shell").style.display     = "none";
  document.getElementById("license-gate").style.display  = "flex";

  const arrowSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;

  async function handleCheckout(btn, trialDays, resetLabel) {
    if (!btn) return;
    btn.disabled = true; btn.textContent = "Lade…";
    try {
      const data = await createCheckoutSession(trialDays);
      if (data?.checkout_url) {
        // Use location.href — window.open is blocked on iOS Safari
        // because the async gap breaks the user-gesture chain.
        window.location.href = data.checkout_url;
        return;
      }
      Toast.error("Fehler", "Checkout konnte nicht geöffnet werden.");
    } catch { Toast.error("Fehler", "Verbindung fehlgeschlagen."); }
    btn.disabled = false; btn.innerHTML = resetLabel + " " + arrowSvg;
  }

  document.getElementById("btnLicenseTrial")?.addEventListener("click", () =>
    handleCheckout(document.getElementById("btnLicenseTrial"), 7, "7 Tage kostenlos testen"));
  document.getElementById("btnLicenseUpgrade")?.addEventListener("click", () =>
    handleCheckout(document.getElementById("btnLicenseUpgrade"), 0, "Direkt kaufen"));
  document.getElementById("btnLicenseLogout")?.addEventListener("click", () => {
    Auth.clear();
    document.getElementById("license-gate").style.display = "none";
    document.getElementById("login-screen").style.display = "flex";
  });
}

const App = {
  _navId:      0,
  _navPayload: null,
  _currentView: null,
  _currentId:   null,

  async init() {
    Auth.init();
    if (!Auth.isLoggedIn()) {
      this.showLogin();
      return;
    }
    // Verify token + check license
    try {
      const me = await API.call("/auth/me");
      if (!me) return; // 401 → showLogin() already called
      this._me = me;
      if (!me.license_ok) {
        showLicenseGate();
        return;
      }
    } catch {
      // continue even if /auth/me fails (network issue etc.)
    }
    this.showApp();
    this.bindNav();
    this.navigateTo("flipcheck");
  },

  showLogin() {
    document.getElementById("login-screen").style.display = "flex";
    document.getElementById("app-shell").style.display    = "none";
    document.getElementById("license-gate").style.display = "none";
  },

  showApp() {
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app-shell").style.display    = "flex";
    document.getElementById("license-gate").style.display = "none";
  },

  bindNav() {
    document.querySelectorAll("[data-nav]").forEach(btn => {
      btn.addEventListener("click", () => this.navigateTo(btn.dataset.nav));
    });
  },

  async navigateTo(viewId, payload = null) {
    const navId = ++this._navId;
    this._navPayload = payload;

    // Update active state on nav buttons
    document.querySelectorAll("[data-nav]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.nav === viewId);
    });

    // Unmount previous view if it has an unmount method
    if (this._currentView?.unmount) this._currentView.unmount();

    const container = document.getElementById("app");
    container.innerHTML = `<div class="view-loading"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" class="spin"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="28" stroke-dashoffset="10" stroke-linecap="round"/></svg></div>`;

    const viewFactory = VIEWS[viewId];
    if (!viewFactory) { container.innerHTML = "<p>View not found</p>"; return; }

    const view = viewFactory();
    this._currentView = view;
    this._currentId   = viewId;

    await view.mount(container, navId);
  },
};

// ── Boot ───────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => App.init());
