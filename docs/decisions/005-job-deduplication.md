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

Fallback when a source exposes no stable id: `UNIQUE (company_id, normalized_job_url)`, where
normalization lowercases the host, strips the query string and fragment, and removes a trailing
slash. An adapter using the fallback must declare it explicitly in its config so the weaker
guarantee is visible.

Deriving identity from the job *title* is forbidden — titles are edited in place upstream.

## Enforcement

The adapter conformance suite asserts that running the same recorded cassette twice produces
byte-identical `external_job_id` values. This test is the reason the guarantee holds; it catches
the class of bug that would otherwise only appear in production as duplicate emails.

## Consequences

- A company that re-posts a genuinely new requisition for the same role gets a new row. Correct.
- If an upstream source changes its id scheme, every job for that company appears new exactly once.
  The drift canary (ADR 008) is what surfaces this rather than a flood of emails.
