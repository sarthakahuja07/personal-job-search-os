"""MyNextHire job boards. Tier 1: public, unauthenticated.

An Indian ATS (ShareChat is the first user). Each tenant lives at `<tenant>.mynexthire.com`, and
its embedded careers widget lists jobs with one POST to `/employer/careers/reqlist/get`. The
response is the whole board -- no pagination -- and already carries the description.

This is an adapter rather than a json_api config for one reason: the job link. MyNextHire
addresses a job page by base64-encoding a JSON object that carries the requisition id, which the
field-mapping language deliberately cannot express. The object below is the one the tenant's own
careers page builds; a smaller one (just pageType and reqId) was tried and renders "Oops!
Something went wrong!", so every key is kept.
"""

from __future__ import annotations

import base64
import json
import re
from datetime import datetime
from typing import Any

from crawler.adapters.base import ConfigError, JobSourceAdapter
from crawler.http.client import CrawlBudget, HttpClient
from crawler.models.job import NormalizedJob, RawJob
from crawler.normalization.text import html_to_text

_URL_RE = re.compile(r"([a-z0-9-]+)\.mynexthire\.com")


def job_url(tenant: str, req_id: int | str) -> str:
    payload = json.dumps(
        {
            "pageType": "jd",
            "cvSource": "careers",
            "reqId": int(req_id),
            "requester": {"id": "", "code": "", "name": ""},
            "page": "careers",
            "bufilter": -1,
            "customFields": {},
        },
        separators=(",", ":"),
    )
    encoded = base64.b64encode(payload.encode()).decode()
    return f"https://{tenant}.mynexthire.com/employer/jobs?src=careers&p={encoded}"


class MyNextHireAdapter(JobSourceAdapter):
    source_type = "mynexthire"
    tier = 1

    @staticmethod
    def detect(url: str) -> dict[str, Any] | None:
        m = _URL_RE.search(url)
        return {"tenant": m.group(1)} if m else None

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        if not config.get("tenant"):
            return ["tenant is required (the subdomain in <tenant>.mynexthire.com)"]
        return []

    async def fetch_list(
        self, config: dict[str, Any], client: HttpClient, budget: CrawlBudget
    ) -> list[RawJob]:
        tenant = config.get("tenant")
        if not tenant:
            raise ConfigError("tenant is required")
        url = f"https://{tenant}.mynexthire.com/employer/careers/reqlist/get"
        data, _ = await client.post_json(
            url,
            json={"source": "careers", "code": "", "filterByBuId": -1},
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            budget=budget,
        )
        records = data.get("reqDetailsBOList") if isinstance(data, dict) else None
        if not isinstance(records, list):
            raise ConfigError(
                f"expected reqDetailsBOList in the MyNextHire response, got {type(data).__name__}"
            )
        out = []
        for record in records:
            # parse() needs the tenant to build the job link, and RawJob carries only the record.
            record["_tenant"] = tenant
            out.append(RawJob(data=record, source_url=url))
        return out

    def parse(self, raw: RawJob) -> NormalizedJob:
        d = raw.data
        self.require(d, "reqId", "reqTitle", "_tenant")
        posted = None
        approved = d.get("approvedOn")
        if isinstance(approved, str):
            # "2026-10-01T12:31:34.209+0000": an absolute timestamp, never a display string.
            posted = datetime.strptime(approved, "%Y-%m-%dT%H:%M:%S.%f%z").date()
        return NormalizedJob(
            external_job_id=str(d["reqId"]),
            title=str(d["reqTitle"]).strip(),
            job_url=job_url(d["_tenant"], d["reqId"]),
            location=d.get("location") or None,
            department=d.get("buName") or None,
            description=html_to_text(d.get("jdDisplay")),
            employment_type=d.get("employmentType") or None,
            posted_at=posted,
            raw_metadata={"expMin": d.get("expMin"), "expMax": d.get("expMax")},
        )
