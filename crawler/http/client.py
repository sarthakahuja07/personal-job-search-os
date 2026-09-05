"""Polite, adaptive, bounded HTTP client for crawling job feeds.

Responsibilities live here rather than in adapters, so every adapter inherits the same
behaviour: adaptive pacing, retries with backoff, per-host concurrency, and request budgets.
Adapters only describe *what* to fetch.

Politeness policy, in order of importance:

  1. Never hammer. A 429 or 5xx widens the delay for that host immediately and Retry-After is
     always obeyed. Backing off is never optional.
  2. Adapt to the host. A fast, healthy API earns a shorter delay; a slow or complaining one
     earns a longer one. A fixed delay is either rude to small sites or needlessly slow against
     large ones -- Target's 2000-job board timed out at a flat 0.25s per request.
  3. Stay bounded. Per-host concurrency is small and the delay never drops below a floor, so
     even a fast host sees a modest, steady request rate rather than a burst.
"""

from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import httpx
import structlog

log = structlog.get_logger(__name__)

# Honest identification. We are not pretending to be a browser.
USER_AGENT = (
    "job-search-os/0.1 (personal job-search tool; single user; "
    "respects robots.txt and Retry-After)"
)

RETRYABLE_STATUS = {429, 500, 502, 503, 504}

# Adaptive delay bounds, in seconds.
MIN_DELAY = 0.08
MAX_DELAY = 8.0
START_DELAY = 0.35
# Multiplicative decrease on success, multiplicative increase on trouble.
DECAY = 0.9
GROWTH = 2.5


class BudgetExceeded(RuntimeError):
    """Raised when a company exhausts its request or time budget."""


class RateLimited(RuntimeError):
    """Raised when a host keeps returning 429 after backoff."""


@dataclass
class CrawlBudget:
    """Ceilings so one pathological company cannot consume the whole run.

    Generous enough for the biggest real board (NVIDIA and Target both list 2000 roles, which is
    100 list pages plus detail fetches) while still bounding a runaway.
    """

    max_requests: int = 1500
    max_seconds: float = 600.0
    _used: int = field(default=0, init=False)
    _started: float | None = field(default=None, init=False)

    def start(self) -> None:
        self._started = asyncio.get_event_loop().time()

    def spend(self) -> None:
        if self._started is None:
            self.start()
        self._used += 1
        if self._used > self.max_requests:
            raise BudgetExceeded(f"request budget of {self.max_requests} exhausted")
        elapsed = asyncio.get_event_loop().time() - (self._started or 0)
        if elapsed > self.max_seconds:
            raise BudgetExceeded(f"time budget of {self.max_seconds}s exhausted")

    @property
    def used(self) -> int:
        return self._used


@dataclass
class _HostState:
    semaphore: asyncio.Semaphore
    delay: float = START_DELAY
    consecutive_ok: int = 0

    def on_success(self) -> None:
        self.consecutive_ok += 1
        # Only speed up after a run of clean responses, so one lucky request does not
        # immediately drop the pacing.
        if self.consecutive_ok >= 5:
            self.delay = max(MIN_DELAY, self.delay * DECAY)
            self.consecutive_ok = 0

    def on_trouble(self) -> None:
        self.consecutive_ok = 0
        self.delay = min(MAX_DELAY, self.delay * GROWTH)


class HttpClient:
    def __init__(
        self,
        *,
        per_host_concurrency: int = 3,
        max_attempts: int = 4,
        timeout: float = 30.0,
    ) -> None:
        self._client = httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
            timeout=timeout,
            limits=httpx.Limits(max_connections=12, max_keepalive_connections=6),
        )
        self._hosts: dict[str, _HostState] = {}
        self._per_host_concurrency = per_host_concurrency
        self._max_attempts = max_attempts

    async def __aenter__(self) -> HttpClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._client.aclose()

    def _host_state(self, url: str) -> _HostState:
        host = urlsplit(url).netloc
        if host not in self._hosts:
            self._hosts[host] = _HostState(
                semaphore=asyncio.Semaphore(self._per_host_concurrency)
            )
        return self._hosts[host]

    def pacing(self) -> dict[str, float]:
        """Current per-host delay, for logging and for the doctor report."""
        return {host: round(state.delay, 3) for host, state in self._hosts.items()}

    async def request(
        self,
        method: str,
        url: str,
        *,
        budget: CrawlBudget | None = None,
        **kwargs: Any,
    ) -> httpx.Response:
        state = self._host_state(url)
        last_exc: Exception | None = None

        for attempt in range(1, self._max_attempts + 1):
            if budget:
                budget.spend()

            response: httpx.Response | None = None
            async with state.semaphore:
                try:
                    response = await self._client.request(method, url, **kwargs)
                except (httpx.TimeoutException, httpx.TransportError) as exc:
                    last_exc = exc
                # Pace inside the semaphore so the delay genuinely limits the request rate
                # to this host rather than merely delaying the caller.
                await asyncio.sleep(state.delay)

            if response is not None and response.status_code not in RETRYABLE_STATUS:
                state.on_success()
                return response

            state.on_trouble()

            if attempt == self._max_attempts:
                if response is not None and response.status_code == 429:
                    raise RateLimited(f"{url} still rate-limiting after {attempt} attempts")
                if last_exc:
                    raise last_exc
                return response  # type: ignore[return-value]

            # Retry-After always wins. Otherwise exponential backoff with jitter.
            delay = min(2**attempt, 30) + random.uniform(0, 0.5)
            if response is not None:
                retry_after = response.headers.get("retry-after")
                if retry_after and retry_after.strip().isdigit():
                    delay = min(float(retry_after), 120.0)
                log.warning(
                    "http.retry",
                    url=url[:120],
                    status=response.status_code,
                    attempt=attempt,
                    sleep=round(delay, 2),
                    host_delay=round(state.delay, 3),
                )
            await asyncio.sleep(delay)

        raise RuntimeError("unreachable")

    async def get_json(self, url: str, **kwargs: Any) -> tuple[Any, httpx.Response]:
        r = await self.request("GET", url, **kwargs)
        r.raise_for_status()
        return r.json(), r

    async def post_json(self, url: str, **kwargs: Any) -> tuple[Any, httpx.Response]:
        r = await self.request("POST", url, **kwargs)
        r.raise_for_status()
        return r.json(), r
