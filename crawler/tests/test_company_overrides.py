"""The crawler's title pre-filter must know each company's level vocabulary.

This is the half that actually caused the Confluent miss. The server could have accepted
"Senior Software Engineer II - Confluent" all along, but the pre-filter drops jobs before
ingest to avoid a detail fetch per posting -- so a rule only the server knew about would never
have been reached. Both sides read the same served config for exactly this reason.
"""

from __future__ import annotations

import pytest

from crawler.matching import match_title

RULES = {
    "title": {
        "include": [
            {"pattern": r"\bsde\s*(-|–)?\s*(ii|2)\b", "score": 100, "label": "SDE 2"},
            {"pattern": r"\bsoftware\s+engineer\b", "score": 65, "label": "Software Engineer"},
        ],
        "exclude": [r"\bsecurity\b", r"\bsales\b", r"\bsupport\s+engineer\b"],
        "seniorityExclude": [r"\bsenior\b", r"(?<!technical\s)\bstaff\b", r"\bprincipal\b"],
    }
}
CONFLUENT = {"levelTitles": [r"senior software engineer"]}


def test_seniority_blocks_the_title_without_an_override():
    assert match_title("Senior Software Engineer II - Confluent", RULES).passed is False


def test_a_company_override_lifts_the_seniority_rule():
    v = match_title("Senior Software Engineer II - Confluent", RULES, CONFLUENT)
    assert v.passed is True
    assert "senior software engineer" in (v.label or "")


@pytest.mark.parametrize(
    "title",
    [
        "Senior Security Engineer II - Confluent",
        "Senior Sales Engineer - Confluent",
        "Sr. Technical Support Engineer - Confluent",
    ],
)
def test_an_override_never_lifts_a_discipline_exclusion(title):
    """A level override says "this level is mine here", not "any job here"."""
    assert match_title(title, RULES, CONFLUENT).passed is False


@pytest.mark.parametrize(
    "title",
    ["Staff Software Engineer I - Confluent", "Principal Engineer I - Confluent"],
)
def test_levels_the_company_did_not_declare_are_still_rejected(title):
    assert match_title(title, RULES, CONFLUENT).passed is False


def test_overrides_are_inert_when_absent():
    assert match_title("Software Engineer II", RULES, None).passed is True
    assert match_title("Senior Software Engineer", RULES, None).passed is False
    assert match_title("Senior Software Engineer", RULES, {"levelTitles": []}).passed is False


def test_a_malformed_pattern_does_not_break_the_crawl():
    bad = {"levelTitles": ["([unclosed", r"senior software engineer"]}
    assert match_title("Senior Software Engineer", RULES, bad).passed is True


def test_a_stronger_ordinary_include_keeps_its_label():
    v = match_title("SDE 2", RULES, {"levelTitles": [r"sde 2"], "score": 70})
    assert v.score == 100
    assert v.label == "SDE 2"


def test_python_and_typescript_agree_on_the_confluent_case():
    """Mirror of the matching.test.ts case of the same name -- the two evaluators must not
    drift, or the pre-filter and the server will disagree about what is worth ingesting."""
    assert match_title("Senior Software Engineer II - Confluent", RULES, CONFLUENT).passed is True
    assert match_title("Senior Software Engineer II - Confluent", RULES).passed is False
