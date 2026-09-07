"""The conformance suite: invariants every adapter must satisfy.

Registering an adapter in `crawler/adapters/registry.py` subjects it to every assertion here
automatically. That is the whole mechanism behind "tested for every new company" -- a new
adapter cannot be added without inheriting these, and the ones that matter most are the
invariants whose violation is *invisible in production*:

  - an unstable external_job_id makes every crawl look new, so the same job is emailed daily
    until the notifications are ignored entirely;
  - a display string parsed as a date yields garbage rather than an error;
  - pagination that stops early reports success with a fraction of the jobs.

None of those raise. All of them are caught here.
"""

from __future__ import annotations

import re
from datetime import date
from urllib.parse import urlsplit

import pytest

from crawler.http.client import CrawlBudget
from crawler.models.job import NormalizedJob

from .conftest import ReplayClient

pytestmark = pytest.mark.asyncio

HTML_TAG = re.compile(r"<[^>]+>")
RELATIVE_DATE = re.compile(
    r"\b(today|yesterday|posted|ago|just now)\b",
    re.IGNORECASE,
)


async def fetch_all(adapter, cassette) -> tuple[list[NormalizedJob], ReplayClient]:
    client = ReplayClient(cassette)
    raw = await adapter.fetch_list(cassette["config"], client, CrawlBudget())
    return [adapter.parse(r) for r in raw], client


# ---------------------------------------------------------------------------
# The basics
# ---------------------------------------------------------------------------


async def test_yields_at_least_one_job(adapter_case):
    """A cassette recorded from a live board must produce jobs. Zero here means the adapter is
    broken in exactly the way that looks like 'no openings this week'."""
    _, adapter, cassette = adapter_case
    jobs, _ = await fetch_all(adapter, cassette)
    assert len(jobs) > 0


async def test_every_job_has_the_required_fields(adapter_case):
    _, adapter, cassette = adapter_case
    jobs, _ = await fetch_all(adapter, cassette)
    for job in jobs:
        assert job.external_job_id.strip(), f"empty external_job_id: {job.title!r}"
        assert job.title.strip(), f"empty title for id {job.external_job_id}"
        assert job.job_url.strip(), f"empty job_url for {job.title!r}"


async def test_job_urls_are_absolute_and_https(adapter_case):
    _, adapter, cassette = adapter_case
    jobs, _ = await fetch_all(adapter, cassette)
    for job in jobs:
        parts = urlsplit(job.job_url)
        assert parts.scheme == "https", f"{job.job_url} is not https"
        assert parts.netloc, f"{job.job_url} has no host"


# ---------------------------------------------------------------------------
# Identity -- the invariant that protects against duplicate notifications
# ---------------------------------------------------------------------------


async def test_external_ids_are_stable_across_runs(adapter_case):
    """The single most important assertion in the suite.

    An id that changes between runs makes every crawl look new: Sarthak is emailed daily about
    jobs he has already seen until he stops reading the notifications, at which point the
    product has failed silently. See ADR 005.
    """
    _, adapter, cassette = adapter_case
    first, _ = await fetch_all(adapter, cassette)
    second, _ = await fetch_all(adapter, cassette)
    assert [j.external_job_id for j in first] == [j.external_job_id for j in second]


async def test_external_ids_are_unique_within_a_crawl(adapter_case):
    """Two jobs sharing an id means one silently overwrites the other at ingest."""
    _, adapter, cassette = adapter_case
    jobs, _ = await fetch_all(adapter, cassette)
    ids = [j.external_job_id for j in jobs]
    duplicates = {i for i in ids if ids.count(i) > 1}
    assert not duplicates, f"duplicate external_job_ids: {sorted(duplicates)[:5]}"


async def test_external_ids_are_not_list_positions(adapter_case):
    """A bare small integer is almost always an index, which would make identity depend on
    result ordering."""
    _, adapter, cassette = adapter_case
    jobs, _ = await fetch_all(adapter, cassette)
    suspicious = [j.external_job_id for j in jobs if j.external_job_id.isdigit() and len(j.external_job_id) <= 2]
    assert not suspicious, f"ids look like list indices: {suspicious[:5]}"


async def test_output_is_byte_identical_across_runs(adapter_case):
    """Determinism end to end: same cassette, same normalized output."""
    _, adapter, cassette = adapter_case
    first, _ = await fetch_all(adapter, cassette)
    second, _ = await fetch_all(adapter, cassette)
    assert [j.model_dump() for j in first] == [j.model_dump() for j in second]


# ---------------------------------------------------------------------------
# Dates -- the invariant that protects against garbage sort orders
# ---------------------------------------------------------------------------


async def test_posted_at_is_a_real_date_or_none(adapter_case):
    """Never a display string. Workday returns "Posted Today" in this position, which a naive
    parser turns into nonsense rather than an error."""
    _, adapter, cassette = adapter_case
    jobs, _ = await fetch_all(adapter, cassette)
    for job in jobs:
        assert job.posted_at is None or isinstance(job.posted_at, date), (
            f"{job.external_job_id}: posted_at is {job.posted_at!r}"
        )


