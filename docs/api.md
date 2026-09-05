# API

All endpoints live under `/api` in the Next.js app, implemented as route handlers.

**Authentication.** Cloudflare Access fronts the entire Worker, so browser requests are already
authenticated by the time they arrive ([ADR 006](decisions/006-single-user-auth.md)). Machine
routes under `/api/ingest` and `/api/notifications` additionally require:

| Header | Purpose |
|---|---|
| `CF-Access-Client-Id` / `CF-Access-Client-Secret` | Access service token (edge layer) |
| `Authorization: Bearer <INGEST_TOKEN>` | Application layer, verified in the handler |

Two independent layers, so a misconfigured Access policy cannot silently open a write path.

**Errors.** Uniform shape, appropriate status codes:

```json
{ "error": { "code": "validation_failed", "message": "...", "details": [...] } }
```

| Status | Meaning |
|---|---|
| 400 | Request body failed validation |
| 401 | Missing or invalid bearer token |
| 404 | Entity not found |
| 409 | Conflict (e.g. duplicate company name) |
| 500 | Unhandled server error — logged, never leaked to the client |

---

## Ingest

### `POST /api/ingest/jobs`

The single write path from crawler to database. **The most important endpoint in the system.**

The crawler sends normalized jobs and nothing else. Deduplication, relevance matching, new-job
detection and notification creation all happen here, server-side
([ADR 007](decisions/007-ingest-boundary-and-notification-outbox.md)).

**Request**

```jsonc
{
  "run_id": "2026-09-05T12:00:00Z-abc123",   // groups a scheduled execution
  "company_id": "uuid",
  "tier": 2,
  "status": "success",                        // success | failed | suspicious | degraded | skipped
  "skip_reason": null,                        // e.g. "304_not_modified"
  "error": null,
  "duration_ms": 4210,
  "etag": "W/\"abc\"",                        // echoed back for the next conditional request
  "content_hash": "sha256:...",
  "jobs": [
    {
      "external_job_id": "R-123456",          // the source's own stable id — required
      "title": "Software Engineer II",
      "location": "Bengaluru, India",
      "department": "Engineering",
      "description": "<p>...</p>",
      "job_url": "https://example.com/jobs/R-123456",
      "posted_at": "2026-09-03",              // ISO date or null. NEVER a display string
      "employment_type": "Full time",
      "raw_metadata": {}
    }
  ]
}
```

**Response**

```jsonc
{
  "run_id": "...",
  "company_id": "...",
  "received": 214,
  "created": 3,
  "updated": 211,
  "relevant_new": 1,
  "notifications_queued": 1,
  "status_recorded": "success",
  "warnings": ["job R-99: posted_at omitted"]
}
```

**Behaviour**

1. Validate. A malformed job rejects the whole request — partial ingestion of a broken payload is
   worse than none.
2. Upsert on `(company_id, external_job_id)`, falling back to `(company_id, normalized_job_url)`.
3. Run relevance matching using the keywords in `settings`.
4. A job is **new** iff the insert created a row.
5. Queue a `new_job` notification for each new *relevant* job, keyed `new_job:{job_id}`.
6. Reset `missing_run_count` for observed jobs; increment it for unobserved ones **only when
   `status == "success"`**.
7. Record a `crawl_runs` row and update company health.

**Idempotency.** Posting the same payload twice creates zero jobs and zero notifications the second
time. This is guaranteed by unique constraints, not by handler logic, and is directly tested
(PRD §64).

**Zero-result guard.** If `jobs` is empty, the company has previously returned jobs, and
`allow_zero_results` is false, the run is recorded as `suspicious` — never `success` — and no
`missing_run_count` is incremented.

### `POST /api/ingest/validate`

Dry run for the "Test this source" flow. Same payload shape; validates, matches, and returns a
preview **without writing anything**. Used to prove an adapter works before a company is saved.

---

## Notifications

### `GET /api/notifications/outbox`

Returns pending notifications for the Actions drainer.

```jsonc
{ "notifications": [ { "id": "uuid", "dedup_key": "new_job:...", "type": "new_job", "payload": {} } ] }
```

### `POST /api/notifications/{id}/delivered`

Marks one notification `sent` (or `failed` with an error). Split from the fetch deliberately: a
crash between sending and confirming re-sends at most one message, never a flood.

---

## Resource endpoints

Standard REST, used by the UI.

| Method | Path | Purpose |
|---|---|---|
| `GET` / `POST` | `/api/companies` | List / create |
| `GET` / `PATCH` / `DELETE` | `/api/companies/{id}` | Read / update / delete (cascades) |
| `POST` | `/api/companies/detect` | Given a careers URL, return the detected source type + config. Pure URL pattern matching for tiers 1–2 |
| `POST` | `/api/companies/{id}/test` | Trigger a `workflow_dispatch` validation run |
| `GET` / `POST` | `/api/contacts` | Scoped by `?company_id=` |
| `GET` / `PATCH` / `DELETE` | `/api/contacts/{id}` | |
| `GET` | `/api/jobs` | Filters: `company_id`, `relevant`, `location`, `new_since`, `status`, `q`. Sorts: `discovered_at`, `posted_at`, `company`, `title`. Paginated |
| `GET` | `/api/jobs/{id}` | Job detail with company and contacts |
| `GET` / `POST` | `/api/applications` | |
| `PATCH` | `/api/applications/{id}` | Status transitions; stage timestamps are set server-side |
| `GET` / `POST` | `/api/templates` | |
| `POST` | `/api/templates/{id}/render` | Fill variables, return the final message |
| `GET` / `PATCH` | `/api/settings` | Single row |
| `GET` | `/api/health/crawlers` | Per-company health, last success, last error |

### Query budget

D1 permits **50 queries per Worker invocation**. List endpoints must use joins or batched `IN`
lookups — never a query per row. `/api/jobs` returning 50 jobs must not issue 50 company lookups.

---

## Conventions

- Request and response bodies are `snake_case` JSON; internal TypeScript is `camelCase`, mapped in
  the repository layer.
- Timestamps on the wire are ISO 8601 strings; stored as integer Unix milliseconds.
- All input is validated with zod at the handler boundary before reaching a service.
- Handlers contain no business logic and no SQL — they parse, delegate, and serialise.
