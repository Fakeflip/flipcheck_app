"""
ebay_seller.py — eBay Seller OAuth2 + Trading API (price updates)

OAuth2 Authorization Code Flow (user-level).
Trading API used for ReviseFixedPriceItem (works for ALL listings, not just
Inventory API listings). GetMyeBaySelling fetches all active listings for
auto-matching inventory items by EAN.

Token stored in ebay_seller_token.json in userData dir.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urlencode

import httpx
from dotenv import load_dotenv

logger = logging.getLogger("FLIPCHECK.EbaySeller")

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

# ── Config ────────────────────────────────────────────────────────────────────
EBAY_CLIENT_ID     = os.getenv("EBAY_CLIENT_ID",     "")   # = App ID
EBAY_CLIENT_SECRET = os.getenv("EBAY_CLIENT_SECRET", "")   # = Cert ID
EBAY_DEV_ID        = os.getenv("EBAY_DEV_ID",        "")   # Developer ID
EBAY_REDIRECT_URI  = os.getenv(
    "EBAY_SELLER_REDIRECT_URI",
    "https://api.joinflipcheck.app/seller/auth/callback",
)

EBAY_TOKEN_URL  = "https://api.ebay.com/identity/v1/oauth2/token"
EBAY_AUTH_BASE  = "https://auth.ebay.com/oauth2/authorize"
EBAY_TRADING_URL = "https://api.ebay.com/ws/api.dll"
EBAY_SITE_ID    = "77"       # Germany
EBAY_API_COMPAT = "967"

SELL_SCOPES = " ".join([
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.account",
    "https://api.ebay.com/oauth/api_scope/sell.finances",
])

EBAY_FINANCES_BASE = "https://apiz.ebay.com/sell/finances/v1"

TOKEN_FILE   = Path(os.getenv("EBAY_SELLER_TOKEN_FILE", BASE_DIR / "ebay_seller_token.json"))
_token_cache: Optional[Dict] = None


# ── OAuth Helpers ─────────────────────────────────────────────────────────────

def seller_auth_url() -> str:
    """Return the eBay OAuth2 consent URL."""
    params = {
        "client_id":     EBAY_CLIENT_ID,
        "redirect_uri":  EBAY_REDIRECT_URI,
        "response_type": "code",
        "scope":         SELL_SCOPES,
        "prompt":        "login",
    }
    return f"{EBAY_AUTH_BASE}?{urlencode(params)}"


def _basic_auth() -> str:
    return base64.b64encode(f"{EBAY_CLIENT_ID}:{EBAY_CLIENT_SECRET}".encode()).decode()


async def seller_token_exchange(code: str) -> Dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            EBAY_TOKEN_URL,
            headers={
                "Authorization": f"Basic {_basic_auth()}",
                "Content-Type":  "application/x-www-form-urlencoded",
            },
            data={
                "grant_type":   "authorization_code",
                "code":         code,
                "redirect_uri": EBAY_REDIRECT_URI,
            },
            timeout=15,
        )
    if resp.status_code != 200:
        raise RuntimeError(f"eBay token exchange failed: {resp.status_code} {resp.text}")
    data = resp.json()
    data["obtained_at"] = int(time.time())
    _save_token(data)
    return {"ok": True, "expires_in": data.get("expires_in", 7200)}


def _save_token(data: Dict) -> None:
    global _token_cache
    _token_cache = data
    try:
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as e:
        logger.warning(f"Could not save seller token: {e}")


def _load_token() -> Optional[Dict]:
    global _token_cache
    if _token_cache:
        return _token_cache
    try:
        if TOKEN_FILE.exists():
            _token_cache = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
            return _token_cache
    except Exception:
        pass
    return None


async def _refresh_access_token(token_data: Dict) -> str:
    refresh_token = token_data.get("refresh_token")
    if not refresh_token:
        raise RuntimeError("No refresh_token — user must re-authorize")
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            EBAY_TOKEN_URL,
            headers={
                "Authorization": f"Basic {_basic_auth()}",
                "Content-Type":  "application/x-www-form-urlencoded",
            },
            data={
                "grant_type":    "refresh_token",
                "refresh_token": refresh_token,
                "scope":         SELL_SCOPES,
            },
            timeout=15,
        )
    if resp.status_code != 200:
        raise RuntimeError(f"eBay token refresh failed: {resp.status_code} {resp.text}")
    data = resp.json()
    data["refresh_token"] = refresh_token
    data["obtained_at"]   = int(time.time())
    _save_token(data)
    return data["access_token"]


async def get_seller_token() -> str:
    """Return a valid access_token, refreshing automatically if needed."""
    data = _load_token()
    if not data:
        raise RuntimeError("No eBay seller token — authorize via /seller/auth/url")
    obtained   = data.get("obtained_at", 0)
    expires_in = data.get("expires_in",  7200)
    if (time.time() - obtained) >= (expires_in - 300):
        return await _refresh_access_token(data)
    return data["access_token"]


def is_connected() -> bool:
    data = _load_token()
    if not data:
        return False
    return bool(data.get("legacy_token")) or bool(data.get("access_token"))


def is_legacy_mode() -> bool:
    """True if a legacy Auth'n'Auth token is configured (team access)."""
    data = _load_token()
    return bool(data and data.get("legacy_token"))


def save_legacy_token(token: str) -> None:
    """Store a legacy eBay Auth'n'Auth token (for team/sub-account access)."""
    global _token_cache
    data = _load_token() or {}
    data["legacy_token"] = token.strip()
    _save_token(data)


def remove_legacy_token() -> None:
    """Remove the legacy token. Falls back to OAuth if an access_token still exists."""
    global _token_cache
    data = _load_token()
    if not data:
        return
    data.pop("legacy_token", None)
    _token_cache = data
    if data.get("access_token"):
        _save_token(data)
    else:
        try:
            TOKEN_FILE.unlink(missing_ok=True)
        except Exception:
            pass
        _token_cache = None


async def get_token_for_trading() -> tuple:
    """
    Returns (token: str, is_legacy: bool).
    Prefers legacy Auth'n'Auth token (team access) over OAuth.
    """
    data = _load_token()
    if not data:
        raise RuntimeError("No eBay seller token — authorize via /seller/auth/url")
    legacy = data.get("legacy_token")
    if legacy:
        return legacy, True
    return await get_seller_token(), False


# ── Trading API helpers ───────────────────────────────────────────────────────

def _trading_headers(call_name: str, token: str, legacy: bool = False) -> Dict[str, str]:
    headers: Dict[str, str] = {
        "X-EBAY-API-COMPATIBILITY-LEVEL": EBAY_API_COMPAT,
        "X-EBAY-API-CALL-NAME":           call_name,
        "X-EBAY-API-SITEID":              EBAY_SITE_ID,
        "X-EBAY-API-APP-NAME":            EBAY_CLIENT_ID,
        "X-EBAY-API-DEV-NAME":            EBAY_DEV_ID,
        "X-EBAY-API-CERT-NAME":           EBAY_CLIENT_SECRET,
        "Content-Type":                   "text/xml",
    }
    if legacy:
        # Legacy Auth'n'Auth token (team/sub-account access)
        headers["X-EBAY-API-AUTH-TOKEN"] = token
    else:
        # OAuth2 IAF token (standard user authorization)
        headers["X-EBAY-API-IAF-TOKEN"] = token
    return headers


def _xml_tag(root: ET.Element, *path: str) -> Optional[str]:
    """Extract text from a nested XML path, tolerating missing nodes."""
    ns = "urn:ebay:apis:eBLBaseComponents"
    node = root
    for tag in path:
        node = node.find(f"{{{ns}}}{tag}")
        if node is None:
            return None
    return node.text


# ── ReviseFixedPriceItem ──────────────────────────────────────────────────────

async def revise_fixed_price_item(item_id: str, new_price: float, token: str, legacy: bool = False) -> Dict:
    """
    Update price of a single eBay listing via Trading API.
    Works for ALL fixed-price listings (not just Inventory API items).
    """
    price_str = f"{new_price:.2f}"
    xml_body  = f"""<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>{item_id}</ItemID>
    <StartPrice>{price_str}</StartPrice>
  </Item>
  <ErrorLanguage>de_DE</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
