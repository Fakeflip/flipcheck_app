# services/api/app.py
from __future__ import annotations

import os
import re
import anyio
import asyncio


import time
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Dict, Any
from collections import defaultdict
from pydantic import BaseModel, Field, model_validator
from typing import Optional, Literal
from functools import partial
from pydantic import AliasChoices, AliasPath
from pydantic.config import ConfigDict
from fastapi.concurrency import run_in_threadpool
from services.providers.ebay_live import lookup_offer_count, calc_days_to_cash
from services.providers.kaufland import check_ean, batch_check_ean
import base64, secrets
from urllib.parse import urlencode, quote
from fastapi.responses import HTMLResponse






import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt
from jose.exceptions import JWTError

from services.providers.ebay_live import lookup_ebay_metrics_query
from services.api.ebay_fee_rules import resolve_fee_tiers
from services.providers.ebay_live import calc_days_to_cash




# ===================== ENV =====================
load_dotenv()

INTERNAL_PROXY_SECRET = os.getenv("INTERNAL_PROXY_SECRET", "")

FLIPCHECK_JWT_SECRET = os.getenv("FLIPCHECK_JWT_SECRET", "")
JWT_ALG = "HS256"

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# ✅ Beta Whitelist (optional)
BETA_ALLOWED_IDS = set(filter(None, (os.getenv("BETA_ALLOWED_IDS", "")).split(",")))

SB_HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

KAUFLAND_FEE_BY_KEY = {
  "kl_7_a":  (0.07, 0.0),
  "kl_7_b":  (0.07, 0.0),
  "kl_10_a": (0.10, 0.0),
  "kl_10_b": (0.10, 0.0),
  "kl_13_a": (0.13, 0.0),
  "kl_13_b": (0.13, 0.0),
  "kl_13_c": (0.13, 0.0),
  "kl_13_d": (0.13, 0.0),
  "kl_media":(0.13, 0.70),
  "kl_14_a": (0.14, 0.0),
  "kl_14_b": (0.14, 0.0),
  "kl_16":   (0.16, 0.0),
  "kl_other":(0.13, 0.0),
}


# ===================== RATE LIMIT (token bucket) =====================
_RATE = defaultdict(lambda: {"tokens": 2.0, "ts": time.time()})  # burst=2


def rate_limit(key: str, refill_per_sec: float = 0.7, burst: float = 2.0) -> None:
    now = time.time()
    b = _RATE[key]
    elapsed = now - b["ts"]
    b["ts"] = now

    b["tokens"] = min(burst, b["tokens"] + elapsed * refill_per_sec)

    if b["tokens"] < 1.0:
        raise HTTPException(status_code=429, detail="Too many requests")
    b["tokens"] -= 1.0


def require_beta_access(user: Dict[str, Any]) -> None:
    uid = str(user.get("sub") or "")
    if BETA_ALLOWED_IDS and uid not in BETA_ALLOWED_IDS:
        raise HTTPException(status_code=403, detail="Beta access only")


def _now_iso() -> str:
    return datetime.utcnow().isoformat()

def ebay_fee_net(sell_net: float, fee_up_to_200: float, fee_above_200: float) -> float:
    # Tier 1: bis 200 EUR, Tier 2: alles darüber
    tier_cap = 200.0
    a = min(sell_net, tier_cap) * float(fee_up_to_200)
    b = max(0.0, sell_net - tier_cap) * float(fee_above_200)
    return float(a + b)



def _hash_device(fp: str) -> str:
    return hashlib.sha256(fp.encode("utf-8")).hexdigest()

def parse_iso_dt(s: str | None) -> str | None:
    if not s:
        return None
    s = str(s).strip()
    if not s:
        return None

    # allow Z
    s2 = s.replace("Z", "+00:00")

    # 1) ISO first
    try:
        dt = datetime.fromisoformat(s2)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        pass

    # 2) DE formats: dd.mm.yyyy / dd.mm.yyyy hh:mm / dd.mm.yyyy hh:mm:ss
    for fmt in ("%d.%m.%Y", "%d.%m.%Y %H:%M", "%d.%m.%Y %H:%M:%S"):
        try:
            dt = datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except Exception:
            continue

    # 3) YYYY-MM-DD / with time
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except Exception:
            continue

    return None






# ===================== APP =====================
app = FastAPI(title="Flipcheck API", version="0.1.0")
print("✅ API FILE LOADED:", __file__)




app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ok for beta
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===================== INTERNAL PROXY GUARD =====================
# allow public endpoints (Electron client)
PUBLIC_PATHS = (
    "/health",
    "/auth/verify",
    "/session/pair",
    "/session/reset",
    "/flipcheck",
    "/inventory",
    "/settings",
    "/ebay", 
)

@app.middleware("http")
async def require_internal_proxy(request: Request, call_next):
    if request.url.path.startswith(PUBLIC_PATHS):
        return await call_next(request)

    if request.client and request.client.host in ("127.0.0.1", "::1"):
        return await call_next(request)

    if not INTERNAL_PROXY_SECRET:
        return JSONResponse({"detail": "server_misconfigured"}, status_code=500)

    if request.headers.get("x-internal-proxy") != INTERNAL_PROXY_SECRET:
        return JSONResponse({"detail": "forbidden"}, status_code=403)

    return await call_next(request)


# ===================== AUTH (JWT) =====================
def decode_token(token: str) -> Dict[str, Any]:
    if not FLIPCHECK_JWT_SECRET:
        raise HTTPException(status_code=500, detail="JWT secret missing")
    try:
        return jwt.decode(token, FLIPCHECK_JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_auth(request: Request) -> Dict[str, Any]:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = auth.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    return decode_token(token)


# ===================== SUPABASE HELPERS =====================
async def sb_has_device(user_id: str, device_hash: str) -> bool:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase env missing")

    url = f"{SUPABASE_URL}/rest/v1/devices"
    params = {
        "user_id": f"eq.{user_id}",
        "device_id_hash": f"eq.{device_hash}",
        "select": "id",
        "limit": "1",
    }

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SB_HEADERS, params=params)
        r.raise_for_status()
        return bool(r.json())


async def sb_insert_device(user_id: str, device_hash: str) -> None:
    url = f"{SUPABASE_URL}/rest/v1/devices"
    payload = {"user_id": user_id, "device_id_hash": device_hash}

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, headers=SB_HEADERS, json=payload)
        if r.status_code not in (200, 201, 204, 409):
            raise HTTPException(
                status_code=500,
                detail=f"supabase_insert_failed:{r.status_code}:{r.text}",
            )


async def sb_delete_devices(user_id: str) -> int:
    url = f"{SUPABASE_URL}/rest/v1/devices"
    params = {"user_id": f"eq.{user_id}"}

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.delete(url, headers=SB_HEADERS, params=params)
        if r.status_code not in (200, 204):
            raise HTTPException(
                status_code=500,
                detail=f"supabase_delete_failed:{r.status_code}:{r.text}",
            )
        return 1

class CustomRules(BaseModel):
    min_profit_eur: float = 0.0
    min_roi_pct: float = 0.0
    min_monthly_sales: int = 0

class FlipcheckRequest(BaseModel):
    ean: str
    ek: float
    mode: str = "mid"
    shipping_out: float | None = None
    custom: CustomRules | None = None



# ===================== DEVICE GUARD =====================
async def require_device(request: Request, user=Depends(require_auth)) -> Dict[str, Any]:
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    fp = request.headers.get("x-device")
    if not fp:
        raise HTTPException(status_code=403, detail="Missing X-Device")

    device_hash = _hash_device(fp)
    ok = await sb_has_device(user_id, device_hash)
    if not ok:
        raise HTTPException(status_code=403, detail="Device not paired")

    user["_device_hash"] = device_hash
    return user


# ===================== ROUTES =====================
@app.get("/health")
async def health():
    return {"ok": True, "service": "flipcheck-api", "time": _now_iso(), "file": __file__}

@app.get("/auth/verify")
async def auth_verify(user=Depends(require_auth)):
    require_beta_access(user)
    return {"ok": True, "license_ok": True, "who": str(user.get("sub") or "")}


@app.post("/session/pair")
async def session_pair(payload: Dict[str, Any], request: Request, user=Depends(require_auth)):
    require_beta_access(user)

    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    fp = (
        str(
            payload.get("device_fingerprint")
            or payload.get("fingerprint")
            or payload.get("fp")
            or payload.get("device")
            or ""
        ).strip()
        or (request.headers.get("x-device") or "").strip()
    )
    if not fp:
        raise HTTPException(status_code=400, detail="Missing fingerprint")

    device_hash = _hash_device(fp)

    already = await sb_has_device(user_id, device_hash)
    if not already:
        await sb_insert_device(user_id, device_hash)

    return {"ok": True, "paired": True}

class DeleteItemIn(BaseModel):
    id: str

from fastapi import Query

@app.delete("/inventory/delete")
async def inventory_delete(id: str = Query(...), user=Depends(require_device)):
    require_beta_access(user)
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    url = f"{SUPABASE_URL}/rest/v1/inventory_items"
    params = {"id": f"eq.{id}", "user_id": f"eq.{user_id}"}

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.delete(url, headers=SB_HEADERS, params=params)

    if r.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"supabase_delete_failed:{r.status_code}:{r.text}")

    return {"ok": True}



class EditItemIn(BaseModel):
    id: str
    title: Optional[str] = Field(default=None, max_length=512)
    buy_price_eur: Optional[float] = Field(default=None, ge=0)
    shipping_cost_eur: Optional[float] = Field(default=None, ge=0)
    purchased_at: Optional[str] = None
    clear_purchased_at: bool = False

    # ✅ NEW
    category: Optional[str] = Field(default=None, max_length=64)
    store_key: Optional[str] = Field(default=None, max_length=64)
    store_name: Optional[str] = Field(default=None, max_length=128)
    return_days: Optional[int] = Field(default=None, ge=0, le=365)
    shipping_out_eur: Optional[float] = Field(default=None, ge=0)


from pydantic import BaseModel
from typing import List

class KauflandCheckIn(BaseModel):
    ean: str

class KauflandBatchIn(BaseModel):
    eans: List[str]



@app.patch("/inventory/edit")
async def inventory_edit(body: EditItemIn, user=Depends(require_device)):
    require_beta_access(user)
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    patch: Dict[str, Any] = {}

    if body.title is not None:
        patch["title"] = body.title.strip()

    if body.buy_price_eur is not None:
        patch["buy_price_cents"] = eur_to_cents(body.buy_price_eur)

    if body.shipping_cost_eur is not None:
        patch["shipping_cost_cents"] = eur_to_cents(body.shipping_cost_eur)

    if body.category is not None:
        patch["category"] = body.category.strip() or None

    if body.store_key is not None:
        patch["store_key"] = body.store_key.strip().lower() or None

    if body.store_name is not None:
        patch["store_name"] = body.store_name.strip() or None

    if body.return_days is not None:
        patch["return_days"] = int(body.return_days)

    if body.shipping_out_eur is not None:
        patch["shipping_out_cents"] = eur_to_cents(float(body.shipping_out_eur))


    # ✅ purchased_at logic (clear > set > ignore empty)
    if body.clear_purchased_at:
        patch["purchased_at"] = None
        patch["purchase_date"] = None
    elif body.purchased_at is not None:
        s = str(body.purchased_at).strip()

        # wenn leer -> NICHT überschreiben
        if s != "":
            dt = parse_iso_dt(s)
            if not dt:
                raise HTTPException(status_code=400, detail="Invalid purchased_at format")
            patch["purchased_at"] = dt
            patch["purchase_date"] = dt[:10]

    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to edit")

    url = f"{SUPABASE_URL}/rest/v1/inventory_items"
    params = {"id": f"eq.{body.id}", "user_id": f"eq.{user_id}"}

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.patch(
            url,
            headers={**SB_HEADERS, "Prefer": "return=representation"},
            params=params,
            json=patch,
        )

        if r.status_code >= 300:
            raise HTTPException(status_code=500, detail=f"supabase_edit_failed:{r.status_code}:{r.text}")

    arr = r.json()
    item = (arr[0] if arr else None)

    # --- after successful edit ---
    try:
        if body.buy_price_eur is not None:
            inv = await sb_get_inventory_item_by_id(user_id, body.id)
            if inv:
                sku = (inv.get("sku") or "").strip()
                ek_cents = int(inv.get("buy_price_cents") or 0)
                ship_out_cents = int(inv.get("shipping_out_cents") or 500)

                if sku and ek_cents > 0:
                    changed = await sb_backfill_ebay_lines_for_sku(user_id, sku, ek_cents, ship_out_cents)
                    print("EBAY_BACKFILL", {"sku": sku, "lines": changed})
    except Exception as e:
        print("EBAY_BACKFILL_FAILED", str(e))

    return {"ok": True, "item": item}


from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
import io, csv

router = APIRouter()

from fastapi import UploadFile, File, Form
from fastapi.responses import StreamingResponse
import io, csv

async def lookup_kaufland_by_ean(ean: str) -> dict:
    # check_ean ist sync (curl_cffi) -> in thread ausführen
    return await anyio.to_thread.run_sync(check_ean, ean)

