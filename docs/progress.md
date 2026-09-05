# Progress and open work

The durable state of this project. Updated whenever something meaningful lands, so no context is
lost between sessions (PRD §73). Picking this up cold: read `CLAUDE.md` first, then this file.

**Last updated:** 2026-09-05

---

## Where things stand

Phase 0 **works end to end locally**: the crawler discovers real jobs from 14 companies, ingest
deduplicates and scores them, and the job board displays them. Nothing is deployed yet.

| Milestone | State |
|---|---|
| M0 Foundation | done |
| M1 Companies / contacts / settings | partial — data seeded, no CRUD UI |
| M2 Ingest pipeline | done |
| M3 Crawler core + 5 adapters | done — conformance suite still missing |
| M4 Scheduling, health, drift | done — crawl.yml (6-hourly), ci.yml, deploy.yml |
| M5 Job board | partial — board, dashboard, company health, settings, notifications; no job detail page |
| M6 Notifications | done — SMTP digest drainer + history page; needs an app password to actually send |
| M7 Templates | not started |
| M8 Applications Kanban | not started |
| M9 Dashboard | partial — first version done |
| M10 Deferred adapters | deliberately deferred |

---

## Next up, in order

1. **Deploy** — `wrangler login`, create D1, set secrets, enable Cloudflare Access. Blocked on
   Sarthak; everything else is ready and running locally.
2. **M3 conformance suite** — the parametrized every-adapter suite plus recorded cassettes.
3. **`contracts.yml`** — the daily live-schema canary. Not yet written.
4. **M7 Templates** — referral messages with `{{variables}}`.
5. **M8 Applications Kanban** — the five stages.
6. **M5 Job detail page** — description, contacts inline, quick actions.
7. **M1 CRUD UI** — manage companies and contacts in-app rather than via the seed script.
8. **M10 Deferred adapters** — one at a time, only once the product is complete.

---

## Blocked on Sarthak

| Item | Why it matters |
|---|---|
| `npx wrangler login` | Create D1 and deploy. Nothing is live without it. |
| `gh auth login` + repo name | Required for Actions scheduling. Proposed: `personal-job-search-os`. |
| Gmail app password + notify address | Notifications cannot send. Needs 2FA on the account. |
| Canonical resume link | Used by message templates. |
| **VinFast careers URL** | The URL supplied is a San Francisco *dealership* on ApplicantOne, not the engineering org. |
| **Moveworks / Qualcomm Workday URL** | Both tenants confirmed (`moveworks.wd12`, `qualcomm.wd12`); only the site slug is missing. Either flips to config-only instantly. |
| **Drishika's phone or LinkedIn** | The only Atlassian contact, with no details recorded. |

---

## Company coverage — 14 of 29 crawled automatically

Full detail in [`crawlers.md`](crawlers.md).

**Crawled (14)** — Greenhouse: Databricks, Roku, Uber Freight, Postman · SmartRecruiters:
ServiceNow, Swiggy · Ashby: Sarvam AI, Confluent · Lever: Zeta Suite · Workday: NVIDIA, Adobe,
Salesforce, Target, Visa.

**Manual, with a dashboard link (15)** — deferred by decision, not failure:

- *Adapter deferred until the product is complete*: Intuit (endpoint verified and working — closest
  to ready), Akamai (Oracle stack identified, API path unresolved), Amazon, Microsoft.
- *Refusing automated access*: Qualcomm (Eightfold 403), Atlassian (401), Google. Manual by policy;
  no evasion (ADR 008).
- *JavaScript-rendered, no reachable feed*: DigitalOcean, CHEQ, DE Shaw, Keychain AI, Moveworks.
  Reachable later via a headless browser or an HTML/JSON-LD fallback adapter.
- *Needs a corrected URL*: VinFast.

**Deactivated (2)** — Dell and Samsung India, at Sarthak's request.

---

## Bugs found and fixed, and what each would have cost

