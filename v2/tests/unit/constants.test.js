/**
 * Flipcheck v2 — Tests: FC constants
 * Covers: assets/lib/constants.js (loaded via vm-runner)
 */

"use strict";

const { loadScripts } = require("../helpers/vm-runner.js");

/** Shared vm context. */
let ctx;

beforeAll(() => {
  ctx = loadScripts(["assets/lib/constants.js"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// FC object
// ─────────────────────────────────────────────────────────────────────────────

describe("FC — root object", () => {
  test("FC is defined", () => {
    expect(ctx.FC).toBeDefined();
  });

  test("FC is frozen", () => {
    expect(Object.isFrozen(ctx.FC)).toBe(true);
  });

  test("cannot mutate FC properties", () => {
    expect(() => {
      ctx.FC.STATUSES = [];
    }).toThrow(); // throws in strict mode (the IIFE uses 'use strict')
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC.STATUSES
// ─────────────────────────────────────────────────────────────────────────────

describe("FC.STATUSES", () => {
  test("is an array", () => {
    expect(Array.isArray(ctx.FC.STATUSES)).toBe(true);
  });

  test("is frozen", () => {
    expect(Object.isFrozen(ctx.FC.STATUSES)).toBe(true);
  });

  test("has exactly 7 entries", () => {
    expect(ctx.FC.STATUSES).toHaveLength(7);
  });

  test.each([
    "IN_STOCK", "LISTED", "LISTING_PENDING",
    "INBOUND", "SOLD", "RETURN", "ARCHIVED",
  ])("contains '%s'", (s) => {
    expect(ctx.FC.STATUSES).toContain(s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC.STATUS_LABELS
// ─────────────────────────────────────────────────────────────────────────────

describe("FC.STATUS_LABELS", () => {
  test("is frozen", () => {
    expect(Object.isFrozen(ctx.FC.STATUS_LABELS)).toBe(true);
  });

  test("has a label for every status in STATUSES", () => {
    for (const s of ctx.FC.STATUSES) {
      expect(ctx.FC.STATUS_LABELS[s]).toBeDefined();
      expect(typeof ctx.FC.STATUS_LABELS[s]).toBe("string");
    }
  });

  test("SOLD label is 'Verkauft'", () => {
    expect(ctx.FC.STATUS_LABELS.SOLD).toBe("Verkauft");
  });

  test("IN_STOCK label is 'Auf Lager'", () => {
    expect(ctx.FC.STATUS_LABELS.IN_STOCK).toBe("Auf Lager");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC.ACTIVE_STATUSES
// ─────────────────────────────────────────────────────────────────────────────

describe("FC.ACTIVE_STATUSES", () => {
  test("is frozen", () => {
    expect(Object.isFrozen(ctx.FC.ACTIVE_STATUSES)).toBe(true);
  });

  test("is a non-empty array", () => {
    expect(ctx.FC.ACTIVE_STATUSES.length).toBeGreaterThan(0);
  });

  test("every entry is also in STATUSES", () => {
    for (const s of ctx.FC.ACTIVE_STATUSES) {
      expect(ctx.FC.STATUSES).toContain(s);
    }
  });

  test("SOLD is NOT in ACTIVE_STATUSES", () => {
    expect(ctx.FC.ACTIVE_STATUSES).not.toContain("SOLD");
  });

  test("ARCHIVED is NOT in ACTIVE_STATUSES", () => {
    expect(ctx.FC.ACTIVE_STATUSES).not.toContain("ARCHIVED");
  });

  test("IN_STOCK IS in ACTIVE_STATUSES", () => {
    expect(ctx.FC.ACTIVE_STATUSES).toContain("IN_STOCK");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC.MARKETS
// ─────────────────────────────────────────────────────────────────────────────

describe("FC.MARKETS", () => {
  test("is a frozen array", () => {
    expect(Array.isArray(ctx.FC.MARKETS)).toBe(true);
    expect(Object.isFrozen(ctx.FC.MARKETS)).toBe(true);
  });

  test.each(["ebay", "amz", "kaufland", "other"])("contains '%s'", (m) => {
    expect(ctx.FC.MARKETS).toContain(m);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC.MARKET_LABELS
// ─────────────────────────────────────────────────────────────────────────────

describe("FC.MARKET_LABELS", () => {
  test("is frozen", () => {
    expect(Object.isFrozen(ctx.FC.MARKET_LABELS)).toBe(true);
  });

  test("has a label for every market", () => {
    for (const m of ctx.FC.MARKETS) {
      expect(ctx.FC.MARKET_LABELS[m]).toBeDefined();
    }
  });

  test("ebay label is 'eBay'", () => {
    expect(ctx.FC.MARKET_LABELS.ebay).toBe("eBay");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC.MARKET_COLORS
// ─────────────────────────────────────────────────────────────────────────────

describe("FC.MARKET_COLORS", () => {
  test("is frozen", () => {
    expect(Object.isFrozen(ctx.FC.MARKET_COLORS)).toBe(true);
  });

  test.each(["ebay", "amz", "kaufland", "other"])("'%s' has bg, border, text properties", (m) => {
    const c = ctx.FC.MARKET_COLORS[m];
    expect(c).toBeDefined();
    expect(c.bg).toBeDefined();
    expect(c.border).toBeDefined();
    expect(c.text).toBeDefined();
  });

  test.each(["ebay", "amz", "kaufland", "other"])("'%s' color entry is frozen", (m) => {
    expect(Object.isFrozen(ctx.FC.MARKET_COLORS[m])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC.MARKET_CHART_COLORS
// ─────────────────────────────────────────────────────────────────────────────

describe("FC.MARKET_CHART_COLORS", () => {
  test("is frozen", () => {
    expect(Object.isFrozen(ctx.FC.MARKET_CHART_COLORS)).toBe(true);
  });

  test.each(["ebay", "amz", "kaufland", "other"])("has hex color for '%s'", (m) => {
    const c = ctx.FC.MARKET_CHART_COLORS[m];
    expect(typeof c).toBe("string");
    expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC.VERDICT_COLORS
// ─────────────────────────────────────────────────────────────────────────────

describe("FC.VERDICT_COLORS", () => {
  test("is frozen", () => {
    expect(Object.isFrozen(ctx.FC.VERDICT_COLORS)).toBe(true);
  });

  test.each(["BUY", "HOLD", "SKIP"])("'%s' has bg, border, text properties", (v) => {
    const c = ctx.FC.VERDICT_COLORS[v];
    expect(c.bg).toBeDefined();
    expect(c.border).toBeDefined();
    expect(c.text).toBeDefined();
  });

  test("BUY text is green (#10B981)", () => {
    expect(ctx.FC.VERDICT_COLORS.BUY.text).toBe("#10B981");
  });

  test("SKIP text is red (#EF4444)", () => {
    expect(ctx.FC.VERDICT_COLORS.SKIP.text).toBe("#EF4444");
  });

  test("HOLD text is yellow (#F59E0B)", () => {
    expect(ctx.FC.VERDICT_COLORS.HOLD.text).toBe("#F59E0B");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC — virtual scroller tuning
// ─────────────────────────────────────────────────────────────────────────────

describe("FC — virtual scroller constants", () => {
  test("VS_ROW_H is a positive number", () => {
    expect(typeof ctx.FC.VS_ROW_H).toBe("number");
    expect(ctx.FC.VS_ROW_H).toBeGreaterThan(0);
  });

  test("VS_BUF is a positive integer", () => {
    expect(typeof ctx.FC.VS_BUF).toBe("number");
    expect(ctx.FC.VS_BUF).toBeGreaterThan(0);
    expect(Number.isInteger(ctx.FC.VS_BUF)).toBe(true);
  });
});
