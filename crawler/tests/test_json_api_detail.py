"""json_api detail fetch: a description from a per-posting endpoint, for list APIs that have none.

Microsoft is the case: its search API returns titles only, so every Microsoft job was scored
for fit on the title alone. The record below is the shape of a real `position_details` response.
"""

from __future__ import annotations

from typing import Any

import pytest

from crawler.adapters.base import SchemaDriftError
from crawler.adapters.json_api import JsonApiAdapter
from crawler.http.client import CrawlBudget
from crawler.models.job import RawJob

ADAPTER = JsonApiAdapter()

CONFIG: dict[str, Any] = {
    "listUrl": "https://apply.careers.microsoft.com/api/pcsx/search?start={offset}&num={limit}",
    "jobsPath": "data.positions",
    "fields": {
        "external_job_id": "displayJobId",
        "title": "name",
        "job_url": {"template": "https://jobs.careers.microsoft.com/global/en/job/{displayJobId}"},
        "description": "_detail.jobDescription",
    },
    "detail": {
        "url": "https://apply.careers.microsoft.com/api/pcsx/position_details?position_id={id}",
        "path": "data",
    },
}

LIST_RECORD = {"id": 1970393557044879, "displayJobId": "200063221", "name": "Software Engineer II"}
DETAIL_URL = (
    "https://apply.careers.microsoft.com/api/pcsx/position_details?position_id=1970393557044879"
)


class _Response:
    def __init__(self, payload: Any) -> None:
        self.payload = payload
        self.text = ""

    def raise_for_status(self) -> None:
        return None


class _Client:
    def __init__(self, pages: dict[str, Any]) -> None:
        self.pages = pages
        self.urls: list[str] = []

    async def get_json(self, url: str, **kwargs: Any) -> tuple[Any, _Response]:
        self.urls.append(url)
        return self.pages[url], _Response(self.pages[url])


def _raw() -> RawJob:
    return RawJob(data={**LIST_RECORD, "_config": CONFIG}, source_url="list")


def test_only_configs_with_a_detail_url_want_detail():
    assert ADAPTER.wants_detail(CONFIG) is True
    assert ADAPTER.wants_detail({**CONFIG, "detail": None}) is False


def test_list_record_alone_has_no_description():
    assert ADAPTER.parse(_raw()).description is None


@pytest.mark.asyncio
async def test_detail_supplies_the_description():
    client = _Client(
        {DETAIL_URL: {"status": 200, "data": {"jobDescription": "<p>Build <b>distributed</b> systems in C#.</p>"}}}
    )
    detailed = await ADAPTER.fetch_detail(_raw(), CONFIG, client, CrawlBudget())
    job = ADAPTER.parse(detailed)
    assert client.urls == [DETAIL_URL]
    assert job.description == "Build distributed systems in C#."
    assert job.external_job_id == "200063221"


@pytest.mark.asyncio
async def test_a_detail_path_that_resolves_to_nothing_is_drift():
    client = _Client({DETAIL_URL: {"status": 200, "error": {"message": "gone"}}})
    with pytest.raises(SchemaDriftError):
        await ADAPTER.fetch_detail(_raw(), CONFIG, client, CrawlBudget())
