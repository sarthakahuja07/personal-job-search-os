# Source catalogue

Every target company, the technique used to crawl it, and — where it is not crawled — the
specific reason, verified rather than assumed.

The organising idea: **the stubborn companies were never individual problems, they were a
handful of patterns.** Building for the pattern rather than the company is what turned nearly
all of them into configuration rather than code.

**21 of 26 active companies now crawl automatically.** The five that do not are documented
below with the evidence, and four of those are deliberate blocks we choose to respect.

One technique deserves separating out, because it changed the outcome more than any adapter:
a headless browser was used **once, offline, as a discovery tool** — to watch what each stuck
careers page asked for. It is not a runtime dependency and the crawler never launches one. Every
endpoint it revealed is now called with plain HTTP:

| Company | What the browser revealed | How it is crawled now |
|---|---|---|
| DigitalOcean | Greenhouse board token is `digitalocean98` | the ordinary Greenhouse adapter |
| Microsoft | `apply.careers.microsoft.com/api/pcsx/search` | `json_api` |
| Keychain AI | a CSRF-gated POST board | `json_api` with session priming |
| CHEQ | Zoho Recruit, rendered client-side | still manual |

Guessing `digitalocean` as the board token failed for weeks. The real token was `digitalocean98`,
and no amount of static analysis was going to produce that.

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

## Crawled automatically (21)

### Tier 1 — public ATS feed (10)

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
| DigitalOcean | Greenhouse | `digitalocean98` |

### Tier 2 — Workday CXS (5)

| Company | Tenant | Shard | Site |
|---|---|---|---|
| NVIDIA | `nvidia` | `wd5` | `NVIDIAExternalCareerSite` |
| Target | `target` | `wd5` | `targetcareers` |
| Salesforce | `salesforce` | `wd12` | `External_Career_Site` |
| Visa | `visa` | `wd5` | `Visa` |
| Adobe | `adobe` | `wd5` | `external_experienced` |

### Tier 3 — bespoke JSON search (3)

**Amazon** — `amazon.jobs/en/search.json`, scoped to India at the query level.

The board carries over 10,000 roles globally while matching only ever accepts four Indian
locations, so the crawl filters server-side: better for us, and far less load for them. Stable
`id_icims` identity. First crawl found **2,391 India roles, 160 of them SDE-2 matches** — the
single largest source of relevant results in the product.

**Microsoft** — `apply.careers.microsoft.com/api/pcsx/search`, scoped to India (226 roles).

The widely-cited `gcsservices` endpoint is dead: it now fails TLS with a hostname mismatch.
This is its live replacement. It also **silently caps its page size at 10** however large a
`num` you send, while correctly reporting `count=226` — so the crawl first returned 10 of 226
and called it success. The adapter now trusts an authoritative total over the "fewer rows than
requested means done" heuristic, which is the same lesson Workday taught in different clothes.

**Keychain AI** — `jobs.lsvp.com/api-boards/search-jobs`, a Lightspeed portfolio board.

Requires a per-session CSRF token issued on the page, so the adapter primes: fetch the page,
lift the token, send it as a header with the session cookie intact. Seven roles, all in Gurgaon.

### Tier 4 — embedded hydration (1)

**DE Shaw** — all 85 openings sit in `props.pageProps.regularJobs` inside `__NEXT_DATA__`.

The page is server-rendered, so the data arrives with the first response. No API to find and no
browser required. The canonical job URL was confirmed empirically rather than guessed: every
candidate path returns HTTP 200 because the site is a catch-all SPA, but only `/careers/<slug>`
returns `jobData` in its hydration — the rest fall back to `redirectToCareers`.

### Tier 5 — rendered HTML list (2)

**Intuit** — Radancy/TalentBrew, which returns a JSON envelope whose `results` key is a blob of
HTML. Items are `li[data-intuit-jobid]`, carrying a stable id, title, location and href.

**Moveworks** — the careers page ships its 85 jobs in static HTML after all, in
`div.cmp-job-listings__job`. The earlier searches missed them because the board sits below a
JavaScript filter widget; the markup was always there. Its only stable id lives inside the apply
link, so the field map pulls it out with a regex.

Markup is the least stable thing to depend on, so this adapter treats an item selector that
matches nothing on the first page as a hard error. A silently empty result would be
indistinguishable from a company with no openings, which is the failure the whole project is
built to avoid.

---

## Not crawled (5)

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

### Renders only in a browser (1) — deferred, not refused

**CHEQ** — its board is Zoho Recruit at `cheq.zohorecruit.in`, which builds the listing in the
browser. Checked and ruled out: the static page carries no job ids, every Zoho feed path
(`GetJobs.do`, `RssFeed.do`, `EmbedJobs`, `?embed=true`) returns an HTML shell, and watching the
rendered page produced no JSON request to intercept.

It would need a browser **at runtime**, which is a different and much higher bar than using one
once for discovery. PRD §13 permits browser automation "only when genuinely required", and one
company does not clear it against the fragility and CI cost of shipping Chromium into the crawl.
The door is open if CHEQ starts posting roles worth having.

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
