# 002 — All-TypeScript on Cloudflare Workers (supersedes the PRD's Go backend)

**Status:** Accepted · 2026-09-05 · **Supersedes PRD §46 backend choice**

## Context

PRD §46 proposes a Go backend with Cloudflare D1 and Cloudflare hosting at $0/month. PRD §47
requires validating this before implementation. It does not hold together:

- Cloudflare Workers execute JavaScript and WASM only. Running Go means TinyGo→WASM: no
  `net/http` server, a restricted standard library, and immature GC.
- Cloudflare has **no free tier that runs a normal Go binary** (Containers require a paid plan).
- **D1 has no wire protocol.** It is reachable from a Workers binding or an HTTP REST API. There
  is no SQL driver a Go service could use, so a Go backend would have to abandon D1 as well.

So "Go + D1 + Cloudflare + $0" cannot all be satisfied simultaneously.

Meanwhile Next.js 16 runs natively on Workers via `vinext` (Cloudflare's recommended adapter;
OpenNext is now legacy), and server-side code reaches bindings via `import { env } from "cloudflare:workers"`.

## Decision

Build the app as a single Next.js 16 application on Cloudflare Workers, in TypeScript. Route
handlers and server components are the API; there is no separate backend service.

Layering discipline from PRD §52 is preserved inside `app/src/server/`:
`handler → service → repository → D1`. Repositories are the only code that touches the database.

## Alternatives considered

- **Go on Google Cloud Run + Neon Postgres, Next.js on Cloudflare.** Genuinely viable and keeps
  Go (relevant to Sarthak's SDE-2 backend prep). Rejected for Phase 0: two deploy pipelines, cold
  starts on the request path, a Google Cloud account with a card on file, and D1 dropped —
  materially more moving parts for a single-user tool whose value is discovery speed.
- **Go compiled to WASM on Workers.** Rejected: no HTTP server model, poor library support.

## Consequences

- One language, one deployable, one deploy command. No cold starts. $0.
- Go is not exercised by this project. If that matters later, the service boundary at
  `/api/*` is clean enough to extract — but this decision assumes it will not happen.
- Business logic lives in TypeScript and must be tested there (Vitest), not in Go.
