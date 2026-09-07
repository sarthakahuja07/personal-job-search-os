# Infrastructure

Everything here runs on free tiers. **Paid infrastructure is never introduced without explicit
approval** (PRD §48).

## What exists

| Resource | Provider | Purpose | Free tier |
|---|---|---|---|
| Worker (Next.js via OpenNext) | Cloudflare | UI + API | 100k requests/day |
| D1 database `job-search-os` | Cloudflare | All application state | 10 dbs, 500 MB/db, 5 GB/account |
| Cloudflare Access application | Cloudflare | Access control on the `workers.dev` URL | up to 50 users |
| Access service token | Cloudflare | Machine auth for the crawler | included |
| GitHub Actions | GitHub | Crawl schedule, canary, CI, deploy | 2,000 min/month (private) |
| Gmail SMTP | Google | Notification delivery | free with an app password |

No R2, no KV, no Durable Objects, no Queues. None are needed (PRD §75, §77). R2 becomes relevant
only if resume or document storage is added later.

---

## Provisioning

### D1

```bash
cd app
npx wrangler login
npx wrangler d1 create job-search-os
```

Copy the returned `database_id` into `app/wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "job-search-os",
    "database_id": "<id from the create command>"
  }
]
```

Then regenerate binding types and apply migrations:

```bash
npx wrangler types
npx wrangler d1 migrations apply job-search-os --local
npx wrangler d1 migrations apply job-search-os --remote
```

Server code reaches the binding through `getDb()` in `app/src/db/index.ts`, which wraps
`getCloudflareContext()` from `@opennextjs/cloudflare`. That module is the only place the binding
is touched directly (ADR 009).

**Constraint that shapes the code:** D1 allows a maximum of **50 queries per Worker invocation**.
N+1 query patterns in request handlers will fail under real data. List endpoints must use joins or
batched `IN` lookups.

### Cloudflare Access

Access protects the `*.workers.dev` URL directly — no custom domain required.

1. Deploy the Worker at least once so the URL exists.
2. Cloudflare dashboard → the Worker → **Settings → Domains & Routes → Enable Cloudflare Access**.
3. **Manage Cloudflare Access** → set the policy to allow exactly one email address.
4. Verify: open the deployed URL in a logged-out browser. An Access challenge must appear.

That last step is a release check, not an assumption. The application contains no authentication
code of its own, so a misconfigured policy is the only thing between personal data and the open
internet ([ADR 006](decisions/006-single-user-auth.md)).

### Access service token (crawler → ingest)

The crawler must reach `/api/ingest/*` without a browser login.

1. Zero Trust dashboard → **Access → Service Auth** → create a service token.
2. Add a policy on the Access application allowing that token for the ingest paths.
3. Store `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` as GitHub Secrets.

The ingest handler *additionally* checks a bearer `INGEST_TOKEN`. Two independent layers, so a
misconfigured Access policy cannot silently open a write path.

### Gmail SMTP

Requires 2-factor authentication on the Google account.

1. Google Account → **Security → 2-Step Verification → App passwords**.
2. Generate a password for "Mail".
3. Store as `SMTP_APP_PASSWORD` in GitHub Secrets, with `SMTP_USER` as the address.

Sends via `smtp.gmail.com:587` (STARTTLS) from the Actions runner. Only ever sends to Sarthak, so
deliverability and domain reputation are non-issues — which is exactly why this was chosen over a
transactional provider requiring a verified domain
([plan decision](../personal-job-search-os-prd.md), PRD §36).

---

## Secrets

Nothing sensitive is ever committed (PRD §79). Only `.example` files with placeholders.

| Secret | Stored in | Consumed by |
|---|---|---|
| `INGEST_TOKEN` | Wrangler secret **and** GitHub Secret | app verifies; crawler sends |
| `CF_ACCESS_CLIENT_ID` | GitHub Secret | crawler |
| `CF_ACCESS_CLIENT_SECRET` | GitHub Secret | crawler |
| `SMTP_USER` | GitHub Secret | outbox drainer |
| `SMTP_APP_PASSWORD` | GitHub Secret | outbox drainer |
| `CLOUDFLARE_API_TOKEN` | GitHub Secret | `deploy.yml` |

Set a Worker secret:

```bash
cd app && npx wrangler secret put INGEST_TOKEN
```

Set a GitHub secret:

```bash
gh secret set INGEST_TOKEN
```

---

## Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `crawl.yml` | cron every 12h + manual | run crawler → POST ingest → drain outbox |
| `contracts.yml` | cron daily | live schema canary against real endpoints |
| `ci.yml` | push / PR | Vitest, pytest, lint |
| `deploy.yml` | push to `main` | build and deploy the Worker |

**Budget.** 8 crawl runs/day ≈ 240/month at roughly 2 minutes each ≈ 480 of the 2,000 free
private-repo minutes, before CI and deploys. Comfortable, but re-check before increasing cadence.

**A green check means less than it looks.** `create-cloudflare` exited with code 0 while failing
outright on a Node version check during this project's own setup. Workflow steps must assert
outcomes — jobs actually ingested, notifications actually sent — not merely complete. The same
principle drives the crawler's zero-result guard
([ADR 008](decisions/008-crawler-correctness-strategy.md)).

---

## Deployment flow

```
push to main
   -> ci.yml: tests must pass
   -> deploy.yml: npm run build && wrangler deploy
   -> migrations applied manually (wrangler d1 migrations apply --remote)
```

Migrations are deliberately **not** automatic. A bad migration against the only copy of the data is
not worth the convenience.

## Data ownership

All data belongs to Sarthak (PRD §98). D1 exports to plain SQL:

```bash
npx wrangler d1 export job-search-os --remote --output backup.sql
```

Nothing in this stack locks data into a proprietary format.
