"""Title-only pre-filter -- the crawler's half of relevance matching.

The rules are NOT defined here. They are served by the app from settings.match_rules so there is
a single source of truth; this module only evaluates them. Full matching (experience, location)
happens server-side at ingest, where the rules live.

This exists purely for cost. NVIDIA lists 2000 roles and about 20 pass the title gate. Fetching
a description for all 2000 would be 2000 requests to find perhaps three matches.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_cache: dict[str, re.Pattern[str]] = {}


def _compile(pattern: str) -> re.Pattern[str]:
    if pattern not in _cache:
        _cache[pattern] = re.compile(pattern, re.IGNORECASE)
    return _cache[pattern]


@dataclass(frozen=True)
class TitleVerdict:
    passed: bool
    score: int
    label: str | None
    excluded_by: str | None


def match_title(title: str, rules: dict[str, Any]) -> TitleVerdict:
    """Mirror of matchTitle() in app/src/server/domain/matching.ts.

    Deliberately lenient relative to the server: this gate only decides whether a job is worth
    a detail fetch. The authoritative decision is made server-side with the full record.
    """
    normalized = re.sub(r"\s+", " ", title).strip().lower()
    title_rules = rules.get("title") or {}

    for pattern in title_rules.get("exclude") or []:
        try:
            if _compile(pattern).search(normalized):
                return TitleVerdict(False, 0, None, pattern)
        except re.error:
            # A rule that will not compile in Python must not take the whole crawl down.
            continue

    best_score = 0
    best_label = None
    for rule in title_rules.get("include") or []:
        try:
            if _compile(rule["pattern"]).search(normalized):
                if rule.get("score", 0) > best_score:
                    best_score = rule["score"]
                    best_label = rule.get("label")
        except (re.error, KeyError):
            continue

    if best_label is None:
        return TitleVerdict(False, 0, None, None)
    return TitleVerdict(True, best_score, best_label, None)
