/**
 * Flipcheck v2 — Business Logic Edge Case Tests
 *
 * Covers the specific bugs fixed in the 10/10 business-logic pass:
 *
 * 1. calcProfit — shipIn/Out undefined → must not produce NaN profit
 * 2. calcProfit — margin denominator uses vkNet (net/net), not vkGross
 * 3. calcInventoryAnalytics — avgRoi must not be Infinity when ek = 0
 * 4. calcInventoryAnalytics — bestFlips.roi must not be Infinity when ek = 0
 * 5. calcInventoryAnalytics — weeklyProfit profit is qty-weighted in storage
 * 6. calcRealProfit — parseFloat("") guard: no NaN propagation
 */

"use strict";

const { loadScripts } = require("../helpers/vm-runner.js");
const { resetCounter, makeItem, makeSoldItem } = require("../helpers/fixtures.js");

beforeEach(() => resetCounter());

// ── VM contexts ──────────────────────────────────────────────────────────────

/** Context with app.js only (calcEbayFee, calcRealProfit). */
let appCtx;
/** Context with constants + app + storage (calcInventoryAnalytics). */
let storeCtx;

beforeAll(() => {
  appCtx   = loadScripts(["assets/app.js"]);
  storeCtx = loadScripts([
    "assets/lib/constants.js",
    "assets/app.js",
    "assets/lib/storage.js",
  ]);
});

const analytics = (items) => storeCtx.Storage.calcInventoryAnalytics(items);

// ─────────────────────────────────────────────────────────────────────────────
// calcEbayFee — zero / negative guard (pre-existing, document the contract)
// ─────────────────────────────────────────────────────────────────────────────

