"""
Flipcheck — Amazon / Keepa Integration
Provides ASIN lookup via Keepa API and Amazon profit calculation.
"""
from __future__ import annotations

import asyncio
import os
import time
import math
from typing import Optional, Dict, Any, List, Tuple

import httpx

KEEPA_API_BASE = "https://api.keepa.com"
# Read dynamically at call time so load_dotenv() called after module import still works.
def _keepa_key() -> str:
    return os.environ.get("KEEPA_API_KEY", "")

# Keepa price divisor (prices stored as int * 100, -1 = unavailable)
KEEPA_DIV = 100.0

# Amazon Referral Fee by category (approximate DE rates)
AMAZON_REFERRAL_FEES: Dict[str, float] = {
    "computer_tablets":    0.07,
    "handys":              0.07,
    "konsolen":            0.08,
    "foto_camcorder":      0.07,
    "tv_video_audio":      0.07,
    "haushaltsgeraete":    0.07,
    "drucker":             0.07,
    "handy_zubehoer":      0.15,
    "notebook_zubehoer":   0.15,
    "kabel":               0.15,
    "mode":                0.15,
    "sport_freizeit":      0.15,
    "spielzeug":           0.15,
    "buecher":             0.15,
    "sonstiges":           0.15,
}

# FBA Fee tiers (size → (weight_kg, fee_eur))
# Simplified DE FBA fee table (2024)
FBA_TIERS = [
    # (max_weight_kg, max_longest_side_cm, fee_eur, label)
    (0.20,  20, 2.70, "Klein Standard"),
    (0.40,  30, 3.00, "Klein Standard+"),
    (0.90,  33, 3.40, "Standard 1"),
    (1.50,  33, 3.80, "Standard 2"),
    (3.00,  45, 4.70, "Groß 1"),
    (5.00,  61, 5.40, "Groß 2"),
    (9.00,  61, 6.50, "Groß 3"),
    (15.0,  74, 8.10, "Groß 4"),
    (None, None, 9.80, "Schwer/Sperrig"),  # catch-all
]

# In-memory Keepa cache: asin → (ts, data)
_keepa_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
KEEPA_CACHE_TTL = 30 * 60  # 30 minutes

# ─── Product Signal Classification ───────────────────────────────────────────

MELTABLE_KEYWORDS = [
    "schokolade", "chocolate", "schoki", "praline", "bonbon", "candy",
    "gummi", "gummy", "wachs", "wax", "kerze", "candle", "kakaobutter",
    "nougat", "marshmallow", "karamell", "caramel", "fudge", "toffee",
    "marzipan", "fondant", "lippenstift", "lipstick", "bienenwachs",
]

HAZMAT_KEYWORDS = [
    "batterie", "battery", "akku", "batteries", "lithium", "lithium-ion",
    "aerosol", "spray", "gas ", "lösungsmittel", "solvent", "brennbar",
    "flammable", "oxidierend", "oxidizing", "säure", "acid", "bleiche",
    "bleach", "farbe", "lack ", "paint", "treibgas", "propellant",
    "entzündlich", "kerosin", "petrol", "benzin",
]

IP_RISK_KEYWORDS = [
    "original", "authentic", "genuine", "echt", "licensed", "lizenziert",
    "official", "offiziell", "trademark", "patented", "patentiert",
    "exclusive", "exklusiv",
]

# Well-known brands that frequently send IP complaints on Amazon.de
HIGH_IP_RISK_BRANDS = [
    "disney", "nintendo", "lego", "pokemon", "apple", "sony", "samsung",
    "adidas", "nike", "puma", "louis vuitton", "gucci", "rolex", "chanel",
    "marvel", "dc comics", "mattel", "hasbro", "barbie",
]

# Amazon.de category keywords that are typically gated / require approval
GATED_CAT_KEYWORDS = [
    "beauty", "kosmetik", "health", "gesundheit", "nahrungsergänzung",
    "supplement", "vitamin", "apotheke", "pharmacy", "schmuck", "uhren",
    "watches", "jewelry", "adult", "erotik", "automotive",
    "collectible", "sammlerware", "wine", "wein", "spirits", "alkohol",
]


