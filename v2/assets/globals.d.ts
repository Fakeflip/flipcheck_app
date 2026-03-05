/**
 * Flipcheck v2 — Ambient global declarations
 *
 * This file ONLY declares globals that TypeScript cannot infer from the included
 * assets/**\/\*.js source files:
 *
 *  1. window.fc  — exposed via Electron contextBridge in preload.js (not in assets/)
 *  2. Chart      — CDN-loaded Chart.js (not a JS file in the project)
 *  3. html       — will be created in assets/lib/html.js (needed before the file exists)
 *  4. InventoryData — will be created in assets/views/inventory-data.js (ditto)
 *
 * All other globals (FC, Storage, Toast, Modal, App, API, etc.) are defined in
 * assets/**\/\*.js and are type-inferred by the compiler directly from those files.
 * Do NOT re-declare them here — duplicate declarations cause TS2451 errors.
 */

// ── window.fc IPC bridge (preload.js / contextBridge) ────────────────────────
// preload.js lives at the root (not under assets/) so it is NOT in the tsconfig
// include glob. We must declare window.fc manually here.

interface Window {
  fc: {
    // Config
    backendBase(): Promise<string>;
    mode():        Promise<string>;
    version():     Promise<string>;
    requireAuth(): Promise<boolean>;

    // Auth
    getToken():               Promise<string | null>;
    login():                  void;
    logout():                 Promise<{ ok: boolean }>;
    onAuthToken(fn: (token: string) => void): void;

    // Settings
    getSettings():               Promise<FC_Settings>;
    setSettings(d: FC_Settings): Promise<FC_Settings>;

    // Device
    fingerprint(): string;
    deviceName():  string;
    platform():    string;

    // Inventory
    inventoryList(): Promise<FC_InventoryItem[]>;
    inventoryUpsert(item: Partial<FC_InventoryItem>): Promise<FC_InventoryItem>;
    inventoryDelete(id: string): Promise<{ ok: boolean }>;
    inventoryBulkUpdate(
      ids: string[],
      patch: Partial<FC_InventoryItem>
    ): Promise<{ ok: boolean; count: number }>;
    inventoryClear(): Promise<{ ok: boolean }>;

    // Price History
    priceHistorySave(
      entry: FC_PriceEntry & { ean: string; title?: string }
    ): Promise<{ ok: boolean }>;
    priceHistorySaveSeries(params: {
      ean: string;
      title?: string;
      price_series: Array<[number, number]>;
      qty_series?:  Array<[number, number]>;
    }): Promise<{ ok: boolean; added: number }>;
    priceHistoryGet(ean: string):      Promise<FC_PriceHistory>;
    priceHistoryList():                Promise<FC_PriceHistorySummary[]>;
    priceHistoryDeleteEan(ean: string):Promise<{ ok: boolean }>;

    // Competition / Sellers
    competitionList():              Promise<FC_TrackedSeller[]>;
    competitionAdd(username: string):    Promise<FC_TrackedSeller[]>;
    competitionRemove(username: string): Promise<FC_TrackedSeller[]>;
    competitionUpdateCount(
      username: string,
      count: number,
      feedback_score: number | null,
      feedback_pct:   number | null
    ): Promise<{ ok: boolean }>;
    competitionMonitorStatus():          Promise<FC_MonitorStatus>;
    competitionSetMonitorInterval(min: number): Promise<{ ok: boolean }>;

    // Price Alerts
    alertsList():  Promise<FC_Alert[]>;
    alertsAdd(data: Partial<FC_Alert>): Promise<FC_Alert[]>;
    alertsRemove(id: string):           Promise<FC_Alert[]>;
    alertsUpdate(patch: Partial<FC_Alert> & { id: string }): Promise<FC_Alert[]>;
    alertsReset(id: string):            Promise<FC_Alert[]>;

    // Notifications
    notify(title: string, body: string): Promise<void>;

    // Scanner
    getScannerInfo(): Promise<{ port: string | null; connected: boolean }>;
    onScannerEan(cb: (ean: string) => void):  void;
    offScannerEan(cb: (ean: string) => void): void;

    // Auto-updater
    checkForUpdates(): Promise<void>;
    installUpdate():   Promise<void>;
    onUpdateAvailable(cb:  (info: { version: string }) => void): void;
    onUpdateDownloaded(cb: (info: { version: string }) => void): void;

    // Extension bridge
    onInventoryUpsertExt(cb: (item: FC_InventoryItem) => void): void;

    // Price History — vacuum
    priceHistoryVacuum(): Promise<{ ok: boolean; removed: number }>;

    // Backend health (local/dev mode only)
    onBackendUnavailable(cb: (info: { reason: string }) => void): void;
  };
}

// ── Storage IIFE (assets/lib/storage.js) ─────────────────────────────────────
// The name "Storage" collides with the DOM lib's WebStorage API. We explicitly
// declare our custom Storage here to shadow the DOM type for all call sites.
// The redeclaration error in storage.js itself is suppressed with // @ts-ignore.

