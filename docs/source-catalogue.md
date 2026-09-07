# Source catalogue

Every target company, the technique used to crawl it, and — where it is not crawled — the
specific reason, verified rather than assumed.

The organising idea: **the stubborn companies were never individual problems, they were a
handful of patterns.** Building for the pattern rather than the company is what turned all but
one of them into configuration rather than code.

**28 of 30 active companies now crawl automatically.** The two that do not are Google, which
refuses in `robots.txt`, and Wint Wealth, which publishes no first-party board at all.

---

## What the last five taught

Four companies were previously documented here as "refuses automated access" and one as "renders
only in a browser". **Four of those five conclusions were wrong**, and each was wrong in an
instructive way.

| Company | Was believed | Actually true |
|---|---|---|
| Qualcomm | Eightfold API returns 403 to every client | `robots.txt` **explicitly allows `/api/pcsx`**, which returns 200 — to the *honest* User-Agent |
| Atlassian | Careers endpoint returns 401 without a token | The 401 was a different endpoint; `/endpoint/careers/listings` is public and unauthenticated |
| CHEQ | Zoho Recruit builds the listing in the browser | The listing is built in the browser, but the *data* arrives in the first response |
| Akamai | Edge returns `Access Denied`, full stop | True of `akamai.com` — but Akamai syndicates every job to DirectEmployers, which welcomes crawlers |
| Google | Bot-protected by design | Correct, and `robots.txt` says so explicitly. Still excluded. |

Three lessons worth keeping:

**The honest User-Agent outperformed the browser-spoofing one.** Qualcomm's endpoint returns 200
to `job-search-os/0.1 (personal job-search tool; respects robots.txt)` and **403 to a Chrome UA
string**. Politeness was not a constraint to work around; it was the thing that worked. The same
holds for the `x-origin` header Akamai's board expects — sending what an API asks for is not
evasion.

**"Renders in a browser" is a claim about the DOM, not about the response.** CHEQ's listing really
is assembled by JavaScript, which is why the rendered page was the only place jobs appeared to
exist. But the 1.7 MB first response already contained all ten jobs, entity-encoded inside
`<input id="jobs" value="...">`. The earlier check searched for job ids in URL form and found
none; the ids were there in a different shape. **A negative result is only as good as the shape
you searched for.**

**A blocked front door is not a blocked building.** `akamai.com` denies everything, including its
own `robots.txt`. But Akamai publishes to **DirectEmployers**, whose `robots.txt` reads `Allow: /`.
Asking "who else does this company deliberately publish to?" turned the hardest refusal into an
ordinary tier-3 config.

The headless browser was used **only as a discovery tool, offline** — to watch what each stuck
page asked for. It is not a runtime dependency, no adapter launches one, and CI ships no Chromium.
Every endpoint it revealed is now called with plain HTTP.

---

## The five patterns

| Pattern | Adapter | Tier | What it is | Adding a company |
|---|---|---|---|---|
| **Public ATS feed** | `greenhouse` `lever` `ashby` `smartrecruiters` | 1 | Endpoints built for embedding job widgets. Documented, stable, unauthenticated. | config |
| **Workday CXS** | `workday` | 2 | Undocumented but ubiquitous; one adapter serves every tenant. | config |
| **Bespoke JSON search** | `json_api` | 3 | The company's own search endpoint, or a board it syndicates to. | config |
| **Embedded hydration** | `hydration` | 4 | The page ships its data in the first response — `__NEXT_DATA__`, a `window.__X__` assignment, or an HTML attribute. | config |
| **Rendered HTML list** | `html_list` | 5 | Markup, sometimes wrapped in a JSON envelope. Least stable; last resort before manual. | config |
| **Manual** | — | 6 | The source asks not to be crawled. | config |

All of them are driven by a small field-mapping language
(`crawler/normalization/fieldmap.py`), so a new company on any pattern is a row in `companies`,
not a Python file.

---

## Crawled automatically (28)

### Tier 1 — public ATS feed (10)