def classify_signals(
    product:  Dict[str, Any],
    stats:    Dict[str, Any],
    offers:   List[Dict[str, Any]],
    category: str,
) -> Dict[str, Any]:
    """
    Derive SellerAmp-style product signals from Keepa data.
    Returns a dict to be embedded in the amazon_check() response as 'signals'.
    """
    title        = (product.get("title")        or "").lower()
    brand        = (product.get("brand")        or "").lower()
    product_grp  = (product.get("productGroup") or "").lower()
    category_tree = product.get("categoryTree") or []
    cat_text     = " ".join((n.get("name") or "").lower() for n in category_tree)

    # ── 1. Buybox Owner ──────────────────────────────────────────────────────
    current  = stats.get("current") or []
    amz_raw  = current[0]  if len(current) > 0  else -1
    bb_raw   = current[18] if len(current) > 18 else -1

    amz_price = None if (not amz_raw  or amz_raw  < 0) else round(amz_raw  / 100.0, 2)
    bb_price  = None if (not bb_raw   or bb_raw   < 0) else round(bb_raw   / 100.0, 2)

    # Amazon holds buybox when Amazon's own listing price ≤ buy-box price
    buybox_is_amazon = bool(
        amz_price is not None and
        bb_price  is not None and
        amz_price <= bb_price * 1.02
    )

    # ── 2. Variations (already from main function — passed in for signal scoring)
    variation_asins = product.get("variations") or product.get("variationList") or []
    variation_count = len(variation_asins)

    # ── 3. Private Label Detection ───────────────────────────────────────────
    new_count   = sum(1 for o in offers if o.get("condition") == 1)
    avg30       = stats.get("avg30") or []
    avg_new_raw = avg30[1] if len(avg30) > 1 else -1
    avg_new_val = (avg_new_raw / 100.0) if (avg_new_raw and avg_new_raw > 0) else new_count

    pl_score = 0
    if new_count   <= 2: pl_score += 3
    elif new_count <= 5: pl_score += 1
    if avg_new_val <= 3: pl_score += 1
    if brand and len(brand) > 3 and brand in title: pl_score += 1

    if pl_score >= 4:
        pl_risk = "likely"
        pl_text = f"Wenige historische Verkäufer (Zeichen für Private Label)"
    elif pl_score >= 2:
        pl_risk = "possible"
        pl_text = f"Mögliches Private Label ({new_count} aktive Anbieter)"
    else:
        pl_risk = "unlikely"
        pl_text = f"Kein Private Label-Risiko ({new_count} Anbieter)"

    # ── 4. IP Risk ───────────────────────────────────────────────────────────
    ip_score = 0
    if any(b in brand for b in HIGH_IP_RISK_BRANDS):        ip_score += 3
    if any(kw in title for kw in IP_RISK_KEYWORDS):          ip_score += 2
    if pl_score >= 4:                                         ip_score += 1  # few sellers = possible brand protection

    if ip_score >= 3:
        ip_risk = "high"
        ip_text = "Wahrscheinlich IP"
    elif ip_score >= 1:
        ip_risk = "medium"
        ip_text = "Mögliches IP-Risiko"
    else:
        ip_risk = "low"
        ip_text = "Kein IP-Risiko erkannt"

    # ── 5. Product Size / FBA Tier ───────────────────────────────────────────
    weight_g   = product.get("packageWeight") or 0
    dim_h      = product.get("packageHeight") or 0
    dim_w      = product.get("packageWidth")  or 0
    dim_l      = product.get("packageLength") or 0

    weight_kg  = (weight_g / 1000.0) if weight_g > 0 else 0.5
    longest_cm = max(dim_h, dim_w, dim_l) / 10.0 if max(dim_h, dim_w, dim_l) > 0 else 20.0

    _, size_tier = calc_fba_fee(weight_kg, longest_cm)
    is_oversize  = any(x in size_tier for x in ["Groß", "Schwer", "Sperrig"])

    # ── 6. Meltable ──────────────────────────────────────────────────────────
    full_text    = f"{title} {product_grp} {cat_text}"
    is_meltable  = any(kw in full_text for kw in MELTABLE_KEYWORDS)

    # ── 7. Hazmat / Dangerous Goods ──────────────────────────────────────────
    is_hazmat = any(kw in full_text for kw in HAZMAT_KEYWORDS)

    # ── 8. Ungated Status (heuristic by category) ────────────────────────────
    is_gated = any(gc in cat_text or gc in product_grp or gc in category
                   for gc in GATED_CAT_KEYWORDS)

    status = "locked" if is_gated else "open"
    ungated_markets = {
        "SE": status, "PL": status, "BE": status,
        "IT": status, "DE": status, "ES": status,
        "FR": status, "NL": status, "GB": status,
    }

    return {
        "buybox_is_amazon": buybox_is_amazon,
        "variation_count":  variation_count,
        "pl_risk":          pl_risk,
        "pl_text":          pl_text,
        "ip_risk":          ip_risk,
        "ip_text":          ip_text,
        "size_tier":        size_tier,
        "is_oversize":      is_oversize,
        "weight_kg":        round(weight_kg, 2),
        "is_meltable":      is_meltable,
        "is_hazmat":        is_hazmat,
        "ungated_markets":  ungated_markets,
    }

