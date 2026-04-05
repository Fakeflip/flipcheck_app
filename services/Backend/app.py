from __future__ import annotations

import sys as _sys, os as _os

# Load .env FIRST — before any submodule reads os.environ at import time
# (amazon.py captures KEEPA_API_KEY at module level).
_env_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), ".env")
try:
    from dotenv import load_dotenv as _load_dotenv
    _load_dotenv(_env_path, override=False)  # override=False: real env vars always win
except ImportError:
    pass  # python-dotenv not installed — rely on OS-level env vars

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


@app.on_event("startup")
async def _startup_warm_sessions():
    """Pre-init StockX + GOAT sessions so first check is fast."""
    try:
        from sneaker import warm_up
        warm_up()
    except ImportError:
        pass


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
        ean              = (body.get("ean")      or "").strip()
        ek_raw           = str(body.get("ek", "") if body.get("ek") is not None else "")
        mode             = (body.get("mode")     or "mid").strip().lower()
        category         = (body.get("category") or "sonstiges").strip().lower()
        shipping_in      = _to_float(str(body.get("shipping_in")  or 0)) or 0
        shipping_out     = _to_float(str(body.get("shipping_out") or 0)) or 0
        vat_mode         = (body.get("vat_mode") or "no_vat").strip().lower()
        ek_mode          = (body.get("ek_mode")  or "gross").strip().lower()
        ship_mode        = (body.get("ship_mode") or "gross").strip().lower()
        try:
            trends_day_range = max(1, min(365, int(body.get("trends_day_range") or 30)))
        except (ValueError, TypeError):
            trends_day_range = 30
    else:
        form = await request.form()
        ean              = (form.get("ean")      or "").strip()
        ek_raw           = str(form.get("ek", "") if form.get("ek") is not None else "")
        mode             = (form.get("mode")     or "mid").strip().lower()
        category         = (form.get("category") or "sonstiges").strip().lower()
        shipping_in      = _to_float(str(form.get("shipping_in")  or 0)) or 0
        shipping_out     = _to_float(str(form.get("shipping_out") or 0)) or 0
        vat_mode         = (form.get("vat_mode") or "no_vat").strip().lower()
        ek_mode          = (form.get("ek_mode")  or "gross").strip().lower()
        ship_mode        = (form.get("ship_mode") or "gross").strip().lower()
        try:
            trends_day_range = max(1, min(365, int(form.get("trends_day_range") or 30)))
        except (ValueError, TypeError):
            trends_day_range = 30

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

    # Market selection (default: ebay)
    _src = body if is_json else form
    market = (_src.get("market") or "ebay").strip().lower()

    # ── Kaufland branch ──────────────────────────────────────────────────────
    if market == "kaufland":
        try:
            from kaufland import check_ean as kl_check
            import asyncio
            kl = await asyncio.get_event_loop().run_in_executor(None, kl_check, ean)
        except Exception as e:
            return JSONResponse({"ok": False, "verdict": "SKIP", "error": f"Kaufland-Check fehlgeschlagen: {e}"})

        # VK Custom override
        _sell_custom = _to_float(str((_src.get("sell_custom") or "")))
        sell = _sell_custom if _sell_custom and _sell_custom > 0 else kl.get("min_total_new")
        if not sell:
            return JSONResponse({"ok": False, "verdict": "SKIP", "error": "Kein Kaufland-Preis gefunden"})

        kl_fee_pcts = {
            "kl_elektronik": 0.085, "kl_handys": 0.085, "kl_gaming": 0.085,
            "kl_foto": 0.085, "kl_haushalt_el": 0.085, "kl_buecher": 0.085,
            "kl_sport": 0.105, "kl_spielzeug": 0.105, "kl_haushalt": 0.105,
            "kl_garten": 0.105, "kl_mode": 0.175, "kl_sonstiges": 0.105,
        }
        fee_pct = kl_fee_pcts.get(category, 0.105)
        fee = round(sell * fee_pct, 2)

        ek_adj = ek / vat_factor if is_vat and ek_mode == "gross" else ek
        sell_adj = sell / vat_factor if is_vat else sell
        fee_adj = fee / vat_factor if is_vat else fee
        ship_in_adj = (shipping_in / vat_factor) if (is_vat and ship_mode == "gross") else shipping_in
        ship_out_adj = (shipping_out / vat_factor) if (is_vat and ship_mode == "gross") else shipping_out

        profit = round(sell_adj - ek_adj - fee_adj - ship_in_adj - ship_out_adj, 2)
        margin = round((profit / sell_adj * 100), 1) if sell_adj > 0 else 0

        verdict = "BUY" if margin >= 15 and profit >= 3 else ("HOLD" if margin >= 8 else "SKIP")

        # Best offer details
        best_new = kl.get("best_offer_new") or {}

        # ── Cross-market volume hints (non-blocking, best-effort) ──
        vol_ebay, vol_amazon = None, None
        try:
            from ebay_live import fetch_research_stats
            ebay_res = await asyncio.get_event_loop().run_in_executor(None, fetch_research_stats, ean)
            if ebay_res and ebay_res.get("monthly_sales"):
                vol_ebay = ebay_res["monthly_sales"]
        except Exception:
            pass
        try:
            from amazon import amazon_check
            amz = await amazon_check(ean, ean, 0)
            if amz and amz.get("sales_30d"):
                vol_amazon = amz["sales_30d"]
        except Exception:
            pass

        pid = kl.get("product_id")
        return JSONResponse({
            "ok": True,
            "ean": ean,
            "market": "kaufland",
            "verdict": verdict,
            "sell_price_avg": sell,
            "sell_price_median": sell,
            "profit_median": profit,
            "profit_avg": profit,
            "margin_pct": margin,
            "fees_median": fee,
            "fee_rate": fee_pct,
            "offers_count": kl.get("offers_count_new", 0),
            "bestseller": kl.get("bestseller", False),
            "rating": kl.get("rating"),
            "review_count": kl.get("review_count"),
            "score": kl.get("score"),
            "label": kl.get("label"),
            # Best offer breakdown
            "best_seller_name": best_new.get("seller_name"),
            "min_price_new": kl.get("min_price_new"),
            "min_shipping_new": kl.get("min_shipping_new"),
            "min_total_used": kl.get("min_total_used"),
            "product_url": f"https://www.kaufland.de/product/{pid}/" if pid else None,
            # Cross-market volume hints
            "volume_hint_ebay": vol_ebay,
            "volume_hint_amazon": vol_amazon,
            # Compat fields
            "days_to_cash": None,
            "sales_30d": None,
            "price_series": [],
            "qty_series": [],
            "trending": None,
        })

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
        m = lookup_ebay_metrics(ean, float(ek), trends_day_range=trends_day_range)
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
    _ebay_sell_custom = _to_float(str((_src.get("sell_custom") or "")))
    sell_avg_gross = _ebay_sell_custom if _ebay_sell_custom and _ebay_sell_custom > 0 else float(m.get("sell_price_avg") or 0)
    sell_med_gross = _ebay_sell_custom if _ebay_sell_custom and _ebay_sell_custom > 0 else float(m.get("sell_price_median") or 0)

    # VAT: eBay prices are gross (inkl. MwSt). For Regelbesteuerer, work in net.
    # eBay fees are charged on gross price but you recover the VAT (Vorsteuer),
    # so effective fee = fee_gross / 1.19.
    sell_avg_adj = sell_avg_gross / vat_factor
    sell_med_adj = sell_med_gross / vat_factor

    # EK: if entered gross & VAT active → divide; if already net → keep as-is
    ek_adj = (float(ek) / vat_factor) if (is_vat and ek_mode == "gross") else float(ek)

    # Shipping: gross → divide by vat_factor; net → use as-is
    ship_in_adj  = (shipping_in  / vat_factor) if (is_vat and ship_mode == "gross") else shipping_in
    ship_out_adj = (shipping_out / vat_factor) if (is_vat and ship_mode == "gross") else shipping_out

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

    # If sell_custom was given, override the displayed sell prices too
    if _ebay_sell_custom and _ebay_sell_custom > 0:
        m["sell_price_median"] = _ebay_sell_custom
        m["sell_price_avg"]    = _ebay_sell_custom

    verdict, reason, text = decide(mode=mode, m=m, custom_th=custom_th)

    if is_json:
        debug = m.get("debug", {})
        return JSONResponse({
            "ean":              ean,
            "ek":               round(float(ek), 2),
            "title":            debug.get("rep_title") or ean,
            "product_image":    debug.get("rep_image"),
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
            "offer_count":      debug.get("offer_count"),
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
    ship_mode: str  = "gross"   # "gross" | "net"
    sell_custom: Optional[float] = None


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
        ship_mode = req.ship_mode,
        sell_custom = req.sell_custom,
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


# ─── eBay Seller Auth + Repricer ──────────────────────────────────────────────
try:
    from ebay_seller import (
        seller_auth_url, seller_token_exchange, bulk_revise_prices,
        is_connected, is_legacy_mode, get_my_active_listings, get_my_sold_list,
        add_legacy_token, remove_legacy_token,
        get_sold_with_financials, get_order_financials,
        get_sold_with_details, get_orders_details,
        parse_seller_token, encode_seller_token,
        complete_sale as ebay_complete_sale,
    )
    _SELLER_AVAILABLE = True
except ImportError:
    _SELLER_AVAILABLE = False

    def seller_auth_url(): return ""  # type: ignore[misc]
    async def seller_token_exchange(code): return {"ok": False, "error": "ebay_seller module not available"}  # type: ignore[misc]
    async def bulk_revise_prices(updates, token_data=None): return {"success": [], "failed": []}  # type: ignore[misc]
    def is_connected(td=None): return False  # type: ignore[misc]
    def is_legacy_mode(td=None): return False  # type: ignore[misc]
    async def get_my_active_listings(**_): return {"ok": False, "items": []}  # type: ignore[misc]
    async def get_my_sold_list(**_): return {"ok": False, "items": []}  # type: ignore[misc]
    async def get_sold_with_financials(**_): return {"ok": False, "items": []}  # type: ignore[misc]
    async def get_sold_with_details(**_): return {"ok": False, "items": []}  # type: ignore[misc]
    async def get_order_financials(order_ids, token_data=None): return {}  # type: ignore[misc]
    async def get_orders_details(order_ids, token_data=None): return {}  # type: ignore[misc]
    def add_legacy_token(td, token): return {}  # type: ignore[misc]
    def remove_legacy_token(td=None): return None  # type: ignore[misc]
    def parse_seller_token(raw): return None  # type: ignore[misc]
    def encode_seller_token(data): return ""  # type: ignore[misc]


def _get_seller_token_from_request(request) -> dict | None:
    """Extract seller token from X-eBay-Seller-Token header."""
    raw = request.headers.get("x-ebay-seller-token", "")
    return parse_seller_token(raw) if raw else None


@app.get("/seller/auth/url")
async def seller_auth_url_endpoint():
    """Return the eBay OAuth2 consent URL for seller authorization."""
    if not _SELLER_AVAILABLE:
        return JSONResponse({"ok": False, "error": "eBay seller module not configured"}, status_code=503)
    return {"ok": True, "url": seller_auth_url()}


@app.get("/seller/auth/callback")
async def seller_auth_callback(code: str):
    """Exchange authorization code for access token. Redirects to Electron deep link with token."""
    if not _SELLER_AVAILABLE:
        return JSONResponse({"ok": False, "error": "eBay seller module not configured"}, status_code=503)
    try:
        result = await seller_token_exchange(code)
        seller_token = result.get("seller_token", "")
        # Redirect to Electron app via deep link — client stores the token locally
        from starlette.responses import RedirectResponse
        return RedirectResponse(f"flipcheck://seller-token?t={seller_token}")
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.get("/seller/auth/status")
async def seller_auth_status(request: Request):
    """Check whether a seller token exists (from client-provided header)."""
    if not _SELLER_AVAILABLE:
        return {"ok": True, "connected": False, "is_legacy": False}
    td = _get_seller_token_from_request(request)
    return {
        "ok":        True,
        "connected": is_connected(td),
        "is_legacy": is_legacy_mode(td),
    }


class LegacyTokenBody(BaseModel):
    token: str


@app.post("/seller/auth/legacy")
async def seller_auth_legacy_set(body: LegacyTokenBody, request: Request):
    """Add a legacy eBay Auth'n'Auth token. Returns updated seller_token for client storage."""
    if not _SELLER_AVAILABLE:
        return JSONResponse({"ok": False, "error": "eBay seller module not configured"}, status_code=503)
    if not body.token.strip():
        return JSONResponse({"ok": False, "error": "Token darf nicht leer sein"}, status_code=400)
    try:
        td = _get_seller_token_from_request(request)
        updated = add_legacy_token(td, body.token)
        return {"ok": True, "is_legacy": True, "seller_token": encode_seller_token(updated)}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.delete("/seller/auth/legacy")
async def seller_auth_legacy_remove(request: Request):
    """Remove the legacy token. Returns updated seller_token for client storage."""
    if not _SELLER_AVAILABLE:
        return JSONResponse({"ok": False, "error": "eBay seller module not configured"}, status_code=503)
    try:
        td = _get_seller_token_from_request(request)
        updated = remove_legacy_token(td)
        return {
            "ok": True,
            "is_legacy": False,
            "seller_token": encode_seller_token(updated) if updated else None,
        }
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.delete("/seller/auth/disconnect")
async def seller_auth_disconnect():
    """Client should delete its local seller token. Server has nothing to delete."""
    return {"ok": True}


class RepricerItem(BaseModel):
    sku: str
    ean: str
    ebay_item_id: Optional[str] = None   # eBay ItemID (from GetMyeBaySelling)
    ek: float
    ship_out: float = 0.0
    current_price: float
    rule: dict = {}
    # rule keys:
    #   min_margin_pct:        float  (default 15)
    #     Floor protection: EK × (1 + min_margin%) + ship_out
    #
    #   price_strategy:        str    (default "cheapest")
    #     "cheapest"  → match rank 1 (cheapest in market)
    #     "rank_2"    → match rank 2 (2nd cheapest)
    #     "rank_3"    → match rank 3 (3rd cheapest)
    #     "avg_top3"  → average of 3 cheapest
    #     "avg_top5"  → average of 5 cheapest
    #
    #   raise_when_cheapest:   bool   (default True)
    #     Only applies to price_strategy="cheapest":
    #     if you ARE already cheapest → raise to rank 2 instead of staying
    #
    #   commercial_only:       bool   (default False)
    #     Filter out private/new sellers (feedbackScore < commercial_min_feedback)
    #
    #   commercial_min_feedback: int  (default 10)
    #     Minimum seller feedbackScore to be considered a commercial competitor


# ── Repricer helpers ──────────────────────────────────────────────────────────

def _apply_price_strategy(
    strategy: str,
    candidates: List[float],
    current_price: float,
    raise_when_cheapest: bool,
    research_avg: Optional[float] = None,
    research_med: Optional[float] = None,
) -> Tuple[float, str]:
    """
    Given a sorted list of candidate prices (cheapest first), return
    (target_price, price_intent).
    price_intent: "match" | "raise" | "no_data"

    Strategies:
      cheapest   → rank 1 active listing
      rank_2     → rank 2 active listing
      rank_3     → rank 3 active listing
      avg_top3   → mean of top 3 cheapest active listings
      avg_top5   → mean of top 5 cheapest active listings
      avg_30d    → 30-day average sold price (Research API)
      median_30d → 30-day median sold price (Research API)
    """
    # Research-based strategies (don't need active listings)
    if strategy == "avg_30d":
        if research_avg is None:
            return current_price, "no_data"
        return round(research_avg, 2), "match"

    if strategy == "median_30d":
        if research_med is None:
            return current_price, "no_data"
        return round(research_med, 2), "match"

    if not candidates:
        return current_price, "no_data"

    if strategy == "rank_2":
        target = candidates[1] if len(candidates) >= 2 else candidates[0]
        return target, "match"

    if strategy == "rank_3":
        target = candidates[2] if len(candidates) >= 3 else candidates[-1]
        return target, "match"

    if strategy == "avg_top3":
        pool   = candidates[:3]
        target = round(sum(pool) / len(pool), 2)
        return target, "match"

    if strategy == "avg_top5":
        pool   = candidates[:5]
        target = round(sum(pool) / len(pool), 2)
        return target, "match"

    # Default: "cheapest" — match rank 1, optionally raise if already cheapest
    cheapest = candidates[0]
    seller_is_cheapest = current_price <= cheapest + 0.005
    if seller_is_cheapest and raise_when_cheapest and len(candidates) >= 2:
        return candidates[1], "raise"
    return cheapest, "match"


@app.post("/repricer/update")
async def repricer_update(items: list[RepricerItem], request: Request):
    """
    For each item:
      1. Fetch up to 15 competitor listings via Browse API (sorted cheapest first).
      2. Optionally filter out private/new sellers (commercial_only).
      3. Apply price_strategy to select target price.
      4. Floor-protect: new_price = max(floor_price, target).
      5. Call eBay ReviseFixedPriceItem (Trading API) via ebay_item_id.

    Statuses: UPDATED | RAISED | HOLD | AT_FLOOR | EBAY_FAILED
    """
    if not items:
        return {"ok": True, "updates": []}

    loop         = asyncio.get_event_loop()
    updates      = []
    ebay_updates = []

    for item in items:
        rule                 = item.rule or {}
        min_margin           = float(rule.get("min_margin_pct",        15))
        price_strategy       = str(  rule.get("price_strategy",        "cheapest"))
        raise_when_cheapest  = bool( rule.get("raise_when_cheapest",   True))
        commercial_only      = bool( rule.get("commercial_only",       False))
        commercial_min_fb    = int(  rule.get("commercial_min_feedback", 10))
        ebay_category        = str(  rule.get("ebay_category",         "sonstiges"))

        # Floor price: never sell below this
        # Formula: (EK * (1 + margin%) + ship_out) / (1 - eBay_fee)
        # eBay_fee is tiered by category — use _effective_fee_rate() for accurate calculation
        ref_price   = item.ek * (1 + min_margin / 100) + item.ship_out
        ebay_fee    = _effective_fee_rate(ref_price, ebay_category)
        floor_price = round(ref_price / (1 - ebay_fee), 2)

        # ── Fetch competitor listings ─────────────────────────────────────────
        fetch_limit = 15
        candidate_prices: List[float] = []
        competitor_min: Optional[float] = None
        competitor_2nd: Optional[float] = None
        research_avg: Optional[float] = None
        research_med: Optional[float] = None

        try:
            def _fetch_comp(ean=item.ean, limit=fetch_limit, comm_only=commercial_only, min_fb=commercial_min_fb):
                try:
                    data = ebay_request("GET", "item_summary/search", {
                        "q":      ean,
                        "filter": "buyingOptions:{FIXED_PRICE}",
                        "limit":  str(limit),
                        "sort":   "price",
                    })
                    raw_items = data.get("itemSummaries") or []
                    prices = []
                    for ci in raw_items:
                        f  = _format_listing(ci)
                        fb = f.get("seller_feedback")
                        if comm_only and (fb is None or int(fb) < min_fb):
                            continue
                        p = f.get("total_price") or f.get("price")
                        if p and p > 0:
                            prices.append(round(p, 2))
                    return prices
                except Exception:
                    pass
                return []

            candidate_prices = await loop.run_in_executor(None, _fetch_comp)
            if candidate_prices:
                competitor_min = candidate_prices[0]
            if len(candidate_prices) >= 2:
                competitor_2nd = candidate_prices[1]
        except Exception:
            pass

        # ── Research-based strategies: fetch 30-day sold avg/median ──────────
        if price_strategy in ("avg_30d", "median_30d") and item.ean:
            try:
                def _fetch_research(ean=item.ean):
                    try:
                        r = fetch_research_stats(ean, day_range=30)
                        return r
                    except Exception:
                        return None
                research = await loop.run_in_executor(None, _fetch_research)
                if research:
                    research_avg = research.get("avg_price")
                    research_med = research.get("median_price")
            except Exception:
                pass

        # ── Pricing decision ──────────────────────────────────────────────────
        raw_target, price_intent = _apply_price_strategy(
            price_strategy, candidate_prices, item.current_price, raise_when_cheapest,
            research_avg=research_avg, research_med=research_med,
        )
        new_price = round(max(floor_price, raw_target), 2)

        # ── Status ────────────────────────────────────────────────────────────
        diff = new_price - item.current_price
        if abs(diff) < 0.01:
            status = "HOLD"
        elif price_intent == "raise" and diff > 0.01:
            status = "RAISED"
        elif new_price <= floor_price + 0.01 and competitor_min is not None and competitor_min < floor_price:
            status = "AT_FLOOR"
        elif price_intent == "no_data":
            status = "HOLD"   # no competitors found — keep current price
        else:
            status = "UPDATED"

        result = {
            "sku":              item.sku,
            "ean":              item.ean,
            "ebay_item_id":     item.ebay_item_id,
            "old_price":        item.current_price,
            "new_price":        new_price,
            "floor_price":      floor_price,
            "ebay_fee_pct":     round(ebay_fee * 100, 1),
            "ebay_category":    ebay_category,
            "competitor_min":   competitor_min,
            "competitor_2nd":   competitor_2nd,
            "candidate_count":  len(candidate_prices),
            "price_strategy":   price_strategy,
            "research_avg":     research_avg,
            "research_med":     research_med,
            "status":           status,
        }
        updates.append(result)

        if status in ("UPDATED", "RAISED"):
            if not item.ebay_item_id:
                # No real eBay item ID — can't push. Mark separately so UI can warn.
                result["status"]     = "NO_EBAY_ID"
                result["ebay_error"] = "Keine eBay-Item-ID — bitte 'Listings sync' nutzen"
            else:
                ebay_updates.append({"item_id": item.ebay_item_id, "new_price": new_price})

    # Push to eBay via Trading API ReviseFixedPriceItem
    ebay_result: Dict = {"success": [], "failed": []}
    if ebay_updates and _SELLER_AVAILABLE:
        try:
            td = _get_seller_token_from_request(request)
            ebay_result = await bulk_revise_prices(ebay_updates, token_data=td)
        except Exception as e:
            for u in ebay_updates:
                ebay_result.setdefault("failed", []).append({"item_id": u["item_id"], "error": str(e)})

    # Annotate with eBay push outcome
    ebay_fail_ids = {f["item_id"] for f in ebay_result.get("failed", [])}
    for upd in updates:
        effective_id = upd.get("ebay_item_id")
        if upd["status"] in ("UPDATED", "RAISED") and effective_id and effective_id in ebay_fail_ids:
            fail_err = next(
                (f["error"] for f in ebay_result["failed"] if f["item_id"] == effective_id),
                "unknown",
            )
            upd["status"]     = "EBAY_FAILED"
            upd["ebay_error"] = fail_err

    return {"ok": True, "updates": updates}


@app.get("/seller/listings/active")
async def seller_active_listings(request: Request, page: int = 1, per_page: int = 100):
    """Fetch seller's own active eBay listings (for repricer auto-match)."""
    if not _SELLER_AVAILABLE:
        return JSONResponse({"ok": False, "error": "eBay seller not configured"}, status_code=503)
    td = _get_seller_token_from_request(request)
    if not td:
        return JSONResponse({"ok": False, "error": "No seller token provided"}, status_code=401)
    try:
        return await get_my_active_listings(page=page, per_page=min(int(per_page), 200), token_data=td)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.get("/seller/listings/sold")
async def seller_sold_listings(request: Request, page: int = 1, per_page: int = 100, days: int = 60, financials: bool = True, details: bool = True):
    """Fetch seller's recently sold items, enriched with real eBay fees + buyer address if available."""
    if not _SELLER_AVAILABLE:
        return JSONResponse({"ok": False, "error": "eBay seller not configured"}, status_code=503)
    td = _get_seller_token_from_request(request)
    if not td:
        return JSONResponse({"ok": False, "error": "No seller token provided"}, status_code=401)
    try:
        pp = min(int(per_page), 200)
        d = min(int(days), 60)
        if details and financials:
            return await get_sold_with_details(page=page, per_page=pp, days=d, token_data=td)
        if financials:
            return await get_sold_with_financials(page=page, per_page=pp, days=d, token_data=td)
        return await get_my_sold_list(page=page, per_page=pp, days=d, token_data=td)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


class CompleteSaleBody(BaseModel):
    item_id: str
    transaction_id: str
    tracking_number: str
    carrier: str = "DHL"


@app.post("/seller/shipment/complete")
async def seller_complete_sale(body: CompleteSaleBody, request: Request):
    """Mark an eBay order as shipped with tracking info via CompleteSale."""
    if not _SELLER_AVAILABLE:
        return JSONResponse({"ok": False, "error": "eBay seller not configured"}, status_code=503)
    td = _get_seller_token_from_request(request)
    if not td:
        return JSONResponse({"ok": False, "error": "No seller token provided"}, status_code=401)
    try:
        from ebay_seller import get_token_for_trading
        token, is_legacy, new_td = await get_token_for_trading(td)
        result = await ebay_complete_sale(
            item_id=body.item_id,
            transaction_id=body.transaction_id,
            tracking_number=body.tracking_number,
            carrier=body.carrier,
            token=token,
            legacy=is_legacy,
        )
        if new_td:
            result["updated_token"] = encode_seller_token(new_td)
        return result
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


# ─── Kaufland Seller API ─────────────────────────────────────────────────────
try:
    from kaufland_seller import (
        verify_credentials as kl_verify_credentials,
        get_active_units as kl_get_active_units,
        get_orders as kl_get_orders,
        update_unit_price as kl_update_unit_price,
        send_order_unit as kl_send_order_unit,
        parse_kaufland_creds,
    )
    _KAUFLAND_SELLER_AVAILABLE = True
except ImportError:
    _KAUFLAND_SELLER_AVAILABLE = False

    async def kl_verify_credentials(ck, sk): return {"ok": False, "error": "kaufland_seller module not available"}  # type: ignore[misc]
    async def kl_get_active_units(ck, sk, **_): return {"ok": False, "items": []}  # type: ignore[misc]
    async def kl_get_orders(ck, sk, **_): return {"ok": False, "items": []}  # type: ignore[misc]
    async def kl_update_unit_price(ck, sk, uid, price): return {"ok": False, "error": "not available"}  # type: ignore[misc]
    async def kl_send_order_unit(ck, sk, ouid, tn, carrier="DHL"): return {"ok": False, "error": "not available"}  # type: ignore[misc]
    def parse_kaufland_creds(raw): return None  # type: ignore[misc]


def _get_kaufland_creds_from_request(request) -> tuple | None:
    """Extract client_key and secret_key from X-Kaufland-Credentials header (base64 JSON)."""
    raw = request.headers.get("x-kaufland-credentials", "")
    if not raw:
        return None
    creds = parse_kaufland_creds(raw)
    if creds:
        return creds.get("client_key"), creds.get("secret_key")
    return None


@app.get("/kaufland/auth/status")
async def kaufland_auth_status(request: Request):
    """Verify Kaufland API credentials."""
    if not _KAUFLAND_SELLER_AVAILABLE:
        return {"ok": False, "connected": False, "reason": "module_unavailable"}
    creds = _get_kaufland_creds_from_request(request)
    if not creds:
        return {"ok": True, "connected": False, "reason": "no_credentials"}
    try:
        result = await kl_verify_credentials(creds[0], creds[1])
        connected = result.get("connected", False)
        resp = {"ok": True, "connected": connected}
        if not connected and result.get("error"):
            resp["error"] = result["error"]
        return resp
    except Exception as e:
        return {"ok": False, "connected": False, "error": str(e)}


@app.get("/kaufland/listings/active")
async def kaufland_active_listings(request: Request, page: int = 1, per_page: int = 100):
    """Fetch seller's active Kaufland units."""
    if not _KAUFLAND_SELLER_AVAILABLE:
        return JSONResponse({"ok": False, "error": "Kaufland seller not configured"}, status_code=503)
    creds = _get_kaufland_creds_from_request(request)
    if not creds:
        return JSONResponse({"ok": False, "error": "No Kaufland credentials provided"}, status_code=401)
    try:
        return await kl_get_active_units(creds[0], creds[1], page=page, per_page=min(int(per_page), 200))
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.get("/kaufland/listings/sold")
async def kaufland_sold_listings(request: Request, page: int = 1, per_page: int = 100, days: int = 30):
    """Fetch seller's recent Kaufland orders."""
    if not _KAUFLAND_SELLER_AVAILABLE:
        return JSONResponse({"ok": False, "error": "Kaufland seller not configured"}, status_code=503)
    creds = _get_kaufland_creds_from_request(request)
    if not creds:
        return JSONResponse({"ok": False, "error": "No Kaufland credentials provided"}, status_code=401)
    try:
        return await kl_get_orders(creds[0], creds[1], days=min(int(days), 60), page=page, per_page=min(int(per_page), 200))
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


class KauflandShipBody(BaseModel):
    order_unit_id: str
    tracking_number: str
    carrier: str = "DHL"


@app.post("/kaufland/shipment/complete")
async def kaufland_complete_shipment(body: KauflandShipBody, request: Request):
    """Mark a Kaufland order unit as shipped with tracking info."""
    if not _KAUFLAND_SELLER_AVAILABLE:
        return JSONResponse({"ok": False, "error": "Kaufland seller not configured"}, status_code=503)
    creds = _get_kaufland_creds_from_request(request)
    if not creds:
        return JSONResponse({"ok": False, "error": "No Kaufland credentials provided"}, status_code=401)
    try:
        return await kl_send_order_unit(creds[0], creds[1], body.order_unit_id, body.tracking_number, body.carrier)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


class KauflandRepriceBody(BaseModel):
    unit_id: str
    new_price: float


@app.post("/kaufland/listings/reprice")
async def kaufland_reprice(body: KauflandRepriceBody, request: Request):
    """Update the price of a Kaufland unit."""
    if not _KAUFLAND_SELLER_AVAILABLE:
        return JSONResponse({"ok": False, "error": "Kaufland seller not configured"}, status_code=503)
    creds = _get_kaufland_creds_from_request(request)
    if not creds:
        return JSONResponse({"ok": False, "error": "No Kaufland credentials provided"}, status_code=401)
    try:
        return await kl_update_unit_price(creds[0], creds[1], body.unit_id, body.new_price)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


# ─── DHL Shipping API ────────────────────────────────────────────────────────
try:
    from dhl_shipping import (
        verify_credentials as dhl_verify_credentials,
        create_shipment as dhl_create_shipment,
        parse_dhl_creds,
    )
    _DHL_SHIPPING_AVAILABLE = True
except ImportError:
    _DHL_SHIPPING_AVAILABLE = False

    async def dhl_verify_credentials(creds): return {"ok": False, "error": "dhl_shipping module not available"}
    async def dhl_create_shipment(**kw): return {"ok": False, "error": "not available"}
    def parse_dhl_creds(raw): return None


def _get_dhl_creds_from_request(request) -> dict | None:
    """Extract DHL credentials from X-DHL-Credentials header (base64 JSON)."""
    raw = request.headers.get("x-dhl-credentials", "")
    if not raw:
        return None
    return parse_dhl_creds(raw)


@app.get("/dhl/auth/status")
async def dhl_auth_status(request: Request):
    """Verify DHL API credentials."""
    if not _DHL_SHIPPING_AVAILABLE:
        return {"ok": False, "connected": False, "reason": "module_unavailable"}
    creds = _get_dhl_creds_from_request(request)
    if not creds:
        return {"ok": True, "connected": False, "reason": "no_credentials"}
    try:
        result = await dhl_verify_credentials(creds)
        connected = result.get("connected", False)
        resp = {"ok": True, "connected": connected}
        if not connected and result.get("error"):
            resp["error"] = result["error"]
        return resp
    except Exception as e:
        return {"ok": False, "connected": False, "error": str(e)}


class DhlShipmentBody(BaseModel):
    sender: dict
    recipient: dict
    weight_kg: float = 1.0
    product: str = "V01PAK"
    reference: str = ""


@app.post("/dhl/shipments")
async def dhl_shipments(body: DhlShipmentBody, request: Request):
    """Create a DHL shipment and return the label."""
    if not _DHL_SHIPPING_AVAILABLE:
        return JSONResponse({"ok": False, "error": "DHL shipping not configured"}, status_code=503)
    creds = _get_dhl_creds_from_request(request)
    if not creds:
        return JSONResponse({"ok": False, "error": "No DHL credentials provided"}, status_code=401)
    try:
        return await dhl_create_shipment(
            creds=creds,
            sender=body.sender,
            recipient=body.recipient,
            weight_kg=body.weight_kg,
            product=body.product,
            reference=body.reference,
        )
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


# ── Sneaker Check (StockX + GOAT) ─────────────────────────────────────────────

class SneakerCheckRequest(BaseModel):
    sku: str
    ek: float = 0.0
    platform: str = "both"  # "stockx", "goat", "both"

@app.post("/sneaker-check")
async def sneaker_check_endpoint(req: SneakerCheckRequest):
    """Check sneaker profit — always runs both StockX + GOAT in parallel."""
    try:
        from sneaker import check_stockx, check_goat
    except ImportError as e:
        return JSONResponse({"ok": False, "error": f"Sneaker module not available: {e}"}, status_code=500)

    loop = asyncio.get_event_loop()

    # Always run both platforms in parallel
    async def _sx():
        try:
            return await loop.run_in_executor(None, check_stockx, req.sku, req.ek)
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def _goat():
        try:
            return await loop.run_in_executor(None, check_goat, req.sku, req.ek, "")
        except Exception as e:
            return {"ok": False, "error": str(e)}

    sx_result, goat_result = await asyncio.gather(_sx(), _goat())

    # Return the requested platform as top-level, but include both
    primary = req.platform or "stockx"
    result = dict(sx_result if primary == "stockx" else goat_result)
    result["_stockx"] = sx_result
    result["_goat"] = goat_result

    return result


# ══════════════════════════════════════════════════════════════════════════════
# ── API Key Auth + Rate Limiting ─────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════
#
# Keys are stored in a JSON file alongside .env.  Each key has:
#   { "key": "fc_...", "name": "Max Mustermann", "created": "...",
#     "rate_limit": 100, "active": true }
#
# Admin endpoints use FLIPCHECK_ADMIN_KEY from .env as master password.
# ─────────────────────────────────────────────────────────────────────────────

import hashlib as _hashlib
from collections import defaultdict as _defaultdict
from datetime import datetime as _datetime

_API_KEYS_FILE = os.path.join(str(BASE_DIR), ".api_keys.json")
_ADMIN_KEY = os.getenv("FLIPCHECK_ADMIN_KEY", "")

# In-memory rate limit counters: { key_hash: [(timestamp, ...), ...] }
_rate_windows: dict = _defaultdict(list)
_DEFAULT_RATE_LIMIT = 100   # requests per hour


def _load_api_keys() -> list:
    try:
        with open(_API_KEYS_FILE) as f:
            return _json.load(f)
    except Exception:
        return []


def _save_api_keys(keys: list):
    with open(_API_KEYS_FILE, "w") as f:
        _json.dump(keys, f, indent=2, default=str)


def _find_key(api_key: str) -> Optional[dict]:
    for k in _load_api_keys():
        if k.get("key") == api_key and k.get("active", True):
            return k
    return None


def _check_rate_limit(api_key: str, limit: int = _DEFAULT_RATE_LIMIT) -> tuple:
    """Returns (allowed: bool, remaining: int, reset_ts: int)."""
    now = time.time()
    window_start = now - 3600  # 1 hour window
    key_hash = _hashlib.sha256(api_key.encode()).hexdigest()[:16]

    # Clean old entries
    _rate_windows[key_hash] = [ts for ts in _rate_windows[key_hash] if ts > window_start]
    used = len(_rate_windows[key_hash])
    remaining = max(0, limit - used)

    if used >= limit:
        reset_ts = int(_rate_windows[key_hash][0] + 3600)
        return False, 0, reset_ts

    _rate_windows[key_hash].append(now)
    return True, remaining - 1, int(now + 3600)


def _require_api_key(request: Request) -> tuple:
    """Validate API key from header. Returns (key_record, error_response)."""
    api_key = request.headers.get("x-api-key", "").strip()
    if not api_key:
        return None, JSONResponse(
            {"ok": False, "error": "API key required. Send X-API-Key header."},
            status_code=401,
        )

    key_record = _find_key(api_key)
    if not key_record:
        return None, JSONResponse(
            {"ok": False, "error": "Invalid or inactive API key."},
            status_code=403,
        )

    limit = key_record.get("rate_limit", _DEFAULT_RATE_LIMIT)
    allowed, remaining, reset_ts = _check_rate_limit(api_key, limit)
    if not allowed:
        return None, JSONResponse(
            {"ok": False, "error": "Rate limit exceeded. Try again later.",
             "rate_limit": limit, "reset_at": reset_ts},
            status_code=429,
            headers={"X-RateLimit-Limit": str(limit), "X-RateLimit-Remaining": "0",
                      "X-RateLimit-Reset": str(reset_ts)},
        )

    return key_record, None


def _require_admin(request: Request):
    """Check admin key from header."""
    admin = request.headers.get("x-admin-key", "").strip()
    if not _ADMIN_KEY or admin != _ADMIN_KEY:
        return JSONResponse({"ok": False, "error": "Unauthorized"}, status_code=403)
    return None


# ── Admin: Key Management ────────────────────────────────────────────────────

@app.get("/api/v1/keys")
async def list_api_keys(request: Request):
    """List all API keys (admin only)."""
    err = _require_admin(request)
    if err:
        return err
    keys = _load_api_keys()
    # Hide full key, show only prefix
    safe = []
    for k in keys:
        safe.append({**k, "key": k["key"][:12] + "..." if len(k.get("key", "")) > 12 else k.get("key", "")})
    return {"ok": True, "keys": safe}


@app.post("/api/v1/keys")
async def create_api_key(request: Request):
    """Create a new API key (admin only).
    Body: { "name": "Max", "rate_limit": 100 }"""
    err = _require_admin(request)
    if err:
        return err
    try:
        body = await request.json()
    except Exception:
        body = {}
    name = body.get("name", "unnamed")
    rate_limit = int(body.get("rate_limit", _DEFAULT_RATE_LIMIT))
    new_key = f"fc_live_{secrets.token_urlsafe(32)}"
    record = {
        "key": new_key,
        "name": name,
        "rate_limit": rate_limit,
        "active": True,
        "created": _datetime.utcnow().isoformat(),
    }
    keys = _load_api_keys()
    keys.append(record)
    _save_api_keys(keys)
    return {"ok": True, "key": new_key, "name": name, "rate_limit": rate_limit}


@app.delete("/api/v1/keys/{key_prefix}")
async def revoke_api_key(request: Request, key_prefix: str):
    """Revoke an API key by prefix (admin only)."""
    err = _require_admin(request)
    if err:
        return err
    keys = _load_api_keys()
    found = False
    for k in keys:
        if k["key"].startswith(key_prefix):
            k["active"] = False
            found = True
    if not found:
        return JSONResponse({"ok": False, "error": "Key not found"}, status_code=404)
    _save_api_keys(keys)
    return {"ok": True, "revoked": key_prefix}


# ── Unified API v1 ────────────────────────────────────────────────────────────
# Single endpoint for all marketplace checks — for external integrations.
#
# POST /api/v1/check
# Headers: X-API-Key: fc_live_...
# Body: { "market": "ebay|amazon|kaufland|stockx|goat|sneaker", ... }

class UnifiedCheckRequest(BaseModel):
    market: str                         # ebay, amazon, kaufland, stockx, goat, sneaker
    ean: Optional[str] = None
    sku: Optional[str] = None
    asin: Optional[str] = None
    ek: float = 0.0
    mode: str = "mid"
    category: str = "sonstiges"
    shipping_in: float = 0.0
    shipping_out: float = 0.0
    vat_mode: str = "no_vat"
    ek_mode: str = "gross"
    ship_mode: str = "gross"
    trends_day_range: int = 30
    sell_custom: Optional[float] = None
    # Amazon-specific
    method: str = "fba"
    prep_fee: float = 0.0
    # Sneaker-specific
    platform: str = "both"              # stockx, goat, both (only for sneaker)

@app.post("/api/v1/check")
async def unified_check(request: Request, body: UnifiedCheckRequest):
    """Unified check endpoint — routes to any marketplace. Requires API key."""
    key_record, err = _require_api_key(request)
    if err:
        return err

    market = body.market.strip().lower()

    if market in ("ebay", "kaufland"):
        fake_body = {
            "ean": body.ean or "", "ek": body.ek, "mode": body.mode,
            "category": body.category, "shipping_in": body.shipping_in,
            "shipping_out": body.shipping_out, "vat_mode": body.vat_mode,
            "ek_mode": body.ek_mode, "ship_mode": body.ship_mode,
            "market": market, "trends_day_range": body.trends_day_range,
            "sell_custom": body.sell_custom,
        }
        async with httpx.AsyncClient(app=app, base_url="http://internal") as client:
            resp = await client.post("/flipcheck", json=fake_body)
            result = resp.json()
            result["market"] = market
            return result

    elif market == "amazon":
        if not body.asin and not body.ean:
            return JSONResponse({"ok": False, "error": "ASIN oder EAN benötigt für Amazon"}, status_code=400)
        result = await _amazon_check(
            asin=body.asin or "", ean=body.ean or "", ek=body.ek,
            mode=body.mode, method=body.method, ship_in=body.shipping_in,
            category=body.category, prep_fee=body.prep_fee,
            vat_mode=body.vat_mode, ek_mode=body.ek_mode, ship_mode=body.ship_mode,
            sell_custom=body.sell_custom,
        )
        result["market"] = "amazon"
        return result

    elif market in ("stockx", "goat", "sneaker"):
        if not body.sku:
            return JSONResponse({"ok": False, "error": "SKU benötigt für Sneaker-Check"}, status_code=400)
        try:
            from sneaker import check_stockx, check_goat, sneaker_check as _sneaker_check
        except ImportError as e:
            return JSONResponse({"ok": False, "error": f"Sneaker module: {e}"}, status_code=500)

        loop = asyncio.get_event_loop()
        if market == "stockx":
            result = await loop.run_in_executor(None, check_stockx, body.sku, body.ek)
        elif market == "goat":
            result = await loop.run_in_executor(None, check_goat, body.sku, body.ek, "")
        else:
            result = await loop.run_in_executor(None, _sneaker_check, body.sku, body.ek)
        result["market"] = market
        return result

    else:
        return JSONResponse({"ok": False, "error": f"Unbekannter Marktplatz: {market}"}, status_code=400)


if __name__ == "__main__":
    import os
    import uvicorn

    port = int(os.getenv("FLIPCHECK_PORT", "8000"))
    host = os.getenv("FLIPCHECK_HOST", "127.0.0.1")

    uvicorn.run(app, host=host, port=port, log_level="warning")
