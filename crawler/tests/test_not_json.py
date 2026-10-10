"""A JSON endpoint serving a page must say so, and must not mark the source as broken.

On 2026-10-10 every Workday tenant returned a non-JSON page in the same run -- the weekly
maintenance window -- and all eight boards went to `failing` with a bare JSONDecodeError.
"""

from __future__ import annotations

import httpx
import pytest

from crawler.client.api import Company
from crawler.http.client import HttpClient, NotJson
from crawler.main import crawl_company

MAINTENANCE = "<html><body>Workday is currently unavailable due to scheduled maintenance</body></html>"


def html_client() -> HttpClient:
    client = HttpClient(max_attempts=1)
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(200, text=MAINTENANCE, headers={"content-type": "text/html"})
        )
    )
    return client


@pytest.mark.asyncio
async def test_non_json_names_what_came_back() -> None:
    async with html_client() as http:
        with pytest.raises(NotJson, match=r"text/html \(HTTP 200\).*scheduled maintenance"):
            await http.post_json("https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs")


@pytest.mark.asyncio
async def test_non_json_is_degraded_not_failed() -> None:
    company = Company(
        id="c1",
        name="Acme",
        source_type="workday",
        source_tier=2,
        source_config={"tenant": "acme", "dataCenter": "wd5", "site": "External"},
        match_overrides=None,
        careers_url=None,
        allow_zero_results=False,
        etag=None,
        last_modified=None,
        last_content_hash=None,
    )
    async with html_client() as http:
        outcome = await crawl_company(company, {}, http)
    assert outcome.status == "degraded"
    assert outcome.error.startswith("non-JSON response: expected JSON, got text/html")
