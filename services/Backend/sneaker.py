"""
Sneaker Marketplace Service — StockX + GOAT/Alias
===================================================
Adapted from ~/Documents/Claude/Projects/uni/sneaker-api for Flipcheck.
Provides profit-per-size data for sneaker reselling via StockX and GOAT.

Usage (standalone):
    from sneaker import sneaker_check
    result = sneaker_check("FV5029-500", ek=120)

Dependencies:
    pip install playwright cloudscraper python-dotenv
    playwright install chromium
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import logging
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

log = logging.getLogger("sneaker")

_DIR = os.path.dirname(os.path.abspath(__file__))

# ─── StockX Client ───────────────────────────────────────────────────────────

STOCKX_CACHE = os.path.join(_DIR, ".stockx_session.json")
STOCKX_COUNTRY = os.getenv("STOCKX_COUNTRY", "DE")
STOCKX_CURRENCY = os.getenv("STOCKX_CURRENCY", "EUR")
STOCKX_MARKET = os.getenv("STOCKX_MARKET", "DE.vat-registered")

# Fee structure
STOCKX_TX_FEE = 0.09       # 9% transaction
STOCKX_PROC_FEE = 0.03     # 3% processing
STOCKX_SHIP_FEE = 4.50     # €4.50 shipping


class StockXClient:
    """StockX GraphQL client with Playwright PX bypass."""

    GRAPHQL_URL = "https://gateway.stockx.com/api/graphql"

    def __init__(self, headless: bool = True):
        self.headless = headless
        self.session = None
        self.cookies: Dict[str, str] = {}
        self.headers: Dict[str, str] = {}
        self.api_key = ""
        self.auth_token = ""
        self._init_session()

    def _init_session(self):
        import requests
        self.session = requests.Session()
        if os.path.exists(STOCKX_CACHE):
            try:
                with open(STOCKX_CACHE) as f:
                    cached = json.load(f)
                if time.time() - cached.get("created_at", 0) < 3600:
                    self.cookies = cached.get("cookies", {})
                    self.headers = cached.get("headers", {})
                    self.api_key = cached.get("api_key", "")
                    self.auth_token = cached.get("auth_token", "")
                    self._apply()
                    if self._test():
                        log.info("[StockX] Cached session valid")
                        return
            except Exception:
                pass
        self._fresh_session()

    def _apply(self):
        self.session.headers.update({
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "accept": "application/json",
            "content-type": "application/json",
            "origin": "https://stockx.com",
            "referer": "https://stockx.com/",
            "apollographql-client-name": "Iron",
            "apollographql-client-version": "2025.03.24.00",
        })
        if self.api_key:
            self.session.headers["x-api-key"] = self.api_key
        if self.auth_token:
            self.session.headers["authorization"] = self.auth_token
        for k, v in self.headers.items():
            if v:
                self.session.headers[k] = v
        for name, value in self.cookies.items():
            self.session.cookies.set(name, value, domain=".stockx.com")

    def _test(self) -> bool:
        try:
            r = self.session.post(self.GRAPHQL_URL, json={
                "query": "query { __typename }", "variables": {},
            }, timeout=10)
            return r.status_code != 403
        except Exception:
            return False

    def _fresh_session(self):
        """Playwright PX bypass to get fresh tokens."""
        log.info("[StockX] Starting browser for PX bypass...")
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=self.headless,
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
            context = browser.new_context(
                viewport={"width": 1440, "height": 900},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                locale="de-DE", timezone_id="Europe/Berlin",
            )
            context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                window.chrome = { runtime: {} };
            """)
            page = context.new_page()
            captured = {}
            api_key = ""

            def on_req(req):
                nonlocal captured, api_key
                if "gateway.stockx.com" in req.url or "stockx.com/api" in req.url:
                    for k, v in req.headers.items():
                        if k.startswith("x-") or k in ("authorization", "cookie"):
                            captured[k] = v
                    if "x-api-key" in req.headers:
                        api_key = req.headers["x-api-key"]

            page.on("request", on_req)
            page.goto("https://stockx.com/de-de", wait_until="domcontentloaded", timeout=60000)
            time.sleep(3)
            try:
                btn = page.locator("[data-testid='cookie-banner-accept'], #onetrust-accept-btn-handler, button:has-text('Akzeptieren')")
                if btn.count() > 0:
                    btn.first.click(timeout=3000)
                    time.sleep(1)
            except Exception:
                pass
            page.goto("https://stockx.com/de-de/air-jordan-1-retro-high-og-black-white-2014", wait_until="domcontentloaded", timeout=60000)
            time.sleep(3)
            page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)")
            time.sleep(2)

            for c in context.cookies():
                if "stockx" in c.get("domain", ""):
                    self.cookies[c["name"]] = c["value"]
            self.headers = captured
            self.api_key = api_key
            self.auth_token = captured.get("authorization", "")
            browser.close()

        with open(STOCKX_CACHE, "w") as f:
            json.dump({"cookies": self.cookies, "headers": self.headers,
                        "api_key": self.api_key, "auth_token": self.auth_token,
                        "created_at": time.time()}, f, indent=2)
        self._apply()
        log.info("[StockX] Session ready" if self._test() else "[StockX] Session test failed")

    def graphql(self, query: str, variables: dict, _retry: bool = True) -> dict:
        r = self.session.post(self.GRAPHQL_URL, json={"query": query, "variables": variables}, timeout=15)
        if r.status_code == 403 and _retry:
            log.warning("[StockX] 403 — refreshing PX session")
            self._fresh_session()
            return self.graphql(query, variables, _retry=False)
        if r.status_code == 429:
            time.sleep(2)
            return self.graphql(query, variables, _retry=False)
        if r.status_code >= 400:
            r.raise_for_status()
        return r.json().get("data", {})

    def search(self, sku: str) -> Optional[dict]:
        data = self.graphql("""
            query($query: String, $market: String) {
              browse(query: $query, flow: SEARCH_TYPEAHEAD, market: $market, sort: {order: DESC, id: "featured"}) {
                results { edges { node {
                  ... on Product { id primaryTitle secondaryTitle title }
                  ... on Variant { id product { id primaryTitle secondaryTitle title } }
                } } }
              }
            }
        """, {"query": sku, "market": STOCKX_MARKET})
        edges = data.get("browse", {}).get("results", {}).get("edges", [])
        if not edges:
            return None
        node = edges[0]["node"]
        return node.get("product") or node

    def get_product(self, product_id: str) -> dict:
        data = self.graphql("""
            query($productId: String!) {
              product(id: $productId) {
                id brand primaryTitle secondaryTitle title
                traits { name value }
                variants { id hidden sizeChart { baseSize displayOptions { size type } } traits { size } }
              }
            }
        """, {"productId": product_id})
        return data.get("product", {})

    def get_market_stats(self, product_id: str) -> dict:
        data = self.graphql("""
            query($id: String!, $curr: CurrencyCode!, $market: String) {
              product(id: $id) { market(currencyCode: $curr) { statistics(market: $market, viewerContext: SELLER) {
                lastSale { amount } last72Hours { salesCount } last90Days { averagePrice salesCount rangeLow rangeHigh }
              } } }
            }
        """, {"id": product_id, "curr": STOCKX_CURRENCY, "market": STOCKX_MARKET})
        return data.get("product", {}).get("market", {}).get("statistics", {})

    def get_variant_price(self, variant_id: str) -> dict:
        data = self.graphql("""
            query($vid: String!, $curr: CurrencyCode, $country: String, $market: String) {
              variant(id: $vid) { id
                market(currencyCode: $curr) {
                  state(market: $market, country: $country) { highestBid { amount } lowestAsk { amount } }
                  statistics(market: $market, viewerContext: SELLER) { lastSale { amount } }
                }
              }
            }
        """, {"vid": variant_id, "curr": STOCKX_CURRENCY, "country": STOCKX_COUNTRY, "market": STOCKX_MARKET})
        return data.get("variant", {})

    def get_all_variant_prices(self, variant_ids: list, max_workers: int = 8) -> dict:
        results = {}
        def _fetch(vid):
            try:
                return vid, self.get_variant_price(vid)
            except Exception:
                return vid, {}
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            for future in as_completed({pool.submit(_fetch, v): v for v in variant_ids}):
                vid, data = future.result()
                results[vid] = data
        return results

    def get_sales(self, product_id: str, max_pages: int = 10) -> list:
        all_sales: list = []
        cursor = None
        q = """
            query($id: String!, $first: Int, $after: String, $market: String, $curr: CurrencyCode!) {
              product(id: $id) { market(currencyCode: $curr) { sales(first: $first, after: $after, market: $market, viewerContext: SELLER) {
                edges { node { amount associatedVariant { id } createdAt } }
                pageInfo { endCursor }
              } } }
            }
        """
        cutoff = datetime.utcnow() - timedelta(days=35)
        for _ in range(max_pages):
            v = {"id": product_id, "first": 50, "curr": STOCKX_CURRENCY, "market": STOCKX_MARKET}
            if cursor:
                v["after"] = cursor
            data = self.graphql(q, v)
            edges = data.get("product", {}).get("market", {}).get("sales", {}).get("edges", [])
            if not edges:
                break
            all_sales.extend(e["node"] for e in edges)
            cursor = data.get("product", {}).get("market", {}).get("sales", {}).get("pageInfo", {}).get("endCursor")
            if not cursor or len(edges) < 50:
                break
            last_dt = _parse_dt(edges[-1]["node"].get("createdAt", ""))
            if last_dt and last_dt < cutoff:
                break
        return all_sales

    @staticmethod
    def calc_payout(sell_price: float) -> dict:
        tx = sell_price * STOCKX_TX_FEE
        proc = sell_price * STOCKX_PROC_FEE
        payout = sell_price - tx - proc - STOCKX_SHIP_FEE
        return {"payout": round(payout, 2), "fees": round(tx + proc + STOCKX_SHIP_FEE, 2)}


