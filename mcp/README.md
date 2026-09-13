# prep-publisher — an MCP server for publishing study notes

Lets an assistant write finished study pages straight into the prep tree: notes, reference
videos, difficulty and ask score, filed under the right section.

## Why it runs locally

The app is behind Cloudflare Access. A *local* stdio server can hold the Access service token
and the ingest bearer token exactly as the crawler does, so nothing has to be exposed to the
internet for an assistant to write to the board, and no credential leaves this machine.

The alternative — a hosted MCP server, or a ChatGPT Action — needs a path-scoped Access bypass,
which turns a write endpoint into your only database into something reachable by anyone who
guesses a token. That trade was considered and rejected; see `docs/decisions/`.

The consequence worth knowing: this works with MCP clients that launch a local process
(Claude Code, Claude Desktop). It does **not** work with ChatGPT in a browser, which can only
reach a server over the public internet.

## Setup

Already registered for Claude Code in `.mcp.json` at the repo root. It needs the venv:

    python3.12 -m venv mcp/.venv
    mcp/.venv/bin/pip install -r mcp/requirements.txt

Credentials are read from the repo-root `.env` — `APP_BASE_URL`, `INGEST_TOKEN`, and the two
`CF_ACCESS_*` values. The server refuses to start without the first two rather than failing on
every tool call.

## The four tools

| Tool | For |
|---|---|
| `prep_tree` | Where pages can go, and which fields each discipline wants |
| `prep_search` | Does this page already exist |
| `prep_publish` | Write a new page |
| `prep_append` | Add to a page that exists, without overwriting it |

Search is not a convenience. A write-only tool would have been half the code and would fill the
tree with near-duplicates — "Consistent Hashing", "Consistent hashing", "Design: consistent
hashing" — because a model with no way to look has no way to know.

## Publishing rules

- **A duplicate is refused by default.** `on_conflict` must be set to `merge` or `replace`
  deliberately. An assistant that silently overwrites is how a week of notes disappears.
- **`merge` never replaces a body that already exists.** It fills empty fields and adds
  resources. A note written by hand survives a second pass over the same topic.
- **Resources are always additive**, and de-duplicated by URL, so re-publishing is idempotent.
- **Pages are placed by path, not id** — `parent_path: "lld"` — because a model cannot know a
  UUID, and asking for one guarantees either a hallucination or everything landing at the root.

## Where things go

Low-level design is **not** a separate kind. It is `kind: "system_design"` published under
`parent_path: "lld"`. `prep_tree` lists the seven real sections; it deliberately excludes leaf
notes, which is why 36 DSA and behavioral pages do not appear as destinations.
