"""Crawler orchestrator.

Per company: resolve the adapter, fetch the list, pre-filter by title, fetch details only for
survivors, and hand the result to the ingest endpoint. One company failing never aborts the run
(PRD §22) -- every outcome is reported, including the failures.

Run:
    python -m crawler.main            # crawl every active company
    python -m crawler.main --dry-run  # crawl but do not POST
    python -m crawler.main --company Databricks
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
import uuid
from datetime import date
from typing import Any

import structlog

from crawler.adapters.base import ConfigError, SchemaDriftError
from crawler.adapters.registry import get_adapter
from crawler.client.api import ApiClient, Company
from crawler.http.client import BudgetExceeded, CrawlBudget, HttpClient, RateLimited
from crawler.matching import match_title
from crawler.models.job import NormalizedJob

log = structlog.get_logger(__name__)

# How many companies are crawled concurrently. Each has its own per-host limits underneath.
COMPANY_CONCURRENCY = 4


class CrawlOutcome:
    def __init__(self, company: Company) -> None:
        self.company = company
        self.status: str = "failed"
        self.error: str | None = None
        self.seen_ids: list[str] = []
        self.jobs: list[NormalizedJob] = []
        self.duration_ms: int = 0
        self.parse_errors: int = 0
        self.detail_fetches: int = 0

    def payload(self, run_id: str) -> dict[str, Any]:
        return {
            "run_id": run_id,
            "company_id": self.company.id,
            "status": self.status,
            "tier": self.company.source_tier,
            "duration_ms": self.duration_ms,
            "error": self.error,
            "seen_external_ids": self.seen_ids,
            "jobs": [j.to_ingest_payload() for j in self.jobs],
            "is_final": True,
        }


async def crawl_company(
    company: Company,
    rules: dict[str, Any],
    http: HttpClient,
) -> CrawlOutcome:
    outcome = CrawlOutcome(company)
    started = time.perf_counter()
    adapter = get_adapter(company.source_type)

    if adapter is None:
        outcome.status = "skipped"
        outcome.error = f"no adapter registered for source_type={company.source_type}"
        return outcome

    budget = CrawlBudget()
    budget.start()
    log.info("company.start", company=company.name, source=company.source_type)

    try:
        raw_jobs = await adapter.fetch_list(company.source_config, http, budget)

        # Parse everything cheaply first. A single malformed posting must not lose the rest,
        # but it is counted so a systematic parsing failure is visible rather than silent.
        parsed: list[tuple[Any, NormalizedJob]] = []
        for raw in raw_jobs:
            try:
                parsed.append((raw, adapter.parse(raw)))
            except Exception as exc:  # noqa: BLE001 - one bad row must not fail the company
                outcome.parse_errors += 1
                log.warning("job.parse_failed", company=company.name, error=str(exc)[:200])

        outcome.seen_ids = [job.external_job_id for _, job in parsed]

        # The cheap gate. This is what keeps NVIDIA's 2000 postings from becoming 2000
        # detail requests to find perhaps three matches.
        candidates = [(raw, job) for raw, job in parsed if match_title(job.title, rules, company.match_overrides).passed]

        if adapter.needs_detail_fetch and candidates:
            enriched: list[NormalizedJob] = []
            for raw, job in candidates:
                try:
                    detailed_raw = await adapter.fetch_detail(
                        raw, company.source_config, http, budget
                    )
                    outcome.detail_fetches += 1
                    enriched.append(adapter.parse(detailed_raw))
                except Exception as exc:  # noqa: BLE001
                    # Keep the list-level record rather than dropping a real match because
                    # its detail request failed.
                    log.warning("job.detail_failed", company=company.name, error=str(exc)[:200])
                    enriched.append(job)
            outcome.jobs = enriched
        else:
            outcome.jobs = [job for _, job in candidates]

        outcome.status = "success"

    except SchemaDriftError as exc:
        outcome.status = "failed"
        outcome.error = f"schema drift: {exc}"
        log.error("company.schema_drift", company=company.name, error=str(exc))
    except ConfigError as exc:
        outcome.status = "failed"
        outcome.error = f"config error: {exc}"
        log.error("company.config_error", company=company.name, error=str(exc))
    except RateLimited as exc:
        outcome.status = "degraded"
        outcome.error = f"rate limited: {exc}"
        log.warning("company.rate_limited", company=company.name)
    except BudgetExceeded as exc:
        outcome.status = "degraded"
        outcome.error = f"budget exceeded: {exc}"
        log.warning("company.budget_exceeded", company=company.name)
    except Exception as exc:  # noqa: BLE001 - isolation is the point (PRD §22)
        outcome.status = "failed"
        outcome.error = f"{type(exc).__name__}: {exc}"[:400]
        log.error("company.failed", company=company.name, error=str(exc)[:300])

    outcome.duration_ms = int((time.perf_counter() - started) * 1000)
    log.info(
        "company.done",
        company=company.name,
        status=outcome.status,
        seen=len(outcome.seen_ids),
        candidates=len(outcome.jobs),
        detail_fetches=outcome.detail_fetches,
        ms=outcome.duration_ms,
    )
    return outcome


async def run(dry_run: bool = False, only: str | None = None) -> int:
    run_id = f"{date.today().isoformat()}-{uuid.uuid4().hex[:8]}"
    log.info("crawl.start", run_id=run_id, dry_run=dry_run)

    async with ApiClient() as api:
        companies, rules = await api.bootstrap()
        if only:
            companies = [c for c in companies if c.name.lower() == only.lower()]
            if not companies:
                log.error("crawl.no_match", company=only)
                return 1

        sem = asyncio.Semaphore(COMPANY_CONCURRENCY)

        async with HttpClient() as http:

            async def guarded(c: Company) -> CrawlOutcome:
                async with sem:
                    return await crawl_company(c, rules, http)

            outcomes = await asyncio.gather(*(guarded(c) for c in companies))

        total_new = 0
        failures = 0
        for outcome in outcomes:
            if outcome.status in ("failed",):
                failures += 1
            if dry_run:
                continue
            try:
                result = await api.ingest(outcome.payload(run_id))
                total_new += result.get("created", 0)
                log.info(
                    "company.ingested",
                    company=outcome.company.name,
                    created=result.get("created"),
                    relevant_new=result.get("relevantNew"),
                    status=result.get("statusRecorded"),
                    reason=result.get("statusReason"),
                )
            except Exception as exc:  # noqa: BLE001
                failures += 1
                log.error("company.ingest_failed", company=outcome.company.name, error=str(exc)[:300])

    log.info(
        "crawl.done",
        run_id=run_id,
        companies=len(outcomes),
        new_jobs=total_new,
        failures=failures,
    )
    # A crawl where every company failed is a failed run, and CI should see that. Partial
    # failure is normal and must not fail the workflow, or one flaky board would mask the rest.
    return 1 if outcomes and failures == len(outcomes) else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Crawl target companies for new jobs.")
    parser.add_argument("--dry-run", action="store_true", help="crawl but do not POST to ingest")
    parser.add_argument("--company", help="crawl a single company by name")
    args = parser.parse_args()

    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer(colors=False),
        ]
    )
    sys.exit(asyncio.run(run(dry_run=args.dry_run, only=args.company)))


if __name__ == "__main__":
    main()
