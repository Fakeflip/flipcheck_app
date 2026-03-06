from __future__ import annotations

import os
import time
import hmac
import hashlib
import secrets
from pathlib import Path
from typing import Optional, Dict, Any, List
from datetime import datetime

import json
import httpx
from dotenv import load_dotenv
from jose import jwt
from jose.exceptions import JWTError

from fastapi import FastAPI, Depends, HTTPException, Header, Request, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from urllib.parse import urlencode, quote


# =========================================================
# ENV LOAD (always load /server/.env)
# =========================================================
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# App JWT (Gate Token)
APP_JWT_SECRET = os.environ.get("APP_JWT_SECRET")
if not APP_JWT_SECRET:
    raise RuntimeError("APP_JWT_SECRET missing")
APP_JWT_ALGO    = "HS256"
APP_JWT_TTL_SEC = 60 * 60 * 24 * 7  # 7 days

# Supabase
SUPABASE_URL  = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_ROLE  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
DEVICE_LIMIT  = int(os.environ.get("DEVICE_LIMIT", "2"))

SUPABASE_ADMIN_HEADERS = {
    "apikey":        SERVICE_ROLE,
    "Authorization": f"Bearer {SERVICE_ROLE}",
}

# Discord OAuth
DISCORD_CLIENT_ID         = os.environ["DISCORD_CLIENT_ID"]
DISCORD_CLIENT_SECRET     = os.environ["DISCORD_CLIENT_SECRET"]
DISCORD_REDIRECT_URI      = os.environ["DISCORD_REDIRECT_URI"]
DISCORD_WEB_REDIRECT_URI  = os.environ.get("DISCORD_WEB_REDIRECT_URI", "https://gate.joinflipcheck.app/auth/web/callback")
WEB_APP_URL               = os.environ.get("WEB_APP_URL", "https://app.joinflipcheck.app")

# ── Whop Payment ──────────────────────────────────────────────────────────────
# Set these in server/.env  (get values from Whop developer dashboard)
WHOP_WEBHOOK_SECRET   = os.environ.get("WHOP_WEBHOOK_SECRET", "")
WHOP_PRO_PLAN_ID      = os.environ.get("WHOP_PRO_PLAN_ID", "")
WHOP_LIFETIME_PLAN_ID = os.environ.get("WHOP_LIFETIME_PLAN_ID", "")
WHOP_TEAM_PLAN_ID     = os.environ.get("WHOP_TEAM_PLAN_ID", "")
WHOP_UPGRADE_URL      = os.environ.get("WHOP_UPGRADE_URL", "https://whop.com/flipcheck")

# Free plan: daily check limit
FREE_DAILY_LIMIT = int(os.environ.get("FREE_DAILY_LIMIT", "20"))

# Backend service (internal)
BACKEND_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:8001")


# =========================================================
# UTILS
# =========================================================
def hash_device_id(fp: str) -> str:
    return hashlib.sha256(fp.encode("utf-8")).hexdigest()


def license_ok(profile: Dict[str, Any]) -> bool:
    """Returns True for paid users (active Whop membership) or beta-whitelisted users."""
    return bool(profile.get("beta_whitelist")) or (profile.get("license_status") == "active")


def _whop_plan_tier(plan_id: str) -> str:
    """Map a Whop plan ID to our internal tier name."""
    if plan_id and plan_id == WHOP_LIFETIME_PLAN_ID:
        return "lifetime"
    if plan_id and plan_id == WHOP_TEAM_PLAN_ID:
        return "team"
    return "pro"


def supabase_admin_headers() -> Dict[str, str]:
    return {
        "apikey":        SERVICE_ROLE,
        "Authorization": f"Bearer {SERVICE_ROLE}",
    }


# =========================================================
# FASTAPI INIT
# =========================================================
app = FastAPI(title="Flipcheck Gate", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "https://gate.joinflipcheck.app",
        "https://api.joinflipcheck.app",
        "https://app.joinflipcheck.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()


# =========================================================
# AUTH (Gate JWT)
# =========================================================
def verify_access_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, APP_JWT_SECRET, algorithms=[APP_JWT_ALGO])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_auth(creds: HTTPAuthorizationCredentials = Security(security)) -> Dict[str, Any]:
    return verify_access_token(creds.credentials)


# =========================================================
# MIDDLEWARE
# =========================================================
@app.middleware("http")
async def basic_gate(request: Request, call_next):
    return await call_next(request)


