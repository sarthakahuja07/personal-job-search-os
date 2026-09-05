"""SmartRecruiters job boards. Tier 1: public, unauthenticated, paginated.

The list response has no description, so this adapter implements fetch_detail. That request is
made only for postings that survive the title pre-filter.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from crawler.adapters.base import ConfigError, JobSourceAdapter
from crawler.http.client import CrawlBudget, HttpClient
from crawler.models.job import NormalizedJob, RawJob
from crawler.normalization.text import html_to_text

_URL_RE = re.compile(r"careers\.smartrecruiters\.com/([A-Za-z0-9_\-]+)")
PAGE_SIZE = 100


class SmartRecruitersAdapter(JobSourceAdapter):
    source_type = "smartrecruiters"
    tier = 1

    @staticmethod
    def detect(url: str) -> dict[str, Any] | None:
        m = _URL_RE.search(url)
        return {"companyId": m.group(1)} if m else None

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        if not config.get("companyId"):
            return ["companyId is required (the segment in careers.smartrecruiters.com/<id>)"]
        return []

    async def fetch_list(
        self, config: dict[str, Any], client: HttpClient, budget: CrawlBudget
    ) -> list[RawJob]:
        company = config.get("companyId")
        if not company:
            raise ConfigError("companyId is required")
        base = f"https://api.smartrecruiters.com/v1/companies/{company}/postings"
        out: list[RawJob] = []
        offset = 0
        while True:
            url = f"{base}?limit={PAGE_SIZE}&offset={offset}"
            data, _ = await client.get_json(url, budget=budget)
            self.require(data, "content", "totalFound")
            page = data["content"]
            for item in page:
                item["_company"] = company
                out.append(RawJob(data=item, source_url=url))
            offset += len(page)
            # Terminate on a short page as well as on the count, so a total that shifts
            # during pagination cannot spin this loop forever.
            if not page or offset >= int(data["totalFound"]):
                break
        return out

    async def fetch_detail(
        self, raw: RawJob, config: dict[str, Any], client: HttpClient, budget: CrawlBudget
    ) -> RawJob:
        company = config.get("companyId")
        job_id = raw.data.get("id")
        url = f"https://api.smartrecruiters.com/v1/companies/{company}/postings/{job_id}"
        detail, _ = await client.get_json(url, budget=budget)
        return RawJob(data={**raw.data, "_detail": detail}, source_url=raw.source_url)

    def parse(self, raw: RawJob) -> NormalizedJob:
        d = raw.data
        self.require(d, "id", "name")

        loc = d.get("location") or {}
        country = (loc.get("country") or "").upper()
        parts = [loc.get("city"), loc.get("region"), country]
        location = ", ".join(p for p in parts if p) or None
        if loc.get("remote"):
            location = f"Remote, {location}" if location else "Remote"

        posted = None
        released = d.get("releasedDate")
        if released:
            try:
                posted = datetime.fromisoformat(released.replace("Z", "+00:00")).date()
            except ValueError:
                posted = None

        description = None
        detail = d.get("_detail") or {}
        sections = (detail.get("jobAd") or {}).get("sections") or {}
        if sections:
            chunks = [
                (sections.get(key) or {}).get("text", "")
                for key in ("companyDescription", "jobDescription", "qualifications")
            ]
            description = html_to_text("\n\n".join(c for c in chunks if c))

        company = d.get("_company")
        job_id = d["id"]
        return NormalizedJob(
            external_job_id=str(job_id),
            title=d["name"],
            job_url=f"https://jobs.smartrecruiters.com/{company}/{job_id}",
            location=location,
            department=(d.get("department") or {}).get("label"),
            description=description,
            employment_type=(d.get("typeOfEmployment") or {}).get("label"),
            posted_at=posted,
            raw_metadata={"refNumber": d.get("refNumber")},
        )
