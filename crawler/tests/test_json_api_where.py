"""json_api `where`: drop records the board itself treats as closed.

Juspay's endpoint returns every opening it has ever listed, open or not, and flags the closed
ones `opening_status: false`; its own apply form refuses those. Ingesting them would put dead
roles on the board and, worse, keep them from ever closing.
"""

from __future__ import annotations

from typing import Any

import pytest

from crawler.adapters.json_api import JsonApiAdapter
from crawler.http.client import CrawlBudget

CONFIG: dict[str, Any] = {
    "adapter": "json_api",
    "listUrl": "https://example.com/api/careerJobOpening?limit=1000",
    "jobsPath": "allJobs",
    "where": {"opening_status": True},
    "fields": {
        "external_job_id": "job_id",
        "title": "job_title",
        "job_url": {"template": "https://example.com/?jobId={job_id}"},
    },
}


class FakeClient:
    async def get_json(self, url: str, **kwargs: Any):
        return {
            "allJobs": [
                {"job_id": "SDE-L01", "job_title": "SDE - Lateral", "opening_status": True},
                {"job_id": "OLD01", "job_title": "Closed role", "opening_status": False},
                {"job_id": "NOFLAG", "job_title": "No flag at all"},
            ]
        }, None


@pytest.mark.asyncio
async def test_keeps_only_records_matching_where():
    adapter = JsonApiAdapter()
    raw = await adapter.fetch_list(CONFIG, FakeClient(), CrawlBudget())  # type: ignore[arg-type]
    assert [adapter.parse(r).external_job_id for r in raw] == ["SDE-L01"]


@pytest.mark.asyncio
async def test_no_where_keeps_everything():
    config = {k: v for k, v in CONFIG.items() if k != "where"}
    raw = await JsonApiAdapter().fetch_list(config, FakeClient(), CrawlBudget())  # type: ignore[arg-type]
    assert len(raw) == 3
