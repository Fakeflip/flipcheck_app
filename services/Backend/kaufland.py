import re
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Any

from curl_cffi import requests  # WICHTIG: curl_cffi

BASE = "https://www.kaufland.de"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.kaufland.de/",
}

# -----------------------------
# Proxy-Liste (rotierend) - BLEIBT IM SCRIPT
# -----------------------------
PROXIES_LIST = [
    "http://ue2NF6VM:QYCwB72b-cc-de-sessid-qoh955ra-sesstime-60@boilingbraineu.boilingproxies.com:7002",
    "http://ue2NF6VM:QYCwB72b-cc-de-sessid-u1q5l3h5-sesstime-60@boilingbraineu.boilingproxies.com:7002",
    "http://ue2NF6VM:QYCwB72b-cc-de-sessid-dto9kg6l-sesstime-60@boilingbraineu.boilingproxies.com:7002",
    "http://ue2NF6VM:QYCwB72b-cc-de-sessid-0pec2hud-sesstime-60@boilingbraineu.boilingproxies.com:7002",
    "http://ue2NF6VM:QYCwB72b-cc-de-sessid-tek0xyk3-sesstime-60@boilingbraineu.boilingproxies.com:7002",
    "http://ue2NF6VM:QYCwB72b-cc-de-sessid-qzukc3qr-sesstime-60@boilingbraineu.boilingproxies.com:7002",
    "http://ue2NF6VM:QYCwB72b-cc-de-sessid-gnih351l-sesstime-60@boilingbraineu.boilingproxies.com:7002",
    "http://ue2NF6VM:QYCwB72b-cc-de-sessid-969edao8-sesstime-60@boilingbraineu.boilingproxies.com:7002",
    "http://ue2NF6VM:QYCwB72b-cc-de-sessid-uqq2x5g3-sesstime-60@boilingbraineu.boilingproxies.com:7002",
    "http://ue2NF6VM:QYCwB72b-cc-de-sessid-96qmethk-sesstime-60@boilingbraineu.boilingproxies.com:7002",
]

BLOCK_STATUSES = {403, 429, 503}
IMPERSONATE = "safari"
TIMEOUT_S = 15
MAX_RETRIES = 3
BACKOFF_BASE_S = 0.6  # attempt multiplier


# -----------------------------
# In-memory cache
# -----------------------------
_CACHE: Dict[str, Tuple[float, Any]] = {}

def cache_get(key: str, ttl_s: int) -> Optional[Any]:
    hit = _CACHE.get(key)
    if not hit:
        return None
    ts, val = hit
    if (time.time() - ts) > ttl_s:
        _CACHE.pop(key, None)
        return None
    return val

def cache_set(key: str, val: Any):
    _CACHE[key] = (time.time(), val)


# -----------------------------
# Core parsers
# -----------------------------
def parse_bestseller(html: str) -> bool:
    return bool(
        re.search(r"\bbestseller-badge\b", html) or
        re.search(r'aria-label="Bestseller-Abzeichen"', html)
    )

def parse_rating(html: str) -> Tuple[Optional[float], Optional[int]]:
    """Extract star rating and review count from Kaufland PDP HTML."""
    rating = None
    review_count = None
    # Pattern: "Die Produktbewertung betraegt X.X Stern. Es basiert auf Y Bewertungen."
    m = re.search(r'Produktbewertung\D+([\d,\.]+)\s*Stern', html)
    if m:
        rating = float(m.group(1).replace(',', '.'))
    # Fallback: JSON-LD or aria pattern
    if rating is None:
        m2 = re.search(r'"ratingValue"\s*:\s*"?([\d,\.]+)"?', html)
        if m2:
            rating = float(m2.group(1).replace(',', '.'))
    # Review count
    m3 = re.search(r'basiert auf\s+(\d+)\s+Bewertung', html)
    if m3:
        review_count = int(m3.group(1))
    if review_count is None:
        m4 = re.search(r'"reviewCount"\s*:\s*"?(\d+)"?', html)
        if m4:
            review_count = int(m4.group(1))
    # Fallback: "(42)" next to stars
    if review_count is None:
        m5 = re.search(r'\((\d+)\)\s*(?:Bewertung|Review)', html, re.IGNORECASE)
        if m5:
            review_count = int(m5.group(1))
    return rating, review_count

