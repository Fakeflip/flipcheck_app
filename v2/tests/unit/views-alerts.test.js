/**
 * Flipcheck v2 — Tests: AlertsView DOM rendering
 * Covers: assets/views/alerts.js
 *
 * Tests verify that mount() produces the correct shell structure and that
 * renderAlertRow() (called internally via loadAlerts → renderList) produces
 * the correct card markup for active and triggered alerts.
 *
 * Strategy:
 *   - Load scripts into a plain vm context (via dom-runner / loadViewInDom).
 *   - Create containers from a real JSDOM document so innerHTML + querySelector work.
 *   - Override ctx.Storage.listAlerts / getSettings per-test to control data.
 */

"use strict";

const { loadViewInDom } = require("../helpers/dom-runner.js");

// ── Module-level context ────────────────────────────────────────────────────
// Scripts are loaded once; ctx and document are shared across all tests.

let ctx;
let document;

beforeAll(() => {
  ({ ctx, document } = loadViewInDom([
    "assets/lib/constants.js",
    "assets/lib/html.js",
    "assets/app.js",
    "assets/lib/storage.js",
    "assets/views/alerts.js",
  ]));
});

// ── Fixture factory ─────────────────────────────────────────────────────────

/** Build a minimal alert object for testing. */
function makeAlert(overrides = {}) {
  return {
    id:              "alert-test-1",
    ean:             "4010355040672",
    title:           "Samsung TV 43\"",
    target_price:    25.00,
    last_price:      35.00,
    active:          true,
    triggered:       false,
    check_count:     3,
    last_checked:    null,
    triggered_price: null,
    triggered_at:    null,
    trigger_history: [],
    ...overrides,
  };
}

// ── Shell structure tests ───────────────────────────────────────────────────

describe("AlertsView.mount() — shell structure", () => {
  let container;

  beforeEach(async () => {
    container = document.createElement("div");
    ctx.Storage.listAlerts  = async () => [];
    ctx.Storage.getSettings = async () => ({});
    await ctx.AlertsView.mount(container);
  });

  test("renders the #alertsList container element", () => {
    expect(container.querySelector("#alertsList")).not.toBeNull();
  });

  test("renders the #alAdd (add alert) button", () => {
    expect(container.querySelector("#alAdd")).not.toBeNull();
  });

  test("renders the #alEan input field", () => {
    expect(container.querySelector("#alEan")).not.toBeNull();
  });

  test("renders the #alTarget input field", () => {
    expect(container.querySelector("#alTarget")).not.toBeNull();
  });

  test("h1 text content is exactly \"Preisalarm\"", () => {
    const h1 = container.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1.textContent.trim()).toBe("Preisalarm");
  });
});

// ── Alert card tests — active alert ────────────────────────────────────────

describe("AlertsView — active alert card (via mount)", () => {
  let container;

  beforeEach(async () => {
    container = document.createElement("div");
    ctx.Storage.getSettings = async () => ({});
    ctx.Storage.listAlerts  = async () => [makeAlert()];
    await ctx.AlertsView.mount(container);
  });

  test("[data-alert-id] attribute matches the alert id", () => {
    const card = container.querySelector("[data-alert-id]");
    expect(card).not.toBeNull();
    expect(card.dataset.alertId).toBe("alert-test-1");
  });

  test("active alert card does NOT have class al-alert-triggered", () => {
    const card = container.querySelector("[data-alert-id]");
    expect(card.classList.contains("al-alert-triggered")).toBe(false);
  });

  test("active alert card does NOT have class al-alert-inactive", () => {
    const card = container.querySelector("[data-alert-id]");
    expect(card.classList.contains("al-alert-inactive")).toBe(false);
  });
});

// ── Alert card tests — triggered alert ─────────────────────────────────────

describe("AlertsView — triggered alert card (via mount)", () => {
  test("triggered alert card HAS class al-alert-triggered", async () => {
    const container = document.createElement("div");
    ctx.Storage.getSettings = async () => ({});
    ctx.Storage.listAlerts  = async () => [makeAlert({ triggered: true })];
    await ctx.AlertsView.mount(container);
    const card = container.querySelector("[data-alert-id]");
    expect(card).not.toBeNull();
    expect(card.classList.contains("al-alert-triggered")).toBe(true);
  });

  test("paused alert card HAS class al-alert-inactive", async () => {
    const container = document.createElement("div");
    ctx.Storage.getSettings = async () => ({});
    ctx.Storage.listAlerts  = async () => [makeAlert({ active: false })];
    await ctx.AlertsView.mount(container);
    const card = container.querySelector("[data-alert-id]");
    expect(card).not.toBeNull();
    expect(card.classList.contains("al-alert-inactive")).toBe(true);
  });
});

// ── XSS escaping via html`` ─────────────────────────────────────────────────

describe("AlertsView — html`` auto-escaping", () => {
  test("alert title with < > & is HTML-escaped in the rendered card", async () => {
    const container = document.createElement("div");
    ctx.Storage.getSettings = async () => ({});
    ctx.Storage.listAlerts  = async () => [makeAlert({ title: "<script>xss</script>" })];
    await ctx.AlertsView.mount(container);
    // The raw string should NOT appear in innerHTML
    expect(container.innerHTML).not.toContain("<script>xss</script>");
    // But the escaped version should be there
    expect(container.innerHTML).toContain("&lt;script&gt;xss&lt;/script&gt;");
  });
});