# ─── Amazon Deal Scanner — Category catalogue & helpers ───────────────────────

# Keyword-based categories — same pattern as the eBay deal scanner.
# Keepa /search works on the standard subscriber plan (no Data Plan needed).
AMZ_SCAN_CATS: Dict[str, Dict[str, Any]] = {
    "gaming": {
        "label": "Games & Konsolen",
        "terms": [
            "Nintendo Switch OLED", "PS5 Controller DualSense", "Xbox Wireless Controller",
            "LEGO Technic Set", "LEGO Star Wars", "Pokemon Karten Display",
        ],
    },
    "elektronik": {
        "label": "Elektronik",
        "terms": [
            "AirPods Pro 2", "Sony WH-1000XM5", "Bose QuietComfort 45",
            "JBL Charge 5", "Anker PowerBank 20000", "Sonos Era 100",
        ],
    },
    "computer": {
        "label": "Computer & Zubehör",
        "terms": [
            "Samsung SSD 870 EVO", "Logitech MX Master 3", "Crucial RAM DDR4",
            "WD Blue SSD", "Elgato Stream Deck", "ASUS ROG Strix",
        ],
    },
    "spielzeug": {
        "label": "Spielzeug",
        "terms": [
            "LEGO City Set", "LEGO Creator Expert", "Hot Wheels Premium",
            "Playmobil Großes Set", "Schleich Farm World",
        ],
    },
    "sport": {
        "label": "Sport & Fitness",
        "terms": [
            "Garmin Forerunner 255", "Theragun Mini", "Fitbit Charge 6",
            "Polar Vantage M2", "Wahoo TICKR",
        ],
    },
}

# Search-result cache: term → (ts, [asin, ...])
_search_cache: Dict[str, Tuple[float, List[str]]] = {}
SEARCH_CACHE_TTL = 30 * 60  # 30 min


async def keepa_search_de(term: str, limit: int = 20) -> List[str]:
    """Search Keepa for ASINs matching a keyword on Amazon.de.
    Uses /search endpoint — available on standard subscriber plan.
    """
    cached = _search_cache.get(term)
    if cached and time.time() - cached[0] < SEARCH_CACHE_TTL:
        return cached[1]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{KEEPA_API_BASE}/search", params={
                "key":    _keepa_key(),
                "domain": "3",
                "type":   "product",
                "term":   term,
            })
            r.raise_for_status()
            asins = (r.json().get("asinList") or [])[:limit]
    except Exception as e:
        print(f"[KEEPA-SEARCH] '{term}': {e}")
        return []

    _search_cache[term] = (time.time(), asins)
    return asins


async def keepa_batch_stats(asins: List[str]) -> List[Dict[str, Any]]:
    """Batch Keepa product lookup — 90-day stats only, no price history.
    More token-efficient than keepa_lookup (history=0). Max 100 ASINs per call.
    """
    key = _keepa_key()
    if not asins or not key:
        return []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{KEEPA_API_BASE}/product", params={
                "key":     key,
                "domain":  "3",
                "asin":    ",".join(asins),
                "stats":   "90",
                "history": "0",
            })
            r.raise_for_status()
            return r.json().get("products") or []
    except Exception as e:
        print(f"[KEEPA-BATCH] {e}")
        return []


def _keepa_price(raw: int) -> Optional[float]:
    """Convert Keepa raw price integer to EUR float. Returns None if unavailable."""
    if raw is None or raw < 0:
        return None
    return round(raw / KEEPA_DIV, 2)


def _csv_to_series(csv: Optional[List[int]], max_points: int = 90, days: int = 90) -> List[List]:
    """
    Convert Keepa CSV price series [ts1, price1, ts2, price2, ...] to
    [[epoch_ms, price_eur], ...].
    - Filters unavailable (-1) prices.
    - Filters to last `days` days only (default 90).
    - Applies price sanity bounds (> €0.10, < €9 999).
    """
    if not csv or len(csv) < 2:
        return []

    KEEPA_EPOCH_OFFSET = 21564000  # Keepa minutes since Jan 1, 2011

    # Compute cutoff timestamp in Keepa-minutes
    cutoff_keepa = (time.time() / 60) - KEEPA_EPOCH_OFFSET - (days * 24 * 60)

    result = []
    for i in range(0, len(csv) - 1, 2):
        keepa_ts  = csv[i]
        raw_price = csv[i + 1]
        if raw_price < 0:              # -1 = unavailable
            continue
        if keepa_ts < cutoff_keepa:    # older than cutoff
            continue
        price = round(raw_price / KEEPA_DIV, 2)
        if price < 0.10 or price > 9_999:   # sanity bounds
            continue
        epoch_ms = (keepa_ts + KEEPA_EPOCH_OFFSET) * 60 * 1000
        result.append([epoch_ms, price])

    # Downsample to max_points if needed
    if len(result) > max_points:
        step = len(result) / max_points
        result = [result[int(i * step)] for i in range(max_points)]

    return result


