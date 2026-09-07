"""Record real adapter responses as cassettes for the conformance suite.

Run occasionally, by hand, to refresh fixtures. The test suite never touches the network -- it
replays what this captured. Recorded responses are what makes the suite honest: hand-written
fixtures test the adapter against the shape you *imagined*, which is exactly the shape that
never breaks.

Descriptions are truncated because they are the bulk of the bytes and none of the assertions.
Pagination structure is preserved exactly, because that is where the silent-truncation bugs live.

Usage:
    python scripts/record_cassettes.py
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx

UA = "job-search-os/0.1 (personal job-search tool; recording test fixtures)"
OUT = Path(__file__).resolve().parent.parent / "crawler" / "tests" / "cassettes"

DESCRIPTION_KEYS = {
    "content",
    "description",
    "descriptionPlain",
    "descriptionBody",
    "descriptionBodyPlain",
    "descriptionHtml",
    "additional",
    "additionalPlain",
    "jobDescription",
    "opening",
    "openingPlain",
    "text",
}
MAX_TEXT = 400


def trim(value: Any, key: str | None = None) -> Any:
    """Shrink long description bodies, leave structure untouched."""
    if isinstance(value, dict):
        return {k: trim(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [trim(v) for v in value]
    if isinstance(value, str) and key in DESCRIPTION_KEYS and len(value) > MAX_TEXT:
        return value[:MAX_TEXT] + "…[trimmed for fixture]"
    return value


async def record_greenhouse(client: httpx.AsyncClient) -> dict[str, Any]:
    url = "https://boards-api.greenhouse.io/v1/boards/postman/jobs?content=true"
    r = await client.get(url, timeout=45)
    r.raise_for_status()
    return {
        "config": {"boardToken": "postman"},
        "careers_url": "https://boards.greenhouse.io/postman",
        "list": [trim(r.json())],
        "details": {},
    }


async def record_lever(client: httpx.AsyncClient) -> dict[str, Any]:
    url = "https://api.lever.co/v0/postings/zeta?mode=json"
    r = await client.get(url, timeout=45)
    r.raise_for_status()
    return {
        "config": {"slug": "zeta"},
        "careers_url": "https://jobs.lever.co/zeta",
        "list": [trim(r.json())],
        "details": {},
    }


async def record_ashby(client: httpx.AsyncClient) -> dict[str, Any]:
    url = "https://api.ashbyhq.com/posting-api/job-board/confluent"
    r = await client.get(url, timeout=45)
    r.raise_for_status()
    return {
        "config": {"slug": "confluent"},
        "careers_url": "https://jobs.ashbyhq.com/confluent",
        "list": [trim(r.json())],
        "details": {},
    }


async def record_smartrecruiters(client: httpx.AsyncClient) -> dict[str, Any]:
    company = "swiggy"
    base = f"https://api.smartrecruiters.com/v1/companies/{company}/postings"
    pages: list[Any] = []
    details: dict[str, Any] = {}
    offset = 0
    # Two pages is enough to exercise the pagination loop without a 600-job fixture.
    for _ in range(2):
        r = await client.get(f"{base}?limit=100&offset={offset}", timeout=45)
        r.raise_for_status()
        page = r.json()
        pages.append(trim(page))
        content = page.get("content", [])
        if not content:
            break
        offset += len(content)
        if offset >= int(page.get("totalFound", 0)):
            break

    first_id = pages[0]["content"][0]["id"]
    d = await client.get(f"{base}/{first_id}", timeout=45)
    if d.status_code == 200:
        details[str(first_id)] = trim(d.json())

    return {
        "config": {"companyId": company},
        "careers_url": f"https://careers.smartrecruiters.com/{company}",
        "list": pages,
        "details": details,
    }


async def record_workday(client: httpx.AsyncClient) -> dict[str, Any]:
    config = {
        "tenant": "nvidia",
        "dataCenter": "wd5",
        "site": "NVIDIAExternalCareerSite",
    }
    base = (
        f"https://{config['tenant']}.{config['dataCenter']}.myworkdayjobs.com"
        f"/wday/cxs/{config['tenant']}/{config['site']}"
    )
    headers = {"Content-Type": "application/json", "Accept-Language": "en-US"}
    pages: list[Any] = []
    # Three pages captures the trap that matters: `total` is populated only on the first page
    # and reported as 0 on every later one.
    for offset in (0, 20, 40):
        r = await client.post(
            f"{base}/jobs",
            json={"appliedFacets": {}, "limit": 20, "offset": offset, "searchText": ""},
            headers=headers,
            timeout=45,
        )
        r.raise_for_status()
        pages.append(trim(r.json()))

    # Rewrite the first page's `total` to match what was actually captured.
    #
    # The live board reports 2000, and the adapter correctly derives its page count from that
    # figure -- so an unmodified fixture would have it request 100 pages against 3 recorded
    # ones. The fixture then represents a smaller board rather than a truncated large one,
    # which is a coherent thing to test against.
    #
    # Crucially the trap itself is preserved untouched: pages 2 and 3 still report total=0,
    # which is the behaviour that caused the original silent truncation.
    captured = sum(len(p.get("jobPostings", [])) for p in pages)
    pages[0]["total"] = captured

    details: dict[str, Any] = {}
    path = pages[0]["jobPostings"][0]["externalPath"]
    d = await client.get(f"{base}{path}", headers={"Accept": "application/json"}, timeout=45)
    if d.status_code == 200:
        details[path] = trim(d.json())

    return {
        "config": config,
        "careers_url": (
            f"https://{config['tenant']}.{config['dataCenter']}.myworkdayjobs.com/{config['site']}"
        ),
        "list": pages,
        "details": details,
    }


RECORDERS = {
    "greenhouse": record_greenhouse,
    "lever": record_lever,
    "ashby": record_ashby,
    "smartrecruiters": record_smartrecruiters,
    "workday": record_workday,
}


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(headers={"User-Agent": UA}, follow_redirects=True) as client:
        for name, recorder in RECORDERS.items():
            try:
                cassette = await recorder(client)
            except Exception as exc:  # noqa: BLE001
                print(f"  FAIL {name}: {type(exc).__name__}: {exc}")
                continue
            path = OUT / f"{name}.json"
            path.write_text(json.dumps(cassette, indent=1), encoding="utf-8")
            pages = len(cassette["list"])
            size = path.stat().st_size // 1024
            print(f"  ok   {name:<16} {pages} page(s), {len(cassette['details'])} detail(s), {size}KB")


asyncio.run(main())