</ReviseFixedPriceItemRequest>"""

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            EBAY_TRADING_URL,
            headers=_trading_headers("ReviseFixedPriceItem", token, legacy=legacy),
            content=xml_body.encode("utf-8"),
            timeout=15,
        )

    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError as e:
        return {"ok": False, "item_id": item_id, "error": f"XML parse error: {e}"}

    ack = _xml_tag(root, "Ack")
    if ack in ("Success", "Warning"):
        return {"ok": True, "item_id": item_id}
    # Extract first error message
    error_msg = _xml_tag(root, "Errors", "LongMessage") or \
                _xml_tag(root, "Errors", "ShortMessage") or \
                f"Ack={ack}"
    return {"ok": False, "item_id": item_id, "error": error_msg}


async def bulk_revise_prices(updates: List[Dict]) -> Dict:
    """
    Batch price updates via ReviseFixedPriceItem (no limit per call — sequential).
    updates: [{"item_id": "...", "new_price": 19.99}, ...]
    Returns: {"success": [...item_ids], "failed": [{item_id, error}]}
    """
    token, is_legacy = await get_token_for_trading()
    success: List[str]  = []
    failed:  List[Dict] = []

    for upd in updates:
        item_id   = str(upd.get("item_id",   upd.get("sku", "")))
        new_price = float(upd["new_price"])
        result    = await revise_fixed_price_item(item_id, new_price, token, legacy=is_legacy)
        if result["ok"]:
            success.append(item_id)
        else:
            failed.append({"item_id": item_id, "error": result.get("error", "unknown")})

    return {"success": success, "failed": failed}


# ── GetMyeBaySelling ──────────────────────────────────────────────────────────

_EAN_RE = re.compile(r'\b(\d{8}|\d{12,14})\b')


def _extract_ean_from_text(text: str) -> Optional[str]:
    """Try to find an EAN-8 or EAN-13/14 in a string."""
    for m in _EAN_RE.finditer(text):
        candidate = m.group(1)
        # Prefer 13-digit EANs
        if len(candidate) == 13:
            return candidate
    # Fallback: any match
    for m in _EAN_RE.finditer(text):
        return m.group(1)
    return None


async def get_my_sold_list(page: int = 1, per_page: int = 100, days: int = 60) -> Dict:
    """
    Fetch seller's recently sold items via Trading API GetMyeBaySelling → SoldList.
    Returns list of {item_id, title, ean_guess, quantity_sold, total_price, transaction_date, buyer}.
    No additional OAuth scopes needed — works with sell.inventory + sell.account.
    """
    token, is_legacy = await get_token_for_trading()
    xml_body = f"""<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <SoldList>
    <Include>true</Include>
    <DurationInDays>{days}</DurationInDays>
    <Pagination>
      <EntriesPerPage>{min(per_page, 200)}</EntriesPerPage>
      <PageNumber>{page}</PageNumber>
    </Pagination>
    <Sort>EndTime</Sort>
  </SoldList>
  <ErrorLanguage>de_DE</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
