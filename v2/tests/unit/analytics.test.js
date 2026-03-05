/**
 * Flipcheck v2 — Tests: calcInventoryAnalytics, calcWeeklyProfit
 * Covers: assets/lib/storage.js (loaded via vm-runner after constants + app)
 */

"use strict";

const { loadScripts } = require("../helpers/vm-runner.js");
const { resetCounter, makeItem, makeSoldItem } = require("../helpers/fixtures.js");

// Reset fixture counter AND the analytics memo cache before each test.
// The cache key is based on updated_at timestamps, which are static in
// test fixtures — without this reset, tests with the same item count and
// static timestamps could get a stale cached result from a previous test.
beforeEach(() => {
  resetCounter();
  if (ctx) ctx.Storage._invalidateAnalytics();
});

/** Shared vm context — load constants → app → storage (order matters). */
let ctx;

beforeAll(() => {
  ctx = loadScripts([
    "assets/lib/constants.js",
    "assets/app.js",
    "assets/lib/storage.js",
  ]);
});

// Convenience alias
const analytics = (items) => ctx.Storage.calcInventoryAnalytics(items);

// ─────────────────────────────────────────────────────────────────────────────
// calcInventoryAnalytics — empty / baseline
// ─────────────────────────────────────────────────────────────────────────────