def resolve_kaufland_fees(profile: dict, payload: dict) -> tuple[float, float]:
    # pct als fraction: 0.13 = 13%
    pct = (
        payload.get("fee_pct")                # ✅ vom Frontend
        or payload.get("kaufland_fee_pct")    # legacy
        or payload.get("kaufland_fee")        # optional alias
        or profile.get("kaufland_fee_pct")    # falls du es später speicherst
        or profile.get("fee_kaufland_pct")    # optional alias
        or None
    )

    if pct is None:
        pct = 0.13  # ✅ Default Kaufland: 13% (nicht 12%)

    pct = float(pct)
    if pct > 1.0:
        pct = pct / 100.0

    fixed = (
        payload.get("fee_fixed")                   # ✅ vom Frontend
        or payload.get("fee_fixed_eur")            # optional alias
        or payload.get("kaufland_fee_fixed_eur")   # legacy
        or payload.get("kaufland_fee_fixed")       # optional alias
        or profile.get("kaufland_fee_fixed_eur")   # falls du es später speicherst
        or profile.get("fee_kaufland_fixed_eur")   # optional alias
        or 0.0
    )

    return float(pct), float(fixed)

def _amt_to_cents(obj) -> int:
    try:
        if not obj:
            return 0
        v = obj.get("value") if isinstance(obj, dict) else None
        if v is None:
            return 0
        return int(round(float(v) * 100))
    except Exception:
        return 0

def _sum_finance_fee_cents(transactions: list[dict]) -> int:
    """
    eBay Finances kann je nach Transaction-Type unterschiedliche Fee-Felder haben.
    Wir summieren defensiv alles, was wie Fees aussieht.
    """
    total = 0
    for tx in transactions or []:
        # Most common: transactionFees: [{amount:{value,currency}, feeType:...}, ...]
        fees = tx.get("transactionFees") or tx.get("fees") or []
        if isinstance(fees, list):
            for f in fees:
                # amount/feeAmount/totalFeeAmount etc
                amt = (
                    (f.get("amount") if isinstance(f, dict) else None)
                    or (f.get("feeAmount") if isinstance(f, dict) else None)
                    or (f.get("totalFeeAmount") if isinstance(f, dict) else None)
                )
                c = _amt_to_cents(amt)
                total += abs(c)

        # sometimes fee is directly on tx
        amt2 = tx.get("totalFeeAmount") or tx.get("feeAmount") or tx.get("fee")
        if isinstance(amt2, dict):
            total += abs(_amt_to_cents(amt2))

    return int(total)

def _alloc_fee_to_lines(fees_total_cents: int, line_sold_cents: list[int]) -> list[int]:
    s = sum(max(0, x) for x in line_sold_cents)
    if fees_total_cents <= 0 or s <= 0:
        return [0] * len(line_sold_cents)

    out = []
    used = 0
    for i, sold in enumerate(line_sold_cents):
        if i == len(line_sold_cents) - 1:
            share = fees_total_cents - used
        else:
            share = int(round(fees_total_cents * (max(0, sold) / s)))
            used += share
        out.append(max(0, share))
    return out




@app.post("/flipcheck/batch")
async def flipcheck_batch(
    file: UploadFile = File(...),
    platform: str = Form("ebay"),
    col_ean: str = Form("ean"),
    col_ek: str = Form("ek"),
    col_shipping_out: str = Form("shipping_out"),
    col_mode: str = Form("mode"),
    col_category: str = Form("category"),
    user=Depends(require_device),
):
    require_beta_access(user)

    uid = str(user.get("sub") or "")
    device_hash = str(user.get("_device_hash") or "")
    rate_key = f"{uid}:{device_hash}:batch"
    # batch strenger
    rate_limit(rate_key, refill_per_sec=0.1, burst=1.0)

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file")

    raw = (await file.read()).decode("utf-8", errors="replace")

    # dein Standard: ';'
    reader = csv.DictReader(io.StringIO(raw), delimiter=";")

    out = io.StringIO()
    writer = csv.writer(out, delimiter=";")
    writer.writerow([
        "ean","ek","shipping_out","mode","category","platform",
        "decision","profit","roi","sales_30d","offer_count","days_to_cash","demand_label","bestseller","error"
    ])





    sem = asyncio.Semaphore(6)  # parallelism, nicht zu hoch wegen eBay

    



    async def process_row(row: dict) -> list:
        async with sem:
            try:
                q = (row.get(col_ean) or "").strip()
                ek_raw = (row.get(col_ek) or "").strip().replace(",", ".")
                if not q:
                    raise ValueError("missing_ean")
                if not ek_raw:
                    raise ValueError("missing_ek")

                ek = float(ek_raw)

                shipping_out_raw = (row.get(col_shipping_out) or "").strip().replace(",", ".")
                shipping_out = float(shipping_out_raw) if shipping_out_raw else None

                mode = (row.get(col_mode) or "mid").strip() or "mid"
                category = (row.get(col_category) or "").strip() or None

                # ✅ platform kommt aus Form (global für den Batch)
                platform_row = (platform or "ebay").strip().lower()
                if platform_row not in ("ebay", "kaufland"):
                    platform_row = "ebay"

                # ✅ base payload
                payload = {
                    "query": q,
                    "query_mode": "ean",
                    "ek": ek,
                    "shipping_out": shipping_out if shipping_out is not None else 5.0,
                    "mode": mode,
                    "has_shop": True,
                    "platform": platform_row,
                }

                # ✅ platform-specific category + fees
                if platform_row == "kaufland":
                    cat = category or "kl_other"
                    pct, fixed = KAUFLAND_FEE_BY_KEY.get(cat, KAUFLAND_FEE_BY_KEY["kl_other"])
                    payload["category"] = cat
                    payload["fee_pct"] = pct
                    payload["fee_fixed"] = fixed
                else:
                    payload["category"] = category  # eBay category keys

                res = await run_flipcheck_engine(payload, user)
                if not res.get("ok"):
                    return [
                        q, f"{ek:.2f}", f"{payload['shipping_out']:.2f}", mode, (payload.get("category") or ""), platform_row,
                        "", "", "", "", "", "", "", (res.get("error") or "engine_error")
                    ]

                platform_out = (res.get("platform") or platform_row)

                if platform_out == "kaufland":
                    km = ((res.get("kaufland") or {}).get("metrics") or {})
                    return [
                        q, f"{ek:.2f}", f"{payload['shipping_out']:.2f}", mode, (payload.get("category") or ""), platform_out,
                        res.get("decision",""),
                        km.get("profit_cash_avg",""),
                        km.get("roi_cash_avg",""),
                        "",  # sales_30d (Kaufland hat keins)
                        km.get("offer_count",""),
                        km.get("days_to_cash",""),
                        km.get("demand_label",""),
                        km.get("bestseller",""),   # ✅ NEU
                        ""
                    ]
                else:
                    ebay = res.get("ebay") or {}
                    return [
                        q, f"{ek:.2f}", f"{payload['shipping_out']:.2f}", mode, (payload.get("category") or ""), platform_out,
                        res.get("decision",""),
                        ebay.get("profit_cash_avg",""),
                        ebay.get("roi_cash_avg",""),
                        ebay.get("sales_30d",""),
                        ebay.get("offer_count",""),
                        ebay.get("days_to_cash",""),
                        "",  # demand_label leer bei eBay
                        "",
                        ""
                    ]

            except Exception as e:
                return [
                    row.get(col_ean, ""), row.get(col_ek, ""), row.get(col_shipping_out, ""),
                    row.get(col_mode, ""), row.get(col_category, ""), (platform or "ebay"),
                    "", "", "", "", "", "", "", str(e)
                ]


@app.post("/kaufland/check")
def kaufland_check(payload: KauflandCheckIn):
    # single
    return check_ean(payload.ean)

@app.post("/kaufland/batch")
def kaufland_batch(payload: KauflandBatchIn):
    # batch (sleep klein halten für speed, aber nicht 0)
    eans = [e.strip() for e in payload.eans if e and e.strip()]
    return batch_check_ean(eans, sleep_s=0.15)





@app.post("/session/reset")
async def session_reset(user=Depends(require_auth)):
    require_beta_access(user)

    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    await sb_delete_devices(user_id)
    return {"ok": True, "reset": True}

from pydantic import validator

class AddInventoryItemIn(BaseModel):
    identifier_type: Literal["EAN","ASIN","EBAY_URL","TITLE"]
    identifier: str = Field(min_length=1, max_length=512)
    title: Optional[str] = Field(default=None, max_length=512)

    buy_price_eur: float = Field(gt=0)
    quantity: int = Field(default=1, ge=1, le=10000)
    currency: str = Field(default="EUR", max_length=8)
    condition: Optional[str] = Field(default=None, max_length=64)
    shipping_cost_eur: float = Field(default=0, ge=0)

    # ✅ NEW
    market: Optional[Literal["ebay","kaufland"]] = "ebay"
    category: Optional[str] = Field(default=None, max_length=64)

    store_key: Optional[str] = Field(default=None, max_length=64)
    store_name: Optional[str] = Field(default=None, max_length=128)
    return_days: Optional[int] = Field(default=None, ge=0, le=365)

    shipping_out_eur: Optional[float] = Field(default=5.0, ge=0)

    # Kaufland fee meta (optional)
    kaufland_category: Optional[str] = Field(default=None, max_length=32)
    fee_pct_bp: Optional[int] = Field(default=None, ge=0, le=100000)
    fee_fixed_cents: Optional[int] = Field(default=None, ge=0, le=1000000)

    source: Optional[str] = Field(default=None, max_length=64)
    notes: Optional[str] = Field(default=None, max_length=1000)
    purchased_at: Optional[str] = None
    target_margin: Optional[float] = Field(default=None, ge=0, le=5)   # 0.18 = 18%
    target_roi: Optional[float] = Field(default=None, ge=0, le=50)     # 0.30 = 30%



from fastapi import UploadFile, File
import csv
import io

class ImportModeIn(BaseModel):
    mode: Literal["merge", "add_only"] = "merge"
    # mapping keys: which csv columns map to our fields
    col_ean: str = "ean"
    col_title: str = "title"
    col_ek: str = "ek"
    col_qty: str = "qty"

@app.post("/inventory/import_csv")
async def inventory_import_csv(
    request: Request,
    file: UploadFile = File(...),
    mode: str = "merge",
    col_ean: str = "ean",
    col_title: str = "title",
    col_ek: str = "ek",
    col_qty: str = "qty",
    col_purchased_at: str = "purchased_at",
    user=Depends(require_device)
):
    require_beta_access(user)
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file")

    raw = await file.read()
    text = raw.decode("utf-8", errors="ignore")

    # Try sniff delimiter
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,")
        delim = dialect.delimiter
    except Exception:
        delim = ";"

    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    rows = []
    for r in reader:
        rows.append(r)

    if not rows:
        return {"ok": True, "inserted": 0, "updated": 0, "skipped": 0, "errors": ["empty_csv"]}

    # Load existing inventory (EAN->item)
    existing = await sb_get_inventory(user_id, limit=2000)
    by_ean = {}
    for it in existing:
        if it.get("identifier_type") == "EAN":
            by_ean[str(it.get("identifier") or "").strip()] = it

    inserted = 0
    updated = 0
    skipped = 0
    errors = []

    async with httpx.AsyncClient(timeout=30) as client:
        for i, r in enumerate(rows[:5000]):  # hard cap
            ean = str(r.get(col_ean, "") or "").strip()
            title = str(r.get(col_title, "") or "").strip() or None
            ek_raw = str(r.get(col_ek, "") or "").replace(",", ".").strip()
            qty_raw = str(r.get(col_qty, "") or "").strip()
            p_at_raw = str(r.get(col_purchased_at, "") or "").strip()

            if not ean or not ean.isdigit():
                skipped += 1
                continue

            try:
                ek = float(ek_raw) if ek_raw else None
            except Exception:
                ek = None

            try:
                qty = int(float(qty_raw)) if qty_raw else 1
                qty = max(1, min(qty, 100000))
            except Exception:
                qty = 1

            # MERGE: if exists -> qty += qty, optional EK overwrite if provided
            ex = by_ean.get(ean)
            if ex:
                if mode == "add_only":
                    skipped += 1
                    continue

                new_qty = int(ex.get("quantity") or 1) + qty
                patch = {"quantity": new_qty}
                if ek is not None and ek > 0:
                    patch["buy_price_cents"] = eur_to_cents(ek)
                if title:
                    patch["title"] = title
                purchased_at = parse_csv_datetime(p_at_raw)
                if purchased_at:
                    patch["purchased_at"] = purchased_at
                    patch["purchase_date"] = purchased_at[:10]


                await sb_patch_inventory_item(user_id, ex["id"], patch)
                updated += 1
                continue

            # insert new
            if ek is None or ek <= 0:
                # allow ek missing? MVP: require ek
                skipped += 1
                continue

            purchased_at = parse_csv_datetime(p_at_raw) or datetime.utcnow().isoformat()

            row = {
                "user_id": user_id,
                "identifier_type": "EAN",
                "identifier": ean,
                "title": title,
                "buy_price_cents": eur_to_cents(ek),
                "quantity": qty,
                "currency": "EUR",
                "source": "csv",
                "purchased_at": purchased_at,
                "purchase_date": purchased_at[:10],  # YYYY-MM-DD (optional, aber clean)
            }

            url = f"{SUPABASE_URL}/rest/v1/inventory_items"
            r2 = await client.post(url, headers={**SB_HEADERS, "Prefer":"return=representation"}, json=row)
            if r2.status_code not in (200,201,204):
                errors.append(f"row{i}:insert_failed:{r2.status_code}")
                skipped += 1
                continue

            inserted += 1
            obj = (r2.json()[0] if r2.text else row)
            by_ean[ean] = obj



    return {"ok": True, "inserted": inserted, "updated": updated, "skipped": skipped, "errors": errors, "delimiter": delim}


