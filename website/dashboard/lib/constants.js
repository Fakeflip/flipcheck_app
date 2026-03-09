// @ts-check
/* Flipcheck Web App — Shared constants (FC namespace) */
"use strict";

const FC = (() => {
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

  const ACTIVE_STATUSES = Object.freeze(["IN_STOCK", "LISTED", "LISTING_PENDING"]);

  const MARKETS = Object.freeze(["ebay", "amz", "kaufland", "other"]);

  const MARKET_LABELS = Object.freeze({
    ebay:     "eBay",
    amz:      "Amazon",
    kaufland: "Kaufland",
    other:    "Sonstiges",
  });

  const MARKET_COLORS = Object.freeze({
    ebay:     Object.freeze({ bg: "rgba(59,130,246,.10)", border: "rgba(59,130,246,.25)", text: "#60A5FA" }),
    amz:      Object.freeze({ bg: "rgba(245,158,11,.10)", border: "rgba(245,158,11,.25)", text: "#FBBF24" }),
    kaufland: Object.freeze({ bg: "rgba(239,68,68,.10)",  border: "rgba(239,68,68,.25)",  text: "#F87171" }),
    other:    Object.freeze({ bg: "rgba(99,102,241,.10)", border: "rgba(99,102,241,.25)", text: "#818CF8" }),
  });

  const MARKET_CHART_COLORS = Object.freeze({
    ebay:     "#6366F1",
    amz:      "#F59E0B",
    kaufland: "#10B981",
    other:    "#94A3B8",
  });

  const VERDICT_COLORS = Object.freeze({
    BUY:  Object.freeze({ bg: "rgba(16,185,129,.12)", border: "rgba(16,185,129,.28)", text: "#10B981" }),
    HOLD: Object.freeze({ bg: "rgba(245,158,11,.12)",  border: "rgba(245,158,11,.28)",  text: "#F59E0B" }),
    SKIP: Object.freeze({ bg: "rgba(239,68,68,.12)",   border: "rgba(239,68,68,.28)",   text: "#EF4444" }),
  });

  const VS_ROW_H = 44;
  const VS_BUF   = 8;

  return Object.freeze({
    STATUSES, STATUS_LABELS, ACTIVE_STATUSES,
    MARKETS, MARKET_LABELS, MARKET_COLORS, MARKET_CHART_COLORS,
    VERDICT_COLORS, VS_ROW_H, VS_BUF,
  });
})();
