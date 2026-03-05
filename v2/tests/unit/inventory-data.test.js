/**
 * Flipcheck v2 — Tests: InventoryData pure functions
 * Covers: assets/views/inventory-data.js
 *   parseCsvLine  — RFC-4180 CSV field parser
 *   parseCsv      — Full CSV-to-items converter
 *   getFilteredItems — Stateless filter + sort
 */

"use strict";

const { loadScripts } = require("../helpers/vm-runner.js");

let ctx;

beforeAll(() => {
  ctx = loadScripts([
    "assets/lib/constants.js",
    "assets/views/inventory-data.js",
  ]);
});

// ── parseCsvLine ────────────────────────────────────────────────────────────

describe("InventoryData.parseCsvLine()", () => {
  test("splits a simple comma-separated line", () => {
    const r = ctx.InventoryData.parseCsvLine("a,b,c");
    expect(r).toEqual(["a", "b", "c"]);
  });

  test("handles quoted fields that contain commas", () => {
    const r = ctx.InventoryData.parseCsvLine('"hello, world",foo,bar');
    expect(r).toEqual(["hello, world", "foo", "bar"]);
  });

  test("handles escaped double-quotes inside quoted fields", () => {
    const r = ctx.InventoryData.parseCsvLine('"say ""hello""",value');
    expect(r).toEqual(['say "hello"', "value"]);
  });

  test("returns single-element array for a line with no commas", () => {
    const r = ctx.InventoryData.parseCsvLine("onlyvalue");
    expect(r).toEqual(["onlyvalue"]);
  });

  test("empty string yields [\"\"]", () => {
    const r = ctx.InventoryData.parseCsvLine("");
    expect(r).toEqual([""]);
  });
});

// ── parseCsv ────────────────────────────────────────────────────────────────

describe("InventoryData.parseCsv()", () => {
  // valid status list (mirrors FC.STATUSES)
  const STATUSES = ctx ? null : null; // filled in beforeAll
  let statuses;

  beforeAll(() => {
    statuses = ctx.FC.STATUSES;
  });

  test("parses a valid CSV into items with correct field mapping", () => {
    const csv = "EAN,Titel,EK,Menge,Status\n1234567890123,Test Produkt,10.00,1,IN_STOCK";
    const { items, skipped, error } = ctx.InventoryData.parseCsv(csv, statuses);
    expect(error).toBeNull();
    expect(items).toHaveLength(1);
    expect(items[0].ean).toBe("1234567890123");
    expect(items[0].title).toBe("Test Produkt");
    expect(items[0].ek).toBeCloseTo(10.0);
    expect(items[0].qty).toBe(1);
    expect(items[0].status).toBe("IN_STOCK");
    expect(skipped).toHaveLength(0);
  });

  test("strips BOM prefix if present", () => {
    const csv = "\uFEFFEAN,Titel\n1234567890123,BOM Test";
    const { items, error } = ctx.InventoryData.parseCsv(csv, statuses);
    expect(error).toBeNull();
    expect(items).toHaveLength(1);
    expect(items[0].ean).toBe("1234567890123");
  });

  test("returns error=too_few_lines for single-line CSV (header only)", () => {
    const { error } = ctx.InventoryData.parseCsv("EAN,Titel", statuses);
    expect(error).toBe("too_few_lines");
  });

  test("returns error=too_few_lines for empty string", () => {
    const { error } = ctx.InventoryData.parseCsv("", statuses);
    expect(error).toBe("too_few_lines");
  });

  test("returns error=no_ean_column when EAN column is missing", () => {
    const csv = "Titel,EK\nTest,10.00";
    const { error } = ctx.InventoryData.parseCsv(csv, statuses);
    expect(error).toBe("no_ean_column");
  });

  test("alternative EAN header aliases: Barcode, GTIN", () => {
    const csv1 = "Barcode\n1234567890123";
    const { error: e1, items: i1 } = ctx.InventoryData.parseCsv(csv1, statuses);
    expect(e1).toBeNull();
    expect(i1[0].ean).toBe("1234567890123");

    const csv2 = "GTIN\n1234567890123";
    const { error: e2 } = ctx.InventoryData.parseCsv(csv2, statuses);
    expect(e2).toBeNull();
  });

  test("skips rows with missing EAN and records them in skipped[]", () => {
    const csv = "EAN,Titel\n,No EAN row\n1234567890123,Valid";
    const { items, skipped } = ctx.InventoryData.parseCsv(csv, statuses);
    expect(items).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatch(/EAN fehlt/i);
  });

  test("defaults unknown status to IN_STOCK", () => {
    const csv = "EAN,Status\n1234567890123,TOTALLY_INVALID";
    const { items } = ctx.InventoryData.parseCsv(csv, statuses);
    expect(items[0].status).toBe("IN_STOCK");
  });

  test("coerces EK to float", () => {
    const csv = "EAN,EK\n1234567890123,15.50";
    const { items } = ctx.InventoryData.parseCsv(csv, statuses);
    expect(typeof items[0].ek).toBe("number");
    expect(items[0].ek).toBeCloseTo(15.5);
  });

  test("coerces qty to int and defaults to 1 when absent", () => {
    const csv1 = "EAN,Menge\n1234567890123,3";
    const { items: i1 } = ctx.InventoryData.parseCsv(csv1, statuses);
    expect(i1[0].qty).toBe(3);

    const csv2 = "EAN\n1234567890123";
    const { items: i2 } = ctx.InventoryData.parseCsv(csv2, statuses);
    expect(i2[0].qty).toBe(1);
  });

  test("normalises market to lowercase", () => {
    const csv = "EAN,Markt\n1234567890123,EBAY";
    const { items } = ctx.InventoryData.parseCsv(csv, statuses);
    expect(items[0].market).toBe("ebay");
  });
});