describe("calcInventoryAnalytics() — baseline", () => {
  test("empty array → all aggregates are zero", () => {
    const r = analytics([]);
    expect(r.soldCount).toBe(0);
    expect(r.soldRecords).toBe(0);
    expect(r.activeCount).toBe(0);
    expect(r.totalCount).toBe(0);
    expect(r.totalProfit).toBe(0);
    expect(r.totalRevenue).toBe(0);
    expect(r.totalCost).toBe(0);
    expect(r.avgRoi).toBe(0);
    expect(r.activeCash).toBe(0);
    expect(r.avgDaysToCash).toBe(0);
  });

  test("result always has weeklyProfit with 12 entries", () => {
    const r = analytics([]);
    expect(r.weeklyProfit).toHaveLength(12);
  });

  test("result always has marketSplit as an object", () => {
    const r = analytics([]);
    expect(typeof r.marketSplit).toBe("object");
  });

  test("result always has bestFlips and worstFlips arrays", () => {
    const r = analytics([]);
    expect(Array.isArray(r.bestFlips)).toBe(true);
    expect(Array.isArray(r.worstFlips)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcInventoryAnalytics — active / sold counts
// ─────────────────────────────────────────────────────────────────────────────

describe("calcInventoryAnalytics() — counts", () => {
  test("IN_STOCK item is counted as active", () => {
    const r = analytics([makeItem({ status: "IN_STOCK" })]);
    expect(r.activeCount).toBe(1);
    expect(r.totalCount).toBe(1);
  });

  test("LISTED item is counted as active", () => {
    const r = analytics([makeItem({ status: "LISTED" })]);
    expect(r.activeCount).toBe(1);
  });

  test("LISTING_PENDING item is counted as active", () => {
    const r = analytics([makeItem({ status: "LISTING_PENDING" })]);
    expect(r.activeCount).toBe(1);
  });

  test("SOLD item is NOT counted as active", () => {
    const r = analytics([makeSoldItem()]);
    expect(r.activeCount).toBe(0);
  });

  test("soldRecords counts the number of SOLD records (not units)", () => {
    const sold = [makeSoldItem(), makeSoldItem()];
    const r = analytics(sold);
    expect(r.soldRecords).toBe(2);
  });

  test("soldCount is qty-weighted (qty=3 → soldCount += 3)", () => {
    const r = analytics([makeSoldItem({ qty: 3 })]);
    expect(r.soldCount).toBe(3);
  });

  test("SOLD item without sell_price is excluded from analytics", () => {
    const r = analytics([makeItem({ status: "SOLD", sell_price: null, ek: 10 })]);
    expect(r.soldRecords).toBe(0);
    expect(r.totalProfit).toBe(0);
  });

  test("SOLD item without ek is excluded from analytics", () => {
    const r = analytics([makeItem({ status: "SOLD", sell_price: 20, ek: null })]);
    expect(r.soldRecords).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcInventoryAnalytics — financial aggregates
// ─────────────────────────────────────────────────────────────────────────────

describe("calcInventoryAnalytics() — financial aggregates", () => {
  test("totalRevenue = sum of sell_price × qty for SOLD items", () => {
    const items = [
      makeSoldItem({ sell_price: 30, qty: 1 }),
      makeSoldItem({ sell_price: 20, qty: 2 }),
    ];
    // 30 + 40 = 70
    const r = analytics(items);
    expect(r.totalRevenue).toBeCloseTo(70, 5);
  });

  test("totalCost = sum of ek × qty for SOLD items", () => {
    const items = [
      makeSoldItem({ ek: 10, qty: 1 }),
      makeSoldItem({ ek: 15, qty: 2 }),
    ];
    // 10 + 30 = 40
    const r = analytics(items);
    expect(r.totalCost).toBeCloseTo(40, 5);
  });

  test("totalProfit is qty-weighted real profit (includes eBay fee deduction)", () => {
    // Single ebay item: VK=30, EK=10, sonstiges 13% → fee=3.90 → profit=16.10
    const item = makeSoldItem({ sell_price: 30, ek: 10, ship_out: 0, cat_id: "sonstiges", market: "ebay" });
    const r = analytics([item]);
    expect(r.totalProfit).toBeCloseTo(16.1, 2);
  });

  test("totalProfit multiplied by qty", () => {
    const item = makeSoldItem({
      sell_price: 30, ek: 10, ship_out: 0, cat_id: "sonstiges", market: "ebay", qty: 3,
    });
    // profit per unit ≈ 16.10, × 3 ≈ 48.30
    const r = analytics([item]);
    expect(r.totalProfit).toBeCloseTo(16.1 * 3, 1);
  });

  test("activeCash = sum of ek × qty for active-status items", () => {
    const items = [
      makeItem({ status: "IN_STOCK", ek: 25, qty: 2 }),  // 50
      makeItem({ status: "LISTED",   ek: 10, qty: 1 }),  // 10
      makeSoldItem({ ek: 5, qty: 1 }),                   // excluded (SOLD)
    ];
    const r = analytics(items);
    expect(r.activeCash).toBeCloseTo(60, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcInventoryAnalytics — avgRoi
// ─────────────────────────────────────────────────────────────────────────────

describe("calcInventoryAnalytics() — avgRoi", () => {
  test("avgRoi is 0 when no sold items", () => {
    const r = analytics([makeItem()]);
    expect(r.avgRoi).toBe(0);
  });

  test("avgRoi > 0 for profitable items", () => {
    const r = analytics([makeSoldItem({ sell_price: 30, ek: 10, market: "amz", ship_out: 0 })]);
    // profit = 20, ek = 10, ROI = 200%
    expect(r.avgRoi).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcInventoryAnalytics — avgDaysToCash
// ─────────────────────────────────────────────────────────────────────────────

describe("calcInventoryAnalytics() — avgDaysToCash", () => {
  test("0 when no sold items with dates", () => {
    const r = analytics([makeSoldItem({ ek_date: null, sold_at: null })]);
    expect(r.avgDaysToCash).toBe(0);
  });

  test("calculates days between ek_date and sold_at", () => {
    const item = makeSoldItem({
      ek_date: "2025-01-01T00:00:00.000Z",
      sold_at: "2025-01-15T00:00:00.000Z",
    });
    const r = analytics([item]);
    expect(r.avgDaysToCash).toBeCloseTo(14, 0);
  });

  test("falls back to created_at when ek_date is absent", () => {
    const item = makeSoldItem({
      created_at: "2025-01-01T00:00:00.000Z",
      ek_date:    null,
      sold_at:    "2025-01-08T00:00:00.000Z",
    });
    const r = analytics([item]);
    expect(r.avgDaysToCash).toBeCloseTo(7, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcInventoryAnalytics — marketSplit
// ─────────────────────────────────────────────────────────────────────────────

describe("calcInventoryAnalytics() — marketSplit", () => {
  test("counts items per market", () => {
    const items = [
      makeItem({ market: "ebay" }),
      makeItem({ market: "ebay" }),
      makeItem({ market: "amz" }),
    ];
    const r = analytics(items);
    expect(r.marketSplit.ebay).toBe(2);
    expect(r.marketSplit.amz).toBe(1);
  });

  test("items without market key count as 'other'", () => {
    const item = makeItem();
    delete item.market;
    const r = analytics([item]);
    expect(r.marketSplit.other).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcInventoryAnalytics — bestFlips / worstFlips
// ─────────────────────────────────────────────────────────────────────────────

describe("calcInventoryAnalytics() — bestFlips / worstFlips", () => {
  test("bestFlips: first item has highest profit", () => {
    const items = [
      makeSoldItem({ sell_price: 50, ek: 10, market: "amz" }),
      makeSoldItem({ sell_price: 30, ek: 25, market: "amz" }),
    ];
    const r = analytics(items);
    expect(r.bestFlips[0].profit).toBeGreaterThan(r.bestFlips[1].profit);
  });

  test("worstFlips: first item has lowest profit", () => {
    const items = [
      makeSoldItem({ sell_price: 50, ek: 10, market: "amz" }),
      makeSoldItem({ sell_price: 12, ek: 11, market: "amz" }),
    ];
    const r = analytics(items);
    expect(r.worstFlips[0].profit).toBeLessThan(r.worstFlips[1].profit);
  });

  test("at most 5 items in bestFlips even when there are more sold records", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeSoldItem({ sell_price: 20 + i, ek: 10, market: "amz" })
    );
    const r = analytics(items);
    expect(r.bestFlips.length).toBeLessThanOrEqual(5);
  });

  test("at most 5 items in worstFlips", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeSoldItem({ sell_price: 20 + i, ek: 10, market: "amz" })
    );
    const r = analytics(items);
    expect(r.worstFlips.length).toBeLessThanOrEqual(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// weeklyProfit structure
// ─────────────────────────────────────────────────────────────────────────────

describe("calcInventoryAnalytics() — weeklyProfit structure", () => {
  test("has exactly 12 entries covering the last 12 weeks", () => {
    const r = analytics([]);
    expect(r.weeklyProfit).toHaveLength(12);
  });

  test("each entry has label (KW__) and profit (number)", () => {
    const r = analytics([]);
    for (const entry of r.weeklyProfit) {
      expect(entry.label).toMatch(/^KW\d{2}$/);
      expect(typeof entry.profit).toBe("number");
    }
  });

  test("profit is 0 for all weeks when no items", () => {
    const r = analytics([]);
    for (const entry of r.weeklyProfit) {
      expect(entry.profit).toBe(0);
    }
  });
});
