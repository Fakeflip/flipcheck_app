#!/usr/bin/env python3
"""
Unit tests for the eBay research NDJSON parser and the public s-card sold-scrape
parser. Runs fully offline — no live /sh/research calls, no cookie needed.

Run:
    cd services/Backend
    python3.12 -m pytest test_research_parse.py -q
    # or, if pytest is absent:
    python3.12 test_research_parse.py
"""
from __future__ import annotations
import json
import os
import time
from pathlib import Path

# Force research/combined mode ON and disable persistence during tests so the
# sqlite file is never touched by the parse-only tests.
os.environ.setdefault("EBAY_RESEARCH_PERSIST", "0")

import ebay_live  # noqa: E402


# ---------------------------------------------------------------------------
# Build a minimal but realistic NDJSON research response
# ---------------------------------------------------------------------------
def _mock_ndjson() -> str:
    aggregates = {
        "_type": "ResearchAggregateModule",
        "sections": [
            {
                "title": {"textSpans": [{"text": "Durchschnittlicher Verkaufspreis"}]},
                "dataItems": [
                    {"value": {"textSpans": [{"text": "EUR 150,50"}]}}
                ],
            },
            {
                "title": {"textSpans": [{"text": "Verkaufsdurchgangsrate"}]},
                "dataItems": [
                    {"value": {"textSpans": [{"text": "85 %"}]}}
                ],
            },
            {
                "title": {"textSpans": [{"text": "Verkaufte Artikel"}]},
                "dataItems": [
                    {"value": {"textSpans": [{"text": "42"}]}}
                ],
            },
        ],
    }
    search_results = {
        "_type": "SearchResultsModule",
        "items": [
            {"price": {"value": {"textSpans": [{"text": "EUR 140,00"}]}}},
            {"price": {"value": {"textSpans": [{"text": "EUR 150,00"}]}}},
            {"price": {"value": {"textSpans": [{"text": "EUR 160,00"}]}}},
        ],
    }
    metrics_trends = {
        "_type": "MetricsTrendsModule",
        "granularity": "DAY",
        "series": [
            {
                "id": "averageSold",
                "currencyCode": "EUR",
                "data": [
                    [1717200000000, 148.0],
                    [1717286400000, 152.0],
                    [1717372800000, 150.0],
                ],
            },
            {
                "id": "quantity",
                "data": [
                    [1717200000000, 3],
                    [1717286400000, 5],
                    [1717372800000, 4],
                ],
            },
            {
                "id": "quantityRegressionLine",
                "data": [
                    [1717200000000, 3.0],
                    [1717372800000, 4.5],
                ],
            },
        ],
    }
    return "\n".join(json.dumps(m) for m in (aggregates, search_results, metrics_trends))


# ---------------------------------------------------------------------------
# Tests: NDJSON parser
# ---------------------------------------------------------------------------
def test_parse_research_modules_extracts_avg_median_sold_trends():
    parsed = ebay_live._parse_research_modules(_mock_ndjson())
    assert parsed["_has_aggregates"] is True
    # avg from label-matched "Durchschnittlicher Verkaufspreis" section
    assert parsed["avg_price"] == 150.50, parsed
    # sold count from "Verkaufte Artikel" (label match, NOT positional idx 2 luck)
    assert parsed["monthly_sales"] == 42, parsed
    # median from the 3 search-result prices → middle = 150.00
    assert parsed["median_price"] == 150.00, parsed
    # trends normalized
    tr = parsed["trends"]
    assert tr is not None
    assert tr["granularity"] == "DAY"
    assert tr["currency"] == "EUR"
    assert len(tr["points"]) == 3
    assert tr["points"][0]["averageSold"] == 148.0
    assert tr["points"][1]["quantity"] == 5
    assert tr["regression"] is not None