def eur_to_cents(x: float) -> int:
    return int(round(x * 100))

def parse_csv_datetime(s: str) -> Optional[str]:
    s = (s or "").strip()
    if not s:
        return None

    # ISO / with Z
    s2 = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s2)
        return dt.isoformat()
    except Exception:
        pass

    # DE formats: "02.01.2026" or "02.01.2026 12:30" or "02.01.2026 12:30:45"
    for fmt in ("%d.%m.%Y", "%d.%m.%Y %H:%M", "%d.%m.%Y %H:%M:%S"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.isoformat()
        except Exception:
            continue

    # fallback: try YYYY-MM-DD
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.isoformat()
        except Exception:
            continue

    return None

def gross_to_net(gross: float, vat_rate: float) -> float:
    if vat_rate <= 0:
        return float(gross)
    return float(gross) / (1.0 + float(vat_rate))

def net_to_gross(net: float, vat_rate: float) -> float:
    if vat_rate <= 0:
        return float(net)
    return float(net) * (1.0 + float(vat_rate))


def frac_to_bp(x: Optional[float]) -> Optional[int]:
    if x is None:
        return None
    return int(round(x * 10000))



async def run_flipcheck_engine(payload: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
    """
    Single source of truth: gleiche Logik wie /flipcheck.
    Returns: {"ok": True, "decision": "...", "rules": ..., "vat_mode": ..., "ebay": metrics}
    """

    require_beta_access(user)
    uid = str(user.get("sub") or "")
    if not uid:
        raise HTTPException(status_code=401, detail="Missing sub")

    profile = await sb_get_profile(uid)
    vat_mode, vat_rate = resolve_vat_mode(profile)

    # --- query support (ean OR keyword), backward compatible ---
    query = str(
        payload.get("query")
        or payload.get("ean")
        or payload.get("keyword")
        or ""
    ).strip()

    query_mode = str(payload.get("query_mode") or payload.get("type") or "").lower().strip()

    def _auto_mode(q: str | None) -> str:
        s = (q or "").strip()
        digits = re.sub(r"\D", "", s)
        if len(digits) in (8, 12, 13, 14):
            return "ean"
        return "keyword"

    mode_api = query_mode if query_mode in ("ean", "keyword") else _auto_mode(query)

    mode = (payload.get("mode") or "mid").lower()

    platform = str(payload.get("platform") or "ebay").lower().strip()
    if platform not in ("ebay", "kaufland"):
        raise HTTPException(status_code=400, detail="Invalid platform (ebay|kaufland)")


    PRESET_RULES = {
        "low":  {"min_profit": 2.0, "min_roi": 15.0, "min_sales_30d": 3},
        "mid":  {"min_profit": 4.0, "min_roi": 25.0, "min_sales_30d": 5},
        "high": {"min_profit": 7.0, "min_roi": 35.0, "min_sales_30d": 8},
    }
    active_rules = PRESET_RULES.get(mode, PRESET_RULES["mid"]).copy()

    custom = payload.get("custom")
    if mode == "custom" and isinstance(custom, dict):
        if custom.get("min_profit_eur") is not None:
            active_rules["min_profit"] = float(custom.get("min_profit_eur") or 0.0)
        if custom.get("min_roi_pct") is not None:
            active_rules["min_roi"] = float(custom.get("min_roi_pct") or 0.0)
        if custom.get("min_monthly_sales") is not None:
            active_rules["min_sales_30d"] = int(custom.get("min_monthly_sales") or 0)

    trends_day_range = payload.get("trends_day_range", None)
    try:
        trends_day_range = int(trends_day_range) if trends_day_range is not None else 30
    except Exception:
        trends_day_range = 30
    if trends_day_range not in (7, 30, 90, 180, 365):
        trends_day_range = 30

    if not query:
        raise HTTPException(status_code=400, detail="Missing query")

    if mode_api == "ean":
        query = re.sub(r"\D", "", query)
        if not query.isdigit():
            raise HTTPException(status_code=400, detail="Invalid ean")
    else:
        if len(query) < 3:
            raise HTTPException(status_code=400, detail="Keyword too short")

    # ek input
    try:
        ek_in = float(payload.get("ek"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ek")

    ek_is_net = bool(payload.get("ek_is_net") or payload.get("ek_net_input") or False)

    if vat_mode == "deduct" and ek_is_net:
        ek_net = float(ek_in)
        ek_gross = net_to_gross(float(ek_in), vat_rate)
    else:
        ek_gross = float(ek_in)
        ek_net = gross_to_net(float(ek_in), vat_rate) if vat_mode == "deduct" else float(ek_in)

    # shipping_out (gross input)
    shipping_out = (
        payload.get("shipping_out")
        or payload.get("shipping")
        or payload.get("shipping_cost")
        or payload.get("versand")
    )
    try:
        shipping_out_gross = float(shipping_out) if shipping_out is not None else 5.0
    except Exception:
        shipping_out_gross = 5.0

    sell_override = payload.get("sell_price")
    if sell_override is None:
        sell_override = payload.get("vk") or payload.get("vk_price") or payload.get("sell_price_override")

    try:
        sell_override = float(sell_override) if sell_override is not None else None
    except Exception:
        sell_override = None

    sell_is_net = bool(payload.get("sell_is_net") or payload.get("vk_is_net") or False)



    ship_net = gross_to_net(float(shipping_out_gross), vat_rate) if vat_mode == "deduct" else float(shipping_out_gross)

    # fees
    zero_fees_setting = bool(profile.get("ebay_zero_fees") or False)
    zero_fees = payload.get("ebay_zero_fees")
    if zero_fees is None:
        zero_fees = payload.get("zero_fees")
    if zero_fees is None:
        zero_fees = zero_fees_setting
    zero_fees = bool(zero_fees)

    category = payload.get("category") or payload.get("cat")
    has_shop = payload.get("has_shop")
    if has_shop is None:
        has_shop = True

    # --- eBay fee override support (frontend category mapping) ---
    fee_override = (
        payload.get("fee_pct")          # ✅ comes from frontend (0.11 or 11)
        or payload.get("ebay_fee_pct")
        or payload.get("fee")
    )

    def _norm_fee(x):
        if x is None:
            return None
        f = float(x)
        if f > 1.0:   # 11 -> 0.11
            f = f / 100.0
        return max(0.0, min(f, 0.30))   # safety cap

    fee_override = _norm_fee(fee_override)

    if zero_fees:
        fee_up_to_200 = 0.0
        fee_above_200 = 0.0
        _cap = None
    elif fee_override is not None:
        # ✅ force same fee for both tiers (what you want: 11% everywhere)
        fee_up_to_200 = fee_override
        fee_above_200 = fee_override
        _cap = None
    else:
        fee_up_to_200, fee_above_200, _cap = resolve_fee_tiers(category, bool(has_shop))


    # ===================== PLATFORM SWITCH =====================
    if platform == "kaufland":
        # MVP: nur EAN
        if mode_api != "ean":
            raise HTTPException(status_code=400, detail="Kaufland supports EAN only (for now)")

        # 1) Kaufland Market (Sell-Side)
        k = await lookup_kaufland_by_ean(query)  # query ist die EAN
        sell_gross = k.get("min_total_new")

        if sell_gross is None:
            return {
                "ok": True,                  # wichtig: damit Frontend nicht “random” macht
                "platform": "kaufland",
                "not_found": True,
                "decision": "NOT_FOUND",
                "who": uid,
                "input": payload,
                "kaufland": {"raw": k, "metrics": {}},
            }


        # sell_gross ist der Marktpreis von Kaufland (gross)
        sell_gross = float(sell_gross)

        # ✅ SELL OVERRIDE (Custom VK)
        sell_override = payload.get("sell_price") or payload.get("vk") or payload.get("sell_price_override")
        try:
            sell_override = float(sell_override) if sell_override is not None else None
        except Exception:
            sell_override = None

        sell_is_net = bool(payload.get("sell_is_net") or payload.get("vk_is_net") or False)

        # Marktpreis merken
        market_gross = sell_gross

        # Override anwenden (falls gesetzt)
        if sell_override is not None and sell_override > 0:
            if vat_mode == "deduct" and sell_is_net:
                sell_net = float(sell_override)
                sell_gross = net_to_gross(sell_net, vat_rate)
            else:
                sell_gross = float(sell_override)
                sell_net = gross_to_net(sell_gross, vat_rate) if vat_mode == "deduct" else sell_gross
            sell_source = "custom"
        else:
            sell_net = gross_to_net(sell_gross, vat_rate) if vat_mode == "deduct" else sell_gross
            sell_source = "market"


        # 2) Fees
        k_fee_pct, k_fee_fixed = resolve_kaufland_fees(profile, payload)

        # 3) VAT-consistent net calc
        
        fee_fixed_net = gross_to_net(k_fee_fixed, vat_rate) if vat_mode == "deduct" else k_fee_fixed
        fee_net = (sell_net * float(k_fee_pct)) + float(fee_fixed_net)

        # 4) Profit/ROI (net-basis wie eBay engine)
        profit = float(sell_net) - float(fee_net) - float(ek_net) - float(ship_net)
        denom = max(0.01, float(ek_net) + float(ship_net))
        roi = (profit / denom) * 100.0

        # 5) decision (OHNE sales gate, weil Kaufland keine sales_30d hat)
        if profit >= active_rules["min_profit"] and roi >= active_rules["min_roi"]:
            decision = "BUY"
        elif profit > 0:
            decision = "HOLD"
        else:
            decision = "SKIP"

        # 6) normalize output ähnlich ebay
        kaufland_metrics = {
            "sell_gross_avg": sell_gross,
            "sell_net_avg": sell_net,

            "market_price_gross": sell_gross,
            "market_price_net": sell_net,

            "min_total_new": k.get("min_total_new"),
            "min_price_new": k.get("min_price_new"),
            "min_shipping_new": k.get("min_shipping_new"),

            "best_offer": k.get("best_offer_new"),
            "bestseller": k.get("bestseller"),
            "demand_score": k.get("score"),
            "demand_label": k.get("label"),

            "sell_gross_avg": sell_gross,
            "sell_net_avg": sell_net,

            "market_price_gross": market_gross,
            "market_price_net": gross_to_net(market_gross, vat_rate) if vat_mode == "deduct" else market_gross,

            "sell_price_source": sell_source,


            "profit_cash_avg": round(profit, 2),
            "roi_cash_avg": round(roi, 2),
            "sales_30d": None,
            "offer_count": k.get("offers_count_new"),
            "days_to_cash": None,
            "inputs": {
                "platform": "kaufland",
                "query": query,
                "query_mode": mode_api,
                "fee_pct": float(k_fee_pct),
                "fee_fixed_eur": float(k_fee_fixed),
                "vat_mode": vat_mode,
                "vat_rate_used": vat_rate,
                "ek_net_used": round(float(ek_net), 2),
                "shipping_out_net_used": round(float(ship_net), 2),
                "ek_is_net_input": bool(ek_is_net),

            },
        }


        return {
            "ok": True,
            "platform": "kaufland",
            "decision": decision,
            "who": uid,
            "input": payload,
            "rules": active_rules,
            "vat_mode": vat_mode,
            "kaufland": {"raw": k, "metrics": kaufland_metrics},
        }
    # ===================== END PLATFORM SWITCH =====================


    # provider call (run in thread, damit batch parallel safe ist)
    metrics = await anyio.to_thread.run_sync(
        partial(
            lookup_ebay_metrics_query,
            query=query,
            mode=mode_api,
            ek_net=ek_net,
            shipping_out_net=ship_net,
            trends_day_range=trends_day_range,
            vat_rate=vat_rate,
            fee_up_to_200=fee_up_to_200,
            fee_above_200=fee_above_200,
            bad_words=(payload.get("bad_words") if isinstance(payload.get("bad_words"), list) else None),
        )
    )
    metrics = metrics or {}
    metrics.setdefault("inputs", {})
    metrics["inputs"]["query"] = query
    metrics["inputs"]["query_mode"] = mode_api

    if metrics.get("error"):
        return {"ok": False, "error": metrics["error"], "who": uid, "input": payload}

    # ensure net/gross outputs
    sell_gross = metrics.get("sell_gross_avg")
    sell_net = metrics.get("sell_net_avg")
    if sell_net is None and sell_gross is not None:
        sell_net = gross_to_net(float(sell_gross), vat_rate) if vat_mode == "deduct" else float(sell_gross)
    if sell_gross is None and sell_net is not None:
        sell_gross = net_to_gross(float(sell_net), vat_rate) if vat_mode == "deduct" else float(sell_net)
    metrics["sell_gross_avg"] = sell_gross
    metrics["sell_net_avg"] = sell_net

    if metrics.get("sell_gross_median") is not None and metrics.get("sell_net_median") is None:
        metrics["sell_net_median"] = gross_to_net(float(metrics["sell_gross_median"]), vat_rate) if vat_mode == "deduct" else float(metrics["sell_gross_median"])
    if metrics.get("sell_gross_median") is None:
        metrics["sell_gross_median"] = sell_gross
        metrics["sell_net_median"] = sell_net

    # ✅ SELL OVERRIDE (custom VK)
    if sell_override is not None and sell_override > 0:
        if vat_mode == "deduct" and sell_is_net:
            sell_net = float(sell_override)
            sell_gross = net_to_gross(sell_net, vat_rate)
        else:
            sell_gross = float(sell_override)
            sell_net = gross_to_net(sell_gross, vat_rate) if vat_mode == "deduct" else sell_gross

        # überschreibe die “market”-values, ABER behalte original als market_price
        metrics["market_price_gross"] = metrics.get("market_price_gross") or metrics.get("sell_gross_avg")
        metrics["market_price_net"]   = metrics.get("market_price_net")   or metrics.get("sell_net_avg")

        metrics["sell_gross_avg"] = sell_gross
        metrics["sell_net_avg"]   = sell_net
        metrics["sell_price_source"] = "custom"
    else:
        metrics["sell_price_source"] = "market"
        metrics["market_price_gross"] = metrics.get("market_price_gross") or metrics.get("sell_gross_avg")
        metrics["market_price_net"]   = metrics.get("market_price_net")   or metrics.get("sell_net_avg")

    fee_net = ebay_fee_net(float(sell_net or 0.0), float(fee_up_to_200), float(fee_above_200))
    profit = float(sell_net or 0.0) - float(fee_net) - float(ek_net) - float(ship_net)
    denom = max(0.01, float(ek_net) + float(ship_net))
    roi = (profit / denom) * 100.0

    metrics["fee_net_est"] = round(fee_net, 2)
    metrics["profit_cash_avg"] = round(profit, 2)
    metrics["roi_cash_avg"] = round(roi, 2)


    profit = float(metrics.get("profit_cash_avg") or 0.0)
    roi = float(metrics.get("roi_cash_avg") or 0.0)

    # sales + offer_count + days_to_cash normalize
    offer_count = metrics.get("offer_count") or (metrics.get("debug") or {}).get("offer_count")
    try:
        offer_count = int(offer_count) if offer_count is not None else None
    except Exception:
        offer_count = None

    sales_30d = metrics.get("sales_30d")
    try:
        sales_30d_int = int(sales_30d) if sales_30d is not None else None
    except Exception:
        sales_30d_int = None

    if metrics.get("days_to_cash") is None and offer_count is not None and sales_30d_int is not None:
        metrics["days_to_cash"] = calc_days_to_cash(offer_count, sales_30d_int)

    metrics["offer_count"] = offer_count
    metrics["sales_30d"] = sales_30d_int if sales_30d_int is not None else sales_30d

    # decision
    min_sales = int(active_rules["min_sales_30d"])
    sales_ok = (sales_30d_int is not None) and (sales_30d_int >= min_sales)

    if profit >= active_rules["min_profit"] and roi >= active_rules["min_roi"] and sales_ok:
        decision = "BUY"
    elif profit > 0:
        decision = "HOLD"
    else:
        decision = "SKIP"

    metrics.setdefault("inputs", {})
    metrics["inputs"]["vat_mode"] = vat_mode
    metrics["inputs"]["vat_rate_used"] = vat_rate
    metrics["inputs"]["ek_net_used"] = round(float(ek_net), 2)
    metrics["inputs"]["shipping_out_net_used"] = round(float(ship_net), 2)
    metrics["inputs"]["ek_gross_input"] = round(float(ek_gross), 2)
    metrics["inputs"]["shipping_out_gross_input"] = round(float(shipping_out_gross), 2)
    metrics["inputs"]["fee_up_to_200"] = float(fee_up_to_200)
    metrics["inputs"]["fee_above_200"] = float(fee_above_200)
    metrics["inputs"]["ebay_zero_fees_effective"] = bool(zero_fees)
    metrics["inputs"]["ek_is_net_input"] = bool(ek_is_net)


    return {
        "ok": True,
        "platform": "ebay",
        "decision": decision,
        "who": uid,
        "input": payload,
        "rules": active_rules,
        "vat_mode": vat_mode,
        "ebay": metrics,
    }



@app.post("/inventory/add")
async def inventory_add(body: AddInventoryItemIn, user=Depends(require_device)):
    require_beta_access(user)

    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    purchased_at = parse_iso_dt(body.purchased_at) or datetime.now(timezone.utc).isoformat()
    purchase_date = purchased_at[:10]

    # ✅ base row (NO ifs inside)
    row = {
        "user_id": user_id,
        "identifier_type": body.identifier_type,
        "identifier": body.identifier.strip(),
        "title": (body.title.strip() if body.title else None),

        "buy_price_cents": eur_to_cents(body.buy_price_eur),
        "shipping_cost_cents": eur_to_cents(body.shipping_cost_eur),
        "shipping_out_cents": eur_to_cents(float(body.shipping_out_eur or 5.0)),

        "quantity": body.quantity,
        "currency": body.currency,
        "condition": body.condition,

        "source": body.source,
        "notes": body.notes,
        "purchased_at": purchased_at,
        "purchase_date": purchase_date,

        "market": (body.market or "ebay").lower().strip(),
        "category": (body.category.strip() if body.category else None),

        "store_key": (body.store_key.strip().lower() if body.store_key else None),
        "store_name": (body.store_name.strip() if body.store_name else None),
        "return_days": body.return_days,

        "kaufland_category": (body.kaufland_category.strip() if body.kaufland_category else None),

        # targets (only once)
        "target_margin_bp": frac_to_bp(getattr(body, "target_margin", None)),
        "target_roi_bp": frac_to_bp(getattr(body, "target_roi", None)),
    }

    # ✅ optional fee passthrough (if provided)
    if body.fee_pct_bp is not None:
        row["fee_pct_bp"] = int(body.fee_pct_bp)
    if body.fee_fixed_cents is not None:
        row["fee_fixed_cents"] = int(body.fee_fixed_cents)

    # ✅ auto-fill Kaufland fee defaults if item is Kaufland and fee missing
    if row["market"] == "kaufland" and row.get("fee_pct_bp") is None:
        cat = row.get("kaufland_category") or "kl_other"
        pct, fixed = KAUFLAND_FEE_BY_KEY.get(cat, KAUFLAND_FEE_BY_KEY["kl_other"])
        row["fee_pct_bp"] = int(round(pct * 10000))
        row["fee_fixed_cents"] = int(round(fixed * 100))

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{SUPABASE_URL}/rest/v1/inventory_items",
            headers={**SB_HEADERS, "Prefer": "return=representation"},
            json=row,
        )

    if r.status_code >= 300:
        raise HTTPException(status_code=500, detail=f"supabase:{r.status_code}:{r.text}")

    return {"ok": True, "item": r.json()[0]}


from typing import List
import asyncio

# ----------------- Inventory Models -----------------
class InventoryListOut(BaseModel):
    ok: bool
    items: list

class UpdateQtyIn(BaseModel):
    id: str
    quantity: int = Field(ge=1, le=100000)

class CheckPricesIn(BaseModel):
    ids: Optional[List[str]] = None  # wenn None -> alle
    vat_mode: Optional[Literal["gross", "deduct"]] = None
    ebay_zero_fees: Optional[bool] = None


def cents_to_eur(c: Optional[int]) -> Optional[float]:
    if c is None:
        return None
    return round(c / 100.0, 2)

def bp_to_pct(bp: Optional[int]) -> Optional[float]:
    if bp is None:
        return None
    return round(bp / 100.0, 2)  # 100bp = 1.00%

# ----------------- Helpers: Supabase -----------------
async def sb_get_inventory(user_id: str, limit: int = 200) -> list:
    url = f"{SUPABASE_URL}/rest/v1/inventory_items"
    params = {
        "user_id": f"eq.{user_id}",
        "select": (
            "id,identifier_type,identifier,title,"
            "buy_price_cents,shipping_cost_cents,shipping_out_cents,"
            "quantity,currency,"
            "market,category,store_key,store_name,return_days,return_deadline,"
            "kaufland_category,fee_pct_bp,fee_fixed_cents,"
            "last_market_price_cents,last_checked_at,last_delta_bp,updated_at,"
            "last_sales_30d,last_sales_30d_updated_at,"
            "last_kaufland_offer_count,last_kaufland_demand_score,last_kaufland_demand_label,last_kaufland_bestseller,"
            "purchased_at,purchase_date"
        ),

        "limit": str(limit),
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, headers=SB_HEADERS, params=params)
        if r.status_code >= 300:
            raise HTTPException(status_code=500, detail=f"supabase_list_failed:{r.status_code}:{r.text}")
        return r.json()

async def sb_patch_inventory_item(user_id: str, item_id: str, patch: Dict[str, Any]) -> dict:
    url = f"{SUPABASE_URL}/rest/v1/inventory_items"
    params = {"id": f"eq.{item_id}", "user_id": f"eq.{user_id}"}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.patch(
            url,
            headers={**SB_HEADERS, "Prefer": "return=representation"},
            params=params,
            json=patch
        )
        if r.status_code >= 300:
            raise HTTPException(status_code=500, detail=f"supabase_patch_failed:{r.status_code}:{r.text}")
        arr = r.json()
        return arr[0] if arr else {}

async def sb_save_profile(user_id: str, patch: Dict[str, Any]) -> dict:
    url = f"{SUPABASE_URL}/rest/v1/profiles"
    row = {"user_id": user_id, **patch}

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            url,
            headers={**SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"},
            json=row,
        )
    if r.status_code >= 300:
        raise HTTPException(status_code=500, detail=f"profile_upsert_failed:{r.status_code}:{r.text}")
    arr = r.json()
    return arr[0] if arr else row


async def sb_get_profile(user_id: str) -> dict:
    url = f"{SUPABASE_URL}/rest/v1/profiles"
    params = {
        "user_id": f"eq.{user_id}",
        "select": "user_id,plan,device_limit,role,beta_whitelist,vat_status,vat_rate,fee,weekly_profit_target,weekly_purchase_target,weekly_units_target,min_profit,min_roi,min_sales_30d,ebay_zero_fees",
        "limit": "1",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SB_HEADERS, params=params)
        if r.status_code >= 300:
            raise HTTPException(status_code=500, detail=f"profile_read_failed:{r.status_code}:{r.text}")
        arr = r.json()
        return arr[0] if arr else {}

import base64
import secrets
from urllib.parse import urlencode

EBAY_CLIENT_ID = os.getenv("EBAY_CLIENT_ID","").strip()
EBAY_CLIENT_SECRET = os.getenv("EBAY_CLIENT_SECRET","").strip()
EBAY_REDIRECT_URI = os.getenv("EBAY_REDIRECT_URI","").strip()
EBAY_OAUTH_SCOPE = " ".join([
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
])

EBAY_OAUTH_SCOPE = " ".join(EBAY_OAUTH_SCOPE.split())  # kills newlines/tabs/doublespaces


def _basic_auth_header(client_id: str, client_secret: str) -> str:
    raw = f"{client_id}:{client_secret}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")

def _ebay_authorize_url(state: str) -> str:
    q = {
        "client_id": EBAY_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": EBAY_REDIRECT_URI,
        "scope": EBAY_OAUTH_SCOPE,
        "state": state,
    }
    return "https://auth.ebay.com/oauth2/authorize?" + urlencode(q)

EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"

async def sb_get_ebay_conn(user_id: str) -> dict | None:
    url = f"{SUPABASE_URL}/rest/v1/ebay_connections"
    params = {"user_id": f"eq.{user_id}", "select": "*", "limit": "1"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SB_HEADERS, params=params)
        if r.status_code >= 300:
            raise HTTPException(status_code=500, detail=f"ebay_conn_read_failed:{r.status_code}:{r.text}")
        arr = r.json()
        return arr[0] if arr else None

async def sb_upsert_ebay_conn(user_id: str, patch: dict) -> dict:
    url = f"{SUPABASE_URL}/rest/v1/ebay_connections"
    row = {"user_id": user_id, **patch}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            url,
            headers={**SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"},
            json=row,
        )
        if r.status_code >= 300:
            raise HTTPException(status_code=500, detail=f"ebay_conn_upsert_failed:{r.status_code}:{r.text}")
        arr = r.json()
        return arr[0] if arr else row

async def sb_delete_ebay_conn(user_id: str) -> None:
    url = f"{SUPABASE_URL}/rest/v1/ebay_connections"
    params = {"user_id": f"eq.{user_id}"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.delete(url, headers=SB_HEADERS, params=params)
    if r.status_code not in (200,204):
        raise HTTPException(status_code=500, detail=f"ebay_conn_delete_failed:{r.status_code}:{r.text}")

def _parse_ts(s: str | None) -> datetime | None:
    if not s: return None
    try:
        return datetime.fromisoformat(str(s).replace("Z","+00:00"))
    except Exception:
        return None

async def ebay_exchange_code_for_tokens(code: str) -> dict:
    headers = {
        "Authorization": _basic_auth_header(EBAY_CLIENT_ID, EBAY_CLIENT_SECRET),
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": EBAY_REDIRECT_URI,
    }
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.post(EBAY_TOKEN_URL, data=data, headers=headers)
        if r.status_code >= 300:
            raise HTTPException(status_code=401, detail=f"ebay_token_exchange_failed:{r.status_code}:{r.text}")
        return r.json()

async def ebay_refresh_token(refresh_token: str) -> dict:
    headers = {
        "Authorization": _basic_auth_header(EBAY_CLIENT_ID, EBAY_CLIENT_SECRET),
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "scope": EBAY_OAUTH_SCOPE,
    }
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.post(EBAY_TOKEN_URL, data=data, headers=headers)
        if r.status_code >= 300:
            raise HTTPException(status_code=401, detail=f"ebay_refresh_failed:{r.status_code}:{r.text}")
        return r.json()

async def ebay_get_access_token(user_id: str) -> str:
    conn = await sb_get_ebay_conn(user_id)
    if not conn:
        raise HTTPException(status_code=401, detail="ebay_not_connected")

    exp = _parse_ts(conn.get("expires_at"))
    if not exp or exp <= datetime.now(timezone.utc) + timedelta(minutes=2):
        j = await ebay_refresh_token(conn.get("refresh_token"))
        access_token = j.get("access_token")
        expires_in = int(j.get("expires_in") or 7200)
        patch = {
            "access_token": access_token,
            "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat(),
        }
        if j.get("refresh_token"):
            patch["refresh_token"] = j["refresh_token"]
        if j.get("scope"):
            patch["scope"] = j["scope"]
        await sb_upsert_ebay_conn(user_id, patch)
        return access_token

    return conn.get("access_token")

def _pick_digits_gtin(x: str | None) -> str | None:
    if not x:
        return None
    digits = re.sub(r"\D", "", str(x))
    if len(digits) in (8, 12, 13, 14):
        return digits
    return None

def _extract_ean_from_inventory_item(obj: dict) -> str | None:
    # robust: versucht mehrere mögliche Stellen
    prod = obj.get("product") or {}
    # 1) productIdentifiers
    for pi in (prod.get("productIdentifiers") or []):
        v = _pick_digits_gtin(pi.get("identifierValue") or pi.get("value"))
        if v:
            return v

    # 2) aspects: oft UPC/EAN/GTIN drin
    aspects = prod.get("aspects") or {}
    for key in ("EAN", "GTIN", "UPC", "ISBN", "Barcode", "barcodes"):
        val = aspects.get(key)
        if isinstance(val, list) and val:
            v = _pick_digits_gtin(val[0])
            if v:
                return v
        if isinstance(val, str):
            v = _pick_digits_gtin(val)
            if v:
                return v

    # 3) top-level sometimes
    for k in ("ean", "gtin", "upc", "isbn"):
        v = _pick_digits_gtin(obj.get(k))
        if v:
            return v

    return None

async def ebay_list_skus(access_token: str, limit: int = 200) -> list[str]:
    # eBay Inventory API: getInventoryItems -> returns skus
    url = "https://api.ebay.com/sell/inventory/v1/inventory_item"
    headers = {"Authorization": f"Bearer {access_token}"}
    skus: list[str] = []
    offset = 0

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            r = await client.get(url, headers=headers, params={"limit": limit, "offset": offset})
            if r.status_code >= 300:
                raise HTTPException(status_code=502, detail=f"ebay_inventory_list_failed:{r.status_code}:{r.text}")
            j = r.json() or {}
            for it in (j.get("inventoryItems") or []):
                sku = (it.get("sku") or "").strip()
                if sku:
                    skus.append(sku)

            total = int(j.get("total") or 0)
            offset += limit
            if offset >= total or not (j.get("inventoryItems") or []):
                break

    return skus

from urllib.parse import quote

async def ebay_get_inventory_item(access_token: str, sku: str) -> dict:
    url = f"https://api.ebay.com/sell/inventory/v1/inventory_item/{quote(sku, safe='')}"
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=headers)
        if r.status_code >= 300:
            # sku kann auch mal invalid sein → skip, kein hard crash
            return {"_error": f"{r.status_code}:{r.text}"}
        return r.json() or {}

async def sb_upsert_inventory_row(row: dict) -> None:
    # Upsert per unique indexes (user_id + ebay_item_id / sku)
    url = f"{SUPABASE_URL}/rest/v1/inventory_items"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            url,
            headers={**SB_HEADERS, "Prefer": "resolution=merge-duplicates"},
            json=row,
        )
        if r.status_code not in (200, 201, 204):
            raise HTTPException(status_code=500, detail=f"supabase_inventory_upsert_failed:{r.status_code}:{r.text}")

@app.post("/ebay/sync_listings")
async def ebay_sync_listings(user=Depends(require_device)):
    require_beta_access(user)
    uid = str(user.get("sub") or "")
    if not uid:
        raise HTTPException(status_code=401, detail="Missing sub")

    access_token = await ebay_get_access_token(uid)
    skus = await ebay_list_skus(access_token)

    sem = asyncio.Semaphore(8)
    inserted = 0
    updated = 0
    skipped = 0

    async def one(sku: str):
        nonlocal inserted, updated, skipped

        async with sem:
            obj = await ebay_get_inventory_item(access_token, sku)
            if obj.get("_error"):
                skipped += 1
                return

            # Title
            prod = obj.get("product") or {}
            title = (prod.get("title") or "").strip()

            # Qty
            avail = (obj.get("availability") or {}).get("shipToLocationAvailability") or {}
            qty = avail.get("quantity")
            try:
                qty = int(qty) if qty is not None else 1
                qty = max(1, min(qty, 100000))
            except Exception:
                qty = 1

            # eBay itemId (nicht immer vorhanden – aber wenn, dann speichern)
            ebay_item_id = (
                str(obj.get("itemId") or obj.get("item_id") or "").strip()
            ) or None

            ean = _extract_ean_from_inventory_item(obj)

            # Identifier strategy:
            # - wenn EAN da -> identifier_type=EAN (für price-check engine)
            # - sonst -> identifier_type=TITLE, identifier=sku (stabil)
            identifier_type = "EAN" if ean else "TITLE"
            identifier = ean if ean else sku

            row = {
                "user_id": uid,
                "identifier_type": identifier_type,
                "identifier": identifier,
                "title": title or None,

                # EK unknown -> 0
                "buy_price_cents": 0,
                "shipping_cost_cents": 0,
                "shipping_out_cents": 500,

                "quantity": qty,
                "currency": "EUR",
                "market": "ebay",
                "store_key": "ebay",
                "store_name": "eBay",
                "source": "ebay_sync",
                "purchased_at": datetime.now(timezone.utc).isoformat(),
                "purchase_date": datetime.now(timezone.utc).date().isoformat(),

                # new columns
                "sku": sku,
                "ebay_item_id": ebay_item_id,
            }

            # upsert
            await sb_upsert_inventory_row(row)

            # wir wissen nicht sicher ob insert/update -> zählt grob:
            # (wenn du exakt willst, machen wir vorher lookup per SB REST)
            updated += 1

    await asyncio.gather(*[one(s) for s in skus[:2000]])  # safety cap (kannst du rausnehmen)

    return {"ok": True, "skus": len(skus), "updated": updated, "inserted": inserted, "skipped": skipped}



def resolve_vat_mode(profile: dict) -> tuple[str, float]:
    vat_status = (profile.get("vat_status") or "SMALL").upper()
    raw_rate = profile.get("vat_rate")

    vat_rate = 0.0 if vat_status != "VAT" else 0.19
    try:
        if raw_rate is not None:
            vat_rate = float(raw_rate)
    except Exception:
        pass

    if vat_rate > 1.0:
        vat_rate = vat_rate / 100.0

    if vat_status == "VAT":
        return ("deduct", vat_rate)
    return ("gross", 0.0)






async def sb_get_inventory_by_ids(user_id: str, ids: List[str]) -> list:
    if not ids:
        return []
    url = f"{SUPABASE_URL}/rest/v1/inventory_items"
    # Supabase REST: id=in.(a,b,c)
    ids_csv = ",".join(ids)
    params = {
        "user_id": f"eq.{user_id}",
        "id": f"in.({ids_csv})",
        "select": (
            "id,identifier_type,identifier,title,"
            "buy_price_cents,shipping_cost_cents,shipping_out_cents,"
            "quantity,currency,"
            "market,category,store_key,store_name,return_days,return_deadline,"
            "kaufland_category,fee_pct_bp,fee_fixed_cents,"
            "last_market_price_cents,last_checked_at,last_delta_bp,updated_at,"
            "last_sales_30d,last_sales_30d_updated_at,"
            "last_kaufland_offer_count,last_kaufland_demand_score,last_kaufland_demand_label,last_kaufland_bestseller,"
            "purchased_at,purchase_date"
        ),

        "limit": str(min(500, max(1, len(ids)))),
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, headers=SB_HEADERS, params=params)
        if r.status_code >= 300:
            raise HTTPException(status_code=500, detail=f"supabase_get_by_ids_failed:{r.status_code}:{r.text}")
        return r.json()

# ----------------- Stores (Presets) -----------------

async def sb_list_stores(user_id: str) -> list:
    url = f"{SUPABASE_URL}/rest/v1/store_presets"
    params = {
        "user_id": f"eq.{user_id}",
        "select": "store_key,store_name,return_days,notes,updated_at",
        "order": "store_name.asc",
        "limit": "200",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SB_HEADERS, params=params)
        if r.status_code >= 300:
            raise HTTPException(status_code=500, detail=f"stores_list_failed:{r.status_code}:{r.text}")
        return r.json()

async def sb_upsert_store(user_id: str, store_key: str, store_name: str, return_days: int, notes: str | None = None) -> dict:
    url = f"{SUPABASE_URL}/rest/v1/store_presets"
    payload = {
        "user_id": user_id,
        "store_key": store_key,
        "store_name": store_name,
        "return_days": int(return_days),
        "notes": notes,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            url,
            headers={**SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"},
            json=payload,
        )
    if r.status_code >= 300:
        raise HTTPException(status_code=500, detail=f"stores_upsert_failed:{r.status_code}:{r.text}")
    arr = r.json()
    return arr[0] if arr else payload

async def sb_delete_store(user_id: str, store_key: str) -> None:
    url = f"{SUPABASE_URL}/rest/v1/store_presets"
    params = {"user_id": f"eq.{user_id}", "store_key": f"eq.{store_key}"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.delete(url, headers=SB_HEADERS, params=params)
    if r.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"stores_delete_failed:{r.status_code}:{r.text}")


async def sb_get_inventory_by_skus(uid: str, skus: list[str]) -> dict[str, dict]:
    if not skus:
        return {}
    # Supabase: sku=in.(a,b,c)
    # Achtung: commas in SKUs -> selten, but safe:
    safe = [s.replace(",", "") for s in skus if s]
    if not safe:
        return {}
    url = f"{SUPABASE_URL}/rest/v1/inventory_items"
    params = {
        "user_id": f"eq.{uid}",
        "sku": f"in.({','.join(safe[:500])})",
        "select": "id,sku,ebay_item_id,buy_price_cents,shipping_out_cents",
        "limit": "500",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, headers=SB_HEADERS, params=params)
        if r.status_code >= 300:
            raise HTTPException(status_code=500, detail=f"inv_by_sku_failed:{r.status_code}:{r.text}")
        arr = r.json()
    out = {}
    for it in arr:
        k = (it.get("sku") or "").strip()
        if k:
            out[k] = it
    return out

async def sb_upsert_ebay_order(uid: str, row: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/ebay_orders"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            url,
            headers={**SB_HEADERS, "Prefer": "resolution=merge-duplicates"},
            json={**row, "user_id": uid},
        )
        if r.status_code not in (200, 201, 204):
            raise HTTPException(status_code=500, detail=f"ebay_orders_upsert_failed:{r.status_code}:{r.text}")

async def sb_upsert_ebay_line(uid: str, row: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/ebay_order_lines"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            url,
            headers={**SB_HEADERS, "Prefer": "resolution=merge-duplicates"},
            json={**row, "user_id": uid},
        )
        if r.status_code not in (200, 201, 204):
            raise HTTPException(status_code=500, detail=f"ebay_lines_upsert_failed:{r.status_code}:{r.text}")

def _cents(x: float | int | None) -> int:
    try:
        if x is None:
            return 0
        return int(round(float(x) * 100))
    except Exception:
        return 0

async def sb_get_inventory_item_by_id(user_id: str, item_id: str) -> dict | None:
    url = f"{SUPABASE_URL}/rest/v1/inventory_items"
    params = {
        "user_id": f"eq.{user_id}",
        "id": f"eq.{item_id}",
        "select": "id,sku,ebay_item_id,buy_price_cents,shipping_out_cents",
        "limit": "1",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SB_HEADERS, params=params)
        if r.status_code >= 300:
            raise HTTPException(status_code=500, detail=f"inv_item_read_failed:{r.status_code}:{r.text}")
        arr = r.json()
        return arr[0] if arr else None

async def sb_backfill_ebay_lines_for_sku(user_id: str, sku: str, ek_cents: int, ship_out_cents: int):
    # 1) hol alle lines für sku wo ek_cents is null
    url = f"{SUPABASE_URL}/rest/v1/ebay_order_lines"
    params = {
        "user_id": f"eq.{user_id}",
        "sku": f"eq.{sku}",
        "ek_cents": "is.null",
        "select": "id,sold_gross_cents,fees_gross_cents,ship_out_cents",
        "limit": "2000",
    }

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, headers=SB_HEADERS, params=params)
        if r.status_code >= 300:
            raise HTTPException(status_code=500, detail=f"ebay_lines_read_failed:{r.status_code}:{r.text}")
        lines = r.json() or []

    # 2) update jede line: ek + profit
    async with httpx.AsyncClient(timeout=20) as client:
        for li in lines:
            line_id = li.get("id")
            sold = int(li.get("sold_gross_cents") or 0)
            fees = int(li.get("fees_gross_cents") or 0)
            ship = int(li.get("ship_out_cents") or ship_out_cents or 0)

            profit = sold - fees - ship - ek_cents

            patch = {
                "ek_cents": int(ek_cents),
                "ship_out_cents": int(ship),
                "profit_cents": int(profit),
            }

            r2 = await client.patch(
                f"{SUPABASE_URL}/rest/v1/ebay_order_lines",
                headers={**SB_HEADERS, "Prefer":"return=minimal"},
                params={"id": f"eq.{line_id}", "user_id": f"eq.{user_id}"},
                json=patch
            )
            if r2.status_code >= 300:
                raise HTTPException(status_code=500, detail=f"ebay_line_patch_failed:{r2.status_code}:{r2.text}")

    return len(lines)


async def ebay_get_orders(access_token: str, since_iso: str) -> list[dict]:
    # Fulfillment API
    url = "https://api.ebay.com/sell/fulfillment/v1/order"
    headers = {"Authorization": f"Bearer {access_token}"}

    # filter format is strict; we'll use "lastmodifieddate:[start..]"
    # Use now in UTC
    now_iso = datetime.now(timezone.utc).isoformat()

    params = {
        "filter": f"lastmodifieddate:[{since_iso}..{now_iso}]",
        "limit": "50",
        "offset": "0",
    }

    orders = []
    async with httpx.AsyncClient(timeout=30) as client:
        offset = 0
        while True:
            params["offset"] = str(offset)
            r = await client.get(url, headers=headers, params=params)
            if r.status_code >= 300:
                raise HTTPException(status_code=502, detail=f"ebay_get_orders_failed:{r.status_code}:{r.text}")
            j = r.json() or {}
            batch = j.get("orders") or []
            orders.extend(batch)

            total = int(j.get("total") or 0)
            offset += int(params["limit"])
            if offset >= total or not batch:
                break

    return orders

async def ebay_get_finance_transactions(access_token: str, order_id: str) -> dict:
    url = "https://api.ebay.com/sell/finances/v1/transaction"
    headers = {"Authorization": f"Bearer {access_token}"}
    params = {"filter": f"orderId:{order_id}", "limit": "200", "offset": "0"}
    out = []
    async with httpx.AsyncClient(timeout=30) as client:
        offset = 0
        while True:
            params["offset"] = str(offset)
            r = await client.get(url, headers=headers, params=params)
            if r.status_code >= 300:
                raise HTTPException(status_code=502, detail=f"ebay_finances_failed:{r.status_code}:{r.text}")
            j = r.json() or {}
            tx = j.get("transactions") or []
            out.extend(tx)
            total = int(j.get("total") or 0)
            offset += int(params["limit"])
            if offset >= total or not tx:
                break
    return {"transactions": out}

def sum_order_fees_from_transactions(fin: dict) -> int:
    """
    Summiert Fee-ähnliche Transaktionen (gross, in cents).
    eBay Finances liefert unterschiedliche Strukturen – wir picken robust.
    """
    total = 0
    for tx in (fin.get("transactions") or []):
        # transactionType ist je nach response vorhanden
        ttype = (tx.get("transactionType") or tx.get("type") or "").upper()

        # amount Struktur: { value, currency }
        amt = tx.get("amount") or tx.get("transactionAmount") or {}
        val = amt.get("value")

        # fallback: manchmal direkt amount.value
        if val is None and isinstance(amt, dict):
            val = amt.get("amount", {}).get("value")

        cents = _cents(val)

        # Heuristik: Fees sind oft negative amounts oder haben "FEE" im type
        if "FEE" in ttype or "FINAL_VALUE" in ttype or "PROMOTED" in ttype or "AD" in ttype:
            total += abs(cents)
            continue

        # Wenn amount negativ ist, ebenfalls als Fee zählen (robust)
        try:
            if val is not None and float(val) < 0:
                total += abs(cents)
        except Exception:
            pass

    return int(total)



# ----------------- Routes: List / Update Qty / Check Prices -----------------
from math import ceil

def safe_int(x, default=0):
    try:
        return int(x)
    except Exception:
        return default

from fastapi.concurrency import run_in_threadpool
from services.api.ebay_fee_rules import resolve_fee_tiers

@app.get("/inventory/list")
async def inventory_list(user=Depends(require_device)):
    require_beta_access(user)
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    # ✅ 1:1 wie /flipcheck: profile + vat
    profile = await sb_get_profile(user_id)
    vat_mode, vat_rate = resolve_vat_mode(profile)

    # ✅ 1:1 wie /flipcheck: fees settings
    zero_fees_setting = bool(profile.get("ebay_zero_fees") or False)
    fee_pct = float(profile.get("fee") or 12) / 100.0  # 12 -> 0.12

    items = await sb_get_inventory(user_id, limit=300)

    def safe_int(x, default=0):
        try:
            return int(x)
        except Exception:
            return default

    out = []

    for it in items:
        identifier = (it.get("identifier") or "").strip()
        identifier_type = (it.get("identifier_type") or "").strip().lower()
        market = (it.get("market") or "ebay").lower().strip()

        mode_api = "ean" if identifier_type in ("ean", "gtin", "barcode") else "keyword"

        # DB fallback
        sales_30d_db = safe_int(it.get("last_sales_30d") or 0)

        # EK gross input: buy + shipping_in
        ek_gross = (cents_to_eur(it.get("buy_price_cents")) or 0.0) + (cents_to_eur(it.get("shipping_cost_cents")) or 0.0)
        ek_net = gross_to_net(float(ek_gross), vat_rate) if vat_mode == "deduct" else float(ek_gross)

        # shipping_out from DB
        shipping_out_gross = cents_to_eur(it.get("shipping_out_cents")) or 0.0
        ship_net = gross_to_net(float(shipping_out_gross), vat_rate) if vat_mode == "deduct" else float(shipping_out_gross)

        # return deadline ALWAYS compute (avoid undefined)
        return_deadline = None
        try:
            rd = it.get("return_days")
            pa = it.get("purchased_at")
            if rd is not None and pa:
                dt = datetime.fromisoformat(str(pa).replace("Z","+00:00"))
                return_deadline = (dt + timedelta(days=int(rd))).date().isoformat()
        except Exception:
            return_deadline = None

        # defaults
        sales_30d = sales_30d_db
        offer_count = None
        days_to_cash = None

        # -------------------------
        # MARKET SWITCH
        # -------------------------
        if identifier:
            if market == "kaufland":
                # ✅ Kaufland metrics (no sales/dtc)
                k = await anyio.to_thread.run_sync(partial(check_ean, identifier))
                print("KAUFLAND_KEYS:", list((k or {}).keys()))
                k = k or {}

                sell_gross = k.get("min_total_new")
                if sell_gross is not None:
                    try:
                        sell_gross = float(sell_gross)
                    except Exception:
                        sell_gross = None

                offer_count = safe_int(k.get("offers_count_new"), 0)

                # cache-like fields (UI can show them directly)
                kaufland_offer_count = offer_count
                def _pick(*vals):
                    for v in vals:
                        if v is None:
                            continue
                        return v
                    return None

                kaufland_demand_score = _pick(
                    k.get("score"),
                    k.get("demand_score"),
                    (k.get("demand") or {}).get("score"),
                    (k.get("metrics") or {}).get("score"),
                )

                kaufland_bestseller = _pick(
                    k.get("bestseller"),
                    k.get("is_bestseller"),
                    k.get("bestSeller"),
                    (k.get("metrics") or {}).get("bestseller"),
                )

                kaufland_demand_label = _pick(
                    k.get("label"),
                    k.get("demand_label"),
                    (k.get("demand") or {}).get("label"),
                    (k.get("metrics") or {}).get("label"),
                )


                out.append({
                    "id": it.get("id"),
                    "identifier_type": it.get("identifier_type"),
                    "identifier": it.get("identifier"),
                    "title": it.get("title") or "",
                    "buy_price_eur": cents_to_eur(it.get("buy_price_cents")) or 0.0,
                    "shipping_cost_eur": cents_to_eur(it.get("shipping_cost_cents")) or 0.0,
                    "quantity": it.get("quantity") or 1,
                    "currency": it.get("currency") or "EUR",
                    "last_checked_at": it.get("last_checked_at"),
                    "last_market_price_eur": sell_gross,  # ✅ Kaufland market price
                    "delta_pct": bp_to_pct(it.get("last_delta_bp")),
                    "updated_at": it.get("updated_at"),
                    "purchase_date": it.get("purchase_date"),
                    "purchased_at": it.get("purchased_at"),

                    # eBay-only fields null
                    "ms": None,
                    "days_to_cash": None,

                    # shared
                    "offer_count": offer_count,
                    "market": "kaufland",
                    "category": it.get("category"),
                    "store_key": it.get("store_key"),
                    "store_name": it.get("store_name"),
                    "return_days": it.get("return_days"),
                    "return_deadline": return_deadline,
                    "shipping_out_eur": cents_to_eur(it.get("shipping_out_cents")),

                    "kaufland_category": it.get("kaufland_category"),
                    "fee_pct_bp": it.get("fee_pct_bp"),
                    "fee_fixed_cents": it.get("fee_fixed_cents"),

                    # cached kaufland metrics
                    "kaufland_offer_count": kaufland_offer_count,
                    "kaufland_demand_score": kaufland_demand_score,
                    "kaufland_bestseller": kaufland_bestseller,
                    "kaufland_demand_label": kaufland_demand_label,

                })
                continue

            # ✅ eBay default
            zero_fees = bool(zero_fees_setting)
            category = it.get("category")  # now actually use stored category
            has_shop = True

            if zero_fees:
                fee_up_to_200 = 0.0
                fee_above_200 = 0.0
            else:
                fee_up_to_200, fee_above_200, _cap = resolve_fee_tiers(category, bool(has_shop))

            m = await run_in_threadpool(
                lookup_ebay_metrics_query,
                query=identifier,
                mode=mode_api,
                ek_net=float(ek_net),
                shipping_out_net=float(ship_net),
                trends_day_range=30,
                vat_rate=float(vat_rate),
                fee_up_to_200=float(fee_up_to_200),
                fee_above_200=float(fee_above_200),
            )
            m = m or {}

            sales_30d = safe_int(
                m.get("sales_30d")
                if m.get("sales_30d") is not None
                else m.get("monthly_sales")
                if m.get("monthly_sales") is not None
                else m.get("sold_30d")
                if m.get("sold_30d") is not None
                else m.get("sales")
                if m.get("sales") is not None
                else sales_30d_db
            )

            offer_count = safe_int(m.get("offer_count") or (m.get("debug") or {}).get("offer_count") or 0)
            days_to_cash = m.get("days_to_cash") or calc_days_to_cash(offer_count, sales_30d)

        # ✅ base append (if identifier empty OR after ebay calc)
        out.append({
            "id": it.get("id"),
            "identifier_type": it.get("identifier_type"),
            "identifier": it.get("identifier"),
            "title": it.get("title") or "",
            "buy_price_eur": cents_to_eur(it.get("buy_price_cents")) or 0.0,
            "shipping_cost_eur": cents_to_eur(it.get("shipping_cost_cents")) or 0.0,
            "quantity": it.get("quantity") or 1,
            "currency": it.get("currency") or "EUR",
            "last_checked_at": it.get("last_checked_at"),
            "last_market_price_eur": cents_to_eur(it.get("last_market_price_cents")),
            "delta_pct": bp_to_pct(it.get("last_delta_bp")),
            "updated_at": it.get("updated_at"),
            "purchase_date": it.get("purchase_date"),
            "purchased_at": it.get("purchased_at"),

            "ms": sales_30d if market != "kaufland" else None,
            "offer_count": offer_count,
            "days_to_cash": days_to_cash if market != "kaufland" else None,
            "market": market or "ebay",
            "category": it.get("category"),
            "store_key": it.get("store_key"),
            "store_name": it.get("store_name"),
            "return_days": it.get("return_days"),
            "return_deadline": return_deadline,
            "shipping_out_eur": cents_to_eur(it.get("shipping_out_cents")),

            "kaufland_category": it.get("kaufland_category"),
            "fee_pct_bp": it.get("fee_pct_bp"),
            "fee_fixed_cents": it.get("fee_fixed_cents"),

            "kaufland_offer_count": it.get("last_kaufland_offer_count"),
            "kaufland_demand_score": it.get("last_kaufland_demand_score"),
            "kaufland_bestseller": it.get("last_kaufland_bestseller"),
            "kaufland_demand_label": it.get("last_kaufland_demand_label"),
            

        })


    return {"ok": True, "items": out}



class StorePresetIn(BaseModel):
    store_key: str = Field(min_length=1, max_length=64)
    store_name: str = Field(min_length=1, max_length=128)
    return_days: int = Field(default=14, ge=0, le=365)
    notes: Optional[str] = Field(default=None, max_length=500)

@app.get("/stores")
async def stores_list(user=Depends(require_device)):
    require_beta_access(user)
    uid = str(user.get("sub") or "")
    return {"ok": True, "stores": await sb_list_stores(uid)}

@app.post("/stores")
async def stores_upsert(body: StorePresetIn, user=Depends(require_device)):
    require_beta_access(user)
    uid = str(user.get("sub") or "")

    key = body.store_key.strip().lower().replace(" ", "_")
    name = body.store_name.strip()
    rd = int(body.return_days)

    saved = await sb_upsert_store(uid, key, name, rd, body.notes)
    return {"ok": True, "store": saved}

@app.delete("/stores")
async def stores_delete(store_key: str, user=Depends(require_device)):
    require_beta_access(user)
    uid = str(user.get("sub") or "")
    key = (store_key or "").strip().lower()
    if not key:
        raise HTTPException(status_code=400, detail="Missing store_key")
    await sb_delete_store(uid, key)
    return {"ok": True}



from fastapi.responses import StreamingResponse
import io, csv

@app.get("/inventory/export_csv")
async def inventory_export_csv(user=Depends(require_device)):
    require_beta_access(user)
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    items = await sb_get_inventory(user_id, limit=100000000)

    def _stream():
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        # header
        w.writerow(["ean", "title", "ek", "qty", "purchased_at", "last_price", "checked_at"])
        for it in items:
            ean = it.get("identifier") or ""
            title = (it.get("title") or "").replace("\n", " ").strip()
            ek = cents_to_eur(it.get("buy_price_cents")) or 0.0
            qty = it.get("quantity") or 1
            last_price = cents_to_eur(it.get("last_market_price_cents"))
            checked_at = it.get("last_checked_at") or ""
            purchased_at = it.get("purchased_at") or ""
            w.writerow([ean, title, f"{ek:.2f}", qty, purchased_at, (f"{last_price:.2f}" if last_price is not None else ""), checked_at])
        data = buf.getvalue()
        buf.close()
        yield data

    filename = f"flipcheck_inventory_{datetime.utcnow().strftime('%Y-%m-%d')}.csv"
    return StreamingResponse(
        _stream(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.patch("/inventory/update_qty")
async def inventory_update_qty(body: UpdateQtyIn, user=Depends(require_device)):
    require_beta_access(user)
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    # Optional: ensure item belongs to user (extra safety)
    # We'll patch by id, but you can add a "user_id=eq." filter via a separate lookup if you want.
    updated = await sb_patch_inventory_item(user_id, body.id, {"quantity": body.quantity})
    return {"ok": True, "item": updated}

from pydantic.config import ConfigDict

class VatSettingsIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    vat_status: Optional[str] = None
    vat_mode: Optional[str] = None

    @model_validator(mode="after")
    def normalize(self):
        vm = (self.vat_mode or "").strip().lower()
        vs = (self.vat_status or "").strip().upper()

        # map vat_mode -> vat_status
        if not vs and vm:
            if vm in ("vat_registered", "vat", "deduct"):
                vs = "VAT"
            elif vm in ("small_business", "small", "gross"):
                vs = "SMALL"

        # also accept vat_status values directly
        if vs in ("VAT_REGISTERED", "VATREGISTERED"):
            vs = "VAT"
        if vs in ("SMALL_BUSINESS", "SMALLBUSINESS"):
            vs = "SMALL"

        if vs not in ("SMALL", "VAT"):
            raise ValueError("vat_status required (SMALL|VAT)")

        self.vat_status = vs
        return self





@app.patch("/settings/vat")
async def settings_vat(body: VatSettingsIn, user=Depends(require_device)):
    require_beta_access(user)
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    vs = (body.vat_status or "").strip().upper()
    vat_rate = 0.19 if vs == "VAT" else 0.0


    url = f"{SUPABASE_URL}/rest/v1/profiles"
    headers = {**SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"}
    row = {"user_id": user_id, "vat_status": vs, "vat_rate": vat_rate}

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, headers=headers, json=row)

    if r.status_code not in (200, 201, 204):
        raise HTTPException(status_code=500, detail=f"profile_upsert_failed:{r.status_code}:{r.text}")
    print("VAT_BODY_RAW:", body.model_dump())
    return {"ok": True, "vat_status": vs, "vat_rate": vat_rate}



from pydantic import BaseModel, Field, AliasChoices, AliasPath
from pydantic.config import ConfigDict

from pydantic import BaseModel, Field, AliasChoices, AliasPath
from pydantic.config import ConfigDict
from typing import Optional, Literal

class UserSettings(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    weekly_profit_target: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices(
            "weekly_profit_target",
            "weekly_profit_target_eur",
            AliasPath("targets", "weekly_profit_target_eur"),
        ),
    )
    weekly_purchase_target: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices(
            "weekly_purchase_target",
            "weekly_ek_target_eur",
            AliasPath("targets", "weekly_ek_target_eur"),
        ),
    )
    weekly_units_target: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices(
            "weekly_units_target",
            "weekly_units_target",
            AliasPath("targets", "weekly_units_target"),
        ),
    )

    min_profit: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices(
            "min_profit",
            "min_profit_eur",
            AliasPath("rules", "min_profit_eur"),
        ),
    )
    min_roi: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices(
            "min_roi",
            "min_roi_pct",
            AliasPath("rules", "min_roi_pct"),
        ),
    )
    min_sales_30d: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices(
            "min_sales_30d",
            "min_monthly_sales",
            AliasPath("rules", "min_monthly_sales"),
        ),
    )

    ebay_zero_fees: Optional[bool] = Field(
        default=None,
        validation_alias=AliasChoices(
            "ebay_zero_fees",
            "durchstarter",
            "durchstarter_enabled",                 # ✅ neu
            AliasPath("costs", "ebay_zero_fees"),
            AliasPath("app", "durchstarter_enabled") # ✅ neu
        ),
    )


    vat_status: Optional[Literal["SMALL","VAT"]] = Field(
        default=None,
        validation_alias=AliasChoices(
            "vat_status",
            "vatStatus",
            AliasPath("vat", "vat_status"),
            AliasPath("vat", "vatStatus"),
            AliasPath("vat", "vat_mode"),  # falls UI "small_business"/"vat_registered" sendet
        ),
    )
    vat_rate: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices(
            "vat_rate",
            "vat_rate_pct",
            AliasPath("vat", "vat_rate_pct"),
            AliasPath("vat", "vat_rate"),
        ),
    )

    fee: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices(
            "fee",
            "fee_pct",
            "default_fee_pct",
            AliasPath("costs", "default_fee_pct"),
        ),
    )





