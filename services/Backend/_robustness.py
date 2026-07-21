"""
Backend Robustness Layer
========================

Reusable concurrency primitives for upstream API calls (eBay, Kaufland, Amazon):

  • InflightCoalescer — multiple concurrent callers for same key share one upstream call
  • CircuitBreaker    — short-circuit failing endpoints, prevent cascading slowdowns
  • ProxyHealth       — track per-proxy failures, skip dead proxies for cooldown
  • TTLCache          — thread-safe time-bound cache with LRU eviction
  • Semaphore wrappers — limit concurrent upstream calls

All primitives are thread-safe (FastAPI runs sync code in thread pool via run_in_executor).
"""
from __future__ import annotations
import logging
import random
import threading
import time
from collections import OrderedDict, deque
from typing import Any, Callable, Deque, Dict, Optional

logger = logging.getLogger("FLIPCHECK.robustness")


# ════════════════════════════════════════════════════════════════════════════
# 1. InflightCoalescer — request deduplication
# ════════════════════════════════════════════════════════════════════════════
class InflightCoalescer:
    """
    If 5 concurrent requests for the same key come in, only fire 1 upstream
    call. The other 4 wait for the result. Massive saving when popular EANs
    get hit by multiple users simultaneously.

    Usage:
        coalescer = InflightCoalescer(timeout=20)
        result = coalescer.run("ebay:research:1234567890123", fetch_fn, *args)
    """

    def __init__(self, timeout: float = 20.0):
        self._timeout = timeout
        self._lock = threading.Lock()
        self._inflight: Dict[str, threading.Event] = {}
        self._results: Dict[str, Any] = {}

    def run(self, key: str, fn: Callable, *args, **kwargs):
        with self._lock:
            event = self._inflight.get(key)
            if event is None:
                # We're the leader — execute fn
                event = threading.Event()
                self._inflight[key] = event
                leader = True
            else:
                leader = False

        if leader:
            try:
                result = fn(*args, **kwargs)
                with self._lock:
                    self._results[key] = ("ok", result)
                event.set()
                return result
            except Exception as exc:
                with self._lock:
                    self._results[key] = ("err", exc)
                event.set()
                raise
            finally:
                # Defer cleanup so followers have a chance to read result
                def _cleanup():
                    time.sleep(2)
                    with self._lock:
                        self._inflight.pop(key, None)
                        self._results.pop(key, None)
                threading.Thread(target=_cleanup, daemon=True).start()
        else:
            # Follower — wait for leader's result
            if not event.wait(timeout=self._timeout):
                raise TimeoutError(f"Coalesced wait for '{key}' exceeded {self._timeout}s")
            with self._lock:
                kind, payload = self._results.get(key, ("err", RuntimeError("result lost")))
            if kind == "err":
                raise payload
            return payload


# ════════════════════════════════════════════════════════════════════════════
# 2. CircuitBreaker — fail fast when upstream is down
# ════════════════════════════════════════════════════════════════════════════
class CircuitBreaker:
    """
    Tracks failures within a sliding window. If failure_threshold is exceeded,
    short-circuit subsequent calls for cooldown_sec seconds → return None
    immediately instead of waiting on a dead upstream.

    Three states:
      • CLOSED — normal, calls go through
      • OPEN   — failing, calls return None immediately for cooldown
      • HALF_OPEN — after cooldown, allow ONE test call; if ok → close, else re-open

    Usage:
        breaker = CircuitBreaker(failure_threshold=5, window_sec=60, cooldown_sec=30)
        if breaker.is_open():
            return None
        try:
            result = upstream_call()
            breaker.record_success()
            return result
        except Exception:
            breaker.record_failure()
            return None
    """

    def __init__(self, failure_threshold: int = 5, window_sec: int = 60, cooldown_sec: int = 30):
        self._threshold = failure_threshold
        self._window = window_sec
        self._cooldown = cooldown_sec
        self._failures: Deque[float] = deque()
        self._opened_at: float = 0.0
        self._half_open_test_pending: bool = False
        self._lock = threading.Lock()

    def is_open(self) -> bool:
        """Returns True if calls should short-circuit."""
        with self._lock:
            if self._opened_at == 0:
                return False
            elapsed = time.time() - self._opened_at
            if elapsed >= self._cooldown:
                # Allow one test call (HALF_OPEN)
                if not self._half_open_test_pending:
                    self._half_open_test_pending = True
                    return False  # Let this caller through as test
                return True
            return True

    def record_success(self) -> None:
        with self._lock:
            self._failures.clear()
            self._opened_at = 0.0
            self._half_open_test_pending = False

    def record_failure(self) -> None:
        with self._lock:
            now = time.time()
            self._failures.append(now)
            # Remove old failures outside the window
            while self._failures and self._failures[0] < now - self._window:
                self._failures.popleft()

            # If we were in HALF_OPEN and the test failed, re-open immediately
            if self._half_open_test_pending:
                self._half_open_test_pending = False
                self._opened_at = now
                logger.warning("Circuit re-opened after half-open test failed")
                return

            if len(self._failures) >= self._threshold:
                self._opened_at = now
                logger.warning(
                    f"Circuit OPEN: {len(self._failures)} failures in {self._window}s window — "
                    f"short-circuiting for {self._cooldown}s"
                )

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "is_open": self._opened_at > 0 and (time.time() - self._opened_at) < self._cooldown,
                "failure_count": len(self._failures),
                "threshold": self._threshold,
                "opened_at": self._opened_at,
            }


