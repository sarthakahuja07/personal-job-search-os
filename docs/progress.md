# Progress

Updated after each meaningful milestone (PRD §73).

## Phase 0 — Job discovery and application workflow

### M0 — Foundation  *(mostly complete — blocked on Cloudflare/GitHub credentials)*

**Done**

- [x] Repository skeleton (`app/`, `crawler/`, `docs/`, `.github/`, `scripts/`)
- [x] `.gitignore`, `README.md`, `CLAUDE.md`
- [x] ADRs 001–009
- [x] Docs: architecture, development, infrastructure, database, api, crawlers, engineering-principles
- [x] Python 3.12.10 + venv + crawler dependencies (httpx, bs4, pydantic, pytest, vcrpy, respx)
- [x] GitHub CLI 2.100.0
- [x] Node 24.19.0 LTS (Node 20 was end-of-life; `create-cloudflare` requires ≥22)
- [x] Next.js 16.3.4 + React 19.2.8 + Tailwind 4 + TypeScript
- [x] `@opennextjs/cloudflare` 1.20.6 adapter wired (ADR 009 — **not** vinext)
- [x] Drizzle ORM 0.45.2 + drizzle-kit 0.31.10, schema for all 8 tables
- [x] First migration generated and applied to **local** D1 (27 statements)
- [x] `NormalizedJob` pydantic contract with boundary validation
- [x] `npm run build` passes; `tsc --noEmit` clean

**Verified, not assumed**

- [x] `UNIQUE (company_id, external_job_id)` rejects a duplicate job at the database level
      (`SQLITE_CONSTRAINT_UNIQUE`) — the guarantee behind ADR 005
- [x] `NormalizedJob` rejects a relative date (`"Posted Today"`), HTML in titles, relative URLs,
      and list-index-shaped ids

**Blocked on Sarthak**

- [ ] `wrangler login` → `wrangler d1 create job-search-os` → real `database_id` in `wrangler.jsonc`
      (currently `REPLACE_AFTER_WRANGLER_D1_CREATE`)
- [ ] Apply migrations to remote D1
- [ ] Deploy, then enable Cloudflare Access on the `workers.dev` URL
- [ ] `gh auth login` → create repository → push

**Done when:** the deployed URL is live and challenges a logged-out browser for login.

### M1 — Companies, contacts, settings — not started
### M2 — Ingest pipeline (dedup, matching, idempotency) — not started
### M3 — Crawler core (adapter contract, conformance suite, doctor CLI, Greenhouse + Lever) — not started
### M4 — Workday adapter, schedule, health + drift detection — not started
### M5 — Job board + job detail — not started
### M6 — Notifications (outbox drainer, history) — not started
### M7 — Message templates — not started
### M8 — Applications Kanban — not started
### M9 — Dashboard — not started
### M10 — Bespoke big-tech adapters — not started

## Phase 1 — Interview preparation

Not started. Structure to be finalised once Sarthak provides his existing Notion content.

## Open items needing Sarthak

- [ ] `wrangler login` — required to create D1 and deploy
- [ ] `gh auth login` + confirm repository name (proposed: `personal-job-search-os`)
- [ ] **Target company list** — the highest-value input; drives adapter sequencing
- [ ] Gmail app password + notification address (requires 2FA on the account)
- [ ] Canonical resume link

## Notes worth keeping

Three separate tools reported **exit code 0 while failing** during M0: `create-cloudflare` on a Node
version check, `create-cloudflare` again on an unsupported framework, and an `npm install` whose
ERESOLVE failure was masked by a shell pipe. This is the same failure class the crawler design
targets — a green signal that means nothing. It is why `crawl.yml` must assert *outcomes* (jobs
ingested, notifications sent) rather than step completion.
