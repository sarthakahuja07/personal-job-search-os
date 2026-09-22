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
    prep_append     add resources or fill gaps on a page that already exists

One publishing tool per discipline, rather than one with a `kind` argument:

    publish_dsa_question       coding problems
    publish_hld_design         distributed system architecture
    publish_lld_design         object-oriented design within one service
    publish_lld_solution       a *worked* LLD answer: sections plus the code, as files
    publish_behavioral_story   experience questions
    publish_page               an explicit kind and section; the escape hatch

The split exists because the generic tool asked the model to get two things right at once --
`kind`, and a `parent_path` that does not follow from it. Low-level design exposes it: there is
no `kind: "lld"`, it is `system_design` filed under `lld`, so the commonest mistake was the one
a description could not prevent, the tool having already been chosen before it was read.

Plus three for company preparation, where the pages are generated rather than written:

    company_scaffold        create a company folder and its five pages
    company_question_bank   the table of what this company asks, and how often
    company_question_index  a DSA/HLD/LLD list, linked to the real pages

A write-only tool would have been half the code and would quietly fill the tree with near
duplicates -- "Consistent Hashing", "Consistent hashing", "Design: consistent hashing" -- because
a model with no way to look has no way to know. Search is what makes publish trustworthy.

## Why every docstring below is short

MCP sends every registered tool's full schema -- name, description, every parameter's own
description -- to the model on *every single turn* of the conversation, whether or not that turn
calls it. A verbose docstring is therefore not a one-time cost paid when the tool is used; it is
rent, paid on every message for the life of the conversation, and it was the single largest
token cost in an otherwise ordinary study session (see the incident that prompted this rewrite,
noted in docs/mcp-guide.md).

