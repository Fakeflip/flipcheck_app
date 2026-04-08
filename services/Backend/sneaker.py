"""
Sneaker Marketplace Service — StockX + GOAT/Alias
===================================================
Adapted from ~/Documents/Claude/Projects/uni/sneaker-api for Flipcheck.
Provides profit-per-size data for sneaker reselling via StockX and GOAT.

Usage (standalone):
    from sneaker import sneaker_check
    result = sneaker_check("FV5029-500", ek=120)

Dependencies:
    pip install playwright cloudscraper python-dotenv requests
    playwright install chromium
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import logging
import requests as plain_requests
from typing import Optional, Dict, List, Any, Tuple
from datetime import datetime, timedelta
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

log = logging.getLogger("sneaker")

_DIR = os.path.dirname(os.path.abspath(__file__))

# ─── Shared Proxy Pool (same proxies as kaufland.py) ─────────────────────────

PROXIES_LIST = [
    "http://user_c19093666cc1:wy0tCBJt@82.25.197.175:61234",
    "http://user_01b8187438ef:bmAD6Cae@82.25.202.144:61234",
    "http://user_9397c11aa7c9:Ni3W6nEo@82.25.202.246:61234",
    "http://user_9e85beaac451:RNCF6VAa@88.135.99.9:61234",
    "http://user_2f8623fdea99:GxHT6JFy@88.135.99.33:61234",
    "http://user_14b9aa1a93e9:0WXnfNeZ@88.135.99.106:61234",
    "http://user_3c1866aeb60f:qVfP0R3r@88.135.99.113:61234",
    "http://user_95e3199150b0:rwPc5LeF@88.135.99.147:61234",
    "http://user_ace3fa75d6a4:CXPwsJrm@88.135.99.209:61234",
    "http://user_6163e08b6c75:PdlSG1tJ@88.135.99.243:61234",
]

_proxy_index = 0


def _next_proxy() -> Optional[str]:
    global _proxy_index
    if not PROXIES_LIST:
        return None
    proxy = PROXIES_LIST[_proxy_index % len(PROXIES_LIST)]
    _proxy_index += 1
    return proxy


# ─── StockX Client ───────────────────────────────────────────────────────────

STOCKX_CACHE = os.path.join(_DIR, ".stockx_session.json")
STOCKX_COUNTRY = os.getenv("STOCKX_COUNTRY", "DE")
STOCKX_CURRENCY = os.getenv("STOCKX_CURRENCY", "EUR")
STOCKX_MARKET = os.getenv("STOCKX_MARKET", "DE.vat-registered")

# Fee structure
STOCKX_TX_FEE = 0.09       # 9% transaction
STOCKX_PROC_FEE = 0.03     # 3% processing
STOCKX_SHIP_FEE = 4.50     # 4.50 shipping


class StockXClient:
    """StockX GraphQL client with Playwright PX bypass + proxy rotation."""

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
                    log.info("[StockX] Cached session expired, refreshing...")
            except Exception:
                pass
        self._fresh_session()

    def _apply(self):
        self.session.headers.update({
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "accept": "application/json",
            "accept-language": "de-DE,de;q=0.9,en;q=0.8",
            "content-type": "application/json",
            "origin": "https://stockx.com",
            "referer": "https://stockx.com/",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-site",
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
            }, timeout=10, proxies=self._proxy_dict())
            return r.status_code != 403
        except Exception:
            return False

    def _proxy_dict(self) -> dict:
        p = _next_proxy()
        return {"http": p, "https": p} if p else {}

    def _fresh_session(self):
        """Playwright PX bypass to get fresh tokens."""
        log.info("[StockX] Starting browser for PX bypass...")
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=self.headless,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-web-security",
                ],
            )
            context = browser.new_context(
                viewport={"width": 1440, "height": 900},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                locale="de-DE", timezone_id="Europe/Berlin",
            )
            # Full stealth script (from original)
            context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                Object.defineProperty(navigator, 'languages', { get: () => ['de-DE', 'de', 'en-US', 'en'] });
                window.chrome = { runtime: {} };
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
                );
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
            log.info("[StockX] Loading StockX...")
            page.goto("https://stockx.com/de-de", wait_until="domcontentloaded", timeout=60000)
            time.sleep(3)

            # Accept cookies
            try:
                btn = page.locator("[data-testid='cookie-banner-accept'], #onetrust-accept-btn-handler, button:has-text('Akzeptieren'), button:has-text('Accept')")
                if btn.count() > 0:
                    btn.first.click(timeout=3000)
                    log.info("[StockX] Cookies accepted")
                    time.sleep(1)
            except Exception:
                pass

            # Trigger API calls
            log.info("[StockX] Triggering API calls...")
            page.goto("https://stockx.com/de-de/air-jordan-1-retro-high-og-black-white-2014", wait_until="domcontentloaded", timeout=60000)
            time.sleep(3)
            page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)")
            time.sleep(2)

            # Extract cookies
            for c in context.cookies():
                if "stockx" in c.get("domain", ""):
                    self.cookies[c["name"]] = c["value"]
                if c["name"].startswith("_px") or c["name"].startswith("__cf"):
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
        if self._test():
            log.info("[StockX] Session ready!")
        else:
            log.warning("[StockX] Session test failed — API calls might not work")
            log.warning("[StockX] Captured headers: %s", list(self.headers.keys()))
            log.warning("[StockX] Captured cookies: %s", list(self.cookies.keys()))

    def graphql(self, query: str, variables: dict, _retry: bool = True) -> dict:
        r = self.session.post(self.GRAPHQL_URL,
                              json={"query": query, "variables": variables},
                              timeout=15, proxies=self._proxy_dict())
        if r.status_code == 403 and _retry:
            log.warning("[StockX] 403 — refreshing PX session")
            self._fresh_session()
            return self.graphql(query, variables, _retry=False)
        if r.status_code == 429:
            log.warning("[StockX] Rate limited, waiting 2s...")
            time.sleep(2)
            return self.graphql(query, variables, _retry=False)
        if r.status_code >= 400:
            log.error("[StockX] HTTP %d: %s", r.status_code, r.text[:300])
            r.raise_for_status()
        resp = r.json()
        if "errors" in resp:
            serious = [e for e in resp["errors"] if "never used" not in e.get("message", "")]
            if serious:
                log.warning("[StockX] GraphQL errors: %s", serious)
        return resp.get("data", {})

    def search(self, sku: str) -> Optional[dict]:
        data = self.graphql("""
            query FetchSearchResults($query: String, $market: String) {
              browse(query: $query, flow: SEARCH_TYPEAHEAD, market: $market, sort: {order: DESC, id: "featured"}) {
                results { edges { node {
                  ... on Product { id primaryTitle secondaryTitle title }
                  ... on Variant { id product { id primaryTitle secondaryTitle title } }
                } objectId } }
              }
            }
        """, {"query": sku, "market": STOCKX_MARKET})
        edges = data.get("browse", {}).get("results", {}).get("edges", [])
        if not edges:
            return None
        node = edges[0]["node"]
        if "product" in node and node["product"]:
            return node["product"]
        return node

    def get_product(self, product_id: str) -> dict:
        data = self.graphql("""
            query FetchStandardProduct($productId: String!) {
              product(id: $productId) {
                id brand primaryTitle secondaryTitle title
                media { imageUrl smallImageUrl }
                traits { name value }
                variants {
                  id hidden
                  sizeChart { baseSize baseType displayOptions { size type } }
                  traits { size }
                }
              }
            }
        """, {"productId": product_id, "skipFavoriting": True})
        return data.get("product", {})

    def get_market_stats(self, product_id: str) -> dict:
        data = self.graphql("""
            query FetchStandardProductMarket($id: String!, $currencyCode: CurrencyCode!, $market: String, $viewerContext: MarketViewerContext) {
              product(id: $id) {
                market(currencyCode: $currencyCode) {
                  statistics(market: $market, viewerContext: $viewerContext) {
                    lastSale { amount changePercentage }
                    last72Hours { salesCount }
                    last90Days { averagePrice salesCount rangeLow rangeHigh }
                    annual { annualHigh annualLow }
                  }
                }
              }
            }
        """, {
            "id": product_id, "viewerContext": "SELLER",
            "currencyCode": STOCKX_CURRENCY, "market": STOCKX_MARKET,
        })
        return data.get("product", {}).get("market", {}).get("statistics", {})

    def get_variant_price(self, variant_id: str) -> dict:
        data = self.graphql("""
            query FetchSellingPricingGuidance($variantId: String!, $currencyCode: CurrencyCode, $country: String, $market: String) {
              variant(id: $variantId) {
                id
                pricingGuidance(currencyCode: $currencyCode, country: $country, market: $market) {
                  sellingGuidance { earnMore sellFaster }
                }
                market(currencyCode: $currencyCode) {
                  state(market: $market, country: $country) {
                    highestBid { amount }
                    lowestAsk { amount }
                  }
                  statistics(market: $market, viewerContext: SELLER) {
                    lastSale { amount }
                  }
                }
              }
            }
        """, {
            "variantId": variant_id, "currencyCode": STOCKX_CURRENCY,
            "country": STOCKX_COUNTRY, "market": STOCKX_MARKET,
        })
        return data.get("variant", {})

    def get_all_variant_prices(self, variant_ids: list, max_workers: int = 8) -> dict:
        """Fetch pricing for all variants using batched GraphQL aliases (max 10 per query)."""
        results = {}
        BATCH = 10

        def _fetch_batch(batch):
            # Build a single GraphQL query with aliases for up to 10 variants
            # Includes per-variant sales for accurate 30D counts (no separate pagination needed)
            parts = []
            for i, vid in enumerate(batch):
                parts.append(f"""
                    v{i}: variant(id: "{vid}") {{
                        id
                        pricingGuidance(currencyCode: $cc, country: $co, market: $mkt) {{
                            sellingGuidance {{ earnMore sellFaster }}
                        }}
                        market(currencyCode: $cc) {{
                            state(market: $mkt, country: $co) {{ highestBid {{ amount }} lowestAsk {{ amount }} }}
                            statistics(market: $mkt, viewerContext: SELLER) {{ lastSale {{ amount }} }}
                            sales(first: 100, market: $mkt, viewerContext: SELLER) {{
                                edges {{ node {{ createdAt }} }}
                            }}
                        }}
                    }}
                """)
            query = f"""query BatchVariants($cc: CurrencyCode, $co: String, $mkt: String) {{ {"".join(parts)} }}"""
            try:
                data = self.graphql(query, {"cc": STOCKX_CURRENCY, "co": STOCKX_COUNTRY, "mkt": STOCKX_MARKET})
                batch_results = {}
                for i, vid in enumerate(batch):
                    batch_results[vid] = data.get(f"v{i}", {})
                return batch_results
            except Exception as e:
                log.error("[StockX] Batch variant fetch failed: %s", e)
                return {vid: {} for vid in batch}

        batches = [variant_ids[i:i+BATCH] for i in range(0, len(variant_ids), BATCH)]
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            for future in as_completed({pool.submit(_fetch_batch, b): b for b in batches}):
                results.update(future.result())
        return results

    def get_sales(self, product_id: str, max_pages: int = 10, days: int = 35) -> list:
        all_sales: list = []
        cursor = None
        q = """
            query FetchProductSales($id: String!, $first: Int, $after: String, $market: String, $currencyCode: CurrencyCode!, $viewerContext: MarketViewerContext) {
              product(id: $id) { market(currencyCode: $currencyCode) { sales(first: $first, after: $after, market: $market, viewerContext: $viewerContext) {
                edges { node { amount associatedVariant { id } createdAt orderType } }
                pageInfo { endCursor }
              } } }
            }
        """
        cutoff = datetime.utcnow() - timedelta(days=days)
        for _ in range(max_pages):
            v = {"id": product_id, "first": 100, "viewerContext": "SELLER",
                 "currencyCode": STOCKX_CURRENCY, "market": STOCKX_MARKET}
            if cursor:
                v["after"] = cursor
            data = self.graphql(q, v)
            edges = data.get("product", {}).get("market", {}).get("sales", {}).get("edges", [])
            if not edges:
                break
            all_sales.extend(e["node"] for e in edges)
            cursor = data.get("product", {}).get("market", {}).get("sales", {}).get("pageInfo", {}).get("endCursor")
            if not cursor or len(edges) < 100:
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
GOAT_SELLER_FEE = 5.00      # 5

# StockX translates names to German - map back to English for GOAT
DE_TO_EN = {
    "hoch": "high", "niedrig": "low", "mittel": "mid",
    "wei\u00df": "white", "schwarz": "black", "rot": "red", "blau": "blue",
    "gr\u00fcn": "green", "grau": "grey", "rosa": "pink", "lila": "purple",
    "gelb": "yellow", "braun": "brown", "orange": "orange",
    "damen": "wmns", "herren": "men", "kinder": "kids",
    "universit\u00e4t": "university", "k\u00f6niglich": "royal",
    "und": "and", "dunkel": "dark", "hell": "light",
}


class GoatClient:
    """GOAT/Alias Sell API client with Cloudflare bypass."""

    BASE = "https://sell-api.goat.com"
    GATEWAY = "https://gateway.alias.org"

    def __init__(self, headless=True):
        self.access_token: Optional[str] = None
        self.refresh_token = os.getenv("GOAT_REFRESH_TOKEN", "")
        self.headless = headless
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
                if time.time() - cached.get("created_at", 0) < 3000:  # 50 min
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

    @staticmethod
    def _proxy_dict() -> dict:
        p = _next_proxy()
        return {"http": p, "https": p} if p else {}

    def _raw_post(self, path: str, data: dict, ct: str = "application/json"):
        headers = {
            "authorization": f"Bearer {self.access_token}",
            "user-agent": "alias/1.48.1 (iPad; iOS 18.7.1; Scale/2.00) Locale/de",
            "accept": "application/json",
            "content-type": ct,
        }
        px = self._proxy_dict()
        if ct == "application/json":
            return self.scraper.post(f"{self.BASE}{path}", json=data, headers=headers, timeout=15, proxies=px)
        return self.scraper.post(f"{self.BASE}{path}", data=data, headers=headers, timeout=15, proxies=px)

    def _auth(self):
        """Authenticate via cloudscraper. Tries multiple strategies."""
        from urllib.parse import quote
        log.info("[GOAT] Authenticating (Cloudflare bypass)...")
        ua = "alias/1.48.1 (iPad; iOS 18.7.1; Scale/2.00) Locale/de"
        form_headers = {
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": ua, "accept": "application/json",
        }
        json_headers = {
            "content-type": "application/json",
            "user-agent": ua, "accept": "application/json",
        }
        login_url = f"{self.BASE}/api/v1/unstable/users/login"

        # Try refresh token first (skip placeholder values)
        if self.refresh_token and self.refresh_token not in ("dein_refresh_token_hier", ""):
            r = self.scraper.post(login_url,
                                  data=f"grant_type=refresh_token&refresh_token={quote(self.refresh_token)}",
                                  headers=form_headers, timeout=15, proxies=self._proxy_dict())
            if r.status_code == 200:
                data = r.json()
                self.access_token = data["auth_token"]["access_token"]
                self._save()
                log.info("[GOAT] Session ready (refresh token)")
                return
            log.warning("[GOAT] Refresh token failed: %d", r.status_code)

        # Fallback: email + password
        email = os.getenv("GOAT_EMAIL", "")
        pw = os.getenv("GOAT_PASSWORD", "")
        if not email or not pw:
            log.error("[GOAT] No GOAT_EMAIL/GOAT_PASSWORD in .env")
            return

        # Strategy matrix: [format, proxy]
        strategies = [
            ("form", True),   # form + proxy
            ("json", True),   # json + proxy
            ("form", False),  # form + direct (no proxy)
            ("json", False),  # json + direct
        ]
        for fmt, use_proxy in strategies:
            px = self._proxy_dict() if use_proxy else {}
            label = f"{fmt}{'+ proxy' if use_proxy else '+ direct'}"
            log.info("[GOAT] Trying login: %s ...", label)
            try:
                if fmt == "form":
                    r = self.scraper.post(login_url,
                        data=f"grant_type=password&username={quote(email)}&password={quote(pw)}",
                        headers=form_headers, timeout=15, proxies=px)
                else:
                    r = self.scraper.post(login_url,
                        json={"grant_type": "password", "username": email, "password": pw},
                        headers=json_headers, timeout=15, proxies=px)

                if r.status_code == 200:
                    log.info("[GOAT] Login succeeded (%s)", label)
                    break
                log.warning("[GOAT] %s → %d %s", label, r.status_code, r.text[:150])
            except Exception as e:
                log.warning("[GOAT] %s → error: %s", label, e)
                continue
        else:
            log.error("[GOAT] All login strategies failed")
            return

        if r.status_code != 200:
            return

        data = r.json()
        self.access_token = data["auth_token"]["access_token"]
        new_rt = data.get("auth_token", {}).get("refresh_token")
        if new_rt:
            self.refresh_token = new_rt
            _update_env("GOAT_REFRESH_TOKEN", new_rt)
        self._save()
        log.info("[GOAT] Session ready (password login)")

    def _save(self):
        with open(GOAT_CACHE, "w") as f:
            json.dump({"access_token": self.access_token, "created_at": time.time()}, f)

    def _get(self, path: str) -> dict:
        """Authenticated GET request."""
        headers = {
            "authorization": f"Bearer {self.access_token}",
            "user-agent": "alias/1.48.1 (iPad; iOS 18.7.1; Scale/2.00) Locale/de",
            "accept": "application/json",
        }
        try:
            r = self.scraper.get(f"{self.BASE}{path}", headers=headers, timeout=15, proxies=self._proxy_dict())
        except Exception as e:
            log.error("[GOAT] GET failed: %s", e)
            return {}
        if r.status_code >= 400:
            log.error("[GOAT] GET %d on %s", r.status_code, path)
            return {}
        try:
            return r.json()
        except Exception:
            return {}

    def get_earnings_eur(self, sell_price_cents: int) -> Optional[dict]:
        """Get real EUR payout from GOAT's earnings API. Returns {payout_eur, fees_eur} or None."""
        data = self._get(f"/api/v1/listing-actions/earnings?quantity=0&selling_price_cents={sell_price_cents}")
        loc = data.get("localized_final_cash_out_amount_cents", {})
        if loc.get("currency") == "EUR" and loc.get("amount_cents"):
            eur_cents = int(loc["amount_cents"])
            sell_eur = eur_cents / 100
            commission = int(data.get("commission_cents", 0)) / 100
            seller_fee = int(data.get("seller_fee_cents", 0)) / 100
            cashout_fee = int(data.get("cash_out_fee_cents", 0)) / 100
            return {"payout": sell_eur, "fees": round(commission + seller_fee + cashout_fee, 2)}
        return None

    def _post(self, path: str, data: dict) -> dict:
        try:
            r = self._raw_post(path, data)
        except Exception as e:
            log.error("[GOAT] Request failed: %s", e)
            return {}
        if r.status_code == 403:
            log.warning("[GOAT] 403 — re-authenticating")
            try:
                self._auth()
                r = self._raw_post(path, data)
            except Exception as e:
                log.error("[GOAT] Re-auth failed: %s", e)
                return {}
        if r.status_code >= 400:
            log.error("[GOAT] HTTP %d on %s: %s", r.status_code, path, r.text[:200])
            return {}
        try:
            return r.json()
        except Exception:
            return {}

    def _post_gateway(self, path: str, data: dict) -> dict:
        """POST to gateway.alias.org (pricing-insights etc.)."""
        headers = {
            "authorization": f"Bearer {self.access_token}",
            "user-agent": "alias/1.48.1 (iPad; iOS 18.7.1; Scale/2.00) Locale/de",
            "accept": "application/json",
            "content-type": "application/json",
        }
        try:
            r = self.scraper.post(f"{self.GATEWAY}{path}", json=data, headers=headers, timeout=15, proxies=self._proxy_dict())
        except Exception as e:
            log.error("[GOAT] Gateway request failed: %s", e)
            return {}
        if r.status_code >= 400:
            log.error("[GOAT] Gateway HTTP %d on %s", r.status_code, path)
            return {}
        try:
            return r.json()
        except Exception:
            return {}

    def find_product(self, sku: str, product_name: str = "") -> tuple:
        """Find product. Returns (slug, product) or (None, None).
        Strategy: 1) DDG/Google → show_v2  2) show_v2 slug candidates  3) get-product fallback."""
        sku_slug = sku.lower().replace(" ", "-")
        log.info("[GOAT] Finding product: sku=%s name=%s", sku, product_name[:60] if product_name else "")

        # 1) DDG/Google to find slug (works without product name!)
        ddg_slug = self._search_web(sku)
        if ddg_slug:
            log.info("[GOAT] Web search found slug: %s", ddg_slug)
            # Verify via show_v2 (get full product data)
            slug, product = self._show_v2_single(ddg_slug)
            if slug and product:
                return slug, product
            # Fallback: try get-product
            product = self._try_product(ddg_slug)
            if product:
                return ddg_slug, product

        # 2) show_v2 with slug candidates (needs product_name for good slugs)
        slug, product = self._find_via_show_v2(sku_slug, product_name)
        if slug and product:
            return slug, product

        log.warning("[GOAT] Product not found: %s", sku)
        return None, None

    def _show_v2_single(self, slug: str) -> tuple:
        """Fetch a single slug via show_v2. Returns (slug, product) or (None, None)."""
        try:
            import cloudscraper as cs
            s = cs.create_scraper()
            px = self._proxy_dict()
            r = s.get(f"https://www.goat.com/api/v1/product_templates/{slug}/show_v2?countryCode=DE",
                headers={"user-agent": "GOAT/2.80.2 (iPhone; iOS 18.7.1)", "accept": "application/json"},
                timeout=5, proxies=px)
            if r.status_code == 200:
                data = r.json()
                if data.get("name"):
                    real_slug = data.get("slug", slug)
                    product = {
                        "name": data.get("name", ""),
                        "sku": data.get("sku", ""),
                        "slug": real_slug,
                        "retail_price_cents": data.get("retailPriceCents") or data.get("retail_price_cents"),
                    }
                    log.info("[GOAT] show_v2 verified: %s → %s", slug, data["name"][:50])
                    return real_slug, product
        except Exception:
            pass
        return None, None

    def _find_via_show_v2(self, sku_slug: str, product_name: str = "") -> tuple:
        """Use GOAT public show_v2 API to find slug + product data. No auth needed.
        Returns (slug, product_dict) or (None, None)."""
        import cloudscraper as cs
        s = cs.create_scraper()
        candidates = []

        if product_name:
            name = product_name.lower()
            for de, en in DE_TO_EN.items():
                name = re.sub(r'\b' + de + r'\b', en, name)
            for rm in ["(damen)", "(herren)", "(gs)", "(td)", "(ps)", "(women's)", "(men's)", "(kids)", "(wmns)"]:
                name = name.replace(rm, "").strip()
            name_nb = name
            for brand in ["nike ", "adidas ", "new balance ", "puma "]:
                if name.startswith(brand):
                    name_nb = name[len(brand):]
                    break
            candidates.append(_make_slug(name, sku_slug))
            candidates.append(_make_slug("air " + name, sku_slug))
            candidates.append(_make_slug(name_nb, sku_slug))
            candidates.append(_make_slug("air " + name_nb, sku_slug))
            is_wmns = any(w in product_name.lower() for w in ["damen", "women", "wmns"])
            if is_wmns:
                candidates.append(_make_slug("wmns " + name_nb, sku_slug))
                candidates.append(_make_slug("w " + name_nb, sku_slug))
            words = name_nb.split()
            for n in range(len(words), 1, -1):
                short = " ".join(words[:n])
                candidates.append(_make_slug(short, sku_slug))
                candidates.append(_make_slug("air " + short, sku_slug))
                if is_wmns:
                    candidates.append(_make_slug("wmns " + short, sku_slug))

        # Also try raw SKU slug
        candidates.append(sku_slug)

        seen = set()
        unique = []
        for c in candidates:
            c = re.sub(r"-+", "-", c).strip("-")
            if c not in seen:
                seen.add(c)
                unique.append(c)

        for slug in unique:
            try:
                px = self._proxy_dict()
                r = s.get(f"https://www.goat.com/api/v1/product_templates/{slug}/show_v2?countryCode=DE",
                    headers={"user-agent": "GOAT/2.80.2 (iPhone; iOS 18.7.1)", "accept": "application/json"},
                    timeout=5, proxies=px)
                if r.status_code == 200:
                    data = r.json()
                    real_slug = data.get("slug", slug)
                    if data.get("name"):
                        log.info("[GOAT] show_v2 hit: %s → %s", slug, data.get("name", "")[:50])
                        # Build product dict from show_v2 data (same fields as get-product)
                        product = {
                            "name": data.get("name", ""),
                            "sku": data.get("sku", ""),
                            "slug": real_slug,
                            "retail_price_cents": data.get("retailPriceCents") or data.get("retail_price_cents"),
                        }
                        return real_slug, product
            except Exception:
                pass
        return None, None

    def get_all_sizes(self, slug: str) -> list:
        """Fetch sizes with EU-regional pricing (region_id=2).
        1) list-variant-availabilities (no region) → discover available sizes
        2) variants/availability per size (region_id=2) → EU ask/bid/last/GI prices"""
        # Call 1: bulk fetch to discover which sizes exist
        data_detail = self._post("/api/v1/analytics/list-variant-availabilities", {
            "variant": {"id": slug, "packaging_condition": 1}
        })
        avails = data_detail.get("availability", [])
        if not avails:
            return []

        # Filter to sizes that have any pricing
        active = [a for a in avails if a.get("lowest_price_cents") or a.get("highest_offer_cents") or a.get("last_sold_price_cents")]

        # Call 2: fetch EU-regional prices + pricing-insights per active size (parallel)
        def _fetch_regional(size_val):
            # Both calls for this size
            avail_data = self._post("/api/v1/analytics/variants/availability", {
                "variant": {"id": slug, "size": size_val, "product_condition": 1, "packaging_condition": 1, "consigned": False, "region_id": "2"}
            })
            insights = self._post_gateway("/api/v1/pricing-insights/pricing", {
                "variant": {"product_id": slug, "region_id": "2", "size_us": size_val, "product_condition": 1, "packaging_condition": 1, "consigned": False}
            })
            return size_val, avail_data, insights

        regional_map = {}
        with ThreadPoolExecutor(max_workers=12) as pool:
            futures = {pool.submit(_fetch_regional, a["variant"]["size"]): a["variant"]["size"] for a in active if a.get("variant", {}).get("size") is not None}
            for future in as_completed(futures):
                sz, avail_data, insights = future.result()
                if avail_data or insights:
                    regional_map[sz] = (avail_data or {}, insights or {})

        # Build result: use regional prices where available, fallback to global
        result = []
        for a in avails:
            merged = dict(a)
            sz = a.get("variant", {}).get("size")
            if sz in regional_map:
                rd, ins = regional_map[sz]
                # Override with EU-regional prices (all in USD cents)
                if rd.get("lowest_price_cents"):
                    merged["lowest_price_cents"] = rd["lowest_price_cents"]
                if rd.get("highest_offer_cents"):
                    merged["highest_offer_cents"] = rd["highest_offer_cents"]
                if rd.get("last_sold_price_cents"):
                    merged["last_sold_price_cents"] = rd["last_sold_price_cents"]
                # GI = fast_cutoff_price_cents from pricing-insights (matches Alias "Globaler Indikator")
                # Fallback to high_demand_price_cents from availability
                gi = ins.get("fast_cutoff_price_cents") or rd.get("high_demand_price_cents") or rd.get("high_demand_price_cents_v2")
                if gi:
                    merged["high_demand_price_cents"] = gi
            result.append(merged)
        return result

    def get_monthly_sales(self, slug: str, size) -> int:
        """Get 30-day sales count using orders/recent endpoint (global, not EU-only)."""
        try:
            data = self._post("/api/v1/analytics/orders/recent", {
                "count": "200",
                "variant": {"id": slug, "size": float(size) if size else 0, "product_condition": 1, "packaging_condition": 1}
            })
            cutoff = datetime.utcnow() - timedelta(days=30)
            count = 0
            for sale in data.get("recent_sales", []):
                dt = _parse_dt(sale.get("purchased_at", ""))
                if dt and dt > cutoff:
                    count += 1
            return count
        except Exception:
            return 0

    def calc_payout_via_api(self, sell_price_usd_cents: int) -> dict:
        """Use GOAT's real earnings API for EUR payout. Falls back to estimate."""
        data = self._get(f"/api/v1/listing-actions/earnings?quantity=0&selling_price_cents={sell_price_usd_cents}")
        loc = data.get("localized_final_cash_out_amount_cents", {})
        if loc.get("currency") == "EUR" and loc.get("amount_cents"):
            payout_eur = int(loc["amount_cents"]) / 100
            commission = int(data.get("commission_cents", 0)) / 100
            seller_fee = int(data.get("seller_fee_cents", 0)) / 100
            cashout_fee = int(data.get("cash_out_fee_cents", 0)) / 100
            total_fees_usd = commission + seller_fee + cashout_fee
            return {"payout": payout_eur, "fees": round(total_fees_usd / 100, 2)}
        # Fallback: estimate with static conversion
        sell_eur = sell_price_usd_cents / 100 * self._usd_eur_rate()
        fees = sell_eur * GOAT_COMMISSION + GOAT_SELLER_FEE
        return {"payout": round(sell_eur - fees, 2), "fees": round(fees, 2)}

    def _usd_eur_rate(self) -> float:
        """Get USD→EUR rate from a single earnings call. Cached.
        Uses final_cash_out_amount_cents (USD after all fees) vs localized EUR
        to get a pure exchange rate without fees baked in."""
        if hasattr(self, "_cached_rate") and self._cached_rate:
            return self._cached_rate
        data = self._get("/api/v1/listing-actions/earnings?quantity=0&selling_price_cents=10000")
        loc = data.get("localized_final_cash_out_amount_cents", {})
        if loc.get("currency") == "EUR" and loc.get("amount_cents"):
            cashout_usd = int(data.get("final_cash_out_amount_cents", 0))
            cashout_eur = int(loc["amount_cents"])
            if cashout_usd > 0:
                self._cached_rate = cashout_eur / cashout_usd
                log.info("[GOAT] USD→EUR rate: %.4f", self._cached_rate)
                return self._cached_rate
        self._cached_rate = 0.88  # fallback
        return self._cached_rate

    @staticmethod
    def calc_payout(sell_price: float) -> dict:
        """Legacy static payout calc (USD, no conversion)."""
        fees = sell_price * GOAT_COMMISSION + GOAT_SELLER_FEE
        return {"payout": round(sell_price - fees, 2), "fees": round(fees, 2)}

    def _try_product(self, slug: str) -> Optional[dict]:
        try:
            data = self._post("/api/v1/listings/get-product", {"id": slug})
            if not data:
                return None
            product = data.get("product", data)
            if product and product.get("name"):
                log.info("[GOAT] Found product via get-product: %s → %s", slug, product.get("name", "")[:60])
            return product if product and product.get("name") else None
        except Exception:
            return None

    def _search_web(self, sku: str) -> Optional[str]:
        """Search for GOAT product slug. Tries multiple search engines.
        Uses residential proxy for engines that block datacenter IPs."""
        sku_lower = sku.lower().replace(" ", "-")
        ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

        def _extract(text: str) -> Optional[str]:
            slugs = re.findall(r"goat\.com/sneakers/([a-z0-9-]+)", text)
            for s in slugs:
                if sku_lower in s:
                    return s
            return slugs[0] if slugs else None

        # Search engines: (name, url, use_proxy)
        engines = [
            ("Startpage", f"https://www.startpage.com/do/search?q=site:goat.com/sneakers+{sku}", False),
            ("Startpage+proxy", f"https://www.startpage.com/do/search?q=site:goat.com/sneakers+{sku}", True),
            ("Bing", f"https://www.bing.com/search?q=site:goat.com/sneakers+{sku}", False),
            ("Bing+proxy", f"https://www.bing.com/search?q=site:goat.com/sneakers+{sku}", True),
            ("DDG", f"https://html.duckduckgo.com/html/?q=site:goat.com/sneakers/+{sku}", False),
            ("DDG+proxy", f"https://html.duckduckgo.com/html/?q=site:goat.com/sneakers/+{sku}", True),
            ("Google", f"https://www.google.com/search?q=site:goat.com/sneakers+{sku}", False),
        ]

        for name, url, use_proxy in engines:
            try:
                px = self._proxy_dict() if use_proxy else {}
                r = plain_requests.get(url, headers={"user-agent": ua}, timeout=8, proxies=px)
                if r.status_code == 200:
                    slug = _extract(r.text)
                    if slug:
                        log.info("[GOAT] %s found: %s", name, slug)
                        return slug
                    log.debug("[GOAT] %s → 200 but no slug found", name)
                else:
                    log.debug("[GOAT] %s → %d", name, r.status_code)
            except Exception as e:
                log.debug("[GOAT] %s → error: %s", name, e)
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


