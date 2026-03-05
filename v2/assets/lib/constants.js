// @ts-check
/* Flipcheck v2 — Shared constants (FC namespace)
 *
 * Single source of truth for enums, labels, and color tokens that are
 * referenced by multiple views and library files.
 *
 * Load order: must be the FIRST <script> so that all subsequent files can
 * reference FC.* safely. All objects are deeply frozen to prevent accidental
 * mutation at runtime.
 *
 * Usage:
 *   FC.STATUSES                  → string[]
 *   FC.STATUS_LABELS["IN_STOCK"] → "Auf Lager"
 *   FC.MARKET_COLORS.ebay.bg     → "rgba(59,130,246,.10)"
 *   FC.VERDICT_COLORS.BUY.text   → "#10B981"
 */

"use strict";

const FC = (() => {

  // ── Inventory statuses ───────────────────────────────────────────────────
  const STATUSES = Object.freeze([
    "IN_STOCK", "LISTED", "LISTING_PENDING",
    "INBOUND", "SOLD", "RETURN", "ARCHIVED",
  ]);

  const STATUS_LABELS = Object.freeze({
    IN_STOCK:        "Auf Lager",
    LISTED:          "Gelistet",
    LISTING_PENDING: "Pending",
    INBOUND:         "Unterwegs",
    SOLD:            "Verkauft",
    RETURN:          "Rücksendung",
    ARCHIVED:        "Archiviert",
  });

  /** Statuses that represent active/invested inventory (not yet sold/archived). */
  const ACTIVE_STATUSES = Object.freeze(["IN_STOCK", "LISTED", "LISTING_PENDING"]);

  // ── Markets ──────────────────────────────────────────────────────────────
  /** Canonical market keys (stored in inventory items as item.market). */
  const MARKETS = Object.freeze(["ebay", "amz", "kaufland", "other"]);

  const MARKET_LABELS = Object.freeze({
    ebay:     "eBay",
    amz:      "Amazon",
    kaufland: "Kaufland",
    other:    "Sonstiges",
  });

  /**
   * Per-market chip colors (CSS rgba values).
   * Used for inline-style badges in table rows.
   * @type {{ [key: string]: { bg: string, border: string, text: string } }}
   */
  const MARKET_COLORS = Object.freeze({
    ebay:     Object.freeze({ bg: "rgba(59,130,246,.10)", border: "rgba(59,130,246,.25)", text: "#60A5FA" }),
    amz:      Object.freeze({ bg: "rgba(245,158,11,.10)", border: "rgba(245,158,11,.25)", text: "#FBBF24" }),
    kaufland: Object.freeze({ bg: "rgba(239,68,68,.10)",  border: "rgba(239,68,68,.25)",  text: "#F87171" }),
    other:    Object.freeze({ bg: "rgba(99,102,241,.10)", border: "rgba(99,102,241,.25)", text: "#818CF8" }),
  });

  /**
   * Per-market solid hex colors — used in Chart.js dataset fills/borders.
   * @type {{ [key: string]: string }}
   */
  const MARKET_CHART_COLORS = Object.freeze({
    ebay:     "#6366F1",
    amz:      "#F59E0B",
    kaufland: "#10B981",
    other:    "#94A3B8",
  });

  // ── Flipcheck verdicts ───────────────────────────────────────────────────
  /**
   * Background / border / text colors for BUY / HOLD / SKIP verdict chips.
   * @type {{ [verdict: string]: { bg: string, border: string, text: string } }}
   */
  const VERDICT_COLORS = Object.freeze({
    BUY:  Object.freeze({ bg: "rgba(16,185,129,.12)", border: "rgba(16,185,129,.28)", text: "#10B981" }),
    HOLD: Object.freeze({ bg: "rgba(245,158,11,.12)",  border: "rgba(245,158,11,.28)",  text: "#F59E0B" }),
    SKIP: Object.freeze({ bg: "rgba(239,68,68,.12)",   border: "rgba(239,68,68,.28)",   text: "#EF4444" }),
  });

  // ── Virtual scroller tuning ──────────────────────────────────────────────
  /** Estimated row height in pixels — used by all virtual-scrolling tables. */
  const VS_ROW_H = 44;
  /** Extra rows rendered above and below the visible viewport (scroll buffer). */
  const VS_BUF   = 8;

  return Object.freeze({
    STATUSES,
    STATUS_LABELS,
    ACTIVE_STATUSES,
    MARKETS,
    MARKET_LABELS,
    MARKET_COLORS,
    MARKET_CHART_COLORS,
    VERDICT_COLORS,
    VS_ROW_H,
    VS_BUF,
  });
})();