@app.get("/settings")
async def settings_get(user=Depends(require_device)):
    require_beta_access(user)
    user_id = str(user.get("sub") or "")
    profile = await sb_get_profile(user_id)
    vat_mode, vat_rate = resolve_vat_mode(profile)

    fee_pct_db = float(profile.get("fee", 12) or 12)          # DB: 12
    fee_frac = fee_pct_db / 100.0                             # UI: 0.12

    ebay_zero = bool(profile.get("ebay_zero_fees") or False)

    return {
        "ok": True,

        # VAT
        "vat_status": profile.get("vat_status") or "SMALL",
        "vat_mode": vat_mode,          # "gross" | "deduct"
        "vat_rate": vat_rate,          # 0.0 | 0.19

        # flat (backend)
        "fee": fee_pct_db,
        "weekly_profit_target": profile.get("weekly_profit_target", 500),
        "weekly_purchase_target": profile.get("weekly_purchase_target", 1000),
        "weekly_units_target": profile.get("weekly_units_target", 20),
        "min_profit": profile.get("min_profit", 12),
        "min_roi": profile.get("min_roi", 25),
        "min_sales_30d": profile.get("min_sales_30d", 3),
        "ebay_zero_fees": ebay_zero,

        # nested (electron defaults schema)
        "costs": {
            "default_fee_pct": fee_frac,          # ✅ 0.12
            "default_fee_fixed_eur": 0.0,
            "default_shipping_out_eur": 0.0,
            "ebay_zero_fees": ebay_zero,
        },
        "app": {"durchstarter_enabled": ebay_zero, "autostart_enabled": True},
        
        "rules": {
            "min_profit_eur": profile.get("min_profit", 12),
            "min_roi_pct": profile.get("min_roi", 25),
            "min_monthly_sales": profile.get("min_sales_30d", 3),
        },
        "targets": {
            "weekly_ek_target_eur": profile.get("weekly_purchase_target", 1000),
            "weekly_profit_target_eur": profile.get("weekly_profit_target", 500),
            "weekly_units_target": profile.get("weekly_units_target", 20),
        },
    }