def test_label_matching_survives_section_reorder():
    """Positional indices are fragile — reorder sections and confirm the
    label-matched extraction still finds avg + sold."""
    parsed_ref = ebay_live._parse_research_modules(_mock_ndjson())
    # Reorder: put "Verkaufte Artikel" first, avg last
    agg = {
        "_type": "ResearchAggregateModule",
        "sections": [
            {"title": {"textSpans": [{"text": "Verkaufte Artikel"}]},
             "dataItems": [{"value": {"textSpans": [{"text": "42"}]}}]},
            {"title": {"textSpans": [{"text": "Verkaufsdurchgangsrate"}]},
             "dataItems": [{"value": {"textSpans": [{"text": "85 %"}]}}]},
            {"title": {"textSpans": [{"text": "Durchschnittlicher Verkaufspreis"}]},
             "dataItems": [{"value": {"textSpans": [{"text": "EUR 150,50"}]}}]},
        ],
    }
    parsed = ebay_live._parse_research_modules(json.dumps(agg))
    assert parsed["avg_price"] == 150.50, parsed
    assert parsed["monthly_sales"] == 42, parsed
    assert parsed_ref["avg_price"] == parsed["avg_price"]


def test_classify_throttle_and_login():
    assert ebay_live._classify_research_body(429, "") == "throttled"
    assert ebay_live._classify_research_body(200, "...font-marketsans...") == "login_interstitial"
    assert ebay_live._classify_research_body(
        200, '{"_type":"PageErrorModule"} "severity":"ERROR"'
    ) == "page_error"


def test_classify_json_auth_error_is_dead_cookie():
    """REGRESSION: the /sh/research API returns HTTP 200 + a JSON auth error when the
    cookie is dead — NOT the HTML login page. This was classified 'empty_or_unknown',
    so the cookie-dead Discord alert never fired. Verbatim body from the live server."""
    body = ('{"error":"auth_required","reason_code":"invalid_session",'
            '"signin_url":"https://signin.ebay.de/ws/eBayISAPI.dll?SignIn&ru=..."}')
    assert ebay_live._classify_research_body(200, body) == "login_interstitial", \
        "dead cookie must be detected → otherwise no Discord alert"

    fired = []
    orig = ebay_live._alert_discord
    ebay_live._alert_discord = lambda key, title, msg, urgent=True: fired.append(key)
    try:
        with ebay_live._ALERT_LOCK:
            ebay_live._ALERT_LAST.clear()
        ebay_live._COOKIE_DEAD = False
        ebay_live._on_research_failure(
            ebay_live._classify_research_body(200, body), "ck1")
        assert "cookie_dead" in fired, "JSON auth error must raise the cookie alert"
    finally:
        ebay_live._alert_discord = orig
        ebay_live._COOKIE_DEAD = False


def test_classify_imperva_distil_bot_block():
    """The real Imperva/Distil block: eBay 302→/splashui/distil?...&page=block, which
    curl_cffi follows to an HTTP 200 splash page. Must be detected as bot_block (not
    'empty'), so the cookie is cooled and we don't re-hammer the bot-wall."""
    # Detect via the final (redirected) URL
    assert ebay_live._classify_research_body(
        200, "<html>...</html>",
        "https://www.ebay.de/splashui/distil?ap=2&appName=orch&page=block&iid=x",
    ) == "bot_block"
    # Detect via the block-page body text (exact string from the live capture)
    assert ebay_live._classify_research_body(
        200,
        "<html><body>Entschuldigen Sie die Störung...</body></html>",
    ) == "bot_block"
    # A genuine empty NDJSON (no distil markers) stays 'empty_or_unknown'
    assert ebay_live._classify_research_body(200, "") == "empty_or_unknown"


def test_monthly_sales_rescale_to_30d(monkeypatch=None):
    """fetch_research_stats must rescale a 90d sold_count to a 30d window."""
    fake_combined = {
        "avg_price": 100.0, "median_price": 100.0,
        "monthly_sales": 90, "trends": None, "day_range": 90,
        "_source": "research_api",
    }
    orig = ebay_live.fetch_research_combined
    ebay_live.fetch_research_combined = lambda *a, **k: fake_combined  # type: ignore
    orig_cookie = ebay_live.EBAY_RESEARCH_COOKIE
    ebay_live.EBAY_RESEARCH_COOKIE = "ebaysid=x; dp1=y"  # make _has_any_research_cookie() true
    try:
        stats = ebay_live.fetch_research_stats("dummy", day_range=30)
    finally:
        ebay_live.fetch_research_combined = orig  # type: ignore
        ebay_live.EBAY_RESEARCH_COOKIE = orig_cookie
    assert stats is not None
    # 90 sold in 90 days → 30 in 30 days
    assert stats["monthly_sales"] == 30, stats


