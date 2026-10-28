"""SuccessFactors: the real title comes from the job page, the location from the slug.

The sitemap only links each job, as /job/<Location>-<Title>-<code>/<id>/, and the job page has
no location field. So the location is whatever the slug has in front of the page's title. The
slugs below are real ones from careers.true.th, chosen because each broke a simpler rule: a
two-word city, an internal "-Perm" suffix the title lacks, and a " - " the slug collapsed.
"""

from __future__ import annotations

from typing import Any

import pytest

from crawler.adapters.base import SchemaDriftError
from crawler.adapters.successfactors import SuccessFactorsAdapter
from crawler.http.client import CrawlBudget
from crawler.models.job import RawJob

ADAPTER = SuccessFactorsAdapter()
SITE = "https://careers.true.th"


def _raw(slug: str, job_id: str, page_title: str | None = None) -> RawJob:
    data: dict[str, Any] = {"url": f"{SITE}/job/{slug}/{job_id}/", "slug": slug, "jobId": job_id}
    if page_title is not None:
        data["pageTitle"] = page_title
    return RawJob(data=data, source_url=f"{SITE}/sitemap.xml")


@pytest.mark.parametrize(
    "slug,title,location",
    [
        (
            "Samut-Prakan-Associate%2C-True-Sphere-%40-Suvarnabhumi-Airport-14064",
            "Associate, True Sphere @ Suvarnabhumi Airport",
            "Samut Prakan",
        ),
        (
            "Bangkok-Specialist%2C-Migrant-and-Tourist-Perm-13976",
            "Specialist, Migrant and Tourist",
            "Bangkok",
        ),
        (
            "Bangkok-Specialist%2C-Business-Partner-OPEX-%28Commercial%29-13976",
            "Specialist, Business Partner - OPEX (Commercial)",
            "Bangkok",
        ),
    ],
)
def test_location_is_the_slug_in_front_of_the_page_title(slug, title, location):
    job = ADAPTER.parse(_raw(slug, "60141444", title))
    assert job.title == title
    assert job.location == location


def test_list_phase_title_comes_from_the_slug():
    """Before the detail fetch there is no page title; the slug, code stripped, stands in for
    the title gate."""
    job = ADAPTER.parse(_raw("Bangkok-Expert%2C-AI-Architect-13976", "59894744"))
    assert job.title == "Bangkok Expert, AI Architect"
    assert job.location is None
    assert job.external_job_id == "59894744"


class _Response:
    def __init__(self, text: str) -> None:
        self.text = text

    def raise_for_status(self) -> None:
        return None


class _Client:
    def __init__(self, pages: dict[str, str]) -> None:
        self.pages = pages

    async def request(self, method: str, url: str, **kwargs: Any) -> _Response:
        return _Response(self.pages[url])


JOB_PAGE = """<html><head>
<title>Expert, AI Architect Job Details | TRUE</title>
<meta property="og:title" content="Expert, AI Architect">
</head><body>
<div class="joblayouttoken"><span class="joblayouttoken-label">Job Title:</span>
<span>Expert, AI Architect</span></div>
<div class="joblayouttoken"><span class="joblayouttoken-label">Posting Start Date:</span>
<span>22/10/2026</span></div>
<div class="joblayouttoken"><span class="joblayouttoken-label">Job Description:</span>
<span><p>Design the AI platform used across every True business unit.</p></span></div>
</body></html>"""


@pytest.mark.asyncio
async def test_detail_fetch_supplies_title_and_description():
    raw = _raw("Bangkok-Expert%2C-AI-Architect-13976", "59894744")
    client = _Client({raw.data["url"]: JOB_PAGE})
    detailed = await ADAPTER.fetch_detail(raw, {"siteUrl": SITE}, client, CrawlBudget())
    job = ADAPTER.parse(detailed)
    assert job.title == "Expert, AI Architect"
    assert job.location == "Bangkok"
    assert job.description == "Design the AI platform used across every True business unit."
    # The page's dd/mm date is deliberately not read.
    assert job.posted_at is None


@pytest.mark.asyncio
async def test_a_sitemap_with_no_job_links_is_drift_not_an_empty_board():
    sitemap = (
        '<?xml version="1.0"?><urlset xmlns="http://www.google.com/schemas/sitemap/0.9">'
        f"<url><loc>{SITE}/go/Information-Technology/713344/</loc></url></urlset>"
    )
    client = _Client({f"{SITE}/sitemap.xml": sitemap})
    with pytest.raises(SchemaDriftError):
        await ADAPTER.fetch_list({"siteUrl": SITE}, client, CrawlBudget())