@app.put("/settings")
async def settings_update(request: Request, user=Depends(require_device)):
    require_beta_access(user)
    user_id = str(user.get("sub") or "")

    raw = await request.json()
    print("SETTINGS_RAW_IN:", raw)

    flat = {}

    rules = raw.get("rules") or {}
    flat["min_profit_eur"] = rules.get("min_profit_eur")
    flat["min_roi_pct"] = rules.get("min_roi_pct")
    flat["min_monthly_sales"] = rules.get("min_monthly_sales")

    targets = raw.get("targets") or {}
    flat["weekly_profit_target_eur"] = targets.get("weekly_profit_target_eur")
    flat["weekly_ek_target_eur"] = targets.get("weekly_ek_target_eur") or targets.get("weekly_purchase_target_eur")
    flat["weekly_units_target"] = targets.get("weekly_units_target")  # ✅ FIX

    costs = raw.get("costs") or {}
    flat["ebay_zero_fees"] = costs.get("ebay_zero_fees")

    # ✅ fee from nested or flat
    fee_in = (
        costs.get("default_fee_pct")
        or raw.get("fee")
        or raw.get("fee_pct")
        or raw.get("default_fee_pct")
    )
    if fee_in is not None:
        flat["fee"] = fee_in

    # allow flat override
    flat.update(raw)

    # ✅ REALLY ignore vat changes here
    for k in ("vat", "vat_status", "vat_mode", "vat_rate", "vat_rate_pct"):
        flat.pop(k, None)


    # optional: ignore vat changes here; enforce /settings/vat endpoint only
    raw.pop("vat", None)
    raw.pop("vat_status", None)
    raw.pop("vat_mode", None)
    raw.pop("vat_rate", None)
    raw.pop("vat_rate_pct", None)


    new_settings = UserSettings.model_validate(flat)
    updated_data = new_settings.model_dump(exclude_unset=True)
    updated_data = {k: v for k, v in updated_data.items() if v is not None}



    # fee normalize
    if "fee" in updated_data:
        f = float(updated_data["fee"])
        if f <= 1.0:
            f *= 100.0
        updated_data["fee"] = f

    print("SETTINGS_VALID_PATCH:", updated_data)

    if not updated_data:
        return {"ok": True, "noop": True}

    await sb_save_profile(user_id, updated_data)
    profile = await sb_get_profile(user_id)
    vat_mode, vat_rate = resolve_vat_mode(profile)
    return {"ok": True, **updated_data, "vat_mode": vat_mode, "vat_rate": vat_rate, "vat_status": profile.get("vat_status") or "SMALL"}