# =========================================================
# HEALTH
# =========================================================
@app.get("/health")
def health():
    return {
        "ok":      True,
        "service": "flipcheck-gate",
        "time":    datetime.utcnow().isoformat(),
    }


# =========================================================
# DISCORD OAUTH
# =========================================================
@app.get("/auth/discord/login")
def discord_login():
    params = {
        "client_id":     DISCORD_CLIENT_ID,
        "redirect_uri":  DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope":         "identify",
    }
    url = "https://discord.com/oauth2/authorize?" + urlencode(params)
    return RedirectResponse(url=url, status_code=302)


@app.get("/auth/discord/callback")
async def discord_callback_get(code: str, state: Optional[str] = None):
    token_url = "https://discord.com/api/oauth2/token"
    data = {
        "client_id":     DISCORD_CLIENT_ID,
        "client_secret": DISCORD_CLIENT_SECRET,
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  DISCORD_REDIRECT_URI,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(token_url, data=data, headers=headers)
        r.raise_for_status()
        token_data = r.json()

    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail="Discord token exchange failed")

    async with httpx.AsyncClient(timeout=15) as client:
        r2 = await client.get(
            "https://discord.com/api/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        r2.raise_for_status()
        discord_user = r2.json()

    discord_id = discord_user.get("id")
    if not discord_id:
        raise HTTPException(status_code=401, detail="Invalid Discord user")

    gate_token = jwt.encode(
        {
            "sub":        str(discord_id),
            "provider":   "discord",
            "discord_id": str(discord_id),
            "exp":        int(time.time()) + APP_JWT_TTL_SEC,
        },
        APP_JWT_SECRET,
        algorithm=APP_JWT_ALGO,
    )

    deep_link = f"flipcheck://auth?token={quote(gate_token)}"
    return RedirectResponse(url=deep_link, status_code=302)


@app.get("/auth/extension/callback")
async def auth_extension_callback(code: str, state: Optional[str] = None):
    """
    OAuth callback for Chrome extension (chrome.identity.launchWebAuthFlow).
    Redirect URI will be https://[ext-id].chromiumapp.org/ — Chrome intercepts it.
    This endpoint is used when the extension redirects through our server first.
    Same logic as /auth/discord/callback but redirects to extension callback URL.
    """
    token_url = "https://discord.com/api/oauth2/token"
    ext_redirect = os.environ.get(
        "EXTENSION_REDIRECT_URI",
        "https://api.joinflipcheck.app/auth/extension/callback"
    )
    data = {
        "client_id":     DISCORD_CLIENT_ID,
        "client_secret": DISCORD_CLIENT_SECRET,
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  ext_redirect,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(token_url, data=data, headers=headers)
        r.raise_for_status()
        token_data = r.json()

    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail="Discord token exchange failed")

    async with httpx.AsyncClient(timeout=15) as client:
        r2 = await client.get(
            "https://discord.com/api/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        r2.raise_for_status()
        discord_user = r2.json()

    discord_id = discord_user.get("id")
    if not discord_id:
        raise HTTPException(status_code=401, detail="Invalid Discord user")

    profile = await sb_admin_get_profile(str(discord_id))
    if profile is None:
        profile = await sb_admin_create_profile(user_id=str(discord_id), plan="free", role="user")

    gate_token = jwt.encode(
        {
            "sub":        str(discord_id),
            "provider":   "discord",
            "discord_id": str(discord_id),
            "exp":        int(time.time()) + APP_JWT_TTL_SEC,
        },
        APP_JWT_SECRET,
        algorithm=APP_JWT_ALGO,
    )

    # Return a small HTML page that postMessages the token to the extension
    # chrome.identity intercepts the redirect at https://[id].chromiumapp.org/
    # but we also support a landing page approach
    return JSONResponse(content={
        "ok":    True,
        "token": gate_token,
        "plan":  profile.get("plan", "free"),
    })


@app.get("/auth/verify")
async def auth_verify(user=Depends(require_auth)):
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    profile = await sb_admin_get_profile(user_id)
    if profile is None:
        profile = await sb_admin_create_profile(user_id=user_id, plan="free", role="user")

    return {
        "ok":             True,
        "discord_id":     user.get("discord_id"),
        "sub":            user_id,
        "license_ok":     license_ok(profile),
        "beta_whitelist": bool(profile.get("beta_whitelist")),
        "license_status": profile.get("license_status"),
        "device_limit":   DEVICE_LIMIT,
    }


@app.get("/auth/me")
async def auth_me(user=Depends(require_auth)):
    """Extended profile endpoint — called by the browser extension on startup."""
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    profile = await sb_admin_get_profile(user_id)
    if profile is None:
        profile = await sb_admin_create_profile(user_id=user_id, plan="free", role="user")

    plan         = profile.get("plan", "free") or "free"
    is_paid      = license_ok(profile)
    daily_checks = int(profile.get("daily_checks") or 0)
    daily_limit  = FREE_DAILY_LIMIT if not is_paid else None

    discord_username = (
        profile.get("discord_username")
        or user.get("discord_username")
        or ""
    )
    discord_avatar = profile.get("discord_avatar") or user.get("discord_avatar") or ""
    avatar_url = (
        f"https://cdn.discordapp.com/avatars/{user.get('discord_id')}/{discord_avatar}.png?size=128"
        if discord_avatar else None
    )

    return {
        "ok":             True,
        "discord_id":     user.get("discord_id"),
        "sub":            user_id,
        "username":       discord_username,
        "avatar_url":     avatar_url,
        "plan":           plan,
        "license_ok":     is_paid,
        "beta_whitelist": bool(profile.get("beta_whitelist")),
        "license_status": profile.get("license_status"),
        "device_limit":   DEVICE_LIMIT,
        "daily_checks":   daily_checks,
        "daily_limit":    daily_limit,
        "upgrade_url":    WHOP_UPGRADE_URL,
    }


# =========================================================
# WEB APP AUTH (Browser SPA — no deep-link, redirects to hash)
# =========================================================
@app.get("/auth/web/login")
def web_login():
    """Start Discord OAuth flow for the web app."""
    params = {
        "client_id":     DISCORD_CLIENT_ID,
        "redirect_uri":  DISCORD_WEB_REDIRECT_URI,
        "response_type": "code",
        "scope":         "identify",
    }
    url = "https://discord.com/oauth2/authorize?" + urlencode(params)
    return RedirectResponse(url=url, status_code=302)


@app.get("/auth/web/callback")
async def web_callback(code: str, state: Optional[str] = None):
    """Exchange Discord code → JWT, then redirect to web app with token in hash."""
    token_url = "https://discord.com/api/oauth2/token"
    data = {
        "client_id":     DISCORD_CLIENT_ID,
        "client_secret": DISCORD_CLIENT_SECRET,
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  DISCORD_WEB_REDIRECT_URI,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(token_url, data=data, headers=headers)
        r.raise_for_status()
        token_data = r.json()

    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail="Discord token exchange failed")

    async with httpx.AsyncClient(timeout=15) as client:
        r2 = await client.get(
            "https://discord.com/api/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        r2.raise_for_status()
        discord_user = r2.json()

    discord_id = discord_user.get("id")
    username   = discord_user.get("username", "")
    avatar     = discord_user.get("avatar", "")
    if not discord_id:
        raise HTTPException(status_code=401, detail="Invalid Discord user")

    # Upsert profile in Supabase
    profile = await sb_admin_get_profile(str(discord_id))
    if profile is None:
        profile = await sb_admin_create_profile(user_id=str(discord_id), plan="free", role="user")

    # Persist Discord username/avatar for display in web app
    try:
        await sb_admin_update_profile(str(discord_id), {
            "discord_username": username,
            "discord_avatar":   avatar,
        })
    except Exception:
        pass

    gate_token = jwt.encode(
        {
            "sub":              str(discord_id),
            "provider":         "discord",
            "discord_id":       str(discord_id),
            "discord_username": username,
            "exp":              int(time.time()) + APP_JWT_TTL_SEC,
        },
        APP_JWT_SECRET,
        algorithm=APP_JWT_ALGO,
    )

    # Redirect browser back to the SPA with token in URL hash (no server log exposure)
    redirect_url = f"{WEB_APP_URL}/#token={quote(gate_token)}"
    return RedirectResponse(url=redirect_url, status_code=302)


# =========================================================
# WHOP WEBHOOK
# =========================================================
# Required Supabase migration (run once in Supabase SQL Editor):
#   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_checks   integer   DEFAULT 0;
#   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_reset_at timestamptz;
#
# Required .env vars:
#   WHOP_WEBHOOK_SECRET   — copy from Whop developer dashboard → Webhooks
#   WHOP_PRO_PLAN_ID      — Whop plan ID for PRO tier
#   WHOP_LIFETIME_PLAN_ID — Whop plan ID for LIFETIME tier
#   WHOP_TEAM_PLAN_ID     — Whop plan ID for TEAM tier  (optional)
#   WHOP_UPGRADE_URL      — default: https://whop.com/flipcheck
#   FREE_DAILY_LIMIT      — default: 20

@app.post("/webhooks/whop")
async def whop_webhook(request: Request):
    body = await request.body()

    # ── HMAC-SHA256 signature verification ────────────────────────────────────
    if WHOP_WEBHOOK_SECRET:
        sig_header = (
            request.headers.get("x-whop-signature-256")
            or request.headers.get("x-whop-signature", "")
        )
        sig      = sig_header.removeprefix("sha256=")
        expected = hmac.new(
            WHOP_WEBHOOK_SECRET.encode("utf-8"),
            body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    import json as _json
    try:
        payload = _json.loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    action     = payload.get("action", "")
    data       = payload.get("data", {})
    user_data  = data.get("user", {})
    discord_id = str(user_data.get("discord_id", "") or "").strip()

    if not discord_id:
        print(f"[WHOP] No discord_id in payload for action={action}")
        return {"ok": True, "skipped": "no discord_id in payload"}

    profile = await sb_admin_get_profile(discord_id)
    if profile is None:
        print(f"[WHOP] Profile not found: discord_id={discord_id}, action={action}")
        return {"ok": True, "skipped": "profile not found — user may not have logged in yet"}

    if action in ("membership.went_valid", "membership.went_active"):
        plan_id = (data.get("plan") or {}).get("id", "")
        tier    = _whop_plan_tier(plan_id)
        await sb_admin_update_profile(discord_id, {
            "plan":           tier,
            "license_status": "active",
        })
        print(f"[WHOP] ✓ {discord_id} → plan={tier}, license=active  (action={action})")

    elif action in ("membership.went_invalid", "membership.expired", "membership.cancelled"):
        await sb_admin_update_profile(discord_id, {
            "plan":           "free",
            "license_status": "inactive",
        })
        print(f"[WHOP] ✗ {discord_id} → plan=free, license=inactive  (action={action})")

    else:
        print(f"[WHOP] Unhandled action={action} for discord_id={discord_id}")

    return {"ok": True, "action": action, "discord_id": discord_id}


# =========================================================
# SUPABASE ADMIN (REST helpers)
# =========================================================
async def sb_admin_get_profile(user_id: str) -> Optional[Dict[str, Any]]:
    url    = f"{SUPABASE_URL}/rest/v1/profiles"
    params = {"user_id": f"eq.{user_id}", "select": "*", "limit": "1"}

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SUPABASE_ADMIN_HEADERS, params=params)
        if r.status_code >= 400:
            print("[SB-ERR][get_profile]", r.status_code, r.text, "params=", params)
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None


async def sb_admin_create_profile(user_id: str, plan: str = "free", role: str = "user") -> Dict[str, Any]:
    payload = {
        "user_id":        user_id,
        "plan":           plan,
        "role":           role,
        "license_status": "inactive",
        "beta_whitelist": False,
        "created_at":     datetime.utcnow().isoformat(),
    }

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers={
                **SUPABASE_ADMIN_HEADERS,
                "Content-Type": "application/json",
                "Prefer":       "return=representation",
            },
            json=payload,
        )
        if r.status_code >= 400:
            print("[SB-ERR][create_profile]", r.status_code, r.text)
            print("[SB-REQ][create_profile]", payload)
        r.raise_for_status()
        data = r.json()
        return data[0] if isinstance(data, list) and data else payload


async def sb_admin_update_profile(user_id: str, updates: Dict[str, Any]) -> None:
    """PATCH one or more columns on the profiles row for user_id."""
    url    = f"{SUPABASE_URL}/rest/v1/profiles"
    params = {"user_id": f"eq.{user_id}"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.patch(
            url,
            headers={**SUPABASE_ADMIN_HEADERS, "Content-Type": "application/json"},
            params=params,
            json=updates,
        )
        if r.status_code >= 400:
            print("[SB-ERR][update_profile]", r.status_code, r.text)


async def sb_admin_check_and_increment_daily(user_id: str) -> bool:
    """
    Returns True  → check is allowed (counter incremented).
    Returns False → daily limit exceeded, deny the request.

    Requires Supabase columns (safe to deploy before migration — update errors
    are swallowed and the check is allowed through):
        daily_checks   integer     DEFAULT 0
        daily_reset_at timestamptz DEFAULT NULL
    """
    profile = await sb_admin_get_profile(user_id)
    if not profile:
        return False

    daily_checks   = int(profile.get("daily_checks") or 0)
    daily_reset_at = profile.get("daily_reset_at")
    now            = datetime.utcnow()

    # Reset counter if the saved date is from a previous calendar day
    needs_reset = True
    if daily_reset_at:
        try:
            ts_str   = daily_reset_at.replace("Z", "").split("+")[0]
            reset_dt = datetime.fromisoformat(ts_str)
            if reset_dt.date() >= now.date():
                needs_reset = False
        except Exception:
            pass

    if needs_reset:
        daily_checks = 0

    if daily_checks >= FREE_DAILY_LIMIT:
        return False

    # Increment — fire-and-forget; columns may not exist yet (safe)
    try:
        await sb_admin_update_profile(user_id, {
            "daily_checks":   daily_checks + 1,
            "daily_reset_at": now.isoformat(),
        })
    except Exception as exc:
        print(f"[SB-WARN][daily_increment] {exc}")

    return True


async def sb_admin_get_device(user_id: str, device_hash: str) -> Optional[Dict[str, Any]]:
    url    = f"{SUPABASE_URL}/rest/v1/devices"
    params = {
        "user_id":         f"eq.{user_id}",
        "device_id_hash":  f"eq.{device_hash}",
        "select":          "id,user_id,device_id_hash",
        "limit":           "1",
    }

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SUPABASE_ADMIN_HEADERS, params=params)
        if r.status_code >= 400:
            print("[SB-ERR][get_device]", r.status_code, r.text, "params=", params)
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None


async def sb_admin_devices_count(user_id: str) -> int:
    url    = f"{SUPABASE_URL}/rest/v1/devices"
    params = {"user_id": f"eq.{user_id}", "select": "id"}

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SUPABASE_ADMIN_HEADERS, params=params)
        if r.status_code >= 400:
            print("[SB-ERR][devices_count]", r.status_code, r.text, "params=", params)
        r.raise_for_status()
        return len(r.json())


async def sb_admin_upsert_device(user_id: str, device_hash: str, device_name: Optional[str]) -> None:
    url     = f"{SUPABASE_URL}/rest/v1/devices"
    headers = {
        **SUPABASE_ADMIN_HEADERS,
        "Content-Type": "application/json",
        "Prefer":       "resolution=merge-duplicates",
    }
    payload = {
        "user_id":         user_id,
        "device_id_hash":  device_hash,
        "device_name":     device_name or None,
        "last_seen_at":    datetime.utcnow().isoformat(),
    }

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, headers=headers, json=payload)
        if r.status_code not in (200, 201, 204):
            print("[SB-ERR][upsert_device]", r.status_code, r.text)
            print("[SB-REQ][upsert_device]", payload)
            raise HTTPException(status_code=500, detail=f"Device upsert failed: {r.text}")


