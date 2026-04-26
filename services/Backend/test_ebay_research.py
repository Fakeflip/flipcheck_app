#!/usr/bin/env python3
"""
eBay Research API Diagnostic Tool
==================================

Tests the research endpoint with various strategies to pinpoint why it fails:
  1. Server IP & DNS resolution
  2. Cookie presence + key tokens
  3. Plain requests (Python TLS)
  4. curl_cffi with chrome impersonation
  5. Modern Sec-Fetch headers
  6. With/without proxy

Usage on server:
    cd services/Backend
    python3 test_ebay_research.py

  Optional flags:
    --ean 4066629065376    Test with specific EAN
    --verbose              Show full response body
    --proxy                Force proxy use (off by default)
"""

import argparse
import json
import os
import re
import socket
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

# Load .env if present
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    print("⚠️  python-dotenv not installed — using process env vars only\n")

EAN_DEFAULT = "4066629065376"   # PARKSIDE Akku
RESEARCH_BASE = "https://www.ebay.de/sh/research/api/search"

# ANSI colors
GREEN = "\033[32m"; RED = "\033[31m"; YELLOW = "\033[33m"; BLUE = "\033[34m"
BOLD = "\033[1m"; RESET = "\033[0m"; DIM = "\033[2m"

def ok(msg):    print(f"{GREEN}✓{RESET} {msg}")
def fail(msg):  print(f"{RED}✗{RESET} {msg}")
def warn(msg):  print(f"{YELLOW}⚠{RESET}  {msg}")
def info(msg):  print(f"{BLUE}ℹ{RESET}  {msg}")
def title(msg): print(f"\n{BOLD}── {msg} ──{RESET}")


def build_url(ean: str, day_range: int = 30, date_strategy: str = "current") -> str:
    """Build research URL with various date param strategies."""
    now_ms = int(time.time() * 1000)
    yesterday_ms = now_ms - 24 * 3600 * 1000   # 1 day ago
    start_ms = now_ms - day_range * 24 * 3600 * 1000

    params = [
        ("marketplace", "EBAY-DE"),
        ("keywords", ean),
        ("offset", "0"),
        ("limit", "10"),
        ("tabName", "SOLD"),
        ("tz", "Europe/Berlin"),
        ("modules", "aggregates"),
        ("modules", "searchResults"),
    ]

    if date_strategy == "current":
        # Current code: dayRange + endDate=now_ms
        params.append(("dayRange", str(day_range)))
        params.append(("endDate", str(now_ms)))
    elif date_strategy == "endDate_yesterday":
        # endDate=yesterday (avoid timezone-future issue)
        params.append(("dayRange", str(day_range)))
        params.append(("endDate", str(yesterday_ms)))
    elif date_strategy == "no_endDate":
        # Only dayRange, no endDate (let eBay default)
        params.append(("dayRange", str(day_range)))
    elif date_strategy == "startDate_endDate":
        # Both dates explicit
        params.append(("startDate", str(start_ms)))
        params.append(("endDate", str(now_ms)))
    elif date_strategy == "iso_dates":
        # ISO 8601 strings instead of ms
        from datetime import datetime, timezone, timedelta
        end_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        start_iso = (datetime.now(timezone.utc) - timedelta(days=day_range)).strftime("%Y-%m-%d")
        params.append(("startDate", start_iso))
        params.append(("endDate", end_iso))
    elif date_strategy == "dayRange_only":
        # Just dayRange, no date params at all
        params.append(("dayRange", str(day_range)))

    return f"{RESEARCH_BASE}?{urlencode(params, doseq=True)}"


def modern_headers(cookie: str) -> dict:
    """Headers a real Chrome 138 sends to research API."""
    return {
        "Cookie": cookie,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://www.ebay.de/sh/research",
        "Connection": "keep-alive",
        "X-Requested-With": "XMLHttpRequest",
        "sec-ch-ua": '"Not/A)Brand";v="99", "Google Chrome";v="138", "Chromium";v="138"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
    }