# ---------------------------------------------------------------------------
# Tests: public s-card sold scrape parser (real captured HTML)
# ---------------------------------------------------------------------------
def test_scard_parser_handles_both_markup_variants():
    """eBay rotates two 's-card' markups: variant A uses 's-card__price' + an
    's-card__caption' date; variant B uses 'su-item-card__price' with NO caption
    class (date is loose "Verkauft <d>" text). The parser must handle BOTH, or the
    fallback returns None intermittently depending on which variant eBay served.
    Self-contained (no external sample file → runs on the server too)."""
    def card_A(title, price):
        return (f'<li class="s-card"><div class=s-card__title>{title}</div>'
                f'<span class="su-styled-text primary bold large-1 s-card__price">{price}</span>'
                f'<div class=s-card__caption>Verkauft  7. Jul 2026</div></li>')

    def card_B(title, price):
        # Variant B: su-item-card__price, and the "Verkauft" date carries NO class.
        return (f'<li class="su-item-card"><div class=su-item-card__title>{title}</div>'
                f'<span class="su-styled-text primary bold medium su-item-card__price">{price}</span>'
                f'<span>Verkauft  30. Jun 2026</span></li>')

    html = (
        card_A("Apple iPhone 13 128GB", "EUR 300,00")
        + card_A("Apple iPhone 13 128GB blau", "EUR 310,00")
        + card_A("Apple iPhone 13 128GB rot", "EUR 305,00")
        + card_B("Apple iPhone 13 mini", "EUR 320,00")
        + card_B("Apple iPhone 13 mini grün", "EUR 315,00")
        + card_B("Apple iPhone 13 mini weiß", "EUR 325,00")
    )
    data = ebay_live._parse_scard_sold_page(html, window_days=3650)
    assert data is not None, "parser returned None on mixed-variant markup"
    assert data["_source"] == "public_scrape"
    assert data["velocity_approx"] is True
    # median over ALL 6 prices (both variants) = (310+315)/2 → proves both parsed
    assert data["median_price"] == 312.50, data
    assert 300 <= data["avg_price"] <= 325, data
    # velocity derived (>0) from the "Verkauft <date>" captions across both variants
    assert data["monthly_sales"] is not None and data["monthly_sales"] > 0, data


def test_scard_filters_promo_dollar_cards():
    # Mirror real eBay markup: title precedes price within each card. A $-only
    # promo card ('Shop on eBay') must be dropped; only EUR cards survive.
    def card(title, price, cap=None):
        s = f'<div class=s-card__title>{title}</div>'
        s += f'<span class=s-card__price>{price}</span>'
        if cap:
            s += f'<div class=s-card__caption>{cap}</div>'
        return s

    html = (
        card("Shop on eBay", "$20.00")
        + card("Apple iPhone 13", "EUR 300,00", "Verkauft  7. Jul 2026")
        + card("Apple iPhone 13 128GB", "EUR 300,00", "Verkauft  7. Jul 2026")
        + card("Apple iPhone 13 mini", "EUR 300,00", "Verkauft  7. Jul 2026")
    )
    data = ebay_live._parse_scard_sold_page(html, window_days=3650)
    assert data is not None, "parser dropped all cards"
    # median should be 300 EUR (promo $20 excluded)
    assert data["median_price"] == 300.00, data
    assert data["monthly_sales"] is not None and data["monthly_sales"] > 0, data