So every docstring here keeps only what changes what the model does if it's missing --
required shapes, format traps, the one-hour scoping rule -- and cuts the rationale for why the
tool is built the way it is. That rationale still exists; it just lives in the module docstring
above (never sent to the model -- FastMCP transmits only the `@server.tool()`-decorated
functions' own docstrings) and in docs/, for whoever is reading this file rather than calling it.
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
    Where a page can go, and which fields each discipline uses. Call once per session, before
    the first publish -- it returns every existing folder's `parent_path`; don't guess one.
    """
    return await _request("GET", "/api/prep/tree")


@server.tool()
async def prep_search(query: str, kind: str | None = None) -> dict[str, Any]:
    """
    Find existing pages by title or prompt. Call before publishing, to avoid a duplicate -- a
    close match means `prep_append`, not a second page.

    Args:
        query: Free text, matched against titles and prompts.
        kind: Narrow to dsa, system_design, behavioral or concept.
    """
    params: dict[str, str] = {"q": query}
    if kind:
        params["kind"] = kind
    return await _request("GET", "/api/prep/pages", params=params)


CONTENT_KEYS = (
    "pattern", "complexity", "approach",
    "requirements", "architecture", "tradeoffs",
    "situation", "action", "outcome",
)


async def _publish(kind: str, parent_path: str, args: dict[str, Any]) -> dict[str, Any]:
    """Common body for the per-discipline tools. Only `kind` and the section differ."""
    return await _request(
        "POST",
        "/api/prep/pages",
        json={
            "kind": kind,
            "parent_path": parent_path,
            "title": args.get("title"),
            "prompt": args.get("prompt"),
            "difficulty": args.get("difficulty"),
            "frequency": args.get("frequency") or 0,
            "topics": args.get("topics") or [],
            "companies": args.get("companies") or [],
            "body": args.get("body"),
            "resources": args.get("resources") or [],
            "source_url": args.get("source_url"),
            "on_conflict": args.get("on_conflict") or "error",
            "content": {k: args.get(k) for k in CONTENT_KEYS},
        },
    )


@server.tool()
async def publish_dsa_question(
    title: str,
    body: str | None = None,
    prompt: str | None = None,
    pattern: str | None = None,
    complexity: str | None = None,
    approach: str | None = None,
    difficulty: Literal["easy", "medium", "hard"] | None = None,
    frequency: int = 0,
    topics: list[str] | None = None,
    companies: list[str] | None = None,
    resources: list[dict[str, str]] | None = None,
    source_url: str | None = None,
    on_conflict: Literal["error", "merge", "replace"] = "error",
) -> dict[str, Any]:
    """
    Publish a DSA question: arrays, trees, graphs, DP, two pointers, sliding window, complexity.

    Args:
        title: e.g. "Sliding Window Maximum".
        body: The note, as Markdown.
        prompt: The question statement.
        pattern: The solution's recognisable shape, e.g. "Monotonic deque".
        complexity: Time and space, and why.
        approach: How the solution is reached.
        difficulty: easy, medium or hard.
        frequency: Ask score 1-5 (0 sorts to the bottom -- set it).
        topics, companies: Tags.
        resources: [{"url", "title"}]. Title videos; an untitled YouTube URL becomes "Watch".
        source_url: Where this was studied.
        on_conflict: error (default) refuses an existing page, merge fills gaps, replace overwrites.
    """
    return await _publish("dsa", "", locals())


@server.tool()
async def publish_hld_design(
    title: str,
    body: str | None = None,
    prompt: str | None = None,
    section: Literal["question", "concept"] = "question",
    requirements: str | None = None,
    architecture: str | None = None,
    tradeoffs: str | None = None,
    difficulty: Literal["easy", "medium", "hard"] | None = None,
    frequency: int = 0,
    topics: list[str] | None = None,
    companies: list[str] | None = None,
    resources: list[dict[str, str]] | None = None,
    source_url: str | None = None,
    on_conflict: Literal["error", "merge", "replace"] = "error",
) -> dict[str, Any]:
    """
    Publish a HIGH-level design page: architecture *between* services -- scale, sharding,
    replication, caching, queues, CAP, or a named product end to end. Not classes within one
    service; that's publish_lld_design.

    Args:
        title: e.g. "Design Instagram".
        body: The note, as Markdown.
        prompt: The question or brief.
        section: "question" (default) for "design X"; "concept" for a building block studied
            alone -- caching, CDNs, consistent hashing.
        requirements: Functional and non-functional.
        architecture: Components and data flow.
        tradeoffs: What was given up, and why.
        difficulty: easy, medium or hard.
        frequency: Ask score 1-5. Set it.
        topics, companies: Tags.
        resources: [{"url", "title"}]. Title videos.
        source_url: Where this was studied.
        on_conflict: error (default) | merge | replace.
    """
    return await _publish(
        "system_design", "hld" if section == "concept" else "hld/questions", locals()
    )


@server.tool()
async def publish_lld_design(
    title: str,
    body: str | None = None,
    prompt: str | None = None,
    requirements: str | None = None,
    architecture: str | None = None,
    tradeoffs: str | None = None,
    difficulty: Literal["easy", "medium", "hard"] | None = None,
    frequency: int = 0,
    topics: list[str] | None = None,
    companies: list[str] | None = None,
    resources: list[dict[str, str]] | None = None,
    source_url: str | None = None,
    on_conflict: Literal["error", "merge", "replace"] = "error",
) -> dict[str, Any]:
    """
    Publish a LOW-level design page from PROSE NOTES ONLY (no code yet): classes, interfaces,
    design patterns, SOLID, state machines -- a parking lot, elevator, vending machine, chess.
    If you have working code too, use publish_lld_solution instead. Wrong discipline? Ask,
    don't guess.

    Args:
        title: e.g. "Design a Parking Lot".
        body: The note, as Markdown.
        prompt: The question or brief.
        requirements: What the design must do.
        architecture: Classes, their relationships, the patterns used.
        tradeoffs: What was given up, and why.
        difficulty: easy, medium or hard.
        frequency: Ask score 1-5. Set it.
        topics, companies: Tags.
        resources: [{"url", "title"}]. Title videos.
        source_url: Where this was studied.
        on_conflict: error (default) | merge | replace.
    """
    return await _publish("system_design", "lld", locals())


@server.tool()
async def publish_lld_solution(
    title: str,
    problem_statement: str | None = None,
    requirements: str | None = None,
    entities: list[dict[str, str]] | None = None,
    interfaces: list[dict[str, str]] | None = None,
    relationships: str | None = None,
    design_choices: list[dict[str, str]] | None = None,
    edge_cases: str | None = None,
    talking_points: str | None = None,
    code_files: list[dict[str, str]] | None = None,
    prompt: str | None = None,
    difficulty: Literal["easy", "medium", "hard"] | None = None,
    frequency: int = 0,
    topics: list[str] | None = None,
    companies: list[str] | None = None,
    resources: list[dict[str, str]] | None = None,
    source_url: str | None = None,
    on_conflict: Literal["error", "merge", "replace"] = "error",
) -> dict[str, Any]:
    """
    Publish a WORKED LLD answer: design + working code. (Notes only, no code? publish_lld_design.)

    Scope to a 60-minute interview, not a production system: 6-10 types is normal, 20 is
    over-scoped. Check the question against how it's actually solved (LeetCode discuss,
    awesome-low-level-design, Hello Interview) and cut what those don't carry. State
    persistence/auth/retries as out of scope rather than building them.

    The server composes the page from your sections (fixed order: problem, requirements,
    entities/interfaces, relationships, design choices, edge cases, talking points) -- send
    fields, not a formatted body.

    Code is Go, a runnable module (go.mod + tests + cmd/demo/main.go), and goes in `code_files`
    ONLY -- never pasted into a text field. Run `gofmt -l .`, `go vet ./...`, `go test -race ./...`
    and `go run ./cmd/demo` before publishing; don't publish code you haven't run.

    Call prep_search first; if the page exists, use on_conflict "replace".

    Args:
        title: e.g. "Design a Parking Lot", not "LLD solution".
        problem_statement: What's being asked.
        requirements: Functional and non-functional; name what's OUT of scope too.
        entities: Rows, not a hand-written table:
            [{"name", "fields": "id string, size Size", "responsibility"}].
        interfaces: Rows: [{"name", "signature": "Price(int) (float64, error)", "purpose"}].
            No answer for `purpose` usually means the interface shouldn't exist.
        relationships: A ```mermaid fence (classDiagram, or stateDiagram-v2 for a lifecycle)
            renders as a real diagram.
        design_choices: Rows: [{"component", "choice", "principle": "Strategy/OCP/...", "why"}].
            One row per genuine decision.
        edge_cases: What's handled at the edges, and what's deliberately not.
        talking_points: What you'd say in the room -- opener, a trade-off, an extension. A short list.
        code_files: [{"path": "model/spot.go", "content": "..."}]. Publishing any file REPLACES
            the whole workspace -- always send the complete set; sending none leaves it untouched.
        prompt: One-line brief.
        difficulty: easy, medium or hard.
        frequency: Ask score 1-5. Set it.
        topics, companies: Tags.
        resources: [{"url", "title"}]. Title videos.
        source_url: Where this was studied.
        on_conflict: error (default) | merge (still replaces body + code) | replace.
    """
    return await _request(
        "POST",
        "/api/prep/pages",
        json={
            "kind": "system_design",
            "parent_path": "lld",
            "title": title,
            "prompt": prompt,
            "difficulty": difficulty,
            "frequency": frequency or 0,
            "topics": topics or [],
            "companies": companies or [],
            "resources": resources or [],
            "source_url": source_url,
            "on_conflict": on_conflict,
            "solution": {
                "problem_statement": problem_statement,
                "requirements": requirements,
                "entities": entities or [],
                "interfaces": interfaces or [],
                "relationships": relationships,
                "design_choices": design_choices or [],
                "edge_cases": edge_cases,
                "talking_points": talking_points,
            },
            "code_files": code_files or [],
            # The prose sections also fill the discipline fields the page UI shows as
            # "Starting points", so the page is useful in both places without asking twice.
            "content": {
                "requirements": requirements,
                "architecture": relationships,
                "tradeoffs": edge_cases,
            },
        },
    )


@server.tool()
async def publish_behavioral_story(
    title: str,
    body: str | None = None,
    prompt: str | None = None,
    situation: str | None = None,
    action: str | None = None,
    outcome: str | None = None,
    frequency: int = 0,
    topics: list[str] | None = None,
    companies: list[str] | None = None,
    resources: list[dict[str, str]] | None = None,
    source_url: str | None = None,
    on_conflict: Literal["error", "merge", "replace"] = "error",
) -> dict[str, Any]:
    """
    Publish a behavioural answer: your own experience, not a technical problem -- conflict, a
    failure, a project you led, "tell me about a time when".

    Args:
        title: e.g. "A production incident you handled".
        body: The note, as Markdown.
        prompt: The interview question this answers.
        situation: Context, briefly.
        action: What you specifically did.
        outcome: Result, and what you learned.
        frequency: Ask score 1-5. Set it.
        topics, companies: Tags.
        resources: [{"url", "title"}].
        source_url: Where this came from.
        on_conflict: error (default) | merge | replace.
    """
    return await _publish("behavioral", "", locals())


@server.tool()
async def publish_page(
    kind: Literal["dsa", "system_design", "behavioral", "concept", "company"],
    title: str,
    parent_path: str = "",
    body: str | None = None,
    prompt: str | None = None,
    frequency: int = 0,
    topics: list[str] | None = None,
    companies: list[str] | None = None,
    resources: list[dict[str, str]] | None = None,
    source_url: str | None = None,
    on_conflict: Literal["error", "merge", "replace"] = "error",
) -> dict[str, Any]:
    """
    Escape hatch: publish to an explicit kind + section. Prefer the discipline-specific tools;
    use this only for what none of them covers (e.g. a company's Notes page, kind "company").
    There is no "lld" kind -- it's "system_design" under parent_path "lld".

    Args:
        kind: Which tree the page belongs to.
        title: The page name.
        parent_path: Section within the kind, e.g. "hld/questions". prep_tree lists valid ones.
        body: The note, as Markdown.
        prompt: The question or brief.
        frequency: Ask score 1-5.
        topics, companies: Tags.
        resources: [{"url", "title"}].
        source_url: Where this came from.
        on_conflict: error (default) | merge | replace.
    """
    return await _publish(kind, parent_path, locals())


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
    Add to a page that already exists, without overwriting it. Use once prep_search finds the
    topic covered. Resources always add; every other field fills only if currently empty.

    Args:
        kind: Discipline of the existing page.
        title: Its exact title (identifies it via slug).
        parent_path: The folder it lives in.
        body: Used only if the page has no body yet.
        resources: [{"url", "title"}] to add. Existing links are skipped, not duplicated.
        topics, companies: Merged with what's there.
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
    Create a company's prep folder + its five pages (Notes, Question Bank, DSA, HLD, LLD).
    Safe to call again -- existing pages are untouched. Call before any other company tool.

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
    Add rows to a company's Question Bank: what it asks, how often, and where you found that.
    Adds by default -- record HLD questions now, LLD questions later, without resending the
    first batch. A question reported again keeps the newer date and rating.

    Args:
        company: Must already be scaffolded.
        entries: [{"question", "discipline": "dsa"|"hld"|"lld", "frequency": 0-5,
                   "last_asked": "YYYY-MM-DD", "source_urls": [...]}]. Always give source_urls --
            that's what makes this evidence, not a list. Include every corroborating report, not
            just one.
        mode: merge (default) adds. replace discards everything first -- rebuild only.
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
    Add questions to a company's DSA/HLD/LLD index, linked to the real pages. Pass names, not
    URLs -- titles resolve against the tree server-side. Unmatched questions come back in
    `unlinked` (what to write next); they are never silently dropped.

    Args:
        company: Must already be scaffolded.
        discipline: Which index to write.
        questions: [{"title", "frequency": 0-5, "last_asked": "YYYY-MM-DD"}].
        mode: merge (default) adds. replace discards what's there first.
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
