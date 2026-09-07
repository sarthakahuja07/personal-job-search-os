"""The attribute form of embedded hydration state.

Zoho Recruit portals look client-rendered from the outside -- the visible listing is built by
JavaScript -- but the jobs are already in the first response, sitting in an HTML attribute as
entity-encoded JSON. CHEQ was documented as needing a runtime browser on the strength of the
rendered DOM alone; it does not.
"""

from __future__ import annotations

from typing import Any

import pytest

from crawler.adapters.base import SchemaDriftError
from crawler.adapters.hydration import HydrationAdapter
from crawler.http.client import CrawlBudget

PAGE = (
    "<html><body>"
    '<input type="hidden" id="moduleMeta" value="[{&#34;api_name&#34;:&#34;Candidates&#34;}]">'
    '<input type="hidden" value="[{&#34;id&#34;:&#34;83182000009074010&#34;,'
    "&#34;Posting_Title&#34;:&#34;Product Manager&#34;,&#34;City&#34;:&#34;Bangalore South&#34;,"
    "&#34;Country&#34;:&#34;India&#34;},{&#34;id&#34;:&#34;83182000009014001&#34;,"
    "&#34;Posting_Title&#34;:&#34;Android - SE&#34;,&#34;City&#34;:&#34;Bangalore South&#34;,"
    '&#34;Country&#34;:&#34;India&#34;}]" id="jobs">'
    "</body></html>"
)

CONFIG: dict[str, Any] = {
    "adapter": "hydration",
    "pageUrl": "https://example.zohorecruit.in/jobs/Careers",
    "attributeSelector": "input#jobs",
    "attribute": "value",
    "jobsPath": ".",
    "fields": {
        "external_job_id": "id",
        "title": "Posting_Title",
        "job_url": {"template": "https://example.zohorecruit.in/jobs/Careers/{id}"},
        "location": {"template": "{City}, {Country}"},
    },
}


class FakeResponse:
    def __init__(self, text: str) -> None:
        self.text = text

    def raise_for_status(self) -> None:
        return None


class FakeClient:
    def __init__(self, text: str) -> None:
        self.text = text

    async def request(self, *args: Any, **kwargs: Any) -> FakeResponse:
        return FakeResponse(self.text)


@pytest.mark.asyncio
async def test_reads_jobs_from_an_entity_encoded_attribute():
    adapter = HydrationAdapter()
    raws = await adapter.fetch_list(CONFIG, FakeClient(PAGE), CrawlBudget())
    jobs = [adapter.parse(r) for r in raws]
    assert [j.external_job_id for j in jobs] == ["83182000009074010", "83182000009014001"]
    assert jobs[0].title == "Product Manager"
    assert jobs[0].location == "Bangalore South, India"
    assert jobs[0].job_url.endswith("/83182000009074010")


@pytest.mark.asyncio
async def test_picks_the_named_element_not_merely_the_first_input():
    """The page carries several hidden inputs of encoded JSON; selecting the wrong one would
    parse cleanly and yield zero jobs, which is the failure that must never be silent."""
    adapter = HydrationAdapter()
    raws = await adapter.fetch_list(CONFIG, FakeClient(PAGE), CrawlBudget())
    assert len(raws) == 2


@pytest.mark.asyncio
async def test_a_missing_element_is_loud():
    config = {**CONFIG, "attributeSelector": "input#gone"}
    with pytest.raises(SchemaDriftError, match="matched no element"):
        await HydrationAdapter().fetch_list(config, FakeClient(PAGE), CrawlBudget())


@pytest.mark.asyncio
async def test_a_non_json_attribute_is_loud():
    page = '<input id="jobs" value="not json at all">'
    with pytest.raises(SchemaDriftError, match="not valid JSON"):
        await HydrationAdapter().fetch_list(CONFIG, FakeClient(page), CrawlBudget())