@app.post("/inventory/check_prices")
async def inventory_check_prices(body: CheckPricesIn, user=Depends(require_device)):
    require_beta_access(user)
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")
    profile = await sb_get_profile(user_id)
    vat_mode, vat_rate = resolve_vat_mode(profile)

    zero_fees = body.ebay_zero_fees
    if zero_fees is None:
        zero_fees = bool(profile.get("ebay_zero_fees") or False)

    fee_pct = float(profile.get("fee") or 12) / 100.0
    fee = 0.0 if bool(zero_fees) else fee_pct



    

    device_hash = str(user.get("_device_hash") or "")
    rate_key = f"{user_id}:{device_hash}:invcheck"
    rate_limit(rate_key, refill_per_sec=0.1, burst=1.0)

    # Fetch items
    if body.ids:
        items = await sb_get_inventory_by_ids(user_id, body.ids)
    else:
        items = await sb_get_inventory(user_id, limit=300)

    sem = asyncio.Semaphore(6)
    def _as_int(x):
        try:
            if x is None:
                return None
            if isinstance(x, str):
                x = x.strip().replace(",", ".")
            return int(float(x))
        except Exception:
            return None


    async def one(it: Dict[str, Any]) -> Dict[str, Any]:
        
        async with sem:
            item_id = it.get("id")
            id_type = it.get("identifier_type")
            identifier = (it.get("identifier") or "").strip()
            market = (it.get("market") or "ebay").lower().strip()


            if id_type != "EAN" or not identifier.isdigit():
                return {"id": item_id, "ok": False, "reason": "unsupported_identifier"}

            import anyio
            now_iso = datetime.utcnow().isoformat()

            # --- Kaufland ---
            if market == "kaufland":
                try:
                    k = await anyio.to_thread.run_sync(partial(check_ean, identifier))
                    sell = k.get("min_total_new")
                    if sell is None:
                        return {"id": item_id, "ok": False, "reason": "kaufland_no_market_price"}

                    new_cents = eur_to_cents(float(sell))
                    old_cents = it.get("last_market_price_cents")
                    old_cents = old_cents if isinstance(old_cents, int) else None

                    delta_bp = None
                    if old_cents and old_cents > 0:
                        delta_bp = int(round(((new_cents - old_cents) / old_cents) * 10000))

                    patch = {
                        "last_checked_at": now_iso,
                        "last_market_price_cents": new_cents,
                        "last_delta_bp": delta_bp,
                        "last_kaufland_offer_count": k.get("offers_count_new"),
                        "last_kaufland_demand_score": k.get("score"),
                        "last_kaufland_bestseller": k.get("bestseller"),
                        "last_kaufland_demand_label": k.get("label"),

                    }

                    await sb_patch_inventory_item(user_id, item_id, patch)
                    return {"id": item_id, "ok": True, "new_price_eur": float(sell), "delta_bp": delta_bp}

                except Exception as e:
                    return {"id": item_id, "ok": False, "reason": str(e)}


            # --- eBay (default) ---
            try:
                metrics = await anyio.to_thread.run_sync(
                    partial(
                        lookup_ebay_metrics_query,
                        query=identifier,
                        mode="ean",
                        ek_net=0.0,
                        shipping_out_net=0.0,
                        trends_day_range=30,
                        vat_rate=vat_rate,
                        fee_up_to_200=fee,
                        fee_above_200=fee,
                    )
                )
                metrics = metrics or {}

                sales_30d = _as_int(
                    metrics.get("sales_30d")
                    if metrics.get("sales_30d") is not None
                    else metrics.get("monthly_sales")
                    if metrics.get("monthly_sales") is not None
                    else metrics.get("sold_30d")
                    if metrics.get("sold_30d") is not None
                    else metrics.get("sales")
                )

                if metrics.get("error"):
                    return {"id": item_id, "ok": False, "reason": metrics["error"]}

                new_price = metrics.get("sell_gross_avg")
                if new_price is None:
                    return {"id": item_id, "ok": False, "reason": "no_market_price"}

                new_cents = eur_to_cents(float(new_price))
                old_cents = it.get("last_market_price_cents")
                old_cents = old_cents if isinstance(old_cents, int) else None

                delta_bp = None
                if old_cents and old_cents > 0:
                    delta_bp = int(round(((new_cents - old_cents) / old_cents) * 10000))

                patch = {
                    "last_checked_at": now_iso,
                    "last_market_price_cents": new_cents,
                    "last_delta_bp": delta_bp,
                    "last_sales_30d": sales_30d,
                    "last_sales_30d_updated_at": now_iso,
                }

                await sb_patch_inventory_item(user_id, item_id, patch)
                return {"id": item_id, "ok": True, "new_price_eur": float(new_price), "delta_bp": delta_bp}

            except Exception as e:
                return {"id": item_id, "ok": False, "reason": str(e)}


    results = await asyncio.gather(*[one(it) for it in items])
    ok_count = sum(1 for r in results if r.get("ok"))
    fail_count = len(results) - ok_count
    return {"ok": True, "updated": ok_count, "failed": fail_count, "results": results}



