from __future__ import annotations
import os
import time
import json
import logging
import re
import random
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from http.cookiejar import DefaultCookiePolicy
from urllib.parse import urlencode
import requests
from dotenv import load_dotenv
# =========================================================
# BOOT
# =========================================================
print(">>> EBAY_LIVE LOADED FROM:", __file__)
print("EBAY_LIVE PATH:", __file__)
logger = logging.getLogger("FLIPCHECK.eBay")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")
# =========================================================
# CONFIG
# =========================================================
EBAY_MARKETPLACE_ID = os.getenv("EBAY_MARKETPLACE_ID", "EBAY_DE")
# ✅ HARD SWITCH: disable official Browse API (default ON)
EBAY_DISABLE_BROWSE = os.getenv("EBAY_DISABLE_BROWSE", "1").strip() in ("1", "true", "True", "yes", "YES")
# Browse OAuth envs (optional now)
EBAY_CLIENT_ID = os.getenv("EBAY_CLIENT_ID")
EBAY_CLIENT_SECRET = os.getenv("EBAY_CLIENT_SECRET")
# Seller Hub Research Cookie (einzeilig in .env)
EBAY_RESEARCH_COOKIE = os.getenv("EBAY_RESEARCH_COOKIE")
# Optional multi-cookie pool (newline/comma separated) for per-request rotation.
# Falls back to the single EBAY_RESEARCH_COOKIE for backward compatibility.
EBAY_RESEARCH_COOKIES = os.getenv("EBAY_RESEARCH_COOKIES")
# --- Behaviour flags (safe defaults preserve current output shape) -----------
# Generic "chrome" resolves to curl_cffi's NEWEST profile and therefore never goes
# stale. A pinned profile does: chrome131 (Nov 2024) gets splash-blocked by eBay while
# "chrome"/chrome142 sail through from the SAME IP in the SAME minute — the stale
# JA3/JA4 IS the bot signal. Never pin this to an explicit version again.
EBAY_IMPERSONATE = os.getenv("EBAY_IMPERSONATE", "chrome").strip() or "chrome"
EBAY_RESEARCH_WARMUP = os.getenv("EBAY_RESEARCH_WARMUP", "1").strip() in ("1", "true", "True", "yes", "YES")
EBAY_RESEARCH_COMBINED = os.getenv("EBAY_RESEARCH_COMBINED", "1").strip() in ("1", "true", "True", "yes", "YES")
try:
    EBAY_RESEARCH_CACHE_TTL = int(os.getenv("EBAY_RESEARCH_CACHE_TTL", str(3 * 3600)))
except Exception:
    EBAY_RESEARCH_CACHE_TTL = 3 * 3600
try:
    EBAY_RESEARCH_NEG_TTL = int(os.getenv("EBAY_RESEARCH_NEG_TTL", "90"))
except Exception:
    EBAY_RESEARCH_NEG_TTL = 90
TOKEN_FILE = BASE_DIR / "ebay_token.json"
EBAY_SCOPE = "https://api.ebay.com/oauth/api_scope"
TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
BROWSE_BASE = "https://api.ebay.com/buy/browse/v1"
RESEARCH_BASE = "https://www.ebay.de/sh/research/api/search"
SESSION = requests.Session()
SESSION.cookies.set_policy(DefaultCookiePolicy(allowed_domains=[]))  # No cookie storage — prevent cross-user leaks
SESSION.headers.update(
    {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/129.0.0.0 Safari/537.36"
        )
    }
)
# =========================================================
# PROXY ROTATION (Research scraping) — ENV-DRIVEN
# =========================================================
# The old hardcoded datacenter pool is DEAD (407 CONNECT / ProxyError) and must
# NOT be used: it concentrates all research traffic on one server IP → rate limit
# trips fast. Proxies now come purely from EBAY_RESEARCH_PROXIES (newline/comma
# list of "ip:port:user:pass" or full http(s):// URLs). Empty → run DIRECT
# (no proxy), which works but throttles sooner.
def _parse_proxy_list(raw: List[str]) -> List[Dict[str, str]]:
    """Parse 'ip:port:user:password' OR a full http(s):// URL → requests proxy dict."""
    result: List[Dict[str, str]] = []
    for entry in raw:
        entry = (entry or "").strip()
        if not entry:
            continue
        if entry.startswith("http://") or entry.startswith("https://"):
            result.append({"http": entry, "https": entry})
            continue
        parts = entry.split(":")
        if len(parts) == 4:
            ip, port, user, pw = parts
            url = f"http://{user}:{pw}@{ip}:{port}"
            result.append({"http": url, "https": url})
        elif len(parts) == 2:
            ip, port = parts
            url = f"http://{ip}:{port}"
            result.append({"http": url, "https": url})
    return result


def _split_env_list(raw: Optional[str]) -> List[str]:
    """Split a newline/comma-separated env value into trimmed non-empty tokens."""
    if not raw:
        return []
    tokens: List[str] = []
    for chunk in raw.replace("\r", "\n").split("\n"):
        for part in chunk.split(","):
            part = part.strip()
            if part:
                tokens.append(part)
    return tokens


# German RESIDENTIAL pool (AS3320 Deutsche Telekom, Frankfurt) — verified 10/10 alive
# against ebay.de. Residential is the IP class that matters here: Imperva scores
# datacenter ranges far harder. EBAY_RESEARCH_PROXIES overrides this list, so rotating
# credentials never needs a redeploy.
_DEFAULT_PROXIES: List[str] = [
    f"82.41.244.{i}:11000:birdBW7dQ:qzg6ibNtwt73" for i in range(147, 157)
]


def _build_proxy_list() -> List[Dict[str, str]]:
    env = _split_env_list(os.getenv("EBAY_RESEARCH_PROXIES"))
    return _parse_proxy_list(env or _DEFAULT_PROXIES)


_PROXY_LIST: List[Dict[str, str]] = _build_proxy_list()


def _get_proxy() -> Optional[Dict[str, str]]:
    """Random proxy from the pool (None if empty → direct). Fine for the ANONYMOUS
    public scrape; the authenticated research path uses _proxy_for_cookie() instead."""
    if not _PROXY_LIST:
        return None
    return random.choice(_PROXY_LIST)


def _proxy_for_cookie(cookie_id: Optional[str]) -> List[Dict[str, str]]:
    """Pin ONE proxy per cookie instead of rotating per request.

    Rotating an *authenticated* Seller-Hub session across 10 exits is an
    account-takeover signature — realistic outcome is a security hold on the seller
    account, which is worse than a bot-block. Keeping each cookie on a stable exit
    looks like a normal user, while MULTIPLE cookies still spread across MULTIPLE IPs
    (that is where the pool actually buys us headroom). Deterministic: same cookie →
    same exit across restarts.
    """
    if not _PROXY_LIST:
        return []
    if not cookie_id:
        return _PROXY_LIST
    idx = int(hashlib.md5(cookie_id.encode()).hexdigest(), 16) % len(_PROXY_LIST)
    return [_PROXY_LIST[idx]]

# =========================================================
# TOKEN CACHE (Browse only)
# =========================================================
def _load_cached_token() -> Optional[str]:
    if not TOKEN_FILE.exists():
        return None
    try:
        data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
        if data.get("expires_at", 0) > time.time() + 60:
            return data.get("access_token")
    except Exception as e:
        logger.warning(f"[eBay] Token cache read error: {e}")
    return None
def _save_token(token: str, expires_in: int) -> None:
    payload = {"access_token": token, "expires_at": time.time() + int(expires_in) - 60}
    try:
        TOKEN_FILE.write_text(json.dumps(payload), encoding="utf-8")
    except Exception as e:
        logger.warning(f"[eBay] Token cache write error: {e}")
def get_ebay_token() -> str:
    if EBAY_DISABLE_BROWSE:
        raise RuntimeError("Browse API ist deaktiviert (EBAY_DISABLE_BROWSE=1).")
    if not EBAY_CLIENT_ID or not EBAY_CLIENT_SECRET:
        raise RuntimeError("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET fehlen in .env")
    cached = _load_cached_token()
    if cached:
        return cached
    auth = requests.auth.HTTPBasicAuth(EBAY_CLIENT_ID, EBAY_CLIENT_SECRET)
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    data = {"grant_type": "client_credentials", "scope": EBAY_SCOPE}
    resp = SESSION.post(TOKEN_URL, auth=auth, headers=headers, data=data, timeout=20)
    if resp.status_code != 200:
        raise RuntimeError(f"Token-Request failed ({resp.status_code}): {resp.text[:500]}")
    obj = resp.json()
    token = obj["access_token"]
    expires_in = int(obj.get("expires_in", 7200))
    _save_token(token, expires_in)
    return token
def ebay_request(method: str, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if EBAY_DISABLE_BROWSE:
        raise RuntimeError("Browse API ist deaktiviert (EBAY_DISABLE_BROWSE=1).")
    token = get_ebay_token()
    url = f"{BROWSE_BASE}/{path.lstrip('/')}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
    }
    resp = SESSION.request(method, url, headers=headers, params=params, timeout=20)
    if resp.status_code >= 300:
        raise RuntimeError(f"eBay API {resp.status_code} | {url} | {resp.text[:600]}")
    return resp.json()
def search_items_by_ean(ean: str, limit: int = 25) -> List[Dict[str, Any]]:
    if EBAY_DISABLE_BROWSE:
        return []
    params = {"q": ean, "limit": str(limit)}
    data = ebay_request("GET", "item_summary/search", params=params)
    return data.get("itemSummaries", []) or []
def search_items_by_keyword(keyword: str, limit: int = 50) -> List[Dict[str, Any]]:
    if EBAY_DISABLE_BROWSE:
        return []
    params = {"q": keyword, "limit": str(limit)}
    data = ebay_request("GET", "item_summary/search", params=params)
    return data.get("itemSummaries", []) or []
# =========================================================
# PROFIT CALC
# =========================================================
def gross_to_net(gross: float, vat_rate: float = 0.19) -> float:
    g = float(gross)
    if vat_rate is None or vat_rate <= 0:
        return g
    return g / (1.0 + vat_rate)
def calc_ebay_fee_tiered(
    sell_price_net: float,
    fee_pct: float | None = None,
    *,
    fee_up_to_200: float | None = None,
    fee_above_200: float | None = None,
    cap_eur: float | None = None,
    fee_low: float | None = None,
    fee_high: float | None = None,
) -> float:
    if fee_up_to_200 is None and fee_low is not None:
        fee_up_to_200 = fee_low
    if fee_above_200 is None and fee_high is not None:
        fee_above_200 = fee_high
    try:
        p = float(sell_price_net or 0.0)
    except Exception:
        p = 0.0
    if p <= 0:
        return 0.0
    if fee_up_to_200 is None:
        fee_up_to_200 = float(fee_pct or 0.0)
    if fee_above_200 is None:
        fee_above_200 = float(fee_pct or 0.0)
    up = min(p, 200.0)
    above = max(p - 200.0, 0.0)
    fee = up * float(fee_up_to_200) + above * float(fee_above_200)
    if cap_eur is not None:
        try:
            fee = min(fee, float(cap_eur))
        except Exception:
            pass
    return float(fee)
