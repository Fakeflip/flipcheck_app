/**
 * Flipcheck v2 — Tests: InventoryView DOM rendering
 * Covers: assets/views/inventory.js (+ inventory-data.js)
 *
 * Strategy:
 *   - Load scripts via dom-runner so mount() gets a real JSDOM container.
 *   - Override ctx.Storage.listInventory per test to control item list.
 *   - requestAnimationFrame is stubbed as synchronous in vm-runner, so the
 *     virtual scroller (_vsRender) executes immediately inside mount().
 */

"use strict";

const { loadViewInDom }             = require("../helpers/dom-runner.js");
const { resetCounter, makeItem }    = require("../helpers/fixtures.js");

// ── Module-level context ────────────────────────────────────────────────────

let ctx;
let document;

beforeAll(() => {
  ({ ctx, document } = loadViewInDom([
    "assets/lib/constants.js",
    "assets/lib/html.js",
    "assets/app.js",
    "assets/lib/storage.js",
    "assets/views/inventory-data.js",
    "assets/views/inventory.js",
  ]));
});

beforeEach(() => {
  resetCounter();
});

// ── Shell structure tests ───────────────────────────────────────────────────

describe("InventoryView.mount() — shell structure", () => {
  let container;

  beforeEach(async () => {
    container = document.createElement("div");
    ctx.Storage.listInventory = async () => [];
    await ctx.InventoryView.mount(container);
  });

  test("renders #invTableWrap", () => {
    expect(container.querySelector("#invTableWrap")).not.toBeNull();
  });

  test("renders #invSearch filter input", () => {
    expect(container.querySelector("#invSearch")).not.toBeNull();
  });

  test("renders #btnAddItem action button", () => {
    expect(container.querySelector("#btnAddItem")).not.toBeNull();
  });

  test("renders the status filter select (#invStatusFilter)", () => {
    expect(container.querySelector("#invStatusFilter")).not.toBeNull();
  });

  test("renders the market filter select (#invMarketFilter)", () => {
    expect(container.querySelector("#invMarketFilter")).not.toBeNull();
  });
});

// ── Data-driven render tests ────────────────────────────────────────────────

describe("InventoryView.mount() — with items", () => {
  test("renders at least 1 tbody tr when 2 items are present", async () => {
    const container = document.createElement("div");
    ctx.Storage.listInventory = async () => [makeItem(), makeItem()];
    await ctx.InventoryView.mount(container);

    const rows = container.querySelectorAll("tbody tr:not(.inv-vs-spacer)");
    expect(rows.length).toBeGreaterThan(0);
  });

  test("shows .empty-state when inventory is empty", async () => {
    const container = document.createElement("div");
    ctx.Storage.listInventory = async () => [];
    await ctx.InventoryView.mount(container);

    expect(container.querySelector(".empty-state")).not.toBeNull();
  });

  test("does NOT show .empty-state when there are items", async () => {
    const container = document.createElement("div");
    ctx.Storage.listInventory = async () => [makeItem()];
    await ctx.InventoryView.mount(container);

    expect(container.querySelector(".empty-state")).toBeNull();
  });
});

// ── unmount() ───────────────────────────────────────────────────────────────

describe("InventoryView.unmount()", () => {
  test("calling unmount() after mount() does not throw", async () => {
    const container = document.createElement("div");
    ctx.Storage.listInventory = async () => [];
    await ctx.InventoryView.mount(container);
    expect(() => ctx.InventoryView.unmount()).not.toThrow();
  });
});
