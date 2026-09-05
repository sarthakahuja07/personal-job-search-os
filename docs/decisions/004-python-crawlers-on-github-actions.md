# 004 — Python crawlers, scheduled by GitHub Actions

**Status:** Accepted · 2026-09-05

## Context

Job discovery must run on a schedule without an always-on server (PRD §48). The app itself runs
on Workers, so Workers Cron Triggers were a candidate. But crawling is long-running, network-bound,
and occasionally needs HTML parsing — a poor fit for Workers CPU limits, and PRD §13 prefers Python
with `requests`/BeautifulSoup for exactly this.

## Decision

Crawlers are Python, executed by a scheduled GitHub Actions workflow (`crawl.yml`, every 3 hours).
The crawler holds no credentials for the database — it POSTs normalized jobs to the app's ingest
endpoint (ADR 007) and never writes to D1 directly.

`httpx.AsyncClient` is used rather than `requests`, for bounded concurrency across companies.
BeautifulSoup remains the parser for Tier 4/5 HTML sources.

## Alternatives considered

- **Workers Cron Triggers.** Rejected: CPU/wall-clock limits are hostile to multi-company crawls
  with per-job detail fetches, and it would force the crawler into TypeScript against PRD §13.
- **Crawler writes to D1 directly via the REST API.** Rejected — see ADR 007.

## Consequences

- Free within GitHub Actions limits. At 8 runs/day and ~2 min/run, roughly 480 of the 2,000
  monthly private-repo minutes. Budget must be re-checked if the cadence increases.
- Secrets (ingest token, SMTP password) live in GitHub Secrets, never in the repo (PRD §79).
- The crawler is independently runnable on a laptop, which makes `doctor` and debugging easy.
