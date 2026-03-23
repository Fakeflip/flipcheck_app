// @ts-check
/* Flipcheck v2 — Inventory Business Logic (pure functions, no Electron deps)
 *
 * Extracted from main.js so that this module can be unit-tested in plain Node.js
 * without requiring Electron, keytar, or any other native module.
 *
 * Exports:
 *   SCHEMA_VERSION, VALID_MARKETS, VALID_STATUSES  — schema constants
 *   uid()           — generate a unique 20-char hex ID
 *   nowIso()        — return current time as ISO-8601 string
 *   normalizeItem() — canonicalise an inventory item before write
 *   migrateInv()    — upgrade v1 store to v2 (camelCase → snake_case)
 *   validateItems() — filter/repair items array on load
 */

"use strict";

const crypto = require("crypto");

// ─── Schema constants ─────────────────────────────────────────────────────────

const SCHEMA_VERSION = 2;

const VALID_MARKETS = new Set(["ebay", "amz", "kaufland", "other"]);

const VALID_STATUSES = new Set([
  "IN_STOCK", "LISTED", "LISTING_PENDING", "INBOUND", "SOLD", "RETURN", "ARCHIVED",
]);

const VALID_CONDITIONS = new Set([
  "new", "like_new", "very_good", "good", "acceptable", "defective",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a unique 20-character hex ID (10 random bytes → hex string).
 * @returns {string}
 */
function uid() { return crypto.randomBytes(10).toString("hex"); }

/**
 * Return the current wall-clock time as an ISO-8601 string.
 * @returns {string}
 */
function nowIso() { return new Date().toISOString(); }

// ─── Normalise ────────────────────────────────────────────────────────────────

/**
 * Canonicalise an inventory item before write:
 * - Assigns id / timestamps if absent
 * - Validates market + status against allowed enums (falls back to safe defaults)
 * - Normalises ek_date and source fields (used in analytics + extension bridge)
 *
 * @param {Partial<import('./assets/lib/types.js').FC_InventoryItem>} input
 * @returns {import('./assets/lib/types.js').FC_InventoryItem}
 */
function normalizeItem(input) {
  const it = { ...(input || {}) };

  if (!it.id)         it.id         = uid();
  if (!it.created_at) it.created_at = nowIso();
  it.updated_at = nowIso();

  // Enum guards — fall back to safe defaults for unknown/missing values
  it.market = VALID_MARKETS.has(it.market)  ? it.market  : (it.market  ? "other"    : "ebay");
  it.status = VALID_STATUSES.has(it.status) ? it.status  : (it.status  ? "IN_STOCK" : "IN_STOCK");

  // String fields — empty string is the canonical "unset" value
  it.title  = it.title  || "";
  it.ean    = it.ean    || "";
  it.sku    = it.sku    || it.ean || "";
  it.label  = it.label  || "";
  it.notes  = it.notes  || "";
  it.source = it.source || "";   // origin: "manual" | "extension" | "csv" | ""

  // Numeric fields
  it.qty        = Number.isFinite(Number(it.qty))        ? Number(it.qty) : 1;
  it.ek         = it.ek         !== undefined ? (Number(it.ek)         || null) : null;
  it.sell_price = it.sell_price !== undefined ? (Number(it.sell_price) || null) : null;
  it.ship_out   = it.ship_out   !== undefined ? (Number(it.ship_out)   || 0)    : 0;
  it.ship_in    = it.ship_in    !== undefined ? (Number(it.ship_in)    || 0)    : 0;

  // Date fields
  it.ek_date = it.ek_date || null;   // purchase date — used in "days to cash" analytics
  it.sold_at = it.sold_at || null;

  // Category
  it.cat_id = it.cat_id || "sonstiges";

  // Condition — default to "new" for unknown/missing values
  it.condition = VALID_CONDITIONS.has(it.condition) ? it.condition : "new";

  // eBay sync fields — linking inventory items to eBay listings/orders
  it.ebay_offer_id = it.ebay_offer_id || null;   // eBay item ID (links to active listing)
  it.ebay_order_id = it.ebay_order_id || null;   // eBay order line item ID (dedup for sold items)

  // Real fee data from eBay Finances API (null = use estimated fee)
  it.ebay_fee       = it.ebay_fee       !== undefined ? (Number(it.ebay_fee) || null) : null;
  it.ebay_ship_cost = it.ebay_ship_cost !== undefined ? (Number(it.ebay_ship_cost) || null) : null;

  // Refund data from eBay Finances API (0 = no refund)
  it.refund_amount     = it.refund_amount     !== undefined ? (Number(it.refund_amount) || 0) : 0;
  it.refund_date       = it.refund_date       || null;
  it.refund_fee_credit = it.refund_fee_credit !== undefined ? (Number(it.refund_fee_credit) || 0) : 0;

  // Kaufland sync fields — linking inventory items to Kaufland listings/orders
  it.kaufland_unit_id    = it.kaufland_unit_id    || null;  // Kaufland unit ID (links to active listing)
  it.kaufland_product_id = it.kaufland_product_id || null;  // Kaufland product ID
  it.kaufland_order_id   = it.kaufland_order_id   || null;  // Kaufland order ID (dedup for sold items)

  // Fulfillment / shipping fields
  it.shipped          = it.shipped          || false;       // Label created / shipped via API
  it.tracking_number  = it.tracking_number  || null;        // DHL/Hermes/DPD tracking number
  it.tracking_carrier = it.tracking_carrier || null;        // "DHL", "DPD", "Hermes"

  // Buyer address (from eBay GetOrderTransactions / Kaufland Orders API)
  it.buyer_name    = it.buyer_name    || "";   // Recipient full name
  it.buyer_street  = it.buyer_street  || "";   // Street + house number
  it.buyer_zip     = it.buyer_zip     || "";   // Postal code
  it.buyer_city    = it.buyer_city    || "";   // City
  it.buyer_country = it.buyer_country || "DE"; // Country code (default DE)

  // eBay transaction ID (for CompleteSale — different from order_id)
  it.ebay_transaction_id = it.ebay_transaction_id || null;

  return /** @type {import('./assets/lib/types.js').FC_InventoryItem} */ (it);
}

// ─── Migration ────────────────────────────────────────────────────────────────

/**
 * Apply in-place schema migrations so old data is always upgraded on load.
 * v1 → v2: canonicalise camelCase fields written by the old HTTP POST handler.
 *
 * @param {{ version?: number, items?: Array<Record<string,*>> }} store
 * @returns {{ version: number, items: Array<Record<string,*>> }}
 */
function migrateInv(store) {
  let { version = 1, items = [] } = store;

  if (version < 2) {
    items = items.map(it => {
      const out = { ...it };

      // Old HTTP POST handler wrote camelCase timestamps & numeric epoch timestamps.
      if (out.createdAt !== undefined && !out.created_at) {
        out.created_at = Number.isFinite(out.createdAt)
          ? new Date(out.createdAt).toISOString()
          : String(out.createdAt);
        delete out.createdAt;
      }
      if (out.updatedAt !== undefined && !out.updated_at) {
        out.updated_at = Number.isFinite(out.updatedAt)
          ? new Date(out.updatedAt).toISOString()
          : String(out.updatedAt);
        delete out.updatedAt;
      }

      // Old handler used `${Date.now()}-${random}` composite IDs — keep them, just ensure string.
      if (out.id) out.id = String(out.id);

      return out;
    });

    version = 2;
  }

  return { version, items };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate and repair items on load — removes corrupt rows, coerces field types.
 * This runs once at startup so the rest of the app can trust the data shape.
 *
 * @param {Array<Record<string,*>>} items
 * @returns {Array<Record<string,*>>}
 */
function validateItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter(it => it && typeof it === "object" && it.id && typeof it.id === "string")
    .map(it => {
      const out = { ...it };

      // Numeric coercions
      if (!Number.isFinite(Number(out.qty))) out.qty = 1;
      if (out.ek != null && !Number.isFinite(Number(out.ek))) out.ek = null;

      // Enum guards — fall back to safe defaults
      if (!VALID_MARKETS.has(out.market))  out.market = "other";
      if (!VALID_STATUSES.has(out.status)) out.status = "IN_STOCK";

      return out;
    });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  SCHEMA_VERSION,
  VALID_MARKETS,
  VALID_STATUSES,
  VALID_CONDITIONS,
  uid,
  nowIso,
  normalizeItem,
  migrateInv,
  validateItems,
};