def demand_score(offers_count: Optional[int], bestseller: Optional[bool]) -> Tuple[int, str]:
    score = 50
    if bestseller is True:
        score += 20
    if offers_count is None or offers_count < 0:
        pass
    elif offers_count <= 2:
        score -= 10
    elif 3 <= offers_count <= 8:
        score += 10
    elif 9 <= offers_count <= 15:
        score += 0
    else:
        score -= 15

    score = max(0, min(100, score))
    if score >= 75:
        label = "HOT"
    elif score >= 55:
        label = "OK"
    else:
        label = "RISK"
    return score, label


# -----------------------------
# Request with Proxy-Rotation + Retry + Backoff
# -----------------------------
@dataclass
class ReqMeta:
    proxy: Optional[str]
    attempts: int
    status: Optional[int]
    blocked: bool

def _pick_next_proxy(session: requests.Session) -> Optional[str]:
    if not PROXIES_LIST:
        return None
    idx = getattr(session, "_proxy_index", 0)
    proxy = PROXIES_LIST[idx % len(PROXIES_LIST)]
    session._proxy_index = idx + 1
    return proxy

def request_with_proxy(session: requests.Session, method: str, url: str, **kwargs) -> Tuple[Optional[requests.Response], ReqMeta]:
    last_status: Optional[int] = None
    last_proxy: Optional[str] = None
    blocked = False

    for attempt in range(1, MAX_RETRIES + 1):
        proxy = _pick_next_proxy(session)
        last_proxy = proxy

        try:
            if proxy:
                kwargs["proxies"] = {"http": proxy, "https": proxy}
            kwargs["impersonate"] = IMPERSONATE
            kwargs["timeout"] = TIMEOUT_S

            r = session.request(method, url, **kwargs)
            last_status = r.status_code

            if r.status_code in BLOCK_STATUSES:
                blocked = True
                time.sleep(BACKOFF_BASE_S * attempt)
                continue

            r.raise_for_status()
            return r, ReqMeta(proxy=proxy, attempts=attempt, status=r.status_code, blocked=False)

        except Exception:
            time.sleep(BACKOFF_BASE_S * attempt)
            continue

    return None, ReqMeta(proxy=last_proxy, attempts=MAX_RETRIES, status=last_status, blocked=blocked)


# -----------------------------
# EAN → Product ID
# -----------------------------
def ean_to_product_id(session: requests.Session, ean: str, cache_ttl_s: int = 7 * 24 * 3600) -> Dict[str, Any]:
    cache_key = f"kaufland:ean:{ean}"
    cached = cache_get(cache_key, cache_ttl_s)
    if cached:
        return {**cached, "cached": True}

    r, meta = request_with_proxy(session, "get", f"{BASE}/s/", params={"search_value": ean})
    if not r:
        res = {"ok": False, "product_id": None, "status": meta.status, "reason": "BLOCKED_OR_ERROR", "req": meta.__dict__}
        cache_set(cache_key, res)
        return {**res, "cached": False}

    html = r.text
    match = re.search(r'href="/product/(\d+)', html)
    if match:
        pid = int(match.group(1))
        res = {"ok": True, "product_id": pid, "status": r.status_code, "reason": None, "req": meta.__dict__}
        cache_set(cache_key, res)
        return {**res, "cached": False}

    low = html.lower()
    if any(phrase in low for phrase in ("keine ergebnisse", "0 ergebnisse", "nichts gefunden")):
        res = {"ok": False, "product_id": None, "status": r.status_code, "reason": "NOT_FOUND", "req": meta.__dict__}
        cache_set(cache_key, res)
        return {**res, "cached": False}

    res = {"ok": False, "product_id": None, "status": r.status_code, "reason": "NO_MATCH", "req": meta.__dict__}
    cache_set(cache_key, res)
    return {**res, "cached": False}


