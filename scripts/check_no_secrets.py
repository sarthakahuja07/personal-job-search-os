"""Fail the build if credentials or personal contact details reach tracked files.

Written after a real miss: a referral contact's phone number was used as a test fixture and
committed. It was caught by an ad-hoc grep that printed a warning and then let the commit
through — a guard that does not halt is worse than no guard, because it manufactures confidence.

Two classes of finding, both hard failures:

  credentials  Cloudflare, GitHub and AWS token prefixes, and private keys.
  contacts     Phone-shaped strings in source. Cassettes and lockfiles are excluded: they hold
               public job-board data where long digit runs are ordinary.

Reserved example ranges are allowed, so tests can still exercise phone handling honestly.

    python scripts/check_no_secrets.py
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

CREDENTIALS: list[tuple[str, re.Pattern[str]]] = [
    ("Cloudflare API token", re.compile(r"\bcfut_[A-Za-z0-9]{20,}")),
    ("Cloudflare Access secret", re.compile(r"\bcfast_[A-Za-z0-9]{20,}")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
]

# Deliberately requires phone *shape*, not merely a run of digits: either a leading +country
# code, or internal separators. A bare 10-digit run is far more often an identifier -- Greenhouse
# job ids look exactly like Indian mobile numbers -- and a check that cries wolf gets ignored,
# which is how the original slip happened.
PHONE = re.compile(
    r"""(?<![\w/])(?:
        \+\d{1,3}[\s.\-()]*\d[\d\s.\-()]{7,16}\d     # +91 98765 43210, +1 (202) 555-0143
      | \d{3,5}[\s.\-][\d\s.\-]{5,14}\d              # 98765 43210, 702-934-2659
    )(?![\w/])""",
    re.VERBOSE,
)

# Reserved-for-documentation ranges. Tests may use these freely.
ALLOWED_PHONE_FRAGMENTS = (
    "9876543210",   # the standard Indian example number
    "1234567890",
    "2025550",      # US 555 reserved block
    "5555555",
    "0000000",
    "1111111",
)

# Extensions worth scanning for phone numbers. Cassettes are recorded public job data, and
# lockfiles are full of long hashes.
SOURCE_SUFFIXES = {".ts", ".tsx", ".py", ".md", ".json", ".yml", ".yaml", ".sql"}
PHONE_EXCLUDE_PARTS = (
    "tests/cassettes/",
    "package-lock.json",
    "migrations/meta/",
    "worker-configuration.d.ts",
    ".venv/",
    "node_modules/",
)


def tracked_files() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files"], capture_output=True, text=True, check=True
    ).stdout
    return [Path(line) for line in out.splitlines() if line.strip()]


def looks_allowed(candidate: str) -> bool:
    digits = re.sub(r"\D", "", candidate)
    return any(frag in digits for frag in ALLOWED_PHONE_FRAGMENTS)


def main() -> int:
    findings: list[str] = []

    for path in tracked_files():
        if not path.exists() or path.suffix not in SOURCE_SUFFIXES:
            continue
        posix = path.as_posix()
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        for label, pattern in CREDENTIALS:
            for match in pattern.finditer(text):
                line = text[: match.start()].count("\n") + 1
                findings.append(f"  {posix}:{line}  {label}")

        if any(part in posix for part in PHONE_EXCLUDE_PARTS):
            continue

        for match in PHONE.finditer(text):
            candidate = match.group(0)
            digits = re.sub(r"\D", "", candidate)
            # Ten to thirteen digits is the phone-shaped band. Shorter is a version or a port,
            # longer is a hash or a timestamp.
            if not (10 <= len(digits) <= 13) or looks_allowed(candidate):
                continue
            line = text[: match.start()].count("\n") + 1
            findings.append(f"  {posix}:{line}  phone-shaped: {candidate.strip()}")

    if findings:
        print("Refusing: credentials or personal data found in tracked files.\n")
        for f in sorted(set(findings)):
            print(f)
        print(
            "\nContact details belong in the database, never the repository. "
            "Tests should use reserved example numbers such as +91 98765 43210."
        )
        return 1

    print("No credentials or personal contact details in tracked files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
