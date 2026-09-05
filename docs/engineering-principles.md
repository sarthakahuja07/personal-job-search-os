# Engineering principles

How code in this repository is written, and why. Required by PRD §59.

The governing idea is **production quality without production complexity**. This is a single-user
personal tool. It should have good structure, meaningful tests, clear boundaries, real error
handling, and current documentation. It should not have microservices, Kubernetes, message queues,
event streaming, or a caching tier.

---

## Prefer the simplest solution that reliably solves the current problem

Both halves matter. "Simplest" without "reliably" produces a crawler that silently returns zero
jobs. "Reliably" without "simplest" produces infrastructure nobody maintains.

When the two genuinely conflict, reliability wins **in the discovery path** and simplicity wins
everywhere else. Discovery is the product; a missed job is unrecoverable, while an awkward UI is
merely annoying.

## KISS

Solve the problem in front of you. The expected scale is a few dozen companies, low thousands of
jobs, and one user — design for that, not for a hypothetical future.

## YAGNI

Do not build speculative functionality. PRD §99 lists what Phase 0 explicitly does not include; that
list is binding. Phase 1 (interview preparation) is accommodated by leaving room in the schema, not
by building it early.

Specific applications of this:
- No shared `packages/` directory until there is a genuine need (PRD §51).
- No state management library unless prop drilling actually becomes painful.
- No caching layer. Measure first.

## DRY, but avoid premature abstraction

Some duplication is preferable to an incorrect abstraction. Two adapters that look similar are not
evidence that a shared base class is correct — wait for the third, and for the similarity to survive
contact with a genuinely different source.

The adapter protocol is the exception, and deliberately so: it exists to make the conformance suite
applicable to every adapter uniformly. That is a real, load-bearing abstraction with a concrete
payoff, not a speculative one.

## Separation of concerns

| Layer | Responsibility | Must not |
|---|---|---|
| `src/app/` | Routing, rendering | Contain business logic or SQL |
| `src/server/handler` | HTTP: parse, validate, serialise, map errors to status codes | Contain business logic or SQL |
| `src/server/service` | Orchestration and business rules | Touch the database directly |
| `src/server/repository` | **All** database access | Contain business rules |
| `src/server/domain` | Pure logic and entities | Perform I/O |
| `crawler/adapters` | Fetch, parse, normalize | Deduplicate, match, notify, or write to a database |

The rule with teeth: **only repositories touch D1**, and **only adapters touch job-source
networks**. Everything else composes them.

## Purity where it buys testability

`parse()` in every adapter and the relevance matcher in `src/server/domain/matching.ts` are pure —
no network, no clock, no randomness. This is not aesthetic preference. It is what allows the
conformance suite to assert that two identical runs produce byte-identical output, which is the
assertion that protects against duplicate notifications.

Where a clock is genuinely needed, inject it. Never call `now()` inside pure logic.

## Make illegal states unrepresentable

Prefer structural guarantees over procedural discipline:

- The notification outbox uses a `UNIQUE dedup_key`, so a duplicate notification is impossible at
  the database level rather than merely unlikely in code.
- Job identity uses `UNIQUE (company_id, external_job_id)`, so re-ingesting the same payload cannot
  create duplicates even if the application logic has a bug.
- `NormalizedJob` validates at the boundary, so a malformed job cannot reach the ingest endpoint.

A constraint that cannot be violated is worth more than a test asserting it usually isn't.

## Errors are explicit, and failures are isolated

- One company's crawl failure never aborts the run (PRD §22). Every outcome is recorded.
- External failures — portal unavailable, rate limit, database error, email failure — are handled
  explicitly, not swallowed and not allowed to cascade.
- **Silence is the worst error handling.** A caught exception that produces no record and no signal
  is strictly worse than a crash. If something is swallowed, it must be written to `crawl_runs` or
  surfaced in health status.

## Idempotency

Crawler runs, job inserts, new-job detection, and notification sending must all be idempotent
(PRD §64). Repeated scheduled execution must never create duplicate jobs or send duplicate emails.
This is tested, not assumed: "post the same fixture twice, assert zero new rows and zero new
notifications."

## Testing

Test valuable business logic, not coverage percentage (PRD §61). Priority order:

1. Crawler normalization and the adapter conformance suite
2. Deduplication and new-job detection
3. Relevance matching
4. Notification idempotency
5. Critical service-layer logic

Tests never hit the live network — adapters are tested against recorded cassettes. The one
deliberate exception is the daily contract canary, which exists precisely *because* recorded
fixtures cannot detect upstream drift.

Do not pursue 100% coverage. Do not write tests that assert implementation details.

## Logging

Structured, useful, and sparse (PRD §62). Log crawler start, per-company start and completion, jobs
found, new jobs found, failures, and notification outcomes. Logs should let you reconstruct why a
run produced what it did. Avoid per-item chatter.

## Security

- No secrets in source control, ever. GitHub Secrets and Wrangler secrets only; `.env.example` and
  `.dev.vars.example` carry placeholders alone (PRD §79).
- Validate API input at the boundary.
- The application is never publicly exposed (PRD §90).
- No anti-bot evasion. See [ADR 008](decisions/008-crawler-correctness-strategy.md).

## Documentation

When a significant architectural or implementation decision changes, update the affected
documentation **in the same change** (PRD §69). Stale documentation is worse than none, because it
is trusted.

Architecture decisions get an ADR in `docs/decisions/`. Trivial implementation details do not
(PRD §68).

## Definition of done

A significant feature is complete when it works, important tests pass, errors are handled, the code
is modular, and the relevant documentation, `CLAUDE.md`, and `docs/progress.md` are updated
(PRD §85).

Compilation is not completion.
