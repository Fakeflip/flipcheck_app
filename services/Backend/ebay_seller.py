"""
ebay_seller.py — eBay Seller OAuth2 + Inventory API (price updates)

OAuth2 Authorization Code Flow (user-level) with sell.inventory scope.
Token stored in userData/ebay_seller_token.json (managed by Electron main.js).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import time
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urlencode

import httpx
from dotenv import load_dotenv

logger = logging.getLogger("FLIPCHECK.EbaySeller")

BASE_DIR   = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

# ── Config ────────────────────────────────────────────────────────────────────
EBAY_CLIENT_ID     = os.getenv("EBAY_CLIENT_ID", "")
EBAY_CLIENT_SECRET = os.getenv("EBAY_CLIENT_SECRET", "")
EBAY_REDIRECT_URI  = os.getenv(
    "EBAY_SELLER_REDIRECT_URI",
    "https://api.joinflipcheck.app/seller/auth/callback"
)
EBAY_TOKEN_URL     = "https://api.ebay.com/identity/v1/oauth2/token"
EBAY_AUTH_BASE     = "https://auth.ebay.com/oauth2/authorize"
EBAY_INVENTORY_BASE = "https://api.ebay.com/sell/inventory/v1"
SELL_SCOPE         = "https://api.ebay.com/oauth/api_scope/sell.inventory"

# Token file path — set by main.js via env var or default to cwd
TOKEN_FILE = Path(os.getenv("EBAY_SELLER_TOKEN_FILE", BASE_DIR / "ebay_seller_token.json"))

# In-memory token cache
_token_cache: Optional[Dict] = None


# ── OAuth Helpers ─────────────────────────────────────────────────────────────

def seller_auth_url() -> str:
    """Return the eBay OAuth2 consent URL (send user to this URL)."""
    params = {
        "client_id":     EBAY_CLIENT_ID,
        "redirect_uri":  EBAY_REDIRECT_URI,
        "response_type": "code",
        "scope":         SELL_SCOPE,
        "prompt":        "login",
    }
    return f"{EBAY_AUTH_BASE}?{urlencode(params)}"


def _basic_auth() -> str:
    raw = f"{EBAY_CLIENT_ID}:{EBAY_CLIENT_SECRET}"
    return base64.b64encode(raw.encode()).decode()


async def seller_token_exchange(code: str) -> Dict:
    """
    Exchange an authorization code for access + refresh tokens.
    Saves result to TOKEN_FILE and updates in-memory cache.
    """
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


async def _refresh_token(token_data: Dict) -> str:
    """Use the refresh_token to get a new access_token."""
    refresh_token = token_data.get("refresh_token")
    if not refresh_token:
        raise RuntimeError("No refresh_token available — user must re-authorize")

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
                "scope":         SELL_SCOPE,
            },
            timeout=15,
        )
    if resp.status_code != 200:
        raise RuntimeError(f"eBay token refresh failed: {resp.status_code} {resp.text}")

    data = resp.json()
    # Preserve refresh_token (only access_token is replaced)
    data["refresh_token"]   = refresh_token
    data["obtained_at"]     = int(time.time())
    _save_token(data)
    return data["access_token"]


async def get_seller_token() -> str:
    """Return a valid access_token, refreshing automatically if expired."""
    data = _load_token()
    if not data:
        raise RuntimeError("No eBay seller token — user must authorize via /seller/auth/url")

    obtained  = data.get("obtained_at", 0)
    expires_in = data.get("expires_in", 7200)
    # Refresh 5 minutes before expiry
    if (time.time() - obtained) >= (expires_in - 300):
        return await _refresh_token(data)
    return data["access_token"]


def is_connected() -> bool:
    """Check whether a seller token exists (not necessarily valid)."""
    return _load_token() is not None


# ── eBay Inventory API ────────────────────────────────────────────────────────

async def bulk_update_prices(updates: List[Dict]) -> Dict:
    """
    Update prices for up to N SKUs using bulkUpdatePriceQuantity.
    Automatically batches when len(updates) > 25.

    updates: [{ "sku": "...", "new_price": 19.99 }, ...]
    Returns: { "success": [...skus...], "failed": [...{sku, error}...] }
    """
    token  = await get_seller_token()
    success: List[str] = []
    failed:  List[Dict] = []

    # Chunk into batches of 25 (eBay API limit)
    chunk_size = 25
    for i in range(0, len(updates), chunk_size):
        batch = updates[i : i + chunk_size]
        requests_payload = [
            {
                "sku": item["sku"],
                "shipToLocationAvailability": {},  # required but can be empty
                "offers": [
                    {
                        "price": {
                            "value":    str(round(float(item["new_price"]), 2)),
                            "currency": "EUR",
                        }
                    }
                ],
            }
            for item in batch
        ]
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{EBAY_INVENTORY_BASE}/bulk_update_price_quantity",
                    headers={
                        "Authorization":   f"Bearer {token}",
                        "Content-Type":    "application/json",
                        "Content-Language": "de-DE",
                        "Accept-Language": "de-DE",
                        "X-EBAY-C-MARKETPLACE-ID": "EBAY_DE",
                    },
                    json={"requests": requests_payload},
                    timeout=20,
                )
            if resp.status_code in (200, 207):
                result = resp.json()
                for r in result.get("responses", []):
                    sku   = r.get("sku", "?")
                    error = (r.get("errors") or r.get("warnings"))
                    if error:
                        failed.append({"sku": sku, "error": str(error)})
                    else:
                        success.append(sku)
            else:
                for item in batch:
                    failed.append({"sku": item["sku"], "error": f"HTTP {resp.status_code}"})
        except Exception as e:
            for item in batch:
                failed.append({"sku": item["sku"], "error": str(e)})

    return {"success": success, "failed": failed}
