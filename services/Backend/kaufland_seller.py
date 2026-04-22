"""
Kaufland Marketplace Seller API client.
Uses API client_key + secret_key with HMAC-SHA256 signatures.
Mirrors ebay_seller.py in structure and response format.
"""

import base64
import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from urllib.parse import urlencode

import httpx

logger = logging.getLogger("kaufland_seller")

KAUFLAND_API_BASE = "https://sellerapi.kaufland.com/v2"

# Kaufland order unit statuses that indicate a return/refund
_RETURN_STATUSES = {
    "return_requested", "return_received", "return_accepted",
    "refund_granted", "refund_completed", "cancelled", "cancelled_by_buyer",
    # Uppercase variants (API may return either)
    "RETURN_REQUESTED", "RETURN_RECEIVED", "RETURN_ACCEPTED",
    "REFUND_GRANTED", "REFUND_COMPLETED", "CANCELLED", "CANCELLED_BY_BUYER",
}


# ── HMAC-SHA256 Signing ─────────────────────────────────────────────────────

def _sign_request(secret_key: str, method: str, url: str, body: str, timestamp: str) -> str:
    """Compute Kaufland HMAC-SHA256 signature."""
    plain = "\n".join([method, url, body, timestamp])
    sig = hmac.new(secret_key.encode("utf-8"), plain.encode("utf-8"), hashlib.sha256)
    return sig.hexdigest()


def _build_headers(client_key: str, secret_key: str, method: str, url: str, body: str = "") -> Dict[str, str]:
    """Build signed headers for Kaufland Seller API request."""
    ts = str(int(time.time()))
    sig = _sign_request(secret_key, method, url, body, ts)
    return {
        "Shop-Client-Key": client_key,
        "Shop-Timestamp": ts,
        "Shop-Signature": sig,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Flipcheck/2.6",
    }


# ── Generic Request Helper ──────────────────────────────────────────────────

async def _kaufland_request(
    method: str,
    path: str,
    client_key: str,
    secret_key: str,
    params: Optional[Dict] = None,
    body: Optional[Dict] = None,
    timeout: float = 30.0,
) -> Dict:
    """Execute a signed request to the Kaufland Seller API."""
    url = f"{KAUFLAND_API_BASE}/{path.lstrip('/')}"
    if params:
        url += "?" + urlencode(params)

    body_str = json.dumps(body) if body else ""
    headers = _build_headers(client_key, secret_key, method.upper(), url, body_str)

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.request(
            method.upper(),
            url,
            headers=headers,
            content=body_str if body else None,
        )

    if resp.status_code == 401:
        return {"ok": False, "error": "Unauthorized – invalid credentials", "status": 401}
    if resp.status_code == 403:
        return {"ok": False, "error": "Forbidden – insufficient permissions", "status": 403}
    if resp.status_code == 404:
        return {"ok": False, "error": "Not found", "status": 404}
    if resp.status_code >= 400:
        try:
            err = resp.json()
        except Exception:
            err = resp.text
        return {"ok": False, "error": f"API error {resp.status_code}: {err}", "status": resp.status_code}

    try:
        return {"ok": True, "data": resp.json(), "status": resp.status_code}
    except Exception:
        return {"ok": True, "data": resp.text, "status": resp.status_code}


# ── Credential helpers ──────────────────────────────────────────────────────

def parse_kaufland_creds(raw: str) -> Optional[Dict]:
    """Decode base64-encoded JSON credentials from X-Kaufland-Credentials header."""
    if not raw:
        return None
    try:
        decoded = base64.b64decode(raw).decode("utf-8")
        data = json.loads(decoded)
        if data.get("client_key") and data.get("secret_key"):
            return data
    except Exception:
        pass
    # Try raw JSON
    try:
        data = json.loads(raw)
        if data.get("client_key") and data.get("secret_key"):
            return data
    except Exception:
        pass
    return None