def _csv_to_rank_series(rank_csv: Optional[List[int]], max_points: int = 365, days: int = 365) -> List[List]:
    """
    Convert Keepa rank CSV to [[epoch_ms, rank], ...] series for charting.
    Filters -1 (unavailable) entries. Defaults to last 365 days.
    """
    if not rank_csv or len(rank_csv) < 2:
        return []
    KEEPA_EPOCH_OFFSET = 21564000
    cutoff_keepa = (time.time() / 60) - KEEPA_EPOCH_OFFSET - (days * 24 * 60)
    result = []
    for i in range(0, len(rank_csv) - 1, 2):
        keepa_ts = rank_csv[i]
        rank     = rank_csv[i + 1]
        if rank < 0 or keepa_ts < cutoff_keepa:
            continue
        epoch_ms = (keepa_ts + KEEPA_EPOCH_OFFSET) * 60 * 1000
        result.append([epoch_ms, rank])
    if len(result) > max_points:
        step   = len(result) / max_points
        result = [result[int(i * step)] for i in range(max_points)]
    return result


def _count_bsr_drops(rank_csv: Optional[List[int]], days: int = 30, threshold_pct: float = 0.25) -> Dict[str, Any]:
    """
    Count significant BSR improvements (rank NUMBER drops) in the last N days.
    A drop = rank goes from a high number to a low number by ≥ threshold_pct.
    Each such event indicates a burst of sales activity.
    Returns dict: drops_count, min_rank, max_rank, rank_series_30d (for chart)
    """
    if not rank_csv or len(rank_csv) < 4:
        return {"drops_count": 0, "min_rank": None, "max_rank": None}

    KEEPA_EPOCH_OFFSET = 21564000
    cutoff_keepa = (time.time() / 60) - KEEPA_EPOCH_OFFSET - (days * 24 * 60)

    points: List[Tuple[int, int]] = []
    for i in range(0, len(rank_csv) - 1, 2):
        keepa_ts = rank_csv[i]
        rank     = rank_csv[i + 1]
        if rank > 0 and keepa_ts >= cutoff_keepa:
            points.append((keepa_ts, rank))

    if not points:
        return {"drops_count": 0, "min_rank": None, "max_rank": None}

    drops = 0
    for i in range(1, len(points)):
        prev_rank = points[i - 1][1]
        curr_rank = points[i][1]
        if prev_rank > 0 and curr_rank > 0:
            improvement = (prev_rank - curr_rank) / prev_rank
            if improvement >= threshold_pct:
                drops += 1

    ranks = [r for _, r in points]
    return {
        "drops_count": drops,
        "min_rank":    min(ranks),
        "max_rank":    max(ranks),
    }


def _estimate_monthly_sales(sales_rank: Optional[int], category: str) -> int:
    """
    Rough sales velocity estimate from sales rank.
    Calibrated for Amazon.de (~1/10 the volume of Amazon.com).
    Amazon.de shows "100+ per month" badge at rank ~10-20 in most categories.
    """
    if sales_rank is None or sales_rank <= 0:
        return 0

    # Amazon.de calibrated curve:
    # BSR ≤ 20   → ~150/month  (Amazon shows "100+" badge)
    # BSR ≤ 100  → ~80/month
    # BSR ≤ 500  → ~40/month
    # BSR ≤ 1k   → ~20/month
    # BSR ≤ 5k   → ~10/month
    # BSR ≤ 10k  → ~5/month
    # BSR ≤ 50k  → ~2/month
    # BSR ≤ 100k → ~1/month
    if sales_rank <= 20:
        return 150
    elif sales_rank <= 100:
        return 80
    elif sales_rank <= 500:
        return 40
    elif sales_rank <= 1_000:
        return 20
    elif sales_rank <= 5_000:
        return 10
    elif sales_rank <= 10_000:
        return 5
    elif sales_rank <= 50_000:
        return 2
    elif sales_rank <= 100_000:
        return 1
    else:
        return 0


def calc_fba_fee(weight_kg: float = 0.5, longest_side_cm: float = 20.0) -> Tuple[float, str]:
    """Return (fba_fee_eur, tier_label) for given dimensions."""
    for max_w, max_side, fee, label in FBA_TIERS:
        if max_w is None:  # catch-all
            return fee, label
        if weight_kg <= max_w and longest_side_cm <= max_side:
            return fee, label
    return 9.80, "Schwer/Sperrig"


