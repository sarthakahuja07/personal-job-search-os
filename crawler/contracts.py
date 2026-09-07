"""Live contract canary.

The conformance suite replays recorded cassettes, so it proves the adapters still handle
*yesterday's* responses. It cannot notice that an upstream API changed shape overnight -- and
several of these endpoints are undocumented, so they can change without warning.

This does the other half: it hits the real endpoints and checks that the fields the adapters
depend on are still present, still populated, and still the right type. It runs on its own
schedule and fails loudly, entirely separately from the crawl, so a contract break is a red
build rather than a quiet drop in results.

    python -m crawler.contracts
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

import structlog

from crawler.adapters.registry import ADAPTERS
from crawler.http.client import CrawlBudget, HttpClient

log = structlog.get_logger(__name__)

CASSETTE_DIR = Path(__file__).resolve().parent / "tests" / "cassettes"

# Fields each adapter reads. If one disappears upstream, the adapter starts producing empty or
# wrong values -- usually without raising, which is precisely why this check exists.
REQUIRED_FIELDS: dict[str, list[str]] = {
    "greenhouse": ["id", "title", "absolute_url"],
    "lever": ["id", "text", "hostedUrl"],
    "ashby": ["id", "title", "jobUrl"],
    "smartrecruiters": ["id", "name"],
    "workday": ["title", "externalPath", "bulletFields"],
}

# How many jobs a healthy board should return. Not a precise figure -- just enough to catch a
# feed that has quietly become empty.
MIN_JOBS = 1


async def check_adapter(source_type: str, adapter, client: HttpClient) -> dict[str, Any]:
    cassette_path = CASSETTE_DIR / f"{source_type}.json"
    if not cassette_path.exists():
        return {"source": source_type, "ok": False, "error": "no cassette to compare against"}

    cassette = json.loads(cassette_path.read_text(encoding="utf-8"))
    config = cassette["config"]
    result: dict[str, Any] = {"source": source_type, "ok": True, "issues": []}

    try:
        raw = await adapter.fetch_list(config, client, CrawlBudget(max_requests=150))
    except Exception as exc:  # noqa: BLE001
        return {
            "source": source_type,
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}"[:300],
        }

    if len(raw) < MIN_JOBS:
        result["ok"] = False
        result["issues"].append(f"returned {len(raw)} jobs, expected at least {MIN_JOBS}")
        return result

    # Field presence, checked on the live payload rather than the recording.
    missing: set[str] = set()
    for item in raw[:25]:
        for field in REQUIRED_FIELDS.get(source_type, []):
            if field not in item.data:
                missing.add(field)
    if missing:
        result["ok"] = False
        result["issues"].append(f"missing field(s) upstream: {', '.join(sorted(missing))}")

    # The adapter must still be able to parse what it fetched.
    parse_failures = 0
    for item in raw[:25]:
        try:
            job = adapter.parse(item)
        except Exception as exc:  # noqa: BLE001
            parse_failures += 1
            if parse_failures == 1:
                result["issues"].append(f"parse failed: {type(exc).__name__}: {exc}"[:200])
            continue
        if not job.external_job_id or not job.title:
            result["ok"] = False
            result["issues"].append("parsed a job with an empty id or title")
            break

    if parse_failures:
        result["ok"] = False
        result["issues"].append(f"{parse_failures} of 25 sampled jobs failed to parse")

    result["jobs"] = len(raw)
    return result


async def main() -> int:
    results: list[dict[str, Any]] = []

    async with HttpClient() as client:
        for source_type, adapter in sorted(ADAPTERS.items()):
            log.info("contract.check", source=source_type)
            results.append(await check_adapter(source_type, adapter, client))

    print()
    print("=" * 68)
    failed = [r for r in results if not r.get("ok")]
    for r in results:
        status = "OK  " if r.get("ok") else "FAIL"
        detail = r.get("error") or "; ".join(r.get("issues", [])) or f"{r.get('jobs')} jobs"
        print(f"  {status}  {r['source']:<17} {detail}")
    print("=" * 68)

    if failed:
        print(f"\n{len(failed)} adapter contract(s) broken upstream.")
        print("Re-record cassettes and fix the adapter: python scripts/record_cassettes.py")
        return 1

    print(f"\nAll {len(results)} adapter contracts intact.")
    return 0


if __name__ == "__main__":
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer(colors=False),
        ]
    )
    sys.exit(asyncio.run(main()))