def test_relevance_filter_excludes_wrong_variant():
    """Bare-EAN eBay search is fuzzy: an 'SDR 1050 D2' query returns the older 'C1',
    other models and accessories too. match_tokens=['1050','d2'] must keep ONLY the
    D2 cards — otherwise price AND velocity get inflated by unrelated listings."""
    def card(lid, title, price):
        return (f'<li data-listingid={lid}><div class=s-card__title>{title}</div>'
                f'<span class="su-styled-text s-card__price">{price}</span>'
                f'<div class=s-card__caption>Verkauft  7. Jul 2026</div></li>')
    html = (
        card(1, "SILVERCREST Hand-Dampfreiniger SDR 1050 D2", "EUR 18,00")
        + card(2, "SILVERCREST Hand-Dampfreiniger SDR 1050 D2 B-Ware", "EUR 20,00")
        + card(3, "SILVERCREST Hand-Dampfreiniger SDR 1050 D2 mit Zubehör", "EUR 19,00")
        + card(4, "SILVERCREST Dampfpistole SDR 1050 C1", "EUR 12,00")      # older variant
        + card(5, "SILVERCREST Dampfreiniger SDR 1050 C1", "EUR 13,00")     # older variant
        + card(6, "Ersatzdüse für SDR 1100 A2", "EUR 5,00")                 # accessory, other model
    )
    tokens = ebay_live._relevance_tokens("SILVERCREST Hand-Dampfreiniger »SDR 1050 D2«")
    assert tokens == ["1050", "d2"], tokens
    filtered = ebay_live._parse_scard_sold_page(html, window_days=3650, match_tokens=tokens)
    assert filtered is not None
    # only the 3 D2 prices (18,19,20) survive → median 19.0
    assert filtered["median_price"] == 19.00, filtered
    # unfiltered mixes all 6 (5,12,13,18,19,20) → different median → proves the filter acts
    unfiltered = ebay_live._parse_scard_sold_page(html, window_days=3650)
    assert unfiltered["median_price"] != filtered["median_price"], "relevance filter had no effect"


def test_dedup_same_listing_counted_once():
    """eBay sometimes renders the same listing twice; dedup by data-listingid."""
    def card(lid, price):
        return (f'<li data-listingid={lid}><div class=s-card__title>Widget X1</div>'
                f'<span class="s-card__price">{price}</span>'
                f'<div class=s-card__caption>Verkauft  7. Jul 2026</div></li>')
    html = card(111, "EUR 10,00") + card(111, "EUR 10,00") + card(222, "EUR 12,00") + card(333, "EUR 14,00")
    data = ebay_live._parse_scard_sold_page(html, window_days=3650)
    # 4 cards but only 3 distinct listing ids → 3 prices (10,12,14) → median 12
    assert data is not None and data["median_price"] == 12.00, data


def test_avg_is_median_anchored_not_dragged_by_bundles():
    """Sold pages mix single units with pricey bundles/sets. On a small/fuzzy result set
    the old IQR filter kept those outliers and inflated sell_price_avg far above the
    median (observed live: Ø 43.92 vs Median 29.95) → phantom profit, because the caller
    computes profit from the avg. The avg must stay anchored to the median."""
    def card(lid, price):
        return (f'<li data-listingid={lid}><div class=s-card__title>Parkside PKSB 254 A1</div>'
                f'<span class="s-card__price">{price}</span>'
                f'<div class=s-card__caption>Verkauft  7. Jul 2026</div></li>')
    # wide right tail: bundles at 90/130 alongside single units at 20-60
    html = "".join(
        card(i, p) for i, p in enumerate(
            ["EUR 20,00", "EUR 25,00", "EUR 30,00", "EUR 45,00",
             "EUR 60,00", "EUR 90,00", "EUR 130,00"])
    )
    d = ebay_live._parse_scard_sold_page(html, window_days=3650)
    assert d is not None
    assert d["median_price"] == 45.00, d
    # avg must stay inside the median band (never dragged toward the ~57 raw mean)
    assert d["avg_price"] <= d["median_price"] * 1.5, d
    assert d["avg_price"] == 40.00, d   # mean of 25,30,45,60 within band 22.5..67.5