declare const Storage: {
  listInventory():      Promise<FC_InventoryItem[]>;
  upsertItem(item: Partial<FC_InventoryItem>): Promise<FC_InventoryItem>;
  deleteItem(id: string): Promise<{ ok: boolean }>;
  bulkUpdate(ids: string[], patch: Partial<FC_InventoryItem>): Promise<{ ok: boolean; count: number }>;

  savePrice(entry: FC_PriceEntry & { ean: string; title?: string }): Promise<{ ok: boolean } | null>;
  savePriceSeries(params: {
    ean: string;
    title?: string;
    price_series: Array<[number, number]>;
    qty_series?: Array<[number, number]>;
  }): Promise<{ ok: boolean; added: number } | null>;
  getHistory(ean: string):    Promise<FC_PriceHistory>;
  listHistory():              Promise<FC_PriceHistorySummary[]>;
  deleteHistory(ean: string): Promise<{ ok: boolean } | null>;

  getSettings():                              Promise<FC_Settings>;
  saveSettings(patch: Partial<FC_Settings>):  Promise<FC_Settings>;

  calcInventoryAnalytics(items: FC_InventoryItem[]): FC_InventoryAnalytics;
  /** Discard memoised analytics result (exposed for tests and external forced-refresh). */
  _invalidateAnalytics(): void;

  listSellers():   Promise<FC_TrackedSeller[]>;
  addSeller(username: string): Promise<FC_TrackedSeller[]>;
  removeSeller(username: string): Promise<FC_TrackedSeller[]>;
  updateSellerCount(
    username: string,
    count: number,
    feedbackScore: number | null,
    feedbackPct: number | null
  ): Promise<{ ok: boolean } | null>;

  monitorStatus():                    Promise<FC_MonitorStatus | null>;
  setMonitorInterval(min: number):    Promise<{ ok: boolean } | null>;

  listAlerts():   Promise<FC_Alert[]>;
  addAlert(data: Partial<FC_Alert>): Promise<FC_Alert[]>;
  removeAlert(id: string): Promise<FC_Alert[]>;
  updateAlert(patch: Partial<FC_Alert> & { id: string }): Promise<FC_Alert[]>;
  resetAlert(id: string): Promise<FC_Alert[]>;
};

// ── Chart.js (loaded via CDN <script> in index.html) ─────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Chart: any;

// ── View IIFEs (assets/views/*.js) — excluded from strict tsconfig include ────
// app.js references these names; they are declared here so the typecheck pass
// on app.js can resolve them without including the DOM-heavy view files.

declare const AnalyticsView:   { mount(el: HTMLElement): Promise<void>; unmount?(): void } | undefined;
declare const FlipcheckView:   { mount(el: HTMLElement, navId: number): Promise<void>; unmount?(): void } | undefined;
declare const BatchView:       { mount(el: HTMLElement): Promise<void>; unmount?(): void } | undefined;
declare const InventoryView:   { mount(el: HTMLElement): Promise<void>; unmount?(): void } | undefined;
declare const HistoryView:     { mount(el: HTMLElement): Promise<void>; unmount?(): void } | undefined;
declare const DealScanView:    { mount(el: HTMLElement): Promise<void>; unmount?(): void } | undefined;
declare const CompetitionView: { mount(el: HTMLElement): Promise<void>; unmount?(): void } | undefined;
declare const AlertsView:      { mount(el: HTMLElement): Promise<void>; unmount?(): void } | undefined;
declare const MarketplaceView: { mount(el: HTMLElement): Promise<void>; unmount?(): void } | undefined;
declare const SalesView:       { mount(el: HTMLElement): Promise<void>; unmount?(): void } | undefined;
declare const SettingsView:    { mount(el: HTMLElement): Promise<void>; unmount?(): void } | undefined;
/** Onboarding wizard — conditionally defined in assets/views/onboarding.js. */
declare const OnboardingWizard: { show(): Promise<string | null> } | undefined;

/** Run all active price alerts against the live API. Defined in assets/views/alerts.js. */
declare function runAlertChecks(): Promise<void>;

// ── html tagged-template helper (assets/lib/html.js — created in next step) ──
// Declared here so other view files can reference it before the file is compiled.

/** Auto-escaping tagged template literal. Use html.safe(str) to bypass escaping. */
declare function html(strings: TemplateStringsArray, ...values: unknown[]): string;
declare namespace html {
  /** Mark a string as trusted/pre-escaped — will NOT be HTML-escaped by the template. */
  function safe(rawHtml: string): object;
}

// ── InventoryData IIFE (assets/views/inventory-data.js — created in next step) ─

/** Extracted pure-function IIFE — loaded before inventory.js. */
declare const InventoryData: {
  parseCsvLine(line: string): string[];
  parseCsv(
    text:     string,
    statuses: readonly string[]
  ): { items: Partial<FC_InventoryItem>[]; skipped: number };
  getFilteredItems(
    items:             FC_InventoryItem[],
    filter:            { q: string; status: string; market: string },
    sort:              { col: string; dir: "asc" | "desc" },
    calcRealProfitFn:  (item: FC_InventoryItem) => number | null
  ): FC_InventoryItem[];
};
