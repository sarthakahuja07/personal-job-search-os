# -*- coding: utf-8 -*-
"""
An MCP server that lets an assistant publish study notes into the prep tree.

Runs locally, over stdio, launched by whichever MCP client is doing the studying. That is the
whole reason this is safe: the app sits behind Cloudflare Access, and a *local* server can hold
the Access service token and the ingest bearer token the same way the crawler does. Nothing has
to be exposed to the internet for an assistant to write to the board, and no credential ever
leaves this machine (ADR 006).

Four tools, and the split between them is the point:

    prep_tree       where pages can go, and which fields each discipline wants
    prep_search     does this page already exist
    prep_publish    write it
    prep_append     add resources or fill gaps on a page that already exists

Plus three for company preparation, where the pages are generated rather than written:

    company_scaffold        create a company folder and its five pages
    company_question_bank   the table of what this company asks, and how often
    company_question_index  a DSA/HLD/LLD list, linked to the real pages

A write-only tool would have been half the code and would quietly fill the tree with near
duplicates -- "Consistent Hashing", "Consistent hashing", "Design: consistent hashing" -- because
a model with no way to look has no way to know. Search is what makes publish trustworthy.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Literal

import httpx
from mcp.server.mcpserver import MCPServer

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_env() -> dict[str, str]:
    """
    Read the same `.env` the crawler and the export script use.

    Deliberately not a dependency on python-dotenv: this needs four keys out of a file of
    `KEY=value` lines, and the parsing that matters (ignoring comments, stripping quotes) is
    shorter than the import.
    """
    env: dict[str, str] = {}
    path = REPO_ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip("'\"")
    # A real environment variable wins, so a client can override without editing the file.
    for key in ("APP_BASE_URL", "INGEST_TOKEN", "CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"):
        if os.environ.get(key):
            env[key] = os.environ[key]
    return env


ENV = _load_env()
BASE_URL = ENV.get("APP_BASE_URL", "").rstrip("/")
TOKEN = ENV.get("INGEST_TOKEN", "")

if not BASE_URL or not TOKEN:
    # Fail loudly at startup rather than on the first tool call. An MCP client reports a server
    # that died with a message; it cannot show you a tool that silently 401s every time.
    print(
        "prep-publisher: APP_BASE_URL and INGEST_TOKEN must be set in .env at the repo root.",
        file=sys.stderr,
    )
    raise SystemExit(1)


def _headers() -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
    }
    # Access sits in front of the Worker; without these the request never reaches the app and
    # comes back as a login redirect rather than a 401, which is a confusing thing to debug.
    client_id = ENV.get("CF_ACCESS_CLIENT_ID")
    client_secret = ENV.get("CF_ACCESS_CLIENT_SECRET")
    if client_id and client_secret:
        headers["CF-Access-Client-Id"] = client_id
        headers["CF-Access-Client-Secret"] = client_secret
    return headers


async def _request(method: str, path: str, **kwargs: Any) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.request(
            method, f"{BASE_URL}{path}", headers=_headers(), **kwargs
        )
    if response.status_code >= 400:
        try:
            detail = response.json().get("error", {})
        except Exception:
            detail = {"message": response.text[:400]}
        # Hand the app's own message back rather than a status code. These messages are written
        # to be actionable ("publish with on_conflict merge"), and the model is the one who has
        # to act on them.
        return {
            "ok": False,
            "status": response.status_code,
            "error": detail.get("message") or detail.get("code") or "request failed",
            "details": detail.get("details"),
        }
    return {"ok": True, **response.json()}


# mcp 2.x renamed FastMCP to MCPServer; the decorator and stdio transport are unchanged.
server = MCPServer("prep-publisher")


@server.tool()
async def prep_tree() -> dict[str, Any]:
    """
    List where a page can be published and what each discipline expects.

    Call this before publishing for the first time in a session. It returns the available
    `kind` values, the structured `content` fields each one uses, and every existing folder
    with the `parent_path` needed to publish into it.
    """
    return await _request("GET", "/api/prep/tree")


@server.tool()
async def prep_search(query: str, kind: str | None = None) -> dict[str, Any]:
    """
    Find existing pages by title or prompt, to avoid creating a duplicate.

    Always call this before prep_publish. If a close match comes back, prefer prep_append over
    publishing a second page on the same topic.

    Args:
        query: Free text, matched against page titles and prompts.
        kind: Optionally narrow to one of dsa, system_design, behavioral, concept.
    """
    params: dict[str, str] = {"q": query}
    if kind:
        params["kind"] = kind
    return await _request("GET", "/api/prep/pages", params=params)


@server.tool()
async def prep_publish(
    kind: Literal["dsa", "system_design", "behavioral", "concept", "company"],
    title: str,
    body: str | None = None,
    prompt: str | None = None,
    parent_path: str = "",
    difficulty: Literal["easy", "medium", "hard"] | None = None,
    frequency: int = 0,
    topics: list[str] | None = None,
    companies: list[str] | None = None,
    resources: list[dict[str, str]] | None = None,
    pattern: str | None = None,
    complexity: str | None = None,
    approach: str | None = None,
    requirements: str | None = None,
    architecture: str | None = None,
    tradeoffs: str | None = None,
    situation: str | None = None,
    action: str | None = None,
    outcome: str | None = None,
    source_url: str | None = None,
    on_conflict: Literal["error", "merge", "replace"] = "error",
) -> dict[str, Any]:
    """
    Publish a study page into the prep tree, with its notes and reference links.

    Fill in as much as the session actually established. A page with only a title cannot be
    revised from and will sort last; difficulty, frequency and topics are the fields that make
    it findable later, and they are things you know at the end of a session that a human would
    never type by hand.

    Args:
        kind: Discipline. Low-level design is `system_design` published under parent_path "lld".
        title: The page name, e.g. "Design a Rate Limiter".
        body: The note itself, as Markdown. This is the main content.
        prompt: The question or brief, shown under the title.
        parent_path: Folder path within the kind, e.g. "hld" or "hld/questions". From prep_tree.
        difficulty: easy, medium or hard.
        frequency: The "ask score", 1-5 -- how often this comes up in interviews. Drives sort
            order, so 0 makes the page effectively invisible. Set it.
        topics: Tags such as ["caching", "distributed-systems"].
        companies: Companies known to ask this.
        resources: Reference links, as [{"url": "...", "title": "..."}]. YouTube links are
            detected and stored as videos with their id extracted automatically. Always give a
            video a title -- a YouTube URL has nothing readable in its path, so an omitted one
            derives the literal word "Watch". For articles the title and publisher are derived
            from the URL well enough to omit.
        pattern, complexity, approach: DSA fields.
        requirements, architecture, tradeoffs: System design fields.
        situation, action, outcome: Behavioral fields.
        source_url: Where this was studied from.
        on_conflict: What to do if the page exists. "error" (default) refuses, "merge" fills
            only empty fields and adds resources, "replace" overwrites.
    """
    payload: dict[str, Any] = {
        "kind": kind,
        "title": title,
        "prompt": prompt,
        "parent_path": parent_path,
        "difficulty": difficulty,
        "frequency": frequency,
        "topics": topics or [],
        "companies": companies or [],
        "body": body,
        "resources": resources or [],
        "source_url": source_url,
        "on_conflict": on_conflict,
        "content": {
            "pattern": pattern,
            "complexity": complexity,
            "approach": approach,
            "requirements": requirements,
            "architecture": architecture,
            "tradeoffs": tradeoffs,
            "situation": situation,
            "action": action,
            "outcome": outcome,
        },
    }
    return await _request("POST", "/api/prep/pages", json=payload)


@server.tool()
async def prep_append(
    kind: Literal["dsa", "system_design", "behavioral", "concept", "company"],
    title: str,
    parent_path: str = "",
    body: str | None = None,
    resources: list[dict[str, str]] | None = None,
    topics: list[str] | None = None,
    companies: list[str] | None = None,
    difficulty: Literal["easy", "medium", "hard"] | None = None,
    frequency: int = 0,
) -> dict[str, Any]:
    """
    Add to a page that already exists, without overwriting what is there.

    Use this when prep_search finds the topic already covered. Resources are always added;
    every other field is filled only where the page is currently empty, so a note written by
    hand is never replaced by a second pass over the same topic.

    Args:
        kind: Discipline of the existing page.
        title: Its exact title -- this is what identifies the page, via its slug.
        parent_path: The folder it lives in.
        body: Used only if the page has no body yet.
        resources: Links to add, as [{"url": "...", "title": "..."}]. Duplicates of links
            already present are ignored. Give videos a title; a YouTube URL derives "Watch".
        topics: Merged with the existing tags.
        companies: Merged with the existing list.
        difficulty: Used only if unset.
        frequency: Used only if currently 0.
    """
    payload: dict[str, Any] = {
        "kind": kind,
        "title": title,
        "parent_path": parent_path,
        "body": body,
        "resources": resources or [],
        "topics": topics or [],
        "companies": companies or [],
        "difficulty": difficulty,
        "frequency": frequency,
        "on_conflict": "merge",
    }
    return await _request("POST", "/api/prep/pages", json=payload)


@server.tool()
async def company_scaffold(name: str) -> dict[str, Any]:
    """
    Create a company's prep folder and its five pages.

    The pages are always Notes, Question Bank, DSA, HLD and LLD, so every company reads the
    same way. Safe to call again -- pages that already exist are left untouched. Call this
    before any other company tool.

    Args:
        name: The company, e.g. "Amazon".
    """
    return await _request("POST", "/api/prep/company", json={"op": "scaffold", "name": name})


@server.tool()
async def company_question_bank(
    company: str,
    entries: list[dict[str, Any]],
    mode: Literal["merge", "replace"] = "merge",
) -> dict[str, Any]:
    """
    Add questions to a company's Question Bank: a table per discipline of what it asks.

    Questions that already have a page are linked automatically -- pass names, not URLs.

    Adds by default, so you can record this company's HLD questions now and its LLD or DSA
    questions weeks later without resending the first lot. A question reported again keeps the
    later "last asked" date and takes the newer rating.

    Args:
        company: The company, which must already have been scaffolded.
        entries: [{"question": str, "discipline": "dsa"|"hld"|"lld",
                   "frequency": 0-5, "last_asked": "YYYY-MM-DD"}].
            frequency is how often this company asks it and drives the sort; last_asked is when
            it was most recently seen.
        mode: "merge" (default) adds to what is already recorded. "replace" discards every
            existing question, so use it only to rebuild a bank from scratch.
    """
    return await _request(
        "POST",
        "/api/prep/company",
        json={"op": "question_bank", "company": company, "entries": entries, "mode": mode},
    )


@server.tool()
async def company_question_index(
    company: str,
    discipline: Literal["dsa", "hld", "lld"],
    questions: list[dict[str, Any]],
    mode: Literal["merge", "replace"] = "merge",
) -> dict[str, Any]:
    """
    Add questions to one of a company's index pages: DSA, HLD or LLD, linked to real pages.

    Titles are resolved against the actual tree server-side, so pass names rather than URLs --
    "Design a rate limiter" will find a page called "Rate Limiter". Questions with no page yet
    are kept under "Not written yet" and returned in `unlinked`; that list is what to study
    next, which is why they are never silently dropped.

    Adds by default, so a later session need not resend what is already on the page.

    Args:
        company: The company, which must already have been scaffolded.
        discipline: Which index to write -- dsa, hld or lld.
        questions: [{"title": str, "frequency": 0-5, "last_asked": "YYYY-MM-DD"}].
        mode: "merge" (default) adds to what is there. "replace" discards it.
    """
    return await _request(
        "POST",
        "/api/prep/company",
        json={
            "op": "question_index",
            "company": company,
            "discipline": discipline,
            "questions": questions,
            "mode": mode,
        },
    )


if __name__ == "__main__":
    server.run()
