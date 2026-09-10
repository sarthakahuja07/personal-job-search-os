# -*- coding: utf-8 -*-
"""
Reading LinkedIn job mail.

LinkedIn cannot be crawled -- their robots.txt says so in the preamble, /jobs-guest/ is
disallowed for every named bot, and the User Agreement forbids scraping outright. The two
personalised feeds are authenticated-only besides, so fetching them would mean a robot wearing
Sarthak's session, against the account every referral in this project runs through.

But LinkedIn *sends* him these jobs. Alert mail and recommendation mail arrive in his Gmail,
and reading mail addressed to you is not scraping. That is the whole source.

This module is pure: bytes in, postings out. No network, no clock, no I/O -- the same property
the adapters have, and for the same reason. Every rule here was checked against 239 postings in
34 real messages before being written down.
"""
from __future__ import annotations

import email
import email.message
import email.policy
import re
from dataclasses import dataclass
from typing import Iterable, Literal

from bs4 import BeautifulSoup, Tag

Feed = Literal["search", "recommended"]

#: LinkedIn separates company from location with U+00B7, never a hyphen or a pipe.
DOT = "·"

#: Senders that carry postings. `messages-noreply` also exists but only sends account mail --
#: a Premium welcome, connection nudges -- and never contains a job, so it is not read at all.
ALERT_SENDER = "jobalerts-noreply@linkedin.com"
RECOMMENDED_SENDERS = ("jobs-noreply@linkedin.com", "jobs-listings@linkedin.com")

_JOB_ID = re.compile(r"/jobs/view/(\d+)")

#: Social proof and apply hints trail the location. None of it is part of the place.
_BADGES = re.compile(
    r"(actively recruiting|be an early applicant|easy apply|promoted|viewed"
    r"|\d+\s+connections?\s+work\s+here|\d+\s+(?:company\s+)?alum\w*|company alum)",
    re.I,
)

#: How the role is worked, which LinkedIn parenthesises onto the end of the location.
_MODE = re.compile(r"\((on-site|onsite|hybrid|remote)\)", re.I)

#: A saved search names itself in the subject, in curly or straight quotes:
#:     “software development engineer ii”: Google - Software Engineer III ...
_QUOTED_TERM = re.compile(r'^[“"]([^”"]+)[”"]\s*:')


@dataclass(frozen=True)
class LinkedInPosting:
    """One opening, exactly as an email described it."""

    linkedin_job_id: str
    company_name: str
    title: str
    location: str | None
    work_mode: str | None
    job_url: str
    feed: Feed
    search_term: str | None

    @property
    def external_job_id(self) -> str:
        """LinkedIn's own posting id. Never synthesised -- see ADR 005."""
        return self.linkedin_job_id


def classify_feed(from_header: str) -> Feed | None:
    """
    Which of Sarthak's feeds this message is.

    `jobalerts-noreply` is a saved search of his own; `jobs-noreply` is LinkedIn deciding what
    matches his profile. They are different questions and get different sections in the UI, so
    the distinction is kept rather than flattened into "from LinkedIn".

    Returns None for anything else, which is the guard that stops account mail being parsed.
    """
    addr = from_header.lower()
    if ALERT_SENDER in addr:
        return "search"
    if any(s in addr for s in RECOMMENDED_SENDERS):
        return "recommended"
    return None


def search_term(subject: str) -> str | None:
    """The saved search that fired, when the subject names it."""
    m = _QUOTED_TERM.match(subject.strip())
    return m.group(1).strip().lower() if m else None


def _html_part(msg: email.message.Message) -> str:
    for part in msg.walk():
        if part.get_content_type() == "text/html":
            content = part.get_content()
            return content if isinstance(content, str) else ""
    return ""


