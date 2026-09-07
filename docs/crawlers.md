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

This is not hypothetical. Both examples below were **verified against the live NVIDIA Workday
endpoint on 2026-09-05**, not taken on trust:

- **Workday's page size is hard-capped at 20.** `limit=20` returns 20 of 2,000 jobs; `limit=21` and
  `limit=100` return **HTTP 400**. Published write-ups claim this returns HTTP 200 with an empty
  array; today it is a 400. Either way the lesson holds, and the 200-empty variant may still exist
  on other tenants or return with a Workday change. An adapter that catches the error and moves on
  produces a silent zero just as effectively as a silent empty response, so the guard is against the
  *symptom* (a company that returned jobs yesterday and none today), never against one status code.
- **Workday's `postedOn` is a localized display string.** The live response returns
  `"postedOn": "Posted Today"` — not a date. A naive parse produces garbage rather than raising.
  The real date is only on the per-job detail endpoint.

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

## Current coverage

Classified by probing live feeds on 2026-09-05/06, not from memory. Job counts drift.

**Tier 1 — public ATS feed, config only (9)**

| Company | ATS | Slug | Jobs seen |
|---|---|---|---|
| Databricks | Greenhouse | `databricks` | 871 |
| Roku | Greenhouse | `roku` | 252 |
| Uber Freight | Greenhouse | `uberfreight` | 81 |
| Postman | Greenhouse | `postman` | 63 |
| ServiceNow | SmartRecruiters | `servicenow` | 612 |
| Swiggy | SmartRecruiters | `swiggy` | 67 |
| Sarvam AI | Ashby | `sarvam` | 63 |
| Confluent | Ashby | `confluent` | 22 |
| Zeta Suite | Lever | `zeta` | 19 |

**Tier 2 — Workday CXS, config only (5)**

| Company | Tenant | Shard | Site | Jobs seen |
|---|---|---|---|---|
| NVIDIA | `nvidia` | `wd5` | `NVIDIAExternalCareerSite` | 2000 |
| Target | `target` | `wd5` | `targetcareers` | 2000 |
| Salesforce | `salesforce` | `wd12` | `External_Career_Site` | 1455 |
| Visa | `visa` | `wd5` | `Visa` | 755 |
| Adobe | `adobe` | `wd5` | `external_experienced` | 724 |

**14 companies are crawlable with no new code** — only adapters for these five platforms.

**Tier 3 — bespoke, needs a custom adapter (4)**

| Company | Stack | Status |
|---|---|---|
| Intuit | Radancy / TalentBrew | Endpoint verified. `/search-jobs/results` returns JSON whose `results` key is an HTML blob with `data-job-id` and stable numeric ids. |
| Akamai | Oracle Recruiting Cloud | Stack identified (`hcmRestApi`, `siteNumber=CX_1`). The public `recruitingCEJobRequisitions` finder path 404s as constructed; needs the right finder or origin host. |
| Amazon | bespoke `amazon.jobs` | Planned M10. |
| Microsoft | bespoke `gcsservices` | Planned M10. |

**Tier 6 — manual check (9)**

Qualcomm, Atlassian, DigitalOcean, CHEQ, DE Shaw, Keychain AI, Moveworks, Google, VinFast.

Two distinct reasons, and the distinction matters:

- **Actively refusing automated access** — Qualcomm's Eightfold API returns HTTP 403, Atlassian's
  careers endpoint returns 401 without a token, Google is bot-protected. These stay manual by
  policy; we do not build evasion (ADR 008).
- **JavaScript-rendered with no reachable feed** — DigitalOcean, CHEQ, DE Shaw, Keychain AI,
  Moveworks. Their HTML carries no ATS marker and their sitemaps list no job postings. These could
  be reached later with a headless browser, which PRD §13 permits only when genuinely required.
  Deferred rather than refused.

