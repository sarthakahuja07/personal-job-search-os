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

## Prep (study notes)

The write path from a study assistant into the prep tree, used by the local MCP server in
`mcp/`. Same two-layer auth as ingest: Access in front, bearer token in the handler. Nothing
here is publicly reachable — the MCP server runs on Sarthak's machine and holds both.

### `GET /api/prep/tree`

Where a page can be published, and what each discipline expects.

Returns `kinds` (with each one's structured `content` fields) and `folders` — the sections a
page can be filed under, as `parent_path` strings.

`folders` is deliberately not every page. A destination is a page with children, plus the top
level of any kind whose tree has depth. Two looser rules were tried and both made the list
useless: "has children" hides a section nobody has filled yet (LLD), and "also every top-level
page" buries the seven real sections under 36 flat DSA and behavioral notes.

### `GET /api/prep/pages?q=<text>&kind=<kind>`

Existing pages matching free text, so a duplicate can be found before it is written. Matches
titles and prompts only — searching bodies would match every page that merely *mentions* the
topic, which is the opposite of a duplicate check.

### `POST /api/prep/pages`

Publish one page with its resources. Body is `prepPageSchema` (`src/server/schemas/prep-import.ts`).

| Field | Notes |
|---|---|
| `kind` | `dsa`, `system_design`, `behavioral`, `concept` |
| `title` | Required. The slug is derived from it, and is the page's address |
| `parent_path` | Slug path *within* the kind, e.g. `hld/questions`. Empty means top level |
| `frequency` | The "ask score", 1–5. Drives the default sort, so 0 makes a page invisible |
| `difficulty`, `topics`, `companies` | Filters the board is read by |
| `body` | The note, as Markdown |
| `content` | Discipline fields — `pattern`/`complexity` (DSA), `requirements`/`architecture`/`tradeoffs` (system design), `situation`/`action`/`outcome` (behavioral) |
| `resources` | `[{url, title}]`. YouTube links are stored as videos with the id extracted, by the same code that classifies a pasted link |
| `on_conflict` | `error` (default), `merge`, `replace` |

Returns `201` on create, `200` on merge/replace, `404` if `parent_path` does not resolve, and
`409` if the page exists and `on_conflict` is `error`.

The conflict default is the important part. A study assistant runs unattended over notes that
took weeks to write: silently overwriting loses work and silently duplicating makes the tree
unusable, and both look like success from the caller's side. `merge` fills only empty fields and
adds resources, so a hand-written body survives a second pass over the same topic.

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
