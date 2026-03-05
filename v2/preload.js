// @ts-check
/* Flipcheck v2 — Electron contextBridge preload
 *
 * Exposes `window.fc` to the renderer process.
 * All calls proxy through ipcRenderer.invoke() to the main-process IPC handlers.
 *
 * Type annotation here is the SINGLE SOURCE OF TRUTH for what `window.fc` provides.
 * The global augmentation below gives every renderer file full intellisense on `window.fc`.
 */

const { contextBridge, ipcRenderer } = require("electron");
const os     = require("os");
const crypto = require("crypto");

/**
 * @returns {string} SHA-256 hex fingerprint of the current machine.
 */
function deviceFingerprint() {
  const raw = [os.hostname(), os.userInfo().username, os.platform(), os.arch()].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// Scanner IPC listener map — needed for proper removeListener with wrapped functions.
/** @type {Map<Function, Function>} */
const _scannerListeners = new Map();

/**
 * The full `window.fc` API surface exposed to the renderer.
 *
 * ┌─ Config ──────────────────────────────────────────────────────────────────┐
 * │ backendBase()  → Promise<string>   Base URL of the Flipcheck backend      │
 * │ mode()         → Promise<string>   "local" | "remote"                     │
 * │ version()      → Promise<string>   App version string, e.g. "2.1.0"      │
 * │ requireAuth()  → Promise<boolean>  false in dev/local mode                │
 * ├─ Auth ─────────────────────────────────────────────────────────────────────┤
 * │ getToken()     → Promise<string|null>                                     │
 * │ login()        → void   Opens Discord OAuth in the system browser         │
 * │ logout()       → Promise<{ok:boolean}>                                    │
 * │ onAuthToken(fn) → void  Fires fn(token) on deep-link token arrival        │
 * ├─ Settings ──────────────────────────────────────────────────────────────── │
 * │ getSettings()  → Promise<FC_Settings>                                     │
 * │ setSettings(d) → Promise<FC_Settings>                                     │
 * ├─ Inventory ─────────────────────────────────────────────────────────────── │
 * │ inventoryList()                  → Promise<FC_InventoryItem[]>            │
 * │ inventoryUpsert(item)            → Promise<FC_InventoryItem>              │
 * │ inventoryDelete(id)              → Promise<{ok:boolean}>                  │
 * │ inventoryBulkUpdate(ids, patch)  → Promise<{ok:boolean,count:number}>     │
 * │ inventoryClear()                 → Promise<{ok:boolean}>                  │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
contextBridge.exposeInMainWorld("fc", {
  // ── Config ────────────────────────────────────────────────────────────────

  /** @returns {Promise<string>} */
  backendBase: () => ipcRenderer.invoke("cfg:backendBase"),
  /** @returns {Promise<string>} */
  mode:        () => ipcRenderer.invoke("cfg:mode"),
  /** @returns {Promise<string>} */
  version:     () => ipcRenderer.invoke("cfg:version"),
  /** @returns {Promise<boolean>} false in dev/local mode — auth gate is skipped */
  requireAuth: () => ipcRenderer.invoke("cfg:requireAuth"),

  // ── Auth ──────────────────────────────────────────────────────────────────

  /** @returns {Promise<string|null>} JWT bearer token, or null if not logged in. */
  getToken: async () => (await ipcRenderer.invoke("auth:getToken"))?.token || null,
  /** Open Discord OAuth flow in the system browser. @returns {void} */
  login:    () => ipcRenderer.invoke("auth:login"),
  /** @returns {Promise<{ok: boolean}>} */
  logout:   () => ipcRenderer.invoke("auth:logout"),
  /**
   * Register a listener for deep-link auth token events (fired after Discord OAuth redirect).
   * @param {(token: string) => void} fn
   */
  onAuthToken: (fn) => ipcRenderer.on("auth:token", (_e, token) => fn(token)),

  // ── Settings ──────────────────────────────────────────────────────────────

  /** @returns {Promise<FC_Settings>} */
  getSettings: () => ipcRenderer.invoke("settings:get"),
  /**
   * @param {FC_Settings} data
   * @returns {Promise<FC_Settings>}
   */
  setSettings: (data) => ipcRenderer.invoke("settings:set", data),

  // ── Device ────────────────────────────────────────────────────────────────

  /** @returns {string} SHA-256 machine fingerprint (synchronous). */
  fingerprint: () => deviceFingerprint(),
  /** @returns {string} Human-readable device name, e.g. "MacBook (darwin arm64)". */
  deviceName:  () => `${os.hostname()} (${os.platform()} ${os.arch()})`,
  /** @returns {NodeJS.Platform} */
  platform:    () => process.platform,

  // ── Inventory ─────────────────────────────────────────────────────────────

  /** @returns {Promise<FC_InventoryItem[]>} All items sorted by updated_at desc. */
  inventoryList: () => ipcRenderer.invoke("inventory:list"),
  /**
   * Insert or update one inventory item (normalizeItem() runs in main process).
   * @param {Partial<FC_InventoryItem>} item
   * @returns {Promise<FC_InventoryItem>}
   */
  inventoryUpsert: (item) => ipcRenderer.invoke("inventory:upsert", item),
  /**
   * @param {string} id
   * @returns {Promise<{ok: boolean}>}
   */
  inventoryDelete: (id) => ipcRenderer.invoke("inventory:delete", { id }),
  /**
   * @param {string[]} ids
   * @param {Partial<FC_InventoryItem>} patch
   * @returns {Promise<{ok: boolean, count: number}>}
   */
  inventoryBulkUpdate: (ids, patch) => ipcRenderer.invoke("inventory:bulkUpdate", { ids, patch }),
  /** Wipe all inventory (creates .bak first). @returns {Promise<{ok: boolean}>} */
  inventoryClear: () => ipcRenderer.invoke("inventory:clear"),

  // ── Price History ─────────────────────────────────────────────────────────

  /**
   * @param {FC_PriceEntry & {ean: string, title?: string}} entry
   * @returns {Promise<{ok: boolean}>}
   */
  priceHistorySave: (entry) => ipcRenderer.invoke("priceHistory:save", entry),
  /**
   * @param {{ ean: string, title?: string, price_series: Array<[number,number]>, qty_series?: Array<[number,number]> }} params
   * @returns {Promise<{ok: boolean, added: number}>}
   */
  priceHistorySaveSeries: (params) => ipcRenderer.invoke("priceHistory:saveSeries", params),
  /**
   * @param {string} ean
   * @returns {Promise<FC_PriceHistory>}
   */
  priceHistoryGet: (ean) => ipcRenderer.invoke("priceHistory:get", ean),
  /** @returns {Promise<FC_PriceHistorySummary[]>} */
  priceHistoryList: () => ipcRenderer.invoke("priceHistory:list"),
  /**
   * @param {string} ean
   * @returns {Promise<{ok: boolean}>}
   */
  priceHistoryDeleteEan: (ean) => ipcRenderer.invoke("priceHistory:deleteEan", ean),

  // ── Seller / Competition Tracker ──────────────────────────────────────────

  /** @returns {Promise<FC_TrackedSeller[]>} */
  competitionList: () => ipcRenderer.invoke("competition:list"),
  /**
   * @param {string} username
   * @returns {Promise<FC_TrackedSeller[]>}
   */
  competitionAdd: (username) => ipcRenderer.invoke("competition:add", username),
  /**
   * @param {string} username
   * @returns {Promise<FC_TrackedSeller[]>}
   */
  competitionRemove: (username) => ipcRenderer.invoke("competition:remove", username),
  /**
   * @param {string}      username
   * @param {number}      count
   * @param {number|null} feedback_score
   * @param {number|null} feedback_pct
   * @returns {Promise<{ok: boolean}>}
   */
  competitionUpdateCount: (username, count, feedback_score, feedback_pct) =>
    ipcRenderer.invoke("competition:updateCount", { username, count, feedback_score, feedback_pct }),
  /** @returns {Promise<FC_MonitorStatus>} */
  competitionMonitorStatus: () => ipcRenderer.invoke("competition:monitorStatus"),
  /**
   * @param {number} min - New interval in minutes
   * @returns {Promise<{ok: boolean}>}
   */
  competitionSetMonitorInterval: (min) => ipcRenderer.invoke("competition:setMonitorInterval", min),

  // ── Price Alerts ──────────────────────────────────────────────────────────

  /** @returns {Promise<FC_Alert[]>} */
  alertsList: () => ipcRenderer.invoke("alerts:list"),
  /**
   * @param {Partial<FC_Alert>} data
   * @returns {Promise<FC_Alert[]>}
   */
  alertsAdd: (data) => ipcRenderer.invoke("alerts:add", data),
  /**
   * @param {string} id
   * @returns {Promise<FC_Alert[]>}
   */
  alertsRemove: (id) => ipcRenderer.invoke("alerts:remove", id),
  /**
   * @param {Partial<FC_Alert> & {id: string}} patch
   * @returns {Promise<FC_Alert[]>}
   */
  alertsUpdate: (patch) => ipcRenderer.invoke("alerts:update", patch),
  /**
   * Re-arm an alert by clearing its triggered_at timestamp.
   * @param {string} id
   * @returns {Promise<FC_Alert[]>}
   */
  alertsReset: (id) => ipcRenderer.invoke("alerts:reset", id),

  // ── Desktop Notifications ─────────────────────────────────────────────────

  /**
   * @param {string} title
   * @param {string} body
   * @returns {Promise<void>}
   */
  notify: (title, body) => ipcRenderer.invoke("notify", title, body),

  // ── Barcode Scanner ───────────────────────────────────────────────────────

  /** @returns {Promise<{port: string|null, connected: boolean}>} */
  getScannerInfo: () => ipcRenderer.invoke("scanner:getInfo"),
  /**
   * Subscribe to scanner EAN events.
   * @param {(ean: string) => void} cb
   */
  onScannerEan: (cb) => {
    const wrapped = (/** @type {*} */ _e, /** @type {string} */ ean) => cb(ean);
    _scannerListeners.set(cb, wrapped);
    ipcRenderer.on("scanner:ean", wrapped);
  },
  /**
   * Unsubscribe a previously registered scanner EAN listener.
   * @param {(ean: string) => void} cb
   */
  offScannerEan: (cb) => {
    const wrapped = _scannerListeners.get(cb);
    if (wrapped) {
      ipcRenderer.removeListener("scanner:ean", wrapped);
      _scannerListeners.delete(cb);
    }
  },

  // ── Auto-Updater ──────────────────────────────────────────────────────────

  /** @returns {Promise<void>} */
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  /** @returns {Promise<void>} */
  installUpdate:   () => ipcRenderer.invoke("updater:install"),
  /**
   * @param {(info: {version: string}) => void} cb
   */
  onUpdateAvailable:  (cb) => ipcRenderer.on("updater:available",  (_e, info) => cb(info)),
  /**
   * @param {(info: {version: string}) => void} cb
   */
  onUpdateDownloaded: (cb) => ipcRenderer.on("updater:downloaded", (_e, info) => cb(info)),

  // ── Extension Bridge ──────────────────────────────────────────────────────

  /**
   * Register a listener for inventory upserts arriving from the browser extension.
   * @param {(item: FC_InventoryItem) => void} cb
   */
  onInventoryUpsertExt: (cb) => ipcRenderer.on("inventory:upsert-ext", (_e, item) => cb(item)),

  // ── Price History — vacuum ────────────────────────────────────────────────

  /**
   * Remove all EANs whose most-recent price entry is older than 90 days.
   * @returns {Promise<{ok: boolean, removed: number}>}
   */
  priceHistoryVacuum: () => ipcRenderer.invoke("priceHistory:vacuum"),

  // ── Backend health ────────────────────────────────────────────────────────

  /**
   * Fired by the main process when the local FastAPI backend failed to start.
   * Only relevant in local/dev mode; never fires in production (remote mode).
   * @param {(info: {reason: string}) => void} cb
   */
  onBackendUnavailable: (cb) => ipcRenderer.on("backend:unavailable", (_e, info) => cb(info)),
});
