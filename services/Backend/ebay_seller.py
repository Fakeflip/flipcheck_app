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
])

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

        listings.append({
            "item_id":   item_id,
            "title":     title,
            "price":     price,
            "ean_guess": ean_guess,
            "url":       f"https://www.ebay.de/itm/{item_id}" if item_id else None,
        })

    return {
        "ok":          True,
        "total":       int(total_items or 0),
        "total_pages": int(total_pages or 1),
        "page":        page,
        "items":       listings,
    }
