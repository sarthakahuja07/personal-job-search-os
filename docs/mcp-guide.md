# Publishing to the prep board

You have tools that write into a personal interview-prep board. This explains what each one is
for and how they fit together, so "publish this" is enough of an instruction.

**The shape of a session:** study something, then publish it. Publishing is not one call — it is
look first, then write, and for company work, scaffold before either.

---

## The board

Three disciplines, each a tree of pages.

| Discipline | `kind` | Holds |
|---|---|---|
| DSA | `dsa` | One page per problem. Flat — no sections |
| System Design | `system_design` | Nested. `hld` and `lld` are its two sections |
| Companies | `company` | One folder per company, five pages each |

**Low-level design is not its own kind.** It is `kind: "system_design"` published under
`parent_path: "lld"`. High-level design is the same, under `hld`. Getting this wrong is the
single most common mistake; there is no `kind: "lld"`.

---

## The seven tools

### Look before you write

**`prep_tree`** — the sections a page can go into, and the fields each discipline uses. Call it
once at the start of a session. It is the only way to know what `parent_path` values exist; do
not guess them.

**`prep_search`** — does this page already exist? **Call this before every `prep_publish`.**
Without it you will create "Consistent Hashing" next to "Consistent hashing" next to "Design:
consistent hashing", and the board becomes unusable. If a close match comes back, use
`prep_append` instead.

### Write a page

**`prep_publish`** — a new study page: the note, its reference links, and the metadata that
makes it findable later.

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
| `parent_path` | Where it goes. From `prep_tree` |

Discipline fields go in alongside: `pattern` / `complexity` / `approach` for DSA,
`requirements` / `architecture` / `tradeoffs` for system design, `situation` / `action` /
`outcome` for behavioral.

**Resources:** pass `[{url, title}]`. YouTube links are detected and stored as videos with the
id extracted automatically. **Always give a video a title** — a YouTube URL has nothing readable
in its path, so an omitted one becomes the literal word "Watch". Article titles and publishers
are derived well enough to omit.

**Duplicates are refused by default.** If the page exists you get a `409` telling you what to
do. That is deliberate: silently overwriting loses work, silently duplicating ruins the tree.
Choose `on_conflict: "merge"` (fill only empty fields, add resources) or `"replace"` (overwrite)
knowingly.

**`prep_append`** — add to a page that exists without overwriting it. Resources are always
added; every other field fills only where the page is currently empty. A note written by hand
survives your second pass over the same topic.

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

**`unlinked` in the response is the useful part.** Those are questions with no page yet. They
render under "Not written yet" rather than being dropped, because that list is what to study
next. Offer to write those pages.

---

## How a session usually goes

**Studying a topic:**

1. `prep_search` for the topic
2. `prep_publish` if new, `prep_append` if it exists
3. Include the video or article you learned from

**Recording what a company asks:**

1. `company_scaffold` for the company
2. `company_question_bank` with everything you know
3. `company_question_index` per discipline you have questions for
4. Report what came back `unlinked` — those are the gaps

**A question that came up while studying a company:** publish the page first with
`prep_publish`, then add it to the company. The next `company_question_index` call will link it
automatically, because every write re-resolves every link.

---

## Two things that are easy to get wrong

**LLD is `system_design` + `parent_path: "lld"`.** Not a kind of its own.

**Set `frequency`.** It defaults to 0, which sorts a page to the bottom of every list. You
almost always know roughly how often something is asked; a rough number beats none.