# -----------------------------
# Offers count
# -----------------------------
def get_offers_count(session: requests.Session, product_id: int, condition: str = "new", limit: int = 100, cache_ttl_s: int = 1800) -> Dict[str, Any]:
    cache_key = f"kaufland:offers:{product_id}:{condition}:{limit}"
    cached = cache_get(cache_key, cache_ttl_s)
    if cached:
        return {**cached, "cached": True}

    url = f"{BASE}/api/pdp-frontend/v1/{product_id}/offers"
    params = {"offset": 0, "limit": limit, "condition": condition}
    api_headers = HEADERS.copy()
    api_headers["Accept"] = "application/json, text/plain, */*"

    r, meta = request_with_proxy(session, "get", url, params=params, headers=api_headers)
    if not r:
        res = {"ok": False, "offers_count": None, "status": meta.status, "reason": "BLOCKED_OR_ERROR", "req": meta.__dict__}
        cache_set(cache_key, res)
        return {**res, "cached": False}

    try:
        data = r.json()
        offers_list = None
        for k in ("newOffers", "offers", "items"):
            if k in data and isinstance(data[k], list):
                offers_list = data[k]
                break
        offers_count = len(offers_list) if offers_list is not None else 0
        res = {"ok": True, "offers_count": offers_count, "status": r.status_code, "reason": None, "req": meta.__dict__}
        cache_set(cache_key, res)
        return {**res, "cached": False}
    except Exception:
        res = {"ok": False, "offers_count": None, "status": r.status_code, "reason": "BAD_JSON", "req": meta.__dict__}
        cache_set(cache_key, res)
        return {**res, "cached": False}

def get_offers_min_price(
    session: requests.Session,
    product_id: int,
    condition: str = "new",
    limit: int = 100,
    cache_ttl_s: int = 900,
) -> Dict[str, Any]:
    """
    Holt Offers und berechnet den günstigsten Gesamtpreis (price + deliveryRate).
    condition: "new" oder "used"
    """
    cache_key = f"kaufland:offers_min:{product_id}:{condition}:{limit}"
    cached = cache_get(cache_key, cache_ttl_s)
    if cached:
        return {**cached, "cached": True}

    url = f"{BASE}/api/pdp-frontend/v1/{product_id}/offers"
    params = {"offset": 0, "limit": limit, "condition": condition}
    api_headers = HEADERS.copy()
    api_headers["Accept"] = "application/json, text/plain, */*"

    r, meta = request_with_proxy(session, "get", url, params=params, headers=api_headers)
    if not r:
        res = {
            "ok": False,
            "offers_count": None,
            "min_total": None,
            "min_price": None,
            "min_shipping": None,
            "best_offer": None,
            "status": meta.status,
            "reason": "BLOCKED_OR_ERROR",
            "req": meta.__dict__,
        }
        cache_set(cache_key, res)
        return {**res, "cached": False}

    try:
        data = r.json()

        # Kaufland liefert je nach condition unterschiedliche keys – sicher abfangen:
        if condition == "new":
            offers_list = data.get("newOffers") or data.get("offers") or data.get("items") or []
        else:
            offers_list = data.get("usedOffers") or data.get("offers") or data.get("items") or []

        # Count
        offers_count = len(offers_list) if isinstance(offers_list, list) else 0

        # min total (price + shipping)
        best = None
        best_total = None

        if isinstance(offers_list, list):
            for o in offers_list:
                try:
                    price = float(o.get("price") or 0.0)
                    ship = float(o.get("deliveryRate") or 0.0)
                    total = price + ship

                    if best_total is None or total < best_total:
                        best_total = total
                        best = {
                            "id": o.get("id"),
                            "price": price,
                            "shipping": ship,
                            "total": total,
                            "seller_name": (o.get("seller") or {}).get("name"),
                            "seller_id": (o.get("seller") or {}).get("id"),
                            "shopURL": (o.get("seller") or {}).get("shopURL"),
                            "fulfillmentType": o.get("fulfillmentType"),
                            "deliveryTime": o.get("deliveryTime"),
                        }
                except Exception:
                    continue

        res = {
            "ok": True,
            "offers_count": offers_count,
            "min_total": best_total,
            "min_price": best["price"] if best else None,
            "min_shipping": best["shipping"] if best else None,
            "best_offer": best,
            "status": r.status_code,
            "reason": None,
            "req": meta.__dict__,
        }
        cache_set(cache_key, res)
        return {**res, "cached": False}

    except Exception:
        res = {
            "ok": False,
            "offers_count": None,
            "min_total": None,
            "min_price": None,
            "min_shipping": None,
            "best_offer": None,
            "status": r.status_code,
            "reason": "BAD_JSON",
            "req": meta.__dict__,
        }
        cache_set(cache_key, res)
        return {**res, "cached": False}


