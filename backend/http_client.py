"""
Shared outbound HTTP client: pooled, cached, bounded, and parallel.

Why this exists
---------------
Enrichment steps (topic lookup, reference verification, author bibliometrics)
were each issuing plain `requests.get` calls sequentially inside the request
path. Reference verification alone could make 30 calls at a 10-second timeout,
so a single slow registry could stall one assessment for minutes. Behind a
host with a request timeout that surfaces as an HTTP 503 with no explanation,
and the work already done is lost.

Three mechanisms address that:

* **Connection pooling** — one `Session` with a mounted adapter, so TCP and TLS
  handshakes are not repeated per call.
* **Response caching** — DOI existence and author records effectively never
  change, so repeated lookups should not repeat network work.
* **A hard time budget** — `run_bounded` executes calls in parallel and returns
  whatever finished when the budget expires. Enrichment is best-effort by
  nature: a missing author h-index should degrade the dossier, never fail the
  assessment.

The guiding rule is that no external service may extend a request unboundedly.
Every caller declares a budget, and exceeding it yields partial results rather
than an error.
"""
import time
import logging
import threading
import concurrent.futures
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

import requests
from requests.adapters import HTTPAdapter

try:
    from urllib3.util.retry import Retry
    RETRY_AVAILABLE = True
except ImportError:
    Retry = None
    RETRY_AVAILABLE = False

USER_AGENT = "ScholarPi-PiIndex/2.2 (mailto:research@pi-index.org)"
DEFAULT_HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json"}

# Per-call ceiling. Deliberately short: these are metadata lookups against fast
# public APIs, and a slow response is far more likely to be a struggling
# endpoint than a large payload worth waiting for.
DEFAULT_TIMEOUT = 6.0

_session_lock = threading.Lock()
_session: Optional[requests.Session] = None


def get_session() -> requests.Session:
    """Process-wide pooled session."""
    global _session
    if _session is not None:
        return _session
    with _session_lock:
        if _session is not None:
            return _session
        s = requests.Session()
        s.headers.update(DEFAULT_HEADERS)
        if RETRY_AVAILABLE:
            # Retry only on transient server-side conditions. A 404 is a real
            # answer here — reference verification depends on distinguishing
            # "absent" from "unreachable", so retrying 404 would be wrong.
            retry = Retry(
                total=2, connect=2, read=1, backoff_factor=0.35,
                status_forcelist=(429, 500, 502, 503, 504),
                allowed_methods=frozenset(["GET", "HEAD"]),
                raise_on_status=False,
            )
            adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=20)
        else:
            adapter = HTTPAdapter(pool_connections=10, pool_maxsize=20)
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        _session = s
        return _session


# ---------------------------------------------------------------------------
# Response cache
# ---------------------------------------------------------------------------
class TimedCache:
    """Small thread-safe TTL cache with bounded size."""

    def __init__(self, ttl: float = 3600.0, max_entries: int = 4096):
        self.ttl = ttl
        self.max_entries = max_entries
        self._data: Dict[Any, Tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key, default=None):
        with self._lock:
            entry = self._data.get(key)
            if not entry:
                return default
            stored_at, value = entry
            if (time.time() - stored_at) > self.ttl:
                self._data.pop(key, None)
                return default
            return value

    def set(self, key, value):
        with self._lock:
            if len(self._data) >= self.max_entries:
                # Evict the oldest quarter rather than one entry, so eviction
                # cost is amortised instead of paid on every insert at capacity.
                for k in sorted(self._data, key=lambda k: self._data[k][0])[: self.max_entries // 4]:
                    self._data.pop(k, None)
            self._data[key] = (time.time(), value)

    def clear(self):
        with self._lock:
            self._data.clear()

    def __len__(self):
        with self._lock:
            return len(self._data)


# DOI existence is effectively permanent once established, so it is cached for
# a long time. Author records and topic assignments do change, but slowly.
doi_cache = TimedCache(ttl=30 * 24 * 3600, max_entries=20000)
author_cache = TimedCache(ttl=24 * 3600, max_entries=4096)
work_cache = TimedCache(ttl=7 * 24 * 3600, max_entries=4096)


def fetch_json(url: str, params: dict = None, timeout: float = DEFAULT_TIMEOUT,
               cache: TimedCache = None, cache_key=None) -> Tuple[Optional[int], Optional[dict]]:
    """GET a JSON endpoint.

    Returns ``(status_code, payload)``. The status code is preserved
    deliberately: callers need to tell "the server said no" (404) apart from
    "the server said nothing" (None), because those mean opposite things when
    verifying whether a cited work exists.
    """
    key = cache_key or (url, tuple(sorted((params or {}).items())))
    if cache is not None:
        hit = cache.get(key)
        if hit is not None:
            return hit

    try:
        res = get_session().get(url, params=params, timeout=timeout)
        payload = None
        if res.status_code == 200:
            try:
                payload = res.json()
            except ValueError:
                payload = None
        result = (res.status_code, payload)
    except requests.RequestException as e:
        logging.debug("HTTP request failed for %s: %s", url, e)
        result = (None, None)

    # Only cache definitive answers. Caching a transient failure would turn a
    # momentary outage into a persistent wrong result.
    if cache is not None and result[0] in (200, 404):
        cache.set(key, result)
    return result


# ---------------------------------------------------------------------------
# Bounded parallel execution
# ---------------------------------------------------------------------------
def run_bounded(tasks: Iterable[Tuple[Any, Callable[[], Any]]], budget_seconds: float = 8.0,
                max_workers: int = 6) -> Dict[Any, Any]:
    """Run tasks in parallel, returning whatever completed within the budget.

    Unfinished work is abandoned rather than waited on. Callers get a partial
    result dict and are expected to treat a missing key as "not determined" —
    which is exactly the right semantics for enrichment that must never be
    allowed to fail an assessment.
    """
    task_list = list(tasks)
    if not task_list:
        return {}

    results: Dict[Any, Any] = {}
    deadline = time.time() + budget_seconds

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=min(max_workers, len(task_list))
    ) as executor:
        future_map = {executor.submit(fn): key for key, fn in task_list}
        try:
            for future in concurrent.futures.as_completed(
                future_map, timeout=max(0.1, deadline - time.time())
            ):
                key = future_map[future]
                try:
                    results[key] = future.result()
                except Exception as e:
                    logging.debug("Bounded task %s failed: %s", key, e)
        except concurrent.futures.TimeoutError:
            incomplete = len(task_list) - len(results)
            logging.info(
                "Bounded batch hit its %.1fs budget with %d task(s) unfinished; "
                "returning partial results.", budget_seconds, incomplete,
            )
        finally:
            for future in future_map:
                future.cancel()

    return results


def guarded(fn: Callable, fallback=None, label: str = ""):
    """Run a callable, returning `fallback` on any failure.

    Enrichment steps are individually fault-isolated so that one unreachable
    third-party service degrades a single field rather than aborting the whole
    assessment — and the paper's processing fee with it.
    """
    try:
        return fn()
    except Exception as e:
        logging.warning("Enrichment step '%s' failed: %s", label or getattr(fn, "__name__", "?"), e)
        return fallback