# ════════════════════════════════════════════════════════════════════════════
# 3. ProxyHealth — per-proxy health tracking
# ════════════════════════════════════════════════════════════════════════════
class ProxyHealth:
    """
    Marks proxies bad after failures. Skipped from rotation until cooldown expires.
    Prevents wasting requests on dead proxies.
    """

    def __init__(self, cooldown_sec: int = 120):
        self._cooldown = cooldown_sec
        self._bad_until: Dict[str, float] = {}
        self._lock = threading.Lock()

    def mark_bad(self, proxy_url: str) -> None:
        with self._lock:
            self._bad_until[proxy_url] = time.time() + self._cooldown
        logger.info(f"Proxy {proxy_url[:40]}... marked bad for {self._cooldown}s")

    def is_healthy(self, proxy_url: str) -> bool:
        with self._lock:
            until = self._bad_until.get(proxy_url, 0)
            if time.time() >= until:
                # Cooldown expired — remove from bad list
                self._bad_until.pop(proxy_url, None)
                return True
            return False

    def pick_random_healthy(self, proxies: list) -> Optional[Any]:
        """Returns a random healthy proxy from list, or None if all are bad."""
        if not proxies:
            return None
        healthy = []
        for p in proxies:
            url = p.get("http") if isinstance(p, dict) else str(p)
            if self.is_healthy(url):
                healthy.append(p)
        if not healthy:
            return None
        return random.choice(healthy)


# ════════════════════════════════════════════════════════════════════════════
# 3b. CookieHealth — per-cookie health tracking (throttle is cookie-bound)
# ════════════════════════════════════════════════════════════════════════════
class CookieHealth:
    """
    Mirror of ProxyHealth, but for Seller-Hub research cookies. The /sh/research
    throttle is bound to the cookie+session (not the IP), so a 429/soft-block must
    cool the *cookie*, not (only) the proxy. Default cooldown is longer than the
    proxy cooldown because a throttled account stays throttled for a while.
    """

    def __init__(self, cooldown_sec: int = 300):
        self._cooldown = cooldown_sec
        self._bad_until: Dict[str, float] = {}
        self._lock = threading.Lock()

    def mark_bad(self, cookie_id: str, cooldown_sec: Optional[float] = None) -> None:
        if not cookie_id:
            return
        cd = self._cooldown if cooldown_sec is None else cooldown_sec
        with self._lock:
            self._bad_until[cookie_id] = time.time() + cd
        logger.info(f"Cookie {cookie_id[:12]}... marked bad for {cd:.0f}s")

    def is_healthy(self, cookie_id: str) -> bool:
        with self._lock:
            until = self._bad_until.get(cookie_id, 0)
            if time.time() >= until:
                self._bad_until.pop(cookie_id, None)
                return True
            return False

    def pick_random_healthy(self, cookie_ids: list) -> Optional[str]:
        """Return a random healthy cookie_id, or None if all are cooling."""
        if not cookie_ids:
            return None
        healthy = [c for c in cookie_ids if self.is_healthy(c)]
        if not healthy:
            return None
        return random.choice(healthy)


# ════════════════════════════════════════════════════════════════════════════
# 4. TTLCache — thread-safe time-bound LRU cache
# ════════════════════════════════════════════════════════════════════════════
class TTLCache:
    """
    Time-bound LRU cache with a max size. Thread-safe.
    Better than dict-based caches because:
      - LRU eviction prevents unbounded memory growth
      - Lock prevents race conditions on concurrent get+set
    """

    def __init__(self, max_size: int = 1000, ttl_sec: int = 1800):
        self._max_size = max_size
        self._ttl = ttl_sec
        self._cache: OrderedDict = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            ts, value = entry
            if time.time() - ts > self._ttl:
                self._cache.pop(key, None)
                return None
            # Move to end (most recently used)
            self._cache.move_to_end(key)
            return value

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._cache[key] = (time.time(), value)
            self._cache.move_to_end(key)
            # Evict oldest if over capacity
            while len(self._cache) > self._max_size:
                self._cache.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()

    def size(self) -> int:
        with self._lock:
            return len(self._cache)


