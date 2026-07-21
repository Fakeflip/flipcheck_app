#!/usr/bin/env python3
"""
eBay Research-Cookie Health-Check
=================================

Probes /sh/research with the current EBAY_RESEARCH_COOKIE and alerts Discord when the
cookie is dead (or eBay/Imperva blocks us). Bypasses all caches — it reports the CURRENT
truth, which is the whole point of a health check.

Exit codes:  0 = cookie alive (exact sales figures available)
             1 = cookie dead / blocked / missing  (check fell back to scrape estimates)

Setup (server):
    export EBAY_RESEARCH_COOKIE='<full Cookie header from a logged-in Seller-Hub session>'
    export EBAY_ALERT_WEBHOOK='<discord webhook url>'      # else alerting is silently off

Cron — every 30 minutes:
    */30 * * * * cd /path/to/services/Backend && \
        python3 check_ebay_cookie.py >> /var/log/flipcheck_cookie.log 2>&1

Alerts are rate-limited to one per hour per kind (EBAY_ALERT_COOLDOWN), so a cron loop
cannot spam the channel. A recovery message is sent once the cookie works again.
"""
from __future__ import annotations

import json
import sys

import ebay_live


def main() -> int:
    result = ebay_live.check_research_cookie()
    print(json.dumps(result, ensure_ascii=False))

    if result.get("ok"):
        return 0

    status = result.get("status")
    hint = {
        "missing": "EBAY_RESEARCH_COOKIE ist nicht gesetzt.",
        "login_interstitial": "Cookie abgelaufen — neuen Cookie ziehen und setzen.",
        "bot_block": "Imperva/Distil blockt. Cookie ist evtl. ok; IP/Fingerprint prüfen.",
        "throttled": "Rate-Limit. Später erneut prüfen.",
        "no_response": "Keine Antwort von eBay (Netzwerk/Proxy?).",
    }.get(status, "Unerwarteter Status — siehe 'detail'.")
    print(f"COOKIE NICHT OK ({status}): {hint}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
