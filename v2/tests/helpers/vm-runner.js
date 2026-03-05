/**
 * Flipcheck v2 — VM Runner helper
 *
 * Loads browser IIFE scripts (constants.js, app.js, storage.js) into a Node.js
 * vm context so their exported globals can be accessed in Jest tests without a
 * real browser.
 *
 * Key trick: `const X = ...` declarations at top-level in a vm context are
 * NOT accessible as ctx.X (they are block-scoped to the script, not the
 * sandbox global).  We therefore transform `^const ` → `^var ` and
 * `^let ` → `^var ` (multiline, first token on a line) before executing.
 * Function declarations (function foo(){}) are hoisted to the vm global scope
 * automatically and need no transformation.
 */

"use strict";

const vm   = require("vm");
const fs   = require("fs");
const path = require("path");

/** Absolute path to the v2 project root. */
const ROOT = path.join(__dirname, "..", "..");

/**
 * Transform top-level `const`/`let` into `var` so the vm context exposes them
 * as global properties.  Only transforms lines where `const ` or `let ` is the
 * first non-whitespace token (avoids touching `const` inside function bodies or
 * destructuring).
 *
 * @param {string} code
 * @returns {string}
 */
function adaptForVm(code) {
  return code
    .replace(/^const /gm, "var ")
    .replace(/^let /gm,   "var ");
}

/**
 * Build a minimal browser-like sandbox.
 * Includes stubs for all browser APIs that the Flipcheck renderer scripts call
 * at module evaluation time (addEventListener, document.getElementById, etc.)
 * and stubs for peer modules (ErrorReporter, Toast, Modal, Storage).
 *
 * @param {Record<string, *>} [extras]  Extra properties merged into the sandbox.
 * @returns {vm.Context}
 */
function makeSandbox(extras = {}) {
  /** @type {Record<string, *>} */
  const sandbox = {
    // ── JS built-ins ──────────────────────────────────────────────────────
    console,
    Intl,
    Date,
    Math,
    isNaN,
    isFinite,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    parseFloat,
    parseInt,
    JSON,
    Promise,
    Error,
    TypeError,
    RangeError,
    Symbol,

    // ── Browser globals ───────────────────────────────────────────────────
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
      location: { hash: "" },
      /** @type {*} */
      fc: {
        // Inventory
        inventoryList:       async () => [],
        inventoryUpsert:     async (/** @type {*} */ item) => item,
        inventoryDelete:     async () => ({ ok: true }),
        inventoryBulkUpdate: async () => ({ ok: true, count: 0 }),
        inventoryClear:      async () => ({ ok: true }),
        // Price History
        priceHistorySave:       async () => ({ ok: true }),
        priceHistorySaveSeries: async () => ({ ok: true, added: 0 }),
        priceHistoryGet:        async (/** @type {string} */ ean) => ({ ean, title: ean, entries: [] }),
        priceHistoryList:       async () => [],
        priceHistoryDeleteEan:  async () => ({ ok: true }),
        // Settings
        getSettings:  async () => ({}),
        setSettings:  async () => ({}),
        // Competition
        competitionList:              async () => [],
        competitionAdd:               async () => [],
        competitionRemove:            async () => [],
        competitionUpdateCount:       async () => ({ ok: true }),
        competitionMonitorStatus:     async () => null,
        competitionSetMonitorInterval: async () => ({ ok: true }),
        // Alerts
        alertsList:   async () => [],
        alertsAdd:    async () => [],
        alertsRemove: async () => [],
        alertsUpdate: async () => [],
        alertsReset:  async () => [],
      },
    },
    document: {
      getElementById:   () => null,
      querySelector:    () => null,
      querySelectorAll: () => ({ forEach: () => {} }),
      createElement:    (/** @type {string} */ _tag) => ({
        style: {},
        className: "",
        innerHTML: "",
        textContent: "",
        dataset: {},
        appendChild:      () => {},
        addEventListener: () => {},
        querySelector:    () => null,
        querySelectorAll: () => ({ forEach: () => {} }),
        classList: { toggle: () => {}, add: () => {}, remove: () => {} },
      }),
      addEventListener:  () => {},
      documentElement:   { dataset: {} },
    },

    // ── Browser timer APIs ────────────────────────────────────────────────
    requestAnimationFrame: (/** @type {Function} */ fn) => fn(),
    setInterval:  () => 0,
    setTimeout:   () => 0,
    clearInterval: () => {},
    clearTimeout:  () => {},

    // ── fetch (not available in tests — tests should not call network) ────
    fetch: async () => { throw new Error("fetch() is not available in vm test context"); },

    // ── Event class stub ──────────────────────────────────────────────────
    Event: class FakeEvent { constructor(/** @type {string} */ type) { this.type = type; } },

    // ── Peer module stubs (loaded before app.js / storage.js) ────────────
    ErrorReporter: { report: () => {} },
    Toast: {
      success: () => {},
      error:   () => {},
      info:    () => {},
      warn:    () => {},
      dismiss: () => {},
    },
    Modal: {
      init:    () => {},
      open:    async () => null,
      close:   () => {},
      confirm: async () => false,
      alert:   async () => true,
    },

    // ── View class stubs — app.js uses typeof guards; explicit undefined is safe ──
    AnalyticsView:   undefined,
    FlipcheckView:   undefined,
    BatchView:       undefined,
    InventoryView:   undefined,
    HistoryView:     undefined,
    DealScanView:    undefined,
    CompetitionView: undefined,
    AlertsView:      undefined,
    MarketplaceView: undefined,
    SalesView:       undefined,
    SettingsView:    undefined,
    OnboardingWizard: undefined,
    runAlertChecks:   undefined,

    // caller overrides
    ...extras,
  };

  return vm.createContext(sandbox);
}

/**
 * Load one or more project files into a shared vm context (in order) and return
 * the context so tests can access globals like `ctx.FC`, `ctx.calcEbayFee`, etc.
 *
 * Files are resolved relative to the project root.
 *
 * @param {string[]} files    Relative paths from project root, e.g. ["assets/lib/constants.js"]
 * @param {Record<string, *>} [extras]  Extra sandbox properties injected before scripts run.
 * @returns {vm.Context}
 */
function loadScripts(files, extras = {}) {
  const ctx = makeSandbox(extras);
  for (const file of files) {
    const code = adaptForVm(fs.readFileSync(path.join(ROOT, file), "utf8"));
    vm.runInContext(code, ctx, { filename: file });
  }
  return ctx;
}

module.exports = { loadScripts, adaptForVm, ROOT };