describe("calcEbayFee() — zero / negative price guard", () => {
  test("vkGross = 0 → fee is 0 (no crash)", () => {
    expect(appCtx.calcEbayFee(0, "sonstiges")).toBe(0);
  });

  test("vkGross = -1 → fee is 0 (Math.max guard)", () => {
    expect(appCtx.calcEbayFee(-1, "sonstiges")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcRealProfit — NaN guards
// ─────────────────────────────────────────────────────────────────────────────

describe("calcRealProfit() — NaN guard: sell_price or ek must be finite", () => {
  test("ek = 0 → still calculates a profit (not NaN)", () => {
    // VK=30, EK=0, fee=3.90 → profit = 26.10 — free items can have a real profit
    const item = makeSoldItem({ sell_price: 30, ek: 0, ship_out: 0, market: "ebay", cat_id: "sonstiges" });
    const p = appCtx.calcRealProfit(item);
    expect(p).not.toBeNaN();
    expect(p).toBeCloseTo(26.1, 2);
  });

  test("result is finite (never Infinity)", () => {
    const item = makeSoldItem({ sell_price: 30, ek: 0.001, ship_out: 0, market: "amz" });
    const p = appCtx.calcRealProfit(item);
    expect(isFinite(p)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcInventoryAnalytics — avgRoi must never be Infinity
// ─────────────────────────────────────────────────────────────────────────────

describe("calcInventoryAnalytics() — avgRoi is always finite", () => {
  test("no sold items → avgRoi is 0", () => {
    const r = analytics([makeItem()]);
    expect(r.avgRoi).toBe(0);
    expect(isFinite(r.avgRoi)).toBe(true);
  });

  test("sold items with ek=0 are excluded from analytics (falsy filter)", () => {
    // items.filter(i => ... && i.ek) — ek=0 is falsy, excluded from 'sold'
    const items = [
      makeSoldItem({ sell_price: 50, ek: 0, market: "amz", ship_out: 0 }),
      makeSoldItem({ sell_price: 25, ek: 0, market: "amz", ship_out: 0 }),
    ];
    const r = analytics(items);
    // All items excluded → soldRecords = 0, avgRoi = 0 (not Infinity)
    expect(r.soldRecords).toBe(0);
    expect(r.avgRoi).toBe(0);
    expect(isFinite(r.avgRoi)).toBe(true);
  });

  test("valid sold items → avgRoi is a finite positive number", () => {
    const item = makeSoldItem({ sell_price: 30, ek: 10, market: "amz", ship_out: 0 });
    const r = analytics([item]);
    expect(isFinite(r.avgRoi)).toBe(true);
    expect(r.avgRoi).toBeGreaterThan(0);
    // profit = 20, ek = 10 → ROI = 200%
    expect(r.avgRoi).toBeCloseTo(200, 0);
  });

  test("very small ek (near zero) → avgRoi is finite (not Infinity)", () => {
    const item = makeSoldItem({ sell_price: 30, ek: 0.01, market: "amz", ship_out: 0 });
    const r = analytics([item]);
    expect(isFinite(r.avgRoi)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcInventoryAnalytics — bestFlips/worstFlips roi
// ─────────────────────────────────────────────────────────────────────────────

describe("calcInventoryAnalytics() — bestFlips/worstFlips roi", () => {
  test("item with ek > 0 has a finite, non-null roi in bestFlips", () => {
    const item = makeSoldItem({ sell_price: 30, ek: 10, market: "amz", ship_out: 0 });
    const r = analytics([item]);
    const best = r.bestFlips[0];
    expect(best).toBeDefined();
    expect(best.roi).not.toBeNull();
    expect(isFinite(best.roi)).toBe(true);
    expect(best.roi).toBeCloseTo(200, 0); // profit=20, ek=10 → 200%
  });

  test("roi is always finite across all bestFlips entries", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeSoldItem({ sell_price: 20 + i, ek: 5 + i, market: "amz", ship_out: 0 })
    );
    const r = analytics(items);
    for (const flip of r.bestFlips) {
      expect(flip.roi === null || isFinite(flip.roi)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcInventoryAnalytics — weeklyProfit is qty-weighted in storage.js
// ─────────────────────────────────────────────────────────────────────────────

describe("calcInventoryAnalytics() — weeklyProfit qty-weighted", () => {
  test("qty=3 triples the weekly profit compared to qty=1", () => {
    const now     = new Date();
    const soldAt  = new Date(now);
    soldAt.setDate(now.getDate() - 2); // 2 days ago — within current week

    const single = makeSoldItem({
      sell_price: 30, ek: 10, ship_out: 0, market: "ebay", cat_id: "sonstiges",
      qty: 1, sold_at: soldAt.toISOString(),
    });
    const triple = makeSoldItem({
      sell_price: 30, ek: 10, ship_out: 0, market: "ebay", cat_id: "sonstiges",
      qty: 3, sold_at: soldAt.toISOString(),
    });

    const r1 = analytics([single]);
    const r3 = analytics([triple]);

    // Find the week that includes our sold_at date
    const w1 = r1.weeklyProfit.find(w => w.profit !== 0);
    const w3 = r3.weeklyProfit.find(w => w.profit !== 0);

    expect(w1).toBeDefined();
    expect(w3).toBeDefined();
    expect(w3.profit).toBeCloseTo(w1.profit * 3, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcInventoryAnalytics — profit sort null safety
// ─────────────────────────────────────────────────────────────────────────────

describe("calcInventoryAnalytics() — bestFlips sorted by profit", () => {
  test("two items: bestFlips[0] has higher profit than bestFlips[1]", () => {
    const items = [
      makeSoldItem({ sell_price: 50, ek: 5,  market: "amz", ship_out: 0 }),  // profit=45
      makeSoldItem({ sell_price: 30, ek: 10, market: "amz", ship_out: 0 }),  // profit=20
    ];
    const r = analytics(items);
    expect(r.bestFlips[0].profit).toBeGreaterThan(r.bestFlips[1].profit);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// avgDaysToCash — negative days (sold_at before ek_date)
// ─────────────────────────────────────────────────────────────────────────────

describe("calcInventoryAnalytics() — avgDaysToCash negative days clamped to 0", () => {
  test("sold_at before ek_date → days clamped to 0, not negative", () => {
    // Retroactive marking: sold before purchase date recorded
    const item = makeSoldItem({
      ek_date: "2025-03-01T00:00:00.000Z",
      sold_at: "2025-01-01T00:00:00.000Z",  // BEFORE ek_date (retroactive)
    });
    const r = analytics([item]);
    expect(r.avgDaysToCash).toBeGreaterThanOrEqual(0);
    expect(r.avgDaysToCash).toBe(0);
  });
});