# ════════════════════════════════════════════════════════════════════════════
# 5. BoundedSemaphore wrapper for upstream call limiting
# ════════════════════════════════════════════════════════════════════════════
class UpstreamLimiter:
    """
    Limits concurrent upstream API calls. If 100 user requests come in but
    we only allow 10 concurrent calls to eBay, the rest queue politely.

    Combine with Coalescer for max efficiency.
    """

    def __init__(self, max_concurrent: int = 10, acquire_timeout: float = 30.0):
        self._sem = threading.BoundedSemaphore(max_concurrent)
        self._timeout = acquire_timeout

    def __enter__(self):
        if not self._sem.acquire(timeout=self._timeout):
            raise TimeoutError(f"Could not acquire upstream slot in {self._timeout}s")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self._sem.release()
        return False


# ════════════════════════════════════════════════════════════════════════════
# 6. Combined: robust_request — retry + circuit + proxy health
# ════════════════════════════════════════════════════════════════════════════
def _parse_retry_after(value: Optional[str]) -> Optional[float]:
    """Parse a Retry-After header: delta-seconds (int) or HTTP-date. Returns seconds or None."""
    if not value:
        return None
    value = value.strip()
    try:
        secs = float(value)
        return max(0.0, secs)
    except (TypeError, ValueError):
        pass
    try:
        from email.utils import parsedate_to_datetime
        import datetime as _dt
        dt = parsedate_to_datetime(value)
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_dt.timezone.utc)
        delta = (dt - _dt.datetime.now(_dt.timezone.utc)).total_seconds()
        return max(0.0, delta)
    except Exception:
        return None


def robust_request(
    request_fn: Callable,
    breaker: CircuitBreaker,
    proxy_health: ProxyHealth,
    proxies: list,
    use_proxy: bool = True,
    max_retries: int = 2,
    backoff_base: float = 0.5,
    *,
    retry_after_cap: float = 60.0,
    rate_limit_backoff_base: float = 5.0,
    on_rate_limit: Optional[Callable[[Optional[float]], None]] = None,
    throttle_opens_circuit: bool = True,
):
    """
    Execute an HTTP request with:
      - Circuit breaker check (fail fast if upstream is down)
      - Proxy health-aware selection (skip dead proxies)
      - Exponential backoff retry on transient errors
      - Proxy auto-marking bad on failure
      - Retry-After-aware backoff on 403/429 (delta-seconds or HTTP-date)
      - on_rate_limit(retry_after) callback so the caller can cool a throttled COOKIE
        (the /sh/research throttle is cookie-bound, not proxy-bound)
      - sustained 429/403 counts toward the circuit so a fully-throttled pool opens it

    request_fn signature: (proxy: Optional[Dict]) -> response
        Should return a response object with .status_code, or raise on network error.

    Returns: response object on success, None on circuit-open or all-failed.
    """
    if breaker.is_open():
        logger.info("Circuit open — short-circuit returning None")
        return None

    last_error = None
    saw_throttle = False
    for attempt in range(max_retries + 1):
        proxy = proxy_health.pick_random_healthy(proxies) if (use_proxy and proxies) else None
        proxy_url = (proxy.get("http") if isinstance(proxy, dict) else None) if proxy else None
        retry_after: Optional[float] = None

        try:
            resp = request_fn(proxy)
            if resp is None:
                last_error = "request_fn returned None"
                if proxy_url:
                    proxy_health.mark_bad(proxy_url)
            elif resp.status_code == 200:
                breaker.record_success()
                return resp
            elif resp.status_code in (403, 429, 430):
                # Throttle / soft-block — bound to cookie+session, not just IP.
                saw_throttle = True
                try:
                    hdrs = resp.headers or {}
                    retry_after = _parse_retry_after(
                        hdrs.get("Retry-After") or hdrs.get("retry-after")
                    )
                except Exception:
                    retry_after = None
                if proxy_url:
                    proxy_health.mark_bad(proxy_url)
                if on_rate_limit is not None:
                    try:
                        on_rate_limit(retry_after)
                    except Exception:
                        pass
                if throttle_opens_circuit:
                    # Count sustained throttling toward the breaker so a fully
                    # throttled pool opens the circuit instead of hammering.
                    breaker.record_failure()
                last_error = f"HTTP {resp.status_code}"
            elif resp.status_code >= 500:
                # Upstream failure — count toward circuit
                breaker.record_failure()
                last_error = f"HTTP {resp.status_code}"
            else:
                # 4xx other — don't retry, return as-is so caller can handle
                return resp
        except Exception as exc:
            last_error = type(exc).__name__
            if proxy_url:
                proxy_health.mark_bad(proxy_url)

        if attempt < max_retries:
            if retry_after is not None:
                delay = min(retry_after, retry_after_cap)
            elif saw_throttle:
                delay = rate_limit_backoff_base * (2 ** attempt) + random.uniform(0, 0.5)
            else:
                # Exponential backoff with jitter
                delay = backoff_base * (2 ** attempt) + random.uniform(0, 0.2)
            time.sleep(max(0.0, delay))

    # All retries exhausted
    breaker.record_failure()
    logger.info(f"robust_request failed after {max_retries + 1} attempts: {last_error}")
    return None