# =========================================================
# PAIR DEVICE
# =========================================================
class PairRequest(BaseModel):
    device_name:        str
    device_fingerprint: str


@app.post("/session/pair")
async def pair(req: PairRequest, user=Depends(require_auth)):
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    device_hash = hash_device_id(req.device_fingerprint)

    profile = await sb_admin_get_profile(user_id)
    if profile is None:
        profile = await sb_admin_create_profile(user_id=user_id, plan="free", role="user")

    existing = await sb_admin_get_device(user_id, device_hash)
    if existing:
        await sb_admin_upsert_device(user_id, device_hash, req.device_name)
        return {"paired": True, "device_limit": DEVICE_LIMIT, "already_registered": True}

    count = await sb_admin_devices_count(user_id)
    if count >= DEVICE_LIMIT:
        raise HTTPException(status_code=403, detail="Device limit reached")

    await sb_admin_upsert_device(user_id, device_hash, req.device_name)
    return {"paired": True, "device_limit": DEVICE_LIMIT, "already_registered": False}


# =========================================================
# FLIPCHECK
# =========================================================
class FlipRequest(BaseModel):
    ean:      str
    ek:       float
    mode:     str = "mid"
    category: str = "sonstiges"


@app.post("/flipcheck")
async def flipcheck(
    req: FlipRequest,
    user=Depends(require_auth),
    x_device: Optional[str] = Header(default=None),
):
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    profile = await sb_admin_get_profile(user_id)
    if profile is None:
        profile = await sb_admin_create_profile(user_id=user_id, plan="free", role="user")

    is_paid = license_ok(profile)

    if not is_paid:
        allowed = await sb_admin_check_and_increment_daily(user_id)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={
                    "ok":          False,
                    "error":       "plan_limit",
                    "error_code":  "FREE_LIMIT_REACHED",
                    "message":     f"Kostenloses Limit: {FREE_DAILY_LIMIT} Checks/Tag erreicht.",
                    "daily_limit": FREE_DAILY_LIMIT,
                    "upgrade_url": WHOP_UPGRADE_URL,
                },
            )

    if x_device:
        device_hash = hash_device_id(x_device)
        if not await sb_admin_get_device(user_id, device_hash):
            raise HTTPException(status_code=403, detail="Device not paired")

    # ── Proxy to eBay backend service ────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{BACKEND_URL}/flipcheck",
                json={
                    "ean":      req.ean,
                    "ek":       req.ek,
                    "mode":     req.mode,
                    "category": getattr(req, "category", "sonstiges"),
                },
            )
            if r.status_code == 200:
                return r.json()
            # Backend error — return it as-is
            return JSONResponse(status_code=r.status_code, content=r.json())
    except Exception as e:
        print(f"[BACKEND-ERR][flipcheck] {e}")
        raise HTTPException(status_code=503, detail="Backend service unavailable")


