"""Telling "no open roles" apart from "the page changed".

An item selector that matches nothing is normally the loudest signal this project has that a
Tier 5 source has drifted, and it must stay that way: silently reporting an empty board is the
exact failure ADR 008 exists to prevent.

But a board can genuinely empty. Moveworks did -- its careers page kept rendering the listing
component with nothing in it, and the crawl reported schema drift every twelve hours for a page
that was working perfectly.

`listContainerSelector` names the element that proves the listing component still rendered.
Zero items inside a container that is still present means the board is empty; a container that
has vanished means the page was rebuilt, and that is still loud.

It has to be the container rather than the site's own "no results" element. Moveworks ships that
one on every response carrying `hidden`, revealing it from script, so keying off it would have
exempted the source from drift detection permanently -- the blanket allow-zero flag this exists
to avoid.
"""

from __future__ import annotations

from typing import Any

import pytest

from crawler.adapters.base import SchemaDriftError
from crawler.adapters.html_list import HtmlListAdapter
from crawler.http.client import CrawlBudget

CONFIG: dict[str, Any] = {
    "adapter": "html_list",
    "listUrl": "https://example.com/careers",
    "itemSelector": "div.jobs__job:not(.jobs__no-results)",
    "listContainerSelector": ".jobs",
    "maxPages": 1,
    "fields": {
        "external_job_id": {"selector": "a", "attr": "href", "pattern": r"id=(\d+)"},
        "title": {"selector": "h3", "text": True},
        "job_url": {"selector": "a", "attr": "href", "base": "https://example.com"},
    },
}

WITH_JOBS = (
    "<html><body><div class='jobs'>"
    "<div class='jobs__job'><h3>Software Engineer</h3>"
    "<a href='/careers/position?id=904253'>x</a></div>"
    "<div class='jobs__job jobs__no-results' hidden><p>no results</p></div>"
    "</div></body></html>"
)

EMPTY_BOARD = (
    "<html><body><div class='jobs'>"
    "<div class='jobs__job jobs__no-results' hidden><p>no results</p></div>"
    "</div></body></html>"
)

REDESIGNED = "<html><body><main><p>Careers have moved.</p></main></body></html>"


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
async def test_an_empty_board_is_not_drift():
    raws = await HtmlListAdapter().fetch_list(CONFIG, FakeClient(EMPTY_BOARD), CrawlBudget())
    assert raws == []


@pytest.mark.asyncio
async def test_a_redesign_is_still_loud_even_with_a_container_configured():
    """The whole safety of this rests here: no container, no exemption."""
    with pytest.raises(SchemaDriftError, match="matched no elements"):
        await HtmlListAdapter().fetch_list(CONFIG, FakeClient(REDESIGNED), CrawlBudget())


@pytest.mark.asyncio
async def test_without_a_container_configured_nothing_changes():
    config = {k: v for k, v in CONFIG.items() if k != "listContainerSelector"}
    with pytest.raises(SchemaDriftError, match="matched no elements"):
        await HtmlListAdapter().fetch_list(config, FakeClient(EMPTY_BOARD), CrawlBudget())


@pytest.mark.asyncio
async def test_the_no_results_element_alone_would_not_have_worked():
    """Why the container is the signal and the empty-state element is not.

    Moveworks ships its no-results node on every response, hidden, whether or not there are
    jobs. Pointed at that node this check would return empty for a page full of openings the
    selector had simply stopped matching -- a silent miss, the worst outcome available.
    """
    config = {**CONFIG, "listContainerSelector": ".jobs__no-results"}
    stale_selector = {**config, "itemSelector": "div.gone"}
    raws = await HtmlListAdapter().fetch_list(
        stale_selector, FakeClient(WITH_JOBS), CrawlBudget()
    )
    assert raws == [], "documents the trap; the shipped config points at the container instead"


@pytest.mark.asyncio
async def test_jobs_are_still_returned_when_the_board_is_full():
    adapter = HtmlListAdapter()
    raws = await adapter.fetch_list(CONFIG, FakeClient(WITH_JOBS), CrawlBudget())
    assert len(raws) == 1
    job = adapter.parse(raws[0])
    assert job.title == "Software Engineer"
    assert job.external_job_id == "904253"
