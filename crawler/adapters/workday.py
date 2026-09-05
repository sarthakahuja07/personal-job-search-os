"""Workday CXS. Tier 2: undocumented but ubiquitous, and config-driven per tenant.

Four traps, all verified against the live NVIDIA endpoint, each guarded here:

  1. limit is hard-capped at 20. limit=21 or 100 returns HTTP 400 today; published write-ups
     describe it returning HTTP 200 with an empty array instead. Either way a larger page size
     disables the company, so PAGE_SIZE is a constant and a regression test pins it.
  2. postedOn is a localized DISPLAY STRING ("Posted Today"), not a date. It is never parsed.
     The real date is startDate on the detail endpoint.
  3. The detail endpoint returns the careers HTML page unless Accept: application/json is set.
  4. `total` is populated ONLY on the first page. Every later page reports total=0 while still
     returning 20 results. Trusting it per-page ends the crawl after 40 of 2000 jobs and reports
     success -- silent truncation, found only because NVIDIA's real count was known.

Trap 4 is the reason this adapter is written defensively: three of the four are invisible when
they fire. Nothing errors, nothing logs, the run is green, and the jobs simply are not there.
"""

from __future__ import annotations

import asyncio
import re
from datetime import date, datetime
from typing import Any

from crawler.adapters.base import ConfigError, JobSourceAdapter
from crawler.http.client import CrawlBudget, HttpClient
from crawler.models.job import NormalizedJob, RawJob
from crawler.normalization.text import html_to_text

# Do not raise this. See trap 1 above.
PAGE_SIZE = 20
MAX_PAGES = 200

_URL_RE = re.compile(
    r"(?P<tenant>[a-z0-9\-]+)\.(?P<dc>wd\d+)\.myworkdayjobs\.com/"
    r"(?:[a-zA-Z]{2}-[A-Z]{2}/)?(?P<site>[A-Za-z0-9_\-]+)"
)


class WorkdayAdapter(JobSourceAdapter):
    source_type = "workday"
    tier = 2

    @staticmethod
    def detect(url: str) -> dict[str, Any] | None:
        m = _URL_RE.search(url)
        if not m:
            return None
        return {
            "tenant": m.group("tenant"),
            "dataCenter": m.group("dc"),
            "site": m.group("site"),
        }

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        errors = []
        for key, hint in (
            ("tenant", "the subdomain, e.g. nvidia"),
            ("dataCenter", "the shard, e.g. wd5 -- it is not guessable"),
            ("site", "the career site slug, e.g. NVIDIAExternalCareerSite"),
        ):
            if not config.get(key):
                errors.append(f"{key} is required ({hint})")
        return errors

    def _base(self, config: dict[str, Any]) -> str:
        tenant = config["tenant"]
        dc = config["dataCenter"]
        site = config["site"]
        return f"https://{tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}"

    async def fetch_list(
        self, config: dict[str, Any], client: HttpClient, budget: CrawlBudget
    ) -> list[RawJob]:
        errors = self.validate_config(config)
        if errors:
            raise ConfigError("; ".join(errors))
        url = f"{self._base(config)}/jobs"
        headers = {"Content-Type": "application/json", "Accept-Language": "en-US"}

        async def fetch_page(offset: int) -> list[dict[str, Any]]:
            body = {
                "appliedFacets": {},
                "limit": PAGE_SIZE,
                "offset": offset,
                "searchText": "",
            }
            data, _resp = await client.post_json(
                url, json=body, headers=headers, budget=budget
            )
            self.require(data, "total", "jobPostings")
            return data["jobPostings"]

        # Page 1 is fetched alone because it is the only page that reports a usable total.
        #
        # Trap 4: `total` is populated ONLY on the first page. Every later page reports total=0
        # while still returning results. Trusting it per-page stops the crawl after 40 of 2000
        # jobs and reports success -- silent truncation, verified against NVIDIA.
        first_body = {"appliedFacets": {}, "limit": PAGE_SIZE, "offset": 0, "searchText": ""}
        data, _resp = await client.post_json(
            url, json=first_body, headers=headers, budget=budget
        )
        self.require(data, "total", "jobPostings")
        total = int(data["total"])
        pages = [data["jobPostings"]]

        # Remaining pages are independent, so they are fetched concurrently. The client's
        # per-host semaphore and adaptive delay still govern the actual request rate, so this
        # is faster without being less polite -- a strictly sequential 100-page walk was what
        # made Target exceed its time budget and return nothing.
        remaining = [
            offset
            for offset in range(PAGE_SIZE, min(total, MAX_PAGES * PAGE_SIZE), PAGE_SIZE)
        ]
        if remaining:
            pages.extend(await asyncio.gather(*(fetch_page(o) for o in remaining)))

        out: list[RawJob] = []
        for page in pages:
            for p in page:
                p["_config"] = config
                out.append(RawJob(data=p, source_url=url))
        return out

    async def fetch_detail(
        self, raw: RawJob, config: dict[str, Any], client: HttpClient, budget: CrawlBudget
    ) -> RawJob:
        path = raw.data.get("externalPath")
        if not path:
            return raw
        url = f"{self._base(config)}{path}"
        # Without this Accept header the same URL returns the HTML careers page (trap 3).
        data, _ = await client.get_json(
            url, headers={"Accept": "application/json"}, budget=budget
        )
        detail = data.get("jobPostingInfo", data) if isinstance(data, dict) else {}
        return RawJob(data={**raw.data, "_detail": detail}, source_url=raw.source_url)

    def parse(self, raw: RawJob) -> NormalizedJob:
        d = raw.data
        self.require(d, "title", "externalPath")
        cfg = d.get("_config") or {}
        detail = d.get("_detail") or {}
        external_path = d["externalPath"]

        # The requisition id lives in bulletFields; fall back to the trailing _JR... in the path.
        req_id = None
        bullets = d.get("bulletFields") or []
        if bullets:
            req_id = str(bullets[0])
        if not req_id:
            req_id = detail.get("jobReqId")
        if not req_id:
            m = re.search(r"_([A-Za-z0-9\-]+)$", external_path)
            req_id = m.group(1) if m else external_path

        # postedOn is deliberately ignored -- it is display text (trap 2).
        posted: date | None = None
        start = detail.get("startDate")
        if start:
            try:
                posted = datetime.fromisoformat(str(start)[:10]).date()
            except ValueError:
                posted = None

        tenant = cfg.get("tenant")
        dc = cfg.get("dataCenter")
        site = cfg.get("site")
        site_base = f"https://{tenant}.{dc}.myworkdayjobs.com/{site}"

        country = detail.get("country")
        country_label = country.get("descriptor") if isinstance(country, dict) else None

        return NormalizedJob(
            external_job_id=str(req_id),
            title=d["title"],
            job_url=f"{site_base}{external_path}",
            location=d.get("locationsText") or detail.get("location"),
            description=html_to_text(detail.get("jobDescription")),
            employment_type=detail.get("timeType"),
            posted_at=posted,
            raw_metadata={"country": country_label},
        )