| Company | ATS | Identifier |
|---|---|---|
| Databricks | Greenhouse | `databricks` |
| Roku | Greenhouse | `roku` |
| Uber Freight | Greenhouse | `uberfreight` |
| Postman | Greenhouse | `postman` |
| DigitalOcean | Greenhouse | `digitalocean98` |
| ServiceNow | SmartRecruiters | `servicenow` |
| Swiggy | SmartRecruiters | `swiggy` |
| Sarvam AI | Ashby | `sarvam` |
| Confluent | Ashby | `confluent` |
| Zeta Suite | Lever | `zeta` |

### Tier 2 — Workday CXS (5)

| Company | Tenant | Shard | Site |
|---|---|---|---|
| NVIDIA | `nvidia` | `wd5` | `NVIDIAExternalCareerSite` |
| Target | `target` | `wd5` | `targetcareers` |
| Salesforce | `salesforce` | `wd12` | `External_Career_Site` |
| Visa | `visa` | `wd5` | `Visa` |
| Adobe | `adobe` | `wd5` | `external_experienced` |

### Tier 3 — bespoke JSON search (7)

**Amazon** — `amazon.jobs/en/search.json`, scoped to India at the query level. The board carries
over 10,000 roles globally while matching only ever accepts four Indian locations, so the crawl
filters server-side: better for us, far less load for them. First crawl found **2,391 India roles,
160 of them SDE-2 matches** — the single largest source of relevant results in the product.

**Microsoft** — `apply.careers.microsoft.com/api/pcsx/search`, scoped to India (226 roles). The
widely-cited `gcsservices` endpoint is dead: it now fails TLS with a hostname mismatch. This is
its live replacement, and it **silently caps its page size at 10** however large a `num` you send,
while correctly reporting `count=226`.

**Qualcomm** — `careers.qualcomm.com/api/pcsx/search`, scoped to India (**579 roles**).

Its `robots.txt` is unusually explicit: `Disallow: /` followed by `Allow: /careers`,
`Allow: /api/apply` and **`Allow: /api/pcsx`** — the endpoint is *published as crawlable*. It
returns 200 to our honest User-Agent and 403 to a browser-spoofing one, so the earlier "403 to
every client tried" conclusion had been reached by testing only the disguised client. It caps page
size at 10 like Microsoft, so 579 jobs is 58 pages; `maxPages` is 90, with room to grow.

**Atlassian** — `www.atlassian.com/endpoint/careers/listings`: the whole board in one response
(253 roles, 32 of them in India). No auth, no pagination, stable numeric `id`. The 401 recorded
earlier came from a *different* endpoint; this is the one the careers page itself calls.

**Akamai** — `prod-search-api.jobsyn.org/api/v1/solr/search`, filtered to India (16 roles).

`akamai.com` returns `Access Denied` to everything, including its own `robots.txt`, and its Oracle
backends time out. But Akamai syndicates its jobs to DirectEmployers (`akamai.dejobs.org`), whose
`robots.txt` is `Allow: /` with only feeds disallowed. That board's API expects an
`x-origin: akamai.dejobs.org` header — the value the board sends for itself, not a disguise — and
1-based page numbers, which is why `json_api` grew a `startPage`. Its job URLs embed a slugified
city, which is why the field-mapping language grew `{location_exact|slug}`.

**Rippling** — an Algolia index (`careers_en-US_production`), 679 roles, 208 of them in India.

The careers page renders client-side and `rippling.com/robots.txt` says `Disallow: /api`, so the
company's own endpoint is off-limits. Its search is not there, though: it is a hosted Algolia
index on `algolia.net`, queried with the public search-only key every visitor's browser uses. The
board paginates in the POST **body** rather than the URL, which is why `json_api` learned to look
for pagination markers in both. Note `objectID`, not `jobId`, is the stable identity -- a role
open in three cities appears three times, sharing one `jobId`.

**Keychain AI** — `jobs.lsvp.com/api-boards/search-jobs`, a Lightspeed portfolio board. Requires a
per-session CSRF token issued on the page, so the adapter primes: fetch the page, lift the token,
send it as a header with the session cookie intact. Seven roles, all in Gurgaon.

### Tier 4 — embedded hydration (2)

**DE Shaw** — all 85 openings sit in `props.pageProps.regularJobs` inside `__NEXT_DATA__`. The
canonical job URL was confirmed empirically rather than guessed: every candidate path returns 200
because the site is a catch-all SPA, but only `/careers/<slug>` returns `jobData` in its hydration.

