/**
 * Shared plumbing: the environment, the one HTTP call every tool makes, and the tool shape.
 *
 * This Worker never touches D1. It holds a token and calls the app's own prep API, which is
 * where every rule about placement, duplicates and merging already lives. Binding the database
 * here would have been one fewer hop and would have meant two implementations of "what happens
 * when the page already exists" -- the exact duplication the server-owns-business-logic rule
 * exists to prevent.
 *
 * The token is deliberately *not* the crawler's. A public endpoint that can be reached by
 * anyone on the internet should not hold the credential that can also write jobs, so the app
 * accepts a separate MCP token on the prep routes only.
 */

export type Json = Record<string, unknown>;

/** What every tool looks like, whichever module defines it. */
export type ToolDef = {
  name: string;
  title: string;
  description: string;
  annotations: Record<string, boolean>;
  inputSchema: Record<string, unknown>;
  run: (env: Env, args: Json) => Promise<Record<string, unknown>>;
};

export type Env = {
  /** The app Worker, bound directly. See the note in wrangler.jsonc. */
  APP: Fetcher;
  MCP_TOKEN: string;
  LOGIN_PASSWORD: string;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: {
    parseAuthRequest(request: Request): Promise<AuthRequest>;
    completeAuthorization(options: {
      request: AuthRequest;
      userId: string;
      scope: string[];
      metadata?: Record<string, unknown>;
      props?: Record<string, unknown>;
    }): Promise<{ redirectTo: string }>;
  };
};

export type AuthRequest = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

export async function app(env: Env, method: string, path: string, body?: unknown) {
  // The host is immaterial -- a service binding dispatches to the Worker, not to DNS -- but it
  // has to be a well-formed absolute URL, and using the real one keeps logs readable.
  const response = await env.APP.fetch(
    `https://job-search-os.internal${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${env.MCP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { error: { message: text.slice(0, 400) } };
  }

  if (!response.ok) {
    const err = (parsed as { error?: { message?: string; code?: string } }).error ?? {};
    // Pass the app's own wording through. Those messages are written to be acted on
    // ("publish with on_conflict merge"), and the model is the thing that has to act.
    return { ok: false, status: response.status, error: err.message ?? err.code ?? "failed" };
  }
  return { ok: true, ...(parsed as Record<string, unknown>) };
}

