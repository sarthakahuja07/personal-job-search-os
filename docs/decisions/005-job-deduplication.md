# 005 — Job identity and deduplication

**Status:** Accepted · 2026-09-05 · Required by PRD §17

## Context

The crawler is idempotent by requirement (PRD §64): re-running it must not create duplicate jobs
or re-send notifications. That depends entirely on a stable identity for a job across runs.

The failure mode is subtle and expensive. If a job's identity is unstable — derived from anything
that varies between crawls (list position, a session-scoped URL parameter, a scraped date string) —
every run creates "new" jobs and emails Sarthak about roles he has already seen, until he stops
trusting the notifications entirely.

## Decision

Primary key for identity: `UNIQUE (company_id, external_job_id)`.

`external_job_id` is the source's own stable requisition identifier — Greenhouse `id`, Lever `id`,
Workday `jobReqId`. Adapters must extract it from the payload, never synthesise it.

Fallback when a source exposes no stable id: the adapter derives `external_job_id` from the
normalized job URL. There is deliberately **no second unique constraint** on the URL — one
identity column, populated differently per source, so the constraint above covers both cases.

Deriving identity from the job *title* is forbidden — titles are edited in place upstream.

### URL normalization

Lowercase the scheme and host, drop a trailing slash, and remove **only known tracking
parameters** (`utm_*`, `gh_src`, `fbclid`, …). Remaining parameters are sorted so ordering cannot
change the identity between crawls.

Stripping the whole query string is wrong, and was a real bug: Greenhouse-hosted boards put the
job id *in the query*. Databricks postings are `.../open-positions/job?gh_jid=7979886003`, so
blanket stripping collapsed all 870 of their jobs onto a single URL. With a unique index on that
column it rejected 869 of 870 inserts; without one it would have silently deduplicated an entire
company down to one job — far worse, because nothing would have failed.

## Enforcement

The adapter conformance suite asserts that running the same recorded cassette twice produces
byte-identical `external_job_id` values. This test is the reason the guarantee holds; it catches
the class of bug that would otherwise only appear in production as duplicate emails.

## Consequences

- A company that re-posts a genuinely new requisition for the same role gets a new row. Correct.
- If an upstream source changes its id scheme, every job for that company appears new exactly once.
  The drift canary (ADR 008) is what surfaces this rather than a flood of emails.
