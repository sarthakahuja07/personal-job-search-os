/**
 * The public face of the prep MCP server.
 *
 * This exists for one reason: ChatGPT will not launch a local process. It only talks to a
 * remote HTTPS server, and it authenticates with OAuth -- not a bearer token, not an API key.
 * So the local stdio server in `mcp/` cannot be connected to it at any price, and this is the
 * shape the requirement forces.
 *
 * What that costs, stated plainly: this Worker is reachable by anyone on the internet and it
 * can write to the prep tree. Three things keep that honest --
 *
 *   1. OAuth guards every tool call. The consent screen asks for a password only Sarthak knows.
 *   2. The app itself stays entirely behind Cloudflare Access. This Worker holds a service
 *      token and calls it; no Access policy was weakened to make this work.
 *   3. The token it holds is *not* the crawler's. Compromising this Worker would let someone
 *      write study notes, which is bad; it would not let them write jobs.
 *
 * The app's own `/api/prep/*` routes are unchanged and still require their bearer token, so the
 * local stdio server keeps working exactly as before. Both clients, one API.
 */

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { handleMcp } from "./mcp";
import type { Env } from "./tools";

/** The single user. There is no account system here and there should not be one. */
const USER_ID = "sarthak";

function consentPage(error?: string): Response {
  // Deliberately hand-written rather than a framework: this is one form with one field, and it
  // is the only thing standing between the internet and the prep tree. It should be readable
  // in full, on one screen, by whoever audits it next.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to Prep</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center;
         font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;
         background:#0b0b0c; color:#e8e8ea; padding:24px; }
  .card { width:100%; max-width:380px; border:1px solid #26262a; border-radius:12px;
          background:#141417; padding:28px; }
  h1 { margin:0 0 6px; font-size:17px; }
  p { margin:0 0 20px; color:#9b9ba3; font-size:13px; }
  label { display:block; font-size:12px; color:#9b9ba3; margin-bottom:6px; }
  input { width:100%; box-sizing:border-box; padding:10px 12px; border-radius:8px;
          border:1px solid #2e2e34; background:#0b0b0c; color:#e8e8ea; font-size:14px; }
  button { width:100%; margin-top:14px; padding:10px 12px; border-radius:8px; border:0;
           background:#4b5cf0; color:#fff; font-size:14px; font-weight:500; cursor:pointer; }
  .err { margin:0 0 14px; padding:9px 11px; border-radius:8px; font-size:12.5px;
         background:#3a1b1f; border:1px solid #5c2a30; color:#f5b5bb; }
</style>
</head>
<body>
  <form class="card" method="POST">
    <h1>Connect to Prep</h1>
    <p>An assistant is asking to publish study pages to your prep board.</p>
    ${error ? `<p class="err">${error}</p>` : ""}
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
    <button type="submit">Allow access</button>
  </form>
</body>
</html>`;
  return new Response(html, {
    status: error ? 401 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Length-independent comparison, so a wrong guess does not leak the password's length. */
function matches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(
        "prep-publisher MCP server. Connect an MCP client to /mcp.",
        { headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    }

    if (url.pathname !== "/authorize") {
      return new Response("Not found", { status: 404 });
    }

    // Parsing validates the client, redirect URI, response type and PKCE before anything is
    // rendered, so a malformed request never reaches the password field.
    let authRequest;
    try {
      authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid authorization request";
      return new Response(message, { status: 400 });
    }

    if (request.method === "GET") return consentPage();

    if (request.method === "POST") {
      const form = await request.formData();
      const password = String(form.get("password") ?? "");
      if (!env.LOGIN_PASSWORD || !matches(password, env.LOGIN_PASSWORD)) {
        // Fail closed on an unset password too: an unconfigured secret must never mean
        // "let everyone in", which is the failure mode that turns this into an open door.
        return consentPage("That password is not right.");
      }

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: authRequest,
        userId: USER_ID,
        scope: authRequest.scope,
        props: { userId: USER_ID },
      });
      return Response.redirect(redirectTo, 302);
    }

    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  },
};

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: { fetch: handleMcp as ExportedHandlerFetchHandler },
  defaultHandler: defaultHandler as ExportedHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  // ChatGPT registers itself rather than being configured by hand, so dynamic registration is
  // not optional here.
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["prep:write"],
});
