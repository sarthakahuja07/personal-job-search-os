"""Regression tests for json_api pagination.

Both cases here are silent-truncation bugs found in production: the crawl reported success and
returned a fraction of the jobs. Neither raised anything.
"""

from __future__ import annotations

from typing import Any

import pytest

from crawler.adapters.json_api import JsonApiAdapter
from crawler.http.client import CrawlBudget

CONFIG: dict[str, Any] = {
    "adapter": "json_api",
    "listUrl": "https://example.com/api/search?start={offset}&num={limit}",
    "jobsPath": "data.positions",
    "totalPath": "data.count",
    "pageSize": 100,
    "maxPages": 40,
    "fields": {
        "external_job_id": "displayJobId",
        "title": "name",
        "job_url": {"template": "https://example.com/job/{displayJobId}"},
    },
}


class FakeClient:
    """Serves a board of `total` jobs, capping each page at `server_page_size` regardless of
    what was requested -- the behaviour Microsoft's endpoint actually exhibits."""

    def __init__(self, total: int, server_page_size: int, report_total: bool = True) -> None:
        self.total = total
        self.server_page_size = server_page_size
        self.report_total = report_total
        self.calls = 0

    async def get_json(self, url: str, **kwargs: Any):
        self.calls += 1
        start = int(url.split("start=")[1].split("&")[0])
        remaining = max(0, self.total - start)
        n = min(self.server_page_size, remaining)
        positions = [
            {"displayJobId": f"20000{start + i}", "name": f"Engineer {start + i}"}
            for i in range(n)
        ]
        data: dict[str, Any] = {"data": {"positions": positions}}
        if self.report_total:
            data["data"]["count"] = self.total
        return data, None


@pytest.mark.asyncio
async def test_paginates_past_a_server_capped_page_size():
    """Microsoft's API returns 10 rows however large a `num` you send, while reporting
    count=226. Trusting "fewer rows than requested means done" stopped the crawl at 10."""
    client = FakeClient(total=226, server_page_size=10)
    jobs = await JsonApiAdapter().fetch_list(CONFIG, client, CrawlBudget())
    assert len(jobs) == 226


@pytest.mark.asyncio
async def test_still_stops_on_a_short_page_when_no_total_is_reported():
    """Without an authoritative total the short-page heuristic is all there is, and it must
    still terminate rather than loop to maxPages."""
    client = FakeClient(total=250, server_page_size=100, report_total=False)
    jobs = await JsonApiAdapter().fetch_list(CONFIG, client, CrawlBudget())
    assert len(jobs) == 250
    assert client.calls == 3


@pytest.mark.asyncio
async def test_stops_immediately_on_an_empty_board():
    client = FakeClient(total=0, server_page_size=10)
    assert await JsonApiAdapter().fetch_list(CONFIG, client, CrawlBudget()) == []


@pytest.mark.asyncio
async def test_respects_max_pages_rather_than_looping_forever():
    """A source that never reports exhaustion must still be bounded."""
    config = {**CONFIG, "maxPages": 5, "pageSize": 10}
    client = FakeClient(total=10_000, server_page_size=10)
    jobs = await JsonApiAdapter().fetch_list(config, client, CrawlBudget())
    assert client.calls == 5
    assert len(jobs) == 50


@pytest.mark.asyncio
async def test_ids_are_unique_across_pages():
    client = FakeClient(total=226, server_page_size=10)
    jobs = await JsonApiAdapter().fetch_list(CONFIG, client, CrawlBudget())
    adapter = JsonApiAdapter()
    ids = [adapter.parse(j).external_job_id for j in jobs]
    assert len(set(ids)) == len(ids)