def analyze_response(name: str, status: int, headers: dict, body: str, verbose: bool):
    """Categorize what eBay returned."""
    print(f"   Status:  {status}")
    print(f"   Length:  {len(body)} bytes")
    ct = headers.get("content-type") or headers.get("Content-Type") or "?"
    print(f"   CT:      {ct}")

    # Detect common eBay anti-bot signatures
    if "font-marketsans" in body[:500]:
        fail(f"   → eBay LOGIN/ERROR PAGE (HTML mit font-marketsans)")
        # Try to extract title
        m = re.search(r"<title>(.*?)</title>", body, re.I | re.S)
        if m: print(f"   Title:   {m.group(1).strip()[:120]}")
    elif "captcha" in body.lower()[:2000]:
        fail(f"   → CAPTCHA-Page erkannt")
    elif body.startswith("{") or body.startswith("["):
        # eBay Research API uses NDJSON — newline-delimited JSON modules
        lines = [l for l in body.strip().split("\n") if l.strip()]
        modules = []
        for line in lines:
            try:
                modules.append(json.loads(line))
            except json.JSONDecodeError:
                pass

        if modules:
            ok(f"   → Valid NDJSON ✓ — {len(modules)} module(s) geparst")
            for i, m in enumerate(modules):
                t = m.get("_type", "?")
                print(f"      Module {i}: _type={t}")
                # Look for aggregate values (sold count, avg price)
                if t == "ResearchAggregateModule":
                    sections = m.get("sections", [])
                    for sec in sections:
                        title_obj = sec.get("title", {}) or {}
                        title_text = (title_obj.get("textSpans", [{}])[0] or {}).get("text", "?")
                        for d in sec.get("dataItems", [])[:1]:
                            val = (d.get("value", {}).get("textSpans", [{}])[0] or {}).get("text", "?")
                            print(f"         {title_text}: {val}")
                if t == "SearchResultsModule":
                    items = m.get("items", []) or []
                    print(f"         {len(items)} sold items returned")
        else:
            warn(f"   → JSON-ähnlich aber 0 NDJSON-Module geparst — vermutlich leere Response")
            if not verbose:
                print(f"   {body[:200]}")
    elif body.startswith("ndjson") or "\n{" in body[:200]:
        ok(f"   → NDJSON-Response (eBay-spezifisch) ✓")
    else:
        warn(f"   → Unbekanntes Format")

    if verbose:
        print(f"\n{DIM}--- First 500 chars of body ---{RESET}")
        print(body[:500])
        print(f"{DIM}--- End ---{RESET}")


def test_strategy(name: str, fn, *args, **kwargs):
    """Run a test strategy in try/except."""
    title(f"TEST: {name}")
    t0 = time.time()
    try:
        fn(*args, **kwargs)
    except Exception as e:
        fail(f"   Exception: {type(e).__name__}: {e}")
    print(f"   {DIM}Took {(time.time()-t0)*1000:.0f}ms{RESET}")


# ── Strategy 1: Plain Python requests ───────────────────────────────────
def test_plain_requests(url: str, cookie: str, verbose: bool):
    import requests
    headers = modern_headers(cookie)
    resp = requests.get(url, headers=headers, timeout=15)
    analyze_response("plain", resp.status_code, dict(resp.headers), resp.text, verbose)


# ── Strategy 2: curl_cffi with chrome impersonation ─────────────────────
def test_curl_cffi(url: str, cookie: str, verbose: bool, impersonate: str = "chrome"):
    try:
        from curl_cffi import requests as cffi
    except ImportError:
        fail("curl_cffi nicht installiert! pip install curl_cffi")
        return
    headers = modern_headers(cookie)
    resp = cffi.get(url, headers=headers, timeout=15, impersonate=impersonate)
    analyze_response("cffi", resp.status_code, dict(resp.headers), resp.text, verbose)


# ── Strategy 3: curl_cffi with safari impersonation ─────────────────────
def test_curl_cffi_safari(url: str, cookie: str, verbose: bool):
    test_curl_cffi(url, cookie, verbose, impersonate="safari")


# ── Strategy 4: curl_cffi but via shell curl (compare) ──────────────────
def test_shell_curl(url: str, cookie: str, verbose: bool):
    import subprocess
    # Build a curl command identical to what cffi sends
    headers = modern_headers(cookie)
    cmd = ["curl", "-s", "-w", "HTTPSTATUS:%{http_code}\nSIZE:%{size_download}", url]
    for k, v in headers.items():
        cmd.extend(["-H", f"{k}: {v}"])
    cmd.extend(["--compressed", "--max-time", "15"])
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    body, _, meta = result.stdout.rpartition("HTTPSTATUS:")
    status = int(meta.split("\n")[0]) if meta else 0
    # Recover body without HTTPSTATUS marker (rpartition removes it from `body`)
    analyze_response("curl", status, {}, body, verbose)


# ── Diagnostic info ─────────────────────────────────────────────────────
def diag_environment():
    title("ENVIRONMENT")

    # Server's outbound IP
    try:
        import urllib.request
        ip = urllib.request.urlopen("https://api.ipify.org", timeout=5).read().decode().strip()
        ok(f"Server outbound IP: {ip}")
    except Exception as e:
        fail(f"Konnte Server-IP nicht ermitteln: {e}")

    # DNS
    try:
        ebay_ip = socket.gethostbyname("www.ebay.de")
        ok(f"www.ebay.de resolves: {ebay_ip}")
    except Exception as e:
        fail(f"DNS Resolution failed: {e}")

    # Python version
    print(f"   Python:  {sys.version.split()[0]}")

    # Library availability
    for lib in ["requests", "curl_cffi", "httpx"]:
        try:
            mod = __import__(lib)
            ver = getattr(mod, "__version__", "?")
            ok(f"{lib}: {ver}")
        except ImportError:
            warn(f"{lib}: NOT installed")


