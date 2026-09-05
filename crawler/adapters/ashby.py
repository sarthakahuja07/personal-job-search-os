"""Ashby job boards. Tier 1: public, unauthenticated.

The list response carries descriptionPlain, so no detail fetch is needed.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from crawler.adapters.base import ConfigError, JobSourceAdapter
from crawler.http.client import CrawlBudget, HttpClient
from crawler.models.job import NormalizedJob, RawJob
from crawler.normalization.text import html_to_text

_URL_RE = re.compile(r"jobs\.ashbyhq\.com/([A-Za-z0-9_\-]+)")


class AshbyAdapter(JobSourceAdapter):
    source_type = "ashby"
    tier = 1

    @staticmethod
    def detect(url: str) -> dict[str, Any] | None:
        m = _URL_RE.search(url)
        return {"slug": m.group(1)} if m else None

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        if not config.get("slug"):
            return ["slug is required (the segment in jobs.ashbyhq.com/<slug>)"]
        return []

    async def fetch_list(
        self, config: dict[str, Any], client: HttpClient, budget: CrawlBudget
    ) -> list[RawJob]:
        slug = config.get("slug")
        if not slug:
            raise ConfigError("slug is required")
        url = f"https://api.ashbyhq.com/posting-api/job-board/{slug}"
        data, _ = await client.get_json(url, budget=budget)
        self.require(data, "jobs")
        # Unlisted postings are drafts or internal; treat them as not existing.
        return [RawJob(data=j, source_url=url) for j in data["jobs"] if j.get("isListed", True)]

    def parse(self, raw: RawJob) -> NormalizedJob:
        d = raw.data
        self.require(d, "id", "title", "jobUrl")
        posted = None
        published = d.get("publishedAt")
        if published:
            try:
                posted = datetime.fromisoformat(published.replace("Z", "+00:00")).date()
            except ValueError:
                posted = None
        return NormalizedJob(
            external_job_id=str(d["id"]),
            title=d["title"],
            job_url=d["jobUrl"],
            location=d.get("location"),
            department=d.get("department") or d.get("team"),
            description=html_to_text(d.get("descriptionPlain") or d.get("descriptionHtml")),
            employment_type=d.get("employmentType"),
            posted_at=posted,
            raw_metadata={"isRemote": d.get("isRemote")},
        )
