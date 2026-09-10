# -*- coding: utf-8 -*-
"""
Pull LinkedIn job mail out of Gmail over IMAP, for building the parser against real messages.

Scoped by construction: it only ever issues Gmail searches restricted to LinkedIn's job-mail
senders, and only downloads what those return. It prints subjects and senders, never bodies,
and never the credential.

Usage:  python fetch_samples.py [--save]
        --save writes .eml files into crawler/tests/samples/ ; without it, nothing is written.

Credentials come from app/.dev.vars (gitignored) or the environment. In production the
crawler reads the same app password from GitHub Secrets; this script exists so samples can
be collected locally without the credential leaving the machine.
"""
import argparse
import email
import email.policy
import imaplib
import io
import os
import re
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
DEV_VARS = os.path.join(HERE, "..", "app", ".dev.vars")

# Every LinkedIn address that carries job mail. Anything outside this list is never fetched.
SENDERS = [
    "jobalerts-noreply@linkedin.com",
    "jobs-noreply@linkedin.com",
    "jobs-listings@linkedin.com",
    "messages-noreply@linkedin.com",
]


def credentials() -> tuple[str, str]:
    """Read from the environment, falling back to app/.dev.vars. Never printed."""
    user = os.environ.get("SMTP_USER") or os.environ.get("IMAP_USER")
    password = os.environ.get("IMAP_APP_PASSWORD")

    path = os.path.abspath(os.environ.get("DEV_VARS_PATH", DEV_VARS))
    if os.path.exists(path):
        for line in io.open(path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            v = v.strip().strip('"').strip("'")
            if k.strip() == "IMAP_APP_PASSWORD" and not password:
                password = v
            if k.strip() in ("SMTP_USER", "IMAP_USER") and not user:
                user = v

    if not user or not password:
        raise SystemExit(
            "Need an address and an app password.\n"
            f"  looked in: {path}\n"
            "  add:       IMAP_APP_PASSWORD=... (and SMTP_USER=... if the address is not there)"
        )
    return user, password


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--save", action="store_true", help="write .eml into crawler/tests/samples/")
    ap.add_argument("--limit", type=int, default=40)
    args = ap.parse_args()

    user, password = credentials()
    print(f"connecting as {user} ...")

    m = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    try:
        m.login(user, password)
    except imaplib.IMAP4.error as e:
        raise SystemExit(f"login refused: {e}\nIs IMAP enabled, and is this an *app* password?")

    # All Mail rather than INBOX: alerts are often filtered straight past the inbox.
    status, _ = m.select('"[Gmail]/All Mail"', readonly=True)
    if status != "OK":
        m.select("INBOX", readonly=True)

    query = " OR ".join(f"from:{s}" for s in SENDERS)
    status, data = m.search(None, "X-GM-RAW", f'"{query}"')
    ids = data[0].split() if status == "OK" and data and data[0] else []
    print(f"{len(ids)} LinkedIn job messages found; inspecting the newest {min(len(ids), args.limit)}\n")

    outdir = os.path.join(HERE, "..", "crawler", "tests", "samples")
    if args.save:
        os.makedirs(outdir, exist_ok=True)

    kinds: Counter[str] = Counter()
    for n, uid in enumerate(reversed(ids[-args.limit:]), 1):
        status, payload = m.fetch(uid, "(RFC822)")
        if status != "OK" or not payload or not isinstance(payload[0], tuple):
            continue
        raw = payload[0][1]
        msg = email.message_from_bytes(raw, policy=email.policy.default)

        sender = str(msg.get("From", ""))
        subject = " ".join(str(msg.get("Subject", "")).split())
        addr = re.search(r"[\w.\-]+@[\w.\-]+", sender)
        addr = addr.group(0) if addr else "?"

        html = next(
            (p.get_content() for p in msg.walk() if p.get_content_type() == "text/html"), ""
        )
        postings = len(set(re.findall(r"/jobs/view/(\d+)", html)))
        kinds[addr] += 1

        print(f"{n:>3}. {str(msg.get('Date'))[:16]}  {addr:<34} jobs={postings:<3} {subject[:58]}")

        if args.save and postings:
            slug = re.sub(r"[^a-z0-9]+", "-", subject.lower()).strip("-")[:60] or f"msg-{n}"
            with io.open(os.path.join(outdir, f"{addr.split('@')[0]}--{slug}.eml"), "wb") as f:
                f.write(raw)

    print("\nby sender:")
    for addr, count in kinds.most_common():
        print(f"  {addr:<36} {count}")
    if args.save:
        print(f"\nsaved into {outdir}")

    m.logout()


if __name__ == "__main__":
    main()