**CHEQ** — all 10 openings sit in `<input id="jobs" value="...">` as entity-encoded JSON.

Zoho Recruit assembles the visible listing client-side, which is why watching the DOM suggested a
runtime browser was unavoidable. It is not: the data is in the first response, and the adapter
reads it over plain HTTP. This is the third shape of "the page ships its own data", alongside
`__NEXT_DATA__` and `window.__X__`.

### Tier 5 — rendered HTML list (4)

**Intuit** — Radancy/TalentBrew, which returns a JSON envelope whose `results` key is a blob of
HTML. Items are `li[data-intuit-jobid]`, carrying a stable id, title, location and href.

**Moveworks** — the careers page ships its 85 jobs in static HTML after all, in
`div.cmp-job-listings__job`. Earlier searches missed them because the board sits below a
JavaScript filter widget; the markup was always there. Its only stable id lives inside the apply
link, so the field map pulls it out with a regex.

**Apple** — `jobs.apple.com/en-in/search`, scoped to India (177 roles, 136 of them engineering).

Server-rendered, so despite appearances there is no API to intercept: watching the page produced
no job XHR at all. Rows are `div.job-title.job-list-item`. Its ids are not plain numbers but
`200677836-0321` — a requisition plus a location suffix, so one role open in two cities is two
rows with two ids, as it should be. Its posted dates read `07 Sept 2026`, the one four-letter
month abbreviation no standard format understands, which was silently discarding every date until
`parse_date` learned it.

**Ringg** — six roles as plain anchors on `ringg.ai/careers`. Small enough that the whole board is
one page of static HTML; the slug is the id.

Markup is the least stable thing to depend on, so this adapter treats an item selector that
matches nothing on the first page as a hard error.

---

## Not crawled (2)

**Wint Wealth** — no first-party job board exists. Their site has no careers page (`/careers` is a
404 and nothing career-shaped appears in their sitemap or homepage), and they hire through
aggregators: LinkedIn, Instahyre, Wellfound. There is nothing to crawl rather than something
refusing to be crawled, so it is manual with a link to their LinkedIn jobs tab. If they adopt an
ATS later it becomes a config row like any other.

**Google** — `robots.txt` contains:

```
Disallow: /about/careers/applications/jobs/results
```

That is an explicit, machine-readable request not to crawl the job results, and we honour it
(ADR 008). Unlike the other four, this conclusion was re-verified rather than inherited: the file
still says it. Google appears on the dashboard as a manual check with a direct link to its board.

We do not spoof fingerprints, solve challenges, or rotate identities. Beyond being the right call,
evasion is the *unreliable* one: it breaks constantly and rots silently, which is exactly the
failure mode this project exists to prevent.

---

## Adding a company

1. Paste the careers URL into **Companies → Add**. Greenhouse, Lever, Ashby, SmartRecruiters and
   Workday URLs are recognised automatically and need nothing further.
2. If it is not recognised it is saved as `manual` rather than guessed at, and appears on the
   dashboard as something to check by hand.
3. To promote it, find its JSON — the careers page, its hydration state, its JS bundles, or a
   board it syndicates to — and write a `json_api`, `hydration` or `html_list` config.
   `scripts/record_cassettes.py` captures a fixture, and the conformance suite then applies all
   21 invariants to it automatically.

Before concluding a company cannot be crawled, work through what the last five taught:

- **Read `robots.txt` first.** It is the deciding authority in both directions — Qualcomm's
  *permits* the endpoint that had been assumed forbidden, and Google's forbids one that would
  otherwise work.
- **Try the honest User-Agent on its own.** It is not merely the polite option; twice it was the
  only one that got a 200.
- **Search the first response for the job's title, not only its id.** CHEQ's data was present in a
  shape the earlier search did not look for.
- **Ask who else the company publishes to.** Job syndication turned the hardest block into an
  ordinary config.
- **Check which endpoint returned the error.** Atlassian's 401 was real, and irrelevant.

A wrong adapter fails quietly; an honest `manual` shows up as work to do. That asymmetry is why
detection never guesses.