Recorded because every one was invisible until specifically hunted, and the class will recur.

| Bug | Symptom | Why it mattered |
|---|---|---|
| **Workday `total` only on page 1** | Later pages report `total: 0` while still returning results | Crawl stopped at 40 of NVIDIA's 2000 jobs **and reported success**. Pure silent truncation. |
| **URL normalization stripped the query** | All 870 Databricks jobs normalized to one URL | Greenhouse puts the job id in `?gh_jid=`. Would have collapsed a whole company to one job. |
| **Second unique index on the URL** | `UNIQUE constraint failed` on 869 of 870 inserts | The URL is a *fallback* identity, never an independent constraint. ADR 005 corrected. |
| **Anchored title pattern** | `^software engineer$` matched almost nothing | Silently rejected 194 of 1334 live postings — every title with a suffix. |
| **"Remote" matched foreign remote** | `Italy, Remote`, `US, FL, Remote` | Would have surfaced dozens of unreachable roles as matches. |
| **`\bstaff\b` over-matched** | Killed "Member of Technical Staff 2" | That is the SDE-2 title at several companies. |
| **Sequential Workday pagination** | Target exceeded its 180 s budget and returned 0 | Correctly flagged `degraded` rather than silently empty — the guard working as intended. |

Each is pinned by a regression test using the real input that exposed it.

---

## Politeness and adaptivity

Deliberately conservative (`crawler/http/client.py`):

- **Adaptive per-host pacing** — starts at 350 ms, decays toward 80 ms only after five consecutive
  clean responses, multiplies by 2.5 on any 429/5xx. A fixed delay is either rude to small sites or
  needlessly slow against large ones.
- **`Retry-After` always obeyed**, up to two minutes. A 429 widens the delay immediately.
- **Per-host concurrency capped at 3**, with the delay applied *inside* the semaphore so it limits
  the actual request rate rather than merely delaying the caller.
- **Per-company budgets** — 1500 requests / 600 s — so one pathological board cannot consume a run.
- **Honest User-Agent** naming the tool and stating that it respects `robots.txt` and `Retry-After`.
- **Detail fetches only for title-gate survivors** — NVIDIA: 2000 postings, ~40 candidates, ~18
  detail requests. The single largest politeness win in the system.

---

## Verified by running it, not assumed

- Re-running a crawl creates **zero** new jobs and **zero** notifications.
- `UNIQUE (company_id, external_job_id)` rejects a duplicate at the database level.
- A company that returned jobs and now returns none is marked `suspicious`, and its jobs are **not**
  closed.
- Failed, skipped and degraded runs never mutate job presence state.
- Bootstrap and ingest both reject unauthenticated requests with 401.
- 112 TypeScript tests, 6 Python tests, `tsc --noEmit` clean, `ruff check crawler` clean.
- A full crawl of 14 companies completes in about two minutes with zero failures: 104 jobs
  ingested, 16 relevant, 16 notifications queued.
- The notification digest renders real matches with their explanations and resolves the recipient
  from settings.

---

## Known gaps

- **No conformance suite.** Planned in M3 and not built. Adapters have targeted regression tests
  (Workday) but the parametrized every-adapter suite and recorded cassettes do not exist. This is
  the largest outstanding piece of crawler-correctness work.
- **No cassettes.** Crawler tests use hand-built fakes, so adding a company still needs a live run.
- **No `doctor` CLI.** Adding a company means editing the seed script.
- **No conditional requests.** `etag` / `last_content_hash` are stored and sent to ingest, but
  adapters do not yet send `If-None-Match`, so nothing short-circuits on a 304.
- **Descriptions truncated** to 8000 chars of plain text — deliberate: D1 caps a statement at 100 KB
  and raw Databricks HTML exceeds 20 KB per job.
- **Contact data is not in git.** It lives only in the local D1 and the scratchpad seed script, so a
  fresh clone has companies but no contacts until re-seeded.
