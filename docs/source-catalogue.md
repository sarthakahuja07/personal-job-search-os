# Source catalogue

Every target company, the technique used to crawl it, and — where it is not crawled — the
specific reason, verified rather than assumed.

The organising idea: **twelve stubborn companies were not twelve problems, they were four
patterns.** Building for the pattern rather than the company is what turned most of them into
configuration rather than code.

---

## The four patterns

| Pattern | Adapter | Tier | What it is | Adding a company |
|---|---|---|---|---|
| **Public ATS feed** | `greenhouse` `lever` `ashby` `smartrecruiters` | 1 | Endpoints built for embedding job widgets. Documented, stable, unauthenticated. | config |
| **Workday CXS** | `workday` | 2 | Undocumented but ubiquitous; one adapter serves every tenant. | config |
| **Bespoke JSON search** | `json_api` | 3 | The company's own search endpoint, found by reading its careers page. | config |
| **Embedded hydration** | `hydration` | 4 | Server-rendered page shipping its data in `__NEXT_DATA__` so the client can hydrate. No API to reverse-engineer. | config |
| **Rendered HTML list** | `html_list` | 5 | Markup, sometimes wrapped in a JSON envelope. Least stable; last resort before manual. | config |
| **Manual** | — | 6 | The source refuses automation, or renders only in a browser. | config |

The last three are the ones added to solve this problem, and none of them is company-specific.
They are driven by a small field-mapping language (`crawler/normalization/fieldmap.py`) so a new
company on any of these patterns is a row in `companies`, not a Python file.

---

## Crawled automatically (17)

### Tier 1 — public ATS feed (9)

| Company | ATS | Identifier |
|---|---|---|
| Databricks | Greenhouse | `databricks` |
| Roku | Greenhouse | `roku` |
| Uber Freight | Greenhouse | `uberfreight` |
| Postman | Greenhouse | `postman` |
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

### Tier 3 — bespoke JSON search (1)

**Amazon** — `amazon.jobs/en/search.json`, scoped to India at the query level.

The board carries over 10,000 roles globally while matching only ever accepts four Indian
locations, so the crawl filters server-side: better for us, and far less load for them. Stable
`id_icims` identity. First crawl found **2,391 India roles, 160 of them SDE-2 matches** — the
single largest source of relevant results in the product.

### Tier 4 — embedded hydration (1)

**DE Shaw** — all 85 openings sit in `props.pageProps.regularJobs` inside `__NEXT_DATA__`.

The page is server-rendered, so the data arrives with the first response. No API to find and no
browser required. The canonical job URL was confirmed empirically rather than guessed: every
candidate path returns HTTP 200 because the site is a catch-all SPA, but only `/careers/<slug>`
returns `jobData` in its hydration — the rest fall back to `redirectToCareers`.

### Tier 5 — rendered HTML list (1)

**Intuit** — Radancy/TalentBrew, which returns a JSON envelope whose `results` key is a blob of
HTML. Items are `li[data-intuit-jobid]`, carrying a stable id, title, location and href.

Markup is the least stable thing to depend on, so this adapter treats an item selector that
matches nothing on the first page as a hard error. A silently empty result would be
indistinguishable from a company with no openings, which is the failure the whole project is
built to avoid.

---

## Not crawled (9)

Split by *why*, because the two reasons deserve different responses.

### Refuses automated access (4) — respected, not worked around

| Company | Evidence |
|---|---|
| **Akamai** | Edge returns `Access Denied` from `errors.edgesuite.net`. Akamai blocking us with Akamai. |
| **Qualcomm** | Eightfold API returns HTTP 403 to every client tried, including browser-identical headers and referer, on both `careers.qualcomm.com` and `app.eightfold.ai`. |
| **Atlassian** | Careers endpoint returns HTTP 401 without a token. |
| **Google** | Bot-protected by design. |

These are deliberate signals. We do not spoof fingerprints, solve challenges, or rotate
identities (ADR 008). Beyond being the right call, evasion is the *unreliable* one: it breaks
constantly and rots silently, which is exactly the failure mode this project exists to prevent.
Each links straight to its board for a manual check, Qualcomm's pre-filtered to Bengaluru.

### Renders only in a browser (4) — deferred, not refused

| Company | What was checked |
|---|---|
| **DigitalOcean** | No hydration state, no ATS fingerprint, no job URLs in the sitemap. The one "lever" match in the page was the word *leverage*. |
| **CHEQ** | No hydration variables, no ATS markers. |
| **Moveworks** | Workday tenant `moveworks.wd12` confirmed to exist, but the site slug is not guessable and appears nowhere in the page or its ten JS bundles. Its only JSON-LD block is a `BreadcrumbList`. |
| **Keychain AI** | The URL available is the Lightspeed portfolio board (Getro), not Keychain's own ATS. Its collection API returned 401. |

Each was investigated by fetching the page, extracting hydration blobs, downloading and grepping
its JS bundles for API paths, and testing every ATS fingerprint. Nothing is reachable without
executing JavaScript.

A headless browser would likely reach these. It is deliberately not built: PRD §13 permits
browser automation "only when genuinely required", and four companies — none of which has yet
produced a known SDE-2 opening — does not clear that bar against the fragility and CI cost it
would add. The door is open if that changes.

### Endpoint moved (1)

**Microsoft** — the widely-cited `gcsservices.careers.microsoft.com` endpoint now fails TLS with
a hostname mismatch, so it has moved or been retired. Disabling certificate verification would
"fix" it and is not on the table. Its replacement is not discoverable statically: the careers SPA
references no API path, and its bundles expose only analytics hosts.

---

## Adding a company

1. Paste the careers URL into **Companies → Add**. Greenhouse, Lever, Ashby, SmartRecruiters and
   Workday URLs are recognised automatically and need nothing further.
2. If it is not recognised it is saved as `manual` rather than guessed at, and appears on the
   dashboard as something to check by hand.
3. To promote it, find its JSON — the careers page, its hydration state, or its JS bundles — and
   write a `json_api`, `hydration` or `html_list` config. `scripts/record_cassettes.py` captures
   a fixture, and the conformance suite then applies all 21 invariants to it automatically.

A wrong adapter fails quietly; an honest `manual` shows up as work to do. That asymmetry is why
detection never guesses.