</GetMyeBaySellingRequest>"""

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            EBAY_TRADING_URL,
            headers=_trading_headers("GetMyeBaySelling", token, legacy=is_legacy),
            content=xml_body.encode("utf-8"),
            timeout=20,
        )

    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError as e:
        raise RuntimeError(f"GetMyeBaySelling (SoldList) XML parse error: {e}")

    ack = _xml_tag(root, "Ack")
    if ack not in ("Success", "Warning"):
        error = _xml_tag(root, "Errors", "LongMessage") or f"Ack={ack}"
        raise RuntimeError(f"GetMyeBaySelling (SoldList) failed: {error}")

    ns = "urn:ebay:apis:eBLBaseComponents"
    sold_el = root.find(f"{{{ns}}}SoldList/{{{ns}}}OrderTransactionArray")
    if sold_el is None:
        return {"ok": True, "total": 0, "total_pages": 1, "page": page, "items": []}

    total_pages = _xml_tag(root, "SoldList", "PaginationResult", "TotalNumberOfPages")
    total_items = _xml_tag(root, "SoldList", "PaginationResult", "TotalNumberOfEntries")

    sold_items: List[Dict] = []
    for ot_el in sold_el.findall(f"{{{ns}}}OrderTransaction"):
        # Each OrderTransaction can have a Transaction inside
        txn = ot_el.find(f"{{{ns}}}Transaction")
        if txn is None:
            continue

        item_el = txn.find(f"{{{ns}}}Item")
        if item_el is None:
            continue

        item_id = _xml_tag(item_el, "ItemID")
        title   = _xml_tag(item_el, "Title") or ""

        # Quantity sold in this transaction
        qty_str   = _xml_tag(txn, "QuantityPurchased") or "1"
        price_str = _xml_tag(txn, "TransactionPrice") or "0"
        date_str  = _xml_tag(txn, "CreatedDate") or ""
        buyer     = _xml_tag(txn, "Buyer", "UserID") or ""
        order_id  = _xml_tag(txn, "OrderLineItemID") or ""

        try:
            qty   = int(qty_str)
        except ValueError:
            qty   = 1
        try:
            price = float(price_str)
        except ValueError:
            price = 0.0

        ean_guess = _extract_ean_from_text(title)

        sold_items.append({
            "item_id":          item_id,
            "title":            title,
            "ean_guess":        ean_guess,
            "quantity_sold":    qty,
            "total_price":      round(price * qty, 2),
            "unit_price":       price,
            "transaction_date": date_str,
            "buyer":            buyer[:3] + "***" if buyer else "",
            "order_id":         order_id,
            "url":              f"https://www.ebay.de/itm/{item_id}" if item_id else None,
        })

    return {
        "ok":          True,
        "total":       int(total_items or 0),
        "total_pages": int(total_pages or 1),
        "page":        page,
        "items":       sold_items,
    }


async def get_my_active_listings(page: int = 1, per_page: int = 100) -> Dict:
    """
    Fetch seller's active fixed-price listings via Trading API GetMyeBaySelling.
    Returns list of {item_id, title, price, ean_guess, url}.
    """
    token, is_legacy = await get_token_for_trading()
    xml_body = f"""<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Include>true</Include>
    <ListingType>FixedPriceItem</ListingType>
    <Pagination>
      <EntriesPerPage>{per_page}</EntriesPerPage>
      <PageNumber>{page}</PageNumber>
    </Pagination>
    <Sort>TimeLeft</Sort>
  </ActiveList>
  <ErrorLanguage>de_DE</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
