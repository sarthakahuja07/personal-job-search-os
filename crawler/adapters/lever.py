"""Lever job boards. Tier 1: public, unauthenticated.

The list response carries descriptionPlain, so no detail fetch is needed.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from crawler.adapters.base import ConfigError, JobSourceAdapter
from crawler.http.client import CrawlBudget, HttpClient
from crawler.models.job import NormalizedJob, RawJob
from crawler.normalization.text import html_to_text

_URL_RE = re.compile(r"jobs\.lever\.co/([A-Za-z0-9_\-]+)")


class LeverAdapter(JobSourceAdapter):
    source_type = "lever"
    tier = 1

    @staticmethod
    def detect(url: str) -> dict[str, Any] | None:
        m = _URL_RE.search(url)
        return {"slug": m.group(1)} if m else None

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        if not config.get("slug"):
            return ["slug is required (the segment in jobs.lever.co/<slug>)"]
        return []

    async def fetch_list(
        self, config: dict[str, Any], client: HttpClient, budget: CrawlBudget
    ) -> list[RawJob]:
        slug = config.get("slug")
        if not slug:
            raise ConfigError("slug is required")
        url = f"https://api.lever.co/v0/postings/{slug}?mode=json"
        data, _ = await client.get_json(url, budget=budget)
        if not isinstance(data, list):
            raise ConfigError(f"expected a list from Lever, got {type(data).__name__}")
        return [RawJob(data=j, source_url=url) for j in data]

    def parse(self, raw: RawJob) -> NormalizedJob:
        d = raw.data
        self.require(d, "id", "text", "hostedUrl")
        cats = d.get("categories") or {}
        posted = None
        created = d.get("createdAt")
        if isinstance(created, (int, float)):
            posted = datetime.fromtimestamp(created / 1000, tz=timezone.utc).date()
        return NormalizedJob(
            external_job_id=str(d["id"]),
            title=d["text"],
            job_url=d["hostedUrl"],
            location=cats.get("location"),
            department=cats.get("department") or cats.get("team"),
            description=html_to_text(d.get("descriptionPlain") or d.get("description")),
            employment_type=cats.get("commitment"),
            posted_at=posted,
            raw_metadata={"workplaceType": d.get("workplaceType")},
        )
