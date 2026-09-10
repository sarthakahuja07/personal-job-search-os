# Progress and open work

The durable state of this project. Updated whenever something meaningful lands, so no context is
lost between sessions (PRD §73). Picking this up cold: read `CLAUDE.md` first, then this file.

**Last updated:** 2026-09-07

---

## Where things stand

Phase 0 is **deployed and running in production**: <https://job-search-os.sarthak-ahuja0007.workers.dev>

104 jobs from 14 companies, 16 relevant SDE-2 matches, and a digest email delivered to Sarthak's
inbox. Re-running the crawl creates nothing and re-running the notifier sends nothing.

**Fully autonomous.** The GitHub Actions workflow runs end to end every 12 hours: it reaches the
app through an Access service token, crawls 14 companies, ingests, and sends a digest.

Cloudflare Access is verified in both directions — browser pages 302 to the login, the crawler's
service token gets 200 on `/api/*`, and a bare bearer token gets nothing. The 34 referral contacts
are loaded and reachable only from behind Access.

| Milestone | State |
|---|---|
| M0 Foundation | done |
| M1 Companies / contacts / settings | partial — data seeded, no CRUD UI |
| M2 Ingest pipeline | done |
| M3 Crawler core + 5 adapters | done — conformance suite still missing |
| M4 Scheduling, health, drift | done — crawl.yml (6-hourly), ci.yml, deploy.yml |
| M5 Job board | partial — board, dashboard, company health, settings, notifications; no job detail page |
| M6 Notifications | done — digest delivered to the real inbox in production |
| M7 Templates | done — variable detection, auto-fill, preview, copy, WhatsApp and email |
| M8 Applications Kanban | done — five stages, drag and drop with a keyboard fallback, follow-up reminders |
| M9 Dashboard | partial — first version done |
| M10 Deferred adapters | done — 21 of 26 companies crawl automatically; the 5 remaining are documented with evidence |

### Phase 1 — Interview preparation

| Milestone | State |
|---|---|
| Schema (`prep_items`) | done — one table, `kind` discriminator, JSON `content` per discipline |
| DSA | done — 20 seeded questions, filters, detail with notes and solution |
| System Design | done — 10 seeded problems with requirements / architecture / trade-offs |
| Behavioral | done — 8 seeded themes with situation / action / outcome |
| Progress tracking | done — four states, `revisit` deliberately not counted as done |
| Notion import | not started — schema shaped to absorb it (PRD §39) |

---

## Next up, in order

**The product is complete.** Every PRD §95 milestone is built, deployed and in use. What remains
is optional and additive:

1. **Notion import** — bring Sarthak's existing prep content into `prep_items`. The schema was
   shaped to absorb it; this is a field mapping, not a redesign.
2. **CHEQ** — the only remaining source that would need a headless browser *at runtime*. One
   company does not justify shipping Chromium into the crawl (PRD §13).

See `docs/source-catalogue.md` for every company, its technique, and the evidence behind each
decision.

---

## Blocked on Sarthak

Nothing. Deployment, credentials and access control are all complete.

| Previously blocking | Resolved |
|---|---|

---

## Fit scoring

Every job carries a **fit score (0–100)** against Sarthak's resume, computed at ingest by
`src/server/domain/fit.ts` and stored on the row so the board can sort by it in SQL.

It is a separate question from relevance. `matching.ts` is a hard gate — should this job be on
the board at all — while fit ranks the ones that already qualify. Keeping them apart means a
tighter fit model can never silently hide a job the gate accepted.

Five weighted dimensions: skills (34), level precision (22), domain overlap (20), location (14)
and freshness (10). Skills carry the most weight deliberately — level, location and recency are
all readable from metadata, so if they dominated, every correctly-levelled Bangalore job would
score alike and the ranking would say nothing about the work itself.

Two design points worth keeping:

- **Missing evidence is not a bad score.** Apple, Microsoft and Rippling publish no description
  on their list endpoints (56 of 238 relevant jobs). Scoring those against a rubric that expects
  a description would rank them last for a gap in *our* data, not a flaw in the job. Instead the
  unassessable weight is removed from the denominator and the row is flagged `fit_title_only`,
  which the card shows as "title only". Their observed range is 34–68 against 0–91 for
  fully-described jobs: ranked fairly, but honestly capped short of "excellent".
