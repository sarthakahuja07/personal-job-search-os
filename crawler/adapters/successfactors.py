"""SAP SuccessFactors Career Site Builder boards, read from their sitemap. Tier 2.

True Corporation is the first user (`careers.true.th`). A CSB site renders its job search in
the browser from `/services/recruiting/...`, and the site's own robots.txt has
`Disallow: /services/` -- so the search is off-limits however easy it would be to call. What
robots does permit is `/sitemap.xml`, which lists every open job, and the job pages themselves.

The sitemap carries no title, only a link of the form

    /job/<Location>-<Title>-<code>/<jobId>/

so the list phase reads the title out of the slug, location still attached. That is good enough
for the title gate, which is all it is used for: every job that passes it gets a detail fetch,
and the job page's `og:title` replaces the slug title. Only the jobs that are ingested ever need
the real title, and those are exactly the ones fetched. The location is then whatever the slug
has in front of the real title -- the job page itself has no location field.

`posted_at` is left empty on purpose. The page shows a "Posting Start Date" as `22/10/2026`, in
a format each tenant chooses; reading `03/04/2026` as March or April would be a guess.

    {"siteUrl": "https://careers.true.th"}
"""

from __future__ import annotations

import html
import re
from typing import Any
from urllib.parse import unquote

from bs4 import BeautifulSoup

from crawler.adapters.base import ConfigError, JobSourceAdapter, SchemaDriftError
from crawler.http.client import CrawlBudget, HttpClient
from crawler.models.job import NormalizedJob, RawJob
from crawler.normalization.text import html_to_text

_JOB_PATH_RE = re.compile(r"/job/([^/]+)/(\d+)/?$")
_LOC_RE = re.compile(r"<loc>\s*([^<]+?)\s*</loc>")
_ROOT_RE = re.compile(r"<(urlset|sitemapindex)\b")
# The slug ends in a numeric location code ("-13976") that is not part of the title.
_SLUG_CODE_RE = re.compile(r"-\d+$")
_PAGE_TITLE_SUFFIX_RE = re.compile(r"\s+Job Details\s*\|.*$")

# A sitemap index is followed one level down, no further. True's is a single urlset.
MAX_CHILD_SITEMAPS = 20


def _slug_text(slug: str) -> str:
    """The slug as text: `Bangkok-Head-of-Retention-13976` -> `Bangkok-Head-of-Retention`."""
    return _SLUG_CODE_RE.sub("", html.unescape(unquote(slug)))


def _words(text: str) -> list[str]:
    return [w for w in (re.sub(r"\W", "", t).lower() for t in re.split(r"[\s-]+", text)) if w]


def _location_from_slug(slug: str, title: str) -> str | None:
    """Whatever the slug has in front of the real title is the job's location.

    Matched on the title's first two words, not the whole title: the slug is not the title
    verbatim. True's carries internal suffixes ("...-Migrant-and-Tourist-Perm") and drops
    punctuation (" - OPEX" becomes "-OPEX"), so an exact suffix match missed a third of them.
    """
    parts = [p for p in slug.split("-") if p]
    normalized = [re.sub(r"\W", "", p).lower() for p in parts]
    head = _words(title)[:2]
    if not head:
        return None
    for i in range(1, len(normalized) - len(head) + 1):
        if normalized[i : i + len(head)] == head:
            return " ".join(parts[:i])
    return None


class SuccessFactorsAdapter(JobSourceAdapter):
    source_type = "successfactors"
    tier = 2

    # No detect(): a CSB site sits on the company's own domain, so its URL says nothing about
    # the platform behind it.

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        site = config.get("siteUrl")
        if not site:
            return ["siteUrl is required (the career site root, e.g. https://careers.true.th)"]
        if not str(site).startswith("https://"):
            return ["siteUrl must be an https:// URL"]
        return []

    async def fetch_list(
        self, config: dict[str, Any], client: HttpClient, budget: CrawlBudget
    ) -> list[RawJob]:
        errors = self.validate_config(config)
        if errors:
            raise ConfigError("; ".join(errors))

        sitemap = config["siteUrl"].rstrip("/") + "/sitemap.xml"
        root, locs = await self._read_sitemap(sitemap, client, budget)
        if root == "sitemapindex":
            children, locs = locs[:MAX_CHILD_SITEMAPS], []
            for child in children:
                _, child_locs = await self._read_sitemap(child, client, budget)
                locs.extend(child_locs)

        out: list[RawJob] = []
        seen: set[str] = set()
        for loc in locs:
            match = _JOB_PATH_RE.search(loc)
            if not match or match.group(2) in seen:
                continue
            seen.add(match.group(2))
            out.append(
                RawJob(
                    data={"url": loc, "slug": match.group(1), "jobId": match.group(2)},
                    source_url=sitemap,
                )
            )

        # A sitemap full of links none of which is a job means the URL scheme changed, and
        # reporting that as an empty board is exactly the silent failure to avoid.
        if locs and not out:
            raise SchemaDriftError(
                f"{sitemap} lists {len(locs)} URLs but none matches /job/<slug>/<id>/"
            )
        return out

    @staticmethod
    async def _read_sitemap(
        url: str, client: HttpClient, budget: CrawlBudget
    ) -> tuple[str, list[str]]:
        response = await client.request(
            "GET", url, headers={"Accept": "application/xml, text/xml"}, budget=budget
        )
        response.raise_for_status()
        root = _ROOT_RE.search(response.text)
        if root is None:
            raise SchemaDriftError(f"{url} is not a sitemap (no <urlset> or <sitemapindex>)")
        return root.group(1), [html.unescape(m) for m in _LOC_RE.findall(response.text)]

    async def fetch_detail(
        self,
        raw: RawJob,
        config: dict[str, Any],
        client: HttpClient,
        budget: CrawlBudget,
    ) -> RawJob:
        response = await client.request(
            "GET", raw.data["url"], headers={"Accept": "text/html"}, budget=budget
        )
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")

        title = None
        og = soup.find("meta", attrs={"property": "og:title"})
        if og and og.get("content"):
            title = str(og["content"])
        elif soup.title and soup.title.string:
            title = _PAGE_TITLE_SUFFIX_RE.sub("", soup.title.string)

        # Each labelled field on the page ("Job Title:", "Posting Start Date:", "Job
        # Description:") is a .joblayouttoken. Labels are tenant-defined text, so the
        # description is the longest token rather than the one with a particular label.
        description = None
        tokens = soup.select(".joblayouttoken")
        if tokens:
            body = max(tokens, key=lambda t: len(t.get_text()))
            label = body.select_one(".joblayouttoken-label")
            if label:
                label.decompose()
            description = body.decode_contents()

        return RawJob(
            data={**raw.data, "pageTitle": title, "description": description},
            source_url=raw.data["url"],
        )

    def parse(self, raw: RawJob) -> NormalizedJob:
        d = raw.data
        self.require(d, "url", "slug", "jobId")
        slug = _slug_text(d["slug"])

        page_title = " ".join(str(d.get("pageTitle") or "").split())
        title = page_title or slug.replace("-", " ")
        location = _location_from_slug(slug, page_title) if page_title else None

        return NormalizedJob(
            external_job_id=d["jobId"],
            title=" ".join(title.split()),
            job_url=d["url"],
            location=location,
            description=html_to_text(d.get("description")),
            raw_metadata={},
        )
