"""Workday locations that name an office rather than a place get the detail's country.

GCash's board writes "NCR - WCC" for its Manila office. "ncr" is a Gurgaon alias in the
location rules, so without a country every GCash engineering role scored as Gurgaon.
"""

from __future__ import annotations

import pytest

from crawler.adapters.workday import WorkdayAdapter
from crawler.models.job import RawJob

CONFIG = {"tenant": "globe", "dataCenter": "wd3", "site": "Mynt"}


def _parse(locations_text: str, country: str | None) -> str | None:
    detail = {"country": {"descriptor": country}} if country else {}
    raw = RawJob(
        data={
            "title": "Software Engineer",
            "externalPath": "/job/NCR---WCC/Software-Engineer_R0000021001",
            "locationsText": locations_text,
            "bulletFields": ["R0000021001"],
            "_config": CONFIG,
            "_detail": detail,
        },
        source_url="https://globe.wd3.myworkdayjobs.com/wday/cxs/globe/Mynt/jobs",
    )
    return WorkdayAdapter().parse(raw).location


@pytest.mark.parametrize(
    "text,country,expected",
    [
        ("NCR - WCC", "Philippines", "NCR - WCC, Philippines"),
        # Already named: left alone, so India boards keep the strings they had.
        ("India, Bengaluru", "India", "India, Bengaluru"),
        # Only the primary location's country is known, so it must not label all of them.
        ("2 Locations", "United States of America", "2 Locations"),
        # The list record alone, before any detail fetch.
        ("NCR - WCC", None, "NCR - WCC"),
    ],
)
def test_country_is_appended_only_when_missing(text, country, expected):
    assert _parse(text, country) == expected