class AmazonCheckRequest(BaseModel):
    asin:     str
    ean:      Optional[str] = None
    ek:       float = 0.0
    mode:     str   = "mid"
    method:   str   = "fba"   # "fba" or "fbm"
    ship_in:  float = 4.99
    category: str   = "sonstiges"


@app.post("/amazon-check")
async def amazon_check(
    req: AmazonCheckRequest,
    user=Depends(require_auth),
    x_device: Optional[str] = Header(default=None),
):
    user_id = str(user.get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing sub")

    profile = await sb_admin_get_profile(user_id)
    if profile is None:
        profile = await sb_admin_create_profile(user_id=user_id, plan="free", role="user")

    is_paid = license_ok(profile)

    if not is_paid:
        allowed = await sb_admin_check_and_increment_daily(user_id)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={
                    "ok":          False,
                    "error":       "plan_limit",
                    "error_code":  "FREE_LIMIT_REACHED",
                    "message":     f"Kostenloses Limit: {FREE_DAILY_LIMIT} Checks/Tag erreicht.",
                    "daily_limit": FREE_DAILY_LIMIT,
                    "upgrade_url": WHOP_UPGRADE_URL,
                },
            )

    # ── Proxy to Amazon backend service ──────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            r = await client.post(
                f"{BACKEND_URL}/amazon-check",
                json={
                    "asin":     req.asin,
                    "ean":      req.ean,
                    "ek":       req.ek,
                    "mode":     req.mode,
                    "method":   req.method,
                    "ship_in":  req.ship_in,
                    "category": req.category,
                },
            )
            if r.status_code == 200:
                return r.json()
            return JSONResponse(status_code=r.status_code, content=r.json())
    except Exception as e:
        print(f"[BACKEND-ERR][amazon-check] {e}")
        raise HTTPException(status_code=503, detail="Backend service unavailable")


