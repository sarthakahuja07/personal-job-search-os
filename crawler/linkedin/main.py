# -*- coding: utf-8 -*-
"""
The LinkedIn source, end to end: mailbox -> parser -> app.

Runs alongside the company crawl in the same workflow. It is deliberately a separate entry
point rather than a company adapter, because it is not a company: one mailbox yields postings
across dozens of employers, some on the board and most not.

Failure here must never fail the crawl. LinkedIn mail is a supplement to the company sources,
so a mailbox that cannot be read is worth a loud log line and a non-zero exit from *this* step
only -- never a reason for the 45 companies that did crawl to be reported as broken.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import uuid
from dataclasses import asdict
from typing import Any

import structlog

from crawler.client.api import ApiClient
from crawler.linkedin.inbox import InboxError, fetch_recent
from crawler.linkedin.parser import LinkedInPosting, parse_messages

log = structlog.get_logger(__name__)

#: Postings per request. The route refuses more, because merges are single-row UPDATEs and a
#: large batch would exceed D1's per-invocation query budget.
POSTING_CHUNK = 60


def to_payload(posting: LinkedInPosting) -> dict[str, Any]:
    d = asdict(posting)
    return {
        "linkedin_job_id": d["linkedin_job_id"],
        "company_name": d["company_name"],
        "title": d["title"],
        "location": d["location"],
        "work_mode": d["work_mode"],
        "job_url": d["job_url"],
        "feed": d["feed"],
        "search_term": d["search_term"],
    }


async def run(days: int, limit: int, dry_run: bool) -> int:
    run_id = str(uuid.uuid4())

    messages = fetch_recent(days=days, limit=limit)
    postings = parse_messages(messages)
    log.info(
        "linkedin.parsed",
        messages=len(messages),
        postings=len(postings),
        feeds={f: sum(1 for p in postings if p.feed == f) for f in ("search", "recommended")},
    )

    if not postings:
        # Genuinely possible -- a quiet week, or alerts paused. Not an error, but say so
        # plainly rather than reporting a successful run that did nothing.
        log.warning("linkedin.no_postings", days=days, messages=len(messages))
        return 0

    if dry_run:
        for p in postings[:20]:
            log.info("linkedin.dry", company=p.company_name, title=p.title, feed=p.feed)
        log.info("linkedin.dry_run_complete", postings=len(postings))
        return 0

    totals = {"received": 0, "merged": 0, "leads": 0, "created": 0, "notified": 0}
    inactive: set[str] = set()

    async with ApiClient() as client:
        chunks = [
            postings[i : i + POSTING_CHUNK] for i in range(0, len(postings), POSTING_CHUNK)
        ]
        for chunk in chunks:
            result = await client.linkedin_ingest(
                {"run_id": run_id, "postings": [to_payload(p) for p in chunk]}
            )
            totals["received"] += result.get("received", 0)
            totals["merged"] += result.get("merged", 0)
            totals["leads"] += result.get("leads", 0)
            inactive.update(result.get("skippedInactive") or [])

            # Inserts go through the ordinary ingest path so they are matched, deduplicated and
            # notified about by the same code as every other job. is_final is False throughout:
            # a mailbox is never a measurement of what a company has open, and presence tracking
            # on it would close every job the alert did not happen to mention.
            for group in result.get("inserts") or []:
                ingested = await client.ingest(
                    {
                        "run_id": run_id,
                        "company_id": group["company_id"],
                        "status": "success",
                        "tier": 6,
                        "seen_external_ids": [],
                        "jobs": group["jobs"],
                        "is_final": False,
                    }
                )
                totals["created"] += ingested.get("created", 0)
                totals["notified"] += ingested.get("notificationsQueued", 0)
                log.info(
                    "linkedin.company_ingested",
                    company=group["company_name"],
                    offered=len(group["jobs"]),
                    created=ingested.get("created", 0),
                )

    if inactive:
        log.info("linkedin.skipped_inactive", companies=sorted(inactive))
    log.info("linkedin.done", **totals)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Read LinkedIn job mail into the board")
    ap.add_argument("--days", type=int, default=int(os.environ.get("LINKEDIN_DAYS", "7")))
    ap.add_argument("--limit", type=int, default=60)
    ap.add_argument("--dry-run", action="store_true", help="parse and report, write nothing")
    args = ap.parse_args()

    try:
        return asyncio.run(run(args.days, args.limit, args.dry_run))
    except InboxError as exc:
        log.error("linkedin.inbox_unavailable", error=str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
