# Crawlers

The crawler is the product. Everything else in Phase 0 is a view over the data it produces.

Read [ADR 008](decisions/008-crawler-correctness-strategy.md) alongside this document — it explains
*why* the design is shaped this way. This document explains *how* to work with it.

---

## The failure mode this design exists to prevent

A crawler that crashes is fine. It is loud, it shows up as a red run, it gets fixed.

The failure that matters is a crawler that returns **zero jobs, successfully, forever**. It looks
exactly like "no new jobs this week". Nobody investigates it. Meanwhile the roles Sarthak wanted
are posted, flooded, and closed.

This is not hypothetical. Two real examples from sources we depend on:

- **Workday returns HTTP 200 with an empty array when `limit > 20`.** Not a 400, not an error. A
  reasonable-looking "fetch 100 per page instead of 20" change would silently disable that company
  forever.
- **Workday's `postedOn` is a localized display string** (`Posted Today`, and its translations) —
  not a date. A naive parse produces garbage rather than raising.

Every mechanism below exists because of that class of bug.

---

## Source tiers

Each company resolves to the **most stable source that works**. The tier is stored on the company
row so it is visible, and lower tiers get monitored harder.

| Tier | Source | Endpoint shape | Adding a company |
|---|---|---|---|
| 1 | Greenhouse | `GET boards-api.greenhouse.io/v1/boards/{token}/jobs` | config only |
| 1 | Lever | `GET api.lever.co/v0/postings/{slug}?mode=json` | config only |
| 1 | Ashby | `GET api.ashbyhq.com/posting-api/job-board/{name}` | config only |
| 1 | SmartRecruiters | `GET api.smartrecruiters.com/v1/companies/{id}/postings` | config only |
| 2 | Workday CXS | `POST {tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` | config only |
| 3 | Bespoke company JSON | per company | new adapter |
| 4 | Embedded JSON-LD `JobPosting` | careers HTML | config only |
| 5 | HTML selectors | careers HTML | config only |
| 6 | Manual check | — | config only |

Tiers 1–2 cover most targets with **no code change** (PRD §97). Prefer them always.

**Tier 6 is a supported outcome, not a failure.** Sites that signal they do not want automated
access — bot challenge, `robots.txt` disallow, hard block — are marked manual and surfaced as a
recurring dashboard reminder. We do not spoof fingerprints, solve challenges, or rotate identities.
Evasion is also the *unreliable* choice: it breaks constantly and rots silently, which is exactly
the failure this whole design targets.

---

## The adapter contract

Adapters **fetch, parse, normalize — and nothing else** (PRD §15). No deduplication, no relevance
matching, no notifications, no database access. That purity is what makes them exhaustively
testable, and it is not negotiable.

```python
class JobSourceAdapter(Protocol):
    source_type: str

    def detect(url: str) -> SourceConfig | None:
        """Claim a careers URL and extract config from it. Pure; regex only, no network."""

    def validate_config(cfg: SourceConfig) -> list[str]:
        """Human-readable errors, checked before a company is saved."""

    def fetch(cfg: SourceConfig, ctx: CrawlContext) -> Iterator[RawJob]:
        """Paginated. The only place network I/O happens."""

    def parse(raw: RawJob) -> NormalizedJob:
        """PURE. No network, no clock, no randomness - asserted by the conformance suite."""
```

`NormalizedJob` is a pydantic v2 model, validated at the boundary:

| Field | Rule |
|---|---|
| `external_job_id` | Non-empty. **The source's own stable id** — never synthesised, never derived from a title ([ADR 005](decisions/005-job-deduplication.md)) |
| `title` | Non-empty, no HTML tags or entities |
| `job_url` | Absolute, https |
| `posted_at` | A real `date`, or `None`. **Never a display string.** |

Anything company-specific that *can* be data **is** data, in `source_config`. Selectors, tenant
names, board tokens and site slugs never belong in code.

---

## Adding a company

```
paste careers URL
   -> detect()            pure regex; covers tiers 1-2 with no network call
   -> validate_config()   human-readable errors
   -> dry-run fetch       preview the jobs actually found
   -> save                only if the preview looks right
```

Two entry points, one code path:

```bash
python -m crawler doctor https://boards.greenhouse.io/example
```

