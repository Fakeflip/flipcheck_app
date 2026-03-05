/**
 * Flipcheck v2 — Test Fixtures
 *
 * Factory functions for building test data objects.
 * All counters are module-scoped; call resetCounter() in beforeEach() if you
 * need deterministic IDs across test files.
 */

"use strict";

let _counter = 0;

/** Reset the internal item counter (useful in beforeEach to get stable IDs). */
function resetCounter() { _counter = 0; }

/**
 * Build a fully-populated, normalised inventory item.
 * Pass `overrides` to customise specific fields.
 *
 * @param {Record<string, *>} [overrides]
 * @returns {Record<string, *>}
 */
function makeItem(overrides = {}) {
  const n = ++_counter;
  return {
    id:         `test-item-${n}`,
    created_at: "2025-01-01T10:00:00.000Z",
    updated_at: "2025-01-01T10:00:00.000Z",
    ean:        `400000${String(n).padStart(7, "0")}`,
    title:      `Test Item ${n}`,
    market:     "ebay",
    status:     "IN_STOCK",
    qty:        1,
    ek:         10.00,
    sell_price: null,
    ship_out:   0,
    cat_id:     "sonstiges",
    sku:        "",
    label:      "",
    notes:      "",
    source:     "",
    ek_date:    null,
    sold_at:    null,
    ...overrides,
  };
}

/**
 * Build a sold item (status SOLD, has sell_price and sold_at).
 *
 * @param {Record<string, *>} [overrides]
 * @returns {Record<string, *>}
 */
function makeSoldItem(overrides = {}) {
  return makeItem({
    status:     "SOLD",
    sell_price: 20.00,
    sold_at:    "2025-02-01T12:00:00.000Z",
    ...overrides,
  });
}

/**
 * Build a v1-format item (camelCase timestamps, numeric epoch ms).
 * Used for migration tests.
 *
 * @param {Record<string, *>} [overrides]
 * @returns {Record<string, *>}
 */
function makeV1Item(overrides = {}) {
  const n = ++_counter;
  return {
    id:        `${1700000000000 + n}-abc${n}`,
    createdAt: 1700000000000 + n,
    updatedAt: 1700100000000 + n,
    ean:       `400000${String(n).padStart(7, "0")}`,
    title:     `Old Item ${n}`,
    market:    "ebay",
    status:    "IN_STOCK",
    qty:       1,
    ek:        10.00,
    ...overrides,
  };
}

/**
 * Build a v1 inventory store object (version 1, array of v1 items).
 *
 * @param {Record<string, *>[]} [items]
 * @returns {{ version: number, items: Record<string, *>[] }}
 */
function makeV1Store(items = [makeV1Item()]) {
  return { version: 1, items };
}

/**
 * Build a v2 inventory store object.
 *
 * @param {Record<string, *>[]} [items]
 * @returns {{ version: number, items: Record<string, *>[] }}
 */
function makeV2Store(items = [makeItem()]) {
  return { version: 2, items };
}

module.exports = {
  resetCounter,
  makeItem,
  makeSoldItem,
  makeV1Item,
  makeV1Store,
  makeV2Store,
};
