"""The adapter contract.

Adapters fetch, parse and normalize -- nothing else (PRD §15). No deduplication, no relevance
decisions, no notifications, no database access. That purity is what lets the conformance suite
apply the same assertions to every adapter, and it is not negotiable.

Two-phase fetching exists because of a real cost difference:

  fetch_list    cheap, paginated, returns every posting the source exposes
  fetch_detail  optional, one request per job, only for postings that survive the title filter

NVIDIA lists 2000 roles of which roughly 20 pass the title gate. Fetching a description for all
2000 would be 2000 requests to find perhaps three matches. Adapters whose list response already
carries the description (Greenhouse, Lever) simply do not implement fetch_detail.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from crawler.http.client import CrawlBudget, HttpClient
from crawler.models.job import NormalizedJob, RawJob


class SchemaDriftError(RuntimeError):
    """An upstream response no longer contains a field the adapter depends on.

    Raised in production, not only in tests. Undocumented endpoints reshape without notice, and
    a silently missing field is exactly the failure mode that makes a crawler return nothing
    while reporting success.
    """


class ConfigError(ValueError):
    """The stored source_config cannot drive this adapter."""


class JobSourceAdapter(ABC):
    """One per source platform. Registered in registry.py, which subjects it to the
    conformance suite automatically."""

    #: Matches companies.source_type in the database.
    source_type: str = ""

    #: Stability tier, 1 (public ATS feed) .. 5 (HTML). See docs/crawlers.md.
    tier: int = 3

    # -- configuration ----------------------------------------------------

    @staticmethod
    def detect(url: str) -> dict[str, Any] | None:
        """Claim a careers URL and extract config from it.

        Pure: regex only, no network. Returns None if this adapter cannot handle the URL.
        """
        return None

    @abstractmethod
    def validate_config(self, config: dict[str, Any]) -> list[str]:
        """Human-readable errors, checked before a company is saved. Empty list means valid."""

    # -- fetching ---------------------------------------------------------

    @abstractmethod
    async def fetch_list(
        self,
        config: dict[str, Any],
        client: HttpClient,
        budget: CrawlBudget,
    ) -> list[RawJob]:
        """Every posting the source exposes, paginated. The only place network I/O happens."""

    async def fetch_detail(
        self,
        raw: RawJob,
        config: dict[str, Any],
        client: HttpClient,
        budget: CrawlBudget,
    ) -> RawJob:
        """Enrich one posting with its description and real posting date.

        Default: the list response was already complete. Override only when it is not.
        """
        return raw

    @property
    def needs_detail_fetch(self) -> bool:
        return type(self).fetch_detail is not JobSourceAdapter.fetch_detail

    # -- parsing ----------------------------------------------------------

    @abstractmethod
    def parse(self, raw: RawJob) -> NormalizedJob:
        """PURE. No network, no clock, no randomness.

        The conformance suite asserts this by running it with the network patched out and
        checking that two runs over the same cassette produce byte-identical output.
        """

    # -- helpers for subclasses -------------------------------------------

    @staticmethod
    def require(data: dict[str, Any], *fields: str) -> None:
        """Assert the response still carries the fields this adapter depends on."""
        missing = [f for f in fields if f not in data]
        if missing:
            raise SchemaDriftError(
                f"response is missing required field(s): {', '.join(missing)}"
            )

    def title_of(self, raw: RawJob) -> str:
        """Cheap title extraction for the pre-filter, without full parsing."""
        return self.parse(raw).title
