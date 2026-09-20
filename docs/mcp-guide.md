# Publishing to the prep board

You have tools that write into a personal interview-prep board. This explains what each one is
for and how they fit together, so "publish this" is enough of an instruction.

**The shape of a session:** study something, then publish it. Publishing is not one call — it is
look first, then write, and for company work, scaffold before either.

---

## The board

Three disciplines, each a tree of pages.

| Discipline | Holds |
|---|---|
| DSA | One page per problem. Flat — no sections |
| System Design | Split into HLD and LLD |
| Behavioral | Your stories |
| Companies | One folder per company, five pages each |

You do not need to know how any of that is stored. Each publishing tool files its own pages, so
choosing the right tool is the only placement decision there is.

---

## The tools

### Look before you write

**`prep_tree`** — the sections a page can go into, and the fields each discipline uses. Call it
once at the start of a session. It is the only way to know what `parent_path` values exist; do
not guess them.

**`prep_search`** — does this page already exist? **Call this before publishing.** Without it
you will create "Consistent Hashing" next to "Consistent hashing" next to "Design: consistent
hashing", and the board becomes unusable. If a close match comes back, use `prep_append`
instead.

### Write a page — one tool per discipline

**Pick the tool that matches what the conversation was about.** The tool decides where the page
is filed, so choosing the right one is the whole of getting it in the right place. None of them
takes a `kind` or a section — there is nothing to get wrong once the tool is chosen.

| Tool | Use when the conversation was about |
|---|---|
| `publish_dsa_question` | A coding problem — arrays, trees, graphs, DP, two pointers, complexity |
| `publish_hld_design` | Architecture *between services* — scale, sharding, replication, caching, queues, CAP, or designing a named product |
| `publish_lld_design` | Object-oriented design *within one service* — classes, interfaces, design patterns, SOLID, state machines, parking lot / elevator / chess |
| `publish_lld_solution` | The same, but you **solved it** — you have the design *and* working code. See below |
| `publish_behavioral_story` | Your own experience — conflict, failure, a project you led, "tell me about a time when" |
| `publish_page` | None of the above. Takes an explicit `kind` and `parent_path`. Prefer the others |

**If the conversation covered more than one discipline, or which one is unclear, ask rather than
guessing.** A page filed under the wrong discipline is worse than a question: the company index
that should link it will never find it there.

`publish_hld_design` takes a `section`: `question` (default) for a "design X" problem, `concept`
for a building block studied on its own — caching, CDNs, consistent hashing, CAP.

### Worked LLD answers — `publish_lld_solution`

When you have actually solved a low-level design question, this publishes the whole thing: the
reasoning as named sections, and the implementation as real files into the page's Code panel,
which renders a folder tree and a syntax-highlighted pane.

You send sections, not a formatted body — the server composes the Markdown so every worked page
has the same headings in the same order:

    Problem statement → Requirements → Entities and interfaces →
    Relationships and diagrams → Design choices and principles →
    Cases handled and edge cases → Talking points

Five things to get right:

- **Scope it to one hour.** The answer must be designable, explainable and codeable in a
  60-minute interview. Check the question against how it is solved on LeetCode discuss,
  awesome-low-level-design or Hello Interview, and cut what they do not carry. Six to ten types
  is normal; twenty is over-scoped. Persistence, auth and retries are usually out of scope, and
  saying so beats building them.
- **Entities and interfaces are tables**, sent as rows — `{name, fields, responsibility}` and
  `{name, signature, purpose}`. `fields` carries the real fields with types.
- **`design_choices` is a table too**, rows of `{component, choice, principle, why}`. Never
  hand-write a Markdown table; a stray pipe shifts every column and still renders.
