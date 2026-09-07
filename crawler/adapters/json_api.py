"""A JSON search endpoint, described entirely by configuration.

Plenty of large employers are not on a known ATS but still serve their jobs as JSON from a
search endpoint their own careers page calls. What differs between them is not the mechanism --
paginated GET returning a list of records -- but where the fields sit. That difference is
expressible as data, so these become config rows rather than one adapter each (PRD §97).

Amazon is the first user. Others follow by adding a company row, not a Python file.

    {
      "adapter": "json_api",
      "listUrl": "https://www.amazon.jobs/en/search.json?result_limit={limit}&offset={offset}",
      "jobsPath": "jobs",          // "." when the response is itself the array
      "totalPath": "hits",
      "pageSize": 100,
      "fields": {
        "external_job_id": "id_icims",
        "title": "title",
        "job_url": {"template": "https://www.amazon.jobs{job_path}"}
      }
    }
"""

from __future__ import annotations

import json
import re
from typing import Any

from crawler.adapters.base import ConfigError, JobSourceAdapter, SchemaDriftError
from crawler.http.client import CrawlBudget, HttpClient
from crawler.models.job import NormalizedJob, RawJob
from crawler.normalization.dates import parse_date
from crawler.normalization.fieldmap import map_record, resolve_path
from crawler.normalization.text import html_to_text

DEFAULT_PAGE_SIZE = 100
DEFAULT_MAX_PAGES = 40

REQUIRED_FIELDS = ("external_job_id", "title", "job_url")


class JsonApiAdapter(JobSourceAdapter):
    source_type = "json_api"
    tier = 3

    # No detect(): a bespoke endpoint cannot be inferred from a careers URL. These companies are
    # configured deliberately, which is the honest reflection of how they were found.

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        errors: list[str] = []
        if not config.get("listUrl"):
            errors.append("listUrl is required (the JSON search endpoint, with {offset}/{limit})")
        if not config.get("jobsPath"):
            errors.append("jobsPath is required (dot path to the array of job records)")
        fields = config.get("fields") or {}
        for required in REQUIRED_FIELDS:
            if required not in fields:
                errors.append(f"fields.{required} is required")
        return errors

    async def fetch_list(
        self, config: dict[str, Any], client: HttpClient, budget: CrawlBudget
    ) -> list[RawJob]:
        errors = self.validate_config(config)
        if errors:
            raise ConfigError("; ".join(errors))

        list_url: str = config["listUrl"]
        jobs_path: str = config["jobsPath"]
        total_path: str | None = config.get("totalPath")
        page_size = int(config.get("pageSize", DEFAULT_PAGE_SIZE))
        max_pages = int(config.get("maxPages", DEFAULT_MAX_PAGES))
        # Page numbering is 1-based on some endpoints and 0-based on others; html_list already
        # calls this startPage, so json_api uses the same word for the same idea.
        start_page = int(config.get("startPage", 0))
        method = str(config.get("method", "GET")).upper()
        headers = dict(config.get("headers") or {"Accept": "application/json"})

        # Some boards issue a per-session CSRF token on the careers page and reject API calls
        # without it. Priming fetches that page first, lifts the token, and sends it as a header.
        # Cookies persist on the shared client, so the token and its session stay paired.
        prime = config.get("prime")
        if prime:
            response = await client.request(
                "GET", prime["url"], headers={"Accept": "text/html"}, budget=budget
            )
            match = re.search(prime["tokenPattern"], response.text)
            if not match:
                raise SchemaDriftError(
                    f"could not find a session token on {prime['url']} using "
                    f"{prime['tokenPattern']!r}; the board's auth has changed"
                )
            headers[prime.get("tokenHeader", "x-csrf-token")] = match.group(1)
            headers.setdefault("Referer", prime["url"])

        # An endpoint that takes no {offset}/{page} returns its whole board in one response.
        # Without this the loop would re-request the identical URL maxPages times and emit the
        # same jobs over and over -- Atlassian returns 253 records, which would have become
        # 10,120 duplicates while looking like a perfectly successful crawl.
        paginated = "{offset}" in list_url or "{page}" in list_url

        out: list[RawJob] = []
        offset = 0
        total: int | None = None

        for _ in range(max_pages):
            url = list_url.format(
                offset=offset, limit=page_size, page=start_page + offset // page_size
            )

            if method == "POST":
                body = json.loads(
                    json.dumps(config.get("body") or {})
                    .replace("{offset}", str(offset))
                    .replace("{limit}", str(page_size))
                )
                data, _resp = await client.post_json(
                    url, json=body, headers=headers, budget=budget
                )
            else:
                data, _resp = await client.get_json(url, headers=headers, budget=budget)

            records = resolve_path(data, jobs_path)
            if records is None:
                raise ConfigError(
                    f"jobsPath '{jobs_path}' matched nothing; the endpoint's shape may have changed"
                )
            if not isinstance(records, list):
                raise ConfigError(f"jobsPath '{jobs_path}' is {type(records).__name__}, not a list")

            # Read the total once. Several of these endpoints report it only on the first page,
            # and Workday taught us what trusting a per-page total costs.
            if total is None and total_path:
                raw_total = resolve_path(data, total_path)
                total = int(raw_total) if isinstance(raw_total, (int, float, str)) and str(raw_total).isdigit() else None

            for record in records:
                record["_config"] = config
                out.append(RawJob(data=record, source_url=url))

            offset += len(records)
            if not records or not paginated:
                break

            # An authoritative total beats the short-page heuristic, and must be checked first.
            #
            # Several of these endpoints silently cap their page size: Microsoft's returns 10
            # rows however large a `num` you ask for, while correctly reporting count=226. Ending
            # the crawl on "fewer rows than requested" therefore stopped it after 10 of 226 jobs
            # and reported success -- the same silent truncation as the Workday `total` trap,
            # wearing different clothes. A short page only means "done" when nothing better is
            # available.
            if total is not None:
                if offset >= total:
                    break
            elif len(records) < page_size:
                break
        else:
            # The loop ran out of pages rather than out of jobs. With a server that caps its
            # page size this is easy to hit by accident -- Qualcomm reports 579 jobs and serves
            # 10 at a time, so the default 40-page ceiling would return 400 of them and call it
            # a successful crawl. Truncation that reports success is the failure mode this
            # project exists to prevent, so it fails loudly and names the fix.
            if total is not None and offset < total:
                raise SchemaDriftError(
                    f"stopped after maxPages={max_pages} with {offset} of {total} jobs "
                    f"collected. Raise maxPages for this source (it needs at least "
                    f"{-(-total // max(page_size, 1))})."
                )

        return out

    def parse(self, raw: RawJob) -> NormalizedJob:
        config = raw.data.get("_config") or {}
        fields = config.get("fields") or {}
        mapped = map_record(raw.data, fields)

        for required in REQUIRED_FIELDS:
            if not mapped.get(required):
                raise ConfigError(
                    f"field '{required}' resolved to nothing for this record; check the field map"
                )

        return NormalizedJob(
            external_job_id=str(mapped["external_job_id"]),
            title=str(mapped["title"]).strip(),
            job_url=str(mapped["job_url"]),
            location=_as_text(mapped.get("location")),
            department=_as_text(mapped.get("department")),
            description=html_to_text(_as_text(mapped.get("description"))),
            employment_type=_as_text(mapped.get("employment_type")),
            posted_at=parse_date(mapped.get("posted_at")),
            raw_metadata={},
        )


def _as_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