def calc_amazon_profit(
    sell_price:     float,
    ek:             float,
    category:       str   = "sonstiges",
    method:         str   = "fba",
    ship_in:        float = 0.0,
    fba_fee:        float = 3.40,  # default small standard
    referral_pct:   Optional[float] = None,
    prep_fee:       float = 0.0,   # PREP/Labeling service fee per unit
    vat_mode:       str   = "no_vat",  # "no_vat" | "ust_19"
    ek_mode:        str   = "gross",   # "gross" | "net"
) -> Dict[str, float]:
    """
    Amazon Revenue Calculator logic (matches Amazon's own calculator exactly):

    vat_mode="ust_19" (USt.-pflichtig):
      - sell_net  = sell_price / 1.19  (customer brutto → netto Erlös)
      - ref_fee   = sell_net × ref_pct  (Referral auf NETTO, wie Amazon)
      - fba_fee   = fba_fee / 1.19      (Amazon-Fees werden netto ausgewiesen)
      - ek_net    = ek / 1.19           (wenn ek_mode="gross")
      - ship_in   = ship_in / 1.19
      - profit    = sell_net - ref_fee - fba_fee_net - ship_in_net - prep_fee - ek_net

    vat_mode="no_vat" (Kleinunternehmer / kein Vorsteuerabzug):
      - Alles bleibt brutto (keine Umrechnung), ref_fee auf Brutto-VK.

    FBM fix: ship_in ist Versand pro Einheit → nur einmal in total_fees,
    NICHT nochmal vom profit abgezogen.
    """
    vat = 1.19 if vat_mode == "ust_19" else 1.0

    # Netto-Erlös (Basis für alle Berechnungen bei USt.-Pflicht)
    sell_net    = round(sell_price / vat, 2)

    # EK und Versand → netto
    ek_net      = round((ek      / vat) if (vat_mode == "ust_19" and ek_mode == "gross") else ek, 2)
    ship_in_net = round((ship_in / vat) if vat_mode == "ust_19" else ship_in, 2)

    # FBA-Fee: Amazon veröffentlicht Fees netto (zzgl. MwSt.) → netto umrechnen
    fba_fee_net = round(fba_fee / vat, 2) if vat_mode == "ust_19" else fba_fee

    ref_pct = referral_pct if referral_pct is not None else AMAZON_REFERRAL_FEES.get(category, 0.15)
    # Referral Fee auf NETTO-VK (wie Amazon Revenue Calculator)
    ref_fee = round(sell_net * ref_pct, 2)

    if method == "fba":
        fulfillment_fee = fba_fee_net
        ship_out_fee    = 0.0
        inbound_cost    = ship_in_net  # FBA: Einlieferungskosten separat
    else:  # fbm
        fulfillment_fee = 0.0
        ship_out_fee    = ship_in_net  # FBM: Versand pro Einheit in total_fees
        inbound_cost    = 0.0          # bereits in total_fees — kein doppelter Abzug

    total_fees = ref_fee + fulfillment_fee + ship_out_fee + prep_fee
    profit     = round(sell_net - total_fees - ek_net - inbound_cost, 2)
    margin_pct = round((profit / sell_net * 100) if sell_net > 0 else 0, 1)

    return {
        "sell_net":        sell_net,
        "referral_fee":    ref_fee,
        "referral_pct":    round(ref_pct * 100, 1),
        "fulfillment_fee": fulfillment_fee,
        "ship_out_fee":    ship_out_fee,
        "ship_in_net":     ship_in_net,
        "prep_fee":        round(prep_fee, 2),
        "total_fees":      round(total_fees, 2),
        "ek_net":          ek_net,
        "profit":          profit,
        "margin_pct":      margin_pct,
    }


def decide_amazon(profit: float, margin_pct: float, sales_30d: int, mode: str) -> str:
    """BUY/HOLD/SKIP verdict for Amazon based on mode thresholds."""
    thresholds = {
        "low":  {"min_profit": 15.0, "min_margin": 25.0, "min_sales": 5},
        "mid":  {"min_profit": 10.0, "min_margin": 15.0, "min_sales": 3},
        "high": {"min_profit":  5.0, "min_margin":  8.0, "min_sales": 1},
    }
    t = thresholds.get(mode, thresholds["mid"])
    if profit >= t["min_profit"] and margin_pct >= t["min_margin"] and sales_30d >= t["min_sales"]:
        return "BUY"
    if profit > 0 and margin_pct > 0:
        return "HOLD"
    return "SKIP"


