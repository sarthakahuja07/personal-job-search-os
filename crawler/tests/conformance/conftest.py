"""Cassette replay for the conformance suite.

Tests never touch the network. They replay responses recorded from the real endpoints by
`scripts/record_cassettes.py`, which is what makes the suite honest: a hand-written fixture
tests the adapter against the shape you imagined, and the shape you imagined is exactly the one
that never breaks in production.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from crawler.adapters.registry import ADAPTERS

CASSETTE_DIR = Path(__file__).resolve().parent.parent / "cassettes"


def load_cassette(source_type: str) -> dict[str, Any] | None:
    path = CASSETTE_DIR / f"{source_type}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


class _FakeResponse:
    """Just enough of httpx.Response for an adapter that reads .text."""

    def __init__(self, text: str, status_code: int = 200) -> None:
        self.text = text
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise AssertionError(f"recorded response was {self.status_code}")


class ReplayClient:
    """Serves recorded responses, and records what it was asked for.

    List pages are returned in the order they were captured. Detail lookups are matched by the
    identifier embedded in the URL, so an adapter that requests the wrong job fails rather than
    silently receiving the right one.
    """

    def __init__(self, cassette: dict[str, Any]) -> None:
        self.cassette = cassette
        self.list_calls = 0
        self.requests: list[dict[str, Any]] = []
        self.detail_calls = 0

    def _next_list_page(self) -> Any:
        pages = self.cassette["list"]
        page = pages[min(self.list_calls, len(pages) - 1)]
        self.list_calls += 1
        # Past the recorded pages, mimic a real board running out of results rather than
        # looping the last page forever.
        if self.list_calls > len(pages):
            return self._empty_like(page)
        return page

    def _empty_like(self, page: Any) -> Any:
        """A page shaped like the recorded one but carrying no jobs.

        Emptying the right key matters: a source whose payload key this does not know keeps
        returning a full page, the adapter never sees exhaustion, and the run looks like an
        infinite board of duplicates. The envelope key is read from the cassette's own config
        so every adapter is handled, not just the ones with a hardcoded key here.
        """
        if isinstance(page, list):
            return []
        if not isinstance(page, dict):
            return page

        out = dict(page)
        config = self.cassette.get("config") or {}
        keys = {"jobs", "jobPostings", "content"}
        for configured in (config.get("jobsPath"), config.get("htmlPath")):
            if isinstance(configured, str) and "." not in configured:
                keys.add(configured)

        for key in keys:
            if key in out:
                # An HTML envelope empties to a string; a JSON list empties to a list.
                out[key] = "" if isinstance(out[key], str) else []

        # Mirrors the real Workday behaviour: later pages report total 0.
        if "total" in out:
            out["total"] = 0
        return out

    def _detail(self, url: str) -> Any:
        for key, value in self.cassette.get("details", {}).items():
            if key in url:
                self.detail_calls += 1
                return value
        raise AssertionError(f"no recorded detail response for {url}")

    def _is_detail(self, url: str) -> bool:
        return any(key in url for key in self.cassette.get("details", {}))

    async def get_json(self, url: str, **kwargs: Any):
        self.requests.append({"method": "GET", "url": url, **kwargs})
        if self._is_detail(url):
            return self._detail(url), None
        return self._next_list_page(), None

    async def post_json(self, url: str, **kwargs: Any):
        self.requests.append({"method": "POST", "url": url, **kwargs})
        return self._next_list_page(), None

    async def request(self, method: str, url: str, **kwargs: Any):
        """Serve the recorded HTML page. Used by adapters that read markup rather than JSON."""
        self.requests.append({"method": method, "url": url, **kwargs})
        html = self.cassette.get("html")
        if html is None:
            raise AssertionError(f"no recorded HTML for {url}")
        self.list_calls += 1
        return _FakeResponse(html)


def registered_adapters() -> list[tuple[str, Any, dict[str, Any]]]:
    """Every registered adapter that has a cassette, as pytest parameters.

    Registering an adapter is what subjects it to this suite. An adapter without a cassette is
    reported as a failure rather than skipped -- silently untested adapters are the thing this
    file exists to prevent.
    """
    out = []
    for source_type, adapter in sorted(ADAPTERS.items()):
        cassette = load_cassette(source_type)
        out.append((source_type, adapter, cassette))
    return out


ADAPTER_CASES = registered_adapters()
ADAPTER_IDS = [c[0] for c in ADAPTER_CASES]


@pytest.fixture(params=ADAPTER_CASES, ids=ADAPTER_IDS)
def adapter_case(request):
    source_type, adapter, cassette = request.param
    if cassette is None:
        pytest.fail(
            f"adapter '{source_type}' is registered but has no cassette. "
            f"Run: python scripts/record_cassettes.py"
        )
    return source_type, adapter, cassette