def test_strikethrough_price_excluded():
    """Crossed-out 'was' prices are not sale prices and must not skew median/avg."""
    def card(lid, price, strike=False):
        cls = ("su-styled-text primary bold strikethrough medium su-item-card__price"
               if strike else "su-styled-text primary bold medium su-item-card__price")
        return (f'<li data-listingid={lid}><div class=su-item-card__title>Widget</div>'
                f'<span class="{cls}">{price}</span>'
                f'<div>Verkauft  7. Jul 2026</div></li>')
    html = (card(1, "EUR 10,00") + card(2, "EUR 12,00")
            + card(3, "EUR 14,00") + card(4, "EUR 14,00", strike=True))
    d = ebay_live._parse_scard_sold_page(html, window_days=3650)
    assert d is not None
    # only the 3 real prices (10,12,14) count → median 12 (not 13), avg 12 (not 12.5)
    assert d["median_price"] == 12.00, d
    assert d["avg_price"] == 12.00, d


def _reset_alerts():
    with ebay_live._ALERT_LOCK:
        ebay_live._ALERT_LAST.clear()
    ebay_live._COOKIE_DEAD = False


def test_dead_cookie_triggers_discord_alert():
    """A login-interstitial means the cookie expired — a human must refresh it, so it
    MUST alert (that is the whole point of the webhook)."""
    _reset_alerts()
    fired = []
    orig = ebay_live._alert_discord
    ebay_live._alert_discord = lambda key, title, msg, urgent=True: fired.append(key)
    try:
        ebay_live._on_research_failure("login_interstitial", "ck1")
        assert "cookie_dead" in fired, fired
        assert ebay_live._COOKIE_DEAD is True
        # an Imperva block is a DIFFERENT problem → different alert, not "cookie dead"
        fired.clear()
        ebay_live._on_research_failure("bot_block", "ck1")
        assert fired == ["bot_block"], fired
    finally:
        ebay_live._alert_discord = orig
        _reset_alerts()


def test_cookie_recovery_alerts_once():
    """After reporting the cookie dead, a later success must announce recovery exactly
    once and re-arm so the NEXT death alerts immediately (not after the cooldown)."""
    _reset_alerts()
    fired = []
    orig = ebay_live._alert_discord
    ebay_live._alert_discord = lambda key, title, msg, urgent=True: fired.append(key)
    try:
        ebay_live._on_research_failure("login_interstitial", "ck1")
        fired.clear()
        ebay_live._on_research_success("ck1")
        assert fired == ["cookie_ok"], fired
        assert ebay_live._COOKIE_DEAD is False
        fired.clear()
        ebay_live._on_research_success("ck1")     # already healthy → silence
        assert fired == [], fired
    finally:
        ebay_live._alert_discord = orig
        _reset_alerts()


def test_alert_cooldown_prevents_spam():
    """Every request hitting a dead cookie would otherwise post to Discord. Only the
    first within the cooldown may fire."""
    _reset_alerts()
    posts = []
    orig_post = ebay_live.requests.post
    orig_hook = ebay_live.EBAY_ALERT_WEBHOOK
    ebay_live.requests.post = lambda url, **kw: posts.append(url)
    ebay_live.EBAY_ALERT_WEBHOOK = "https://example.invalid/webhook"
    try:
        for _ in range(5):
            ebay_live._alert_discord("k", "t", "m")
        time.sleep(0.25)          # let the daemon threads run
        assert len(posts) == 1, posts
    finally:
        ebay_live.requests.post = orig_post
        ebay_live.EBAY_ALERT_WEBHOOK = orig_hook
        _reset_alerts()


def test_alert_noop_without_webhook():
    """No webhook configured → never post, never raise."""
    _reset_alerts()
    posts = []
    orig_post = ebay_live.requests.post
    orig_hook = ebay_live.EBAY_ALERT_WEBHOOK
    ebay_live.requests.post = lambda url, **kw: posts.append(url)
    ebay_live.EBAY_ALERT_WEBHOOK = ""
    try:
        ebay_live._alert_discord("k", "t", "m")
        time.sleep(0.1)
        assert posts == [], posts
    finally:
        ebay_live.requests.post = orig_post
        ebay_live.EBAY_ALERT_WEBHOOK = orig_hook
        _reset_alerts()


