# 001 — Single monorepo

**Status:** Accepted · 2026-09-05

## Context

The system has three deployable concerns: a web app, a scheduled crawler, and infrastructure
config. They share a data contract (the normalized job shape) and are maintained by one person.

## Decision

One repository, `personal-job-search-os`, containing `app/`, `crawler/`, `docs/`, `.github/`.

No `packages/` shared-code directory is created. The crawler (Python) and app (TypeScript)
cannot share code anyway; their shared *contract* is the ingest API's JSON schema, which is
documented in `docs/api.md` and enforced by tests on both sides.

## Alternatives considered

- **Separate repos per component.** Rejected: the ingest contract would drift across repos with
  no single commit that changes both sides atomically, for zero benefit at this scale.
- **Monorepo with a shared package.** Rejected as premature (PRD §51). Introduce only if a real
  need appears.

## Consequences

- A single commit can change the crawler and the ingest endpoint together — the contract can
  never be half-migrated.
- CI must path-filter so a docs change doesn't run the Python suite.