# =========================================================
# WEB APP RESOURCE ENDPOINTS
# All endpoints use SUPABASE service role key and inject
# user_id from the JWT sub claim — RLS is bypassed on purpose.
# =========================================================

def _uid(user: Dict[str, Any]) -> str:
    """Extract user_id from JWT payload, raise 401 if missing."""
    uid = str(user.get("sub") or "")
    if not uid:
        raise HTTPException(status_code=401, detail="Missing sub")
    return uid


# ── Inventory ─────────────────────────────────────────────────────────────────

class InventoryItemIn(BaseModel):
    ean:        Optional[str]   = None
    title:      Optional[str]   = None
    ek:         Optional[float] = None
    qty:        Optional[int]   = 1
    status:     Optional[str]   = "IN_STOCK"
    market:     Optional[str]   = "ebay"
    sell_price: Optional[float] = None
    ship_out:   Optional[float] = 0.0
    ek_date:    Optional[str]   = None
    sold_at:    Optional[str]   = None
    notes:      Optional[str]   = None


@app.get("/inventory")
async def inventory_list(user=Depends(require_auth)):
    uid = _uid(user)
    url = f"{SUPABASE_URL}/rest/v1/inventory"
    params = {"user_id": f"eq.{uid}", "select": "*", "order": "updated_at.desc"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SUPABASE_ADMIN_HEADERS, params=params)
        r.raise_for_status()
        return r.json()


