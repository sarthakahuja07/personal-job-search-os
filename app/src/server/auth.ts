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
