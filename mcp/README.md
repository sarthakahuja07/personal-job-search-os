# prep-publisher — an MCP server for publishing study notes

Lets an assistant write finished study pages straight into the prep tree: notes, reference
videos, difficulty and ask score, filed under the right section.

For a *solved* low-level design question there is `publish_lld_solution`, which additionally
takes the implementation as files and puts it in the page's Code panel — see
[docs/lld-solution-pages.md](../docs/lld-solution-pages.md).

## Why it runs locally

The app is behind Cloudflare Access. A *local* stdio server can hold the Access service token
and the ingest bearer token exactly as the crawler does, so nothing has to be exposed to the
internet for an assistant to write to the board, and no credential leaves this machine.

The alternative — a hosted MCP server, or a ChatGPT Action — needs a path-scoped Access bypass,
which turns a write endpoint into your only database into something reachable by anyone who
guesses a token. That trade was considered and rejected; see `docs/decisions/`.

The consequence worth knowing: this works with MCP clients that launch a local process
(Claude Code, Claude Desktop). It does **not** work with ChatGPT in a browser, which can only
reach a server over the public internet — that is what `mcp-remote/` exists for. Prefer this one
where you can: it is reachable by nothing and nobody but this machine.

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
| `publish_dsa_question` | A coding problem |
| `publish_hld_design` | Architecture between services |
| `publish_lld_design` | Object-oriented design within one service |
| `publish_behavioral_story` | An experience question |
| `publish_page` | Explicit kind and section; the escape hatch |
| `prep_append` | Add to a page that exists, without overwriting it |
| `company_scaffold` | Create a company folder and its five pages |
| `company_question_bank` | The table of what a company asks, and how often |
| `company_question_index` | A DSA/HLD/LLD list, linked to the real pages |

**One publishing tool per discipline, not one with a `kind` argument.** The generic tool asked
the model to get two things right at once: `kind`, and a `parent_path` that does not follow from
it. Low-level design exposes the problem -- there is no `kind: "lld"`, it is `system_design`
filed under `lld` -- so the commonest mistake was the one a description could not prevent, since
the tool had already been chosen before it was read. Splitting moves the routing into the tool
name, where the model is choosing anyway, and each schema then carries only its own discipline's
fields.

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

## Company pages

A company folder holds Notes, Question Bank, DSA, HLD and LLD. The last three are *generated*:
pass question **titles**, not URLs, and the server resolves them against the real tree — scoped
so an LLD question cannot resolve to a similarly named HLD page. Titles with no page yet are
kept under "Not written yet" and returned in `unlinked`, which is the list of what to write
next. Both write tools replace the page, so send the whole set each time.

## Where things go

Low-level design is **not** a separate kind. It is `kind: "system_design"` published under
`parent_path: "lld"`. `prep_tree` lists the seven real sections; it deliberately excludes leaf
notes, which is why 36 DSA and behavioral pages do not appear as destinations.
