"""Greenhouse job boards. Tier 1: public, unauthenticated, designed for embedding.

The list response carries the full description when content=true, so no detail fetch is needed.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from crawler.adapters.base import ConfigError, JobSourceAdapter
from crawler.http.client import CrawlBudget, HttpClient
from crawler.models.job import NormalizedJob, RawJob
from crawler.normalization.text import html_to_text

_URL_RE = re.compile(
    r"(?:boards|job-boards)\.greenhouse\.io/(?:embed/job_board\?for=)?([A-Za-z0-9_\-]+)"
)


class GreenhouseAdapter(JobSourceAdapter):
    source_type = "greenhouse"
    tier = 1

    @staticmethod
    def detect(url: str) -> dict[str, Any] | None:
        m = _URL_RE.search(url)
        return {"boardToken": m.group(1)} if m else None

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        if not config.get("boardToken"):
            return ["boardToken is required (the slug in boards.greenhouse.io/<token>)"]
        return []

    async def fetch_list(
        self, config: dict[str, Any], client: HttpClient, budget: CrawlBudget
    ) -> list[RawJob]:
        token = config.get("boardToken")
        if not token:
            raise ConfigError("boardToken is required")
        url = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
        data, _ = await client.get_json(url, budget=budget)
        self.require(data, "jobs")
        return [RawJob(data=j, source_url=url) for j in data["jobs"]]

    def parse(self, raw: RawJob) -> NormalizedJob:
        d = raw.data
        self.require(d, "id", "title", "absolute_url")
        location = (d.get("location") or {}).get("name")
        departments = d.get("departments") or []
        department = departments[0].get("name") if departments else None
        return NormalizedJob(
            external_job_id=str(d["id"]),
            title=d["title"],
            job_url=d["absolute_url"],
            location=location,
            department=department,
            description=html_to_text(d.get("content")),
            posted_at=_iso_date(d.get("first_published") or d.get("updated_at")),
            raw_metadata={"requisition_id": d.get("requisition_id")},
        )


def _iso_date(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None
