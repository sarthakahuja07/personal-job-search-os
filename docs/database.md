# Database

Cloudflare D1 (SQLite), accessed through Drizzle ORM. Schema lives in
[`app/src/db/schema.ts`](../app/src/db/schema.ts).

## Platform constraints that shape the design

| Limit | Value (free plan) | Consequence |
|---|---|---|
| Queries per Worker invocation | **50** | N+1 query patterns are forbidden in handlers. List endpoints must join or batch. |
| Database size | 500 MB | Not a practical concern at this scale. |
| Storage per account | 5 GB | — |
| Databases per account | 10 | — |

SQLite specifics: no `JSONB` (JSON is `TEXT`), limited `ALTER TABLE`, no native boolean (stored as
integer). Timestamps are stored as **integer Unix milliseconds**, not strings, so ordering and
arithmetic work without parsing.

---

## Tables

### `companies`

A target company and, critically, *how to crawl it*.

| Column | Notes |
|---|---|
| `source_type` | Which adapter handles it: `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `workday`, `custom_json`, `jsonld`, `html`, `manual` |
| `source_tier` | 1 (most stable) … 6 (manual). See [`crawlers.md`](crawlers.md) |
| `source_config` | JSON. Board token, Lever slug, Workday tenant/data-centre/site, CSS selectors — **everything company-specific that can be data** |
| `allow_zero_results` | Opt-in. Without it, a company returning zero jobs is `suspicious`, not `success` |
| `etag` / `last_modified` / `last_content_hash` | Conditional-request and content-hash short-circuits |
| `health_status` | `unknown` / `healthy` / `degraded` / `suspicious` / `failing` |
| `last_success_at`, `last_error` | Powers the health UI |

Adding a tier 1–2 company is inserting a row. No code change (PRD §97).

### `contacts`

Referral contacts, scoped to a company. Name, email, phone, notes — nothing more. This is
deliberately not a CRM (PRD §10).

### `jobs`

The normalized job record (PRD §16), plus relevance and lifecycle state.

| Column | Notes |
|---|---|
| `external_job_id` | **The source's own stable requisition id.** Never synthesised, never derived from a title |
| `normalized_job_url` | Lowercased host, query/fragment stripped — the fallback identity |
| `posted_at` | A real date or `NULL`. Never a display string |
| `is_relevant`, `match_score`, `match_reason` | Computed server-side at ingest from `settings` keywords; `match_reason` makes every decision auditable in the UI |
| `missing_run_count`, `closed_at` | Absence tracking — see deletion grace below |

### `applications`

Exactly five stages: `saved`, `requested`, `referred`, `applied`, `interviews` (PRD §30). Do not add
more without Sarthak asking.

`UNIQUE (job_id)` — one application per job, because the Kanban card *is* the job's pipeline state.
`requested_at` drives referral follow-up reminders.

### `templates`

Message bodies containing `{{variable}}` placeholders. Variables are **detected** by parsing the
body, never declared separately — so a template can be edited without a schema change.

### `notifications`

The outbox. Ingest writes rows here and never sends; a GitHub Actions step drains them over SMTP.

`dedup_key` is `UNIQUE` — e.g. `new_job:{jobId}`, `follow_up:{applicationId}:{n}`.

### `settings`

Single row (`id = 1`). Resume URL, notification address, include/exclude keywords, preferred
locations, `follow_up_days`, `close_after_missing_runs`.

Keywords live here rather than in code, so changing them takes effect immediately with **no crawler
redeploy**, and existing jobs can be re-matched retroactively.

### `crawl_runs`

One row per company per scheduled execution, grouped by `run_id`. Records status, tier, jobs found,
new jobs, duration, skip reason, and error.

This table is not merely a log — it is the input to volume-drift detection, and it is what makes a
silently broken adapter visible instead of indistinguishable from "no new jobs".

---

## Relationships

```
companies 1──* contacts
companies 1──* jobs
companies 1──* crawl_runs
jobs      1──1 applications
```

All child rows cascade on company delete. Deleting a company is genuinely destructive and should be
rare — deactivate (`active = false`) instead.

---

## The constraints that carry the guarantees

Three uniqueness constraints do most of the correctness work, because a constraint that *cannot* be
violated is worth more than a test asserting it usually isn't.

| Constraint | Prevents |
|---|---|
| `UNIQUE (company_id, external_job_id)` | Duplicate jobs on re-ingest — even if application logic has a bug |
| `UNIQUE (company_id, normalized_job_url)` | Duplicates for sources with no stable id |
| `UNIQUE (dedup_key)` on `notifications` | Duplicate emails, at the database level |
| `UNIQUE (job_id)` on `applications` | Two pipeline cards for one job |

Idempotency (PRD §64) is therefore structural rather than procedural. See
[ADR 005](decisions/005-job-deduplication.md) and
[ADR 007](decisions/007-ingest-boundary-and-notification-outbox.md).

## Deletion grace

Jobs missing from a crawl are **never hard-deleted**. Each successful run that does not observe a
job increments `missing_run_count`; `closed_at` is set only once it exceeds
`settings.close_after_missing_runs` (default 3).

A failed, suspicious, or skipped run does not increment anything. That distinction is the whole
point: without it, one broken adapter would close every job at a company in a single run
([ADR 008](decisions/008-crawler-correctness-strategy.md)).

## Indexes

Beyond the unique constraints: `companies(active)`, `companies(health_status)`,
`jobs(is_relevant)`, `jobs(discovered_at)`, `jobs(company_id)`, `jobs(closed_at)`,
`applications(status)`, `applications(requested_at)`, `notifications(status)`,
`crawl_runs(company_id | run_id | started_at)`.

These cover the actual query patterns: the job board filters on relevance and recency, the dashboard
filters applications by status and pending follow-ups, and the outbox drainer scans for `pending`.

---

## Migrations

Never mutate the schema by hand (PRD §56).

```bash
cd app
npx drizzle-kit generate                                   # edit schema.ts first
npx wrangler d1 migrations apply job-search-os --local
npx wrangler d1 migrations apply job-search-os --remote
```

Generated SQL lives in `app/src/db/migrations/` and is committed. Never edit a migration that has
already been applied remotely — add a new one.

Migrations are applied manually, not by CI. A bad migration against the only copy of the data is not
worth the convenience.

## Backup and portability

```bash
npx wrangler d1 export job-search-os --remote --output backup.sql
```

Plain SQL. All data belongs to Sarthak and nothing locks it into a proprietary format (PRD §98).
