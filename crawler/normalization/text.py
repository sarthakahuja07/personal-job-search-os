"""Description normalization.

Job descriptions arrive as large HTML blobs -- Databricks postings routinely exceed 20 KB. Stored
raw, five of them in one insert exceed D1's 100 KB statement limit, which is what made the first
full crawl fail. They are also worse for matching: the experience parser has to strip tags anyway.

So descriptions are converted to plain text and capped. Nothing downstream needs the markup:
matching reads the requirements, and the UI links to the original posting.
"""

from __future__ import annotations

import html
import re

MAX_DESCRIPTION_CHARS = 8000

_TAG_RE = re.compile(r"<[^>]+>")
_BLOCK_END_RE = re.compile(r"</(p|div|li|h[1-6]|tr|section)\s*>", re.IGNORECASE)
_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_WS_RE = re.compile(r"[ \t\u00a0]+")
_BLANKS_RE = re.compile(r"\n{3,}")


def html_to_text(value: str | None, limit: int = MAX_DESCRIPTION_CHARS) -> str | None:
    """Flatten HTML to readable plain text, then truncate on a word boundary."""
    if not value:
        return None

    text = _BR_RE.sub("\n", value)
    text = _BLOCK_END_RE.sub("\n", text)
    text = _TAG_RE.sub(" ", text)
    # Some feeds double-encode, so unescape twice: &amp;lt;p&amp;gt; -> <p>.
    text = html.unescape(html.unescape(text))
    text = _TAG_RE.sub(" ", text)
    text = _WS_RE.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = _BLANKS_RE.sub("\n\n", text).strip()

    if not text:
        return None
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = cut.rfind(" ")
    if space > limit * 0.8:
        cut = cut[:space]
    return cut.rstrip() + "\u2026"