@app.post("/inventory", status_code=201)
async def inventory_create(body: InventoryItemIn, user=Depends(require_auth)):
    uid     = _uid(user)
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    payload["user_id"]    = uid
    payload["updated_at"] = datetime.utcnow().isoformat()
    url     = f"{SUPABASE_URL}/rest/v1/inventory"
    headers = {**SUPABASE_ADMIN_HEADERS, "Content-Type": "application/json", "Prefer": "return=representation"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, headers=headers, json=payload)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        data = r.json()
        return data[0] if isinstance(data, list) and data else payload


@app.patch("/inventory/{item_id}")
async def inventory_update(item_id: str, body: InventoryItemIn, user=Depends(require_auth)):
    uid     = _uid(user)
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    payload["updated_at"] = datetime.utcnow().isoformat()
    url     = f"{SUPABASE_URL}/rest/v1/inventory"
    params  = {"id": f"eq.{item_id}", "user_id": f"eq.{uid}"}
    headers = {**SUPABASE_ADMIN_HEADERS, "Content-Type": "application/json", "Prefer": "return=representation"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.patch(url, headers=headers, params=params, json=payload)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        data = r.json()
        return data[0] if isinstance(data, list) and data else {"ok": True}


@app.delete("/inventory/{item_id}")
async def inventory_delete(item_id: str, user=Depends(require_auth)):
    uid    = _uid(user)
    url    = f"{SUPABASE_URL}/rest/v1/inventory"
    params = {"id": f"eq.{item_id}", "user_id": f"eq.{uid}"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.delete(url, headers=SUPABASE_ADMIN_HEADERS, params=params)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
    return {"ok": True}


# ── Price History ─────────────────────────────────────────────────────────────

class PriceHistoryIn(BaseModel):
    ean:     str
    title:   Optional[str]  = None
    entries: Optional[List] = None


@app.get("/price-history")
async def price_history_list(user=Depends(require_auth)):
    uid    = _uid(user)
    url    = f"{SUPABASE_URL}/rest/v1/price_history"
    params = {"user_id": f"eq.{uid}", "select": "ean,title,updated_at", "order": "updated_at.desc"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SUPABASE_ADMIN_HEADERS, params=params)
        r.raise_for_status()
        return r.json()


@app.get("/price-history/{ean}")
async def price_history_get(ean: str, user=Depends(require_auth)):
    uid    = _uid(user)
    url    = f"{SUPABASE_URL}/rest/v1/price_history"
    params = {"user_id": f"eq.{uid}", "ean": f"eq.{ean}", "select": "*", "limit": "1"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SUPABASE_ADMIN_HEADERS, params=params)
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else {"ean": ean, "title": ean, "entries": []}


@app.post("/price-history")
async def price_history_upsert(body: PriceHistoryIn, user=Depends(require_auth)):
    uid = _uid(user)
    # Fetch existing row
    url    = f"{SUPABASE_URL}/rest/v1/price_history"
    params = {"user_id": f"eq.{uid}", "ean": f"eq.{body.ean}", "select": "*", "limit": "1"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SUPABASE_ADMIN_HEADERS, params=params)
        r.raise_for_status()
        existing = r.json()

    existing_entries: list = []
    if existing:
        existing_entries = existing[0].get("entries") or []

    # Merge new entries, de-dupe by date string (first element), cap at 180
    new_entries = list(body.entries or [])
    existing_dates = {e[0] if isinstance(e, list) else e.get("date","") for e in existing_entries}
    for e in new_entries:
        key = e[0] if isinstance(e, list) else e.get("date", "")
        if key not in existing_dates:
            existing_entries.append(e)
            existing_dates.add(key)
    merged = existing_entries[-180:]  # cap

    payload = {
        "user_id":    uid,
        "ean":        body.ean,
        "title":      body.title or body.ean,
        "entries":    merged,
        "updated_at": datetime.utcnow().isoformat(),
    }
    upsert_url = f"{SUPABASE_URL}/rest/v1/price_history"
    headers    = {**SUPABASE_ADMIN_HEADERS, "Content-Type": "application/json",
                  "Prefer": "resolution=merge-duplicates,return=representation"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(upsert_url, headers=headers, json=payload)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        data = r.json()
        return data[0] if isinstance(data, list) and data else payload


@app.delete("/price-history/{ean}")
async def price_history_delete(ean: str, user=Depends(require_auth)):
    uid    = _uid(user)
    url    = f"{SUPABASE_URL}/rest/v1/price_history"
    params = {"user_id": f"eq.{uid}", "ean": f"eq.{ean}"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.delete(url, headers=SUPABASE_ADMIN_HEADERS, params=params)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
    return {"ok": True}


# ── Alerts ────────────────────────────────────────────────────────────────────

class AlertIn(BaseModel):
    ean:             Optional[str]   = None
    title:           Optional[str]   = None
    target_price:    Optional[float] = None
    market:          Optional[str]   = "ebay"
    triggered_at:    Optional[str]   = None
    notify_discord:  Optional[bool]  = False
    webhook_url:     Optional[str]   = None


@app.get("/alerts")
async def alerts_list(user=Depends(require_auth)):
    uid    = _uid(user)
    url    = f"{SUPABASE_URL}/rest/v1/alerts"
    params = {"user_id": f"eq.{uid}", "select": "*", "order": "created_at.desc"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SUPABASE_ADMIN_HEADERS, params=params)
        r.raise_for_status()
        return r.json()


@app.post("/alerts", status_code=201)
async def alerts_create(body: AlertIn, user=Depends(require_auth)):
    uid     = _uid(user)
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    payload["user_id"] = uid
    url     = f"{SUPABASE_URL}/rest/v1/alerts"
    headers = {**SUPABASE_ADMIN_HEADERS, "Content-Type": "application/json", "Prefer": "return=representation"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, headers=headers, json=payload)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        data = r.json()
        return data[0] if isinstance(data, list) and data else payload


@app.patch("/alerts/{alert_id}")
async def alerts_update(alert_id: str, body: AlertIn, user=Depends(require_auth)):
    uid     = _uid(user)
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    url     = f"{SUPABASE_URL}/rest/v1/alerts"
    params  = {"id": f"eq.{alert_id}", "user_id": f"eq.{uid}"}
    headers = {**SUPABASE_ADMIN_HEADERS, "Content-Type": "application/json", "Prefer": "return=representation"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.patch(url, headers=headers, params=params, json=payload)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        data = r.json()
        return data[0] if isinstance(data, list) and data else {"ok": True}


@app.delete("/alerts/{alert_id}")
async def alerts_delete(alert_id: str, user=Depends(require_auth)):
    uid    = _uid(user)
    url    = f"{SUPABASE_URL}/rest/v1/alerts"
    params = {"id": f"eq.{alert_id}", "user_id": f"eq.{uid}"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.delete(url, headers=SUPABASE_ADMIN_HEADERS, params=params)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
    return {"ok": True}


# ── Settings ──────────────────────────────────────────────────────────────────

class SettingsPatch(BaseModel):
    data: Dict[str, Any]


@app.get("/settings")
async def settings_get(user=Depends(require_auth)):
    uid    = _uid(user)
    url    = f"{SUPABASE_URL}/rest/v1/user_settings"
    params = {"user_id": f"eq.{uid}", "select": "*", "limit": "1"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SUPABASE_ADMIN_HEADERS, params=params)
        r.raise_for_status()
        rows = r.json()
    if rows:
        return {"data": rows[0].get("data", {})}
    # Upsert default empty row
    payload = {"user_id": uid, "data": {}, "updated_at": datetime.utcnow().isoformat()}
    headers = {**SUPABASE_ADMIN_HEADERS, "Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates"}
    async with httpx.AsyncClient(timeout=15) as client:
        await client.post(f"{SUPABASE_URL}/rest/v1/user_settings", headers=headers, json=payload)
    return {"data": {}}


@app.patch("/settings")
async def settings_patch(body: SettingsPatch, user=Depends(require_auth)):
    uid = _uid(user)
    # Fetch current data
    url    = f"{SUPABASE_URL}/rest/v1/user_settings"
    params = {"user_id": f"eq.{uid}", "select": "data", "limit": "1"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=SUPABASE_ADMIN_HEADERS, params=params)
        r.raise_for_status()
        rows = r.json()
    current = rows[0].get("data", {}) if rows else {}
    merged  = {**current, **body.data}
    payload = {"user_id": uid, "data": merged, "updated_at": datetime.utcnow().isoformat()}
    headers = {**SUPABASE_ADMIN_HEADERS, "Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, headers=headers, json=payload)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
    return {"data": merged}
