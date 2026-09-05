"""Adapter registry.

Registering an adapter here is what subjects it to the conformance suite -- the suite is
parametrized over this mapping, so a new adapter inherits every invariant automatically.
That is the mechanism behind "tested for every new company".
"""

from __future__ import annotations

from typing import Any

from crawler.adapters.ashby import AshbyAdapter
from crawler.adapters.base import JobSourceAdapter
from crawler.adapters.greenhouse import GreenhouseAdapter
from crawler.adapters.lever import LeverAdapter
from crawler.adapters.smartrecruiters import SmartRecruitersAdapter
from crawler.adapters.workday import WorkdayAdapter

ADAPTERS: dict[str, JobSourceAdapter] = {
    a.source_type: a
    for a in (
        GreenhouseAdapter(),
        LeverAdapter(),
        AshbyAdapter(),
        SmartRecruitersAdapter(),
        WorkdayAdapter(),
    )
}

# Most specific first: a Workday URL must not be claimed by a looser pattern.
_DETECT_ORDER = ("workday", "greenhouse", "lever", "ashby", "smartrecruiters")


def get_adapter(source_type: str) -> JobSourceAdapter | None:
    return ADAPTERS.get(source_type)


def detect(url: str) -> tuple[str, dict[str, Any]] | None:
    """Identify which adapter can handle a careers URL, and extract its config.

    Pure regex, no network -- which is why tiers 1 and 2 can be resolved offline.
    """
    for source_type in _DETECT_ORDER:
        adapter = ADAPTERS[source_type]
        config = adapter.detect(url)
        if config:
            return source_type, config
    return None