# -----------------------------
# Bestseller
# -----------------------------
def get_bestseller(session: requests.Session, product_id: int, cache_ttl_s: int = 6 * 3600) -> Dict[str, Any]:
    cache_key = f"kaufland:pdp:{product_id}"
    cached = cache_get(cache_key, cache_ttl_s)
    if cached:
        return {**cached, "cached": True}

    url = f"{BASE}/product/{product_id}/"
    r, meta = request_with_proxy(session, "get", url)
    if not r:
        res = {"ok": False, "bestseller": None, "status": meta.status, "reason": "BLOCKED_OR_ERROR", "req": meta.__dict__}
        cache_set(cache_key, res)
        return {**res, "cached": False}

    html = r.text
    bs = parse_bestseller(html)
    rating, review_count = parse_rating(html)
    res = {"ok": True, "bestseller": bs, "rating": rating, "review_count": review_count,
           "status": r.status_code, "reason": None, "req": meta.__dict__}
    cache_set(cache_key, res)
    return {**res, "cached": False}


# -----------------------------
# Batch check (EANs)
# -----------------------------
def batch_check_ean(eans: List[str], sleep_s: float = 0.2) -> List[dict]:
    out: List[dict] = []
    with requests.Session() as session:
        session.headers.update(HEADERS)

        # Warmup (ignore)
        request_with_proxy(session, "get", BASE + "/")

        for ean in eans:
            t0 = time.time()

            match = ean_to_product_id(session, ean)
            if not match.get("ok"):
                out.append({
                    "ean": ean,
                    "product_id": None,

                    "offers_count_new": None,
                    "min_total_new": None,
                    "min_price_new": None,
                    "min_shipping_new": None,
                    "best_offer_new": None,

                    "min_total_used": None,
                    "best_offer_used": None,

                    "bestseller": None,
                    "html_status": match.get("status"),
                    "score": 40,
                    "label": match.get("reason") or "NOT_FOUND",
                    "meta": {
                        "took_ms": int((time.time() - t0) * 1000),
                        "search_req": match.get("req"),
                    },
                })
                time.sleep(sleep_s)
                continue

            pid = int(match["product_id"])

            offers_new = get_offers_min_price(session, pid, condition="new", limit=100)
            offers_used = get_offers_min_price(session, pid, condition="used", limit=100)

            offers_count_new = offers_new.get("offers_count") if offers_new.get("ok") else None
            min_total_new = offers_new.get("min_total") if offers_new.get("ok") else None

            min_total_used = offers_used.get("min_total") if offers_used.get("ok") else None

            bs = get_bestseller(session, pid)
            bestseller = bs.get("bestseller") if bs.get("ok") else None
            rating = bs.get("rating") if bs.get("ok") else None
            review_count = bs.get("review_count") if bs.get("ok") else None

            score, label = demand_score(offers_count_new, bestseller)

            out.append({
                "ean": ean,
                "product_id": pid,

                "offers_count_new": offers_count_new,
                "min_total_new": min_total_new,
                "min_price_new": offers_new.get("min_price") if offers_new.get("ok") else None,
                "min_shipping_new": offers_new.get("min_shipping") if offers_new.get("ok") else None,
                "best_offer_new": offers_new.get("best_offer") if offers_new.get("ok") else None,

                "min_total_used": min_total_used,
                "best_offer_used": offers_used.get("best_offer") if offers_used.get("ok") else None,

                "bestseller": bestseller,
                "rating": rating,
                "review_count": review_count,
                "html_status": bs.get("status") or offers_new.get("status") or match.get("status"),
                "score": score,
                "label": label,
                "meta": {
                    "took_ms": int((time.time() - t0) * 1000),
                    "search_req": match.get("req"),
                    "offers_new_req": offers_new.get("req"),
                    "offers_used_req": offers_used.get("req"),
                    "pdp_req": bs.get("req"),
                    "cached": {
                        "search": match.get("cached"),
                        "offers_new": offers_new.get("cached"),
                        "offers_used": offers_used.get("cached"),
                        "pdp": bs.get("cached"),
                    },
                },
            })

            time.sleep(sleep_s)

    return out



# -----------------------------
# Single checks
# -----------------------------
def check_ean(ean: str) -> dict:
    return batch_check_ean([ean])[0]


# -----------------------------
# Tests
# -----------------------------
if __name__ == "__main__":
    print("Test EAN 4066629065376:")
    print(check_ean("4066629065376"))

    print("\nBatch-Test mit mehreren EANs:")
    test_eans = ["4052916473108", "4006381333931", "8720389039270", "497932485"]
    results = batch_check_ean(test_eans)
    for r in results:
        print(r)

