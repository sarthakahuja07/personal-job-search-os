# 009 — OpenNext over vinext for the Cloudflare adapter

**Status:** Accepted · 2026-09-05 · Revisit when vinext reaches stable

## Context

[ADR 002](002-typescript-on-workers.md) settled that the app is Next.js running on Cloudflare
Workers. It did not settle *which adapter* gets it there, and the implementation plan assumed
`vinext` because Cloudflare's own documentation states:

> Cloudflare recommends vinext as the default way to run Next.js applications on Cloudflare Workers.

and describes OpenNext as a legacy option "when you maintain an existing OpenNext application that
cannot yet migrate."

Attempting to scaffold it exposed a gap between that recommendation and the current state of the
tooling:

- `create-cloudflare` 2.72.5 — the latest published version — fails with
  `ERROR Unsupported framework: next`, despite listing `next` among its allowed `--framework`
  values. Its help text is stale relative to its behaviour.
- `vinext` on npm is **1.0.0-beta.9**. Its `latest` dist-tag points at a beta; there is no stable
  release. Nine betas shipped between 2026-07-21 and 2026-09-02, the most recent three days before
  this decision.
- `vinext` is a Vite-based reimplementation ("drop-in replacement for the next CLI") requiring
  Vite 8 and React 19.2.6 — a substantially different build path from `next build`.

Meanwhile `@opennextjs/cloudflare` is at **1.20.6** with peer range
`next: ">=15.5.24 <16 || >=16.3.3"`, so it supports Next.js 16 today.

## Decision

Use `@opennextjs/cloudflare` for Phase 0. Revisit once `vinext` publishes a stable 1.0.0.

## Rationale

This is the foundation of a tool Sarthak is meant to depend on daily during a job search. A
weekly-breaking beta is the wrong substrate for that, and the cost of being wrong is asymmetric:
an adapter regression doesn't degrade a feature, it takes the whole application offline, including
the job board he checks each morning.

The plan this project is built on states the tie-breaker directly — *prefer the simplest solution
that reliably solves the current problem*, with reliability winning wherever discovery is at stake.
Choosing a stable adapter over a recommended-but-beta one is that rule applied to the build layer.

"Legacy" here means "superseded in Cloudflare's roadmap", not "unmaintained" — 1.20.6 is current
and actively released.

## Alternatives considered

- **vinext.** Rejected for now: beta, no stable release, cannot be scaffolded by the current C3, and
  a materially different build pipeline. Genuinely the better long-term choice once stable.
- **Wait for vinext to stabilise.** Rejected: blocks all Phase 0 work on an external release date.
- **Drop Next.js for Hono + React.** Rejected: PRD §46 and §92 specify Next.js, Tailwind, and
  shadcn/ui, and nothing discovered here undermines that choice.

## Consequences

- Build goes through `opennextjs-cloudflare build` rather than a Vite pipeline.
- Bindings are reached via `getCloudflareContext()` from `@opennextjs/cloudflare`, **not** via
  `import { env } from "cloudflare:workers"`. Any documentation or example assuming the latter needs
  translating — `CLAUDE.md` and `docs/architecture.md` are updated accordingly.
- A future migration to vinext is a build-layer change. Keeping D1 access confined to the
  repository layer (see [engineering principles](../engineering-principles.md)) means application
  code should be largely unaffected when that happens.
- This deviates from the approved implementation plan, which named vinext. The deviation is
  recorded here rather than made silently (PRD §50, §69).