def encode_kaufland_creds(data: Dict) -> str:
    """Encode credentials dict to base64 string."""
    return base64.b64encode(json.dumps(data).encode("utf-8")).decode("utf-8")


# ── Public API Functions ────────────────────────────────────────────────────

async def verify_credentials(client_key: str, secret_key: str) -> Dict:
    """Verify Kaufland API credentials with a lightweight test call."""
    result = await _kaufland_request("GET", "/units/", client_key, secret_key, params={"limit": "1"})
    if result.get("ok"):
        return {"ok": True, "connected": True}
    return {"ok": False, "connected": False, "error": result.get("error", "Unknown error")}


async def get_active_units(
    client_key: str,
    secret_key: str,
    page: int = 1,
    per_page: int = 100,
) -> Dict:
    """Fetch active units (listings) from Kaufland Seller API, paginated.
    Returns format matching eBay's get_my_active_listings response.
    """
    offset = (page - 1) * per_page
    params = {
        "status": "ACTIVE",
        "limit": str(min(per_page, 200)),
        "offset": str(offset),
    }

    result = await _kaufland_request("GET", "/units/", client_key, secret_key, params=params)
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error", "Failed to fetch units"), "items": []}

    data = result.get("data", {})
    raw_items = data.get("data", [])
    total = data.get("pagination", {}).get("total", len(raw_items))
    total_pages = max(1, -(-total // per_page))  # ceil division

    items = []
    for unit in raw_items:
        # Kaufland returns prices in cents
        price_cents = unit.get("listing_price") or unit.get("price") or 0
        price_euro = round(price_cents / 100, 2) if price_cents else 0

        ean = unit.get("ean") or ""
        product_id = str(unit.get("id_product", "")) if unit.get("id_product") else None
        unit_id = str(unit.get("id_unit", "")) if unit.get("id_unit") else None

        items.append({
            "item_id": unit_id,
            "title": unit.get("title") or unit.get("product_title") or "",
            "ean": ean,
            "price": price_euro,
            "quantity": unit.get("amount") or unit.get("quantity") or 1,
            "status": unit.get("status", "ACTIVE"),
            "condition": _map_condition(unit.get("condition")),
            "url": f"https://www.kaufland.de/product/{product_id}/" if product_id else None,
            "kaufland_product_id": product_id,
        })

    return {
        "ok": True,
        "total": total,
        "total_pages": total_pages,
        "page": page,
        "items": items,
    }


async def get_orders(
    client_key: str,
    secret_key: str,
    days: int = 30,
    page: int = 1,
    per_page: int = 100,
) -> Dict:
    """Fetch recent orders from Kaufland Seller API, flattened to sold items.
    Returns format matching eBay's get_my_sold_list response.
    """
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    offset = (page - 1) * per_page
    params = {
        "ts_created_from_iso": since,
        "limit": str(min(per_page, 200)),
        "offset": str(offset),
        "sort": "ts_created:desc",
    }

    result = await _kaufland_request("GET", "/orders/", client_key, secret_key, params=params)
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error", "Failed to fetch orders"), "items": []}

    data = result.get("data", {})
    raw_orders = data.get("data", [])
    total = data.get("pagination", {}).get("total", len(raw_orders))
    total_pages = max(1, -(-total // per_page))

    items = []
    for order in raw_orders:
        order_id = str(order.get("id_order", ""))
        order_status = order.get("status", "")
        ts_created = order.get("ts_created") or order.get("ts_units_created") or ""

        # Full buyer name (for shipping label)
        buyer_obj = order.get("buyer", {}) if isinstance(order.get("buyer"), dict) else {}
        full_buyer_name = buyer_obj.get("name", "")
        # Masked buyer name (for display / privacy)
        masked_buyer = full_buyer_name[:3] + "***" if full_buyer_name and len(full_buyer_name) > 3 else full_buyer_name

        # Shipping address from order
        shipping_addr = order.get("shipping_address") or order.get("delivery_address") or {}
        if isinstance(shipping_addr, dict):
            addr_name    = shipping_addr.get("first_name", "") + " " + shipping_addr.get("last_name", "")
            addr_name    = addr_name.strip() or full_buyer_name
            addr_street  = shipping_addr.get("street", "")
            addr_house   = shipping_addr.get("house_number", "")
            addr_full    = f"{addr_street} {addr_house}".strip() if addr_house else addr_street
            addr_zip     = shipping_addr.get("postcode", "") or shipping_addr.get("postal_code", "")
            addr_city    = shipping_addr.get("city", "")
            addr_country = shipping_addr.get("country", "DE")
        else:
            addr_name = full_buyer_name
            addr_full = ""
            addr_zip = ""
            addr_city = ""
            addr_country = "DE"

        order_units = order.get("order_units", [])
        for ou in order_units:
            price_cents = ou.get("price") or ou.get("unit_price") or 0
            price_euro = round(price_cents / 100, 2) if price_cents else 0
            qty = ou.get("quantity") or 1

            unit_status = ou.get("status") or order_status
            is_return = unit_status in _RETURN_STATUSES

            # Shipped = status is "sent" or similar
            is_shipped = unit_status.lower() in ("sent", "received", "delivered",
                                                  "shipped", "completed")

            # Refund amount: Kaufland refunds the unit price on return
            refund_amount = price_euro if is_return else 0

            items.append({
                "item_id": str(ou.get("id_unit", "")) if ou.get("id_unit") else None,
                "order_id": order_id,
                "title": ou.get("product_title") or ou.get("title") or "",
                "ean_guess": ou.get("ean") or "",
                "quantity_sold": qty,
                "unit_price": price_euro,
                "total_price": round(price_euro * qty, 2),
                "transaction_date": ts_created,
                "buyer": masked_buyer,
                "status": unit_status,
                "is_return": is_return,
                "refund_amount": refund_amount,
                # Buyer address for shipping labels
                "buyer_name":    addr_name,
                "buyer_street":  addr_full,
                "buyer_zip":     addr_zip,
                "buyer_city":    addr_city,
                "buyer_country": addr_country,
                "shipped":       is_shipped,
            })

    return {
        "ok": True,
        "total": total,
        "total_pages": total_pages,
        "page": page,
        "items": items,
    }


async def send_order_unit(
    client_key: str,
    secret_key: str,
    order_unit_id: str,
    tracking_number: str,
    carrier: str = "DHL",
) -> Dict:
    """
    Mark a Kaufland order unit as shipped with tracking info.
    PATCH /order-units/{id_order_unit}/send
    Body: { "carrier_code": "dhl", "tracking_numbers": "123..." }
    """
    # Map carrier names to Kaufland carrier_code values
    carrier_map = {
        "DHL":            "dhl",
        "DPD":            "dpd",
        "Hermes":         "hermes",
        "GLS":            "gls",
        "UPS":            "ups",
        "Deutsche Post":  "deutsche_post",
        "FedEx":          "fedex",
        "TNT":            "tnt",
        "dhl":            "dhl",
        "dpd":            "dpd",
        "hermes":         "hermes",
        "gls":            "gls",
    }
    carrier_code = carrier_map.get(carrier, carrier.lower())

    result = await _kaufland_request(
        "PATCH",
        f"/order-units/{order_unit_id}/send",
        client_key,
        secret_key,
        body={
            "carrier_code": carrier_code,
            "tracking_numbers": tracking_number,
        },
    )
    if result.get("ok"):
        return {"ok": True, "order_unit_id": order_unit_id, "tracking_number": tracking_number}
    return {"ok": False, "order_unit_id": order_unit_id, "error": result.get("error", "Send failed")}


async def update_unit_price(
    client_key: str,
    secret_key: str,
    unit_id: str,
    new_price: float,
) -> Dict:
    """Update the listing price of a Kaufland unit. Price in euros, converted to cents."""
    price_cents = int(round(new_price * 100))
    result = await _kaufland_request(
        "PATCH",
        f"/units/{unit_id}/",
        client_key,
        secret_key,
        body={"listing_price": price_cents},
    )
    if result.get("ok"):
        return {"ok": True, "unit_id": unit_id, "new_price": new_price}
    return {"ok": False, "unit_id": unit_id, "error": result.get("error", "Update failed")}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _map_condition(raw) -> str:
    """Map Kaufland condition codes to normalized strings."""
    mapping = {
        1: "new", "NEW": "new", "new": "new",
        2: "used_like_new", 4: "used_good", 5: "used_acceptable",
    }
    return mapping.get(raw, "new")


# ── Product Lookup (EAN → Product) ─────────────────────────────────────────

async def get_product_by_ean(
    client_key: str,
    secret_key: str,
    ean: str,
    storefront: str = "de",
) -> Dict:
    """Look up a Kaufland product directly by EAN via Seller API.
    GET /products/ean/{ean}?storefront={sf}
    Returns product_id, title, category info, EANs, and URL.
    """
    result = await _kaufland_request(
        "GET",
        f"/products/ean/{ean}",
        client_key,
        secret_key,
        params={"storefront": storefront, "embedded": "units"},
    )
    if not result.get("ok"):
        return {"ok": False, "product_id": None, "error": result.get("error"), "status": result.get("status")}

    data = result["data"]
    pid = data.get("id_product")
    cat = data.get("category") or {}

    return {
        "ok": True,
        "product_id": pid,
        "title": data.get("title", ""),
        "eans": data.get("eans", [ean]),
        "category_id": cat.get("id_category"),
        "category_name": cat.get("name"),
        "category_title": cat.get("title_singular") or cat.get("title_plural"),
        "variable_fee": cat.get("variable_fee"),       # e.g. 8.5 (percent)
        "fixed_fee": cat.get("fixed_fee", 0),           # e.g. 0 (cents)
        "vat": cat.get("vat", 19),
        "url": f"https://www.kaufland.de/product/{pid}/" if pid else None,
        "raw": data,
    }


async def search_products(
    client_key: str,
    secret_key: str,
    query: str,
    storefront: str = "de",
    limit: int = 5,
) -> Dict:
    """Search Kaufland products by keyword/EAN string.
    GET /products/search?q={query}&storefront={sf}&limit={n}
    """
    result = await _kaufland_request(
        "GET",
        "/products/search",
        client_key,
        secret_key,
        params={"q": query, "storefront": storefront, "limit": str(limit)},
    )
    if not result.get("ok"):
        return {"ok": False, "products": [], "error": result.get("error")}

    data = result.get("data", {})
    items = data.get("data", [])
    products = []
    for item in items:
        pid = item.get("id_product")
        cat = item.get("category") or {}
        products.append({
            "product_id": pid,
            "title": item.get("title", ""),
            "eans": item.get("eans", []),
            "category_id": cat.get("id_category"),
            "variable_fee": cat.get("variable_fee"),
            "fixed_fee": cat.get("fixed_fee", 0),
            "url": f"https://www.kaufland.de/product/{pid}/" if pid else None,
        })
    return {"ok": True, "products": products}


async def get_category_info(
    client_key: str,
    secret_key: str,
    category_id: int,
    storefront: str = "de",
) -> Dict:
    """Fetch category details including fee rates.
    GET /categories/{id}?storefront={sf}
    """
    result = await _kaufland_request(
        "GET",
        f"/categories/{category_id}/",
        client_key,
        secret_key,
        params={"storefront": storefront},
    )
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error")}

    cat = result["data"]
    return {
        "ok": True,
        "id_category": cat.get("id_category"),
        "name": cat.get("name"),
        "title": cat.get("title_singular") or cat.get("title_plural"),
        "variable_fee": cat.get("variable_fee"),   # percent, e.g. 8.5
        "fixed_fee": cat.get("fixed_fee", 0),      # euro-cents
        "vat": cat.get("vat", 19),
        "shipping_category": cat.get("shipping_category"),
    }