- **Diagram the relationships.** A ```mermaid fence renders as a real diagram; `classDiagram`
  is usually what you want, `stateDiagram-v2` for a lifecycle.
- **The code is Go, a module that runs.** Include `go.mod`, tests and `cmd/demo/main.go`, and
  run `gofmt -l .`, `go vet ./...`, `go test -race ./...` and `go run ./cmd/demo` first. Never
  publish code you have not run.

Full contract, with a worked example: [lld-solution-pages.md](lld-solution-pages.md).

Fill in everything the session actually established. A page with only a title cannot be revised
from, and with `frequency` unset it sorts last and is effectively invisible. These are things
you know at the end of a session and a human would never type by hand:

| Field | Why it matters |
|---|---|
| `body` | The note itself, Markdown. The main content |
| `frequency` | 1–5, how often this is asked. **Drives the sort — set it** |
| `difficulty` | `easy` / `medium` / `hard` |
| `topics` | Tags like `["caching", "distributed-systems"]` |
| `companies` | Who is known to ask it |
| `resources` | Videos and articles — see below |

Each tool carries only its own discipline's fields: `pattern` / `complexity` / `approach` on
the DSA tool, `requirements` / `architecture` / `tradeoffs` on both design tools,
`situation` / `action` / `outcome` on the behavioural one.

**Resources:** pass `[{url, title}]`. YouTube links are detected and stored as videos with the
id extracted automatically. **Always give a video a title** — a YouTube URL has nothing readable
in its path, so an omitted one becomes the literal word "Watch". Article titles and publishers
are derived well enough to omit.

**Duplicates are refused by default, including differently-worded ones.** "Design a URL
Shortener (TinyURL-style; hashing/uniqueness)" is refused when "Design a URL Shortener" already
exists anywhere in that discipline — bracketed asides and anything after a colon or dash are
stripped before comparing. The refusal names the existing page and its path.

When that happens: add to the existing page with `prep_append`, or republish with
`on_conflict: "merge"` (fill only empty fields, add resources) or `"replace"` (overwrite). If it
really is a different question, give it a title that says how it differs — "Two Sum II" and
"Design a Distributed Rate Limiter" both publish fine, because the check is exact-match after
stripping rather than a fuzzy one.

**`prep_append`** — add to a page that exists without overwriting it. Take `kind` and
`parent_path` from the `prep_search` result rather than working them out: its `path` is the
page's full section path, and everything before the last segment is `parent_path`. Resources are
always added; every other field fills only where the page is currently empty, so a note written
by hand survives your second pass over the same topic.

---

## Company preparation

A company folder holds five pages: **Notes**, **Question Bank**, and **DSA / HLD / LLD**
indexes. The last three are generated — you supply structured rows, the board renders them.

### `company_scaffold`

Creates the folder and all five pages. **Call this first.** Safe to repeat; existing pages are
untouched. The other company tools fail with a clear message if the company does not exist yet.

### `company_question_bank`

The table of what a company asks: question, how often, when last seen. One table per discipline,
sorted by frequency.

```
entries: [
  {question: "LRU Cache", discipline: "dsa", frequency: 5, last_asked: "2026-09-01",
   source_url: "https://leetcode.com/problems/lru-cache/"},
  {question: "Design Instagram", discipline: "hld", frequency: 4, last_asked: "2026-08-20",
   source_url: "https://www.teamblind.com/post/..."}
]
```

**`source_url` is where the question was *found*** — the LeetCode problem, the interview
experience post, the blog. Give it whenever you have one; that column is what makes the bank
evidence rather than a list. **The bank never links to our own pages for a question.** Linking
inward is `company_question_index`'s job, and keeping them apart stops the two views drifting.

### `company_question_index`

One discipline's list, linked to the real pages. `discipline` is `dsa`, `hld` or `lld`.

```
questions: [{title: "Design a rate limiter", frequency: 5, last_asked: "2026-08-01"}]
```

### Three rules for company tools

**Pass question *names*, never URLs.** You know what a question is called; only the board knows
whether a page exists and where it sits. Titles are resolved server-side — close is good enough,
"Design a rate limiter" finds a page called "Rate Limiter" — and scoped to the right tree, so an
LLD question cannot resolve to a similarly named HLD page.

**They add by default.** Record a company's HLD questions today and its LLD questions next
month; you do not need to resend the first lot. A question reported again updates its rating and
keeps the *later* date. Use `mode: "replace"` only to rebuild a page from scratch — it discards
everything already recorded.

**Generated pages are read-only in the app.** The question bank and the three index pages are
rendered from the rows you send, so publishing again is how they change; a person editing them by
hand would have the edit replaced. That is also why the bank renders as a real table rather than
as text.

**`unlinked` in the response is the useful part.** Those are questions with no page yet. They
render under "Not written yet" rather than being dropped, because that list is what to study
next. Offer to write those pages.

---

## How a session usually goes

**Studying a topic:**

1. `prep_search` for the topic
2. The publishing tool for that discipline if new, `prep_append` if it exists
3. Include the video or article you learned from

**Recording what a company asks:**

1. `company_scaffold` for the company
2. `company_question_bank` with everything you know
3. `company_question_index` per discipline you have questions for
4. Report what came back `unlinked` — those are the gaps

**A question that came up while studying a company:** publish the page first with its
discipline's tool, then add it to the company. The next `company_question_index` call will link it
automatically, because every write re-resolves every link.

---

## Two things that are easy to get wrong

**HLD and LLD are different tools, and the distinction is services versus classes.** "Design
Instagram" is HLD. "Design a parking lot" is LLD. If a session covered both — designing a system
and then drilling into one class — publish two pages, or ask which was meant.

**Set `frequency`.** It defaults to 0, which sorts a page to the bottom of every list. You
almost always know roughly how often something is asked; a rough number beats none.

**A solved LLD question wants `publish_lld_solution`, not `publish_lld_design`.** The prose tool
cannot carry code, so the implementation ends up pasted into the body as one long fence — which
is the thing the Code panel exists to avoid. If you have files, use the tool that takes files.

---

## Why the tool descriptions are terse

MCP sends every registered tool's full schema — name, description, every field's own
description — to the model on *every turn* of a conversation, whether or not that turn calls it.
This was measured as the largest single token cost in an ordinary study session run through
claude.ai: a long-running chat re-sends that fixed schema cost plus the entire prior transcript
(including every previously published page's full body and code) on every new message, which
compounds fast in one continuous thread.

Two things followed from that measurement (2026-09): the tool descriptions here were cut by
roughly 40% — keeping only what changes a call's correctness (required shapes, the one-hour
scoping rule, format traps) and moving the rationale for *why* into code comments (never
transmitted) and this file. And the standing advice for anyone studying through a chat UI: start
a new conversation every question or two, rather than one long thread — that, not the schema
size, is what actually exhausts a usage window fastest.
