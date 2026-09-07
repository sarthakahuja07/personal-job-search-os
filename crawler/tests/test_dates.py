"""Date parsing.

The governing rule is that `posted_at` may be a real calendar date or None, and must never be
fabricated from display text -- a lenient parser turns Workday's "Posted Today" into today's
date on every crawl, a value that is always wrong, always plausible, and never raises.
"""

from __future__ import annotations

from datetime import date

import pytest

from crawler.normalization.dates import parse_date


@pytest.mark.parametrize(
    "value,expected",
    [
        # "Sept" is the one four-letter month abbreviation in common use. Apple's board writes
        # it, and every format understands "Sep" or "September" but not this, so a real date
        # was silently becoming None.
        ("07 Sept 2026", date(2026, 9, 7)),
        ("1 Sept 2026", date(2026, 9, 1)),
        ("07 Sep 2026", date(2026, 9, 7)),
        ("07 September 2026", date(2026, 9, 7)),
        ("September 7, 2026", date(2026, 9, 7)),
        ("2026-09-07", date(2026, 9, 7)),
        ("2026-09-07T12:30:00Z", date(2026, 9, 7)),
        (1785110400, date(2026, 7, 27)),
    ],
)
def test_parses_real_dates(value, expected):
    assert parse_date(value) == expected


@pytest.mark.parametrize(
    "value",
    ["Posted Today", "Yesterday", "3 days ago", "Just posted", "Recently", "", None, "not a date"],
)
def test_refuses_to_invent_a_date(value):
    assert parse_date(value) is None


def test_september_is_not_mangled_into_seper():
    """A bare replace of "Sept" would corrupt "September"; the fix must be word-bounded."""
    assert parse_date("07 September 2026") == date(2026, 9, 7)
