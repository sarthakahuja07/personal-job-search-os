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
| `publish_behavioral_story` | Your own experience — conflict, failure, a project you led, "tell me about a time when" |
| `publish_page` | None of the above. Takes an explicit `kind` and `parent_path`. Prefer the others |

**If the conversation covered more than one discipline, or which one is unclear, ask rather than
guessing.** A page filed under the wrong discipline is worse than a question: the company index
that should link it will never find it there.

`publish_hld_design` takes a `section`: `question` (default) for a "design X" problem, `concept`
for a building block studied on its own — caching, CDNs, consistent hashing, CAP.

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

**Duplicates are refused by default.** If the page exists you get a `409` telling you what to
do. That is deliberate: silently overwriting loses work, silently duplicating ruins the tree.
Choose `on_conflict: "merge"` (fill only empty fields, add resources) or `"replace"` (overwrite)
knowingly.

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
  {question: "LRU Cache",     discipline: "dsa", frequency: 5, last_asked: "2026-09-01"},
  {question: "Design Instagram", discipline: "hld", frequency: 4, last_asked: "2026-08-20"}
]
```

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