# ─── GOAT/Alias Client ───────────────────────────────────────────────────────

GOAT_CACHE = os.path.join(_DIR, ".goat_session.json")
GOAT_COMMISSION = 0.095     # 9.5%
GOAT_SELLER_FEE = 5.00      # €5


class GoatClient:
    """GOAT/Alias Sell API client with Cloudflare bypass."""

    BASE = "https://sell-api.goat.com"

    def __init__(self):
        self.access_token: Optional[str] = None
        self.refresh_token = os.getenv("GOAT_REFRESH_TOKEN", "")
        self._init_session()

    def _init_session(self):
        import cloudscraper
        self.scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "ios", "mobile": True}
        )
        if os.path.exists(GOAT_CACHE):
            try:
                with open(GOAT_CACHE) as f:
                    cached = json.load(f)
                if time.time() - cached.get("created_at", 0) < 3000:
                    self.access_token = cached.get("access_token")
                    if self._test():
                        log.info("[GOAT] Cached session valid")
                        return
            except Exception:
                pass
        self._auth()

    def _test(self) -> bool:
        try:
            return self._raw_post("/api/v1/listings/list-listing-conditions", {}).status_code == 200
        except Exception:
            return False

    def _raw_post(self, path: str, data: dict, ct: str = "application/json"):
        headers = {
            "authorization": f"Bearer {self.access_token}",
            "user-agent": "alias/1.48.1 (iPad; iOS 18.7.1; Scale/2.00) Locale/de",
            "accept": "application/json",
            "content-type": ct,
        }
        if ct == "application/json":
            return self.scraper.post(f"{self.BASE}{path}", json=data, headers=headers, timeout=15)
        return self.scraper.post(f"{self.BASE}{path}", data=data, headers=headers, timeout=15)

    def _auth(self):
        log.info("[GOAT] Authenticating...")
        headers = {
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": "alias/1.48.1 (iPad; iOS 18.7.1; Scale/2.00) Locale/de",
            "accept": "application/json",
        }
        if self.refresh_token:
            r = self.scraper.post(f"{self.BASE}/api/v1/unstable/users/login",
                                  data=f"grant_type=refresh_token&refresh_token={self.refresh_token}",
                                  headers=headers, timeout=15)
            if r.status_code == 200:
                self.access_token = r.json()["auth_token"]["access_token"]
                self._save()
                log.info("[GOAT] Session ready (refresh token)")
                return

        email = os.getenv("GOAT_EMAIL", "")
        pw = os.getenv("GOAT_PASSWORD", "")
        if not email or not pw:
            raise RuntimeError("GOAT_REFRESH_TOKEN expired and no GOAT_EMAIL/GOAT_PASSWORD in .env")
        r = self.scraper.post(f"{self.BASE}/api/v1/unstable/users/login",
                              json={"grant_type": "password", "username": email, "password": pw},
                              headers={**headers, "content-type": "application/json"}, timeout=15)
        if r.status_code != 200:
            raise RuntimeError(f"GOAT login failed: {r.status_code}")
        data = r.json()
        self.access_token = data["auth_token"]["access_token"]
        new_rt = data.get("auth_token", {}).get("refresh_token")
        if new_rt:
            self.refresh_token = new_rt
        self._save()
        log.info("[GOAT] Session ready (password)")

    def _save(self):
        with open(GOAT_CACHE, "w") as f:
            json.dump({"access_token": self.access_token, "created_at": time.time()}, f)

    def _post(self, path: str, data: dict) -> dict:
        r = self._raw_post(path, data)
        if r.status_code == 403:
            log.warning("[GOAT] 403 — re-authenticating")
            self._auth()
            r = self._raw_post(path, data)
        r.raise_for_status()
        return r.json()

    def find_product(self, sku: str, product_name: str = "") -> tuple:
        """Returns (slug, product) or (None, None)."""
        sku_slug = sku.lower().replace(" ", "-")
        candidates = []
        if product_name:
            name = product_name.lower()
            is_wmns = False
            for rm in ["(damen)", "(women's)", "(wmns)", "(w)"]:
                if rm in name:
                    name = name.replace(rm, "").strip()
                    is_wmns = True
            for rm in ["(herren)", "(men's)", "(gs)", "(td)", "(ps)", "(kids)"]:
                name = name.replace(rm, "").strip()
            name_nb = name
            for brand in ["nike ", "adidas ", "new balance ", "puma ", "asics ", "reebok "]:
                if name.startswith(brand):
                    name_nb = name[len(brand):]
                    break
            names = [name, name_nb]
            if is_wmns:
                names += [f"wmns {name}", f"wmns {name_nb}"]
            for n in names:
                candidates.append(self._slug(n, sku_slug))
            words = name_nb.split()
            for i in range(2, min(len(words), 6)):
                partial = " ".join(words[:i])
                candidates.append(self._slug(partial, sku_slug))
                if is_wmns:
                    candidates.append(self._slug("wmns " + partial, sku_slug))
        candidates.append(sku_slug)
        seen = set()
        for c in candidates:
            c = re.sub(r"-+", "-", c).strip("-")
            if c in seen:
                continue
            seen.add(c)
            prod = self._try_product(c)
            if prod:
                return c, prod
        # DDG fallback
        ddg = self._ddg_search(sku)
        if ddg:
            prod = self._try_product(ddg)
            if prod:
                return ddg, prod
        return None, None

    def get_all_sizes(self, slug: str) -> list:
        data = self._post("/api/v1/analytics/list-variant-availabilities", {
            "variant": {"id": slug, "packaging_condition": 1, "region_id": "2"}
        })
        return data.get("availability", [])

    def get_monthly_sales(self, slug: str, size: str) -> int:
        try:
            data = self._post("/api/v1/analytics/products/historical-sales", {
                "variant": {"id": slug, "size": size, "product_condition": 1, "packaging_condition": 1, "region_id": "2"}
            })
            cutoff = datetime.utcnow() - timedelta(days=30)
            return sum(1 for d in data.get("daily_365", [])
                       if not d.get("no_sales_made") and _parse_dt(d.get("start_date", "")) and _parse_dt(d["start_date"]) > cutoff)
        except Exception:
            return 0

    @staticmethod
    def calc_payout(sell_price: float) -> dict:
        fees = sell_price * GOAT_COMMISSION + GOAT_SELLER_FEE
        return {"payout": round(sell_price - fees, 2), "fees": round(fees, 2)}

    @staticmethod
    def _slug(name: str, sku_slug: str) -> str:
        s = re.sub(r"['\(\)\",./]", "", name)
        s = re.sub(r"\s+", "-", s.strip())
        return re.sub(r"-+", "-", f"{s}-{sku_slug}")

    def _try_product(self, slug: str) -> Optional[dict]:
        try:
            data = self._post("/api/v1/listings/get-product", {"id": slug})
            return data.get("product", data)
        except Exception:
            return None

    def _ddg_search(self, sku: str) -> Optional[str]:
        try:
            r = self.scraper.get(
                f"https://html.duckduckgo.com/html/?q=site:goat.com/sneakers/+{sku}",
                headers={"user-agent": "Mozilla/5.0"}, timeout=10)
            if r.status_code == 200:
                slugs = re.findall(r"goat\.com/sneakers/([a-z0-9-]+)", r.text)
                sku_lower = sku.lower().replace(" ", "-")
                for s in slugs:
                    if sku_lower in s:
                        return s
                return slugs[0] if slugs else None
        except Exception:
            pass
        return None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _parse_dt(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _size_sort(size: str) -> float:
    try:
        return float(re.sub(r"[A-Za-z]", "", str(size)))
    except ValueError:
        return 0


# ─── Unified Check Function ──────────────────────────────────────────────────

_stockx_client: Optional[StockXClient] = None
_goat_client: Optional[GoatClient] = None


def _get_stockx() -> StockXClient:
    global _stockx_client
    if _stockx_client is None:
        _stockx_client = StockXClient(headless=True)
    return _stockx_client


def _get_goat() -> GoatClient:
    global _goat_client
    if _goat_client is None:
        _goat_client = GoatClient()
    return _goat_client


def check_stockx(sku: str, ek: float) -> dict:
    """Check a sneaker on StockX. Returns normalized result dict."""
    sx = _get_stockx()
    product = sx.search(sku)
    if not product:
        return {"ok": False, "error": f"SKU '{sku}' nicht auf StockX gefunden"}

    pid = product["id"]
    name = (product.get("primaryTitle", "") + " " + product.get("secondaryTitle", "")).strip() or product.get("title", sku)

    full = sx.get_product(pid)
    variants = [v for v in full.get("variants", []) if not v.get("hidden")]

    # Extract SKU from traits
    sku_display = sku
    for t in full.get("traits", []):
        if t.get("name") in ("Style", "Modellnr.", "Artikelnr."):
            sku_display = t["value"]

    # Size map
    size_map = []
    for v in variants:
        size = v.get("traits", {}).get("size")
        if not size:
            sc = v.get("sizeChart", {})
            if sc:
                for opt in sc.get("displayOptions", []):
                    if opt.get("type") == "eu":
                        size = opt["size"]
                        break
                if not size:
                    size = sc.get("baseSize")
        if size:
            size_map.append({"id": v["id"], "size": size})

    # Prices (parallel)
    raw_prices = sx.get_all_variant_prices([sv["id"] for sv in size_map])

    # Market stats
    stats = sx.get_market_stats(pid)
    l90 = stats.get("last90Days", {})
    l72 = stats.get("last72Hours", {})

    # Sales for 30d per variant
    sales = sx.get_sales(pid, max_pages=10)
    sales_by_vid = defaultdict(list)
    for s in sales:
        vid = s.get("associatedVariant", {}).get("id", "")
        sales_by_vid[vid].append(s)
    cutoff_30d = datetime.utcnow() - timedelta(days=30)

    ek_netto = ek / 1.19
    sizes = []
    for sv in sorted(size_map, key=lambda x: _size_sort(x["size"])):
        vid = sv["id"]
        vdata = raw_prices.get(vid, {})
        market = vdata.get("market", {})
        state = market.get("state", {})
        mstats = market.get("statistics", {})
        ask = state.get("lowestAsk", {}).get("amount") if state.get("lowestAsk") else None
        bid = state.get("highestBid", {}).get("amount") if state.get("highestBid") else None
        last = mstats.get("lastSale", {}).get("amount") if mstats.get("lastSale") else None

        payout_info = StockXClient.calc_payout(ask) if ask else {"payout": None, "fees": None}
        profit = round(payout_info["payout"] - ek_netto, 2) if payout_info["payout"] else None
        monthly = sum(1 for s in sales_by_vid.get(vid, []) if _parse_dt(s.get("createdAt", "")) and _parse_dt(s["createdAt"]) > cutoff_30d)

        sizes.append({
            "size": sv["size"],
            "ask": ask, "bid": bid, "last_sale": last,
            "payout": payout_info["payout"],
            "fees": payout_info["fees"],
            "profit": profit,
            "sales_30d": monthly,
        })

    return {
        "ok": True,
        "platform": "stockx",
        "sku": sku_display,
        "title": name,
        "product_id": pid,
        "sales_90d": l90.get("salesCount"),
        "sales_72h": l72.get("salesCount"),
        "avg_price_90d": l90.get("averagePrice"),
        "range_low": l90.get("rangeLow"),
        "range_high": l90.get("rangeHigh"),
        "fees_label": "9% TX + 3% Processing + 4.50€ Shipping",
        "sizes": sizes,
    }


def check_goat(sku: str, ek: float, product_name: str = "") -> dict:
    """Check a sneaker on GOAT/Alias. Returns normalized result dict."""
    goat = _get_goat()
    slug, product = goat.find_product(sku, product_name)
    if not product:
        return {"ok": False, "error": f"SKU '{sku}' nicht auf GOAT gefunden"}

    goat_name = product.get("name", "")
    goat_sku = product.get("sku", sku)
    retail_cents = product.get("retail_price_cents")
    retail = int(retail_cents) / 100 if retail_cents else None

    availabilities = goat.get_all_sizes(slug)
    if not availabilities:
        return {"ok": False, "error": "Keine Größen-Daten auf GOAT"}

    # Merge sizes
    size_map: Dict[str, dict] = {}
    for a in availabilities:
        v = a.get("variant", {})
        size = v.get("size")
        if not size:
            continue
        ask_c = a.get("lowest_price_cents")
        bid_c = a.get("highest_offer_cents")
        last_c = a.get("last_sold_price_cents")
        ask = int(ask_c) / 100 if ask_c else None
        bid = int(bid_c) / 100 if bid_c else None
        last = int(last_c) / 100 if last_c else None
        key = str(size)
        if key in size_map:
            ex = size_map[key]
            if ask and (not ex["ask"] or ask < ex["ask"]):
                ex["ask"] = ask
            if bid and (not ex["bid"] or bid > ex["bid"]):
                ex["bid"] = bid
            if last and not ex["last_sale"]:
                ex["last_sale"] = last
        else:
            size_map[key] = {"size": size, "ask": ask, "bid": bid, "last_sale": last}

    active_sizes = {k: v for k, v in size_map.items() if v["ask"] or v["bid"] or v["last_sale"]}

    # Monthly sales (parallel)
    def _fetch_monthly(sz):
        return sz, goat.get_monthly_sales(slug, sz)

    with ThreadPoolExecutor(max_workers=8) as pool:
        for future in as_completed({pool.submit(_fetch_monthly, sz): sz for sz in active_sizes}):
            sz, count = future.result()
            if sz in active_sizes:
                active_sizes[sz]["sales_30d"] = count

    ek_netto = ek / 1.19
    sizes = []
    for s in sorted(active_sizes.values(), key=lambda x: _size_sort(x["size"])):
        ask = s.get("ask")
        payout_info = GoatClient.calc_payout(ask) if ask else {"payout": None, "fees": None}
        profit = round(payout_info["payout"] - ek_netto, 2) if payout_info["payout"] else None
        sizes.append({
            "size": s["size"],
            "ask": ask, "bid": s.get("bid"), "last_sale": s.get("last_sale"),
            "payout": payout_info["payout"],
            "fees": payout_info["fees"],
            "profit": profit,
            "sales_30d": s.get("sales_30d", 0),
        })

    return {
        "ok": True,
        "platform": "goat",
        "sku": goat_sku,
        "title": goat_name,
        "slug": slug,
        "retail_price": retail,
        "fees_label": "9.5% Commission + 5€ Seller Fee",
        "sizes": sizes,
    }


def sneaker_check(sku: str, ek: float) -> dict:
    """Run both StockX + GOAT checks. Returns combined result."""
    stockx_result = {}
    goat_result = {}
    errors = []

    try:
        stockx_result = check_stockx(sku, ek)
    except Exception as e:
        log.error(f"StockX check failed: {e}")
        errors.append(f"StockX: {e}")

    product_name = stockx_result.get("title", "")

    try:
        goat_result = check_goat(sku, ek, product_name)
    except Exception as e:
        log.error(f"GOAT check failed: {e}")
        errors.append(f"GOAT: {e}")

    if not stockx_result.get("ok") and not goat_result.get("ok"):
        return {"ok": False, "error": "; ".join(errors) or "Sneaker nicht gefunden"}

    return {
        "ok": True,
        "sku": sku,
        "title": stockx_result.get("title") or goat_result.get("title", sku),
        "ek": ek,
        "stockx": stockx_result if stockx_result.get("ok") else None,
        "goat": goat_result if goat_result.get("ok") else None,
        "errors": errors or None,
    }
