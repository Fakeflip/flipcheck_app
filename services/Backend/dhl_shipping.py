"""
DHL Parcel DE Shipping API v2 client.
Creates shipments and returns PDF labels.
Requires: DHL Developer API Key + GKP business customer credentials.
"""

import base64
import json
import logging
from typing import Dict, Optional

import httpx

logger = logging.getLogger("dhl_shipping")

DHL_API_BASE = "https://api.dhl.com/parcel/de/shipping/v2"
DHL_SANDBOX_BASE = "https://api-sandbox.dhl.com/parcel/de/shipping/v2"

# DHL product codes
PRODUCTS = {
    "V01PAK":    "DHL Paket",
    "V62WP":     "DHL Warenpost",
    "V01PRIO":   "DHL Paket Prio",
    "V86PARCEL": "DHL Kleinpaket",
}


def parse_dhl_creds(raw: str) -> Optional[Dict]:
    """Decode base64-encoded JSON credentials from X-DHL-Credentials header."""
    if not raw:
        return None
    try:
        decoded = base64.b64decode(raw).decode("utf-8")
        data = json.loads(decoded)
        if data.get("api_key") and data.get("ekp"):
            return data
    except Exception:
        pass
    try:
        data = json.loads(raw)
        if data.get("api_key") and data.get("ekp"):
            return data
    except Exception:
        pass
    return None


def _build_headers(creds: Dict) -> Dict[str, str]:
    """Build authentication headers for DHL API requests."""
    headers = {
        "dhl-api-key": creds["api_key"],
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    # GKP basic auth (username:password)
    if creds.get("username") and creds.get("password"):
        basic = base64.b64encode(
            f"{creds['username']}:{creds['password']}".encode()
        ).decode()
        headers["Authorization"] = f"Basic {basic}"
    return headers


async def verify_credentials(creds: Dict) -> Dict:
    """Verify DHL credentials by attempting a lightweight API call."""
    try:
        headers = _build_headers(creds)
        async with httpx.AsyncClient(timeout=15) as client:
            # Try to validate the shipment endpoint (dry run with validate=true)
            resp = await client.get(
                f"{DHL_API_BASE}/orders",
                headers=headers,
                params={"limit": "1"},
            )
        # 401 = bad API key, 403 = bad GKP creds
        if resp.status_code == 401:
            return {"ok": False, "connected": False, "error": "Ungültiger API Key"}
        if resp.status_code == 403:
            return {"ok": False, "connected": False, "error": "GKP-Zugangsdaten ungültig"}
        # 200 or 404 (no orders) both indicate valid credentials
        if resp.status_code in (200, 404):
            return {"ok": True, "connected": True}
        return {"ok": False, "connected": False, "error": f"DHL API Status {resp.status_code}"}
    except Exception as e:
        return {"ok": False, "connected": False, "error": str(e)}


async def create_shipment(
    creds: Dict,
    sender: Dict,
    recipient: Dict,
    weight_kg: float = 1.0,
    product: str = "V01PAK",
    reference: str = "",
) -> Dict:
    """
    Create a DHL shipment and return the label as base64 PDF.

    sender/recipient format:
    {
        "name": "Max Mustermann",
        "street": "Musterstr.",
        "house_number": "1",
        "zip": "12345",
        "city": "Berlin",
        "country": "DE"
    }
    """
    ekp = creds["ekp"]
    # Build participation number (EKP + product suffix)
    # Standard suffix mapping
    participation_suffixes = {
        "V01PAK":    "01",
        "V62WP":     "01",
        "V01PRIO":   "01",
        "V86PARCEL": "01",
    }
    suffix = participation_suffixes.get(product, "01")
    billing_number = f"{ekp}{product[1:] if len(product) > 1 else product}{suffix}"

    # Parse street + house number if combined
    sender_street = sender.get("street", "")
    sender_number = sender.get("house_number", "")
    if not sender_number and sender_street:
        # Try to split "Musterstr. 1" into street + number
        parts = sender_street.rsplit(" ", 1)
        if len(parts) == 2 and parts[1][0].isdigit():
            sender_street = parts[0]
            sender_number = parts[1]

    recipient_street = recipient.get("street", "")
    recipient_number = recipient.get("house_number", "")
    if not recipient_number and recipient_street:
        parts = recipient_street.rsplit(" ", 1)
        if len(parts) == 2 and parts[1][0].isdigit():
            recipient_street = parts[0]
            recipient_number = parts[1]

    shipment = {
        "product": product,
        "billingNumber": billing_number,
        "refNo": reference or None,
        "shipper": {
            "name1": sender.get("name", ""),
            "addressStreet": sender_street,
            "addressHouse": sender_number,
            "postalCode": sender.get("zip", ""),
            "city": sender.get("city", ""),
            "country": sender.get("country", "DE"),
        },
        "consignee": {
            "name1": recipient.get("name", ""),
            "addressStreet": recipient_street,
            "addressHouse": recipient_number,
            "postalCode": recipient.get("zip", ""),
            "city": recipient.get("city", ""),
            "country": recipient.get("country", "DE"),
        },
        "details": {
            "weight": {
                "uom": "kg",
                "value": round(weight_kg, 2),
            },
        },
    }

    # Remove None values
    if not shipment["refNo"]:
        del shipment["refNo"]

    headers = _build_headers(creds)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{DHL_API_BASE}/shipments",
                headers=headers,
                json={"shipments": [shipment]},
                params={"validate": "false", "mustEncode": "true"},
            )

        if resp.status_code in (200, 201):
            data = resp.json()
            items = data.get("items", [])
            if items and items[0].get("shipmentNo"):
                item = items[0]
                return {
                    "ok": True,
                    "shipment_no": item["shipmentNo"],
                    "label_pdf_b64": item.get("label", {}).get("b64", ""),
                    "label_url": item.get("label", {}).get("url", ""),
                    "tracking_url": f"https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode={item['shipmentNo']}",
                }
            # Check for validation errors
            if items and items[0].get("validationMessages"):
                msgs = items[0]["validationMessages"]
                error_msgs = [m.get("validationMessage", "") for m in msgs if m.get("validationState") == "Error"]
                return {"ok": False, "error": "; ".join(error_msgs) or "Validierungsfehler"}
            return {"ok": False, "error": "Keine Sendungsnummer erhalten"}

        if resp.status_code == 401:
            return {"ok": False, "error": "DHL-Authentifizierung fehlgeschlagen"}
        if resp.status_code == 400:
            try:
                err = resp.json()
                detail = err.get("detail", err.get("title", str(err)))
                return {"ok": False, "error": f"DHL Fehler: {detail}"}
            except Exception:
                return {"ok": False, "error": f"DHL Fehler {resp.status_code}: {resp.text[:200]}"}

        return {"ok": False, "error": f"DHL API Fehler {resp.status_code}"}

    except httpx.TimeoutException:
        return {"ok": False, "error": "DHL API Timeout"}
    except Exception as e:
        logger.error("DHL create_shipment error: %s", e)
        return {"ok": False, "error": str(e)}
