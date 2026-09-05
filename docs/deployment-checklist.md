# Deployment checklist

> **Status as of 2026-09-05.** Steps 1, 3, 4 and 5 are **done**. The app is deployed at
> <https://job-search-os.sarthak-ahuja0007.workers.dev> and the repository is
> <https://github.com/sarthakahuja07/personal-job-search-os>.
>
> **Step 2 (Cloudflare Access) is outstanding, and it is the one that matters.** Until it is done
> the app is publicly readable, so referral contacts have deliberately **not** been loaded into the
> production database — it currently holds companies and public job listings only.

Everything needed to take this from "runs on Sarthak's laptop" to "runs itself every six hours".

Work top to bottom. Each step says who does it and why it is needed. Nothing here costs money.

---

## What you need to have ready

| # | Thing | Where to get it | Used for | Done |
|---|---|---|---|---|
| 1 | **Cloudflare account** | free signup at dash.cloudflare.com | Hosting the app + D1 database | ✅ |
| 2 | **GitHub account** | — | Repository + the 6-hourly crawl | ✅ |
| 3 | **Gmail app password** | Google Account → Security → 2-Step Verification → App passwords | Sending the digest | ✅ |
| 4 | **Notification email address** | any inbox you read | Where the digest lands | ✅ |
| 5 | **Canonical resume link** | Drive/Dropbox share link | Message templates | ⬜ still needed |
| 6 | **Cloudflare Access + service token** | Zero Trust dashboard | Keeping the app private | ⬜ **blocking** |

Only **3** has a prerequisite: the Google account must have 2-Step Verification on, or the App
passwords option does not appear.

---

## Step 1 — Cloudflare: database and deploy

```bash
cd app
npx wrangler login                       # opens a browser
npx wrangler d1 create job-search-os
```

Copy the returned `database_id` into `app/wrangler.jsonc`, replacing
`REPLACE_AFTER_WRANGLER_D1_CREATE`. Then:

```bash
npx wrangler types
npx wrangler d1 migrations apply job-search-os --remote
npx wrangler secret put INGEST_TOKEN      # paste a long random string; keep a copy
npm run deploy
```

Generate the token with `openssl rand -base64 32` (or any password manager). You will need the
same value again in Step 3.

The deploy prints a `https://job-search-os.<subdomain>.workers.dev` URL. **That URL is public until
Step 2**, so do Step 2 immediately.

## Step 2 — Cloudflare Access: lock it down

The app holds real people's phone numbers and has no login code of its own — Access is the only
thing between it and the open internet (ADR 006).

1. Cloudflare dashboard → **Workers & Pages → job-search-os → Settings → Domains & Routes**
2. **Enable Cloudflare Access**, then **Manage Cloudflare Access**
3. Set the policy to allow exactly one email: yours
4. **Verify**: open the URL in a private window. An Access challenge must appear.

That last check is a release gate, not a formality.

### Access service token — so the crawler can still reach the app

1. Zero Trust dashboard → **Access → Service Auth → Create service token**
2. Name it `crawler`. Copy the **Client ID** and **Client Secret** (shown once).
3. On the Access application, add a policy: *Service Auth* → include that token, scoped to
   `/api/*`.

## Step 3 — GitHub: repository and secrets

```bash
gh auth login
gh repo create personal-job-search-os --private --source=. --push
```

Then set the secrets and variables:

```bash
gh secret set INGEST_TOKEN                 # same value as the Wrangler secret
gh secret set CF_ACCESS_CLIENT_ID          # from step 2
gh secret set CF_ACCESS_CLIENT_SECRET      # from step 2
gh secret set SMTP_USER                    # your Gmail address
gh secret set SMTP_APP_PASSWORD            # the 16-character app password, no spaces
gh secret set CLOUDFLARE_API_TOKEN         # for deploy.yml, see below
gh secret set CLOUDFLARE_ACCOUNT_ID

gh variable set APP_BASE_URL --body "https://job-search-os.<subdomain>.workers.dev"
```

The **Cloudflare API token** comes from dash.cloudflare.com → My Profile → API Tokens → Create
Token → *Edit Cloudflare Workers* template. The **account ID** is on the Workers overview page.

`APP_BASE_URL` is a *variable*, not a secret — the workflow fails fast with a clear message if it
is missing, rather than crawling into the void.

## Step 4 — Settings inside the app

Open the deployed URL → **Settings**:

- **Notification email** — without this, notifications queue but never send.
- **Canonical resume link**.

Then seed the companies and contacts into the remote database. The seed script lives outside the
repository because it contains other people's phone numbers:

```bash
python <scratchpad>/make_seed.py seed.sql
cd app && npx wrangler d1 execute job-search-os --remote --file ../seed.sql
npx wrangler d1 execute job-search-os --remote --command "INSERT INTO settings (id) VALUES (1);"
```

## Step 5 — Prove it works

```bash
gh workflow run crawl.yml -f dry_run=true     # crawls, writes nothing
gh run watch
```

Then a real run:

```bash
gh workflow run crawl.yml
```

Expect: jobs on the board, and one digest email. Run it a second time immediately — **no new jobs
and no second email**. That is the idempotency guarantee, and it is worth confirming once by hand.

---

## Secrets reference

| Name | Kind | Set in | Consumed by |
|---|---|---|---|
| `INGEST_TOKEN` | secret | Wrangler **and** GitHub | app verifies, crawler sends |
| `CF_ACCESS_CLIENT_ID` | secret | GitHub | crawler → Access |
| `CF_ACCESS_CLIENT_SECRET` | secret | GitHub | crawler → Access |
| `SMTP_USER` | secret | GitHub | digest sender |
| `SMTP_APP_PASSWORD` | secret | GitHub | digest sender |
| `CLOUDFLARE_API_TOKEN` | secret | GitHub | `deploy.yml` |
| `CLOUDFLARE_ACCOUNT_ID` | secret | GitHub | `deploy.yml` |
| `APP_BASE_URL` | variable | GitHub | crawler + notifier |

Nothing sensitive is committed. `.dev.vars` is gitignored, and only `.example` files carry
placeholders (PRD §79).

---

## Cost

$0/month. Workers free tier is 100k requests/day; D1 free is 5 GB; Cloudflare Access is free to 50
users; GitHub Actions gives 2000 private-repo minutes/month and 4 crawls/day at roughly 2 minutes
each uses about 240. Gmail SMTP is free.

The only thing that could cost money is exceeding a free tier, which at this scale will not happen.

---

## Running it locally

```bash
cd app && npm run dev                       # http://localhost:3000
```

In another shell, from the repository root:

```bash
export INGEST_TOKEN=local-dev-token         # must match app/.dev.vars
export APP_BASE_URL=http://localhost:3000
python -m crawler.main --dry-run            # crawl, write nothing
python -m crawler.main                      # crawl for real
python -m crawler.notify --dry-run          # print the digest
```