@app.post("/flipcheck")
async def flipcheck(payload: Dict[str, Any], user=Depends(require_device)):
    return await run_flipcheck_engine(payload, user)

class EbayStartIn(BaseModel):
    return_to: Optional[str] = None  # optional, falls du später zurückleiten willst

@app.get("/ebay/status")
async def ebay_status(user=Depends(require_device)):
    require_beta_access(user)
    uid = str(user.get("sub") or "")
    conn = await sb_get_ebay_conn(uid)
    if not conn:
        return {"ok": True, "connected": False}
    return {
        "ok": True,
        "connected": True,
        "expires_at": conn.get("expires_at"),
        "scope": conn.get("scope"),
    }

@app.get("/ebay/oauth/start")
async def ebay_oauth_start(user=Depends(require_device)):
    # ✅ wichtig: wir nutzen require_device, weil wir den user_id brauchen
    require_beta_access(user)
    uid = str(user.get("sub") or "")
    if not uid:
        raise HTTPException(status_code=401, detail="Missing sub")

    if not EBAY_CLIENT_ID or not EBAY_CLIENT_SECRET or not EBAY_REDIRECT_URI:
        raise HTTPException(status_code=500, detail="ebay_env_missing")

    state = f"{uid}:{secrets.token_urlsafe(16)}"
    url = _ebay_authorize_url(state)
    # redirect
    return JSONResponse({"ok": True, "authorize_url": url})

