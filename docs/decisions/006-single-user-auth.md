# 006 — Access control via Cloudflare Access

**Status:** Accepted · 2026-09-05 · Required by PRD §38

## Context

The app holds personal contact details, phone numbers, and job-search history (PRD §90). It must
not be publicly reachable. It has exactly one human user, so a full authentication system would be
both wasted effort and additional attack surface (PRD §38: "Do not build a full multi-user
authentication system").

Verified: Cloudflare Access is free for up to 50 users and **can protect a `*.workers.dev` URL
directly** — no custom domain required.

## Decision

Cloudflare Access sits in front of the entire Worker, with a policy allowing exactly one email
address. Authentication is a one-time-PIN email login. The application itself contains no login
code, no session handling, and no password storage.

Machine access for the crawler uses an **Access service token** (`CF-Access-Client-Id` /
`CF-Access-Client-Secret`) scoped to the ingest routes, combined with a bearer secret checked by
the handler — the network layer and the application layer each verify independently.

## Alternatives considered

- **Application-level auth (password / NextAuth).** Rejected: more code, more surface, credential
  storage to get right, and it would still leave the origin publicly reachable.
- **No auth, obscure URL.** Rejected outright — the data is personal (PRD §90).

## Consequences

- Zero authentication code in the application. The app can assume any request that reaches it has
  already been authorised at the edge — but the ingest routes still verify the bearer token, so a
  misconfigured Access policy cannot silently open a write path.
- Local development bypasses Access; `npm run dev` is unauthenticated by design.
- Verification is explicit: loading the deployed URL in a logged-out browser must produce an Access
  challenge. This is a release check, not an assumption.
