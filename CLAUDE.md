# CLAUDE.md — Personal Job Search OS

## Project overview

A private, single-user web application that helps **Sarthak** (ex-Uber SWE, targeting
SDE-2 / SWE-2 / Software Engineer II roles) discover relevant openings early, use referrals
efficiently, track applications, and later organise interview preparation.

**Primary goal:** discover relevant jobs as early as possible so a referral can be requested and an
application submitted before the posting is flooded.

Not a SaaS product. One user. Private. Free to run.

## Current phase

**Phase 0 (job discovery) is deployed and running.** A crawl runs every 6 hours, ingests, and
emails a digest of genuinely new matches.

**Phase 1 (interview preparation) is built** with starter content: DSA, System Design and
Behavioral, each with progress tracking. Importing Sarthak's Notion material is still to come —
the schema was shaped to absorb it rather than be reshaped by it.

## The one thing to understand

**The crawler is the product.** Every other Phase 0 feature is a view over data the crawler
produces. Job discovery being late, incomplete, or silently broken is the only failure that
actually matters.

The dangerous failure mode is not a crash — a crash is loud and gets fixed. It is a crawler that
returns **zero jobs, successfully, forever**, which is indistinguishable from "no new jobs this
week." Read `docs/decisions/008-crawler-correctness-strategy.md` before touching `crawler/`.

## Architecture

| Concern | Choice |
|---|---|
| Frontend + backend | Next.js 16 (App Router, TypeScript) on Cloudflare Workers via `@opennextjs/cloudflare` |
| UI | Tailwind CSS + shadcn/ui |
| Database | Cloudflare D1 (SQLite) via Drizzle ORM |
| Crawler | Python 3.12, `httpx` + BeautifulSoup |
| Scheduling | GitHub Actions (`crawl.yml` every 3h, `contracts.yml` daily) |
| Email | Gmail SMTP from GitHub Actions (`smtplib`) |
| Auth | Cloudflare Access on the `*.workers.dev` URL |

There is **no Go backend**. The PRD proposed one; it is incompatible with D1 and free Cloudflare
hosting. See `docs/decisions/002-typescript-on-workers.md` — that ADR supersedes PRD §46.

```
Browser ──(Cloudflare Access)──▶ Next.js on Workers ──binding──▶ D1
                                        ▲
GitHub Actions ── Python crawler ───────┘  POST /api/ingest/jobs
               └─ outbox drainer ── Gmail SMTP ──▶ Sarthak
```

## Repository structure

| Path | Responsibility |
|---|---|
| `app/src/app/` | Next.js routes; also the API under `api/` |
| `app/src/features/` | UI organised by feature (dashboard, jobs, companies, …) |
| `app/src/server/domain/` | Pure business logic. Relevance matching and prep routing live here. |
| `app/src/app/prep/[kind]/` | Preparation, one dynamic route for all disciplines |
| `app/src/server/service/` | Orchestration: ingest, jobs, applications, notifications |
| `app/src/server/repository/` | **The only code that touches D1** |
| `app/src/db/` | Drizzle schema + generated migrations |
| `crawler/adapters/` | One adapter per source platform. Fetch/parse/normalize only. |
| `crawler/tests/conformance/` | Runs against *every* registered adapter |
| `crawler/tests/cassettes/` | Recorded real HTTP responses; tests never hit the network |
| `docs/decisions/` | ADRs — read these before changing architecture |

## Non-negotiable invariants

1. **Adapters fetch, parse, normalize — nothing else.** No dedup, no matching, no notifications, no
   DB writes (PRD §15). This purity is what makes them exhaustively testable.
2. **The server owns all business logic.** Dedup, matching, new-job detection and notification
   creation happen at ingest. Match keywords live in `settings`, not code, so changing them needs no
   crawler redeploy.
3. **Notifications go through the outbox.** Ingest writes rows with a `UNIQUE dedup_key`; a separate
   step sends them. Never send email from ingest.
4. **`external_job_id` must be the source's own stable id.** Never synthesise it, never derive it
   from a title. See ADR 005.
5. **Zero results is an error by default.** A company that previously returned jobs and now returns
   none is `suspicious`, not `success`.
6. **Never hard-delete jobs missing from a crawl.** Set `closed_at` only after N consecutive
   *successful* runs, so a broken adapter cannot wipe the board.
7. **No anti-bot evasion.** Sites that signal they do not want automated access become Tier 6
   (manual check) with a dashboard reminder. Do not spoof fingerprints or solve challenges.
8. **No secrets in the repo.** GitHub Secrets and Wrangler secrets only. `.dev.vars` and `.env`
   are gitignored.
9. **A new prep discipline is one entry in `KINDS`**, not a new set of pages. `prep_items` uses a
   `kind` discriminator with discipline-specific fields in a JSON `content` column, so low-level
   design or a Golang round is data, not a migration.

## Development commands

Run from `app/` unless noted.

| Task | Command |
|---|---|
| Dev server | `npm run dev` |
| Build | `npm run build` |
| Deploy | `npm run deploy` |
| TS tests | `npm run test` |
| Generate migration | `npx drizzle-kit generate` |
| Apply migrations (local) | `npx wrangler d1 migrations apply job-search-os --local` |
| Apply migrations (remote) | `npx wrangler d1 migrations apply job-search-os --remote` |
| Regenerate binding types | `npx wrangler types` |
| Crawler tests (repo root) | `pytest crawler/tests` |
| Validate a job source | `python -m crawler doctor <careers-url>` |
| Run crawler locally | `python -m crawler.main --dry-run` |

## Important constraints

- Single user, private application — never expose publicly.
- Free infrastructure only. **Do not introduce paid services without asking Sarthak** (PRD §48).
- Production-quality modular code, without production complexity: no microservices, no Kubernetes,
  no queues, no Redis (PRD §87).
- Prefer the simplest solution that reliably solves the current problem.

## Working procedure

Before writing code: read this file, the relevant ADRs, and `docs/progress.md`. Do not re-ask for
context that is already documented (PRD §83).

A feature is done when it works, important tests pass, errors are handled, code is modular, and
documentation + `docs/progress.md` are updated (PRD §85). Compiling is not completion.

## Current status

See `docs/progress.md`. Phase 0, milestone M0 (foundation) in progress.