async def test_posted_at_is_not_in_the_future(adapter_case):
    _, adapter, cassette = adapter_case
    jobs, _ = await fetch_all(adapter, cassette)
    today = date.today()
    for job in jobs:
        if job.posted_at:
            assert job.posted_at <= today, f"{job.external_job_id} posted in the future"


# ---------------------------------------------------------------------------
# Text hygiene
# ---------------------------------------------------------------------------


async def test_titles_contain_no_html(adapter_case):
    _, adapter, cassette = adapter_case
    jobs, _ = await fetch_all(adapter, cassette)
    for job in jobs:
        assert not HTML_TAG.search(job.title), f"HTML in title: {job.title!r}"


async def test_titles_are_trimmed(adapter_case):
    _, adapter, cassette = adapter_case
    jobs, _ = await fetch_all(adapter, cassette)
    for job in jobs:
        assert job.title == job.title.strip()


async def test_location_is_not_a_relative_date(adapter_case):
    """Guards against a field-order mistake putting 'Posted Today' into the location."""
    _, adapter, cassette = adapter_case
    jobs, _ = await fetch_all(adapter, cassette)
    for job in jobs:
        if job.location:
            assert not RELATIVE_DATE.search(job.location), (
                f"location looks like a date: {job.location!r}"
            )


async def test_descriptions_are_bounded(adapter_case):
    """Unbounded descriptions blew D1's 100KB statement limit in production. Adapters normalise
    and truncate before the job ever reaches ingest."""
    _, adapter, cassette = adapter_case
    jobs, _ = await fetch_all(adapter, cassette)
    for job in jobs:
        if job.description:
            assert len(job.description) <= 8100, (
                f"{job.external_job_id}: description is {len(job.description)} chars"
            )


# ---------------------------------------------------------------------------
# Purity
# ---------------------------------------------------------------------------


async def test_parse_makes_no_network_calls(adapter_case):
    """parse() must be pure. The suite's determinism guarantees rest on it."""
    _, adapter, cassette = adapter_case
    client = ReplayClient(cassette)
    raw = await adapter.fetch_list(cassette["config"], client, CrawlBudget())
    before = len(client.requests)
    for r in raw:
        adapter.parse(r)
    assert len(client.requests) == before, "parse() issued a request"


async def test_parse_is_repeatable_on_the_same_input(adapter_case):
    _, adapter, cassette = adapter_case
    client = ReplayClient(cassette)
    raw = await adapter.fetch_list(cassette["config"], client, CrawlBudget())
    for r in raw[:20]:
        assert adapter.parse(r).model_dump() == adapter.parse(r).model_dump()


# ---------------------------------------------------------------------------
# Pagination and configuration
# ---------------------------------------------------------------------------


async def test_pagination_terminates(adapter_case):
    """Runs against the cassette's real page count. An adapter that loops forever would hang
    the whole crawl rather than fail it."""
    _, adapter, cassette = adapter_case
    jobs, client = await fetch_all(adapter, cassette)
    assert client.list_calls <= len(cassette["list"]) + 2, (
        f"made {client.list_calls} list requests for {len(cassette['list'])} recorded pages"
    )
    assert len(jobs) > 0


async def test_consumes_every_recorded_page(adapter_case):
    """Stopping early is silent truncation -- the Workday `total` trap, which reported success
    with 40 of 2000 jobs."""
    _, adapter, cassette = adapter_case
    if len(cassette["list"]) < 2:
        pytest.skip("single-page cassette")
    _, client = await fetch_all(adapter, cassette)
    assert client.list_calls >= len(cassette["list"]), (
        f"stopped after {client.list_calls} of {len(cassette['list'])} pages"
    )


async def test_detect_round_trips_its_own_careers_url(adapter_case):
    """If an adapter detects URLs, the config it extracts must be one it accepts.

    Adapters that do not implement `detect` are exempt, and legitimately so: a bespoke JSON
    endpoint or an embedded-hydration path cannot be inferred from a careers URL. Those
    companies are configured deliberately, which is an honest reflection of how they were
    found -- guessing a config from a URL that carries no such information would produce an
    adapter that fails silently.
    """
    from crawler.adapters.base import JobSourceAdapter

    _, adapter, cassette = adapter_case
    if type(adapter).detect is JobSourceAdapter.detect:
        pytest.skip("adapter is configured by hand, not detected from a URL")

    sample = cassette.get("careers_url")
    if not sample:
        pytest.skip("no sample careers URL recorded")
    detected = adapter.detect(sample)
    assert detected is not None
    assert adapter.validate_config(detected) == []


async def test_validate_config_rejects_an_empty_config(adapter_case):
    """Every adapter needs something. One that accepts {} would fail at fetch time instead of
    at save time, which is far later and much harder to read."""
    _, adapter, cassette = adapter_case
    assert adapter.validate_config({}), "empty config was accepted"


async def test_validate_config_accepts_the_recorded_config(adapter_case):
    _, adapter, cassette = adapter_case
    assert adapter.validate_config(cassette["config"]) == []


async def test_declares_its_source_type_and_tier(adapter_case):
    source_type, adapter, _ = adapter_case
    assert adapter.source_type == source_type
    assert 1 <= adapter.tier <= 6