def _make_slug(name: str, sku_slug: str) -> str:
    slug = re.sub(r"['\(\)\",./]", "", name)
    slug = re.sub(r"\s+", "-", slug.strip())
    slug = re.sub(r"-+", "-", slug)
    return f"{slug}-{sku_slug}"


def _update_env(key: str, value: str):
    """Update a key in the backend .env file."""
    env_path = os.path.join(_DIR, ".env")
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path) as f:
            lines = f.readlines()
        for i, line in enumerate(lines):
            if line.startswith(f"{key}="):
                lines[i] = f"{key}={value}\n"
                break
        with open(env_path, "w") as f:
            f.writelines(lines)
    except Exception:
        pass


# ─── Unified Check Functions ─────────────────────────────────────────────────

_stockx_client: Optional[StockXClient] = None
_goat_client: Optional[GoatClient] = None
_init_done = False


def _get_stockx() -> StockXClient:
    global _stockx_client
    if _stockx_client is None:
        _stockx_client = StockXClient(headless=True)
    return _stockx_client


def _get_goat() -> Optional[GoatClient]:
    global _goat_client
    if _goat_client is None:
        try:
            _goat_client = GoatClient()
        except Exception as e:
            log.error("[GOAT] Failed to init client: %s", e)
            return None
    return _goat_client


