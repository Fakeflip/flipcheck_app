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
# PROXY ROTATION (Research scraping)
# =========================================================
_RAW_PROXIES = [
    "82.25.197.175:61234:user_c19093666cc1:wy0tCBJt",
    "82.25.202.144:61234:user_01b8187438ef:bmAD6Cae",
    "82.25.202.246:61234:user_9397c11aa7c9:Ni3W6nEo",
    "88.135.99.9:61234:user_9e85beaac451:RNCF6VAa",
    "88.135.99.33:61234:user_2f8623fdea99:GxHT6JFy",
    "88.135.99.106:61234:user_14b9aa1a93e9:0WXnfNeZ",
    "88.135.99.113:61234:user_3c1866aeb60f:qVfP0R3r",
    "88.135.99.147:61234:user_95e3199150b0:rwPc5LeF",
    "88.135.99.209:61234:user_ace3fa75d6a4:CXPwsJrm",
    "88.135.99.243:61234:user_6163e08b6c75:PdlSG1tJ",
]

def _parse_proxy_list(raw: List[str]) -> List[Dict[str, str]]:
    """Parse 'ip:port:user:password' → requests proxy dict."""
    result = []
    for entry in raw:
        parts = entry.strip().split(":")
        if len(parts) != 4:
            continue
        ip, port, user, pw = parts
        url = f"http://{user}:{pw}@{ip}:{port}"
        result.append({"http": url, "https": url})
    return result

_PROXY_LIST: List[Dict[str, str]] = _parse_proxy_list(_RAW_PROXIES)

def _get_proxy() -> Optional[Dict[str, str]]:
    """Return a random proxy from the pool (None if pool empty)."""
    if not _PROXY_LIST:
        return None
    return random.choice(_PROXY_LIST)

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