Moveworks and Qualcomm both have a **confirmed Workday tenant** (`moveworks.wd12`, `qualcomm.wd12`)
but an unguessable site slug. Either becomes tier 2 the moment their real Workday URL is known.

VinFast is flagged: the URL supplied is a San Francisco dealership on ApplicantOne, not the
engineering org.

Dell and Samsung India are deactivated at Sarthak's request.

### Discovering a Workday tenant

The obvious approach does not work: `https://{tenant}.wd{N}.myworkdayjobs.com/` returns **HTTP 406
for everything** — a real tenant, a wrong shard, and a nonexistent tenant alike — and careers
subdomains (`careers.nvidia.com`, `careers.adobe.com`) are JavaScript marketing sites that never
redirect to Workday.

The CXS endpoint *does* discriminate. Posting to a deliberately bogus site slug:

```
POST /wday/cxs/{tenant}/__probe__/jobs
  -> 404   tenant + shard EXIST, only the site slug is wrong
  -> 422   tenant + shard do not exist
```

Verified against `nvidia.wd5` (404) versus `nvidia.wd1` (422) and a nonexistent tenant (422). This
resolves tenant and shard across all eight shards with one cheap request each, and is how Adobe,
Target and Salesforce were found.

The **site slug remains the hard part** — `NVIDIAExternalCareerSite`, `External_Career_Site`,
`targetcareers`, `Visa` and `external_experienced` share no convention, and a 30-candidate guess list
failed for Moveworks, Qualcomm and Visa (Visa was then resolved from a user-supplied URL). So the
human-supplied careers URL stays a design input for the last mile. `doctor` should run the 404/422
probe and ask for the URL only when the slug cannot be guessed.

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

`crawler/tests/conformance/` runs one parametrized module against **every registered adapter**,
replaying cassettes recorded from the live endpoints by `scripts/record_cassettes.py`. Adding an
adapter to `registry.py` subjects it to all of it automatically — that is the whole mechanism
behind "tested for every new company".

An adapter registered without a cassette **fails** rather than skipping. A silently untested
adapter is the exact thing this suite exists to prevent.

The assertions that matter most are the ones whose violation is invisible in production:

| Invariant | Why it is not obvious |
|---|---|
| `external_job_id` is byte-stable across identical runs | An unstable id makes every crawl look new, so the same job is emailed daily until the alerts are ignored entirely |
| ids are unique within a crawl | A collision silently overwrites one job with another at ingest |
| ids are not small integers | A bare ordinal is a list index, which makes identity depend on result ordering |
| `posted_at` is a real date or `None` | Workday returns `"Posted Today"` in that position; a naive parse yields garbage rather than an error |
| every recorded page is consumed | Stopping early reports success with a fraction of the jobs |
| `parse()` issues no requests | Purity is what the determinism guarantees rest on |
| output is byte-identical across runs | Catches hidden clock or ordering dependence |
| descriptions are bounded | Unbounded HTML blew D1's 100 KB statement limit in production |

Plus the ordinary hygiene: absolute https URLs, no HTML in titles, trimmed whitespace, a location
that is not accidentally a date, and `validate_config` rejecting an empty config.

Adapter-specific regressions live alongside in `crawler/tests/`, pinning the traps that are not
general — for instance that Workday is never asked for a page size above 20.

**Cassettes are recorded, not hand-written.** A hand-written fixture tests the adapter against
the shape you imagined, and the shape you imagined is exactly the one that never breaks.

Refresh them with:

```bash
python scripts/record_cassettes.py
```

## The live contract canary

Cassettes replay yesterday's truth forever. They cannot notice that an undocumented endpoint
changed shape overnight, and most of these endpoints are undocumented.

`crawler/contracts.py` does the other half: it hits the **real** endpoints and checks that the
fields each adapter depends on are still present and still parseable. It runs daily via
`contracts.yml`, on its own schedule, and fails loudly and independently of the crawl — a
contract break should be a red build, not a quiet dip in the number of jobs found.

```bash
python -m crawler.contracts
```

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