def test_research_only_mode_returns_no_data_instead_of_estimate():
    """EBAY_SCRAPE_FALLBACK=0 → research-only. If research yields nothing we must return
    an HONEST error, never a scrape estimate that the caller reads as an exact figure
    (that is exactly what produced the phantom '+16.66 € Flip')."""
    scrape_calls = []
    orig_stats = ebay_live.fetch_research_stats
    orig_scrape = ebay_live._fetch_public_sold_prices
    orig_flag = ebay_live.EBAY_SCRAPE_FALLBACK
    orig_cookie = ebay_live.EBAY_RESEARCH_COOKIE

    def _fake_scrape(*a, **k):
        scrape_calls.append(1)
        return {"avg_price": 99.0, "median_price": 99.0, "monthly_sales": 5,
                "_source": "public_scrape", "velocity_approx": True}

    ebay_live.fetch_research_stats = lambda *a, **k: None          # research gives nothing
    ebay_live._fetch_public_sold_prices = _fake_scrape
    ebay_live.EBAY_RESEARCH_COOKIE = "ebaysid=x; dp1=y"
    try:
        # research-only → honest error, scrape untouched
        ebay_live.EBAY_SCRAPE_FALLBACK = False
        r = ebay_live.lookup_ebay_metrics_query(query="123", mode="ean", ek_net=10.0)
        assert "error" in r and "Scrape-Fallback deaktiviert" in r["error"], r
        assert scrape_calls == [], "scrape must NOT run in research-only mode"

        # fallback on → scrape supplies the (approximate) data
        ebay_live.EBAY_SCRAPE_FALLBACK = True
        r2 = ebay_live.lookup_ebay_metrics_query(query="123", mode="ean", ek_net=10.0)
        assert "error" not in r2, r2
        assert r2["sell_price_median"] == 99.0, r2
        assert r2["debug"]["research_source"] == "public_scrape", r2["debug"]
        assert scrape_calls == [1]
    finally:
        ebay_live.fetch_research_stats = orig_stats
        ebay_live._fetch_public_sold_prices = orig_scrape
        ebay_live.EBAY_SCRAPE_FALLBACK = orig_flag
        ebay_live.EBAY_RESEARCH_COOKIE = orig_cookie


def test_throttle_serializes_concurrent_callers():
    """REGRESSION: the throttle wrote its timestamp only AFTER sleeping, so every
    concurrent caller read the same `last`, slept the same amount and then fired
    together — an N-request burst instead of one-every-interval. That burst is what
    Imperva/Distil blocks on ('übermenschliche Geschwindigkeit'). Concurrent callers
    must queue behind one another."""
    import threading
    orig_min = ebay_live._AIMD_MIN
    ebay_live._AIMD_MIN = 0.2                       # keep the test fast
    ebay_live._AIMD_INTERVAL.clear()
    ebay_live._AIMD_LAST_TS.clear()
    fire, lock = [], threading.Lock()

    def caller():
        ebay_live._throttle_research_aimd("ck")
        with lock:
            fire.append(time.time())

    try:
        ths = [threading.Thread(target=caller) for _ in range(5)]
        for t in ths: t.start()
        for t in ths: t.join()
        fire.sort()
        gaps = [fire[i + 1] - fire[i] for i in range(len(fire) - 1)]
        # every consecutive pair must respect the floor (minus a little scheduling slack)
        assert all(g >= ebay_live._AIMD_MIN * 0.8 for g in gaps), \
            f"burst! gaps={[round(g,3) for g in gaps]}"
    finally:
        ebay_live._AIMD_MIN = orig_min
        ebay_live._AIMD_INTERVAL.clear()
        ebay_live._AIMD_LAST_TS.clear()


def test_de_date_parser():
    ts = ebay_live._parse_de_sold_date("Verkauft  7. Jul 2026")
    assert ts is not None
    ts2 = ebay_live._parse_de_sold_date("Verkauft 25. Mai 2026")
    assert ts2 is not None
    assert ebay_live._parse_de_sold_date("kein datum") is None


# ---------------------------------------------------------------------------
# Fallback runner if pytest is not installed
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import traceback
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
            passed += 1
        except Exception:
            print(f"FAIL  {t.__name__}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    raise SystemExit(1 if failed else 0)