prints a health report, a preview of parsed jobs, and a ready-to-paste `source_config`. The
in-app **Test this source** button triggers the same thing via `workflow_dispatch` and renders the
preview.

You should not be able to save a company whose adapter does not demonstrably work.

## Adding an adapter

Only when no existing tier can serve the company.

1. Record a real response as a cassette in `crawler/tests/cassettes/`, scrubbed of anything
   sensitive. Include a **multi-page** capture — single-page cassettes hide pagination bugs.
2. Implement the four protocol methods.
3. Register it in `crawler/adapters/registry.py`. **The conformance suite now applies
   automatically** — this is the mechanism behind "tested for every new company".
4. Add regression tests for any trap specific to this source.
5. Document the source in the tier table above.

---

## The conformance suite

One parametrized module in `crawler/tests/conformance/` runs against every registered adapter.
Registration alone subjects an adapter to all of it:

- Yields at least one job from its golden cassette.
- Every job has non-empty `external_job_id` and `title`, and an absolute https `job_url`.
- **`external_job_id` is byte-stable across two runs of the same cassette.** The single most
  important assertion in the suite: an unstable id means every run looks new and Sarthak gets
  emailed daily about jobs he has already seen, until he stops trusting notifications entirely.
- `posted_at` is a real date or `None` — never a relative string.
- Pagination terminates and yields exactly `total`, tested against a multi-page cassette.
- No HTML leaks into titles; unicode and emoji survive round-trip.
- `parse()` is pure — asserted by running it with the network patched out.
- Two consecutive fetches over the same cassette produce byte-identical output.

Adapter-specific regression tests pin known traps, for example: never request a Workday page size
above 20.

Tests replay recorded cassettes and **never touch the live network**.

---

## Runtime health

Cassettes replay yesterday's truth forever. They cannot detect upstream change, so tests alone are
not enough. Five runtime mechanisms:

| Mechanism | Behaviour |
|---|---|
| **Zero-result guard** | A company that previously returned jobs and now returns none is marked `suspicious`, never `success`. Genuinely empty boards must set `allow_zero_results`. |
| **Volume drift** | A drop greater than 50% against the trailing median of recent successful runs marks the run `degraded`. |
| **Schema assertions** | Adapters declare required response fields; a missing field raises `SchemaDriftError` naming it — in production, not just in tests. |
| **Deletion grace** | Jobs absent from a crawl are never hard-deleted. `closed_at` is set only after N consecutive *successful* runs, so a broken adapter cannot wipe the board. |
| **Contract canary** | `contracts.yml` runs daily against the **real** endpoints for a sample and validates live shape against the cassette schemas. Fails loudly, independently of the main crawl. |

Company health (green / amber / red, last success, last error) is visible in the UI, and a weekly
digest lists stale or degraded adapters.

---

## Efficiency

Expected scale is small, but crawl runs share a free budget and some boards are enormous.

- **Conditional requests.** Per-company `etag` / `last_modified`; a `304` short-circuits the company.
- **Content hashing.** An identical raw listing hash skips parsing and ingest entirely.
- **No N+1 detail fetches.** Tiers 2–4 need a per-job detail request for the real date and
  description. Fetch details **only** for jobs that are both new *and* pass a cheap title-only
  relevance pre-filter. A company with 2,000 openings and 3 relevant new roles costs about 100 list
  calls and **3** detail calls — not 2,000.
- **Bounded concurrency.** `httpx.AsyncClient` with a per-host semaphore (2–4), a global cap, and a
  politeness delay per host.
- **Retries.** Exponential backoff with jitter on 429/5xx, `Retry-After` honoured, hard attempt cap.
  A 429 backs off and marks the company `degraded` — it never hammers.
- **Budgets.** Per-company wall-clock and request ceilings, so one pathological company cannot
  consume the whole run.

## Failure isolation

One company failing never aborts the run (PRD §22). Every outcome — success, failure, suspicious,
degraded — is recorded in `crawl_runs` with duration, counts, tier used, and error detail.

## Scheduling

| Workflow | Cadence | Purpose |
|---|---|---|
| `crawl.yml` | every 3 hours | discover jobs, POST to ingest, drain the notification outbox |
| `contracts.yml` | daily | live schema canary against real endpoints |

Budget: roughly 8 runs/day, 240/month, at about 2 minutes each — around 480 of the 2,000 free
private-repo minutes. Re-check before increasing cadence.
