# Development

Goal: clone the repository and have the application running locally.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | **24 LTS** (≥22 required) | `create-cloudflare` refuses anything below 22; Node 20 is end-of-life |
| Python | **3.12** | Crawler runtime |
| Git | any recent | |
| GitHub CLI | 2.x | Repository and Actions management |
| Wrangler | via `npx` | Installed as a dev dependency of `app/`; no global install needed |

On Windows these install cleanly via winget:

```powershell
winget install --id OpenJS.NodeJS.LTS --source winget
winget install --id Python.Python.3.12 --source winget
winget install --id GitHub.cli --source winget
```

The Node installer requires administrator approval — expect a UAC prompt.

> **OneDrive note.** If the repository lives inside a OneDrive-synced folder, exclude it from sync
> or move it (e.g. to `C:\dev\`). `node_modules` in a synced directory causes sync churn, file locks
> during installs, and occasionally corrupted dependency trees.

---

## First-time setup

```bash
git clone <repo-url> personal-job-search-os
cd personal-job-search-os

# web app
cd app
npm install
cd ..

# crawler
python -m venv .venv
.venv/Scripts/activate          # Windows
# source .venv/bin/activate     # macOS / Linux
pip install -r crawler/requirements.txt
```

### Local environment

The app reads local secrets from `app/.dev.vars` (gitignored). Copy the example and fill it in:

```bash
cp app/.dev.vars.example app/.dev.vars
```

The crawler reads its configuration from environment variables; copy `.env.example` to `.env`.

**Never commit real values.** Only `.example` files, with placeholders, belong in git (PRD §79).

---

## Running

### Web app

```bash
cd app
npm run dev          # http://localhost:3000
```

Local development uses a **local SQLite D1 instance** in `.wrangler/`, not the remote database.
Cloudflare Access does not apply locally — `npm run dev` is unauthenticated by design.

### Database migrations

Schema is defined in `app/src/db/schema.ts`. After changing it:

```bash
cd app
npx drizzle-kit generate                                   # emit SQL migration
npx wrangler d1 migrations apply job-search-os --local     # apply locally
npx wrangler d1 migrations apply job-search-os --remote    # apply to production
```

Never edit a generated migration that has already been applied remotely — add a new one.
Never mutate the production schema by hand (PRD §56).

### Crawler

```bash
# validate a job source and preview what it finds — does not write anything
python -m crawler doctor https://boards.greenhouse.io/example

# full run against the local app, without POSTing to ingest
python -m crawler.main --dry-run

# full run
python -m crawler.main
```

`doctor` is the tool to reach for when adding a company or debugging a broken adapter. It prints the
detected source type, the resolved config, validation errors, and a preview of parsed jobs.

---

## Tests

```bash
cd app && npm run test        # Vitest: domain + service layers
pytest crawler/tests          # from the repository root
```

Crawler tests replay recorded cassettes and **never hit the live network**. If a test starts making
real requests, that is a bug in the test, not a missing cassette.

To record a new cassette, add the fixture under `crawler/tests/cassettes/` and run with
`--record-mode=once`. Scrub anything sensitive from the recording before committing, and capture a
**multi-page** response — single-page cassettes hide pagination bugs.

The one deliberate exception is the contract canary (`contracts.yml`), which hits real endpoints on
purpose to detect upstream drift. It is not part of the normal test run.

---

## Deploying

```bash
cd app
npx wrangler d1 migrations apply job-search-os --remote
npm run deploy
```

Then verify access control explicitly: open the deployed URL in a logged-out browser and confirm
Cloudflare Access challenges you. This is a release check, not an assumption (PRD §90).

---

## Environment variables and secrets

| Name | Used by | Where it lives |
|---|---|---|
| `INGEST_TOKEN` | app + crawler | Wrangler secret; GitHub Secret |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | crawler | GitHub Secrets |
| `APP_BASE_URL` | crawler | GitHub Actions variable |
| `SMTP_USER` / `SMTP_APP_PASSWORD` | outbox drainer | GitHub Secrets |
| `NOTIFY_EMAIL` | outbox drainer | GitHub Actions variable, or `settings` |

Set a Wrangler secret with:

```bash
cd app && npx wrangler secret put INGEST_TOKEN
```

See [`infrastructure.md`](infrastructure.md) for provisioning.

---

## Conventions

- Commits are focused and conventional: `feat(crawler): add workday adapter`, `docs: update architecture`.
- Work on `main`; use `feature/*` branches for larger changes (PRD §81).
- Update `docs/progress.md` and `CLAUDE.md` when a milestone completes (PRD §85).
- Read [`engineering-principles.md`](engineering-principles.md) before adding a new layer or abstraction.