</GetMyeBaySellingRequest>"""

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            EBAY_TRADING_URL,
            headers=_trading_headers("GetMyeBaySelling", token, legacy=is_legacy),
            content=xml_body.encode("utf-8"),
            timeout=20,
        )

    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError as e:
        raise RuntimeError(f"GetMyeBaySelling XML parse error: {e}")

    ack = _xml_tag(root, "Ack")
    if ack not in ("Success", "Warning"):
        error = _xml_tag(root, "Errors", "LongMessage") or f"Ack={ack}"
        raise RuntimeError(f"GetMyeBaySelling failed: {error}")

    ns   = "urn:ebay:apis:eBLBaseComponents"
    items_el = root.find(f"{{{ns}}}ActiveList/{{{ns}}}ItemArray")
    if items_el is None:
        return {"ok": True, "total": 0, "items": []}

    total_pages = _xml_tag(root, "ActiveList", "PaginationResult", "TotalNumberOfPages")
    total_items = _xml_tag(root, "ActiveList", "PaginationResult", "TotalNumberOfEntries")

    listings = []
    for item_el in items_el.findall(f"{{{ns}}}Item"):
        item_id = _xml_tag(item_el, "ItemID")
        title   = _xml_tag(item_el, "Title") or ""
        price_s = _xml_tag(item_el, "SellingStatus", "CurrentPrice") or \
                  _xml_tag(item_el, "BuyItNowPrice") or "0"
        try:
            price = float(price_s)
        except ValueError:
            price = 0.0
        ean_guess = _extract_ean_from_text(title)

        # Category ID (e.g. "9355" for Handys) — maps to fee tiers in the frontend
        cat_id = _xml_tag(item_el, "PrimaryCategory", "CategoryID") or ""
        cat_name = _xml_tag(item_el, "PrimaryCategory", "CategoryName") or ""

        # Quantity available
        qty_s = _xml_tag(item_el, "QuantityAvailable") or \
                _xml_tag(item_el, "Quantity") or "1"
        try:
            qty = int(qty_s)
        except ValueError:
            qty = 1

        listings.append({
            "item_id":   item_id,
            "title":     title,
            "price":     price,
            "ean_guess": ean_guess,
            "category_id":   cat_id,
            "category_name": cat_name,
            "qty":       qty,
            "url":       f"https://www.ebay.de/itm/{item_id}" if item_id else None,
        })

    return {
        "ok":          True,
        "total":       int(total_items or 0),
        "total_pages": int(total_pages or 1),
        "page":        page,
        "items":       listings,
    }


# ── Finances API — real fees & shipping costs per order ──────────────────────

async def get_order_financials(order_ids: List[str]) -> Dict[str, Dict]:
    """
    Fetch real eBay fees + shipping costs for a list of order IDs using the
    Finances API (sell.finances scope required).

    Returns a dict keyed by order_id:
    {
      "orderId": {
        "total_fee": 12.34,         # Total eBay fees (marketplace fee + intl fee etc.)
        "shipping_cost": 5.99,      # Actual shipping label cost (0 if self-shipped)
        "payout_amount": 45.67,     # Net payout from eBay
        "fee_breakdown": {...}      # Individual fee types
      }
    }

    Uses getTransactions endpoint with order_id filter.
    Gracefully returns empty dict on auth errors (user needs re-auth with sell.finances).
    """
    if not order_ids:
        return {}

    # We need an OAuth2 token (not legacy) for RESTful Finances API
    data = _load_token()
    if not data or data.get("legacy_token") and not data.get("access_token"):
        logger.warning("[Finances] No OAuth2 token available (legacy-only) — skipping")
        return {}

    try:
        token = await get_seller_token()
    except Exception as e:
        logger.warning(f"[Finances] Token error: {e}")
        return {}

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type":  "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_DE",
    }

    results: Dict[str, Dict] = {}

    # Process in batches — Finances API supports one order_id filter at a time
    async with httpx.AsyncClient() as client:
        for oid in order_ids:
            if not oid:
                continue
            try:
                # getTransactions filtered by orderId
                params = {
                    "filter": f"orderId:{{{oid}}}",
                    "limit":  "50",
                }
                resp = await client.get(
                    f"{EBAY_FINANCES_BASE}/transaction",
                    headers=headers,
                    params=params,
                    timeout=12,
                )
                if resp.status_code == 401 or resp.status_code == 403:
                    logger.warning(f"[Finances] Auth error ({resp.status_code}) — user may need to re-auth with sell.finances scope")
                    return results  # Stop processing, scope likely missing
                if resp.status_code != 200:
                    logger.debug(f"[Finances] {oid}: HTTP {resp.status_code}")
                    continue

                body = resp.json()
                transactions = body.get("transactions", [])

                total_fee = 0.0
                shipping_cost = 0.0
                payout_amount = 0.0
                fee_breakdown = {}
                refund_total = 0.0
                refund_date = None
                refund_fee_credit = 0.0

                for txn in transactions:
                    txn_type = txn.get("transactionType", "")

                    # SALE transactions contain the fee breakdown
                    if txn_type == "SALE":
                        # orderLineItems contain fee details
                        for oli in txn.get("orderLineItems", []):
                            fees = oli.get("marketplaceFees", [])
                            for fee in fees:
                                fee_type = fee.get("feeType", "UNKNOWN")
                                amt = fee.get("amount", {})
                                fee_val = abs(float(amt.get("value", 0)))
                                total_fee += fee_val
                                fee_breakdown[fee_type] = fee_breakdown.get(fee_type, 0) + fee_val

                        # Total amount from the sale
                        total_amt = txn.get("totalFeeBasisAmount", txn.get("amount", {}))
                        payout_amt = txn.get("amount", {})
                        payout_amount += float(payout_amt.get("value", 0))

                    # SHIPPING_LABEL transactions are the actual shipping cost
                    elif txn_type == "SHIPPING_LABEL":
                        ship_amt = txn.get("amount", {})
                        shipping_cost += abs(float(ship_amt.get("value", 0)))

                    # REFUND transactions — buyer got money back
                    elif txn_type == "REFUND":
                        refund_amt = txn.get("amount", {})
                        refund_total += abs(float(refund_amt.get("value", 0)))
                        refund_date = txn.get("transactionDate", refund_date)
                        # Fee credits: eBay may refund its fee on full refunds
                        for oli in txn.get("orderLineItems", []):
                            for fee in oli.get("marketplaceFees", []):
                                refund_fee_credit += abs(float(fee.get("amount", {}).get("value", 0)))

                results[oid] = {
                    "total_fee":         round(total_fee, 2),
                    "shipping_cost":     round(shipping_cost, 2),
                    "payout_amount":     round(payout_amount, 2),
                    "fee_breakdown":     fee_breakdown,
                    "refund_amount":     round(refund_total, 2),
                    "refund_date":       refund_date,
                    "refund_fee_credit": round(refund_fee_credit, 2),
                }
            except Exception as e:
                logger.debug(f"[Finances] Error fetching {oid}: {e}")
                continue

    return results


async def get_sold_with_financials(page: int = 1, per_page: int = 100, days: int = 60) -> Dict:
    """
    Convenience: fetch sold list + enrich with real fee data from Finances API.
    Falls back gracefully if Finances API is unavailable (missing scope).
    """
    sold_result = await get_my_sold_list(page=page, per_page=per_page, days=days)
    if not sold_result.get("ok") or not sold_result.get("items"):
        return sold_result

    # Collect unique order IDs for financial lookup
    order_ids = list({
        item["order_id"] for item in sold_result["items"]
        if item.get("order_id")
    })

    if not order_ids:
        return sold_result

    try:
        financials = await get_order_financials(order_ids)
    except Exception as e:
        logger.warning(f"[Finances] Bulk lookup failed: {e}")
        financials = {}

    # Enrich sold items with financial data
    for item in sold_result["items"]:
        oid = item.get("order_id")
        if oid and oid in financials:
            fin = financials[oid]
            item["ebay_fee"]           = fin["total_fee"]
            item["shipping_cost"]      = fin["shipping_cost"]
            item["payout_amount"]      = fin["payout_amount"]
            item["fee_breakdown"]      = fin["fee_breakdown"]
            item["refund_amount"]      = fin.get("refund_amount", 0)
            item["refund_date"]        = fin.get("refund_date", None)
            item["refund_fee_credit"]  = fin.get("refund_fee_credit", 0)
        else:
            item["ebay_fee"]           = None
            item["shipping_cost"]      = None
            item["payout_amount"]      = None
            item["refund_amount"]      = 0
            item["refund_date"]        = None
            item["refund_fee_credit"]  = 0

    sold_result["has_financials"] = len(financials) > 0
    return sold_result
