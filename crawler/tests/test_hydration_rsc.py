"""Hydration from a Next.js App Router page's RSC flight data (`rscMarker`).

Deel's careers page has no __NEXT_DATA__; its 250-odd openings ride in self.__next_f chunks, and
its public Ashby board returns none -- so this is the only first-party source.
"""

from __future__ import annotations

import json

import pytest

from crawler.adapters.base import SchemaDriftError
from crawler.adapters.hydration import HydrationAdapter

MARKER = '"__component":"product.career-job-listing","jobs":'


def _page(flight: str, pieces: int = 3) -> str:
    """Split the flight text across several push() chunks, as Next.js does."""
    step = max(1, len(flight) // pieces)
    parts = [flight[i : i + step] for i in range(0, len(flight), step)]
    pushes = "".join(f"<script>self.__next_f.push([1,{json.dumps(p)}])</script>" for p in parts)
    return f"<html><body>{pushes}</body></html>"


FLIGHT = (
    '1:{"other":{"jobs":[{"wrong":true}]}}\n'
    '2:{"__component":"product.career-job-listing","jobs":['
    '{"attributes":{"ashby_id":"a1","title":"Backend Engineer","locations_list":[{"location":"India"}]}},'
    '{"attributes":{"ashby_id":"a2","title":"Account Executive","locations_list":[]}}'
    '],"after":1}'
)


def test_reads_the_array_after_the_marker_across_chunks():
    jobs = HydrationAdapter._extract(_page(FLIGHT), {"rscMarker": MARKER})
    assert [j["attributes"]["ashby_id"] for j in jobs] == ["a1", "a2"]


def test_marker_pins_the_component_not_the_first_jobs_key():
    jobs = HydrationAdapter._extract(_page(FLIGHT), {"rscMarker": MARKER})
    assert all("wrong" not in j for j in jobs)


def test_missing_marker_is_drift_not_zero_jobs():
    with pytest.raises(SchemaDriftError, match="rscMarker"):
        HydrationAdapter._extract(_page('1:{"jobs":[]}'), {"rscMarker": MARKER})


def test_page_without_flight_data_is_drift():
    with pytest.raises(SchemaDriftError, match="flight data"):
        HydrationAdapter._extract("<html></html>", {"rscMarker": MARKER})
