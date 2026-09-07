"""Regression tests for json_api pagination.

Both cases here are silent-truncation bugs found in production: the crawl reported success and
returned a fraction of the jobs. Neither raised anything.
"""

from __future__ import annotations

from typing import Any

import pytest

from crawler.adapters.base import SchemaDriftError
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
async def test_hitting_the_page_cap_short_of_the_total_is_loud():
    """Bounded is not enough -- it must also be honest. A page ceiling reached before the
    board is exhausted returns a fraction of the jobs, and returning 400 of 579 while
    reporting success is precisely the silent truncation this project guards against."""
    config = {**CONFIG, "maxPages": 5, "pageSize": 10}
    client = FakeClient(total=10_000, server_page_size=10)
    with pytest.raises(SchemaDriftError, match="maxPages"):
        await JsonApiAdapter().fetch_list(config, client, CrawlBudget())
    assert client.calls == 5


@pytest.mark.asyncio
async def test_page_cap_without_a_known_total_stays_bounded_and_silent():
    """With no authoritative total there is nothing to compare against, so the cap is just a
    bound -- it must stop, not raise."""
    config = {**CONFIG, "maxPages": 5, "pageSize": 10}
    client = FakeClient(total=10_000, server_page_size=10, report_total=False)
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


class SinglePageClient:
    """An endpoint that returns its entire board in one response and ignores pagination,
    which is what Atlassian's careers listing does."""

    def __init__(self, count: int) -> None:
        self.count = count
        self.calls = 0

    async def get_json(self, url: str, **kwargs: Any):
        self.calls += 1
        return [
            {"displayJobId": f"2558{i}", "name": f"Engineer {i}"} for i in range(self.count)
        ], None


ROOT_ARRAY_CONFIG: dict[str, Any] = {
    "adapter": "json_api",
    "listUrl": "https://example.com/endpoint/careers/listings",
    "jobsPath": ".",
    "fields": CONFIG["fields"],
}


@pytest.mark.asyncio
async def test_unpaginated_endpoint_is_fetched_exactly_once():
    """The URL carries no {offset}/{page}, so re-requesting it can only ever return the same
    rows. Looping to maxPages would have turned 253 Atlassian jobs into 10,120 duplicates
    while reporting a completely successful crawl."""
    client = SinglePageClient(count=253)
    jobs = await JsonApiAdapter().fetch_list(ROOT_ARRAY_CONFIG, client, CrawlBudget())
    assert client.calls == 1
    assert len(jobs) == 253


@pytest.mark.asyncio
async def test_root_array_payload_is_addressable():
    """Some endpoints return a bare top-level array rather than an object wrapping one."""
    jobs = await JsonApiAdapter().fetch_list(
        ROOT_ARRAY_CONFIG, SinglePageClient(count=3), CrawlBudget()
    )
    assert [JsonApiAdapter().parse(j).external_job_id for j in jobs] == ["25580", "25581", "25582"]


@pytest.mark.asyncio
async def test_paginated_urls_are_still_paginated():
    """The single-page inference must not disable pagination for endpoints that do take an
    offset -- that would silently truncate every tier-3 source to one page."""
    client = FakeClient(total=226, server_page_size=10)
    jobs = await JsonApiAdapter().fetch_list(CONFIG, client, CrawlBudget())
    assert client.calls > 1
    assert len(jobs) == 226


class PagedClient:
    """1-based page numbering, the convention DirectEmployers/jobsyn uses."""

    def __init__(self, total: int, page_size: int) -> None:
        self.total = total
        self.page_size = page_size
        self.pages_seen: list[int] = []

    async def get_json(self, url: str, **kwargs: Any):
        page = int(url.split("page=")[1].split("&")[0])
        self.pages_seen.append(page)
        start = (page - 1) * self.page_size
        n = max(0, min(self.page_size, self.total - start))
        return {
            "jobs": [
                {"displayJobId": f"3086{start + i}", "name": f"Engineer {start + i}"}
                for i in range(n)
            ],
            "pagination": {"total": self.total},
        }, None


@pytest.mark.asyncio
async def test_start_page_makes_numbering_one_based():
    """Defaulting to page=0 against a 1-based endpoint silently skips or repeats a page."""
    config = {
        **CONFIG,
        "listUrl": "https://example.com/api/search?page={page}",
        "jobsPath": "jobs",
        "totalPath": "pagination.total",
        "pageSize": 10,
        "startPage": 1,
    }
    client = PagedClient(total=16, page_size=10)
    jobs = await JsonApiAdapter().fetch_list(config, client, CrawlBudget())
    assert client.pages_seen == [1, 2]
    assert len(jobs) == 16
