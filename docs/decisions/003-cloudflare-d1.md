# 003 — Cloudflare D1 as the database

**Status:** Accepted · 2026-09-05

## Context

Expected scale is tiny: a few dozen companies, low thousands of jobs, one user. Cost target is $0.
The app runs on Workers (ADR 002), which makes D1 a native binding rather than a network hop.

Verified free-plan limits: 10 databases per account, 500 MB per database, 5 GB per account,
50 queries per Worker invocation, 30 s max query duration.

## Decision

Cloudflare D1 (SQLite), accessed via Drizzle ORM with `drizzle-kit` migrations.

The 50-queries-per-invocation cap is the one real constraint: it forbids N+1 query patterns in
request handlers. Repositories must use joins or batched `IN` lookups, and list endpoints must
never issue a query per row.

## Alternatives considered

- **Neon / Supabase Postgres.** More capable, but adds a network hop from the Worker, a second
  vendor, and a free tier that sleeps. Unjustified at this scale.
- **Turso.** Comparable, but D1's native binding is strictly simpler given Workers hosting.

## Consequences

- Zero-latency DB access from server code; no connection pooling to manage.
- SQLite dialect: no native `JSONB`, limited `ALTER TABLE`. JSON columns are `TEXT` with
  application-side parsing.
- 500 MB/db is ~100x more than this project will plausibly need.
- Data stays portable — `wrangler d1 export` produces plain SQL (PRD §98).