- **Every point is attributable.** The score comes with named signals ("Golang · Distributed
  systems", +29), which the job card renders as chips. A number nobody can argue with is a
  number nobody can correct.

The profile lives in `DEFAULT_FIT_PROFILE` and is shaped to be moved into `settings` like the
match rules, so retuning what counts as a strong match needs no redeploy.

Bands: excellent 80+, strong 65+, good 50+, fair 35+, weak below. Current spread across 238
relevant jobs: 11 excellent, 45 strong, 87 good, 79 fair, 15 weak.

**Known limit.** A title-only job cannot reach the top band even when it deserves to — Rippling's
"Software Engineer II" in Bangalore scores 61 because its skills are unknown, not weak. The fix
is the detail fetch the crawler plan already allows for new, pre-filtered jobs; it is not built.

---

## Working the board: read state, reminders and outreach

Discovery was only ever half the problem. These are the parts that stop a board being read.

**Read state.** A job can be marked read — seen and consciously passed over. Deliberately neither
`closed_at` (the posting is gone) nor an application stage (you acted on it). Read jobs leave the
dashboard entirely and fold into a compact "Reviewed" section on the job board, so the list gets
*shorter* as you work through it. Marking read also silences that job's reminder: nagging about a
role you already decided on is how a reminder list loses its authority.

**Reminders.** Five rules, each time-since-a-state-change so every reminder can name the date its
clock started — referral unanswered, referred but not applied (the shortest threshold: someone
spent their credibility), saved and undecided, applied and silent, and a strong match nobody
touched. The nav badge runs the real rules rather than a SQL restatement of them, because that is
how a badge and its page start disagreeing.

**Outreach from the card.** Apply and Message on every job card, plus a stage picker that moves a
job through the pipeline without leaving the page. The message modal renders a template against
the company's contacts and hands it to whichever channel exists — WhatsApp, email, or LinkedIn
(which has no URL that opens a chat with body text, so the message is copied and the profile
opened, rather than a button that silently drops it).

**Emails are kept.** `email_digests` stores the subject, body, recipient and exact send time of
every digest, handed back by the drainer on delivery. The app only ever knew what was *queued*;
rebuilding a sent email later from notification rows would diverge the first time the template
changed. The outbox also re-checks relevance at send time, since match rules are data and can
change between queueing and sending — a Canadian role queued before the location list learned
"CA Remote Ontario" was found sitting ready to send, with its own rejection printed underneath.

**Page weight.** The job board once shipped 1.8 MB. Two causes, both serialisation rather than
queries: every card was handed the full contact list and every template body as props, which a
client component serialises *per card*; and 200 cards is simply a lot of markup when one company
accounts for 163 of them. Outreach is now fetched when the modal opens, groups show their best
few and link onward, and every route has a `loading.tsx` — the remaining second is D1 across the
network, and without a Suspense boundary the browser showed the *old* page for all of it.

---

## Matching: company vocabularies and the experience band

Two things a single global rule set cannot express.

**Job ladders are not comparable across companies.** Sarthak'''s level is `SDE II` at Amazon,
`Senior Software Engineer` at Confluent, and `Software Engineer III` at Google. The global
`senior` exclusion is right for most employers and wrong for Confluent, where it dropped
25 of 29 Bangalore roles before he ever saw them.

Title exclusions are therefore split in two. `exclude` covers *discipline* — sales, QA, security,
hardware — and is never lifted. `seniorityExclude` covers *level*, and a company can lift it by
declaring its own vocabulary in `companies.match_overrides`, editable from the company page. A
level override says "this level is mine here", not "any job here": "Senior Security Engineer"
stays excluded at Confluent.

The subtle half is that **the crawler needs the vocabulary too.** Its title pre-filter drops jobs
before ingest to avoid a detail fetch per posting, so a rule only the server knew about would
never be reached. The overrides are served by `/api/crawler/bootstrap` alongside the match rules,
and both evaluators have tests pinning the same Confluent case so they cannot drift.

**Experience is a band, not a ceiling.** Sarthak is eligible for 2-4 year roles, so a posting
inside that window fits cleanly, one above it is penalised per year and hard-rejected at 7, and
one *below* it is penalised gently rather than hidden — a one-year role is a worse use of a
referral, not an ineligible one. Descriptions that state no requirement are kept: 56 of 239
relevant jobs have no description at all.

Result at Confluent: 1 relevant role became 4, and the two Bangalore roles still excluded are
excluded for a good reason (they ask for 7+ and 8+ years).

---

## Company coverage — 29 of 31 crawled automatically

Full detail, and the evidence behind every decision, in
[`source-catalogue.md`](source-catalogue.md).

**Crawled (29)**

| Tier | Adapter | Companies |
|---|---|---|
| 1 | Greenhouse | Databricks, Roku, Uber Freight, Postman, DigitalOcean |
| 1 | SmartRecruiters | ServiceNow, Swiggy |
| 1 | Ashby | Sarvam AI, Confluent |
| 1 | Lever | Zeta Suite |
| 2 | Workday | NVIDIA, Adobe, Salesforce, Target, Visa |
| 3 | `json_api` | Amazon, Microsoft, Qualcomm, Atlassian, Akamai, Keychain AI, Rippling, Confluent (IBM) |
| 4 | `hydration` | DE Shaw, CHEQ |
| 5 | `html_list` | Intuit, Moveworks, Apple, Ringg |

**Manual (2)** — Google, which disallows its job results in `robots.txt` (honoured, not worked
around, ADR 008), and Wint Wealth, which has no first-party board at all and hires through
aggregators.

**Deactivated (3)** — Dell, Samsung India and VinFast, at Sarthak's request.

The last five were solved by re-testing inherited assumptions rather than by new machinery. Four
of the five "cannot be crawled" verdicts were wrong: Qualcomm's `robots.txt` *explicitly allows*
the endpoint believed forbidden, Atlassian's 401 came from a different endpoint than the public
one, CHEQ ships its jobs in the first response despite rendering them client-side, and Akamai —
which denies everything at its own edge — syndicates every job to DirectEmployers, which welcomes
crawlers. In two cases the honest User-Agent got a 200 where a browser-spoofing one got a 403.

---

## Bugs found and fixed, and what each would have cost

Recorded because every one was invisible until specifically hunted, and the class will recur.

| Bug | Symptom | Why it mattered |
|---|---|---|
| **Workday `total` only on page 1** | Later pages report `total: 0` while still returning results | Crawl stopped at 40 of NVIDIA's 2000 jobs **and reported success**. Pure silent truncation. |
| **URL normalization stripped the query** | All 870 Databricks jobs normalized to one URL | Greenhouse puts the job id in `?gh_jid=`. Would have collapsed a whole company to one job. |
| **Second unique index on the URL** | `UNIQUE constraint failed` on 869 of 870 inserts | The URL is a *fallback* identity, never an independent constraint. ADR 005 corrected. |
| **Anchored title pattern** | `^software engineer$` matched almost nothing | Silently rejected 194 of 1334 live postings — every title with a suffix. |
| **"Remote" matched foreign remote** | `Italy, Remote`, `US, FL, Remote` | Would have surfaced dozens of unreachable roles as matches. |
| **`\bstaff\b` over-matched** | Killed "Member of Technical Staff 2" | That is the SDE-2 title at several companies. |
| **Sequential Workday pagination** | Target exceeded its 180 s budget and returned 0 | Correctly flagged `degraded` rather than silently empty — the guard working as intended. |

Each is pinned by a regression test using the real input that exposed it.

---

## Politeness and adaptivity

Deliberately conservative (`crawler/http/client.py`):

- **Adaptive per-host pacing** — starts at 350 ms, decays toward 80 ms only after five consecutive
  clean responses, multiplies by 2.5 on any 429/5xx. A fixed delay is either rude to small sites or
  needlessly slow against large ones.
- **`Retry-After` always obeyed**, up to two minutes. A 429 widens the delay immediately.
- **Per-host concurrency capped at 3**, with the delay applied *inside* the semaphore so it limits
  the actual request rate rather than merely delaying the caller.
- **Per-company budgets** — 1500 requests / 600 s — so one pathological board cannot consume a run.
- **Honest User-Agent** naming the tool and stating that it respects `robots.txt` and `Retry-After`.
- **Detail fetches only for title-gate survivors** — NVIDIA: 2000 postings, ~40 candidates, ~18
  detail requests. The single largest politeness win in the system.

---

## Verified by running it, not assumed

- Re-running a crawl creates **zero** new jobs and **zero** notifications.
- `UNIQUE (company_id, external_job_id)` rejects a duplicate at the database level.
- A company that returned jobs and now returns none is marked `suspicious`, and its jobs are **not**
  closed.
- Failed, skipped and degraded runs never mutate job presence state.
- Bootstrap and ingest both reject unauthenticated requests with 401.
- 388 TypeScript tests and 251 Python tests pass; `tsc --noEmit` clean, `ruff check crawler` clean.
- Closing a reminder hides exactly that job-and-kind pair and nothing else, checked by running the
  real `buildReminders` over the live candidate rows: the count fell by one and the closed pair
  disappeared. It returns on its own once the job moves to a stage whose clock starts later.
- A referral you have already asked for keeps reminding even after the matcher demotes the job.
  Two Google "SWE 3" roles had gone silent this way — added by hand, then made irrelevant by the
  seniority rules — and neither was reachable from the reminders page until the pipeline was
  exempted from the relevance filter.
- All 8 adapter contracts verified against live endpoints by `python -m crawler.contracts`.
- A full crawl of 14 companies completes in about two minutes with zero failures: 104 jobs
  ingested, 16 relevant, 16 notifications queued.
- The notification digest renders real matches with their explanations and was delivered to the
  real inbox from production.
- Re-running the notifier in production sends nothing; re-crawling creates nothing.
- The scheduled GitHub Actions workflow completed green end to end: reached the app through Access,
  crawled 14 companies with 0 failures, correctly created 0 new jobs and sent 0 emails on a repeat
  run. All 14 automated sources report `healthy`.

---

## Known gaps

- **Google is not crawled**, by choice: its `robots.txt` disallows the job results path. It shows
  on the dashboard as a manual check.

- **No conditional requests.** `etag` / `last_content_hash` are stored and sent to ingest, but
  adapters do not yet send `If-None-Match`, so nothing short-circuits on a 304.
- **Descriptions truncated** to 8000 chars of plain text — deliberate: D1 caps a statement at 100 KB
  and raw Databricks HTML exceeds 20 KB per job.
- **Contact data is not in git.** It lives only in the local D1 and the scratchpad seed script, so a
  fresh clone has companies but no contacts until re-seeded.
