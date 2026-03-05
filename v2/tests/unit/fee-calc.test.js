/**
 * Flipcheck v2 — Tests: calcEbayFee, calcRealProfit
 * Covers: assets/app.js (loaded via vm-runner)
 */

"use strict";

const { loadScripts } = require("../helpers/vm-runner.js");
const { resetCounter, makeItem } = require("../helpers/fixtures.js");

beforeEach(() => resetCounter());

/** Shared vm context — load once for all tests in this file. */
let ctx;

beforeAll(() => {
  // app.js depends on FC_EbayFeeCategory type but NOT on the FC runtime object.
  // Loading just app.js is sufficient for fee calc tests.
  ctx = loadScripts(["assets/app.js"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// calcEbayFee — single tier categories
// ─────────────────────────────────────────────────────────────────────────────

describe("calcEbayFee() — single tier (sonstiges 13%)", () => {
  test("€100 × 13% = €13.00", () => {
    expect(ctx.calcEbayFee(100, "sonstiges")).toBeCloseTo(13.0, 5);
  });

  test("€50 × 13% = €6.50", () => {
    expect(ctx.calcEbayFee(50, "sonstiges")).toBeCloseTo(6.5, 5);
  });

  test("€0 → fee is 0", () => {
    expect(ctx.calcEbayFee(0, "sonstiges")).toBe(0);
  });

  test("negative price → fee is 0 (Math.max guard)", () => {
    expect(ctx.calcEbayFee(-10, "sonstiges")).toBe(0);
  });

  test("mode fashion 15%: €50 → €7.50", () => {
    expect(ctx.calcEbayFee(50, "mode")).toBeCloseTo(7.5, 5);
  });

  test("sport_freizeit 11.5%: €100 → €11.50", () => {
    expect(ctx.calcEbayFee(100, "sport_freizeit")).toBeCloseTo(11.5, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcEbayFee — tiered categories (6.5% up to €990, then 3%)
// ─────────────────────────────────────────────────────────────────────────────

describe("calcEbayFee() — tiered (computer 6.5% / 3%)", () => {
  test("€500 (within first tier) → 500 × 6.5% = €32.50", () => {
    expect(ctx.calcEbayFee(500, "computer_tablets")).toBeCloseTo(32.5, 5);
  });

  test("€990 (exactly at tier boundary) → 990 × 6.5% = €64.35", () => {
    expect(ctx.calcEbayFee(990, "computer_tablets")).toBeCloseTo(64.35, 5);
  });

  test("€1100 (spans both tiers): 990×6.5% + 110×3%", () => {
    const expected = 990 * 0.065 + 110 * 0.03;
    expect(ctx.calcEbayFee(1100, "computer_tablets")).toBeCloseTo(expected, 5);
  });

  test("€2000 (well above threshold): 990×6.5% + 1010×3%", () => {
    const expected = 990 * 0.065 + 1010 * 0.03;
    expect(ctx.calcEbayFee(2000, "computer_tablets")).toBeCloseTo(expected, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcEbayFee — unknown category fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("calcEbayFee() — category fallback", () => {
  test("unknown catId falls back to last category (sonstiges 13%)", () => {
    // sonstiges is the last entry in EBAY_FEE_CATEGORIES
    expect(ctx.calcEbayFee(100, "xyz_unknown_cat")).toBeCloseTo(13.0, 5);
  });

  test("handy_zubehoer 11% up to €990: €100 → €11", () => {
    expect(ctx.calcEbayFee(100, "handy_zubehoer")).toBeCloseTo(11.0, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcRealProfit
// ─────────────────────────────────────────────────────────────────────────────

describe("calcRealProfit() — null guard", () => {
  test("null item → null", () => {
    expect(ctx.calcRealProfit(null)).toBeNull();
  });

  test("undefined item → null", () => {
    expect(ctx.calcRealProfit(undefined)).toBeNull();
  });

  test("missing sell_price → null", () => {
    expect(ctx.calcRealProfit(makeItem({ sell_price: null }))).toBeNull();
  });

  test("missing ek → null", () => {
    expect(ctx.calcRealProfit(makeItem({ sell_price: 30, ek: null }))).toBeNull();
  });
});

describe("calcRealProfit() — eBay market (deducts fee)", () => {
  test("ebay: VK 30 − EK 10 − fee 13% = 30−10−3.90 = 16.10", () => {
    const item = makeItem({ market: "ebay", sell_price: 30, ek: 10, ship_out: 0, cat_id: "sonstiges" });
    expect(ctx.calcRealProfit(item)).toBeCloseTo(16.1, 5);
  });

  test("ebay: ship_out is deducted from profit", () => {
    const item = makeItem({
      market: "ebay", sell_price: 30, ek: 10, ship_out: 4.99, cat_id: "sonstiges",
    });
    // 30 − 10 − 3.90 (fee) − 4.99 = 11.11
    expect(ctx.calcRealProfit(item)).toBeCloseTo(11.11, 2);
  });

  test("market undefined defaults to ebay fee deduction", () => {
    const item = { sell_price: 30, ek: 10, ship_out: 0, cat_id: "sonstiges" };
    expect(ctx.calcRealProfit(item)).toBeCloseTo(16.1, 5);
  });
});

describe("calcRealProfit() — non-eBay markets (no fee)", () => {
  test("amz market: no fee deducted", () => {
    const item = makeItem({ market: "amz", sell_price: 30, ek: 10, ship_out: 0 });
    // 30 − 10 − 0 = 20
    expect(ctx.calcRealProfit(item)).toBeCloseTo(20.0, 5);
  });

  test("kaufland market: no fee deducted", () => {
    const item = makeItem({ market: "kaufland", sell_price: 30, ek: 10, ship_out: 0 });
    expect(ctx.calcRealProfit(item)).toBeCloseTo(20.0, 5);
  });

  test("other market: no fee deducted", () => {
    const item = makeItem({ market: "other", sell_price: 30, ek: 10, ship_out: 0 });
    expect(ctx.calcRealProfit(item)).toBeCloseTo(20.0, 5);
  });
});

describe("calcRealProfit() — complete calculation scenarios", () => {
  test("high-value computer: tiered fee applied correctly", () => {
    const item = makeItem({
      market: "ebay", sell_price: 1100, ek: 800, ship_out: 0, cat_id: "computer_tablets",
    });
    const fee = 990 * 0.065 + 110 * 0.03;   // 64.35 + 3.30 = 67.65
    // 1100 − 800 − 67.65 = 232.35
    expect(ctx.calcRealProfit(item)).toBeCloseTo(1100 - 800 - fee, 5);
  });

  test("negative profit (loss flip)", () => {
    const item = makeItem({
      market: "ebay", sell_price: 10, ek: 20, ship_out: 5, cat_id: "sonstiges",
    });
    // 10 − 20 − 5 − 1.30 (fee) = −16.30
    expect(ctx.calcRealProfit(item)).toBeLessThan(0);
  });
});
