"""Jobs embedded in the page as hydration state.

A server-rendered React or Vue careers page ships its data inside the HTML, in a
`<script id="__NEXT_DATA__">` blob or a `window.__NUXT__` assignment, so the client can hydrate
without a second request. When that is true the jobs are already in the first response -- no API
to reverse-engineer and no browser to drive.

DE Shaw is the first user: all 85 of its openings sit at
`props.pageProps.regularJobs`, offices and all.

This is Tier 4 in the ladder: less stable than an ATS feed, far more stable than parsing the DOM,
and honest about being neither.

    {
      "adapter": "hydration",
      "pageUrl": "https://www.deshawindia.com/careers/work-with-us",
      "scriptId": "__NEXT_DATA__",
      "jobsPath": "props.pageProps.regularJobs",
      "fields": {...}
    }

Where the blob sits in an attribute rather than a script, name the element instead:

    {"attributeSelector": "input#jobs", "attribute": "value", "jobsPath": "."}

A Next.js App Router page has no __NEXT_DATA__; name the text just before the value in its RSC
flight data instead:

    {"rscMarker": "\"__component\":\"product.career-job-listing\",\"jobs\":", "jobsPath": "."}
"""

from __future__ import annotations

import html as html_module
import json
import re
from typing import Any

from bs4 import BeautifulSoup

from crawler.adapters.base import ConfigError, JobSourceAdapter, SchemaDriftError
from crawler.http.client import CrawlBudget, HttpClient
from crawler.models.job import NormalizedJob, RawJob
from crawler.normalization.dates import parse_date
from crawler.normalization.fieldmap import map_record, resolve_path
from crawler.normalization.text import html_to_text

REQUIRED_FIELDS = ("external_job_id", "title", "job_url")

# window.__NUXT__ = {...};  /  window.__INITIAL_STATE__ = {...}
_ASSIGNMENT = re.compile(
    r"window\.(?P<name>__[A-Z_]+__)\s*=\s*(?P<json>[\[{].*?)(?:;\s*(?:</script>|window\.|\Z))",
    re.S,
)


class HydrationAdapter(JobSourceAdapter):
    source_type = "hydration"
    tier = 4

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        errors: list[str] = []
        if not config.get("pageUrl"):
            errors.append("pageUrl is required (the careers page that embeds the data)")
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

        response = await client.request(
            "GET",
            config["pageUrl"],
            headers=config.get("headers") or {"Accept": "text/html"},
            budget=budget,
        )
        response.raise_for_status()
        payload = self._extract(response.text, config)

        records = resolve_path(payload, config["jobsPath"])
        if records is None:
            raise SchemaDriftError(
                f"jobsPath '{config['jobsPath']}' matched nothing in the embedded state; "
                "the page's hydration shape has changed"
            )
        if not isinstance(records, list):
            raise SchemaDriftError(
                f"jobsPath '{config['jobsPath']}' is {type(records).__name__}, not a list"
            )

        out: list[RawJob] = []
        for record in records:
            if isinstance(record, dict):
                record["_config"] = config
                out.append(RawJob(data=record, source_url=config["pageUrl"]))
        return out

    @staticmethod
    def _extract(html: str, config: dict[str, Any]) -> Any:
        """Pull the hydration blob out of the HTML.

        Three shapes, in order of how commonly they turn up:
        a <script id="..."> body, a `window.__STATE__ =` assignment, and an HTML attribute
        holding entity-encoded JSON. The last is what Zoho Recruit portals do -- CHEQ ships
        all ten of its jobs in `<input id="jobs" value="[{&#34;Posting_Title&#34;...">`, which
        looks browser-rendered from the outside and is in fact in the first response.
        """
        marker = config.get("rscMarker")
        if marker:
            return _extract_rsc(html, marker)

        selector = config.get("attributeSelector")
        if selector:
            attribute = config.get("attribute", "value")
            node = BeautifulSoup(html, "html.parser").select_one(selector)
            if node is None:
                raise SchemaDriftError(
                    f"attributeSelector '{selector}' matched no element; the page structure "
                    "has changed"
                )
            blob = node.get(attribute)
            if not blob:
                raise SchemaDriftError(
                    f"element '{selector}' has no '{attribute}' attribute to read"
                )
            # BeautifulSoup already decodes entities in attribute values; unescaping again is
            # harmless for JSON and covers callers that hand us a raw attribute string.
            try:
                return json.loads(html_module.unescape(str(blob)))
            except json.JSONDecodeError as exc:
                raise SchemaDriftError(
                    f"'{selector}[{attribute}]' is not valid JSON: {exc}"
                ) from exc

        script_id = config.get("scriptId", "__NEXT_DATA__")
        tagged = re.search(
            rf'<script[^>]*id="{re.escape(script_id)}"[^>]*>(.*?)</script>', html, re.S
        )
        if tagged:
            try:
                return json.loads(tagged.group(1))
            except json.JSONDecodeError as exc:
                raise SchemaDriftError(f"{script_id} is no longer valid JSON: {exc}") from exc

        for match in _ASSIGNMENT.finditer(html):
            if match.group("name") == script_id:
                try:
                    return json.loads(match.group("json"))
                except json.JSONDecodeError:
                    continue

        raise SchemaDriftError(
            f"no embedded state found under '{script_id}'. The page may have moved to "
            "client-side fetching, in which case this source needs a different adapter."
        )

    def parse(self, raw: RawJob) -> NormalizedJob:
        config = raw.data.get("_config") or {}
        mapped = map_record(raw.data, config.get("fields") or {})

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


# Next.js App Router pages stream their server-component payload as string chunks:
# self.__next_f.push([1,"..."]). The chunks are JSON string literals; joined, they are the
# "flight" text, in which props appear as ordinary JSON.
_FLIGHT_CHUNK = re.compile(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)')


def _extract_rsc(html: str, marker: str) -> Any:
    """Read the JSON value that follows `marker` in a Next.js App Router page's flight data.

    An App Router page has no __NEXT_DATA__; its data rides in the RSC stream instead. Deel ships
    all of its 250-odd openings there as `"__component":"product.career-job-listing","jobs":[...]`
    -- in the first response, with Ashby's own ids, while its public Ashby board returns none.
    The marker is the literal text just before the value, so it pins one component rather than
    the first `"jobs":` that happens to appear.
    """
    chunks = _FLIGHT_CHUNK.findall(html)
    if not chunks:
        raise SchemaDriftError(
            "no Next.js flight data (self.__next_f) on the page; it is no longer an App Router "
            "page, or it moved its data to a client-side fetch"
        )
    try:
        flight = "".join(json.loads(c) for c in chunks)
    except json.JSONDecodeError as exc:
        raise SchemaDriftError(f"flight data chunk is not a JSON string: {exc}") from exc

    at = flight.find(marker)
    if at < 0:
        raise SchemaDriftError(
            f"rscMarker {marker!r} not found in the flight data; the component was renamed "
            "or removed"
        )
    try:
        value, _ = json.JSONDecoder().raw_decode(flight, at + len(marker))
    except json.JSONDecodeError as exc:
        raise SchemaDriftError(f"value after rscMarker is not JSON: {exc}") from exc
    return value


def _as_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
