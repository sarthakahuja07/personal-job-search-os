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



# --- Config-driven sources ------------------------------------------------
#
# These two adapters are configured entirely by data, so their cassette carries the config the
# conformance suite will replay against. Adding another company on the same pattern means a new
# company row, not a new recorder.

AMAZON_CONFIG = {
    "adapter": "json_api",
    # Scoped to India deliberately: the board carries 10,000+ roles globally and matching only
    # ever accepts four Indian locations, so fetching the rest is waste for us and load for them.
    "listUrl": (
        "https://www.amazon.jobs/en/search.json?result_limit={limit}&offset={offset}"
        "&loc_query=India&country=IND&sort=recent"
    ),
    "jobsPath": "jobs",
    "totalPath": "hits",
    "pageSize": 100,
    "maxPages": 30,
    "fields": {
        "external_job_id": "id_icims",
        "title": "title",
        "job_url": {"template": "https://www.amazon.jobs{job_path}"},
        "location": "normalized_location",
        "department": "job_category",
        "description": "description",
        "posted_at": "posted_date",
    },
}

DESHAW_CONFIG = {
    "adapter": "hydration",
    "pageUrl": "https://www.deshawindia.com/careers/work-with-us",
    "scriptId": "__NEXT_DATA__",
    "jobsPath": "props.pageProps.regularJobs",
    "fields": {
        "external_job_id": "id",
        "title": "displayName",
        # Verified by comparing hydration output against a nonsense path: /careers/<slug>
        # returns jobData, every other candidate falls back to redirectToCareers.
        "job_url": {"template": "https://www.deshawindia.com/careers/{data.jobUrl}"},
        "location": {"path": "office", "pluck": "name", "join": ", "},
        "department": "data.department.name",
        "description": "data.jobDescription.websiteDescription",
    },
}


async def record_json_api(client: httpx.AsyncClient) -> dict[str, Any]:
    url = AMAZON_CONFIG["listUrl"].format(limit=100, offset=0, page=0)
    r = await client.get(url, headers={"Accept": "application/json"}, timeout=60)
    r.raise_for_status()
    return {
        "config": AMAZON_CONFIG,
        "careers_url": "https://www.amazon.jobs/en/search",
        "list": [trim(r.json())],
        "details": {},
    }


async def record_hydration(client: httpx.AsyncClient) -> dict[str, Any]:
    r = await client.get(DESHAW_CONFIG["pageUrl"], timeout=60)
    r.raise_for_status()

    # The adapter reads raw HTML, but only the hydration script matters. Storing the whole
    # 2.5 MB page would make the fixture unreadable in review for no extra coverage, so keep
    # the script tag and a minimal wrapper -- the shape the adapter actually parses.
    import re as _re

    match = _re.search(
        r'<script id="__NEXT_DATA__"[^>]*>.*?</script>', r.text, _re.S
    )
    html = f"<html><body>{match.group(0)}</body></html>" if match else r.text

    return {
        "config": DESHAW_CONFIG,
        "careers_url": DESHAW_CONFIG["pageUrl"],
        "html": html,
        "list": [],
        "details": {},
    }



INTUIT_CONFIG = {
    "adapter": "html_list",
    "listUrl": (
        "https://jobs.intuit.com/search-jobs/results?ActiveFacetID=0&CurrentPage={page}"
        "&RecordsPerPage={limit}&Distance=50&RadiusUnitType=0&Queries=&Facet="
        "&SearchResultsModuleName=Search+Results&SearchFiltersModuleName=Search+Filters"
        "&SortCriteria=0&SortDirection=0&SearchType=5"
    ),
    # Radancy/TalentBrew wraps its markup in a JSON envelope, so the HTML lives under a key.
    "htmlPath": "results",
    "itemSelector": "li[data-intuit-jobid]",
    "pageSize": 100,
    "startPage": 1,
    "maxPages": 20,
    "fields": {
        "external_job_id": {"attr": "data-intuit-jobid"},
        "title": {"selector": "h2", "text": True},
        "job_url": {"selector": "a", "attr": "href", "base": "https://jobs.intuit.com"},
        "location": {"selector": "span.job-location", "text": True},
        "department": {"attr": "data-category"},
    },
}


async def record_html_list(client: httpx.AsyncClient) -> dict[str, Any]:
    pages = []
    for page in (1, 2):
        url = INTUIT_CONFIG["listUrl"].format(page=page, limit=100, offset=0)
        r = await client.get(url, headers={"Accept": "application/json"}, timeout=60)
        r.raise_for_status()
        pages.append(r.json())
    return {
        "config": INTUIT_CONFIG,
        "careers_url": "https://jobs.intuit.com/search-jobs",
        "list": pages,
        "details": {},
    }


RECORDERS = {
    "greenhouse": record_greenhouse,
    "lever": record_lever,
    "ashby": record_ashby,
    "smartrecruiters": record_smartrecruiters,
    "workday": record_workday,
    "json_api": record_json_api,
    "hydration": record_hydration,
    "html_list": record_html_list,
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
            pages = len(cassette["list"]) or ("html" if cassette.get("html") else 0)
            size = path.stat().st_size // 1024
            print(f"  ok   {name:<16} {pages} page(s), {len(cassette['details'])} detail(s), {size}KB")


asyncio.run(main())