def diag_cookie():
    title("COOKIE")
    cookie = os.getenv("EBAY_RESEARCH_COOKIE", "")
    if not cookie:
        fail("EBAY_RESEARCH_COOKIE nicht gesetzt!")
        return None

    ok(f"Cookie geladen: {len(cookie)} chars")

    # Check for critical eBay session tokens
    critical = ["ebaysid", "dp1", "s=", "nonsession", "ebay="]
    for c in critical:
        present = c in cookie
        if present:
            ok(f"   {c} present")
        else:
            warn(f"   {c} MISSING — Cookie ist evtl. unvollständig")

    # Show length-only of ebaysid (sensitive)
    m = re.search(r"ebaysid=([^;]+)", cookie)
    if m:
        sid = m.group(1)
        info(f"   ebaysid length: {len(sid)} chars (preview: {sid[:8]}...{sid[-4:]})")

    return cookie


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ean", default=EAN_DEFAULT)
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--day-range", type=int, default=30)
    args = parser.parse_args()

    print(f"{BOLD}eBay Research Diagnostic Tool{RESET}")
    print(f"EAN: {args.ean}, Day-Range: {args.day_range}\n")

    diag_environment()
    cookie = diag_cookie()
    if not cookie:
        sys.exit(1)

    # ── Phase 1: Try different DATE strategies (what eBay changed) ──
    title("PHASE 1: DATE PARAM STRATEGIES")
    info("eBay-Fehler 'Startdatum nicht korrekt' → testen welches Date-Format akzeptiert wird")

    date_strategies = [
        ("current", "endDate=now_ms (CURRENT — broken)"),
        ("endDate_yesterday", "endDate=YESTERDAY_ms (avoid TZ future)"),
        ("no_endDate", "Only dayRange, no endDate"),
        ("startDate_endDate", "startDate + endDate as ms"),
        ("iso_dates", "ISO 8601 dates (YYYY-MM-DD)"),
        ("dayRange_only", "dayRange alone, no date params"),
    ]

    for strat, desc in date_strategies:
        url = build_url(args.ean, args.day_range, date_strategy=strat)
        title(f"DATE STRATEGY: {desc}")
        try:
            from curl_cffi import requests as cffi
            resp = cffi.get(url, headers=modern_headers(cookie), timeout=15, impersonate="chrome")
            length = len(resp.text)
            print(f"   Status: {resp.status_code}, Length: {length} bytes")
            # Real data has dataItems with values; PageErrorModule alone has no dataItems
            has_data = ('"dataItems"' in resp.text and '"textSpans"' in resp.text and
                        '"sections"' in resp.text)
            has_pageerror = "PageErrorModule" in resp.text and '"severity":"ERROR"' in resp.text
            if has_data:
                ok(f"   → ✅ REAL DATA ({length} bytes)")
                # Extract sold count from aggregates
                m = re.search(r'"dataItems":\s*\[\s*\{[^}]*"value":\s*\{[^}]*"text":\s*"([^"]+)"', resp.text)
                if m: ok(f"   → First aggregate value: {m.group(1)}")
            elif has_pageerror and length < 1000:
                m = re.search(r'PageErrorModule.*?"text":"([^"]+)"', resp.text)
                err_msg = m.group(1) if m else "?"
                fail(f"   → PageError ONLY: {err_msg}")
            else:
                warn(f"   → Unknown/empty response — first 200 chars:")
                print(f"   {resp.text[:200]}")
        except Exception as e:
            fail(f"   Exception: {e}")

    # ── Phase 2: Original 4 transport strategies (with current URL) ──
    url = build_url(args.ean, args.day_range)
    info(f"\nFull URL (current): {url[:160]}")

    test_strategy("Plain Python requests (current code path)",
                  test_plain_requests, url, cookie, args.verbose)
    test_strategy("curl_cffi impersonate=chrome (new code path)",
                  test_curl_cffi, url, cookie, args.verbose)
    test_strategy("curl_cffi impersonate=safari",
                  test_curl_cffi_safari, url, cookie, args.verbose)
    test_strategy("Shell curl (--compressed)",
                  test_shell_curl, url, cookie, args.verbose)

    # Recommendations
    title("DIAGNOSIS & NEXT STEPS")
    print("""
If ALL strategies return 400/HTML login-page:
  → Cookie ist nicht für die Server-IP gültig.
  → Erstelle einen neuen Cookie via SSH-SOCKS-Tunnel:
      ssh -D 9999 -N user@server      (lokales Terminal)
      Browser via SOCKS proxy localhost:9999 → ebay.de login → Cookie kopieren

If Plain returns 400 but curl_cffi returns 200:
  → TLS-Fingerprint war das Problem. curl_cffi-Fix ist korrekt.
  → Backend pulls + restart, sollte gehen.

If Plain returns 200 but curl_cffi returns 400:
  → Sehr selten — eventuell curl_cffi version issue.
  → pip install curl_cffi --upgrade

If shell curl returns 200 but curl_cffi 400:
  → cffi impersonate-Profil zu modern für eBay's parser.
  → Probier impersonate='chrome120' oder 'safari17_0'

If 200 OK with valid JSON:
  → Alles passt! Cookie + IP + TLS sind sauber.
  → Server-Backend Code-Pfad checken (eventuell wird falsche env var geladen).
""")

if __name__ == "__main__":
    main()