def warm_up():
    """Pre-init StockX + GOAT sessions in background thread. Call at server startup."""
    global _init_done
    if _init_done:
        return
    _init_done = True

    def _init():
        log.info("[Sneaker] Warming up sessions...")
        try:
            _get_stockx()
            log.info("[Sneaker] StockX session ready")
        except Exception as e:
            log.error("[Sneaker] StockX warm-up failed: %s", e)
        try:
            _get_goat()
            log.info("[Sneaker] GOAT session ready")
        except Exception as e:
            log.error("[Sneaker] GOAT warm-up failed: %s", e)

    import threading
    threading.Thread(target=_init, daemon=True).start()


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

    sku_display = sku
    for t in full.get("traits", []):
        if t.get("name") in ("Style", "Modellnr.", "Artikelnr."):
            sku_display = t["value"]

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

    # Image
    image_url = full.get("media", {}).get("imageUrl", "") or full.get("media", {}).get("smallImageUrl", "")

    # Fetch prices, stats, and sales IN PARALLEL (was sequential — huge speed boost)
    _prices_result = {}
    _stats_result = {}
    _sales_result = []

    def _fetch_prices():
        nonlocal _prices_result
        _prices_result = sx.get_all_variant_prices([sv["id"] for sv in size_map])

    def _fetch_stats():
        nonlocal _stats_result
        _stats_result = sx.get_market_stats(pid)

    def _fetch_sales():
        nonlocal _sales_result
        _sales_result = sx.get_sales(pid, max_pages=30, days=370)  # chart only (30D from batched variant query)

    with ThreadPoolExecutor(max_workers=3) as pool:
        pool.submit(_fetch_prices)
        pool.submit(_fetch_stats)
        f3 = pool.submit(_fetch_sales)
        f3.result()  # wait for all

    raw_prices = _prices_result
    stats = _stats_result
    l90 = stats.get("last90Days", {})
    l72 = stats.get("last72Hours", {})

    sales = _sales_result
    cutoff_30d = datetime.utcnow() - timedelta(days=30)

    # Chart data: extract price + date from all sales
    chart_data = []
    for s in sales:
        dt = s.get("createdAt", "")
        amount = s.get("amount")
        if dt and amount:
            chart_data.append({"date": dt[:10] if len(dt) >= 10 else dt, "price": amount})

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
        guidance = vdata.get("pricingGuidance", {}).get("sellingGuidance", {})
        sell_faster = guidance.get("sellFaster")

        # Use sellFaster for profit calc (instant sale price), fallback to ask
        sell_price = sell_faster or ask
        payout_info = StockXClient.calc_payout(sell_price) if sell_price else {"payout": None, "fees": None}
        profit = round(payout_info["payout"] - ek_netto, 2) if payout_info["payout"] else None
        # Per-variant 30D sales from batched query (no pagination needed)
        variant_sales = vdata.get("market", {}).get("sales", {}).get("edges", [])
        monthly = sum(1 for e in variant_sales if _parse_dt(e.get("node", {}).get("createdAt", "")) and _parse_dt(e["node"]["createdAt"]) > cutoff_30d)

        sizes.append({
            "size": sv["size"],
            "ask": ask, "bid": bid, "last_sale": last,
            "sell_faster": sell_faster,
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
        "image": image_url,
        "sales_90d": l90.get("salesCount"),
        "sales_72h": l72.get("salesCount"),
        "fees_label": "9% TX + 3% Processing + 4.50\u20ac Shipping",
        "chart": chart_data,
        "sizes": sizes,
    }


def check_goat(sku: str, ek: float, product_name: str = "") -> dict:
    """Check a sneaker on GOAT/Alias. Returns normalized result dict."""
    goat = _get_goat()
    if not goat or not goat.access_token:
        return {"ok": False, "error": "GOAT nicht verfügbar (Auth fehlgeschlagen)"}
    slug, product = goat.find_product(sku, product_name)
    if not product:
        return {"ok": False, "error": f"SKU '{sku}' nicht auf GOAT gefunden"}

    goat_name = product.get("name", "")
    goat_sku = product.get("sku", sku)
    retail_cents = product.get("retail_price_cents")
    retail = int(retail_cents) / 100 if retail_cents else None

    # Image via public show_v2 API (no auth needed)
    image_url = ""
    try:
        import cloudscraper as _cs
        _s = _cs.create_scraper()
        _px = GoatClient._proxy_dict()
        _r = _s.get(f"https://www.goat.com/api/v1/product_templates/{slug}/show_v2?countryCode=DE",
            headers={"user-agent": "GOAT/2.80.2 (iPhone; iOS 18.7.1)", "accept": "application/json"}, timeout=5, proxies=_px)
        if _r.status_code == 200:
            image_url = _r.json().get("mainPictureUrl", "")
    except Exception:
        pass

    availabilities = goat.get_all_sizes(slug)
    if not availabilities:
        ddg_slug = goat._search_web(sku)
        if ddg_slug and ddg_slug != slug:
            availabilities = goat.get_all_sizes(ddg_slug)
            if availabilities:
                slug = ddg_slug

    if not availabilities:
        return {"ok": False, "error": "Keine Gr\u00f6\u00dfen-Daten auf GOAT"}

    # Merge sizes (deduplicate) — prices stored in USD (raw from API)
    size_map: Dict[str, dict] = {}
    for a in availabilities:
        v = a.get("variant", {})
        size = v.get("size")
        if not size:
            continue
        ask_c = int(a["lowest_price_cents"]) if a.get("lowest_price_cents") else None
        bid_c = int(a["highest_offer_cents"]) if a.get("highest_offer_cents") else None
        last_c = int(a["last_sold_price_cents"]) if a.get("last_sold_price_cents") else None
        gi_c = int(a.get("high_demand_price_cents") or a.get("high_demand_price_cents_v2") or 0) or None
        ask = ask_c / 100 if ask_c else None
        bid = bid_c / 100 if bid_c else None
        last = last_c / 100 if last_c else None
        gi = gi_c / 100 if gi_c else None
        key = str(size)
        if key in size_map:
            ex = size_map[key]
            if ask and (not ex["ask"] or ask < ex["ask"]):
                ex["ask"] = ask
                ex["_ask_cents"] = ask_c
            if bid and (not ex["bid"] or bid > ex["bid"]):
                ex["bid"] = bid
                ex["_bid_cents"] = bid_c
            if last and not ex["last_sale"]:
                ex["last_sale"] = last
            if gi and not ex.get("global_indicator"):
                ex["global_indicator"] = gi
                ex["_gi_cents"] = gi_c
        else:
            size_map[key] = {
                "size": size, "ask": ask, "bid": bid, "last_sale": last, "global_indicator": gi,
                "_ask_cents": ask_c, "_bid_cents": bid_c, "_gi_cents": gi_c,
            }

    active_sizes = {k: v for k, v in size_map.items() if v["ask"] or v["bid"] or v["last_sale"]}

    # Pre-compute sell prices for earnings API (payout based on Global Indicator)
    # Priority: GI (recommended sell price) > BID > ASK
    sell_prices_map: Dict[str, int] = {}
    for k, s in active_sizes.items():
        cents = s.get("_gi_cents") or s.get("_bid_cents") or s.get("_ask_cents")
        if cents:
            sell_prices_map[k] = cents

    # === ALL secondary fetches in ONE parallel block ===
    chart_data: List[dict] = []
    earnings_cache: Dict[int, dict] = {}
    rate_box = [None]  # mutable container for rate

    def _fetch_monthly_and_chart(sz):
        """Fetch monthly sales count + chart points for one size."""
        monthly = goat.get_monthly_sales(slug, sz)
        points = []
        try:
            data = goat._post("/api/v1/analytics/products/historical-sales", {
                "variant": {"id": slug, "size": sz, "product_condition": 1, "packaging_condition": 1, "region_id": "2"}
            })
            for d in data.get("daily_365", []):
                if not d.get("no_sales_made") and d.get("average_price_cents"):
                    points.append({
                        "date": d["start_date"][:10] if d.get("start_date") else "",
                        "price": int(d["average_price_cents"]) / 100,
                    })
        except Exception:
            pass
        return ("chart", sz, monthly, points)

    def _fetch_earnings(usd_cents: int):
        return ("earnings", usd_cents, goat.calc_payout_via_api(usd_cents))

    def _fetch_rate():
        rate_box[0] = goat._usd_eur_rate()
        return ("rate",)

    # Only fetch chart for max 3 popular sizes (biggest ask or bid activity)
    chart_sizes = sorted(active_sizes.keys(), key=lambda k: (active_sizes[k].get("bid") or 0) + (active_sizes[k].get("ask") or 0), reverse=True)[:3]

    unique_prices = set(sell_prices_map.values())
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = []
        futures.append(pool.submit(_fetch_rate))
        for sz in active_sizes:
            futures.append(pool.submit(_fetch_monthly_and_chart, sz))
        for p in unique_prices:
            futures.append(pool.submit(_fetch_earnings, p))
        for future in as_completed(futures):
            r = future.result()
            if r[0] == "chart":
                _, sz, count, points = r
                if sz in active_sizes:
                    active_sizes[sz]["sales_30d"] = count
                if sz in chart_sizes:
                    chart_data.extend(points)
            elif r[0] == "earnings":
                _, cents, result = r
                earnings_cache[cents] = result

    rate = rate_box[0] or 0.88

    # Sort chart data by date and convert USD→EUR
    chart_data.sort(key=lambda x: x.get("date", ""))
    for pt in chart_data:
        if pt.get("price"):
            pt["price"] = round(pt["price"] * rate, 2)

    ek_netto = ek / 1.19
    sorted_sizes = sorted(active_sizes.values(), key=lambda x: _size_sort(x["size"]))

    sizes = []
    for s in sorted_sizes:
        # Convert USD prices to EUR for display
        ask_usd = s.get("ask")
        bid_usd = s.get("bid")
        last_usd = s.get("last_sale")
        gi_usd = s.get("global_indicator")
        ask = round(ask_usd * rate, 2) if ask_usd else None
        bid = round(bid_usd * rate, 2) if bid_usd else None
        last = round(last_usd * rate, 2) if last_usd else None
        gi = round(gi_usd * rate, 2) if gi_usd else None

        sell_cents = sell_prices_map.get(str(s["size"]))
        payout_info = earnings_cache.get(sell_cents, {"payout": None, "fees": None}) if sell_cents else {"payout": None, "fees": None}
        profit = round(payout_info["payout"] - ek_netto, 2) if payout_info["payout"] else None
        sizes.append({
            "size": s["size"],
            "ask": ask, "bid": bid, "last_sale": last,
            "global_indicator": gi,
            "payout": payout_info["payout"],
            "fees": payout_info["fees"],
            "profit": profit,
            "sales_30d": s.get("sales_30d", 0),
        })

    # Convert retail to EUR too
    retail_eur = round(retail * rate, 2) if retail else None

    return {
        "ok": True,
        "platform": "goat",
        "sku": goat_sku,
        "title": goat_name,
        "slug": slug,
        "image": image_url,
        "retail_price": retail_eur,
        "fees_label": "9.5% Commission + 5\u20ac Seller Fee + 2.9% Cash Out",
        "chart": chart_data,
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