def _fetch_public_sold_prices(query: str) -> Optional[Dict[str, Any]]:
    """
    Scrapt öffentliche eBay Abgeschlossene Angebote (LH_Sold=1).
    Kein OAuth, kein Cookie nötig — funktioniert immer als Fallback.
    Gibt {"avg_price", "median_price", "monthly_sales": None} zurück.
    """
    cache_key = query.strip().lower()
    now = time.time()
    hit = _PUBLIC_SOLD_CACHE.get(cache_key)
    if hit and (now - hit["ts"] < _PUBLIC_SOLD_TTL):
        return hit["data"]

    try:
        url = (
            "https://www.ebay.de/sch/i.html"
            f"?_nkw={requests.utils.quote(query)}"
            "&LH_Complete=1&LH_Sold=1&_sacat=0&_sop=10&_ipg=50"
        )
        headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-DE,de;q=0.9",
            "User-Agent": SESSION.headers.get("User-Agent", "Mozilla/5.0"),
        }
        proxy = _get_proxy()
        resp = SESSION.get(url, headers=headers, timeout=12, proxies=proxy)
        if resp.status_code != 200:
            return None

        # Preise aus HTML extrahieren (kein BeautifulSoup nötig)
        # eBay schreibt Preise als: EUR 12,99 oder 12,99 €
        price_pattern = re.compile(
            r'class="s-item__price"[^>]*>.*?(?:EUR\s*|)(\d{1,4}[.,]\d{2})\s*(?:€|EUR)?',
            re.DOTALL | re.IGNORECASE,
        )
        raw_prices = price_pattern.findall(resp.text)
        prices: List[float] = []
        for raw in raw_prices:
            p = _parse_price_number(raw)
            if p and 0.5 < p < 5000:
                prices.append(p)

        if len(prices) < 3:
            return None

        prices.sort()
        n = len(prices)
        median = prices[n // 2] if n % 2 == 1 else (prices[n // 2 - 1] + prices[n // 2]) / 2
        # IQR-filter: Ausreißer entfernen
        q1, q3 = prices[n // 4], prices[(3 * n) // 4]
        iqr = q3 - q1
        filtered = [p for p in prices if q1 - 1.5 * iqr <= p <= q3 + 1.5 * iqr] or prices
        avg = sum(filtered) / len(filtered)

        data = {
            "avg_price": round(avg, 2),
            "median_price": round(median, 2),
            "monthly_sales": None,
            "_source": "public_scrape",
        }
        _PUBLIC_SOLD_CACHE[cache_key] = {"ts": now, "data": data}
        logger.info(f"[PublicSold] {query}: median={median:.2f} avg={avg:.2f} n={len(prices)}")
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
_RESEARCH_CACHE: Dict[str, Dict[str, Any]] = {}
_RESEARCH_TTL = 30 * 60
_LAST_RESEARCH_TS = 0.0
_RESEARCH_TRENDS_CACHE: Dict[str, Dict[str, Any]] = {}
_RESEARCH_TRENDS_TTL = 6 * 60 * 60
def _throttle_research(min_interval: float = 0.6) -> None:
    global _LAST_RESEARCH_TS
    dt = time.time() - _LAST_RESEARCH_TS
    if dt < min_interval:
        time.sleep(min_interval - dt)
    _LAST_RESEARCH_TS = time.time()
def _parse_price_number(text: str) -> Optional[float]:
    if not text:
        return None
    t = text.replace("€", "").strip()
    t = t.replace(".", "").replace(",", ".")
    try:
        return float(t)
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
    end_ts = int(time.time() * 1000)
    start_ts = end_ts - int(day_range) * 24 * 60 * 60 * 1000
    params: List[Tuple[str, str]] = [
        ("marketplace", "EBAY-DE"),
        ("keywords", keywords),
        ("dayRange", str(day_range)),
        ("endDate", str(end_ts)),
        ("startDate", str(start_ts)),
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
def fetch_research_stats(keywords: str, day_range: int = 30) -> Optional[Dict[str, Any]]:
    if not EBAY_RESEARCH_COOKIE:
        return None
    try:
        day_range = int(day_range or 30)
    except Exception:
        day_range = 30
    cache_key = f"{keywords}__{day_range}"
    now = time.time()
    hit = _RESEARCH_CACHE.get(cache_key)
    if hit and (now - hit["ts"] < _RESEARCH_TTL):
        return hit["data"]
    url = _build_research_url(keywords, day_range=day_range, include_trends=False)
    headers = {
        "Cookie": EBAY_RESEARCH_COOKIE,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        "Referer": "https://www.ebay.de/sh/research",
        "Connection": "keep-alive",
        "User-Agent": SESSION.headers.get("User-Agent", "Mozilla/5.0"),
        "X-Requested-With": "XMLHttpRequest",
    }
    _throttle_research(0.6)
    proxy = _get_proxy()
    try:
        resp = SESSION.get(url, headers=headers, timeout=12, proxies=proxy)
    except Exception:
        return None
    if resp.status_code != 200:
        logger.info(f"[Research] HTTP {resp.status_code}: {resp.text[:160]}")
        return None
    modules = _parse_ndjson_modules(resp.text)
    aggregates = next((m for m in modules if m.get("_type") == "ResearchAggregateModule"), None)
    search_results = next((m for m in modules if m.get("_type") == "SearchResultsModule"), None)
    if not aggregates:
        return None
    sections = aggregates.get("sections", [])
    def _val(sec_idx: int, item_idx: int) -> Optional[str]:
        try:
            return sections[sec_idx]["dataItems"][item_idx]["value"]["textSpans"][0]["text"]
        except Exception:
            return None
    avg_text = _val(0, 0)
    sold_text = _val(2, 0)
    avg_price = _parse_price_number(avg_text) if avg_text else None
    digits = re.sub(r"[^\d]", "", sold_text or "")
    sold_count = int(digits) if digits else None
    med_price = None
    if search_results:
        med_price = _extract_median_from_search_results(search_results)
    data = {"avg_price": avg_price, "median_price": med_price, "monthly_sales": sold_count}
    _RESEARCH_CACHE[cache_key] = {"ts": time.time(), "data": data}
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
    if not EBAY_RESEARCH_COOKIE:
        return None
    cache_key = f"{keywords}__{int(day_range)}"
    now = time.time()
    hit = _RESEARCH_TRENDS_CACHE.get(cache_key)
    if hit and (now - hit["ts"] < _RESEARCH_TRENDS_TTL):
        return hit["data"]
    url = _build_research_url(keywords, day_range=int(day_range), include_trends=True)
    headers = {
        "Cookie": EBAY_RESEARCH_COOKIE,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        "Referer": "https://www.ebay.de/sh/research",
        "Connection": "keep-alive",
        "User-Agent": SESSION.headers.get("User-Agent", "Mozilla/5.0"),
        "X-Requested-With": "XMLHttpRequest",
    }
    _throttle_research(0.6)
    proxy = _get_proxy()
    try:
        resp = SESSION.get(url, headers=headers, timeout=12, proxies=proxy)
    except Exception:
        return None
    if resp.status_code != 200:
        return None
    modules = _parse_ndjson_modules(resp.text)
    trends_mod = next((m for m in modules if isinstance(m, dict) and m.get("_type") == "MetricsTrendsModule"), None)
    if not trends_mod:
        return None
    data = _normalize_metrics_trends(trends_mod)
    _RESEARCH_TRENDS_CACHE[cache_key] = {"ts": time.time(), "data": data}
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
        if EBAY_RESEARCH_COOKIE:
            research = fetch_research_stats(q, day_range=int(trends_day_range))

        # Wenn Research kein Ergebnis → Public Sold Scrape als Fallback
        if not research or (research.get("avg_price") is None and research.get("median_price") is None):
            fallback = _fetch_public_sold_prices(q)
            if fallback:
                research = fallback
                logger.info(f"[Fallback] Nutze Public Sold Scrape für '{q}'")

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
        trends = fetch_research_trends(q, day_range=90) if EBAY_RESEARCH_COOKIE else None
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
    trends = fetch_research_trends(q, day_range=90) if EBAY_RESEARCH_COOKIE else None
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