def calc_profit_net(
    sale_gross: float,
    buy_net: float,
    shipping_out_net: float = 5.0,
    shipping_in_net: float = 0.0,
    other_costs_net: float = 0.0,
    vat_rate: float = 0.19,
    fee_up_to_200: float = 0.12,
    fee_above_200: float = 0.12,
    fee_fixed: float = 0.35,
    fee_vat_rate: float = 0.19,
) -> Dict[str, float]:
    sale_gross = float(sale_gross)
    buy_net = float(buy_net)
    revenue_cash = sale_gross
    ebay_fee_base = calc_ebay_fee_tiered(
        sale_gross,
        fee_low=float(fee_up_to_200),
        fee_high=float(fee_above_200),
    ) + float(fee_fixed)
    ebay_fee_total = ebay_fee_base * (1.0 + float(fee_vat_rate)) if fee_vat_rate else ebay_fee_base
    shipping_out_net = float(shipping_out_net)
    shipping_in_net = float(shipping_in_net)
    other_costs_net = float(other_costs_net)
    base_cost = buy_net + shipping_in_net + shipping_out_net + other_costs_net
    profit_cash = revenue_cash - (base_cost + ebay_fee_total)
    roi_cash = (profit_cash / base_cost) * 100 if base_cost > 0 else 0.0
    margin_cash = (profit_cash / revenue_cash) * 100 if revenue_cash > 0 else 0.0
    return {
        "revenue_cash": round(revenue_cash, 2),
        "ebay_fee_cash": round(ebay_fee_total, 2),
        "profit_cash": round(profit_cash, 2),
        "roi_cash": round(roi_cash, 2),
        "margin_cash": round(margin_cash, 2),
    }
