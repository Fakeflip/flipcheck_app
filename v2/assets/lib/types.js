// @ts-check
/* Flipcheck v2 — Shared JSDoc type definitions
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  THIS FILE CONTAINS NO RUNTIME CODE.                            ║
 * ║  It is a pure JSDoc @typedef hub used by the TypeScript         ║
 * ║  language server (checkJs: true in jsconfig.json) to provide    ║
 * ║  rich IDE intellisense across all renderer scripts.             ║
 * ║                                                                  ║
 * ║  Because all files use the global-script pattern (IIFEs, no     ║
 * ║  ES module imports), @typedef declarations here are available   ║
 * ║  project-wide without explicit imports.                         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Naming convention:  FC_<TypeName>
 * Load order:  types.js must be in jsconfig "include" (it already is).
 *              Do NOT add a <script> tag for this file in index.html.
 */

"use strict";

// ── Primitive aliases ──────────────────────────────────────────────────────────

/**
 * Canonical market key — the value stored in `item.market`.
 * @typedef {'ebay' | 'amz' | 'kaufland' | 'other'} FC_Market
 */

/**
 * Inventory lifecycle status — the value stored in `item.status`.
 * @typedef {'IN_STOCK' | 'LISTED' | 'LISTING_PENDING' | 'INBOUND' | 'SOLD' | 'RETURN' | 'ARCHIVED'} FC_Status
 */

/**
 * Flipcheck recommendation verdict.
 * @typedef {'BUY' | 'HOLD' | 'SKIP'} FC_Verdict
 */

// ── Inventory ─────────────────────────────────────────────────────────────────

/**
 * A single item in the Flipcheck inventory store.
 * Written by `normalizeItem()` in main.js and stored in `inventory.json`.
 *
 * @typedef {Object} FC_InventoryItem
 * @property {string}       id          - Unique item ID (20-char hex, from crypto.randomBytes)
 * @property {string}       created_at  - ISO 8601 creation timestamp
 * @property {string}       updated_at  - ISO 8601 last-update timestamp
 * @property {string}       title       - Product title / description
 * @property {string}       ean         - EAN-13 barcode string (or "" if unknown)
 * @property {string}       sku         - Internal SKU (defaults to ean)
 * @property {string}       label       - User-defined label / colour tag
 * @property {string}       notes       - Free-text notes
 * @property {string}       source      - Item origin: "manual" | "extension" | "csv" | ""
 * @property {FC_Market}    market      - Target marketplace
 * @property {FC_Status}    status      - Lifecycle status
 * @property {number}       qty         - Unit quantity (integer ≥ 1)
 * @property {number|null}  ek          - Purchase price (EK) in EUR, null if unknown
 * @property {string|null}  ek_date     - Purchase date ISO string — used in "days to cash" analytics
 * @property {number|null}  sell_price  - Actual sell price (VK) in EUR, null if unsold
 * @property {number}       ship_out    - Outbound shipping cost in EUR (0 if none)
 * @property {string|null}  sold_at     - ISO timestamp of sale (null while unsold)
 * @property {string}       cat_id      - eBay fee category ID (e.g. "sonstiges", "handys")
 */

// ── Price History ─────────────────────────────────────────────────────────────

/**
 * A single price / sales data point for one product.
 *
 * @typedef {Object} FC_PriceEntry
 * @property {string}       ts              - ISO timestamp of the entry
 * @property {number}       [browse_median] - Median price from a live Browse API check (€)
 * @property {number}       [research_avg]  - Daily avg sold price from Research/metricsTrends (€)
 * @property {number|null}  [qty]           - Daily units sold from Research series (null if unknown)
 * @property {boolean}      [from_series]   - true when entry came from metricsTrends batch save
 */

/**
 * Full price history record for one EAN, as stored in `price_history.json`.
 *
 * @typedef {Object} FC_PriceHistory
 * @property {string}          ean     - EAN-13 identifier
 * @property {string}          title   - Product title (updated on each check)
 * @property {FC_PriceEntry[]} entries - Chronological price / sales entries (max 365)
 */

