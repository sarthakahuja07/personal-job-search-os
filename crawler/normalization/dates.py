"""Date parsing for adapters.

Deliberately strict about one thing: a relative display string must never become a date. Workday
puts "Posted Today" where a date belongs, and a lenient parser turns that into today's date on
every crawl -- a value that is always wrong, always plausible, and never raises.

So relative text returns None, and everything else must parse to a real calendar date or return
None. `posted_at` being absent is honest; being fabricated is not.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

# Text sources put in date fields that is not a date.
RELATIVE = re.compile(
    r"\b(today|yesterday|just\s*posted|posted|ago|recently|new)\b",
    re.IGNORECASE,
)

_SEPT = re.compile(r"\bSept\b", re.IGNORECASE)

# Formats seen across the sources actually in use, most specific first.
FORMATS = (
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%B %d, %Y",   # "May 20, 2026" -- Amazon
    "%b %d, %Y",   # "May 20, 2026" abbreviated
    "%d %B %Y",
    "%d %b %Y",
)


def parse_date(value: Any) -> date | None:
    """Parse a value into a date, or return None. Never raises, never guesses."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    text = str(value).strip()
    if not text:
        return None

    # Refuse display text outright rather than letting a fuzzy parser invent a date from it.
    if RELATIVE.search(text):
        return None

    # "Sept" is the one four-letter month abbreviation in common use (Apple's board writes
    # "07 Sept 2026"). Every format below understands "Sep" or "September" but not this, so a
    # perfectly real date was silently becoming None. The word boundary keeps "September"
    # intact -- a bare replace would turn it into "Seper".
    text = _SEPT.sub("Sep", text)

    # ISO 8601, with or without a time and timezone.
    iso = text.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(iso).date()
    except ValueError:
        pass

    # Epoch milliseconds or seconds.
    if text.isdigit():
        number = int(text)
        if 10**12 <= number <= 10**13:
            return datetime.utcfromtimestamp(number / 1000).date()
        if 10**9 <= number <= 10**10:
            return datetime.utcfromtimestamp(number).date()
        return None

    for fmt in FORMATS:
        try:
            return datetime.strptime(text[:32], fmt).date()
        except ValueError:
            continue

    return None