# =========================================================
# BROWSE MARKET PRICES (optional; unused when disabled)
# =========================================================
def _build_browse_market_prices(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    prices: List[float] = []
    offers: List[Dict[str, Any]] = []
    for it in items:
        p = (it.get("price") or {}).get("value")
        try:
            price = float(p)
        except Exception:
            continue
        prices.append(price)
        offers.append({"itemId": it.get("itemId"), "title": it.get("title"), "price": price})
    if not prices:
        return {"ok": False}
    prices_sorted = sorted(prices)
    n = len(prices_sorted)
    median = prices_sorted[n // 2] if n % 2 == 1 else (prices_sorted[n // 2 - 1] + prices_sorted[n // 2]) / 2
    lo, hi = median * 0.5, median * 1.5
    filtered = [p for p in prices if lo <= p <= hi] or prices
    avg_price = sum(filtered) / len(filtered)
    rep_item = next((it for it in items if it.get("itemId") == min(offers, key=lambda o: abs(o["price"] - avg_price)).get("itemId")), {})
    rep = min(offers, key=lambda o: abs(o["price"] - avg_price))
    rep_image = ((rep_item.get("thumbnailImages") or [{}])[0]).get("imageUrl") or (rep_item.get("image") or {}).get("imageUrl")
    return {
        "ok": True,
        "browse_avg": round(avg_price, 2),
        "browse_median": round(median, 2),
        "offer_count": len(prices),
        "rep_itemId": rep.get("itemId"),
        "rep_title": rep.get("title"),
        "rep_image": rep_image,
    }
# =========================================================
# PUBLIC SOLD LISTINGS FALLBACK (kein Cookie / Browse nötig)
# =========================================================
_PUBLIC_SOLD_CACHE: Dict[str, Dict[str, Any]] = {}
_PUBLIC_SOLD_TTL = 20 * 60  # 20 min

# German month abbreviations used in eBay's "Verkauft <d>. <Mon> <YYYY>" captions
_DE_MONTHS = {
    "jan": 1, "feb": 2, "mär": 3, "maer": 3, "mrz": 3, "apr": 4, "mai": 5,
    "jun": 6, "jul": 7, "aug": 8, "sep": 9, "okt": 10, "nov": 11, "dez": 12,
}


def _parse_de_sold_date(caption_text: str) -> Optional[float]:
    """Parse 'Verkauft  7. Jul 2026' → epoch seconds (None if unparseable)."""
    if not caption_text:
        return None
    m = re.search(r"(\d{1,2})\.\s*([A-Za-zäöü]{3,4})\.?\s*(\d{4})", caption_text)
    if not m:
        return None
    day = int(m.group(1))
    mon_key = m.group(2).lower()[:3]
    year = int(m.group(3))
    month = _DE_MONTHS.get(mon_key)
    if not month:
        return None
    try:
        import datetime as _dt
        return _dt.datetime(year, month, day, tzinfo=_dt.timezone.utc).timestamp()
    except Exception:
        return None


# Split a listing page into per-card blocks so title/price/caption stay paired.
_CARD_SPLIT_RE = re.compile(r'su-card-container|class="?s-card', re.I)
_SCARD_PRICE_RE = re.compile(r'(?:s-card|su-item-card)__price[^>]*>(.*?)</span>', re.S)
_SCARD_CAPTION_RE = re.compile(r's-card__caption[^>]*>(.*?)</div>', re.S)
_SCARD_TITLE_RE = re.compile(r's-card__title[^>]*>(.*?)</div>', re.S)
_EUR_PRICE_RE = re.compile(r'(?:EUR\s*)?(\d{1,4}(?:\.\d{3})*,\d{2})')


def _scard_is_promo(block: str) -> bool:
    """Filter ad/promo cards: $-prices, 'Shop on eBay', 'Neues Angebot'."""
    if "Shop on eBay" in block or "Neues Angebot" in block:
        return True
    # $-price (US promo card) with no EUR price at all
    if "$" in block and "EUR" not in block:
        return True
    return False


def _relevance_tokens(title: Optional[str]) -> List[str]:
    """Distinctive model tokens (those containing a digit, e.g. '1050','d2','c1')
    from a product name, used to keep only the actual product/variant among fuzzy
    eBay sold results. Returns [] when the name has none → no filtering."""
    if not title:
        return []
    seen: set = set()
    out: List[str] = []
    for t in re.findall(r"[a-z0-9]+", title.lower()):
        if len(t) <= 6 and any(ch.isdigit() for ch in t) and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _title_matches(text: str, tokens: List[str]) -> bool:
    """True if `text` contains ALL model tokens as whole words (case-insensitive)."""
    if not tokens:
        return True
    low = text.lower()
    return all(re.search(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])", low) for t in tokens)


def _parse_scard_sold_page(html: str, window_days: int = 30,
                           match_tokens: Optional[List[str]] = None) -> Optional[Dict[str, Any]]:
    """Parse the 2024+ eBay 's-card' sold-listings markup for median price and an
    APPROXIMATE monthly_sales (count of 'Verkauft <date>' captions in-window,
    scaled to 30d). When match_tokens is given, only cards whose title contains ALL
    those model tokens are counted (drops fuzzy variant/accessory matches — e.g. the
    older 'C1' when the product is the 'D2'). Returns
    {avg_price, median_price, monthly_sales, ...} or None."""
    if not html:
        return None
    # Anchor on each price occurrence. A card's block runs from the PREVIOUS price
    # anchor (or start) up to the NEXT price anchor, so exactly one card's
    # title+price+caption falls inside and neighbouring cards don't leak in.
    # eBay rotates markup: legacy 's-item__price', 's-card__price' (variant A),
    # and 'su-item-card__price' (variant B, no caption class). Anchor on both s-card
    # families so the fallback works regardless of which variant eBay served.
    price_positions = [m.start() for m in re.finditer(r'(?:s-card|su-item-card)__price', html)]
    if not price_positions:
        return None
    prices: List[float] = []
    now = time.time()
    window_start = now - window_days * 86400
    in_window = 0
    dated = 0
    seen_ids: set = set()
    for i, pos in enumerate(price_positions):
        prev_pos = price_positions[i - 1] if i > 0 else 0
        next_pos = price_positions[i + 1] if i + 1 < len(price_positions) else len(html)
        # Block for promo/caption detection: from just after the previous price
        # (its title/caption belong to that card) to the next price anchor.
        block = html[prev_pos:next_pos]
        if _scard_is_promo(block):
            continue
        # Skip crossed-out "was" prices (class '...strikethrough...__price'). They are
        # the original price, not what the item sold for, and they inflate the average.
        # Scope the check to THIS price's own <span> so a neighbour's class can't leak in.
        _span_start = html.rfind("<span", max(0, pos - 200), pos)
        if "strikethrough" in (html[_span_start:pos] if _span_start != -1 else ""):
            continue
        # This card's title + listing-id sit between the previous price and this one.
        title_span = html[prev_pos:pos]
        # Relevance filter: skip cards whose title lacks the product's model tokens
        # (fuzzy eBay search mixes e.g. 'SDR 1050 D2' with the older 'C1' + Zubehör).
        if match_tokens and not _title_matches(title_span, match_tokens):
            continue
        # Dedup: eBay sometimes renders the same listing card twice.
        lids = re.findall(r'data-listingid=["\']?(\d+)', title_span)
        if lids:
            if lids[-1] in seen_ids:
                continue
            seen_ids.add(lids[-1])
        pm = _SCARD_PRICE_RE.search(html[pos:next_pos])
        if not pm:
            continue
        price_text = re.sub(r"<[^>]+>", "", pm.group(1))
        em = _EUR_PRICE_RE.search(price_text)
        if not em:
            continue
        p = _parse_price_number(em.group(1))
        if not p or not (0.5 < p < 20000):
            continue
        prices.append(p)
        # Sold date for THIS card — markup-agnostic. "Verkauft <date>" carries a
        # caption class in the s-card variant but NONE in the su-item-card variant,
        # so anchor on the "Verkauft" text rather than a CSS class.
        card_text = re.sub(r"<[^>]+>", " ", html[pos:next_pos])
        vm = re.search(r"Verkauft(.{0,40})", card_text)
        ts = _parse_de_sold_date(vm.group(1)) if vm else None
        if ts is not None:
            dated += 1
            if ts >= window_start:
                in_window += 1

    if len(prices) < 3:
        return None

    prices.sort()
    n = len(prices)
    median = prices[n // 2] if n % 2 == 1 else (prices[n // 2 - 1] + prices[n // 2]) / 2
    # Median-anchored band instead of IQR. Sold pages mix single units with bundles/
    # sets (max is routinely 5x the median). On a SMALL/fuzzy result set the IQR grows
    # wide enough to keep those outliers, which inflated sell_price_avg far above the
    # median (observed: Ø 43.92 vs Median 29.95) and produced phantom profits, because
    # the caller computes profit from the avg. ±50% around the median is exactly what
    # the Browse path (_build_browse_market_prices) already uses.
    lo, hi = median * 0.5, median * 1.5
    filtered = [p for p in prices if lo <= p <= hi] or prices
    avg = sum(filtered) / len(filtered)

    # Approximate monthly_sales from in-window dated cards scaled to 30 days.
    # NOTE: the page shows a bounded, sorted subset → this is a floor, flagged approx.
    monthly_sales = None
    if dated > 0:
        monthly_sales = int(round(in_window * (30.0 / max(1, window_days)))) or in_window or None

    return {
        "avg_price": round(avg, 2),
        "median_price": round(median, 2),
        "monthly_sales": monthly_sales,
        "_source": "public_scrape",
        "velocity_approx": True,
    }


def _fetch_public_sold_prices(query: str, window_days: int = 30,
                              match_tokens: Optional[List[str]] = None) -> Optional[Dict[str, Any]]:
    """
    Scrapt öffentliche eBay Abgeschlossene Angebote (LH_Sold=1) im 2024+ s-card
    Markup. Kein OAuth/Cookie nötig — Fallback wenn Research throttled/tot ist.
    Liefert median + APPROX monthly_sales (velocity_approx=True) via 'Verkauft'-Datum.
    match_tokens filtert auf das echte Produkt/die Variante (gegen eBays Fuzzy-Suche).
    Fetch läuft über die gewärmte curl_cffi Session (Chrome-Impersonation).
    """
    cache_key = query.strip().lower() + "|" + ",".join(match_tokens or [])
    now = time.time()
    hit = _PUBLIC_SOLD_CACHE.get(cache_key)
    if hit and (now - hit["ts"] < _PUBLIC_SOLD_TTL):
        return hit["data"]

    try:
        url = (
            "https://www.ebay.de/sch/i.html"
            f"?_nkw={requests.utils.quote(query)}"
            "&LH_Complete=1&LH_Sold=1&_sacat=0&_sop=13&_ipg=60"
        )
        headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-DE,de;q=0.9",
            # Deliberately NO User-Agent: curl_cffi's impersonate profile supplies a UA
            # that matches its TLS/JA3. Forcing our own creates a UA↔fingerprint
            # mismatch, which is itself a bot signal.
        }
        proxy = _get_proxy()
        sess = _get_cffi_session()
        if sess is not None:
            _ensure_homepage_warmup(proxy)   # cold session 403s without homepage cookies
            resp = sess.get(url, headers=headers, timeout=12, proxies=proxy)
            # Cold/blocked session → re-warm once and retry (first call after restart)
            final_url = (getattr(resp, "url", "") or "").lower()
            if resp.status_code == 403 or "splashui/distil" in final_url:
                _ensure_homepage_warmup(proxy, force=True)
                resp = sess.get(url, headers=headers, timeout=12, proxies=proxy)
        else:
            resp = SESSION.get(url, headers=headers, timeout=12, proxies=proxy)
        if resp.status_code != 200:
            return None

        data = _parse_scard_sold_page(resp.text, window_days=window_days, match_tokens=match_tokens)
        if not data:
            return None

        _PUBLIC_SOLD_CACHE[cache_key] = {"ts": now, "data": data}
        logger.info(
            f"[PublicSold] {query}: median={data['median_price']:.2f} "
            f"avg={data['avg_price']:.2f} monthly_sales≈{data.get('monthly_sales')}"
        )
        return data
    except Exception as e:
        logger.warning(f"[PublicSold] Scrape failed for '{query}': {e}")
        return None


_BAD_WORDS_DEFAULT = [
    "case", "cover", "hülle", "schutz", "folie",
    "filter", "ersatz", "replacement", "teile", "part", "parts",
    "defekt", "broken", "spares", "only", "read", "beschreibung",
    "zubehör", "accessory", "aufsatz", "düse", "adapter", "kabel"
]
def _clean_title(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").lower()).strip()
def _filter_items_by_title(items: List[Dict[str, Any]], bad_words: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    bad = bad_words or _BAD_WORDS_DEFAULT
    out = []
    for it in items:
        title = _clean_title(it.get("title", ""))
        if not title:
            continue
        if any(w in title for w in bad):
            continue
        out.append(it)
    return out
# =========================================================
# RESEARCH / NDJSON PARSING
# =========================================================
# Robustness primitives — coalesce concurrent same-EAN requests, circuit-break
# on upstream failures, track proxy health, retry transient errors with backoff.
from _robustness import (
    InflightCoalescer, CircuitBreaker, ProxyHealth, CookieHealth, TTLCache,
    UpstreamLimiter, robust_request,
)
import threading
import hashlib
import sqlite3

# TTLCache replaces the old dict-based cache — thread-safe + LRU + max size
_RESEARCH_CACHE = TTLCache(max_size=2000, ttl_sec=30 * 60)          # 30 min
_RESEARCH_TRENDS_CACHE = TTLCache(max_size=2000, ttl_sec=6 * 3600)  # 6 h
# Combined fetch cache (aggregates+searchResults+metricsTrends in one dict).
# velocity changes slowly, so a longer TTL is fine (default 3h, env-tunable).
_RESEARCH_COMBINED_CACHE = TTLCache(max_size=2000, ttl_sec=EBAY_RESEARCH_CACHE_TTL)
# Negative cache: throttled/None results are parked briefly so a rate-limited
# product is not re-hammered on every incoming request.
_RESEARCH_NEG_CACHE = TTLCache(max_size=2000, ttl_sec=EBAY_RESEARCH_NEG_TTL)

# One coalescer per endpoint type → 5 concurrent users for same EAN = 1 upstream call
_research_coalescer = InflightCoalescer(timeout=20.0)
_trends_coalescer = InflightCoalescer(timeout=20.0)
_combined_coalescer = InflightCoalescer(timeout=25.0)

# Circuit breaker — if eBay returns 5+ failures (5xx OR sustained 429s) in 60s,
# short-circuit for 30s so a fully-throttled pool stops hammering.
_research_breaker = CircuitBreaker(failure_threshold=5, window_sec=60, cooldown_sec=30)

# Proxy health — blocked proxies are skipped for 2 min
_proxy_health = ProxyHealth(cooldown_sec=120)

# Cookie health — the /sh/research throttle is cookie-bound, so a 429/soft-block
# cools the COOKIE for a real cooldown (5 min) and rotation picks a fresh one.
_cookie_health = CookieHealth(cooldown_sec=300)

# Limit concurrent upstream eBay calls (FastAPI worker pool can have 100s of threads)
_research_limiter = UpstreamLimiter(max_concurrent=8, acquire_timeout=15.0)


# ---------------------------------------------------------------------------
# Cookie pool + rotation (per-request), rebuilt lazily so app.py hot-swap works
# ---------------------------------------------------------------------------
def _cookie_id(cookie: str) -> str:
    """Stable short id for a cookie string (for health tracking / warmup keys)."""
    return hashlib.sha1((cookie or "").encode("utf-8", "replace")).hexdigest()[:16]


def _build_cookie_pool() -> List[str]:
    """Assemble the active cookie list from EBAY_RESEARCH_COOKIES, falling back to
    the single EBAY_RESEARCH_COOKIE. Reads the *module* globals so the live
    hot-swap (app.py mutating ebay_live.EBAY_RESEARCH_COOKIE) takes effect."""
    pool = _split_env_list(EBAY_RESEARCH_COOKIES)
    if not pool and EBAY_RESEARCH_COOKIE:
        pool = [EBAY_RESEARCH_COOKIE]
    # de-dup, preserve order
    seen = set()
    out: List[str] = []
    for c in pool:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _pick_cookie() -> Tuple[Optional[str], Optional[str]]:
    """Return (cookie, cookie_id) preferring a healthy cookie. Falls back to any
    cookie if all are cooling (better to try than to return no data)."""
    pool = _build_cookie_pool()
    if not pool:
        return None, None
    ids = [_cookie_id(c) for c in pool]
    by_id = dict(zip(ids, pool))
    healthy_id = _cookie_health.pick_random_healthy(ids)
    if healthy_id is not None:
        return by_id[healthy_id], healthy_id
    # all cooling → pick any (last resort) so we still attempt / fall to scrape
    cid = random.choice(ids)
    return by_id[cid], cid


def _has_any_research_cookie() -> bool:
    return bool(_build_cookie_pool())


# ---------------------------------------------------------------------------
# Persistent (sqlite) research cache — survives restarts/redeploys
# ---------------------------------------------------------------------------
_PERSIST_DB_PATH = BASE_DIR / "research_cache.sqlite"
_PERSIST_LOCK = threading.Lock()
_PERSIST_DISABLED = os.getenv("EBAY_RESEARCH_PERSIST", "1").strip() not in ("1", "true", "True", "yes", "YES")


def _persist_conn():
    conn = sqlite3.connect(str(_PERSIST_DB_PATH), timeout=5.0)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS research_cache ("
        "k TEXT PRIMARY KEY, v TEXT NOT NULL, expires_at REAL NOT NULL)"
    )
    return conn


def _persist_get(key: str) -> Optional[Dict[str, Any]]:
    if _PERSIST_DISABLED:
        return None
    try:
        with _PERSIST_LOCK:
            conn = _persist_conn()
            try:
                row = conn.execute(
                    "SELECT v, expires_at FROM research_cache WHERE k = ?", (key,)
                ).fetchone()
            finally:
                conn.close()
        if not row:
            return None
        v, expires_at = row
        if expires_at < time.time():
            return None
        return json.loads(v)
    except Exception as e:
        logger.warning(f"[ResearchPersist] read error: {e}")
        return None


def _persist_set(key: str, value: Dict[str, Any], ttl_sec: int) -> None:
    if _PERSIST_DISABLED:
        return
    try:
        payload = json.dumps(value)
        expires_at = time.time() + max(1, int(ttl_sec))
        with _PERSIST_LOCK:
            conn = _persist_conn()
            try:
                conn.execute(
                    "INSERT INTO research_cache (k, v, expires_at) VALUES (?, ?, ?) "
                    "ON CONFLICT(k) DO UPDATE SET v=excluded.v, expires_at=excluded.expires_at",
                    (key, payload, expires_at),
                )
                conn.commit()
            finally:
                conn.close()
    except Exception as e:
        logger.warning(f"[ResearchPersist] write error: {e}")


def _clear_research_caches() -> None:
    """Clear all in-process research caches (used by the live cookie hot-swap)."""
    try:
        _RESEARCH_CACHE.clear()
        _RESEARCH_TRENDS_CACHE.clear()
        _RESEARCH_COMBINED_CACHE.clear()
        _RESEARCH_NEG_CACHE.clear()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Warmed, reused curl_cffi session + per-(cookie,proxy) warmup
# ---------------------------------------------------------------------------
_CFFI_SESSION = None
_CFFI_SESSION_LOCK = threading.Lock()
_WARMUP_STATE: Dict[str, float] = {}          # "cookie_id|proxy_id" -> expires_at
_WARMUP_TOKENS: Dict[str, Tuple[str, str]] = {}  # cookie_id -> (header_name, token)
_WARMUP_TTL = 30 * 60


def _get_cffi_session():
    """Module-level persistent curl_cffi Session (keep-alive lowers fingerprint).
    Returns None if curl_cffi is unavailable (callers fall back to plain SESSION)."""
    global _CFFI_SESSION
    if _CFFI_SESSION is not None:
        return _CFFI_SESSION
    with _CFFI_SESSION_LOCK:
        if _CFFI_SESSION is None:
            try:
                from curl_cffi import requests as cffi_requests
                _CFFI_SESSION = cffi_requests.Session(impersonate=EBAY_IMPERSONATE)
            except Exception as e:
                logger.info(f"[Research] curl_cffi Session unavailable: {e}")
                _CFFI_SESSION = None
    return _CFFI_SESSION


_HOMEPAGE_WARMED_UNTIL = 0.0
_HOMEPAGE_WARM_LOCK = threading.Lock()
_HOMEPAGE_WARM_TTL = 30 * 60


def _ensure_homepage_warmup(proxy: Optional[Dict[str, str]] = None, force: bool = False) -> None:
    """Seed the shared curl_cffi session with ebay.de homepage cookies. The public
    /sch/i.html sold-scrape 403s on a COLD session (Imperva expects the cookies a
    real browser collects on the homepage first). One homepage GET fixes it, so the
    very first fallback after a restart doesn't fail (verified: cold→403, warmed→200)."""
    global _HOMEPAGE_WARMED_UNTIL
    now = time.time()
    if not force and _HOMEPAGE_WARMED_UNTIL > now:
        return
    sess = _get_cffi_session()
    if sess is None:
        return
    try:
        sess.get(
            "https://www.ebay.de/",
            headers={
                # No User-Agent override — see _fetch_public_sold_prices.
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "de-DE,de;q=0.9",
                "Upgrade-Insecure-Requests": "1",
                "sec-fetch-site": "none",
                "sec-fetch-mode": "navigate",
                "sec-fetch-dest": "document",
            },
            timeout=12, proxies=proxy,
        )
        with _HOMEPAGE_WARM_LOCK:
            _HOMEPAGE_WARMED_UNTIL = now + _HOMEPAGE_WARM_TTL
    except Exception as e:
        logger.info(f"[PublicSold] homepage warmup failed: {e}")


def _proxy_id(proxy: Optional[Dict[str, str]]) -> str:
    if not proxy:
        return "direct"
    return (proxy.get("http") or proxy.get("https") or "direct")


def _warmup_session(cookie: str, cookie_id: str, proxy: Optional[Dict[str, str]]) -> None:
    """One-time GET to the Seller-Hub SPA landing page per (cookie,proxy) pair.
    Seeds any Set-Cookie delta and captures an anti-CSRF token to echo later.
    Best-effort: failures are swallowed (the XHR may still work)."""
    if not EBAY_RESEARCH_WARMUP or not cookie:
        return
    pid = _proxy_id(proxy)
    state_key = f"{cookie_id}|{pid}"
    now = time.time()
    exp = _WARMUP_STATE.get(state_key, 0)
    if exp > now:
        return
    sess = _get_cffi_session()
    if sess is None:
        _WARMUP_STATE[state_key] = now + _WARMUP_TTL
        return
    try:
        headers = {
            "Cookie": cookie,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
            "Referer": "https://www.ebay.de/",
            "Upgrade-Insecure-Requests": "1",
            "sec-fetch-site": "same-origin",
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
        }
        resp = sess.get(
            "https://www.ebay.de/sh/research",
            headers=headers, timeout=12, proxies=proxy,
        )
        # Capture any xsrf/srt/csrf token from Set-Cookie for later echoing
        try:
            set_cookie = ""
            for k, v in (resp.headers or {}).items():
                if k.lower() == "set-cookie":
                    set_cookie += ";" + str(v)
            m = re.search(r"(?i)([a-z0-9_\-]*(?:xsrf|csrf|srt)[a-z0-9_\-]*)=([^;,\s]+)", set_cookie)
            if m:
                name, token = m.group(1), m.group(2)
                header_name = "X-CSRF-Token" if "csrf" in name.lower() else "srt"
                _WARMUP_TOKENS[cookie_id] = (header_name, token)
        except Exception:
            pass
        logger.info(f"[Research] warmup {cookie_id[:8]} via {pid[:24]} → HTTP {getattr(resp,'status_code','?')}")
    except Exception as e:
        logger.info(f"[Research] warmup failed ({cookie_id[:8]}): {type(e).__name__}")
    finally:
        _WARMUP_STATE[state_key] = now + _WARMUP_TTL


# ---------------------------------------------------------------------------
# Per-cookie AIMD min-interval throttle (widens on 429, decays on success)
# ---------------------------------------------------------------------------
_AIMD_LOCK = threading.Lock()
_AIMD_INTERVAL: Dict[str, float] = {}   # cookie_id -> current min interval
_AIMD_LAST_TS: Dict[str, float] = {}    # cookie_id -> last call ts
# /sh/research sits behind Imperva/Distil, which blocks on request *velocity*
# ("übermenschliche Geschwindigkeit"). Keep a conservative per-cookie floor with
# jitter so we never present a fast, regular cadence. Tunable via env.
_AIMD_MIN = float(os.getenv("EBAY_RESEARCH_MIN_GAP", "1.8"))
_AIMD_MAX = float(os.getenv("EBAY_RESEARCH_MAX_GAP", "45"))
# Hard ceiling on how long a single call may queue for its slot. Beyond this we
# DROP the request rather than fire early (early = burst = Imperva block).
_AIMD_MAX_WAIT = float(os.getenv("EBAY_RESEARCH_MAX_WAIT", "90"))


def _throttle_research_aimd(cookie_id: Optional[str]) -> bool:
    """Additive-increase/multiplicative-decrease per-cookie spacing. On a fresh
    cookie the gap is tiny; after a 429 it widens (see _aimd_penalize)."""
    key = cookie_id or "_default_"
    with _AIMD_LOCK:
        interval = _AIMD_INTERVAL.get(key, _AIMD_MIN)
        now = time.time()
        last = _AIMD_LAST_TS.get(key, 0.0)
        # RESERVE this caller's slot while still holding the lock. Writing the
        # timestamp only *after* sleeping let every concurrent caller read the same
        # `last`, sleep the same amount and then fire simultaneously — an N-request
        # burst instead of one-every-`interval`. That burst is precisely the
        # "übermenschliche Geschwindigkeit" Imperva/Distil blocks on. Reserving the
        # slot under the lock makes concurrent callers queue behind one another.
        # Jitter breaks the regular cadence Imperva fingerprints on.
        slot = max(now, last + interval) + random.uniform(0.0, max(0.25, interval * 0.2))
        if slot - now > _AIMD_MAX_WAIT:
            # Queue too deep. Do NOT fire early (capping the sleep is what re-created
            # the burst: late slots all collapsed onto the cap and fired together).
            # Skip this request instead — no data beats a bot-block. Slot is NOT
            # reserved, so we don't block the queue for a request we're dropping.
            return False
        _AIMD_LAST_TS[key] = slot
    wait = slot - time.time()
    if wait > 0:
        time.sleep(wait)          # full wait — bounded above by _AIMD_MAX_WAIT
    return True


def _aimd_penalize(cookie_id: Optional[str], retry_after: Optional[float] = None) -> None:
    """Multiplicative increase after a throttle signal."""
    key = cookie_id or "_default_"
    with _AIMD_LOCK:
        cur = _AIMD_INTERVAL.get(key, _AIMD_MIN)
        if retry_after and retry_after > cur:
            cur = min(retry_after, _AIMD_MAX)
        else:
            cur = min(cur * 2.0 if cur >= _AIMD_MIN else _AIMD_MIN * 2, _AIMD_MAX)
        _AIMD_INTERVAL[key] = max(cur, _AIMD_MIN * 2)


def _aimd_reward(cookie_id: Optional[str]) -> None:
    """Additive decrease after a clean success."""
    key = cookie_id or "_default_"
    with _AIMD_LOCK:
        cur = _AIMD_INTERVAL.get(key, _AIMD_MIN)
        cur = max(_AIMD_MIN, cur - 0.1)
        _AIMD_INTERVAL[key] = cur


# Legacy throttle — kept for backward compat (unused callers may still import it).
_LAST_RESEARCH_TS = 0.0
_RESEARCH_THROTTLE_LOCK = threading.Lock()

def _throttle_research(min_interval: float = 0.2) -> None:
    """Minimum gap between upstream calls — last line of defense against bursting."""
    global _LAST_RESEARCH_TS
    with _RESEARCH_THROTTLE_LOCK:
        dt = time.time() - _LAST_RESEARCH_TS
        if dt < min_interval:
            time.sleep(min_interval - dt)
        _LAST_RESEARCH_TS = time.time()
def _parse_price_number(text: str) -> Optional[float]:
    """Extract a EUR amount from strings like 'EUR 150,50', '150,50 €', '1.234,56'.
    Handles German thousands('.')/decimal(',') and a leading/trailing currency."""
    if not text:
        return None
    # Isolate the numeric token (German format: optional thousands dots + ,dd)
    m = re.search(r"(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2}|\d+(?:\.\d+)?)", text)
    if not m:
        return None
    tok = m.group(1)
    if "," in tok:
        # German: '.' = thousands sep, ',' = decimal
        tok = tok.replace(".", "").replace(",", ".")
    # else: plain integer or already-dotted decimal — leave as-is
    try:
        return float(tok)
    except ValueError:
        return None
def _extract_median_from_search_results(search_results: Dict[str, Any]) -> Optional[float]:
    prices: List[float] = []
    items = search_results.get("items") or []
    for it in items:
        price_text = None
        try:
            price_text = it.get("price", {}).get("value", {}).get("textSpans", [{}])[0].get("text")
        except Exception:
            pass
        if not price_text:
            try:
                price_text = (
                    it.get("itemSummary", {})
                    .get("price", {})
                    .get("value", {})
                    .get("textSpans", [{}])[0]
                    .get("text")
                )
            except Exception:
                pass
        if not price_text:
            continue
        num = _parse_price_number(price_text)
        if num is not None:
            prices.append(num)
    if not prices:
        return None
    prices.sort()
    n = len(prices)
    med = prices[n // 2] if n % 2 == 1 else (prices[n // 2 - 1] + prices[n // 2]) / 2
    return float(med)
def _parse_ndjson_modules(resp_text: str) -> List[Dict[str, Any]]:
    text = (resp_text or "").strip()
    if not text:
        return []
    if text.startswith("{") or text.startswith("["):
        try:
            obj = json.loads(text)
            if isinstance(obj, list):
                return [m for m in obj if isinstance(m, dict)]
            if isinstance(obj, dict):
                return [obj]
        except Exception:
            pass
    modules: List[Dict[str, Any]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("for(;;);"):
            line = line[len("for(;;);") :].strip()
        if line.startswith(")]}',"):
            line = line[len(")]}',") :].strip()
        if line.startswith(")]}'"):
            line = line[len(")]}'") :].strip()
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                modules.append(obj)
        except Exception:
            continue
    return modules
def _build_research_url(keywords: str, day_range: int = 30, include_trends: bool = False) -> str:
    # eBay started rejecting endDate=now_ms in April 2026 with
    # "Das Startdatum ist nicht korrekt." (TZ-future-by-microseconds).
    # Using only dayRange — eBay computes the date range internally.
    params: List[Tuple[str, str]] = [
        ("marketplace", "EBAY-DE"),
        ("keywords", keywords),
        ("dayRange", str(day_range)),
        ("categoryId", "0"),
        ("conditionId", "1000"),
        ("format", "FIXED_PRICE"),
        ("offset", "0"),
        ("limit", "50"),
        ("tabName", "SOLD"),
        ("tz", "Europe/Berlin"),
        ("modules", "aggregates"),
        ("modules", "searchResults"),
    ]
    if include_trends:
        params.append(("modules", "metricsTrends"))
    return f"{RESEARCH_BASE}?{urlencode(params, doseq=True)}"
# Standard headers used by all research calls — reusable.
# `cookie` overrides the module default (enables per-request cookie rotation).
# NOTE: no User-Agent / sec-ch-ua here on purpose — curl_cffi's impersonate profile
# emits both, matched to the TLS/JA3 it presents. Hardcoding them (we used to pin
# Chrome 131) guarantees a mismatch the moment the profile moves, and the mismatch is
# itself a block signal.
def _research_headers(cookie: Optional[str] = None, cookie_id: Optional[str] = None) -> Dict[str, str]:
    headers = {
        "Cookie": cookie if cookie is not None else (EBAY_RESEARCH_COOKIE or ""),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://www.ebay.de/sh/research",
        "Connection": "keep-alive",
        "X-Requested-With": "XMLHttpRequest",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
    }
    # Echo any anti-CSRF token captured during warmup for this cookie
    if cookie_id and cookie_id in _WARMUP_TOKENS:
        try:
            hname, tok = _WARMUP_TOKENS[cookie_id]
            headers[hname] = tok
        except Exception:
            pass
    return headers


def _do_research_request(url: str, cookie: str, cookie_id: str, use_proxy: bool):
    """Execute the research XHR through the warmed, reused curl_cffi session.
    Wrapped by robust_request for retry/circuit/proxy-health, and honours
    Retry-After while cooling the *cookie* (not just the proxy) on throttle."""
    headers = _research_headers(cookie=cookie, cookie_id=cookie_id)

    def _fn(proxy):
        # Warm the SPA/session once per (cookie,proxy) before the XHR.
        try:
            _warmup_session(cookie, cookie_id, proxy)
        except Exception:
            pass
        sess = _get_cffi_session()
        if sess is not None:
            return sess.get(url, headers=headers, timeout=12, proxies=proxy)
        # Fallback: plain requests (no TLS impersonation) if curl_cffi missing
        return SESSION.get(url, headers=headers, timeout=12, proxies=proxy)

    def _on_rate_limit(retry_after):
        # /sh/research throttle is cookie-bound → cool the cookie + widen its AIMD gap
        if cookie_id:
            _cookie_health.mark_bad(cookie_id, retry_after if retry_after else None)
            _aimd_penalize(cookie_id, retry_after)

    return robust_request(
        request_fn=_fn,
        breaker=_research_breaker,
        proxy_health=_proxy_health,
        # Pinned exit for THIS cookie (not the whole pool) — see _proxy_for_cookie.
        proxies=_proxy_for_cookie(cookie_id),
        use_proxy=use_proxy,
        max_retries=2,
        backoff_base=0.4,
        on_rate_limit=_on_rate_limit,
    )


# --- NDJSON module extraction (label-matched, positional fallback) -----------
def _aggregate_section_text(aggregates: Dict[str, Any], *labels: str,
                            fallback_idx: Optional[int] = None) -> Optional[str]:
    """Return the first dataItem value text from the section whose title matches
    any of `labels` (case-insensitive substring). Falls back to positional index."""
    sections = aggregates.get("sections") or []

    def _first_value(sec: Dict[str, Any]) -> Optional[str]:
        try:
            return sec["dataItems"][0]["value"]["textSpans"][0]["text"]
        except Exception:
            return None

    low_labels = [l.lower() for l in labels]
    for sec in sections:
        try:
            title = (sec.get("title", {}).get("textSpans", [{}])[0] or {}).get("text", "") or ""
        except Exception:
            title = ""
        tl = title.lower()
        if any(lbl in tl for lbl in low_labels):
            v = _first_value(sec)
            if v is not None:
                return v
    if fallback_idx is not None and 0 <= fallback_idx < len(sections):
        return _first_value(sections[fallback_idx])
    return None


def _parse_research_modules(resp_text: str) -> Dict[str, Any]:
    """Parse a research NDJSON body into {avg_price, median_price, monthly_sales,
    trends} plus a classification flag. Returns {} when nothing parseable."""
    modules = _parse_ndjson_modules(resp_text)
    aggregates = next((m for m in modules if m.get("_type") == "ResearchAggregateModule"), None)
    search_results = next((m for m in modules if m.get("_type") == "SearchResultsModule"), None)
    trends_mod = next((m for m in modules if m.get("_type") == "MetricsTrendsModule"), None)

    avg_price = None
    sold_count = None
    if aggregates:
        avg_text = _aggregate_section_text(
            aggregates, "durchschnitt", "average", "avg", "verkaufspreis", fallback_idx=0
        )
        sold_text = _aggregate_section_text(
            aggregates, "verkauft", "sold", "anzahl", "verkäufe", "sales", fallback_idx=2
        )
        avg_price = _parse_price_number(avg_text) if avg_text else None
        digits = re.sub(r"[^\d]", "", sold_text or "")
        sold_count = int(digits) if digits else None

    med_price = _extract_median_from_search_results(search_results) if search_results else None
    trends = _normalize_metrics_trends(trends_mod) if trends_mod else None

    return {
        "avg_price": avg_price,
        "median_price": med_price,
        "monthly_sales": sold_count,
        "trends": trends,
        "_module_count": len(modules),
        "_has_aggregates": aggregates is not None,
    }


def _classify_research_body(status_code: int, body: str, final_url: str = "") -> str:
    """Classify a non-usable research response for distinct logging + handling."""
    b = body or ""
    low = b[:4000].lower()
    url_low = (final_url or "").lower()
    # Imperva/Distil bot-wall: eBay redirects /sh/research → /splashui/distil?...&page=block.
    # curl_cffi follows the redirect, so this arrives as HTTP 200 with the block splash
    # HTML (NOT NDJSON, NOT font-marketsans). Detect it explicitly so we back off hard
    # instead of mistaking it for an empty result and re-hammering the bot-wall.
    if ("splashui/distil" in url_low or "splashui/distil" in low
            or "page=block" in url_low
            or "entschuldigen sie die störung" in low
            or ("incapsula" in low and "unsuccessful" in low)):
        return "bot_block"
    if status_code in (429, 430):
        return "throttled"
    # Dead cookie on the /sh/research **API** does NOT return the HTML login page — it
    # returns HTTP 200 with a JSON auth error:
    #   {"error":"auth_required","reason_code":"invalid_session","signin_url":"…"}
    # Without this branch it fell through to "empty_or_unknown" and the cookie-dead
    # alert never fired — i.e. the monitor silently missed the exact thing it exists for.
    if ('"auth_required"' in low or '"invalid_session"' in low
            or '"signin_url"' in low or "signin.ebay.de" in low):
        return "login_interstitial"
    head = b[:800]
    if status_code == 403 and ("<html" in head.lower() or "font-marketsans" in head):
        return "blocked_html"
    if "font-marketsans" in head:
        return "login_interstitial"
    if "PageErrorModule" in b and '"severity":"ERROR"' in b:
        return "page_error"
    return "empty_or_unknown"


# --- Global Imperva/Distil short-circuit -------------------------------------
# Once /sh/research bot-blocks (which it does persistently from a datacenter IP),
# skip LIVE research entirely for a cooldown so EVERY check goes straight to the
# working public-scrape fallback instead of paying warmup + a doomed request +
# backoff. That per-check latency is what made the app feel "offline / lädt ewig".
# Cached research results are still served; only new upstream calls are suppressed.
# EBAY_RESEARCH_ENABLED=0 forces scrape-only; otherwise it auto-re-probes after the
# cooldown so research recovers by itself if the IP/cookie later clears.
_RESEARCH_ENABLED = os.getenv("EBAY_RESEARCH_ENABLED", "1").strip() not in ("0", "false", "False", "no", "NO")
# Research-only mode. Default ON (keep the scrape fallback) because a blocked research
# call would otherwise leave the check with no data at all. Set to 0 once the Hetzner
# probe proves research works from the server — then estimates never masquerade as exact.
EBAY_SCRAPE_FALLBACK = os.getenv("EBAY_SCRAPE_FALLBACK", "1").strip() not in ("0", "false", "False", "no", "NO")
_RESEARCH_BLOCK_LOCK = threading.Lock()
_RESEARCH_BLOCKED_UNTIL = 0.0
_RESEARCH_BLOCK_COOLDOWN = float(os.getenv("EBAY_RESEARCH_BLOCK_COOLDOWN", "1800"))  # 30 min


# --- Discord alerting --------------------------------------------------------
# Webhook URL lives in the env, NEVER in the repo: anyone holding it can post to the
# channel. Set EBAY_ALERT_WEBHOOK on the server. Empty => alerting silently disabled.
EBAY_ALERT_WEBHOOK = os.getenv("EBAY_ALERT_WEBHOOK", "").strip()
_ALERT_COOLDOWN = float(os.getenv("EBAY_ALERT_COOLDOWN", "3600"))   # per key, 1h
_ALERT_LOCK = threading.Lock()
_ALERT_LAST: Dict[str, float] = {}


def _alert_discord(key: str, title: str, message: str, urgent: bool = True) -> None:
    """Fire-and-forget Discord webhook, rate-limited per `key` so a dead cookie cannot
    spam the channel on every single request. Posts from a daemon thread so alerting
    never adds latency to a check, and never raises — a broken webhook must not break
    the eBay path."""
    if not EBAY_ALERT_WEBHOOK:
        return
    now = time.time()
    with _ALERT_LOCK:
        if now - _ALERT_LAST.get(key, 0.0) < _ALERT_COOLDOWN:
            return
        _ALERT_LAST[key] = now

    payload = {
        "username": "FlipCheck",
        "embeds": [{
            "title": title,
            "description": message,
            "color": 0xE74C3C if urgent else 0xF1C40F,
        }],
    }

    def _post() -> None:
        try:
            requests.post(EBAY_ALERT_WEBHOOK, json=payload, timeout=8)
            logger.info(f"[Alert] Discord notified: {key}")
        except Exception as e:
            logger.warning(f"[Alert] Discord webhook failed ({key}): {e}")

    threading.Thread(target=_post, daemon=True, name="discord-alert").start()


# True once we've reported the cookie dead, so we can announce recovery exactly once.
_COOKIE_DEAD = False

_COOKIE_REFRESH_HOWTO = (
    "**Fix:** eingeloggt `https://www.ebay.de/sh/research` öffnen → DevTools → Network → "
    "`api/search` → Request Headers → `Cookie` kopieren → auf dem Server "
    "`EBAY_RESEARCH_COOKIE` setzen → Backend neu starten."
)


def _on_research_failure(kind: str, cookie_id: Optional[str]) -> None:
    """Single place that reacts to a failed research call: cool the cookie, arm the
    Imperva short-circuit, and alert Discord for the cases a HUMAN must act on."""
    global _COOKIE_DEAD
    if kind == "bot_block":
        _mark_research_blocked()
        _alert_discord(
            "bot_block",
            "🤖 eBay Research: Imperva-Block",
            f"`/sh/research` wird von Imperva/Distil geblockt (`/splashui/distil`).\n"
            f"Research pausiert {int(_RESEARCH_BLOCK_COOLDOWN)}s; der Check läuft solange "
            f"über den Public-Sold-Scrape (**geschätzte** Velocity statt exakter Zahlen).",
            urgent=False,
        )
    elif kind == "login_interstitial":
        _COOKIE_DEAD = True
        _alert_discord(
            "cookie_dead",
            "🍪 eBay Research-Cookie ist TOT",
            "Terapeak liefert die Login-Seite statt Daten → `EBAY_RESEARCH_COOKIE` ist "
            "abgelaufen.\n\n**Exakte Verkaufszahlen fallen bis zum Refresh aus** "
            f"(Fallback: Scrape-Schätzung).\n\n{_COOKIE_REFRESH_HOWTO}",
            urgent=True,
        )
    if kind in ("throttled", "bot_block", "login_interstitial", "blocked_html", "page_error") and cookie_id:
        _cookie_health.mark_bad(cookie_id)
    if kind == "throttled" and cookie_id:
        _aimd_penalize(cookie_id)   # genuine 429 rate-limit → widen this cookie's gap


def _on_research_success(cookie_id: Optional[str]) -> None:
    """Reward the cookie and announce recovery if we previously reported it dead."""
    global _COOKIE_DEAD
    _aimd_reward(cookie_id)
    if _COOKIE_DEAD:
        _COOKIE_DEAD = False
        with _ALERT_LOCK:
            _ALERT_LAST.pop("cookie_dead", None)   # next death may alert immediately
        _alert_discord(
            "cookie_ok",
            "✅ eBay Research-Cookie wieder aktiv",
            "Terapeak liefert wieder Daten — exakte Verkaufszahlen sind zurück.",
            urgent=False,
        )


def _research_is_blocked() -> bool:
    if not _RESEARCH_ENABLED:
        return True
    return time.time() < _RESEARCH_BLOCKED_UNTIL


def _mark_research_blocked() -> None:
    global _RESEARCH_BLOCKED_UNTIL
    with _RESEARCH_BLOCK_LOCK:
        was_blocked = time.time() < _RESEARCH_BLOCKED_UNTIL
        _RESEARCH_BLOCKED_UNTIL = time.time() + _RESEARCH_BLOCK_COOLDOWN
    if not was_blocked:
        logger.info(
            f"[Research] Imperva/Distil block → /sh/research übersprungen für "
            f"{int(_RESEARCH_BLOCK_COOLDOWN)}s, nutze Scrape-Fallback"
        )


def fetch_research_combined(keywords: str, day_range: int = 90) -> Optional[Dict[str, Any]]:
    """ONE upstream /sh/research call returning aggregates+searchResults+metricsTrends.
    Shared cache for stats+trends+enrichment paths. Coalesced, in-process +
    sqlite-persistent cached, negative-cached on throttle/None."""
    if not _has_any_research_cookie():
        return None
    try:
        day_range = int(day_range or 90)
    except Exception:
        day_range = 90
    cache_key = f"combined:{keywords}:{day_range}"

    # 1. in-process cache
    cached = _RESEARCH_COMBINED_CACHE.get(cache_key)
    if cached is not None:
        return cached
    # 2. negative cache — recently throttled/None, don't re-hammer
    if _RESEARCH_NEG_CACHE.get(cache_key) is not None:
        return None
    # 3. persistent (sqlite) cache — warm after restart
    persisted = _persist_get(cache_key)
    if persisted is not None:
        _RESEARCH_COMBINED_CACHE.set(cache_key, persisted)
        return persisted
    # 3b. Imperva/Distil short-circuit — skip the doomed live call, go to scrape fast
    if _research_is_blocked():
        return None
    # 4. live fetch (coalesced)
    return _combined_coalescer.run(cache_key, _fetch_research_combined_uncached, keywords, day_range, cache_key)


def _fetch_research_combined_uncached(keywords: str, day_range: int, cache_key: str) -> Optional[Dict[str, Any]]:
    url = _build_research_url(keywords, day_range=day_range, include_trends=True)
    use_proxy = os.getenv("EBAY_RESEARCH_USE_PROXY", "1") == "1"
    cookie, cookie_id = _pick_cookie()
    if not cookie:
        return None

    try:
        # Pace FIRST, outside the limiter: the per-cookie wait can be tens of seconds
        # on a batch, and sleeping while holding a limiter slot starved everyone else
        # into the 15s acquire timeout. The limiter now only guards the actual HTTP call.
        if not _throttle_research_aimd(cookie_id):
            logger.info("[Research] Slot-Queue zu tief — Request übersprungen (Burst-Schutz)")
            return None
        with _research_limiter:
            resp = _do_research_request(url, cookie, cookie_id, use_proxy)
    except TimeoutError:
        logger.info("[Research-Combined] Limiter timeout — too many concurrent calls")
        return None

    if resp is None:
        # robust_request already handled throttle cooldown; negative-cache it
        _RESEARCH_NEG_CACHE.set(cache_key, True)
        return None
    if resp.status_code != 200:
        kind = _classify_research_body(resp.status_code, getattr(resp, "text", "") or "", getattr(resp, "url", "") or "")
        logger.info(f"[Research-Combined] HTTP {resp.status_code} ({kind}): {(getattr(resp,'text','') or '')[:160]}")
        _on_research_failure(kind, cookie_id)
        _RESEARCH_NEG_CACHE.set(cache_key, True)
        return None

    parsed = _parse_research_modules(resp.text)
    if not parsed.get("_has_aggregates"):
        kind = _classify_research_body(200, resp.text, getattr(resp, "url", "") or "")
        logger.info(f"[Research-Combined] 200 but no aggregates ({kind})")
        # soft-block / bot-wall / param error → cool cookie, negative-cache, let scrape take over
        _on_research_failure(kind, cookie_id)
        _RESEARCH_NEG_CACHE.set(cache_key, True)
        return None

    _on_research_success(cookie_id)
    data = {
        "avg_price": parsed.get("avg_price"),
        "median_price": parsed.get("median_price"),
        "monthly_sales": parsed.get("monthly_sales"),
        "trends": parsed.get("trends"),
        "day_range": day_range,
        "_source": "research_api",
    }
    _RESEARCH_COMBINED_CACHE.set(cache_key, data)
    _persist_set(cache_key, data, EBAY_RESEARCH_CACHE_TTL)
    return data


def check_research_cookie(test_keywords: str = "4052916891773") -> Dict[str, Any]:
    """Actively probe /sh/research with the current cookie — bypasses every cache AND the
    Imperva short-circuit, because the whole point is to learn the CURRENT truth.
    Fires the Discord alert on a dead cookie / block, and the recovery alert when it is
    healthy again. Returns a status dict. Meant for cron (see check_ebay_cookie.py), not
    for the request hot path.
    """
    if not _has_any_research_cookie():
        _alert_discord(
            "cookie_missing",
            "🍪 eBay Research-Cookie fehlt",
            f"`EBAY_RESEARCH_COOKIE` ist auf dem Server nicht gesetzt — es gibt keine "
            f"exakten Verkaufszahlen.\n\n{_COOKIE_REFRESH_HOWTO}",
        )
        return {"ok": False, "status": "missing", "detail": "EBAY_RESEARCH_COOKIE not set"}

    cookie, cookie_id = _pick_cookie()
    if not cookie:
        # every cookie in the pool is cooling down — probe the primary one anyway
        cookie = EBAY_RESEARCH_COOKIE or ""
        cookie_id = _cookie_id(cookie)

    url = _build_research_url(test_keywords, day_range=30, include_trends=False)
    use_proxy = os.getenv("EBAY_RESEARCH_USE_PROXY", "1") == "1"
    try:
        resp = _do_research_request(url, cookie, cookie_id, use_proxy)
    except Exception as e:
        return {"ok": False, "status": "exception", "detail": repr(e)[:200]}
    if resp is None:
        return {"ok": False, "status": "no_response", "detail": "request failed after retries"}

    body = getattr(resp, "text", "") or ""
    final_url = str(getattr(resp, "url", "") or "")

    if resp.status_code == 200:
        parsed = _parse_research_modules(body)
        if parsed.get("_has_aggregates"):
            _on_research_success(cookie_id)
            return {
                "ok": True, "status": "alive",
                "avg_price": parsed.get("avg_price"),
                "monthly_sales": parsed.get("monthly_sales"),
            }

    kind = _classify_research_body(resp.status_code, body, final_url)
    _on_research_failure(kind, cookie_id)
    return {
        "ok": False, "status": kind, "http": resp.status_code,
        "final_url": final_url[:120], "detail": body[:200],
    }


def _normalized_combined_day_range(day_range: int) -> int:
    """Collapse stats/trends callers onto one dayRange so the combined cache key
    is shared. Uses 90 (velocity-friendly window) unless combined mode is off."""
    try:
        dr = int(day_range or 90)
    except Exception:
        dr = 90
    return dr


def fetch_research_stats(keywords: str, day_range: int = 30) -> Optional[Dict[str, Any]]:
    """Adapter → slices {avg_price, median_price, monthly_sales} out of the ONE
    combined research fetch. Concurrent same-EAN callers share the upstream call.
    Backward-compatible: returns the same shape as before.

    monthly_sales is rescaled to a 30-day window when the combined dayRange
    differs (app.py velocity thresholds assume 30d)."""
    if not _has_any_research_cookie():
        return None
    if not EBAY_RESEARCH_COMBINED:
        return _fetch_research_stats_legacy(keywords, day_range)

    combined = fetch_research_combined(keywords, day_range=_normalized_combined_day_range(90))
    if combined is None:
        return None
    monthly = combined.get("monthly_sales")
    dr = combined.get("day_range") or 90
    if isinstance(monthly, (int, float)) and dr and int(dr) != 30 and int(dr) > 0:
        monthly = int(round(monthly * 30.0 / float(dr)))
    return {
        "avg_price": combined.get("avg_price"),
        "median_price": combined.get("median_price"),
        "monthly_sales": monthly,
        "_source": combined.get("_source", "research_api"),
    }


def _fetch_research_stats_legacy(keywords: str, day_range: int = 30) -> Optional[Dict[str, Any]]:
    """Legacy 2-call path (EBAY_RESEARCH_COMBINED=0) — kept for rollback."""
    try:
        day_range = int(day_range or 30)
    except Exception:
        day_range = 30
    cache_key = f"stats:{keywords}:{day_range}"
    cached = _RESEARCH_CACHE.get(cache_key)
    if cached is not None:
        return cached
    return _research_coalescer.run(cache_key, _fetch_research_stats_uncached, keywords, day_range, cache_key)


def _fetch_research_stats_uncached(keywords: str, day_range: int, cache_key: str) -> Optional[Dict[str, Any]]:
    """Inner uncached legacy fetch — guarded by limiter + circuit + proxy-health."""
    url = _build_research_url(keywords, day_range=day_range, include_trends=False)
    use_proxy = os.getenv("EBAY_RESEARCH_USE_PROXY", "1") == "1"
    cookie, cookie_id = _pick_cookie()
    if not cookie:
        return None
    try:
        # Pace FIRST, outside the limiter: the per-cookie wait can be tens of seconds
        # on a batch, and sleeping while holding a limiter slot starved everyone else
        # into the 15s acquire timeout. The limiter now only guards the actual HTTP call.
        if not _throttle_research_aimd(cookie_id):
            logger.info("[Research] Slot-Queue zu tief — Request übersprungen (Burst-Schutz)")
            return None
        with _research_limiter:
            resp = _do_research_request(url, cookie, cookie_id, use_proxy)
    except TimeoutError:
        logger.info("[Research] Limiter timeout — too many concurrent calls")
        return None

    if resp is None:
        return None
    if resp.status_code != 200:
        logger.info(f"[Research] HTTP {resp.status_code}: {resp.text[:160]}")
        return None

    parsed = _parse_research_modules(resp.text)
    if not parsed.get("_has_aggregates"):
        return None
    data = {
        "avg_price": parsed.get("avg_price"),
        "median_price": parsed.get("median_price"),
        "monthly_sales": parsed.get("monthly_sales"),
    }
    _RESEARCH_CACHE.set(cache_key, data)
    return data
def _normalize_metrics_trends(mod: Dict[str, Any]) -> Dict[str, Any]:
    series = mod.get("series") or []
    gran = mod.get("granularity") or "DAY"
    def _get_series(series_id: str) -> Optional[Dict[str, Any]]:
        return next((s for s in series if s.get("id") == series_id), None)
    s_avg = _get_series("averageSold")
    s_qty = _get_series("quantity")
    s_reg = _get_series("quantityRegressionLine")
    currency = (s_avg or {}).get("currencyCode") or "EUR"
    avg_map: Dict[int, Optional[float]] = {}
    qty_map: Dict[int, Optional[int]] = {}
    if s_avg:
        for row in (s_avg.get("data") or []):
            try:
                ts, val = int(row[0]), row[1]
                avg_map[ts] = float(val) if val is not None else None
            except Exception:
                continue
    if s_qty:
        for row in (s_qty.get("data") or []):
            try:
                ts, val = int(row[0]), row[1]
                qty_map[ts] = int(val) if val is not None else None
            except Exception:
                continue
    ts_all = sorted(set(list(avg_map.keys()) + list(qty_map.keys())))
    points: List[Dict[str, Any]] = []
    for ts in ts_all:
        points.append({"ts": ts, "averageSold": avg_map.get(ts), "quantity": qty_map.get(ts)})
    regression = None
    if s_reg and (s_reg.get("data") or []):
        reg_points = []
        for row in (s_reg.get("data") or []):
            try:
                ts, val = int(row[0]), row[1]
                reg_points.append({"ts": ts, "quantityRegressionLine": float(val) if val is not None else None})
            except Exception:
                continue
        if len(reg_points) >= 2:
            regression = {"from": reg_points[0], "to": reg_points[-1]}
    return {"granularity": gran, "currency": currency, "points": points, "regression": regression}
def fetch_research_trends(keywords: str, day_range: int = 30) -> Optional[Dict[str, Any]]:
    """Adapter → slices the normalized trends dict out of the ONE combined research
    fetch. Same return shape as before ({granularity,currency,points,regression})."""
    if not _has_any_research_cookie():
        return None
    if not EBAY_RESEARCH_COMBINED:
        return _fetch_research_trends_legacy(keywords, day_range)
    combined = fetch_research_combined(keywords, day_range=_normalized_combined_day_range(90))
    if combined is None:
        return None
    return combined.get("trends")


def _fetch_research_trends_legacy(keywords: str, day_range: int = 30) -> Optional[Dict[str, Any]]:
    """Legacy trends path (EBAY_RESEARCH_COMBINED=0)."""
    try:
        day_range = int(day_range or 30)
    except Exception:
        day_range = 30
    cache_key = f"trends:{keywords}:{day_range}"
    cached = _RESEARCH_TRENDS_CACHE.get(cache_key)
    if cached is not None:
        return cached
    return _trends_coalescer.run(cache_key, _fetch_research_trends_uncached, keywords, day_range, cache_key)


def _fetch_research_trends_uncached(keywords: str, day_range: int, cache_key: str) -> Optional[Dict[str, Any]]:
    url = _build_research_url(keywords, day_range=day_range, include_trends=True)
    use_proxy = os.getenv("EBAY_RESEARCH_USE_PROXY", "1") == "1"
    cookie, cookie_id = _pick_cookie()
    if not cookie:
        return None
    try:
        # Pace FIRST, outside the limiter: the per-cookie wait can be tens of seconds
        # on a batch, and sleeping while holding a limiter slot starved everyone else
        # into the 15s acquire timeout. The limiter now only guards the actual HTTP call.
        if not _throttle_research_aimd(cookie_id):
            logger.info("[Research] Slot-Queue zu tief — Request übersprungen (Burst-Schutz)")
            return None
        with _research_limiter:
            resp = _do_research_request(url, cookie, cookie_id, use_proxy)
    except TimeoutError:
        logger.info("[Research-Trends] Limiter timeout — too many concurrent calls")
        return None

    if resp is None:
        return None
    if resp.status_code != 200:
        logger.info(f"[Research-Trends] HTTP {resp.status_code}: {resp.text[:160]}")
        return None

    modules = _parse_ndjson_modules(resp.text)
    trends_mod = next((m for m in modules if isinstance(m, dict) and m.get("_type") == "MetricsTrendsModule"), None)
    if not trends_mod:
        return None
    data = _normalize_metrics_trends(trends_mod)
    _RESEARCH_TRENDS_CACHE.set(cache_key, data)
    return data
def calc_days_to_cash_window(offer_count: Optional[int], sales_nd: Optional[int], window_days: int) -> Optional[int]:
    if not offer_count or offer_count <= 0:
        return None
    if not sales_nd or sales_nd <= 0:
        return None
    return int(round((offer_count * window_days) / sales_nd))
def calc_days_to_cash(offer_count: Optional[int], sales_30d: Optional[int]) -> Optional[int]:
    """
    Backward-compatible wrapper.
    Alte Call-Sites erwarten 30d-Fenster.
    """
    return calc_days_to_cash_window(offer_count, sales_30d, 30)

# Backward-compat alias
derive_days_to_cash = calc_days_to_cash
# =========================================================
# PUBLIC ENTRYPOINT
# =========================================================
def lookup_ebay_metrics_query(
    query: str,
    mode: str,                      # "ean" | "keyword"
    ek_net: float,
    shipping_out_net: float = 5.0,
    shipping_in_net: float = 0.0,
    other_costs_net: float = 0.0,
    vat_mode: str = "gross",
    vat_rate: float = 0.19,
    fee_up_to_200: float = 0.12,
    fee_above_200: float = 0.12,
    trends_day_range: int = 30,
    title: Optional[str] = None,
    bad_words: Optional[List[str]] = None,
) -> Dict[str, Any]:
    q = (query or "").strip()
    if not q:
        return {"error": "Query fehlt."}
    if mode not in ("ean", "keyword"):
        return {"error": "mode muss 'ean' oder 'keyword' sein."}
    # ✅ Research-only Mode: Browse komplett skippen
    if EBAY_DISABLE_BROWSE:
        research = None
        if _has_any_research_cookie():
            research = fetch_research_stats(q, day_range=int(trends_day_range))

        # Wenn Research kein Ergebnis → Public Sold Scrape als Fallback.
        # Mit Produkt-Titel: nach dem Namen suchen (bessere Treffer als die nackte EAN,
        # die eBay nur fuzzy matcht) und per Modell-Token auf die echte Variante filtern.
        # EBAY_SCRAPE_FALLBACK=0 → research-only: lieber GAR KEINE Daten als eine
        # Scrape-Schätzung, die als exakte Zahl missverstanden wird (die hat schon
        # falsche BUY-Signale erzeugt). Erst einschalten, wenn die Hetzner-Probe
        # (check_ebay_cookie.py) bestätigt, dass Research vom Server aus durchkommt.
        if not research or (research.get("avg_price") is None and research.get("median_price") is None):
            if not EBAY_SCRAPE_FALLBACK:
                logger.info(f"[Research-only] Keine Research-Daten für '{q}' — Scrape-Fallback ist aus")
                return {"error": "Keine Research-Daten (Scrape-Fallback deaktiviert: EBAY_SCRAPE_FALLBACK=0)."}
            scrape_query = (title or "").strip() or q
            match_tokens = _relevance_tokens(title)
            fallback = _fetch_public_sold_prices(scrape_query, match_tokens=match_tokens)
            if fallback:
                research = fallback
                logger.info(
                    f"[Fallback] Public Sold Scrape für '{scrape_query}'"
                    + (f" (Filter: {match_tokens})" if match_tokens else "")
                )

        if not research:
            return {"error": "Keine Preisdaten verfügbar (Research-Cookie fehlt/tot und Public-Scrape ohne Ergebnis)."}

        research_avg_gross = research.get("avg_price")
        research_med_gross = research.get("median_price")
        sales_30d = research.get("monthly_sales")
        # Basispreis muss existieren
        avg_gross_basis = float(research_avg_gross) if isinstance(research_avg_gross, (int, float)) else None
        med_gross_basis = float(research_med_gross) if isinstance(research_med_gross, (int, float)) else None
        if avg_gross_basis is None and med_gross_basis is None:
            return {"error": "Kein Preis extrahierbar (avg/median beide None)."}
        # fallback: wenn eins fehlt, nimm das andere
        if avg_gross_basis is None:
            avg_gross_basis = float(med_gross_basis)
        if med_gross_basis is None:
            med_gross_basis = float(avg_gross_basis)
        # Trends come from the SAME combined cache entry (no extra upstream call).
        trends = None
        if research.get("_source") != "public_scrape" and _has_any_research_cookie():
            trends = fetch_research_trends(q, day_range=90)
        avg_stats = calc_profit_net(
            sale_gross=float(avg_gross_basis),
            buy_net=float(ek_net),
            shipping_out_net=float(shipping_out_net),
            shipping_in_net=float(shipping_in_net),
            other_costs_net=float(other_costs_net),
            vat_rate=float(vat_rate),
            fee_up_to_200=float(fee_up_to_200),
            fee_above_200=float(fee_above_200),
        )
        med_stats = calc_profit_net(
            sale_gross=float(med_gross_basis),
            buy_net=float(ek_net),
            shipping_out_net=float(shipping_out_net),
            shipping_in_net=float(shipping_in_net),
            other_costs_net=float(other_costs_net),
            vat_rate=float(vat_rate),
            fee_up_to_200=float(fee_up_to_200),
            fee_above_200=float(fee_above_200),
        )
        ALWAYS_VAT = 0.19
        sell_net_avg = round(gross_to_net(float(avg_gross_basis), ALWAYS_VAT), 2)
        sell_net_median = round(gross_to_net(float(med_gross_basis), ALWAYS_VAT), 2)
        # offer_count/days_to_cash nicht möglich ohne Active Listings
        offer_count = None
        days_to_cash = None
        # Trends → price_series / qty_series (Format das app.py erwartet: [[ts_ms, wert], ...])
        price_series: List[List] = []
        qty_series: List[List] = []
        if trends and trends.get("points"):
            for pt in trends["points"]:
                ts = pt.get("ts")
                if ts is None:
                    continue
                avg_v = pt.get("averageSold")
                qty_v = pt.get("quantity")
                if avg_v is not None:
                    price_series.append([ts, round(float(avg_v), 2)])
                if qty_v is not None:
                    qty_series.append([ts, int(qty_v)])
        return {
            "mode": mode,
            "query": q,
            # Feldnamen die app.py erwartet
            "sell_price_avg":    round(float(avg_gross_basis), 2),
            "sell_price_median": round(float(med_gross_basis), 2),
            # Aliases für Abwärtskompatibilität
            "sell_gross_avg":    round(float(avg_gross_basis), 2),
            "sell_gross_median": round(float(med_gross_basis), 2),
            "revenue_cash_avg": avg_stats["revenue_cash"],
            "revenue_cash_median": med_stats["revenue_cash"],
            "ebay_fee_cash_avg": avg_stats["ebay_fee_cash"],
            "ebay_fee_cash_median": med_stats["ebay_fee_cash"],
            "profit_cash_avg": avg_stats["profit_cash"],
            "profit_cash_median": med_stats["profit_cash"],
            "roi_cash_avg": avg_stats["roi_cash"],
            "roi_cash_median": med_stats["roi_cash"],
            "margin_cash_avg": avg_stats["margin_cash"],
            "margin_cash_median": med_stats["margin_cash"],
            "sales_days": int(trends_day_range),
            "sales_30d": sales_30d,
            "days_to_cash": days_to_cash,
            "sell_net_avg": sell_net_avg,
            "sell_net_median": sell_net_median,
            "price_series": price_series,
            "qty_series":   qty_series,
            "inputs": {
                "ek_net": round(float(ek_net), 2),
                "shipping_out_net": round(float(shipping_out_net), 2),
                "shipping_in_net": round(float(shipping_in_net), 2),
                "other_costs_net": round(float(other_costs_net), 2),
                "vat_rate": float(vat_rate),
                "fee_up_to_200": float(fee_up_to_200),
                "fee_above_200": float(fee_above_200),
            },
            "trends": trends,
            "debug": {
                "browse_disabled": True,
                "offer_count": offer_count,
                "browse_avg_gross": None,
                "browse_median_gross": None,
                "rep_title": None,
                "rep_itemId": None,
                "research_ok": True,
                "research_source": research.get("_source", "research_api"),
                "velocity_approx": bool(research.get("velocity_approx")),
                "trends_range": int(trends_day_range),
                "trends_ok": bool(trends and (trends.get("points") is not None)),
                "keyword_filtered": False,
            },
        }
    # =====================================================
    # Legacy / Hybrid Mode (Browse enabled)
    # =====================================================
    if mode == "ean":
        items = search_items_by_ean(q, limit=25)
    else:
        items = search_items_by_keyword(q, limit=25)
    if not items:
        return {"error": "Keine eBay-Angebote gefunden."}
    if mode == "keyword":
        items = _filter_items_by_title(items, bad_words=bad_words)
        if len(items) < 5:
            items = search_items_by_keyword(q, limit=25)
            items = _filter_items_by_title(items, bad_words=bad_words) or items
    else:
        soft_bad = ["case", "cover", "hülle", "folie", "schutz", "zubehör", "accessory"]
        filtered2 = _filter_items_by_title(items, bad_words=soft_bad)
        if len(filtered2) >= 5:
            items = filtered2
    browse_prices = _build_browse_market_prices(items)
    if not browse_prices.get("ok"):
        return {"error": "Konnte keinen gültigen Preis extrahieren."}
    research = fetch_research_stats(q, day_range=int(trends_day_range))
    research_ok = bool(research and (research.get("monthly_sales") is not None))
    trends = fetch_research_trends(q, day_range=90) if _has_any_research_cookie() else None
    browse_avg_gross = float(browse_prices["browse_avg"])
    browse_median_gross = float(browse_prices["browse_median"])
    research_avg_gross = research.get("avg_price") if research else None
    research_med_gross = research.get("median_price") if research else None
    sales_30d = research.get("monthly_sales") if research else None
    avg_gross_basis = float(research_avg_gross) if isinstance(research_avg_gross, (int, float)) else browse_avg_gross
    med_gross_basis = float(research_med_gross) if isinstance(research_med_gross, (int, float)) else browse_median_gross
    avg_stats = calc_profit_net(
        sale_gross=float(avg_gross_basis),
        buy_net=float(ek_net),
        shipping_out_net=float(shipping_out_net),
        shipping_in_net=float(shipping_in_net),
        other_costs_net=float(other_costs_net),
        vat_rate=float(vat_rate),
        fee_up_to_200=float(fee_up_to_200),
        fee_above_200=float(fee_above_200),
    )
    med_stats = calc_profit_net(
        sale_gross=float(med_gross_basis),
        buy_net=float(ek_net),
        shipping_out_net=float(shipping_out_net),
        shipping_in_net=float(shipping_in_net),
        other_costs_net=float(other_costs_net),
        vat_rate=float(vat_rate),
        fee_up_to_200=float(fee_up_to_200),
        fee_above_200=float(fee_above_200),
    )
    offer_count = browse_prices.get("offer_count")
    days_to_cash = calc_days_to_cash_window(offer_count, sales_30d, int(trends_day_range))
    ALWAYS_VAT = 0.19
    sell_net_avg = round(gross_to_net(float(avg_gross_basis), ALWAYS_VAT), 2)
    sell_net_median = round(gross_to_net(float(med_gross_basis), ALWAYS_VAT), 2)
    # Trends → price_series / qty_series
    price_series: List[List] = []
    qty_series: List[List] = []
    if trends and trends.get("points"):
        for pt in trends["points"]:
            ts = pt.get("ts")
            if ts is None:
                continue
            avg_v = pt.get("averageSold")
            qty_v = pt.get("quantity")
            if avg_v is not None:
                price_series.append([ts, round(float(avg_v), 2)])
            if qty_v is not None:
                qty_series.append([ts, int(qty_v)])
    return {
        "mode": mode,
        "query": q,
        # Feldnamen die app.py erwartet
        "sell_price_avg":    round(float(avg_gross_basis), 2),
        "sell_price_median": round(float(med_gross_basis), 2),
        # Aliases für Abwärtskompatibilität
        "sell_gross_avg":    round(float(avg_gross_basis), 2),
        "sell_gross_median": round(float(med_gross_basis), 2),
        "revenue_cash_avg": avg_stats["revenue_cash"],
        "revenue_cash_median": med_stats["revenue_cash"],
        "ebay_fee_cash_avg": avg_stats["ebay_fee_cash"],
        "ebay_fee_cash_median": med_stats["ebay_fee_cash"],
        "profit_cash_avg": avg_stats["profit_cash"],
        "profit_cash_median": med_stats["profit_cash"],
        "roi_cash_avg": avg_stats["roi_cash"],
        "roi_cash_median": med_stats["roi_cash"],
        "margin_cash_avg": avg_stats["margin_cash"],
        "margin_cash_median": med_stats["margin_cash"],
        "sales_days": int(trends_day_range),
        "sales_30d": sales_30d,
        "days_to_cash": days_to_cash,
        "sell_net_avg": sell_net_avg,
        "sell_net_median": sell_net_median,
        "price_series": price_series,
        "qty_series":   qty_series,
        "inputs": {
            "ek_net": round(float(ek_net), 2),
            "shipping_out_net": round(float(shipping_out_net), 2),
            "shipping_in_net": round(float(shipping_in_net), 2),
            "other_costs_net": round(float(other_costs_net), 2),
            "vat_rate": float(vat_rate),
            "fee_up_to_200": float(fee_up_to_200),
            "fee_above_200": float(fee_above_200),
        },
        "trends": trends,
        "debug": {
            "browse_disabled": False,
            "offer_count": offer_count,
            "browse_avg_gross": browse_avg_gross,
            "browse_median_gross": browse_median_gross,
            "rep_title": browse_prices.get("rep_title"),
            "rep_itemId": browse_prices.get("rep_itemId"),
            "rep_image": browse_prices.get("rep_image"),
            "research_ok": research_ok,
            "trends_range": int(trends_day_range),
            "trends_ok": bool(trends and (trends.get("points") is not None)),
            "keyword_filtered": (mode == "keyword"),
        },
    }
def lookup_ebay_metrics(ean: str, ek_net: float, **kwargs):
    return lookup_ebay_metrics_query(query=ean, mode="ean", ek_net=ek_net, **kwargs)
def lookup_offer_count(query: str, mode: str, bad_words: Optional[List[str]] = None) -> Optional[int]:
    # ✅ wenn Browse aus ist, gibt es kein offer_count
    if EBAY_DISABLE_BROWSE:
        return None
    q = (query or "").strip()
    if not q:
        return None
    if mode == "ean":
        items = search_items_by_ean(q, limit=25)
        soft_bad = ["case","cover","hülle","folie","schutz","zubehör","accessory"]
        filtered = _filter_items_by_title(items, bad_words=soft_bad)
        if len(filtered) >= 5:
            items = filtered
    else:
        items = search_items_by_keyword(q, limit=25)
        items = _filter_items_by_title(items, bad_words=bad_words)
        if len(items) < 5:
            items = search_items_by_keyword(q, limit=25)
    if not items:
        return None
    browse_prices = _build_browse_market_prices(items)
    if not browse_prices.get("ok"):
        return None
    return int(browse_prices.get("offer_count") or 0)