async def keepa_lookup(asin: str) -> Optional[Dict[str, Any]]:
    """
    Fetch product data from Keepa API.
    Returns raw Keepa product dict or None on error.
    Caches results for 30 minutes.
    """
    key = _keepa_key()
    if not key:
        return None

    # Check cache
    cached = _keepa_cache.get(asin)
    if cached:
        ts, data = cached
        if time.time() - ts < KEEPA_CACHE_TTL:
            return data

    params = {
        "key":      key,
        "domain":   "3",   # Amazon.de
        "asin":     asin,
        "stats":    "90",  # stats for last 90 days
        "offers":   "20",  # fetch current offers
        "history":  "1",   # price history
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(f"{KEEPA_API_BASE}/product", params=params)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        print(f"[KEEPA-ERR] {asin}: {e}")
        return None

    products = data.get("products")
    if not products:
        return None

    product = products[0]
    _keepa_cache[asin] = (time.time(), product)
    return product


# Keepa domain codes for EU/key Amazon marketplaces
_INTL_DOMAINS: Dict[str, str] = {
    "FR": "6",
    "UK": "4",
    "IT": "8",
    "ES": "9",
    "NL": "11",
    "PL": "13",
}
_intl_price_cache: Dict[str, Tuple[float, Dict[str, Optional[float]]]] = {}
_INTL_CACHE_TTL = 1800  # 30 min

async def _fetch_one_intl_price(asin: str, country: str, domain: str, client: "httpx.AsyncClient") -> Tuple[str, Optional[float]]:
    """Fetch current buy box price for one marketplace. Returns (country, price_eur_or_local)."""
    key = _keepa_key()
    try:
        r = await client.get(
            f"{KEEPA_API_BASE}/product",
            params={"key": key, "domain": domain, "asin": asin, "stats": "30", "history": "0"},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        products = data.get("products")
        if not products:
            return country, None
        p = products[0]
        stats = p.get("stats") or {}
        # buyBoxPrice: index 18 in csv, but stats gives current values
        buy_box = stats.get("current") and stats["current"][18]  # buyBox
        if buy_box is None or buy_box < 0:
            buy_box = stats.get("current") and stats["current"][0]   # NEW price
        if buy_box is not None and buy_box > 0:
            return country, round(buy_box / KEEPA_DIV, 2)
        return country, None
    except Exception:
        return country, None


async def fetch_intl_prices(asin: str) -> Dict[str, Optional[float]]:
    """Fetch current buy box prices for key EU Amazon marketplaces in parallel."""
    cached = _intl_price_cache.get(asin)
    if cached:
        ts, data = cached
        if time.time() - ts < _INTL_CACHE_TTL:
            return data

    key = _keepa_key()
    if not key:
        return {}

    async with httpx.AsyncClient() as client:
        tasks = [
            _fetch_one_intl_price(asin, country, domain, client)
            for country, domain in _INTL_DOMAINS.items()
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    prices = {}
    for r in results:
        if isinstance(r, tuple):
            country, price = r
            if price is not None:
                prices[country] = price

    _intl_price_cache[asin] = (time.time(), prices)
    return prices


async def asin_from_ean(ean: str) -> Optional[str]:
    """Look up ASIN from EAN using Keepa."""
    key = _keepa_key()
    if not key:
        return None

    params = {
        "key":    key,
        "domain": "3",
        "type":   "product",
        "term":   ean,
        "field":  "ean",
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{KEEPA_API_BASE}/search", params=params)
            r.raise_for_status()
            data = r.json()
            asins = data.get("asinList", [])
            return asins[0] if asins else None
    except Exception as e:
        print(f"[KEEPA-ERR][ean→asin] {ean}: {e}")
        return None


async def amazon_check(
    asin:     str,
    ean:      Optional[str],
    ek:       float,
    mode:     str   = "mid",
    method:   str   = "fba",
    ship_in:  float = 0.0,   # FBA: inbound warehouse cost; FBM: per-unit outbound shipping
    category: str   = "sonstiges",
    prep_fee: float = 0.0,
    vat_mode: str   = "no_vat",  # "no_vat" | "ust_19"
    ek_mode:  str   = "gross",   # "gross" | "net"
) -> Dict[str, Any]:
    """
    Full Amazon profitability check for an ASIN.
    Returns a response dict compatible with the eBay flipcheck response shape.
    """
    product = await keepa_lookup(asin)

    if product is None:
        return {
            "ok":      False,
            "market":  "amazon",
            "asin":    asin,
            "verdict": "SKIP",
            "error":   "Keine Keepa-Daten — API-Key fehlt oder Produkt nicht gefunden.",
        }

    # ── Extract key data ──────────────────────────────────────────────────────
    title      = (product.get("title") or "").strip()
    csv        = product.get("csv") or []
    stats      = product.get("stats") or {}

    # Price arrays from csv (index reference):
    # 0=Amazon, 1=Marketplace New, 7=Marketplace Used, 10=collectible,
    # 18=Buy Box, 11=Sales Rank
    buy_box_csv  = csv[18] if len(csv) > 18 else []
    new_csv      = csv[1]  if len(csv) > 1  else []
    rank_csv     = csv[11] if len(csv) > 11 else []
    amz_csv      = csv[0]  if len(csv) > 0  else []

    # Current prices from stats
    current = stats.get("current") or {}
    buy_box_current = _keepa_price(current[18] if len(current) > 18 else -1)
    new_current     = _keepa_price(current[1]  if len(current) > 1  else -1)
    amz_current     = _keepa_price(current[0]  if len(current) > 0  else -1)

    # 30 and 90 day averages
    avg30 = stats.get("avg30") or []
    avg90 = stats.get("avg90") or []
    buy_box_avg30 = _keepa_price(avg30[18] if len(avg30) > 18 else -1)
    buy_box_avg90 = _keepa_price(avg90[18] if len(avg90) > 18 else -1)
    new_avg30     = _keepa_price(avg30[1]  if len(avg30) > 1  else -1)

    # Prefer 30-day average — more stable for flip decisions than current snapshot.
    sell_price = buy_box_avg30 or buy_box_current or new_avg30 or new_current or 0.0

    # Sales rank → monthly sales estimate
    rank_current = current[11] if len(current) > 11 else -1
    rank_val     = rank_current if (rank_current and rank_current > 0) else None

    # "X+ bought in past month" badge — Keepa field monthlySold, -1 = not available
    monthly_sold_raw = product.get("monthlySold", -1)
    if monthly_sold_raw and monthly_sold_raw > 0:
        sales_30d        = int(monthly_sold_raw)
        sales_30d_source = "badge"
    else:
        sales_30d        = _estimate_monthly_sales(rank_val, category)
        sales_30d_source = "bsr_estimate"

    # Offer counts
    offers    = product.get("offers") or []
    fba_count = sum(1 for o in offers if o.get("isFBA") and o.get("condition") == 1)
    new_count = sum(1 for o in offers if o.get("condition") == 1)

    # Variants — Keepa returns a list of ASIN strings for all variations
    variation_asins  = product.get("variations") or product.get("variationList") or []
    variation_count  = len(variation_asins) if variation_asins else 0

    # Product signals (buybox owner, PL, IP, size, hazmat, …)
    signals = classify_signals(product, stats, offers, category)

    # BSR drops in last 30 days (signals sales activity)
    bsr_info   = _count_bsr_drops(rank_csv, days=30)

    # ── 1 Drop = 1 Sale: integrate drops into sales estimate ────────────────
    # If sales come from BSR estimate (no badge), use drops as floor:
    # each rank drop = at least 1 sale event, so sales ≥ drops.
    drops_count = bsr_info.get("drops_count", 0) or 0
    if sales_30d_source == "bsr_estimate" and drops_count > 0:
        if sales_30d is None or drops_count > sales_30d:
            sales_30d = drops_count
            sales_30d_source = "bsr_drops"

    # Rank series for chart (BSR over time)
    rank_series = _csv_to_rank_series(rank_csv)

    # FBA fee (use Keepa's estimate if available, else default small standard)
    fba_fees_raw = product.get("fbaFees") or {}
    keepa_fba    = fba_fees_raw.get("pickAndPackFee")
    fba_fee_eur  = round(keepa_fba / KEEPA_DIV, 2) if keepa_fba and keepa_fba > 0 else 3.40

    # ── Profit calculation ────────────────────────────────────────────────────
    if sell_price <= 0:
        return {
            "ok":      False,
            "market":  "amazon",
            "asin":    asin,
            "title":   title,
            "verdict": "SKIP",
            "error":   "Kein aktueller Amazon-Preis verfügbar.",
            "buy_box": None,
        }

    calc = calc_amazon_profit(
        sell_price   = sell_price,
        ek           = ek,
        category     = category,
        method       = method,
        ship_in      = ship_in,
        fba_fee      = fba_fee_eur,
        prep_fee     = prep_fee,
        vat_mode     = vat_mode,
        ek_mode      = ek_mode,
    )

    verdict = decide_amazon(calc["profit"], calc["margin_pct"], sales_30d, mode)

    vat = 1.19 if vat_mode == "ust_19" else 1.0

    # ── Derived metrics ───────────────────────────────────────────────────────
    # ROI auf netto EK (investiertes Kapital)
    roi_pct = round((calc["profit"] / calc["ek_net"] * 100) if calc["ek_net"] > 0 else 0, 1)

    # Net payout: was Amazon auszahlt (netto Erlös minus Gebühren, ohne EK/Versand)
    net_payout = round(calc["sell_net"] - calc["referral_fee"] - calc["fulfillment_fee"] - calc["prep_fee"], 2)

    # Break-even: minimaler BRUTTO-Listenpreis damit Profit ≥ 0
    ref_pct_dec = AMAZON_REFERRAL_FEES.get(category, 0.15)
    _denom      = 1.0 - ref_pct_dec
    break_even_net = (
        (calc["fulfillment_fee"] + calc["prep_fee"] + calc["ek_net"] + calc["ship_in_net"]) / _denom
    ) if _denom > 0 else 0.0
    break_even = round(break_even_net * vat, 2)  # → brutto Listenpreis

    monthly_profit_est = round(calc["profit"] * sales_30d, 2) if sales_30d > 0 else 0.0
    days_to_cash       = round(30 / sales_30d, 1) if sales_30d > 0 else None

    # ── Price history series ──────────────────────────────────────────────────
    # Return up to 365 days so the 1J chart range is meaningful in the extension
    bb_series  = _csv_to_series(buy_box_csv if len(buy_box_csv) > 2 else new_csv, max_points=365, days=365)
    amz_series = _csv_to_series(amz_csv, max_points=365, days=365)

    # ── International prices (parallel Keepa calls for EU markets) ───────────
    intl_prices = await fetch_intl_prices(asin) if asin else {}

    # ── EAN list from Keepa ───────────────────────────────────────────────────
    ean_list = product.get("eanList") or []
    resolved_ean = ean or (ean_list[0] if ean_list else None)

    # ── Product image from Keepa imagesCSV ───────────────────────────────────
    imgs_csv = product.get("imagesCSV") or ""
    imgs = [i.strip() for i in imgs_csv.split(",") if i.strip()]
    product_image = f"https://images-na.ssl-images-amazon.com/images/I/{imgs[0]}" if imgs else None

    return {
        "ok":               True,
        "market":           "amazon",
        "asin":             asin,
        "ean":              resolved_ean,
        "title":            title,
        "verdict":          verdict,
        "product_image":    product_image,

        # Prices
        "sell_price_median": round(sell_price, 2),
        "sell_price_avg":    round(buy_box_avg90 or sell_price, 2),
        "buy_box":           buy_box_current,
        "buy_box_avg30":     buy_box_avg30,
        "sell_net":          calc["sell_net"],  # netto Erlös (buy_box / 1.19 wenn USt.)

        # Fees
        "referral_fee":      calc["referral_fee"],
        "referral_pct":      calc["referral_pct"],
        "fba_fee":           calc["fulfillment_fee"],
        "prep_fee":          calc["prep_fee"],
        "ship_in":           calc["ship_in_net"],  # net inbound/outbound shipping cost
        "ek_net":            calc["ek_net"],        # net EK after VAT conversion
        "total_fees":        calc["total_fees"],
        "fee":               calc["total_fees"],  # compat alias

        # Profit (reuse eBay field names for panel compat)
        "profit_median":     calc["profit"],
        "profit_avg":        calc["profit"],
        "margin_pct":        calc["margin_pct"],

        # Derived metrics
        "roi_pct":              roi_pct,
        "net_payout":           net_payout,
        "break_even":           break_even,
        "monthly_profit_est":   monthly_profit_est,
        "days_to_cash":         days_to_cash,

        # Competition
        "sales_30d":         sales_30d,
        "sales_30d_source":  sales_30d_source,  # "badge" | "bsr_estimate" | "bsr_drops"
        "sales_rank":        rank_val,
        "fba_count":         fba_count,
        "offer_count":       new_count,

        # Variants
        "variation_count":   variation_count,

        # BSR drops (buying signal)
        "bsr_drops_30d":     bsr_info["drops_count"],
        "bsr_min_30d":       bsr_info["min_rank"],
        "bsr_max_30d":       bsr_info["max_rank"],

        # Chart data
        "price_series":      bb_series,
        "amz_series":        amz_series,
        "rank_series":       rank_series,

        # International prices (current buy box per EU marketplace)
        "intl_prices":       intl_prices,

        # Product signals
        "signals":           signals,

        # Category info (for auto-detect on frontend)
        "category_name":     " > ".join((n.get("name") or "") for n in (product.get("categoryTree") or []) if n.get("name")),

        # Setup echo
        "method":            method,
        "ship_in":           ship_in,
        "ek":                ek,
        "mode":              mode,
    }
