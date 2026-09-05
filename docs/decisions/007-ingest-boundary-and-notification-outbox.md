# 007 — Ingest boundary and the notification outbox

**Status:** Accepted · 2026-09-05 · Required by PRD §89

## Context

Two questions had to be settled together: how does the crawler get data into the database, and
where do notifications get sent from?

PRD §15 says adapters must not send notifications or contain application logic. PRD §64 requires
that repeated runs never create duplicate jobs or duplicate emails. And the chosen email channel
is Gmail SMTP from GitHub Actions (Workers cannot practically speak SMTP).

That last constraint creates a real tension: the component that *knows* a job is new (the app,
which owns the database) is not the component that *can send email* (the Actions runner).

## Decision

**Ingest boundary.** The crawler POSTs normalized jobs to `POST /api/ingest/jobs`, authenticated by
an Access service token plus a bearer secret. It does not touch D1. Deduplication, relevance
matching, new-job detection, and notification creation all happen server-side, in one transaction-
shaped code path.

**Outbox.** Ingest never sends anything. It writes rows to `notifications` with a `UNIQUE dedup_key`
(e.g. `new_job:{job_id}`). A separate Actions step drains unsent rows over SMTP and marks each
`sent`. Idempotency is therefore structural rather than procedural: the unique constraint makes a
duplicate notification unrepresentable, and a crash between "send" and "mark sent" can at worst
re-send one message, never a flood.

## Alternatives considered

- **Crawler writes to D1 via the REST API.** Rejected: business logic would have to be duplicated
  in Python, the crawler would hold database credentials, and PRD §15 forbids adapters owning
  application logic.
- **Ingest returns the new jobs, and the Action emails them directly.** Rejected: delivery state
  would live nowhere, so a failed send would be lost silently and PRD §35's notification history
  would be unimplementable.

## Consequences

- Matching keywords are stored in `settings` and applied server-side, so changing them takes effect
  immediately with no crawler redeploy, and existing jobs can be re-matched retroactively.
- The crawler stays genuinely dumb, which is what makes the conformance suite (ADR 008) possible —
  adapters are pure enough to test exhaustively against recorded fixtures.
- Notification history and delivery failures are queryable, satisfying PRD §35.
- One extra HTTP round trip per crawl run. Irrelevant at this scale.