@app.get("/ebay/oauth/callback")
async def ebay_oauth_callback(code: str | None = None, state: str | None = None):
    # ✅ callback kommt von eBay, kein JWT hier -> wir nehmen uid aus state
    if not code or not state:
        raise HTTPException(status_code=400, detail="missing_code_or_state")

    # state = "<uid>:<random>"
    uid = state.split(":", 1)[0].strip()
    if not uid:
        raise HTTPException(status_code=400, detail="bad_state")

    j = await ebay_exchange_code_for_tokens(code)

    access_token = j.get("access_token")
    refresh_token = j.get("refresh_token")
    expires_in = int(j.get("expires_in") or 7200)
    scope = j.get("scope")

    if not access_token or not refresh_token:
        raise HTTPException(status_code=401, detail="ebay_exchange_missing_tokens")

    await sb_upsert_ebay_conn(uid, {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat(),
        "scope": scope,
    })

    # ✅ Popup kann sich schließen
    from fastapi.responses import HTMLResponse
    return HTMLResponse("<script>window.close();</script>")

@app.post("/ebay/disconnect")
async def ebay_disconnect(user=Depends(require_device)):
    require_beta_access(user)
    uid = str(user.get("sub") or "")
    await sb_delete_ebay_conn(uid)
    return {"ok": True, "disconnected": True}

@app.post("/ebay/sync_orders")
async def ebay_sync_orders(user=Depends(require_device)):
    require_beta_access(user)
    uid = str(user.get("sub") or "")
    if not uid:
        raise HTTPException(status_code=401, detail="Missing sub")

    profile = await sb_get_profile(uid)

    # since: last sync or fallback 24h
    since_dt = None
    try:
        since_raw = profile.get("last_ebay_orders_sync")
        if since_raw:
            since_dt = datetime.fromisoformat(str(since_raw).replace("Z","+00:00"))
    except Exception:
        since_dt = None

    if not since_dt:
        since_dt = datetime.now(timezone.utc) - timedelta(days=1)

    since_iso = since_dt.astimezone(timezone.utc).isoformat()

    access_token = await ebay_get_access_token(uid)
    orders = await ebay_get_orders(access_token, since_iso)

    # Build SKU set for inventory join
    skus = set()
    for o in orders:
        for li in (o.get("lineItems") or []):
            sku = (li.get("sku") or "").strip()
            if sku:
                skus.add(sku)

    inv_by_sku = await sb_get_inventory_by_skus(uid, list(skus))

    fee_pct_default = float(profile.get("fee", 12) or 12) / 100.0
    fee_bp = int(round(fee_pct_default * 10000))

    synced_orders = 0
    synced_lines = 0

    for o in orders:
        
        order_id = str(o.get("orderId") or "").strip()
        if not order_id:
            continue

        # ✅ FINANCES: real fees per order
        tx = await ebay_get_finance_transactions(access_token, order_id)
        fees_total_cents = _sum_finance_fee_cents(tx.get("transactions") or [])

        created = o.get("creationDate") or o.get("createdDate")
        lastmod = o.get("lastModifiedDate")
        currency = ((o.get("pricingSummary") or {}).get("total") or {}).get("currency")
        total_val = ((o.get("pricingSummary") or {}).get("total") or {}).get("value")

        await sb_upsert_ebay_order(uid, {
            "order_id": order_id,
            "created_at": created,
            "last_modified_at": lastmod,
            "currency": currency,
            "total_gross_cents": _cents(total_val),
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
            "raw": o,
            "fees_gross_cents": fees_total_cents,

        })
        synced_orders += 1

        raw_lines = (o.get("lineItems") or [])
        sold_list = []
        parsed = []

        for li in raw_lines:
            sku = (li.get("sku") or "").strip() or None
            item_id = (li.get("itemId") or li.get("legacyItemId") or None)

            qty = li.get("quantity") or 1
            try: qty = max(1, int(qty))
            except Exception: qty = 1

            line_price = ((li.get("lineItemCost") or li.get("total") or {}).get("value"))
            sold_cents = _cents(line_price)

            inv = inv_by_sku.get(sku) if sku else None
            ek_cents = int(inv.get("buy_price_cents")) if inv and inv.get("buy_price_cents") is not None else None
            ship_out_cents = int(inv.get("shipping_out_cents")) if inv and inv.get("shipping_out_cents") is not None else 500

            sold_list.append(sold_cents)
            parsed.append((li, sku, item_id, qty, sold_cents, ek_cents, ship_out_cents))

        fee_alloc = _alloc_fee_to_lines(fees_total_cents, sold_list)
        await sb_upsert_ebay_order(uid, {
            "order_id": order_id,
            "created_at": created,
            "last_modified_at": lastmod,
            "currency": currency,
            "total_gross_cents": _cents(total_val),
            "fees_gross_cents": fees_total_cents,  # ✅ real fees per order
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
            "raw": o,
        })
        for idx, tup in enumerate(parsed):
            li, sku, item_id, qty, sold_cents, ek_cents, ship_out_cents = tup
            fees_cents = int(fee_alloc[idx])

            profit_cents = None
            if ek_cents is not None:
                profit_cents = sold_cents - fees_cents - ship_out_cents - ek_cents

            line_id = f"{order_id}:{sku or ''}:{item_id or ''}:{li.get('lineItemId') or ''}".strip()

            await sb_upsert_ebay_line(uid, {
                "order_id": order_id,
                "line_id": line_id,
                "sku": sku,
                "ebay_item_id": item_id,
                "qty": qty,
                "sold_gross_cents": sold_cents,

                "fee_pct_bp": None,              # optional jetzt
                "fees_gross_cents": fees_cents,  # ✅ real allocated
                "ship_out_cents": ship_out_cents,
                "ek_cents": ek_cents,
                "profit_cents": profit_cents,
                "raw": li,
            })
            synced_lines += 1




    # update last sync
    await sb_save_profile(uid, {"last_ebay_orders_sync": datetime.now(timezone.utc).isoformat()})

    return {"ok": True, "orders": synced_orders, "lines": synced_lines, "since": since_iso}


@app.get("/ebay/oauth/start")
async def ebay_oauth_start(user=Depends(require_device)):
    require_beta_access(user)
    uid = str(user.get("sub") or "")
    if not uid:
        raise HTTPException(status_code=401, detail="Missing sub")

    if not EBAY_CLIENT_ID or not EBAY_CLIENT_SECRET or not EBAY_REDIRECT_URI:
        raise HTTPException(status_code=500, detail="ebay_env_missing")

    state = f"{uid}:{secrets.token_urlsafe(16)}"
    url = _ebay_authorize_url(state)
    return {"ok": True, "authorize_url": url}


@app.get("/ebay/oauth/callback")
async def ebay_oauth_callback(code: str | None = None, state: str | None = None):
    if not code or not state:
        raise HTTPException(status_code=400, detail="missing_code_or_state")

    uid = state.split(":", 1)[0].strip()
    if not uid:
        raise HTTPException(status_code=400, detail="bad_state")

    j = await ebay_exchange_code_for_tokens(code)

    access_token = j.get("access_token")
    refresh_token = j.get("refresh_token")
    expires_in = int(j.get("expires_in") or 7200)
    scope = j.get("scope")

    if not access_token or not refresh_token:
        raise HTTPException(status_code=401, detail="ebay_exchange_missing_tokens")

    await sb_upsert_ebay_conn(uid, {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat(),
        "scope": scope,
    })

    return HTMLResponse("<script>window.close();</script>")