/**
 * Lightweight summary of one EAN's history — returned by `Storage.listHistory()`.
 *
 * @typedef {Object} FC_PriceHistorySummary
 * @property {string}      ean        - EAN-13 identifier
 * @property {string}      title      - Product title
 * @property {number}      count      - Number of stored entries
 * @property {string|null} last_ts    - ISO timestamp of the most recent entry
 * @property {number|null} last_price - Most recent `browse_median` price (€), or null
 */

// ── Settings ──────────────────────────────────────────────────────────────────

/**
 * Persisted app settings (stored in `settings_v2.json` via settingsStore.js).
 * All fields are optional — default values are applied at the point of use.
 *
 * @typedef {Object} FC_Settings
 * @property {string}  [mode]                 - Runtime mode: "local" | "remote"
 * @property {string}  [vat_mode]             - VAT calculation mode ("gross" | "net")
 * @property {string}  [default_market]       - Pre-selected market for new inventory items
 * @property {string}  [default_cat_id]       - Pre-selected eBay fee category
 * @property {string}  [ebay_username]        - User's own eBay seller name (for competition filter)
 * @property {string}  [webhook_url]          - Discord webhook URL for event notifications
 * @property {Record<string, boolean>} [webhook_events] - Event flags: { undercut, new_listing, … }
 * @property {number}  [monitor_interval_min] - Competition monitor check interval (minutes)
 */

// ── Seller / Competition tracker ──────────────────────────────────────────────

/**
 * A seller being tracked in the competition monitor.
 *
 * @typedef {Object} FC_TrackedSeller
 * @property {string}       username         - eBay seller ID / username
 * @property {string}       added_at         - ISO timestamp when tracking started
 * @property {number|null}  listing_count    - Last-known active listing count (null = not yet checked)
 * @property {string}       [last_checked]   - ISO timestamp of most recent monitor check
 * @property {number|null}  [feedback_score] - eBay numeric feedback score
 * @property {number|null}  [feedback_pct]   - eBay positive feedback percentage (0–100)
 */

/**
 * Status snapshot returned by `Storage.monitorStatus()`.
 *
 * @typedef {Object} FC_MonitorStatus
 * @property {boolean}     active       - Whether the background monitor timer is running
 * @property {boolean}     running      - Whether a monitor check is currently executing
 * @property {string|null} lastRun      - ISO timestamp of the last completed check
 * @property {number}      intervalMin  - Monitor check interval in minutes
 * @property {boolean}     webhookSet   - Whether a Discord webhook URL is configured
 */

// ── Price Alerts ──────────────────────────────────────────────────────────────

/**
 * A price alert for one product EAN.
 *
 * @typedef {Object} FC_Alert
 * @property {string}            id            - Unique alert ID
 * @property {string}            ean           - EAN-13 being monitored
 * @property {string}            [title]       - Product title (for display only)
 * @property {'above'|'below'}   condition     - Trigger direction
 * @property {number}            target        - Target price threshold in EUR
 * @property {string}            created_at    - ISO creation timestamp
 * @property {string|null}       [triggered_at] - ISO timestamp of last trigger (null = never)
 */

// ── Analytics ─────────────────────────────────────────────────────────────────

/**
 * One week's profit entry in the 12-week trend chart.
 *
 * @typedef {Object} FC_WeeklyProfitEntry
 * @property {string} label  - ISO week label, e.g. "KW12"
 * @property {number} profit - Total profit for the week in EUR (may be negative)
 */

