# -*- coding: utf-8 -*-
"""
The LinkedIn mail parser, against real messages.

The fixtures are actual alert and recommendation mail, scrubbed of the recipient's name,
address and every tracking parameter, then checked to parse identically to the original. They
are here rather than hand-written for the same reason the adapters use recorded cassettes: a
parser written against imagined markup is exactly how a source returns zero jobs, successfully,
forever.
"""
from __future__ import annotations

import re
from email.message import EmailMessage
from pathlib import Path

import pytest

from crawler.linkedin.parser import (
    LinkedInPosting,
    classify_feed,
    parse_message,
    parse_messages,
    search_term,
)

FIXTURES = Path(__file__).parent / "fixtures" / "linkedin"

#: filename -> (postings it contains, which feed it is)
CASES = {
    "recommended.eml": (6, "recommended"),
    "saved-search.eml": (6, "search"),
    "alert-digest.eml": (8, "search"),
}


def load(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def all_postings() -> list[LinkedInPosting]:
    return parse_messages(load(n) for n in CASES)


@pytest.mark.parametrize("name,expected", [(n, c) for n, (c, _) in CASES.items()])
def test_finds_every_posting(name: str, expected: int) -> None:
    assert len(parse_message(load(name))) == expected


@pytest.mark.parametrize("name,feed", [(n, f) for n, (_, f) in CASES.items()])
def test_classifies_the_feed(name: str, feed: str) -> None:
    # An alert is a search Sarthak wrote; a recommendation is LinkedIn's opinion of him. They
    # answer different questions and are shown separately, so the distinction is not flattened.
    assert {p.feed for p in parse_message(load(name))} == {feed}


@pytest.mark.parametrize("name", list(CASES))
def test_every_posting_is_usable(name: str) -> None:
    for p in parse_message(load(name)):
        assert p.linkedin_job_id.isdigit(), p
        assert p.title.strip()
        assert p.company_name.strip()
        assert p.job_url.startswith("https://www.linkedin.com/jobs/view/")
        assert p.linkedin_job_id in p.job_url


@pytest.mark.parametrize("name", list(CASES))
def test_ids_are_stable_across_runs(name: str) -> None:
    # An unstable id re-notifies about the same job every twelve hours until the digest is
    # ignored entirely. This is the single most important property in the file.
    raw = load(name)
    assert [p.linkedin_job_id for p in parse_message(raw)] == [
        p.linkedin_job_id for p in parse_message(raw)
    ]


@pytest.mark.parametrize("name", list(CASES))
def test_parsing_is_deterministic(name: str) -> None:
    raw = load(name)
    assert parse_message(raw) == parse_message(raw)


@pytest.mark.parametrize("name", list(CASES))
def test_titles_never_carry_the_summary_tail(name: str) -> None:
    # Some cards link the job only once, wrapping the whole summary, so the title arrives as
    # "Software Engineer Flipkart · Bengaluru (On-site)". 13 of 239 real postings did this.
    for p in parse_message(load(name)):
        assert "·" not in p.title, p.title
        assert not p.title.endswith(p.company_name), p.title


@pytest.mark.parametrize("name", list(CASES))
def test_no_html_leaks_into_fields(name: str) -> None:
    for p in parse_message(load(name)):
        for field in (p.title, p.company_name, p.location or ""):
            assert "<" not in field and "&nbsp;" not in field, field


def test_saved_search_names_itself() -> None:
    postings = parse_message(load("saved-search.eml"))
    assert {p.search_term for p in postings} == {"backend engineer"}


def test_other_mail_has_no_search_term() -> None:
    assert all(p.search_term is None for p in parse_message(load("recommended.eml")))


def test_locations_and_work_modes_are_split() -> None:
    postings = all_postings()
    modes = {p.work_mode for p in postings}
    assert modes <= {None, "on-site", "hybrid", "remote"}
    # The mode is parenthesised onto the location and must not be left glued to the city.
    for p in postings:
        assert "(" not in (p.location or ""), p.location


def test_badges_are_not_mistaken_for_places() -> None:
    for p in all_postings():
        assert not re.search(
            r"(?i)actively recruiting|easy apply|alum|connections? work here", p.location or ""
        ), p.location


def test_the_same_posting_in_two_messages_is_collapsed() -> None:
    once = parse_messages([load("alert-digest.eml")])
    twice = parse_messages([load("alert-digest.eml"), load("alert-digest.eml")])
    assert [p.linkedin_job_id for p in once] == [p.linkedin_job_id for p in twice]


def test_reads_a_whole_mailbox() -> None:
    postings = all_postings()
    ids = [p.linkedin_job_id for p in postings]
    assert len(ids) == len(set(ids))
    assert len(postings) <= sum(c for c, _ in CASES.values())


class TestNonJobMail:
    """A mailbox holds all sorts of things; none of it is an error."""

    def _message(self, sender: str) -> bytes:
        m = EmailMessage()
        m["From"] = sender
        m["Subject"] = "Welcome to Premium!"
        m.set_content("hello")
        m.add_alternative("<p>hello</p>", subtype="html")
        return m.as_bytes()

    def test_account_mail_is_ignored_entirely(self) -> None:
        # messages-noreply carries Premium welcomes and connection nudges, never a job.
        assert parse_message(self._message("LinkedIn <messages-noreply@linkedin.com>")) == []

    def test_mail_from_anyone_else_is_ignored(self) -> None:
        assert parse_message(self._message("A Person <someone@example.com>")) == []

    def test_unparseable_bytes_do_not_raise(self) -> None:
        assert parse_message(b"not an email at all") == []


class TestFeedClassification:
    @pytest.mark.parametrize(
        "header,expected",
        [
            ("LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", "search"),
            ("LinkedIn <jobs-noreply@linkedin.com>", "recommended"),
            ("LinkedIn <jobs-listings@linkedin.com>", "recommended"),
            ("LinkedIn <JOBALERTS-NOREPLY@LINKEDIN.COM>", "search"),
            ("LinkedIn <messages-noreply@linkedin.com>", None),
            ("", None),
        ],
    )
    def test_by_sender(self, header: str, expected: str | None) -> None:
        assert classify_feed(header) == expected


class TestSearchTerm:
    @pytest.mark.parametrize(
        "subject,expected",
        [
            ('“software development engineer ii”: Google - Software Engineer', "software development engineer ii"),
            ('"sde 2": Fam - SDE 2- Platform Engineering', "sde 2"),
            ("Amazon - Software Development Engineer and more", None),
            ("Recipient: your job alert for Software Engineer II in India", None),
            ("", None),
        ],
    )
    def test_from_subject(self, subject: str, expected: str | None) -> None:
        assert search_term(subject) == expected
