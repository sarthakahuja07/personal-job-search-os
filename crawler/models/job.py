"""The normalized job contract.

This is the boundary between the crawler and the application. Adapters produce these; the ingest
endpoint consumes them (see docs/api.md).

Validation is deliberately strict and happens *here*, at the boundary, rather than server-side
only. A malformed job should fail in the adapter's own test suite with a clear message, not days
later as a mysterious row in the database.

Two fields carry almost all of the correctness weight:

  external_job_id  The source's own stable requisition id. If this is unstable across runs, every
                   crawl looks new and Sarthak gets emailed daily about jobs he has already seen,
                   until he stops trusting notifications entirely. See ADR 005.

  posted_at        A real date or None -- never a display string. Workday returns localized
                   relative text like "Posted Today" in this position, which a naive parser turns
                   into garbage rather than an error. See ADR 008.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Text that sources put in date fields but which is not a date. If a value matching this reaches
# posted_at, it is a bug in the adapter -- surface it loudly rather than silently storing None.
_RELATIVE_DATE_PATTERN = re.compile(
    r"\b(today|yesterday|just posted|posted|ago|day|days|week|weeks|month|months|hour|hours)\b",
    re.IGNORECASE,
)

_HTML_TAG_PATTERN = re.compile(r"<[^>]+>")

# Lowercase labels, dot-separated, ending in an alphabetic TLD. Deliberately strict: a hostname
# carrying capitals or a 40-character label is a malformed template, not a real host.
_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
_HOSTNAME_PATTERN = re.compile(rf"{_LABEL}(?:\.{_LABEL})*\.[a-z]{{2,24}}")


# Parameters that vary between crawls and never carry identity.
_TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "gh_src", "src", "source", "ref", "referrer", "fbclid", "gclid", "msclkid",
    "mc_cid", "mc_eid", "trk", "trackingid", "_ga", "sessionid", "session_id",
}


def normalize_job_url(url: str) -> str:
    """Fallback identity for sources with no stable id.

    Strips only KNOWN TRACKING parameters, never the whole query string. Greenhouse-hosted
    boards put the job id in the query -- Databricks postings look like
    `.../open-positions/job?gh_jid=7979886003` -- so blanket query stripping collapsed all 870
    of their jobs onto a single URL. Remaining parameters are sorted, so parameter ordering
    cannot change the identity between crawls.

    Mirrors normalizeJobUrl in app/src/server/domain/url.ts. Both sides must agree.
    """
    parts = urlsplit(url.strip())
    path = parts.path.rstrip("/") or "/"
    kept = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if k.lower() not in _TRACKING_PARAMS
    ]
    query = urlencode(sorted(kept))
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, query, ""))


class NormalizedJob(BaseModel):
    """A job posting in the shape the ingest endpoint accepts."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    external_job_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    job_url: str = Field(min_length=1)

    location: str | None = None
    department: str | None = None
    description: str | None = None
    employment_type: str | None = None
    posted_at: date | None = None

    raw_metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("external_job_id")
    @classmethod
    def _id_must_be_stable_looking(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("external_job_id must not be empty")
        # A bare ordinal is almost always a list index rather than a requisition id, which would
        # make identity depend on result ordering.
        if v.isdigit() and len(v) <= 2:
            raise ValueError(
                f"external_job_id {v!r} looks like a list index, not a stable source id"
            )
        return v

    @field_validator("title")
    @classmethod
    def _title_must_be_clean(cls, v: str) -> str:
        if _HTML_TAG_PATTERN.search(v):
            raise ValueError(f"title contains HTML tags: {v!r}")
        return v

    @field_validator("job_url")
    @classmethod
    def _url_must_be_absolute_https(cls, v: str) -> str:
        parts = urlsplit(v)
        if parts.scheme not in ("http", "https"):
            raise ValueError(f"job_url must be absolute http(s), got {v!r}")
        if not parts.netloc:
            raise ValueError(f"job_url must include a host, got {v!r}")
        # The host must actually look like a hostname.
        #
        # A field-map template missing its separator produces
        # "https://www.example.comSome-Job-Slug-123" -- which has a scheme and a "host", so the
        # checks above pass, and the result is a plausible-looking URL that goes nowhere. This
        # caught exactly that bug in the DE Shaw configuration.
        host = parts.netloc.split("@")[-1].split(":")[0]
        if not _HOSTNAME_PATTERN.fullmatch(host):
            raise ValueError(
                f"job_url host {host!r} is not a valid hostname — a field-map template is "
                f"probably missing a '/' separator. Full URL: {v!r}"
            )
        return v

    @field_validator("posted_at", mode="before")
    @classmethod
    def _reject_display_strings(cls, v: Any) -> Any:
        """Catch relative-date text before pydantic tries to coerce it."""
        if v is None or isinstance(v, (date, datetime)):
            return v
        if isinstance(v, str):
            text = v.strip()
            if not text:
                return None
            if _RELATIVE_DATE_PATTERN.search(text):
                raise ValueError(
                    f"posted_at got a display string {text!r}. Fetch the real date from the "
                    "detail endpoint, or pass None."
                )
        return v

    @property
    def normalized_url(self) -> str:
        return normalize_job_url(self.job_url)

    def to_ingest_payload(self) -> dict[str, Any]:
        """Serialise for POST /api/ingest/jobs (snake_case, ISO dates)."""
        return {
            "external_job_id": self.external_job_id,
            "title": self.title,
            "location": self.location,
            "department": self.department,
            "description": self.description,
            "job_url": self.job_url,
            "posted_at": self.posted_at.isoformat() if self.posted_at else None,
            "employment_type": self.employment_type,
            "raw_metadata": self.raw_metadata,
        }


class RawJob(BaseModel):
    """Untouched payload from a source, as returned by an adapter's fetch().

    Kept separate from NormalizedJob so that fetch() (which does I/O) and parse() (which must stay
    pure) have distinct types, making the boundary between them explicit and testable.
    """

    model_config = ConfigDict(extra="allow")

    data: dict[str, Any]
    source_url: str | None = None
