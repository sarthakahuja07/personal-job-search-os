# Architecture

## High-level

```
                        Browser
                           |
                  Cloudflare Access          <- one allowed email, free tier
                           |
              +------------------------+
              |  Next.js 16 on Workers |     <- UI and API in one deployable
              |       (OpenNext)       |
              +-----------+------------+
                          | binding
                    Cloudflare D1
                          ^
                          | POST /api/ingest/jobs
                          |   (Access service token + bearer secret)
                          |
              +------------------------+
              |     GitHub Actions     |
              |  crawl.yml    (3h)     |----> Python crawler: fetch/parse/normalize
              |  contracts.yml (daily) |----> live schema canary
              |  outbox drain          |----> Gmail SMTP -> Sarthak
              +------------------------+
```

Three components, one repository. The web app owns all state and business logic. The crawler is a
stateless job that produces normalized data and hands it over. GitHub Actions is the scheduler.

There is no Go backend and no separate API service. See
[ADR 002](decisions/002-typescript-on-workers.md).

---

## Component responsibilities

### Web app (`app/`)

Next.js 16 on Cloudflare Workers. Serves the UI and hosts the API under `/api`. Owns:

- All database access, through repositories
- Deduplication, relevance matching, new-job detection
- Notification creation (never sending)
- Application pipeline state

Internal layering (PRD §52):

```
HTTP request -> handler -> service -> repository -> D1
                              |
                            domain (pure logic)
```

Only repositories touch D1. Only domain code is pure. Handlers never contain business logic.

### Crawler (`crawler/`)

Python 3.12, executed by GitHub Actions. Fetches job listings from target companies, parses them,
and normalizes them into a common shape. It then POSTs them to the ingest endpoint.

It holds no database credentials and contains no business logic — no deduplication, no matching, no
notification decisions (PRD §15). This constraint is what makes adapters pure enough to be
exhaustively tested. See [`crawlers.md`](crawlers.md).

### Scheduler (`.github/workflows/`)

| Workflow | Cadence | Does |
|---|---|---|
| `crawl.yml` | every 3h | run crawler, POST to ingest, drain notification outbox over SMTP |
| `contracts.yml` | daily | hit real endpoints, validate live response shape against cassettes |
| `ci.yml` | on push | TypeScript tests, Python tests, lint |
| `deploy.yml` | on push to main | build and deploy the Worker |

### Database (Cloudflare D1)

SQLite, accessed via a native Workers binding. Migrations managed by `drizzle-kit`. See
[`database.md`](database.md).

---

## Key data flows

### Job discovery

```
GitHub Actions (cron)
   -> orchestrator loads active companies from the app
   -> per company: resolve adapter by source_type
        -> fetch (paginated, conditional GET, bounded concurrency)
        -> parse -> NormalizedJob (validated at the boundary)
   -> POST /api/ingest/jobs
        -> deduplicate on (company_id, external_job_id)
        -> relevance match against settings keywords
        -> insert new jobs, update existing
        -> write notification outbox rows for new relevant jobs
        -> record crawl_runs (counts, duration, tier, status)
   -> drain outbox over Gmail SMTP
   -> mark notifications sent
```

Failure of one company never aborts the run. Every outcome lands in `crawl_runs`.

### Why the split is where it is

The component that *knows* a job is new (the app, which owns the database) is not the component that
*can send email* (the Actions runner, since Workers cannot practically speak SMTP). The outbox
resolves this: ingest writes intent, the runner performs delivery, and delivery state is persisted
either way. See [ADR 007](decisions/007-ingest-boundary-and-notification-outbox.md).

### Referral follow-up

```
Application enters "Requested" -> requested_at set
   -> scheduled check compares age against settings.follow_up_days
   -> notification outbox row (dedup_key = follow_up:{application_id}:{n})
   -> dashboard surfaces it; email digest includes it
```

### Adding a company

```
paste careers URL -> detect() (pure regex, tiers 1-2 need no network)
   -> validate_config() -> dry-run fetch -> preview -> save
```

Tiers 1–2 require no code change (PRD §97).

---

## Idempotency

Required by PRD §64, and enforced structurally rather than procedurally:

| Operation | Guarantee |
|---|---|
| Job insert | `UNIQUE (company_id, external_job_id)` |
| New-job detection | A job is new iff the insert created a row |
| Notification | `UNIQUE dedup_key` on the outbox |
| Crawler run | Adapters are pure; identical input yields identical `external_job_id`s |

The weakest link is `external_job_id` stability, which is why the conformance suite asserts it
directly. See [ADR 005](decisions/005-job-deduplication.md).

---

## Security

- Cloudflare Access fronts the entire Worker; one allowed email ([ADR 006](decisions/006-single-user-auth.md)).
- Ingest routes additionally verify a bearer secret, so a misconfigured Access policy cannot
  silently open a write path.
- Secrets live in GitHub Secrets and Wrangler secrets. Never in the repository (PRD §79).
- Input is validated at the API boundary.

## Scale and cost

Designed for a few dozen companies, low thousands of jobs, one user. Not for multi-tenancy or SaaS
scale (PRD §60). Runs at $0/month on free tiers; paid infrastructure is never introduced without
explicit approval (PRD §48).

The one real platform constraint is D1's **50 queries per Worker invocation** — it forbids N+1
query patterns in request handlers. List endpoints must use joins or batched lookups.