// ── getFilteredItems ─────────────────────────────────────────────────────────

describe("InventoryData.getFilteredItems()", () => {
  const noopProfit = () => null;

  /** @param {Record<string,*>} [overrides] */
  function makeTestItem(overrides = {}) {
    return {
      id:         Math.random().toString(36).slice(2),
      ean:        "1234567890123",
      title:      "Test Item",
      market:     "ebay",
      status:     "IN_STOCK",
      ek:         10,
      sell_price: null,
      created_at: "2025-01-01T10:00:00.000Z",
      sku:        "",
      label:      "",
      ...overrides,
    };
  }

  const emptyFilter = { q: "", status: "", market: "" };
  const noSort      = { col: "", dir: "asc" };

  test("returns all items when filter is empty", () => {
    const items = [makeTestItem(), makeTestItem()];
    const r = ctx.InventoryData.getFilteredItems(items, emptyFilter, noSort, noopProfit);
    expect(r).toHaveLength(2);
  });

  test("filters by search query matching title (case-insensitive)", () => {
    const items = [
      makeTestItem({ title: "Nintendo Switch" }),
      makeTestItem({ title: "PlayStation 5" }),
    ];
    const r = ctx.InventoryData.getFilteredItems(
      items, { q: "nintendo", status: "", market: "" }, noSort, noopProfit
    );
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe("Nintendo Switch");
  });

  test("filters by search query matching EAN", () => {
    const items = [
      makeTestItem({ ean: "1111111111111", title: "Item A" }),
      makeTestItem({ ean: "2222222222222", title: "Item B" }),
    ];
    const r = ctx.InventoryData.getFilteredItems(
      items, { q: "1111", status: "", market: "" }, noSort, noopProfit
    );
    expect(r).toHaveLength(1);
  });

  test("filters by status", () => {
    const items = [
      makeTestItem({ status: "IN_STOCK" }),
      makeTestItem({ status: "LISTED" }),
      makeTestItem({ status: "SOLD" }),
    ];
    const r = ctx.InventoryData.getFilteredItems(
      items, { q: "", status: "LISTED", market: "" }, noSort, noopProfit
    );
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("LISTED");
  });

  test("filters by market", () => {
    const items = [
      makeTestItem({ market: "ebay" }),
      makeTestItem({ market: "amz" }),
      makeTestItem({ market: "kaufland" }),
    ];
    const r = ctx.InventoryData.getFilteredItems(
      items, { q: "", status: "", market: "amz" }, noSort, noopProfit
    );
    expect(r).toHaveLength(1);
    expect(r[0].market).toBe("amz");
  });

  test("sorts by ek ascending", () => {
    const items = [makeTestItem({ ek: 20 }), makeTestItem({ ek: 5 }), makeTestItem({ ek: 15 })];
    const r = ctx.InventoryData.getFilteredItems(
      items, emptyFilter, { col: "ek", dir: "asc" }, noopProfit
    );
    expect(r.map(i => i.ek)).toEqual([5, 15, 20]);
  });

  test("sorts by ek descending", () => {
    const items = [makeTestItem({ ek: 5 }), makeTestItem({ ek: 20 }), makeTestItem({ ek: 15 })];
    const r = ctx.InventoryData.getFilteredItems(
      items, emptyFilter, { col: "ek", dir: "desc" }, noopProfit
    );
    expect(r.map(i => i.ek)).toEqual([20, 15, 5]);
  });

  test("profit sort: null-profit items (non-SOLD) always go last", () => {
    const items = [
      makeTestItem({ status: "IN_STOCK", ek: 10 }),     // profit=null → last
      makeTestItem({ status: "SOLD", ek: 10, sell_price: 30 }),
    ];
    const profitFn = item =>
      item.status === "SOLD" && item.sell_price != null ? (item.sell_price - item.ek) : null;
    const r = ctx.InventoryData.getFilteredItems(
      items, emptyFilter, { col: "profit", dir: "asc" }, profitFn
    );
    expect(r[0].status).toBe("SOLD");
    expect(r[1].status).toBe("IN_STOCK");
  });

  test("sorts by title alphabetically", () => {
    const items = [
      makeTestItem({ title: "Zebra" }),
      makeTestItem({ title: "Apple" }),
      makeTestItem({ title: "Mango" }),
    ];
    const r = ctx.InventoryData.getFilteredItems(
      items, emptyFilter, { col: "title", dir: "asc" }, noopProfit
    );
    expect(r.map(i => i.title)).toEqual(["Apple", "Mango", "Zebra"]);
  });
});
