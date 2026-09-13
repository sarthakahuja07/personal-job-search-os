# job-search-mcp — the remote MCP server, for ChatGPT

A second MCP server, reachable over the internet, because **ChatGPT will not launch a local
process**. It only talks to a remote HTTPS server and it authenticates with OAuth — not a bearer
token, not an API key. The local stdio server in `mcp/` therefore cannot be connected to it at
any price, and this is the shape that requirement forces.

Use `mcp/` with Claude. Use this only if you study in ChatGPT.

    https://job-search-mcp.sarthak-ahuja0007.workers.dev/mcp

## What it costs, plainly

This Worker is reachable by anyone on the internet and it can write to the prep tree. Three
things keep that honest:

1. **OAuth guards every tool call.** The consent screen asks for a password only Sarthak knows,
   compared in constant time, and failing closed if the secret is unset.
2. **The app itself stays entirely behind Cloudflare Access.** No Access policy was weakened.
   This Worker reaches the app through a *service binding*, which dispatches to the Worker
   directly rather than through the edge — so Access is not bypassed, it is simply not in the
   path. The app's own bearer check still applies, which is the second layer of ADR 006 doing
   exactly what it was put there for.
3. **It does not hold the crawler's token.** `MCP_TOKEN` is accepted on `/api/prep/*` only.
   Compromising this Worker would cost study notes. It would not let anyone write jobs.

Preview URLs are disabled. They are on by default and would publish every version at its own
public address, multiplying the doors into the prep tree and leaving superseded versions
reachable.

## Why a service binding, not a fetch

A public fetch from this Worker to `job-search-os.<account>.workers.dev` fails with Cloudflare
error **1042** — a Worker may not make a subrequest to another Worker on the same `workers.dev`
zone. This was found by deploying and watching every tool return it. The service binding is the
supported route and is better anyway: no public round trip, and no Access service token needed
here at all.

## Setup

    cd mcp-remote && npm install
    npx wrangler kv namespace create OAUTH_KV     # id goes in wrangler.jsonc
    npx wrangler secret put MCP_TOKEN             # must match the app's MCP_TOKEN secret
    npx wrangler secret put LOGIN_PASSWORD        # the consent-screen password
    npx wrangler deploy

The same `MCP_TOKEN` must be set on the app (`cd app && npx wrangler secret put MCP_TOKEN`).

## Connecting ChatGPT

Developer Mode is required, and is available on Plus, Pro, Business, Enterprise and Edu — not
the free tier.

1. **Settings → Apps & Connectors → Advanced Settings → Developer Mode**, on.
2. **Apps & Connectors → Create**.
3. URL: `https://job-search-mcp.sarthak-ahuja0007.workers.dev/mcp`
4. Authentication: **OAuth**. ChatGPT registers itself through RFC 7591 dynamic registration —
   there is no client id to paste.
5. Sign in with the `LOGIN_PASSWORD` when the consent screen appears.

Write actions require per-call confirmation in ChatGPT. Note also that ChatGPT freezes tool
metadata at approval: changing a tool's schema here needs the connector re-reviewed before the
change takes effect.

## No sessions, no Durable Object

The protocol only needs one when the server has something to remember between calls, and each
of these four tools is a single request. `initialize`, `tools/list` and `tools/call` are handled
per-POST on request-scoped infrastructure. `GET /mcp` answers 405: there is no server-initiated
stream to open.