/**
 * Full analytics result computed by `Storage.calcInventoryAnalytics()`.
 *
 * @typedef {Object} FC_InventoryAnalytics
 * @property {number}                   soldCount      - Total sold units (qty-weighted, e.g. 3 records × qty=2 → 6)
 * @property {number}                   soldRecords    - Number of SOLD item records (for list rendering)
 * @property {number}                   activeCount    - Active (IN_STOCK / LISTED / LISTING_PENDING) record count
 * @property {number}                   totalCount     - All items including archived
 * @property {number}                   totalProfit    - Cumulative real profit in EUR (qty-weighted)
 * @property {number}                   totalRevenue   - Total sell-price revenue in EUR (qty-weighted)
 * @property {number}                   totalCost      - Total purchase cost in EUR (qty-weighted)
 * @property {number}                   avgRoi         - Qty-weighted average ROI in percent
 * @property {number}                   activeCash     - Capital currently tied up in active items (EUR)
 * @property {number}                   avgDaysToCash  - Average calendar days from purchase to sale
 * @property {FC_WeeklyProfitEntry[]}   weeklyProfit   - Last 12 calendar weeks of profit
 * @property {Record<string, number>}   marketSplit    - Item record count per market key
 * @property {FC_InventoryItem[]}       bestFlips      - Top-5 most profitable item records
 * @property {FC_InventoryItem[]}       worstFlips     - Bottom-5 least profitable item records
 */

// ── API ───────────────────────────────────────────────────────────────────────

/**
 * Standard response wrapper from `API.call()`.
 *
 * @typedef {Object} FC_ApiResponse
 * @property {boolean} ok     - true if HTTP status was 2xx
 * @property {number}  status - HTTP status code
 * @property {*}       data   - Parsed JSON response body, or null on parse error
 */

/**
 * Response payload from `POST /flipcheck`.
 *
 * @typedef {Object} FC_FlipcheckResult
 * @property {FC_Verdict}  verdict              - BUY / HOLD / SKIP recommendation
 * @property {number}      [sell_price_median]  - eBay median sell price (€)
 * @property {number}      [profit_median]      - Projected profit at the median VK (€)
 * @property {number}      [margin_pct]         - Profit margin as a percentage
 * @property {number}      [sales_30d]          - Estimated units sold in last 30 days
 * @property {string}      [title]              - Product title from eBay
 * @property {Array<[number, number]>} [price_series] - [[epoch_ms, price], …] up to 90 days
 */

// ── UI helpers ────────────────────────────────────────────────────────────────

/**
 * One button in a `Modal.open()` footer.
 *
 * @typedef {Object} FC_ModalButton
 * @property {string}    label      - Button label text
 * @property {string}    [variant]  - CSS class, e.g. "btn-primary" | "btn-danger" | "btn-ghost"
 * @property {*}         [value]    - Value passed to the resolved Promise when clicked
 * @property {Function}  [action]   - Custom callback (bypasses value resolution)
 */

/**
 * Options object passed to `Modal.open()`.
 *
 * @typedef {Object} FC_ModalOptions
 * @property {string}              title      - Modal title text
 * @property {string|HTMLElement}  body       - Modal body: HTML string or a DOM element
 * @property {FC_ModalButton[]}    [buttons]  - Footer action buttons (default: none)
 * @property {number|string}       [width]    - Custom modal width in px or any CSS value
 */

/**
 * Per-market colour tokens used for inline badge styling.
 *
 * @typedef {Object} FC_MarketColor
 * @property {string} bg     - CSS rgba background colour
 * @property {string} border - CSS rgba border colour
 * @property {string} text   - CSS hex text colour
 */

/**
 * eBay tiered fee entry: [upper_threshold_eur_or_null, rate_decimal]
 * @typedef {[number|null, number]} FC_EbayFeeTier
 */

/**
 * One entry in the `EBAY_FEE_CATEGORIES` array defined in `app.js`.
 *
 * @typedef {Object} FC_EbayFeeCategory
 * @property {string}           id    - Category identifier (matches `item.cat_id`)
 * @property {string}           label - Human-readable German label shown in dropdowns
 * @property {FC_EbayFeeTier[]} tiers - Fee tiers applied left-to-right on the gross price
 */
