# 008 — Crawler correctness: tiers, conformance, and drift detection

**Status:** Accepted · 2026-09-05

## Context

Discovery is the product. Everything else in Phase 0 is a view over data the crawler produces, so
crawler defects are indistinguishable from the product not working.

The dangerous failure is not a crash. A crash is loud and gets fixed. The dangerous failure is a
crawler that returns **zero jobs, successfully, forever** — which looks exactly like "no new jobs
this week" and would quietly cost Sarthak the job search.

This is not hypothetical. The Workday CXS endpoint returns **HTTP 200 with an empty array** when
`limit > 20` — not an error, not a 400. A plausible "let's fetch 100 per page" optimisation silently
disables that company permanently. Its `postedOn` field is likewise a localized display string
("Posted Today"), so a naive date parse yields garbage rather than an exception.

## Decision

Three mechanisms, each targeting a different failure class.

**1. A source tier ladder.** Every company resolves to the most stable source that works:
ATS JSON feeds (Greenhouse/Lever/Ashby) → Workday CXS → bespoke company JSON → embedded JSON-LD
`JobPosting` → HTML selectors → manual. Tier is stored on the company row. Lower tiers are
expected to break more often and are monitored accordingly.

Sites that signal they do not want automated access (bot challenge, `robots.txt` disallow, hard
block) are assigned **Tier 6 / manual** and surfaced as a recurring dashboard reminder. We do not
spoof fingerprints, solve challenges, or rotate identities. Beyond being the right call, evasion is
the *unreliable* one: it would make the most important subsystem the most fragile, and a bypass
that rots silently is precisely the failure this ADR exists to prevent.

**2. A conformance suite every adapter inherits.** One parametrized pytest module runs against every
registered adapter using its recorded cassettes. Adding an adapter to the registry subjects it
automatically to the full set — including the invariants that matter most: `external_job_id` is
byte-stable across identical runs (ADR 005), `posted_at` is a real date or `None` and never a
display string, pagination terminates and yields exactly `total`, `parse()` is pure, and no HTML
leaks into titles. Adapter-specific regression tests pin known traps, such as never requesting a
Workday page size above 20.

**3. Runtime health, not just test-time health.** Cassettes replay yesterday's truth forever and
cannot detect upstream change, so tests alone are insufficient:

- Zero results is an error by default; a company that previously returned jobs and now returns none
  is marked `suspicious`, never `success`. Genuinely empty boards set `allow_zero_results`.
- Volume drift: a drop of more than 50% against the trailing median of recent successful runs marks
  the run `degraded`.
- Adapters declare required response fields and raise `SchemaDriftError` naming the missing field
  in production, not only in tests.
- Jobs absent from a crawl are never hard-deleted; `closed_at` is set only after N consecutive
  *successful* runs, so a broken adapter cannot wipe the board.
- A daily `contracts.yml` canary hits the **real** endpoints for a sample and validates live shape
  against the cassette schemas. It fails loudly and independently of the main crawl.

## Consequences

- Adding a Tier 1–2 company is a config row, not code (PRD §97), and `crawler doctor <url>` proves
  it works before it is saved.
- More upfront infrastructure than a naive crawler, built before the first company-specific adapter.
  This ordering is deliberate: the correctness machinery is what makes adapters cheap and safe to
  add, so it must exist first.
- Some legitimate situations will be flagged `suspicious` (a company genuinely closing all reqs).
  False positives here are acceptable; false negatives are not.
