"""Client for the app's crawler-facing API.

The crawler holds no database credentials. It reads its work list from /api/crawler/bootstrap
and hands normalized jobs to /api/ingest/jobs, where all deduplication, matching and
notification decisions happen server-side (ADR 007).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx
import structlog

log = structlog.get_logger(__name__)

# D1 allows 100 bound parameters and 50 queries per Worker invocation. Ingest spends roughly
# ceil(jobs / 5) upsert queries plus fixed overhead, so a chunk of 100 jobs leaves headroom.
# The title pre-filter means this is rarely reached in practice.
JOB_CHUNK = 100


@dataclass
class Company:
    id: str
    name: str
    source_type: str
    source_tier: int
    source_config: dict[str, Any]
    careers_url: str | None
    allow_zero_results: bool
    etag: str | None
    last_modified: str | None
    last_content_hash: str | None


class ApiClient:
    def __init__(self, base_url: str | None = None, token: str | None = None) -> None:
        self.base_url = (base_url or os.environ.get("APP_BASE_URL", "http://localhost:3000")).rstrip("/")
        self.token = token or os.environ.get("INGEST_TOKEN", "")
        headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
        # Cloudflare Access service token, when the app is deployed behind Access.
        cf_id = os.environ.get("CF_ACCESS_CLIENT_ID")
        cf_secret = os.environ.get("CF_ACCESS_CLIENT_SECRET")
        if cf_id and cf_secret:
            headers["CF-Access-Client-Id"] = cf_id
            headers["CF-Access-Client-Secret"] = cf_secret
        self._client = httpx.AsyncClient(headers=headers, timeout=60.0)

    async def __aenter__(self) -> ApiClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._client.aclose()

    async def bootstrap(self) -> tuple[list[Company], dict[str, Any]]:
        r = await self._client.get(f"{self.base_url}/api/crawler/bootstrap")
        r.raise_for_status()
        data = r.json()
        companies = [
            Company(
                id=c["id"],
                name=c["name"],
                source_type=c["source_type"],
                source_tier=c["source_tier"],
                source_config=c.get("source_config") or {},
                careers_url=c.get("careers_url"),
                allow_zero_results=bool(c.get("allow_zero_results")),
                etag=c.get("etag"),
                last_modified=c.get("last_modified"),
                last_content_hash=c.get("last_content_hash"),
            )
            for c in data["companies"]
        ]
        return companies, data["match_rules"]

    async def ingest(self, payload: dict[str, Any]) -> dict[str, Any]:
        """POST one payload, chunking jobs so a single request stays inside D1's limits.

        is_final is set only on the last chunk: presence tracking must run exactly once per
        crawl, against the complete observed id set.
        """
        jobs = payload.get("jobs") or []
        if len(jobs) <= JOB_CHUNK:
            return await self._post(payload)

        chunks = [jobs[i : i + JOB_CHUNK] for i in range(0, len(jobs), JOB_CHUNK)]
        totals: dict[str, Any] = {}

        for index, chunk in enumerate(chunks):
            is_last = index == len(chunks) - 1
            result = await self._post(
                {
                    **payload,
                    "jobs": chunk,
                    # Only the final chunk carries the full observed set.
                    "seen_external_ids": payload["seen_external_ids"] if is_last else [],
                    "is_final": is_last,
                }
            )
            totals = _merge(totals, result, is_last)

        return totals

    async def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._client.post(f"{self.base_url}/api/ingest/jobs", json=payload)
        if r.status_code >= 400:
            log.error("ingest.failed", status=r.status_code, body=r.text[:500])
            r.raise_for_status()
        return r.json()


# Counters that describe work done and must be summed across chunks; everything else describes
# the run as a whole and is taken from the final chunk.
_SUMMED = (
    "received",
    "created",
    "updated",
    "relevantNew",
    "notificationsQueued",
    "jobsClosed",
    "jobsMarkedMissing",
)


def _merge(totals: dict[str, Any], result: dict[str, Any], is_last: bool) -> dict[str, Any]:
    """Aggregate a chunked ingest into one honest summary.

    Returning only the last chunk's numbers under-reports the run: Amazon's 181 candidates
    arrived as chunks of 100 and 81, and the log said "created=81" while 181 rows had actually
    been written. A crawl that misrepresents what it did is precisely the failure this project
    is built to avoid, even when the misreport is flattering rather than alarming.
    """
    merged = dict(totals)
    for key, value in result.items():
        if key in _SUMMED and isinstance(value, (int, float)):
            merged[key] = merged.get(key, 0) + value
        elif is_last or key not in merged:
            # Status, reason and identifiers describe the run; the final chunk is authoritative
            # because it is the one that carried the complete observed id set.
            merged[key] = value
    return merged
