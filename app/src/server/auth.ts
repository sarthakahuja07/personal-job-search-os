import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Length-independent comparison, so failures do not leak token length by timing. */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type AuthFailure = { ok: false; response: Response };
export type AuthSuccess = { ok: true };

/**
 * Verifies the crawler's bearer token. Cloudflare Access already fronts the Worker; this is the
 * independent second layer, so a misconfigured Access policy cannot silently open a write path
 * (ADR 006).
 */
export function requireIngestToken(request: Request): AuthFailure | AuthSuccess {
  const { env } = getCloudflareContext();
  const expected = env.INGEST_TOKEN;

  if (!expected) {
    // Fail closed: an unset secret must never mean "allow everyone".
    return {
      ok: false,
      response: Response.json(
        { error: { code: "not_configured", message: "INGEST_TOKEN is not configured" } },
        { status: 500 },
      ),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented || !tokensMatch(presented, expected)) {
    return {
      ok: false,
      response: Response.json(
        { error: { code: "unauthorized", message: "Missing or invalid bearer token" } },
        { status: 401 },
      ),
    };
  }
  return { ok: true };
}

/**
 * The prep write path, which has two callers with very different exposure.
 *
 * The local MCP server runs on Sarthak's machine behind Access and uses `INGEST_TOKEN`. The
 * remote one is a public Worker that ChatGPT can reach, and it uses `MCP_TOKEN`.
 *
 * They are separate on purpose. The remote Worker is the only component of this system that is
 * reachable by anyone on the internet, so it must not hold the credential that also writes
 * jobs -- compromising it should cost study notes, not the board the whole project exists for.
 * Either token opens this route; neither opens ingest.
 */
export function requirePrepToken(request: Request): AuthFailure | AuthSuccess {
  const { env } = getCloudflareContext();
  const accepted = [env.MCP_TOKEN, env.INGEST_TOKEN].filter(
    (t): t is string => typeof t === "string" && t.length > 0,
  );

  if (accepted.length === 0) {
    return {
      ok: false,
      response: Response.json(
        { error: { code: "not_configured", message: "No prep token is configured" } },
        { status: 500 },
      ),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Every candidate is compared even after a match, so the number of comparisons does not
  // depend on which token was presented.
  const ok = accepted.reduce(
    (matched, candidate) => (presented && tokensMatch(presented, candidate)) || matched,
    false,
  );

  if (!ok) {
    return {
      ok: false,
      response: Response.json(
        { error: { code: "unauthorized", message: "Missing or invalid bearer token" } },
        { status: 401 },
      ),
    };
  }
  return { ok: true };
}
