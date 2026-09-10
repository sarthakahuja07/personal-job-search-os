# -*- coding: utf-8 -*-
"""
Reading LinkedIn's job mail out of Gmail.

The narrowing is in this file, not in the credential: Google cannot scope an app password to a
label, so every request issued here is restricted to LinkedIn's job senders and a recent time
window, and the mailbox is opened read-only. Nothing else is ever fetched, and nothing is ever
marked, moved or deleted.
"""
from __future__ import annotations

import imaplib
import os
from contextlib import contextmanager
from typing import Iterator

import structlog

log = structlog.get_logger(__name__)

IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993

#: Only senders that carry postings. `messages-noreply` sends account mail -- Premium welcomes,
#: connection nudges -- and never a job, so it is outside the search entirely.
SENDERS = (
    "jobalerts-noreply@linkedin.com",
    "jobs-noreply@linkedin.com",
    "jobs-listings@linkedin.com",
)


class InboxError(RuntimeError):
    """Raised when the mailbox cannot be read at all, as opposed to being empty."""


def credentials() -> tuple[str, str]:
    user = os.environ.get("IMAP_USER") or os.environ.get("SMTP_USER") or ""
    password = os.environ.get("IMAP_APP_PASSWORD") or ""
    if not user or not password:
        raise InboxError("IMAP_APP_PASSWORD and SMTP_USER (or IMAP_USER) must be set")
    return user, password


@contextmanager
def _mailbox() -> Iterator[imaplib.IMAP4_SSL]:
    user, password = credentials()
    client = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    try:
        try:
            client.login(user, password)
        except imaplib.IMAP4.error as exc:
            # Gmail's message here is unhelpful on purpose; say what actually causes it.
            raise InboxError(
                f"IMAP login refused ({exc}). Check that IMAP is enabled in Gmail and that "
                "IMAP_APP_PASSWORD is an app password, not the account password."
            ) from exc

        # All Mail rather than INBOX: alerts are commonly filtered straight past the inbox, and
        # a filter Sarthak adds later must not silently empty this source.
        status, _ = client.select('"[Gmail]/All Mail"', readonly=True)
        if status != "OK":
            status, _ = client.select("INBOX", readonly=True)
            if status != "OK":
                raise InboxError("could not open a mailbox to read")
        yield client
    finally:
        try:
            client.logout()
        except Exception:  # noqa: BLE001 - logout failure must not mask a real error
            pass


def fetch_recent(days: int = 7, limit: int = 60) -> list[bytes]:
    """
    Raw messages from LinkedIn's job senders in the last `days`.

    The window is deliberately wider than the twelve-hour crawl cadence. Ingest is idempotent --
    a posting already seen resolves to nothing -- so re-reading a few days of mail costs a
    little parsing and buys immunity to a missed run, a delayed delivery, or a crawl that failed
    overnight. Reading only since the last run would turn one skipped crawl into a permanent
    hole in the board.
    """
    query = " OR ".join(f"from:{s}" for s in SENDERS)
    with _mailbox() as client:
        status, data = client.search(None, "X-GM-RAW", f'"({query}) newer_than:{days}d"')
        if status != "OK":
            raise InboxError(f"mailbox search failed: {status}")

        ids = data[0].split() if data and data[0] else []
        log.info("linkedin.inbox.searched", messages=len(ids), days=days)

        out: list[bytes] = []
        for uid in reversed(ids[-limit:]):
            status, payload = client.fetch(uid, "(RFC822)")
            if status != "OK" or not payload:
                continue
            for part in payload:
                if isinstance(part, tuple) and part[1]:
                    out.append(part[1])
                    break
        return out
