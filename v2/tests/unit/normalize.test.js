/**
 * Flipcheck v2 — Tests: normalizeItem, migrateInv, validateItems
 * Covers: inventory-logic.js (pure Node.js CommonJS module)
 */

"use strict";

const {
  SCHEMA_VERSION,
  VALID_MARKETS,
  VALID_STATUSES,
  uid,
  nowIso,
  normalizeItem,
  migrateInv,
  validateItems,
} = require("../../inventory-logic.js");

const { resetCounter, makeItem, makeV1Item, makeV1Store } = require("../helpers/fixtures.js");

beforeEach(() => resetCounter());

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe("Module constants", () => {
  test("SCHEMA_VERSION is 2", () => {
    expect(SCHEMA_VERSION).toBe(2);
  });

  test("VALID_MARKETS contains exactly the 4 canonical markets", () => {
    expect([...VALID_MARKETS].sort()).toEqual(["amz", "ebay", "kaufland", "other"]);
  });

  test("VALID_STATUSES contains exactly the 7 lifecycle statuses", () => {
    const expected = [
      "ARCHIVED", "INBOUND", "IN_STOCK", "LISTED",
      "LISTING_PENDING", "RETURN", "SOLD",
    ];
    expect([...VALID_STATUSES].sort()).toEqual(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// uid / nowIso
// ─────────────────────────────────────────────────────────────────────────────

describe("uid()", () => {
  test("returns a 20-char hex string", () => {
    expect(uid()).toMatch(/^[0-9a-f]{20}$/);
  });

  test("each call returns a different value", () => {
    const ids = new Set(Array.from({ length: 10 }, () => uid()));
    expect(ids.size).toBe(10);
  });
});

describe("nowIso()", () => {
  test("returns a valid ISO-8601 string", () => {
    expect(() => new Date(nowIso())).not.toThrow();
    expect(new Date(nowIso()).toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("is approximately now", () => {
    const before = Date.now();
    const ts = new Date(nowIso()).getTime();
    const after  = Date.now();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeItem — id / timestamps
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeItem() — identity fields", () => {
  test("assigns a new id when none is provided", () => {
    const item = normalizeItem({ ean: "12345" });
    expect(item.id).toBeDefined();
    expect(typeof item.id).toBe("string");
    expect(item.id.length).toBeGreaterThan(0);
  });

  test("preserves an existing id", () => {
    const item = normalizeItem({ id: "my-id", ean: "12345" });
    expect(item.id).toBe("my-id");
  });

  test("assigns created_at when absent", () => {
    const before = Date.now();
    const item = normalizeItem({});
    const ts = new Date(item.created_at).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
  });

  test("preserves existing created_at", () => {
    const fixed = "2024-01-15T08:00:00.000Z";
    const item = normalizeItem({ created_at: fixed });
    expect(item.created_at).toBe(fixed);
  });

  test("always overwrites updated_at with current time", () => {
    const old = "2020-01-01T00:00:00.000Z";
    const before = Date.now();
    const item = normalizeItem({ updated_at: old });
    const ts = new Date(item.updated_at).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeItem — market enum
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeItem() — market", () => {
  test.each(["ebay", "amz", "kaufland", "other"])("valid market '%s' is preserved", (m) => {
    expect(normalizeItem({ market: m }).market).toBe(m);
  });

  test("unknown market string → 'other'", () => {
    expect(normalizeItem({ market: "temu" }).market).toBe("other");
  });

  test("undefined market → 'ebay' (default)", () => {
    const item = normalizeItem({});
    expect(item.market).toBe("ebay");
  });

  test("empty string market → 'ebay'", () => {
    expect(normalizeItem({ market: "" }).market).toBe("ebay");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeItem — status enum
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeItem() — status", () => {
  test.each(["IN_STOCK", "LISTED", "LISTING_PENDING", "INBOUND", "SOLD", "RETURN", "ARCHIVED"])(
    "valid status '%s' is preserved", (s) => {
      expect(normalizeItem({ status: s }).status).toBe(s);
    }
  );

  test("unknown status string → 'IN_STOCK'", () => {
    expect(normalizeItem({ status: "PENDING_PAYMENT" }).status).toBe("IN_STOCK");
  });

  test("undefined status → 'IN_STOCK'", () => {
    expect(normalizeItem({}).status).toBe("IN_STOCK");
  });

  test("empty string status → 'IN_STOCK'", () => {
    expect(normalizeItem({ status: "" }).status).toBe("IN_STOCK");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeItem — string fields
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeItem() — string fields", () => {
  test("title defaults to empty string", () => {
    expect(normalizeItem({}).title).toBe("");
  });

  test("title is preserved", () => {
    expect(normalizeItem({ title: "Samsung TV" }).title).toBe("Samsung TV");
  });

  test("ean defaults to empty string", () => {
    expect(normalizeItem({}).ean).toBe("");
  });

  test("sku falls back to ean when not provided", () => {
    expect(normalizeItem({ ean: "4010355040672" }).sku).toBe("4010355040672");
  });

  test("sku is preserved if explicitly provided", () => {
    expect(normalizeItem({ ean: "4010355040672", sku: "MY-SKU" }).sku).toBe("MY-SKU");
  });

  test("source defaults to empty string", () => {
    expect(normalizeItem({}).source).toBe("");
  });

  test("source is preserved", () => {
    expect(normalizeItem({ source: "extension" }).source).toBe("extension");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeItem — numeric fields
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeItem() — numeric fields", () => {
  test("qty string '3' is coerced to 3", () => {
    expect(normalizeItem({ qty: "3" }).qty).toBe(3);
  });

  test("qty NaN is coerced to 1", () => {
    expect(normalizeItem({ qty: NaN }).qty).toBe(1);
  });

  test("qty undefined → 1", () => {
    expect(normalizeItem({}).qty).toBe(1);
  });

  test("ek 12.5 is preserved as 12.5", () => {
    expect(normalizeItem({ ek: 12.5 }).ek).toBe(12.5);
  });

  test("ek string '9.99' is coerced to 9.99", () => {
    expect(normalizeItem({ ek: "9.99" }).ek).toBe(9.99);
  });

  test("ek undefined → null", () => {
    expect(normalizeItem({}).ek).toBeNull();
  });

  test("ek null → null", () => {
    expect(normalizeItem({ ek: null }).ek).toBeNull();
  });

  test("ek 0 → null (zero EK treated as unset)", () => {
    expect(normalizeItem({ ek: 0 }).ek).toBeNull();
  });

  test("ek 'bad' → null", () => {
    expect(normalizeItem({ ek: "bad" }).ek).toBeNull();
  });

  test("ship_out 0 stays 0 (unlike ek)", () => {
    expect(normalizeItem({ ship_out: 0 }).ship_out).toBe(0);
  });

  test("ship_out string '4.99' → 4.99", () => {
    expect(normalizeItem({ ship_out: "4.99" }).ship_out).toBe(4.99);
  });

  test("ship_out undefined → 0", () => {
    expect(normalizeItem({}).ship_out).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeItem — date / category fields
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeItem() — date & category fields", () => {
  test("ek_date defaults to null", () => {
    expect(normalizeItem({}).ek_date).toBeNull();
  });

  test("ek_date is preserved", () => {
    expect(normalizeItem({ ek_date: "2025-01-01" }).ek_date).toBe("2025-01-01");
  });

  test("sold_at defaults to null", () => {
    expect(normalizeItem({}).sold_at).toBeNull();
  });

  test("cat_id defaults to 'sonstiges'", () => {
    expect(normalizeItem({}).cat_id).toBe("sonstiges");
  });

  test("cat_id is preserved", () => {
    expect(normalizeItem({ cat_id: "handys" }).cat_id).toBe("handys");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeItem — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeItem() — edge cases", () => {
  test("null input → item with all defaults", () => {
    const item = normalizeItem(null);
    expect(item.id).toBeDefined();
    expect(item.market).toBe("ebay");
    expect(item.status).toBe("IN_STOCK");
  });

  test("undefined input → item with all defaults", () => {
    const item = normalizeItem(undefined);
    expect(item.market).toBe("ebay");
  });

  test("does not mutate the input object", () => {
    const input = { id: "keep", market: "ebay" };
    normalizeItem(input);
    expect(Object.keys(input)).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// migrateInv
// ─────────────────────────────────────────────────────────────────────────────

describe("migrateInv()", () => {
  test("v2 store passes through unchanged", () => {
    const item = makeItem();
    const store = { version: 2, items: [item] };
    const result = migrateInv(store);
    expect(result.version).toBe(2);
    expect(result.items[0].created_at).toBe(item.created_at);
  });

  test("v1 store: version is bumped to 2", () => {
    const store = makeV1Store([makeV1Item()]);
    expect(migrateInv(store).version).toBe(2);
  });

  test("v1 store: numeric createdAt epoch → ISO string in created_at", () => {
    const epoch = 1700000000000;
    const store = makeV1Store([{ id: "x", createdAt: epoch, updatedAt: epoch }]);
    const result = migrateInv(store);
    expect(result.items[0].created_at).toBe(new Date(epoch).toISOString());
    expect(result.items[0].createdAt).toBeUndefined();
  });

  test("v1 store: numeric updatedAt epoch → ISO string in updated_at", () => {
    const epoch = 1700100000000;
    const store = makeV1Store([{ id: "x", createdAt: 1700000000000, updatedAt: epoch }]);
    const result = migrateInv(store);
    expect(result.items[0].updated_at).toBe(new Date(epoch).toISOString());
    expect(result.items[0].updatedAt).toBeUndefined();
  });

  test("v1 store: does not overwrite existing snake_case created_at", () => {
    const iso = "2023-01-01T00:00:00.000Z";
    const store = makeV1Store([{ id: "x", createdAt: 1700000000000, created_at: iso }]);
    const result = migrateInv(store);
    expect(result.items[0].created_at).toBe(iso);
  });

  test("v1 store: id is coerced to string", () => {
    const store = makeV1Store([{ id: 42, createdAt: 1700000000000 }]);
    const result = migrateInv(store);
    expect(typeof result.items[0].id).toBe("string");
    expect(result.items[0].id).toBe("42");
  });

  test("empty store: returns version 2 with empty items", () => {
    const result = migrateInv({ version: 1, items: [] });
    expect(result).toEqual({ version: 2, items: [] });
  });

  test("store missing version: treated as v1", () => {
    const result = migrateInv({ items: [] });
    expect(result.version).toBe(2);
  });

  test("store missing items: items defaults to []", () => {
    const result = migrateInv({ version: 1 });
    expect(result.items).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateItems
// ─────────────────────────────────────────────────────────────────────────────

describe("validateItems()", () => {
  test("non-array input → empty array", () => {
    expect(validateItems(null)).toEqual([]);
    expect(validateItems(undefined)).toEqual([]);
    expect(validateItems("string")).toEqual([]);
  });

  test("filters out null entries", () => {
    const items = [null, makeItem()];
    expect(validateItems(items)).toHaveLength(1);
  });

  test("filters out non-object entries", () => {
    const items = ["string", 42, makeItem()];
    expect(validateItems(items)).toHaveLength(1);
  });

  test("filters out items with missing id", () => {
    const { id: _id, ...noId } = makeItem();
    expect(validateItems([noId])).toHaveLength(0);
  });

  test("filters out items with non-string id", () => {
    const items = [{ id: 123, status: "IN_STOCK", market: "ebay" }];
    expect(validateItems(items)).toHaveLength(0);
  });

  test("repairs invalid market → 'other'", () => {
    const items = [{ id: "x", market: "temu", status: "IN_STOCK" }];
    expect(validateItems(items)[0].market).toBe("other");
  });

  test("repairs invalid status → 'IN_STOCK'", () => {
    const items = [{ id: "x", market: "ebay", status: "MYSTERY" }];
    expect(validateItems(items)[0].status).toBe("IN_STOCK");
  });

  test("coerces non-finite qty to 1", () => {
    const items = [{ id: "x", market: "ebay", status: "IN_STOCK", qty: "bad" }];
    expect(validateItems(items)[0].qty).toBe(1);
  });

  test("coerces non-finite ek to null", () => {
    const items = [{ id: "x", market: "ebay", status: "IN_STOCK", ek: "nope" }];
    expect(validateItems(items)[0].ek).toBeNull();
  });

  test("leaves finite ek intact", () => {
    const items = [{ id: "x", market: "ebay", status: "IN_STOCK", ek: 12.5 }];
    expect(validateItems(items)[0].ek).toBe(12.5);
  });

  test("valid items pass through without unnecessary changes", () => {
    const item = makeItem({ market: "amz", status: "LISTED" });
    const result = validateItems([item]);
    expect(result[0].market).toBe("amz");
    expect(result[0].status).toBe("LISTED");
    expect(result[0].id).toBe(item.id);
  });

  test("does not mutate the input array", () => {
    const items = [makeItem()];
    validateItems(items);
    expect(items[0].market).toBe("ebay"); // untouched
  });
});
