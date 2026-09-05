"""Regression tests for the Workday pagination traps.

These use a fake client rather than cassettes because the bug is in loop control, not parsing --
what matters is how the adapter reacts to a sequence of responses.
"""

from __future__ import annotations

from typing import Any

import pytest

from crawler.adapters.workday import PAGE_SIZE, WorkdayAdapter
from crawler.http.client import CrawlBudget

CONFIG = {"tenant": "acme", "dataCenter": "wd5", "site": "External"}


class FakeClient:
    """Replays a scripted list of Workday responses and records the bodies it was sent."""

    def __init__(self, pages: list[dict[str, Any]]) -> None:
        self.pages = pages
        self.requests: list[dict[str, Any]] = []

    async def post_json(self, url: str, *, json: dict[str, Any], **kwargs: Any):
        self.requests.append(json)
        index = len(self.requests) - 1
        if index >= len(self.pages):
            return {"total": 0, "jobPostings": []}, None
        return self.pages[index], None


def page(count: int, total: int, start: int = 0) -> dict[str, Any]:
    return {
        "total": total,
        "jobPostings": [
            {
                "title": f"Software Engineer II {start + i}",
                "externalPath": f"/job/Bengaluru/SWE_JR{start + i}",
                "locationsText": "India, Bengaluru",
                "postedOn": "Posted Today",
                "bulletFields": [f"JR{start + i}"],
            }
            for i in range(count)
        ],
    }


@pytest.mark.asyncio
async def test_paginates_past_the_first_page_when_total_resets_to_zero():
    """Trap 4. Later pages report total=0; the adapter must use the FIRST page's total.

    Before the fix this stopped after 2 pages -- 40 of 100 jobs -- and reported success.
    """
    pages = [
        page(PAGE_SIZE, total=100, start=0),
        page(PAGE_SIZE, total=0, start=20),
        page(PAGE_SIZE, total=0, start=40),
        page(PAGE_SIZE, total=0, start=60),
        page(PAGE_SIZE, total=0, start=80),
    ]
    adapter = WorkdayAdapter()
    jobs = await adapter.fetch_list(CONFIG, FakeClient(pages), CrawlBudget())
    assert len(jobs) == 100


@pytest.mark.asyncio
async def test_never_requests_a_page_size_above_twenty():
    """Trap 1. A larger limit returns HTTP 400 (or, per published reports, an empty 200)."""
    client = FakeClient([page(PAGE_SIZE, total=20)])
    await WorkdayAdapter().fetch_list(CONFIG, client, CrawlBudget())
    assert client.requests, "adapter made no request"
    for body in client.requests:
        assert body["limit"] <= 20, f"page size {body['limit']} exceeds the Workday cap"


@pytest.mark.asyncio
async def test_stops_on_a_short_page():
    """A page shorter than the limit means the end, regardless of what total claims."""
    pages = [page(PAGE_SIZE, total=1000), page(5, total=0, start=20)]
    jobs = await WorkdayAdapter().fetch_list(CONFIG, FakeClient(pages), CrawlBudget())
    assert len(jobs) == 25


@pytest.mark.asyncio
async def test_stops_on_an_empty_first_page_without_hanging():
    jobs = await WorkdayAdapter().fetch_list(
        CONFIG, FakeClient([page(0, total=0)]), CrawlBudget()
    )
    assert jobs == []


def test_posted_on_display_string_is_never_parsed_as_a_date():
    """Trap 2. postedOn is localized display text; the real date is on the detail endpoint."""
    adapter = WorkdayAdapter()
    raw = page(1, total=1)["jobPostings"][0]
    raw["_config"] = CONFIG
    job = adapter.parse(__import__(
        "crawler.models.job", fromlist=["RawJob"]
    ).RawJob(data=raw))
    assert job.posted_at is None
    assert job.external_job_id == "JR0"


def test_requisition_id_comes_from_bullet_fields_and_is_stable():
    """The identity guarantee behind ADR 005: same input, same id, every run."""
    from crawler.models.job import RawJob

    adapter = WorkdayAdapter()
    raw = page(1, total=1)["jobPostings"][0]
    raw["_config"] = CONFIG
    first = adapter.parse(RawJob(data=dict(raw)))
    second = adapter.parse(RawJob(data=dict(raw)))
    assert first.external_job_id == second.external_job_id == "JR0"