def _meta_near(anchor: Tag) -> str:
    """
    The `Company · Location` line belonging to a posting.

    It is a sibling `<p>` inside the card, but the exact nesting shifts between templates, so
    this widens from the anchor's row outwards rather than hard-coding a path. Four levels is
    enough for every template seen; beyond that a match would more likely be the next card's.
    """
    scope: Tag | None = anchor.find_parent("tr")
    for _ in range(4):
        if scope is None:
            return ""
        for p in scope.find_all("p"):
            text = p.get_text(" ", strip=True)
            if DOT in text:
                return text
        scope = scope.parent
    return ""


def _split_meta(meta: str) -> tuple[str, str | None, str | None]:
    """`Company · Bengaluru (Hybrid) Actively recruiting` -> company, location, work mode."""
    company, _, rest = meta.partition(DOT)
    rest = _BADGES.sub("", rest).strip(f" {DOT}|,")
    mode = _MODE.search(rest)
    location = _MODE.sub("", rest).strip(" ,")
    return company.strip(), (location or None), (mode.group(1).lower() if mode else None)


def _clean_title(title: str, company: str) -> str:
    """
    Cut the summary tail off a title.

    Most cards carry two links: a combined one for the whole card and a bare one for the title.
    Some carry only the combined one, and then the "title" arrives as
    `Software Engineer Flipkart · Bengaluru (On-site)`. Cutting at the company name recovers it.

    The company is searched from the right because it can legitimately appear inside the role --
    `Software Development Engineer II, Amazon Payments Amazon · Bengaluru` -- and only the last
    occurrence is the glued-on summary. 13 of 239 real postings needed this.
    """
    idx = title.rfind(f"{company} {DOT}")
    if idx <= 0:
        idx = title.rfind(f"{company}{DOT}")
    if idx > 0:
        title = title[:idx]
    return title.strip(f" {DOT}|,-")


def parse_message(raw: bytes) -> list[LinkedInPosting]:
    """
    Every posting in one message, in the order LinkedIn listed them.

    Returns an empty list for mail that is not a job feed, rather than raising: a mailbox
    contains all sorts of things and a non-job message is not an error.
    """
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    feed = classify_feed(str(msg.get("From", "")))
    if feed is None:
        return []

    html = _html_part(msg)
    if not html:
        return []

    term = search_term(str(msg.get("Subject", "")))
    soup = BeautifulSoup(html, "html.parser")

    # Keep the shortest non-empty anchor text per posting: a card links the same job twice, once
    # wrapping the whole summary and once wrapping just the title, and the title is the shorter.
    best: dict[str, tuple[str, Tag]] = {}
    for anchor in soup.find_all("a", href=True):
        m = _JOB_ID.search(anchor["href"])
        if not m:
            continue
        text = anchor.get_text(" ", strip=True)
        if not text:
            continue
        job_id = m.group(1)
        if job_id not in best or len(text) < len(best[job_id][0]):
            best[job_id] = (text, anchor)

    out: list[LinkedInPosting] = []
    for job_id, (text, anchor) in best.items():
        company, location, work_mode = _split_meta(_meta_near(anchor))
        if not company:
            # Without an employer the posting cannot be routed to a company or a lead, and a
            # lead keyed on an empty name is worse than no lead.
            continue
        title = _clean_title(text, company)
        if not title:
            continue
        out.append(
            LinkedInPosting(
                linkedin_job_id=job_id,
                company_name=company,
                title=title,
                location=location,
                work_mode=work_mode,
                job_url=f"https://www.linkedin.com/jobs/view/{job_id}/",
                feed=feed,
                search_term=term,
            )
        )
    return out


def parse_messages(messages: Iterable[bytes]) -> list[LinkedInPosting]:
    """
    Every posting across a mailbox's worth of messages, deduplicated.

    The same opening turns up in several alerts and again the next day; in a real sample 239
    postings across 34 messages were 153 distinct ones. Collapsing here means the rest of the
    pipeline never sees the repetition. First sighting wins, so the feed recorded is the one
    that surfaced it first.
    """
    seen: set[str] = set()
    out: list[LinkedInPosting] = []
    for raw in messages:
        for posting in parse_message(raw):
            if posting.linkedin_job_id in seen:
                continue
            seen.add(posting.linkedin_job_id)
            out.append(posting)
    return out
