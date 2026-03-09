from __future__ import annotations

import sys as _sys, os as _os
# Ensure ebay_live.py is importable regardless of the CWD uvicorn starts from.
# Checks: (1) this file's own dir, (2) ../Backend relative to this file.
for _p in [
    _os.path.dirname(_os.path.abspath(__file__)),
    _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "Backend"),
]:
    if _os.path.isfile(_os.path.join(_p, "ebay_live.py")) and _p not in _sys.path:
        _sys.path.insert(0, _p)
        break

from dataclasses import dataclass
from typing import Optional, Tuple, Dict, Any, List
import asyncio

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from ebay_live import lookup_ebay_metrics, fetch_research_stats, derive_days_to_cash
from amazon import amazon_check as _amazon_check, AMZ_SCAN_CATS, keepa_search_de, keepa_batch_stats

# Try to import deal-scan helpers — only available in newer ebay_live versions.
# Falls back to inline implementations for compatibility.
try:
    from ebay_live import ebay_request, _build_browse_market_prices, calc_profit
except ImportError:
    import requests as _req

    def calc_profit(sale_price: float, buy_price: float, ebay_fee_rate: float = 0.13) -> Dict[str, float]:  # type: ignore[misc]
        net = sale_price * (1 - ebay_fee_rate)
        profit = net - buy_price
        roi    = (profit / buy_price  * 100) if buy_price  > 0 else 0.0
        margin = (profit / sale_price * 100) if sale_price > 0 else 0.0
        return {"profit": round(profit, 2), "roi": round(roi, 2), "margin": round(margin, 2)}

    def _build_browse_market_prices(items: List[Dict[str, Any]]) -> Dict[str, Any]:  # type: ignore[misc]
        prices = []
        for it in items:
            try:   prices.append(float((it.get("price") or {}).get("value", 0)))
            except Exception: continue
        if not prices:
            return {"ok": False}
        prices.sort()
        n   = len(prices)
        med = prices[n // 2] if n % 2 else (prices[n//2-1] + prices[n//2]) / 2
        flt = [p for p in prices if med * 0.5 <= p <= med * 1.5] or prices
        return {"ok": True, "browse_median": round(med, 2), "browse_avg": round(sum(flt)/len(flt), 2)}

    def ebay_request(method: str, path: str, params: Optional[Dict] = None) -> Dict[str, Any]:  # type: ignore[misc]
        from ebay_live import get_ebay_token
        token = get_ebay_token()
        resp  = _req.request(
            method,
            f"https://api.ebay.com/buy/browse/v1/{path.lstrip('/')}",
            headers={"Authorization": f"Bearer {token}", "X-EBAY-C-MARKETPLACE-ID": "EBAY_DE"},
            params=params, timeout=20,
        )
        if resp.status_code >= 300:
            raise RuntimeError(f"eBay API {resp.status_code}: {resp.text[:300]}")
        return resp.json()

app = FastAPI()
from pathlib import Path
BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


# ---------------- Thresholds / Decision ----------------

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

import os, time, secrets, urllib.parse, random as _random, json as _json
import httpx
from fastapi import Request
from fastapi.responses import RedirectResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
from jose import jwt

DISCORD_CLIENT_ID = os.getenv("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET", "")
JWT_SECRET = os.getenv("FLIPCHECK_JWT_SECRET", "dev_secret_change_me")
JWT_ALG = "HS256"

# simple in-memory state store (beta ok)
_OAUTH_STATE = {}  # state -> expires_ts


def _cleanup_states():
    now = time.time()
    dead = [k for k, exp in _OAUTH_STATE.items() if exp < now]
    for k in dead:
        _OAUTH_STATE.pop(k, None)


@app.get("/auth/discord/login")
async def discord_login(request: Request):
    if not DISCORD_CLIENT_ID or not DISCORD_CLIENT_SECRET:
        return JSONResponse({"ok": False, "error": "DISCORD_CLIENT_ID/SECRET missing"}, status_code=500)

    _cleanup_states()
    state = secrets.token_urlsafe(24)
    _OAUTH_STATE[state] = time.time() + 300  # 5 min

    # Wichtig: redirect_uri muss exakt zum aktuellen Port passen
    redirect_uri = str(request.base_url).rstrip("/") + "/auth/discord/callback"

    params = {
        "client_id": DISCORD_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "identify",
        "state": state,
        "prompt": "consent",
    }
    url = "https://discord.com/api/oauth2/authorize?" + urllib.parse.urlencode(params)
    return RedirectResponse(url)


@app.get("/auth/discord/callback")
async def discord_callback(request: Request, code: str = "", state: str = ""):
    _cleanup_states()

    if not code or not state or state not in _OAUTH_STATE:
        return JSONResponse({"ok": False, "error": "invalid_state_or_code"}, status_code=400)

    # consume state
    _OAUTH_STATE.pop(state, None)

    redirect_uri = str(request.base_url).rstrip("/") + "/auth/discord/callback"

    token_url = "https://discord.com/api/oauth2/token"
    data = {
        "client_id": DISCORD_CLIENT_ID,
        "client_secret": DISCORD_CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "scope": "identify",
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(token_url, data=data, headers=headers)
        if r.status_code != 200:
            return JSONResponse({"ok": False, "error": "discord_token_exchange_failed", "body": r.text}, status_code=400)
        tok = r.json()

        # user info
        access_token = tok.get("access_token")
        if not access_token:
            return JSONResponse({"ok": False, "error": "no_access_token"}, status_code=400)

        me = await client.get(
            "https://discord.com/api/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if me.status_code != 200:
            return JSONResponse({"ok": False, "error": "discord_me_failed", "body": me.text}, status_code=400)
        user = me.json()

    # ✅ Jetzt dein eigenes Gate-Token (JWT) bauen
    payload = {
        "sub": str(user.get("id")),
        "provider": "discord",
        "discord_id": str(user.get("id")),
        "username": user.get("username"),
        "iat": int(time.time()),
        "exp": int(time.time()) + 60 * 60 * 24 * 7,  # 7 Tage
    }
    gate_token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

    # zurück in Electron via deep link
    deep = "flipcheck://auth?token=" + urllib.parse.quote(gate_token)
    return RedirectResponse(deep)


# CORS für Electron/Local (du kannst das später härter machen)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.options("/session/pair")
def options_session_pair():
    return {}

@app.post("/session/pair")
async def session_pair(payload: dict):
    # TODO: hier später echtes Pairing / Lizenz / Device-Bind
    return {"ok": True, "paired": True}


@app.get("/health")
async def health():
    return {"ok": True, "status": "online"}


@app.get("/debug/research")
async def debug_research(q: str = "Pbnsg 20-li"):
    """Debug endpoint: zeigt was fetch_research_stats intern extrahiert."""
    import json as _json, re as _re
    from ebay_live import (
        EBAY_RESEARCH_COOKIE, _build_research_url, SESSION, _parse_price_number
    )

    if not EBAY_RESEARCH_COOKIE:
        return {"ok": False, "error": "EBAY_RESEARCH_COOKIE fehlt"}

    url = _build_research_url(q)
    headers = {
        "Cookie": EBAY_RESEARCH_COOKIE,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        "Referer": "https://www.ebay.de/sh/research",
    }
    try:
        resp = SESSION.get(url, headers=headers, timeout=10)
    except Exception as e:
        return {"ok": False, "error": str(e)}

    raw_preview = resp.text[:500]
    status = resp.status_code

    # parse modules
    modules = []
    dec = _json.JSONDecoder()
    txt = resp.text.strip()
    pos = 0
    while pos < len(txt):
        while pos < len(txt) and txt[pos] in " \t\n\r":
            pos += 1
        if pos >= len(txt):
            break
        try:
            obj, end = dec.raw_decode(txt, pos)
            modules.append(obj)
            pos = end
        except _json.JSONDecodeError:
            pos += 1

    module_types = [m.get("_type") for m in modules]
    agg = next((m for m in modules if m.get("_type") == "ResearchAggregateModule"), None)

    sections_preview = None
    avg_text = sold_text = None
    if agg:
        sections = agg.get("sections", [])
        sections_preview = [
            [item.get("header", {}).get("textSpans", [{}])[0].get("text") for item in s.get("dataItems", [])]
            for s in sections
        ]
        # replicate _find_agg logic inline
        for sec in sections:
            for item in sec.get("dataItems", []):
                try:
                    h = item["header"]["textSpans"][0]["text"]
                except Exception:
                    h = ""
                try:
                    v = item["value"]["textSpans"][0]["text"]
                except Exception:
                    v = None
                if "verkaufspreis" in h.lower() and avg_text is None:
                    avg_text = v
                if "insgesamt verkauft" in h.lower() and sold_text is None:
                    sold_text = v

    # Check for metricsTrends (recursive, same logic as ebay_live.py)
    def _find_trends_debug(obj, depth=0):
        if depth > 6: return None
        if isinstance(obj, dict):
            m = obj.get("meta")
            if isinstance(m, dict) and m.get("name") == "metricsTrends":
                return obj
            for v in obj.values():
                r = _find_trends_debug(v, depth + 1)
                if r: return r
        elif isinstance(obj, list):
            for item in obj:
                r = _find_trends_debug(item, depth + 1)
                if r: return r
        return None

    trends_module = None
    for m in modules:
        trends_module = _find_trends_debug(m)
        if trends_module: break

    price_series_preview = []
    qty_series_preview   = []
    if trends_module:
        for series in trends_module.get("series", []):
            sid = series.get("id", "")
            rows = series.get("data", [])
            if sid == "averageSold":
                price_series_preview = [[r[0], r[1]] for r in rows if len(r) >= 2 and r[1] is not None]
            elif sid == "quantity":
                qty_series_preview   = [[r[0], r[1]] for r in rows if len(r) >= 2 and r[1] is not None]

    research = fetch_research_stats(q)

    return {
        "ok": True,
        "http_status": status,
        "raw_preview": raw_preview,
        "modules_found": len(modules),
        "module_types": module_types,
        "module_meta_names": [m.get("meta", {}).get("name") if isinstance(m.get("meta"), dict) else None for m in modules],
        "aggregates_found": agg is not None,
        "trends_module_found": trends_module is not None,
        "price_series_points": len(price_series_preview),
        "price_series_sample": price_series_preview[:3],   # first 3 points
        "qty_series_points":   len(qty_series_preview),
        "sections_headers": sections_preview,
        "avg_text": avg_text,
        "sold_text": sold_text,
        "parsed_avg": _parse_price_number(avg_text) if avg_text else None,
        "parsed_sales": int(_re.sub(r"[^\d]", "", sold_text)) if sold_text and _re.sub(r"[^\d]", "", sold_text) else None,
        "research_result": research,
        "research_price_series_count": len(research.get("price_series", [])) if research else 0,
    }


@app.get("/auth/verify")
async def auth_verify(request: Request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return JSONResponse({"ok": False, "error": "no_token"}, status_code=401)
    token = auth[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return {"ok": True, "user": {"id": payload.get("sub"), "username": payload.get("username")}}
    except Exception:
        return JSONResponse({"ok": False, "error": "invalid_token"}, status_code=401)


@dataclass
class Thresholds:
    min_margin: float
    min_profit_eur: float
    max_days_to_cash: int
    min_sales_30d: int


TH_HIGH = Thresholds(min_margin=25.0, min_profit_eur=10.0, max_days_to_cash=10, min_sales_30d=20)
TH_MID  = Thresholds(min_margin=20.0, min_profit_eur=7.0,  max_days_to_cash=14, min_sales_30d=12)
TH_LOW  = Thresholds(min_margin=15.0, min_profit_eur=5.0,  max_days_to_cash=21, min_sales_30d=6)


class DealScanBody(BaseModel):
    budget: float = 100.0
    min_margin: float = 20.0
    min_roi: float = 15.0
    limit: int = 20
    categories: str = ""   # comma-separated category keys; empty = all
    mode: str = "mid"


class AmazonDealScanBody(BaseModel):
    budget:       float = 150.0
    min_margin:   float = 20.0
    min_roi:      float = 15.0
    min_drop_pct: float = 15.0  # Amazon price must be this % below 90-day avg
    limit:        int   = 20
    categories:   str   = ""    # comma-separated AMZ_SCAN_CATS keys; empty = all
    mode:         str   = "mid"


# ─── Deal-Scanner: Category definitions ──────────────────────────────────────
DEAL_CATEGORIES: Dict[str, Dict[str, Any]] = {
    "gaming": {
        "label": "Gaming",
        "terms": [
            "Nintendo Switch OLED", "PS5 Controller DualSense", "Xbox Wireless Controller",
            "Nintendo Switch Spiel", "PS5 Spiel Neu", "LEGO Technic Set",
            "LEGO Star Wars", "Pokemon Karten Booster Display",
        ],
        "exclude": ["digital", "dlc", "code", "key", "account", "fc coins", "fifa coins",
                    "season pass", "boost", "coins", "currency", "token", "cd key",
                    "steam key", "download", "voucher", "gutschein"],
    },
    "smartphones": {
        "label": "Smartphones",
        "terms": [
            "iPhone 14", "iPhone 15", "iPhone 13",
            "Samsung Galaxy S23", "Samsung Galaxy S24", "Samsung Galaxy A55",
            "Google Pixel 8", "OnePlus 12",
        ],
        "exclude": ["hülle", "case", "cover", "schutzfolie", "glas", "ladekabel",
                    "ersatzteil", "ersatz", "defekt", "reparatur", "display reparatur",
                    "akku ersatz", "ladestation"],
    },
    "audio": {
        "label": "Audio",
        "terms": [
            "AirPods Pro 2", "Sony WH-1000XM5", "Bose QuietComfort 45",
            "JBL Charge 5", "Sennheiser Momentum 4", "Apple AirPods Max",
            "Sony WF-1000XM5", "Jabra Evolve2",
        ],
        "exclude": ["ersatz", "ohrpolster", "kabel", "hülle", "fall", "cover",
                    "case", "adapter", "ladekabel", "ersatzteil"],
    },
    "foto": {
        "label": "Foto & Video",
        "terms": [
            "GoPro Hero 12", "DJI Mini 4 Pro", "Fujifilm Instax Mini",
            "Sony Alpha 6000", "DJI Action 4", "Instax Wide",
        ],
        "exclude": ["akku", "speicherkarte", "hülle", "schutzfolie", "ersatz",
                    "filter", "adapter", "micro sd", "ladegerät"],
    },
    "spielzeug": {
        "label": "Spielzeug",
        "terms": [
            "LEGO City Set", "LEGO Creator Expert", "Hot Wheels Premium",
            "Playmobil Großes Set", "Schleich Farm World",
        ],
        "exclude": ["einzeln", "loose", "defekt", "ersatzteil", "ohne verpackung"],
    },
    "sport": {
        "label": "Sport",
        "terms": [
            "Garmin Fenix 7", "Polar Vantage V2", "Theragun Mini",
            "Massage Pistole Profi", "Suunto 9 Peak", "Wahoo Kickr",
        ],
        "exclude": ["ersatz", "armband", "ladekabel", "ersatzteil", "zubehör"],
    },
    "computer": {
        "label": "Computer",
        "terms": [
            "GeForce RTX 4060", "Samsung SSD 870 EVO", "AMD Ryzen 5 7600",
            "Logitech MX Master 3", "ASUS ROG Strix", "Intel Core i5-12400",
        ],
        "exclude": ["defekt", "bastler", "reparatur", "ersatz", "einzelner chip"],
    },
}

# Universal digital-content exclusion words (applied regardless of category)
_GLOBAL_EXCLUDE = [
    "digital", "dlc", "code", "key", "account", "coins", "token",
    "boost", "download", "voucher", "gutschein", "steam", "psn",
    "xbox live", "nintendo eshop", "cd key", "serial",
]


def _to_float(s: str) -> Optional[float]:
    s = (s or "").strip().replace(",", ".")
    return float(s) if s else None


def _to_int(s: str) -> Optional[int]:
    s = (s or "").strip()
    return int(s) if s else None


def decide(mode: str, m: Dict[str, Any], custom_th: Optional[Thresholds] = None) -> Tuple[str, str, str]:
    """
    Einfache Schwellen-Logik:
      - BUY:  Median-Marge >= 15% UND Days-to-Cash <= 15
      - HOLD: Eines der beiden Kriterien erfüllt
      - SKIP: Keines der Kriterien erfüllt (oder negativer Profit)
    """
    profit_med = float(m.get("profit_median", 0) or 0)
    margin_med = float(m.get("margin_median", 0) or 0)

    days = m.get("days_to_cash", None)
    days_val = int(days) if isinstance(days, (int, float)) else 999

    # Hard fail: negativer Median-Profit
    if profit_med < 0:
        return "SKIP", "Negative median profit", "Median-Profit ist negativ – zu riskant."

    ok_margin = margin_med >= 15.0
    ok_days   = days_val <= 15

    if ok_margin and ok_days:
        return "BUY", "Margin >= 15% und DTC <= 15 Tage", f"Marge {margin_med:.1f}% ≥ 15% und {days_val} DTC ≤ 15 Tage."
    elif ok_margin or ok_days:
        criterion = f"Marge {margin_med:.1f}%" if ok_margin else f"DTC {days_val}T"
        missing   = f"DTC {days_val}T > 15" if ok_margin else f"Marge {margin_med:.1f}% < 15%"
        return "HOLD", "Ein Kriterium erfüllt", f"{criterion} ok — aber {missing}."
    else:
        return "SKIP", "Beide Kriterien nicht erfüllt", f"Marge {margin_med:.1f}% < 15% und DTC {days_val}T > 15 Tage."


def _result_shape(
    *,
    ean: str,
    ek: float,
    verdict: str,
    reason: str,
    text: str,
    metrics: Dict[str, Any],
    error: Optional[str] = None,
) -> Dict[str, Any]:
    # Normalize for template: result.metrics.*
    # Keep both avg & median visible.
    sales_raw = metrics.get("sales_30d", None)
    days_raw = metrics.get("days_to_cash", None)

    def _f(x, d=0.0) -> float:
        try:
            return float(x)
        except Exception:
            return float(d)

    def _i(x, d=999) -> int:
        try:
            return int(x)
        except Exception:
            return int(d)

    return {
        "error": error,
        "ean": ean,
        "ek": round(float(ek), 2),
        "verdict": verdict,
        "reason": reason,
        "text": text,
        "metrics": {
            # Median-first KPIs (für Headline)
            "profit_eur": round(_f(metrics.get("profit_median", 0)), 2),
            "margin_pct": round(_f(metrics.get("margin_median", 0)), 2),

            # Extra (UI optional)
            "profit_avg_eur": round(_f(metrics.get("profit_avg", 0)), 2),
            "margin_avg_pct": round(_f(metrics.get("margin_avg", 0)), 2),
            "sell_price_avg": round(_f(metrics.get("sell_price_avg", 0)), 2),
            "sell_price_median": round(_f(metrics.get("sell_price_median", 0)), 2),

            # Days/Sales: None bleibt None (kein Fake)
            "days_to_cash": _i(days_raw, 999) if isinstance(days_raw, int) else None,
            "sales_30d": _i(sales_raw, 0) if isinstance(sales_raw, int) else None,

            "debug": metrics.get("debug", {}),
        },
    }


# ---------------- Routes ----------------

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request, "result": None})


# ─── eBay DE Tiered Fee Structure (Ohne Shop, official rates) ───────────────
# Format: list of (threshold_up_to, rate) pairs.
# Last entry: threshold=None means "all remaining amount".
# e.g. [(990.0, 0.065), (None, 0.03)] →
#       6.5% on first €990, then 3% on anything above.
_FEE_TIERS: Dict[str, List[Tuple[Optional[float], float]]] = {
    # ── Geräte: 6,5 % bis €990, 3 % darüber ──────────────────────────────
    "computer_tablets":  [(990.0, 0.065), (None, 0.03)],
    "drucker":           [(990.0, 0.065), (None, 0.03)],
    "foto_camcorder":    [(990.0, 0.065), (None, 0.03)],
    "handys":            [(990.0, 0.065), (None, 0.03)],
    "haushaltsgeraete":  [(990.0, 0.065), (None, 0.03)],
    "konsolen":          [(990.0, 0.065), (None, 0.03)],
    "scanner":           [(990.0, 0.065), (None, 0.03)],
    "speicherkarten":    [(990.0, 0.065), (None, 0.03)],
    "tv_video_audio":    [(990.0, 0.065), (None, 0.03)],
    "koerperpflege":     [(990.0, 0.065), (None, 0.03)],
    # ── Zubehör: 11 % bis €990, 3 % darüber ──────────────────────────────
    "drucker_zubehoer":  [(990.0, 0.11), (None, 0.03)],
    "handy_zubehoer":    [(990.0, 0.11), (None, 0.03)],
    "batterien":         [(990.0, 0.11), (None, 0.03)],
    "kabel":             [(990.0, 0.11), (None, 0.03)],
    "kameras_zubehoer":  [(990.0, 0.11), (None, 0.03)],
    "notebook_zubehoer": [(990.0, 0.11), (None, 0.03)],
    "objektive":         [(990.0, 0.11), (None, 0.03)],
    "stative":           [(990.0, 0.11), (None, 0.03)],
    "tablet_zubehoer":   [(990.0, 0.11), (None, 0.03)],
    "tastaturen_maeuse": [(990.0, 0.11), (None, 0.03)],
    "tv_zubehoer":       [(990.0, 0.11), (None, 0.03)],
    "pc_zubehoer":       [(990.0, 0.11), (None, 0.03)],
    "audio_zubehoer":    [(990.0, 0.11), (None, 0.03)],
    # ── Sonstiges: Flat Rates ─────────────────────────────────────────────
    "mode":              [(None, 0.15)],
    "sport_freizeit":    [(None, 0.115)],
    "spielzeug":         [(None, 0.115)],
    "haushalt_garten":   [(None, 0.115)],
    "buecher":           [(None, 0.15)],
    "sonstiges":         [(None, 0.13)],
}
_DEFAULT_TIERS: List[Tuple[Optional[float], float]] = [(None, 0.13)]


def _calc_tiered_fee(price: float, category_id: str) -> float:
    """Calculate eBay DE fee (Ohne Shop rates) with tiered structure."""
    tiers = _FEE_TIERS.get(category_id, _DEFAULT_TIERS)
    fee = 0.0
    remaining = max(0.0, float(price))
    prev_limit = 0.0
    for threshold, rate in tiers:
        if threshold is None:
            fee += remaining * rate
            break
        tier_cap = threshold - prev_limit
        chunk = min(remaining, tier_cap)
        fee += chunk * rate
        remaining -= chunk
        prev_limit = threshold
        if remaining <= 0:
            break
    return fee


def _effective_fee_rate(price: float, category_id: str) -> float:
    """Effective flat-equivalent fee rate for a given price (for display/compat)."""
    if price <= 0:
        return 0.13
    return _calc_tiered_fee(price, category_id) / price


@app.post("/flipcheck")
async def flipcheck(request: Request):
    """Handles both form-encoded (v1 HTML) and JSON (v2 Electron) requests."""
    content_type = request.headers.get("content-type", "")
    is_json = "application/json" in content_type

    if is_json:
        try:
            body = await request.json()
        except Exception:
            body = {}
        ean          = (body.get("ean")      or "").strip()
        ek_raw       = str(body.get("ek", "") if body.get("ek") is not None else "")
        mode         = (body.get("mode")     or "mid").strip().lower()
        category     = (body.get("category") or "sonstiges").strip().lower()
        shipping_in  = float(body.get("shipping_in")  or 0)
        shipping_out = float(body.get("shipping_out") or 0)
        vat_mode     = (body.get("vat_mode") or "no_vat").strip().lower()
        ek_mode      = (body.get("ek_mode")  or "gross").strip().lower()
    else:
        form = await request.form()
        ean          = (form.get("ean")      or "").strip()
        ek_raw       = str(form.get("ek", "") if form.get("ek") is not None else "")
        mode         = (form.get("mode")     or "mid").strip().lower()
        category     = (form.get("category") or "sonstiges").strip().lower()
        shipping_in  = float(form.get("shipping_in")  or 0)
        shipping_out = float(form.get("shipping_out") or 0)
        vat_mode     = (form.get("vat_mode") or "no_vat").strip().lower()
        ek_mode      = (form.get("ek_mode")  or "gross").strip().lower()

    is_vat = vat_mode == "ust_19"
    vat_factor = 1.19 if is_vat else 1.0

    def _err(msg: str, reason: str = "error"):
        if is_json:
            return JSONResponse({"ok": False, "verdict": "SKIP", "error": msg}, status_code=400)
        result = _result_shape(ean=ean or "", ek=0.0, verdict="SKIP", reason=reason, text=msg, metrics={}, error=msg)
        return templates.TemplateResponse("index.html", {"request": request, "result": result})

    if not ean:
        return _err("EAN fehlt.", "Missing EAN")

    ek = _to_float(ek_raw)
    if ek is None:
        return _err("EK fehlt/ungültig.", "Missing EK")

    # Custom thresholds
    custom_th: Optional[Thresholds] = None
    if mode == "custom":
        src: Any = body if is_json else form
        cm = _to_float(str(src.get("custom_min_margin") or ""))
        cp = _to_float(str(src.get("custom_min_profit") or ""))
        cd = _to_int(str(src.get("custom_max_days") or ""))
        cs = _to_int(str(src.get("custom_min_sales_30d") or ""))
        if None in (cm, cp, cd, cs):
            return _err("INDIVIDUAL: Bitte alle Schwellen ausfüllen.", "Custom missing")
        custom_th = Thresholds(
            min_margin=float(cm), min_profit_eur=float(cp),
            max_days_to_cash=int(cd), min_sales_30d=int(cs),
        )

    # ── eBay lookup (sell prices, days_to_cash, sales_30d) ──────────────────
    # Pass a neutral fee_rate — we recalculate everything below with tiered fees.
    try:
        m = lookup_ebay_metrics(ean, float(ek))
    except Exception as e:
        if is_json:
            return JSONResponse({"ok": False, "verdict": "SKIP", "error": str(e), "reason": "ebay_lookup_failed"})
        result = _result_shape(ean=ean, ek=ek, verdict="SKIP", reason="eBay lookup failed",
                               text="eBay-Request ist fehlgeschlagen.", metrics={}, error=str(e))
        return templates.TemplateResponse("index.html", {"request": request, "result": result})

    if isinstance(m, dict) and m.get("error"):
        if is_json:
            return JSONResponse({"ok": False, "verdict": "SKIP", "error": m.get("error"), "reason": "No market data"})
        result = _result_shape(ean=ean, ek=ek, verdict="SKIP", reason="No market data",
                               text="Keine verwertbaren eBay-Daten gefunden.",
                               metrics={}, error=m.get("error") or "Unknown eBay error")
        return templates.TemplateResponse("index.html", {"request": request, "result": result})

    # ── Always recalculate profit with tiered fees + VAT adjustment ──────────
    sell_avg_gross = float(m.get("sell_price_avg")    or 0)
    sell_med_gross = float(m.get("sell_price_median") or 0)

    # VAT: eBay prices are gross (inkl. MwSt). For Regelbesteuerer, work in net.
    # eBay fees are charged on gross price but you recover the VAT (Vorsteuer),
    # so effective fee = fee_gross / 1.19.
    sell_avg_adj = sell_avg_gross / vat_factor
    sell_med_adj = sell_med_gross / vat_factor

    # EK: if entered gross & VAT active → divide; if already net → keep as-is
    ek_adj = (float(ek) / vat_factor) if (is_vat and ek_mode == "gross") else float(ek)

    # Shipping: assume gross invoices (DHL etc. have VAT) → divide for ust_19
    ship_in_adj  = shipping_in  / vat_factor
    ship_out_adj = shipping_out / vat_factor

    # Tiered eBay fee on gross price, then adjust for VAT
    fee_avg_gross = _calc_tiered_fee(sell_avg_gross, category)
    fee_med_gross = _calc_tiered_fee(sell_med_gross, category)
    fee_avg_adj   = fee_avg_gross / vat_factor
    fee_med_adj   = fee_med_gross / vat_factor

    # Net revenue after fee
    net_avg = sell_avg_adj - fee_avg_adj
    net_med = sell_med_adj - fee_med_adj

    profit_avg = net_avg - ek_adj - ship_in_adj - ship_out_adj
    profit_med = net_med - ek_adj - ship_in_adj - ship_out_adj

    # Margin based on gross VK (comparable to market price)
    margin_avg = (profit_avg / sell_avg_gross * 100) if sell_avg_gross > 0 else 0.0
    margin_med = (profit_med / sell_med_gross * 100) if sell_med_gross > 0 else 0.0

    m["profit_avg"]    = round(profit_avg, 2)
    m["profit_median"] = round(profit_med, 2)
    m["margin_avg"]    = round(margin_avg, 2)
    m["margin_median"] = round(margin_med, 2)
    m["fees_avg"]      = round(fee_avg_adj, 2)
    m["fees_median"]   = round(fee_med_adj, 2)

    verdict, reason, text = decide(mode=mode, m=m, custom_th=custom_th)

    if is_json:
        debug = m.get("debug", {})
        return JSONResponse({
            "ean":              ean,
            "ek":               round(float(ek), 2),
            "title":            debug.get("rep_title") or ean,
            "verdict":          verdict,
            "reason":           reason,
            "vat_mode":         vat_mode,
            "ek_mode":          ek_mode,
            "category":         category,
            "shipping_in":      shipping_in,
            "shipping_out":     shipping_out,
            # Prices (always gross market price — frontend converts to net for display)
            "sell_price_median":m.get("sell_price_median"),
            "sell_price_avg":   m.get("sell_price_avg"),
            # Profits (already VAT-adjusted if ust_19)
            "profit_median":    m.get("profit_median"),
            "profit_avg":       m.get("profit_avg"),
            "margin_pct":       m.get("margin_median"),
            # Fees (VAT-adjusted — what you effectively pay after Vorsteuer)
            "fees_median":      m.get("fees_median"),
            "fees_avg":         m.get("fees_avg"),
            # Logistics
            "days_to_cash":     m.get("days_to_cash"),
            "sales_30d":        m.get("sales_30d"),
            "offer_count":      m.get("offer_count"),
            "browse_avg":       debug.get("browse_avg"),
            # Daily series from eBay Research (metricsTrends) — 30-31 daily data points
            # [[epoch_ms, avg_sold_price], ...] and [[epoch_ms, qty_sold], ...]
            "price_series":     m.get("price_series", []),
            "qty_series":       m.get("qty_series",   []),
        })

    result = _result_shape(ean=ean, ek=ek, verdict=verdict, reason=reason, text=text, metrics=m, error=None)
    return templates.TemplateResponse("index.html", {"request": request, "result": result})


def _iter_deals_scan(
    budget: float,
    min_margin: float,
    min_roi: float,
    limit: int,
    categories: List[str],
    mode: str = "mid",
):
    """Generator — yields deal dicts one-by-one as they are found."""
    seen_ids: set = set()
    count = 0

    # ── Build term + exclude lists from selected categories ──────────────────
    if categories:
        terms: List[str] = []
        cat_excludes: List[str] = []
        for cat_id in categories:
            cat = DEAL_CATEGORIES.get(cat_id, {})
            terms.extend(cat.get("terms", []))
            cat_excludes.extend(cat.get("exclude", []))
    else:
        terms = [t for d in DEAL_CATEGORIES.values() for t in d["terms"]]
        cat_excludes = [w for d in DEAL_CATEGORIES.values() for w in d.get("exclude", [])]

    _random.shuffle(terms)
    excludes_lower = list({w.lower() for w in cat_excludes + _GLOBAL_EXCLUDE})

    for term in terms:
        if count >= limit:
            break
        try:
            # ── Market baseline (no price filter) ────────────────────────────
            data_all = ebay_request("GET", "item_summary/search", {
                "q": term,
                "limit": "50",
                "filter": "buyingOptions:{FIXED_PRICE}",
            })
            all_items = data_all.get("itemSummaries") or []
            market = _build_browse_market_prices(all_items)
            if not market.get("ok") or not market.get("browse_median"):
                continue
            market_median = float(market["browse_median"])
            market_offer_count = int(market.get("offer_count", len(all_items)) or 1)

            # ── Cheap listings under budget ──────────────────────────────────
            data_cheap = ebay_request("GET", "item_summary/search", {
                "q": term,
                "limit": "30",
                "filter": f"price:[1..{int(budget)}],buyingOptions:{{FIXED_PRICE}}",
                "sort": "price",
            })
            cheap_items = data_cheap.get("itemSummaries") or []

        except Exception:
            continue

        for item in cheap_items:
            if count >= limit:
                break

            item_id = item.get("itemId")
            if not item_id or item_id in seen_ids:
                continue

            title = (item.get("title") or "").strip()
            title_lower = title.lower()

            # ── Filter digital / unwanted items ─────────────────────────────
            if any(w in title_lower for w in excludes_lower):
                continue

            seen_ids.add(item_id)

            try:
                buy_price = float((item.get("price") or {}).get("value", 0))
            except Exception:
                continue
            if buy_price < 1.0:
                continue

            # ── EAN/GTIN extraction ──────────────────────────────────────────
            gtin = (item.get("gtin") or "").strip()
            if not gtin:
                for asp in (item.get("localizedAspects") or []):
                    if asp.get("name", "").upper() in ("EAN", "GTIN", "UPC", "ISBN"):
                        gtin = str(asp.get("value", "")).strip()
                        break

            # ── Research data when GTIN available ───────────────────────────
            research_data = None
            if gtin and len(gtin) in (8, 12, 13):
                try:
                    research_data = fetch_research_stats(gtin)
                except Exception:
                    pass

            # ── Sell price estimate ──────────────────────────────────────────
            if research_data and research_data.get("avg_price"):
                sell_est   = float(research_data["avg_price"])
                sales_30d  = research_data.get("monthly_sales")
                has_research = True
            elif research_data and research_data.get("median_price"):
                sell_est   = float(research_data["median_price"])
                sales_30d  = research_data.get("monthly_sales")
                has_research = True
            else:
                # Conservative browse estimate
                sell_est   = round(market_median * 0.90, 2)
                sales_30d  = None
                has_research = False

            if sell_est <= buy_price:
                continue

            stats = calc_profit(sell_est, buy_price)
            if stats["profit"] <= 0 or stats["margin"] < min_margin or stats["roi"] < min_roi:
                continue

            # ── Days-to-cash ─────────────────────────────────────────────────
            dtc: Optional[int] = None
            if isinstance(sales_30d, int) and market_offer_count:
                try:
                    dtc = derive_days_to_cash(sales_30d, market_offer_count)
                except Exception:
                    pass

            # ── Score: ROI 35% + Margin 30% + Velocity 20% + Speed 15% ──────
            roi_s      = min(100.0, float(stats["roi"]))
            margin_s   = min(100.0, float(stats["margin"]) * 2.0)
            velocity_s = min(100.0, float(sales_30d or 0) * 4.0)   # 25/mo → 100
            speed_s    = max(0.0, 100.0 - float(dtc or 14) * 5.0)  # 0d → 100, 20d+ → 0
            score = round(roi_s * 0.35 + margin_s * 0.30 + velocity_s * 0.20 + speed_s * 0.15, 1)

            verdict = "BUY" if (
                stats["margin"] >= min_margin * 1.25 and
                stats["roi"] >= min_roi * 1.25 and
                score >= 55
            ) else "HOLD"

            # ── Image ────────────────────────────────────────────────────────
            image_url = ((item.get("thumbnailImages") or [{}])[0]).get("imageUrl", "")
            if not image_url:
                image_url = (item.get("image") or {}).get("imageUrl", "")

            count += 1
            yield {
                "rank":          count,
                "item_id":       item_id,
                "title":         title[:80],
                "ean":           gtin,
                "ek":            round(buy_price, 2),
                "sell_price":    round(sell_est, 2),
                "profit":        round(stats["profit"], 2),
                "margin_pct":    round(stats["margin"], 1),
                "roi_pct":       round(stats["roi"], 1),
                "score":         score,
                "verdict":       verdict,
                "sales_30d":     sales_30d,
                "days_to_cash":  dtc,
                "offer_count":   market_offer_count,
                "has_research":  has_research,
                "image_url":     image_url,
                "item_url":      item.get("itemWebUrl", ""),
                "search_term":   term,
            }


@app.get("/deals/stream")
async def deals_stream(
    budget: float = 100.0,
    min_margin: float = 20.0,
    min_roi: float = 15.0,
    limit: int = 20,
    categories: str = "",
    mode: str = "mid",
):
    """SSE endpoint — pushes each deal to the client as soon as it is found."""
    cat_list = [c.strip() for c in categories.split(",") if c.strip()] if categories else []
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def run_scan():
        try:
            for deal in _iter_deals_scan(budget, min_margin, min_roi, limit, cat_list, mode):
                asyncio.run_coroutine_threadsafe(queue.put(("deal", deal)), loop).result(timeout=10)
        except Exception as exc:
            asyncio.run_coroutine_threadsafe(queue.put(("error", str(exc))), loop).result(timeout=5)
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(("done", None)), loop).result(timeout=5)

    loop.run_in_executor(None, run_scan)

    async def generate():
        yield ": connected\n\n"
        while True:
            try:
                kind, data = await asyncio.wait_for(queue.get(), timeout=180.0)
            except asyncio.TimeoutError:
                yield 'event: error\ndata: {"error":"timeout"}\n\n'
                break
            if kind == "done":
                yield "event: done\ndata: {}\n\n"
                break
            elif kind == "error":
                yield f'event: error\ndata: {_json.dumps({"error": data})}\n\n'
                break
            else:
                yield f"data: {_json.dumps(data)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/deals/scan")
async def deals_scan(body: DealScanBody):
    """Batch endpoint — returns all results at once (non-streaming fallback)."""
    cat_list = [c.strip() for c in body.categories.split(",") if c.strip()] if body.categories else []
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(
        None,
        lambda: list(_iter_deals_scan(body.budget, body.min_margin, body.min_roi, body.limit, cat_list, body.mode))
    )
    results.sort(key=lambda x: x["score"], reverse=True)
    return {"ok": True, "deals": results, "count": len(results)}


# ─── Amazon Deal Scanner (buy on Amazon → sell on eBay) ───────────────────────

async def _iter_amazon_deals(
    budget:       float,
    min_margin:   float,
    min_roi:      float,
    min_drop_pct: float,
    limit:        int,
    cat_keys:     List[str],
    mode:         str = "mid",
):
    """
    Async generator — finds Amazon products with recent price drops,
    then checks eBay resale value.  Yields deal dicts.
    """
    selected = [AMZ_SCAN_CATS[k] for k in cat_keys if k in AMZ_SCAN_CATS] \
               or list(AMZ_SCAN_CATS.values())

    seen: set = set()
    count = 0
    rank  = 0

    for cat in selected:
        if count >= limit:
            break

        terms = list(cat.get("terms", []))
        _random.shuffle(terms)

        for term in terms:
            if count >= limit:
                break

            # Search Keepa for ASINs matching this keyword (subscriber plan endpoint)
            asins = await keepa_search_de(term, limit=20)
            chunk = [a for a in asins if a not in seen]
            if not chunk:
                continue

            products = await keepa_batch_stats(chunk)

            for product in products:
                if count >= limit:
                    break

                asin = product.get("asin") or ""
                if not asin or asin in seen:
                    continue
                seen.add(asin)

                stats_raw = product.get("stats") or {}
                current   = stats_raw.get("current") or []
                avg90     = stats_raw.get("avg90")   or []

                # BuyBox = stats index 18; fallback to Marketplace New = index 1
                cur_raw = current[18] if len(current) > 18 and current[18] > 0 else \
                          (current[1] if len(current) > 1 else -1)
                avg_raw = avg90[18]   if len(avg90) > 18   and avg90[18]   > 0 else \
                          (avg90[1]   if len(avg90) > 1   else -1)

                if cur_raw <= 0 or avg_raw <= 0:
                    continue

                ek          = cur_raw / 100.0
                avg90_price = avg_raw / 100.0

                if ek < 5.0 or ek > budget:
                    continue

                drop_pct = (avg90_price - ek) / avg90_price * 100 if avg90_price > 0 else 0.0
                if drop_pct < min_drop_pct:
                    continue

                eans = product.get("eanList") or []
                if not eans:
                    continue
                ean = eans[0]

                # eBay resale lookup (sync → run in thread)
                try:
                    ebay = await asyncio.to_thread(lookup_ebay_metrics, ean, ek)
                except Exception:
                    continue

                if not ebay or "error" in ebay:
                    continue

                vk = ebay.get("sell_price_median") or ebay.get("sell_price_avg")
                if not vk or vk <= 0:
                    continue

                stats_profit = calc_profit(float(vk), float(ek))
                if stats_profit["margin"] < min_margin or stats_profit["roi"] < min_roi:
                    continue
                if stats_profit["profit"] <= 0:
                    continue

                sales_30d    = ebay.get("sales_30d")
                days_to_cash = derive_days_to_cash(sales_30d, ebay.get("offer_count", 1))

                # Score: ROI 35% + Margin 30% + Drop bonus 20% + Sales 15%
                roi_s   = min(100.0, stats_profit["roi"])
                marg_s  = min(100.0, stats_profit["margin"] * 2.0)
                drop_s  = min(100.0, drop_pct * 2.0)
                sales_s = min(100.0, float(sales_30d or 0) * 4.0)
                score   = round(roi_s * 0.35 + marg_s * 0.30 + drop_s * 0.20 + sales_s * 0.15, 1)

                imgs    = (product.get("imagesCSV") or "").split(",")
                img_url = f"https://images-na.ssl-images-amazon.com/images/I/{imgs[0]}" \
                          if imgs and imgs[0] else ""

                rank  += 1
                count += 1

                yield {
                    "rank":         rank,
                    "source":       "amazon",
                    "asin":         asin,
                    "ean":          ean,
                    "title":        (product.get("title") or ean).strip(),
                    "ek":           round(ek, 2),
                    "avg90_price":  round(avg90_price, 2),
                    "drop_pct":     round(drop_pct, 1),
                    "sell_price":   round(float(vk), 2),
                    "profit":       stats_profit["profit"],
                    "margin_pct":   stats_profit["margin"],
                    "roi_pct":      stats_profit["roi"],
                    "score":        score,
                    "verdict":      "BUY" if score >= 65 else "HOLD",
                    "sales_30d":    sales_30d,
                    "days_to_cash": days_to_cash,
                    "image_url":    img_url,
                    "item_url":     f"https://www.amazon.de/dp/{asin}",
                    "category":     cat["label"],
                }


@app.get("/deals/amazon/stream")
async def amazon_deals_stream(
    budget:       float = 150.0,
    min_margin:   float = 20.0,
    min_roi:      float = 15.0,
    min_drop_pct: float = 15.0,
    limit:        int   = 20,
    categories:   str   = "",
    mode:         str   = "mid",
):
    """SSE — streams Amazon→eBay flip deals as they are found."""
    cat_list = [c.strip() for c in categories.split(",") if c.strip()] if categories else []

    async def generate():
        yield ": connected\n\n"
        try:
            async for deal in _iter_amazon_deals(
                budget, min_margin, min_roi, min_drop_pct, limit, cat_list, mode
            ):
                yield f"data: {_json.dumps(deal)}\n\n"
        except Exception as exc:
            yield f'event: error\ndata: {_json.dumps({"error": str(exc)})}\n\n'
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/deals/amazon/scan")
async def amazon_deals_scan(body: AmazonDealScanBody):
    """Batch — returns all Amazon→eBay flip deals at once."""
    cat_list = [c.strip() for c in body.categories.split(",") if c.strip()] if body.categories else []
    results = []
    async for deal in _iter_amazon_deals(
        body.budget, body.min_margin, body.min_roi, body.min_drop_pct,
        body.limit, cat_list, body.mode,
    ):
        results.append(deal)
    results.sort(key=lambda x: x["score"], reverse=True)
    return {"ok": True, "deals": results, "count": len(results), "source": "amazon"}


# ─── Competition Monitor helpers ─────────────────────────────────────────────
def _format_listing(item: Dict[str, Any]) -> Dict[str, Any]:
    """Standardise a Browse API item_summary for the competition endpoints."""
    try:    price = float((item.get("price") or {}).get("value", 0))
    except Exception: price = 0.0

    shipping_cost: Optional[float] = None
    try:
        sc = ((item.get("shippingOptions") or [{}])[0]).get("shippingCost") or {}
        if sc.get("value") is not None:
            shipping_cost = float(sc["value"])
    except Exception:
        pass

    seller = item.get("seller") or {}
    return {
        "item_id":         item.get("itemId", ""),
        "title":           (item.get("title") or "")[:80],
        "price":           round(price, 2),
        "shipping":        round(shipping_cost, 2) if shipping_cost is not None else None,
        "total_price":     round(price + (shipping_cost or 0.0), 2),
        "condition":       item.get("condition", ""),
        "seller_id":       seller.get("username", ""),
        "seller_feedback": seller.get("feedbackScore"),
        "seller_pct":      seller.get("feedbackPercentage"),
        "image_url":       ((item.get("thumbnailImages") or [{}])[0]).get("imageUrl", ""),
        "item_url":        item.get("itemWebUrl", ""),
    }


@app.get("/seller/listings")
async def seller_listings(seller_id: str, limit: int = 50, q: str = ""):
    """Returns active Buy-It-Now listings for a given eBay seller username.
    eBay Browse API requires at least one of q/category_ids/epid/gtin.
    When no q is given we fall back to category_ids=0 (root = all categories).
    """
    loop = asyncio.get_event_loop()

    def fetch():
        try:
            params: Dict[str, str] = {
                "filter": f"sellers:{{{seller_id}}},buyingOptions:{{FIXED_PRICE}}",
                "limit": str(min(int(limit), 200)),
                "sort":  "price",
            }
            if q.strip():
                params["q"] = q.strip()
            else:
                params["category_ids"] = "0"   # root category → all listings
            data = ebay_request("GET", "item_summary/search", params)
            items = data.get("itemSummaries") or []
            return {
                "ok":       True,
                "seller_id": seller_id,
                "total":    data.get("total", len(items)),
                "items":    [_format_listing(i) for i in items],
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    return await loop.run_in_executor(None, fetch)


@app.get("/ean/competition")
async def ean_competition(ean: str, limit: int = 50):
    """Returns all current Buy-It-Now listings for an EAN, sorted by price."""
    loop = asyncio.get_event_loop()

    def fetch():
        try:
            data = ebay_request("GET", "item_summary/search", {
                "q": ean,
                "filter": "buyingOptions:{FIXED_PRICE}",
                "limit": str(min(int(limit), 100)),
                "sort": "price",
            })
            items = data.get("itemSummaries") or []
            return {
                "ok":    True,
                "ean":   ean,
                "total": data.get("total", len(items)),
                "items": [_format_listing(i) for i in items],
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    return await loop.run_in_executor(None, fetch)


@app.get("/compare")
async def compare_marketplaces(ean: str, ek: float = 0):
    """
    Live price comparison across eBay, Kaufland, and Amazon (via Keepa).
    All three platforms are fetched in parallel.
    """
    import concurrent.futures

    def fetch_ebay():
        try:
            return lookup_ebay_metrics(ean, ek)
        except Exception as exc:
            return {"_error": str(exc)}

    def fetch_kaufland():
        try:
            from kaufland import check_ean
            return check_ean(ean)
        except Exception as exc:
            return {"_error": str(exc)}

    def fetch_amazon():
        try:
            from keepa_api import get_amazon_price
            return get_amazon_price(ean) or {}
        except Exception as exc:
            return {"_error": str(exc)}

    # Run all three concurrently in a thread pool
    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        f_ebay     = pool.submit(fetch_ebay)
        f_kaufland = pool.submit(fetch_kaufland)
        f_amazon   = pool.submit(fetch_amazon)
        ebay_raw   = await loop.run_in_executor(None, f_ebay.result)
        kauf_raw   = await loop.run_in_executor(None, f_kaufland.result)
        amz_raw    = await loop.run_in_executor(None, f_amazon.result)

    # ── eBay ─────────────────────────────────────────────────────────────────
    ebay_price = ebay_raw.get("sell_price_median") or ebay_raw.get("sell_price_avg")
    ebay = {
        "price":         ebay_price,
        "price_avg":     ebay_raw.get("sell_price_avg"),
        "price_min":     ebay_raw.get("price_min"),
        "price_max":     ebay_raw.get("price_max"),
        "listing_count": ebay_raw.get("listing_count"),
        "sales_30d":     ebay_raw.get("sales_30d"),
        "days_to_cash":  ebay_raw.get("days_to_cash"),
        "verdict":       ebay_raw.get("verdict"),
        "available":     ebay_price is not None,
    }

    # ── Kaufland ─────────────────────────────────────────────────────────────
    VALID_KAUF_LABELS = {"HOT", "OK", "RISK"}
    kauf_ok    = kauf_raw and not kauf_raw.get("_error") and kauf_raw.get("ok") is not False
    kauf_price = kauf_raw.get("min_total_new") if kauf_ok else None
    kauf_label_raw = kauf_raw.get("label") if kauf_raw else None
    # Distinguish real demand labels from internal error strings
    kauf_demand_label = kauf_label_raw if kauf_label_raw in VALID_KAUF_LABELS else None
    kauf_error        = None
    if kauf_raw and not kauf_ok:
        kauf_error = kauf_raw.get("_error") or kauf_label_raw or "BLOCKED"
    elif kauf_raw and kauf_price is None:
        kauf_error = kauf_label_raw  # NOT_FOUND / NO_MATCH

    kaufland = {
        "price":          kauf_price,
        "min_price":      kauf_raw.get("min_price_new")   if kauf_raw else None,
        "min_shipping":   kauf_raw.get("min_shipping_new") if kauf_raw else None,
        "offers_count":   kauf_raw.get("offers_count_new") if kauf_raw else None,
        "bestseller":     kauf_raw.get("bestseller")       if kauf_raw else None,
        "demand_score":   kauf_raw.get("score")            if kauf_raw and kauf_demand_label else None,
        "demand_label":   kauf_demand_label,
        "product_id":     kauf_raw.get("product_id")       if kauf_raw else None,
        "error_reason":   kauf_error,
        "available":      kauf_price is not None,
    }

    # ── Amazon (Keepa) ────────────────────────────────────────────────────────
    amz_has_error  = bool(amz_raw.get("_error")) if amz_raw else True
    amz_has_result = bool(amz_raw.get("asin"))   if amz_raw else False  # Keepa found the product
    amz_price      = amz_raw.get("best_price")   if amz_raw and not amz_has_error else None
    amz_error      = None
    if amz_has_error:
        amz_error = amz_raw.get("_error") if amz_raw else "Keepa API nicht erreichbar"
    elif not amz_has_result:
        amz_error = "NOT_FOUND"   # Product not listed on Amazon.de
    elif amz_price is None:
        amz_error = "NO_PRICE"    # Listed but no current price tracked

    amazon = {
        "price":           amz_price,
        "buybox_price":    amz_raw.get("buybox_price")    if amz_raw else None,
        "marketplace_new": amz_raw.get("marketplace_new") if amz_raw else None,
        "amazon_direct":   amz_raw.get("amazon_price")    if amz_raw else None,
        "new_3p":          amz_raw.get("new_3p")          if amz_raw else None,
        "asin":            amz_raw.get("asin")             if amz_raw else None,
        "tokens_left":     amz_raw.get("tokens_left")     if amz_raw else None,
        "error_reason":    amz_error,
        "available":       amz_price is not None,
    }

    title     = (ebay_raw.get("title")
                 or (amz_raw.get("title") if amz_raw else None)
                 or ean)
    image_url = ebay_raw.get("image_url")

    return {
        "ean":       ean,
        "title":     title,
        "image_url": image_url,
        "ebay":      ebay,
        "kaufland":  kaufland,
        "amazon":    amazon,
    }


# ─────────────────────────────────────────────
# AMAZON CHECK
# ─────────────────────────────────────────────
class AmazonCheckRequest(BaseModel):
    asin:     str
    ean:      Optional[str] = None
    ek:       float = 0.0
    mode:     str   = "mid"
    method:   str   = "fba"
    ship_in:  float = 0.0
    category: str   = "sonstiges"
    prep_fee: float = 0.0
    vat_mode: str   = "no_vat"  # "no_vat" | "ust_19"
    ek_mode:  str   = "gross"   # "gross" | "net"


@app.post("/amazon-check")
async def amazon_check_endpoint(req: AmazonCheckRequest):
    result = await _amazon_check(
        asin     = req.asin,
        ean      = req.ean,
        ek       = req.ek,
        mode     = req.mode,
        method   = req.method,
        ship_in  = req.ship_in,
        category = req.category,
        prep_fee = req.prep_fee,
        vat_mode = req.vat_mode,
        ek_mode  = req.ek_mode,
    )
    return result


# ── Admin: Live-Cookie-Update (kein Restart nötig) ───────────────────────────
class CookieUpdateBody(BaseModel):
    cookie: str

@app.post("/admin/update-research-cookie")
async def update_research_cookie(request: Request, body: CookieUpdateBody):
    """Update EBAY_RESEARCH_COOKIE at runtime without server restart.
    Auth: valid gate JWT required (owner only).
    """
    import ebay_live

    # Verify JWT
    auth_header = request.headers.get("Authorization", "")
    token = (auth_header[7:] if auth_header.startswith("Bearer ") else auth_header).strip()
    if not token:
        return JSONResponse({"ok": False, "error": "unauthorized"}, status_code=401)
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        return JSONResponse({"ok": False, "error": "invalid token"}, status_code=401)

    # Only allow the account owner (Discord ID stored in env)
    admin_id = os.getenv("ADMIN_DISCORD_ID", "")
    if admin_id and payload.get("discord_id") != admin_id:
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=403)

    cookie = body.cookie.strip()
    if not cookie:
        return JSONResponse({"ok": False, "error": "empty cookie"}, status_code=400)

    # Update in-memory variable used by fetch_research_stats
    ebay_live.EBAY_RESEARCH_COOKIE = cookie

    # Clear research cache so next request uses the fresh cookie
    ebay_live._RESEARCH_CACHE.clear()

    # Persist to .env so it survives restart
    env_path = BASE_DIR / ".env"
    try:
        if env_path.exists():
            import re as _re
            env_text = env_path.read_text(encoding="utf-8")
            # Use lambda to avoid regex backreference interpretation of cookie chars
            env_text = _re.sub(r"EBAY_RESEARCH_COOKIE=.*", lambda _: f"EBAY_RESEARCH_COOKIE={cookie}", env_text)
            env_path.write_text(env_text, encoding="utf-8")
    except Exception:
        pass  # In-memory update succeeded; .env persist failure is non-fatal

    return JSONResponse({"ok": True, "msg": "Cookie aktualisiert, Cache geleert."})


if __name__ == "__main__":
    import os
    import uvicorn

    port = int(os.getenv("FLIPCHECK_PORT", "8000"))
    host = os.getenv("FLIPCHECK_HOST", "127.0.0.1")

    uvicorn.run(app, host=host, port=port, log_level="warning")
