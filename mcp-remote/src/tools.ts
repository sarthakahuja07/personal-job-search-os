/**
 * The four tools, and the one HTTP call each of them makes.
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

async function app(env: Env, method: string, path: string, body?: unknown) {
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

type Json = Record<string, unknown>;

export const TOOLS = [
  {
    name: "prep_tree",
    title: "List prep sections",
    description:
      "List where a page can be published and what each discipline expects. Call this before " +
      "publishing for the first time in a session: it returns the available `kind` values, the " +
      "structured fields each one uses, and every section with the `parent_path` needed to " +
      "publish into it.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (env: Env) => app(env, "GET", "/api/prep/tree"),
  },
  {
    name: "prep_search",
    title: "Search existing prep pages",
    description:
      "Find existing pages by title or prompt, to avoid creating a duplicate. Always call this " +
      "before prep_publish. If a close match comes back, prefer prep_append over publishing a " +
      "second page on the same topic.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text, matched against titles and prompts." },
        kind: {
          type: "string",
          enum: ["dsa", "system_design", "behavioral", "concept", "company"],
          description: "Optionally narrow to one discipline.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: (env: Env, args: Json) => {
      const params = new URLSearchParams({ q: String(args.query ?? "") });
      if (args.kind) params.set("kind", String(args.kind));
      return app(env, "GET", `/api/prep/pages?${params}`);
    },
  },
  {
    name: "prep_publish",
    title: "Publish a study page",
    description:
      "Publish a study page into the prep tree, with its notes and reference links. Fill in as " +
      "much as the session actually established -- a page with only a title cannot be revised " +
      "from and will sort last. Low-level design is kind `system_design` with parent_path 'lld'.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["dsa", "system_design", "behavioral", "concept", "company"] },
        title: { type: "string", description: "The page name, e.g. 'Design a Rate Limiter'." },
        body: { type: "string", description: "The note itself, as Markdown. The main content." },
        prompt: { type: "string", description: "The question or brief, shown under the title." },
        parent_path: {
          type: "string",
          description: "Section path within the kind, e.g. 'hld' or 'lld'. From prep_tree.",
        },
        difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
        frequency: {
          type: "integer",
          minimum: 0,
          maximum: 5,
          description:
            "The ask score, 1-5: how often this comes up in interviews. Drives the default " +
            "sort, so leaving it 0 makes the page effectively invisible. Set it.",
        },
        topics: { type: "array", items: { type: "string" } },
        companies: { type: "array", items: { type: "string" } },
        resources: {
          type: "array",
          description:
            "Reference links. YouTube links are stored as videos with the id extracted. Always " +
            "give a video a title -- a YouTube URL has nothing readable in its path, so an " +
            "omitted one derives the literal word 'Watch'.",
          items: {
            type: "object",
            properties: { url: { type: "string" }, title: { type: "string" } },
            required: ["url"],
          },
        },
        pattern: { type: "string", description: "DSA: the recognisable shape of the solution." },
        complexity: { type: "string", description: "DSA: time and space, and why." },
        approach: { type: "string", description: "DSA: how the solution is reached." },
        requirements: { type: "string", description: "System design: functional and non-functional." },
        architecture: { type: "string", description: "System design: components and data flow." },
        tradeoffs: { type: "string", description: "System design: what was given up, and why." },
        situation: { type: "string", description: "Behavioral: context, briefly." },
        action: { type: "string", description: "Behavioral: what you specifically did." },
        outcome: { type: "string", description: "Behavioral: result, and what you learned." },
        source_url: { type: "string" },
        on_conflict: {
          type: "string",
          enum: ["error", "merge", "replace"],
          description:
            "What to do if the page exists. 'error' (default) refuses, 'merge' fills only empty " +
            "fields and adds resources, 'replace' overwrites.",
        },
      },
      required: ["kind", "title"],
      additionalProperties: false,
    },
    run: (env: Env, args: Json) =>
      app(env, "POST", "/api/prep/pages", {
        kind: args.kind,
        title: args.title,
        prompt: args.prompt ?? null,
        parent_path: args.parent_path ?? "",
        difficulty: args.difficulty ?? null,
        frequency: args.frequency ?? 0,
        topics: args.topics ?? [],
        companies: args.companies ?? [],
        body: args.body ?? null,
        resources: args.resources ?? [],
        source_url: args.source_url ?? null,
        on_conflict: args.on_conflict ?? "error",
        content: {
          pattern: args.pattern ?? null,
          complexity: args.complexity ?? null,
          approach: args.approach ?? null,
          requirements: args.requirements ?? null,
          architecture: args.architecture ?? null,
          tradeoffs: args.tradeoffs ?? null,
          situation: args.situation ?? null,
          action: args.action ?? null,
          outcome: args.outcome ?? null,
        },
      }),
  },
  {
    name: "prep_append",
    title: "Add to an existing prep page",
    description:
      "Add to a page that already exists, without overwriting it. Use this when prep_search " +
      "finds the topic already covered. Resources are always added; every other field is filled " +
      "only where the page is currently empty, so a note written by hand is never replaced.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["dsa", "system_design", "behavioral", "concept", "company"] },
        title: { type: "string", description: "The existing page's exact title." },
        parent_path: { type: "string", description: "The section it lives in." },
        body: { type: "string", description: "Used only if the page has no body yet." },
        resources: {
          type: "array",
          description: "Links to add. Ones already present are ignored. Give videos a title.",
          items: {
            type: "object",
            properties: { url: { type: "string" }, title: { type: "string" } },
            required: ["url"],
          },
        },
        topics: { type: "array", items: { type: "string" } },
        companies: { type: "array", items: { type: "string" } },
        difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
        frequency: { type: "integer", minimum: 0, maximum: 5 },
      },
      required: ["kind", "title"],
      additionalProperties: false,
    },
    run: (env: Env, args: Json) =>
      app(env, "POST", "/api/prep/pages", {
        kind: args.kind,
        title: args.title,
        parent_path: args.parent_path ?? "",
        body: args.body ?? null,
        resources: args.resources ?? [],
        topics: args.topics ?? [],
        companies: args.companies ?? [],
        difficulty: args.difficulty ?? null,
        frequency: args.frequency ?? 0,
        on_conflict: "merge",
      }),
  },
  {
    name: "company_scaffold",
    title: "Create a company's prep folder",
    description:
      "Create a company folder with its five pages: Notes, Question Bank, DSA, HLD and LLD. " +
      "Safe to call again -- existing pages are left alone. Call this before any other company " +
      "tool.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "e.g. 'Amazon'." } },
      required: ["name"],
      additionalProperties: false,
    },
    run: (env: Env, args: Json) =>
      app(env, "POST", "/api/prep/company", { op: "scaffold", name: args.name }),
  },
  {
    name: "company_question_bank",
    title: "Write a company's question bank",
    description:
      "Replace a company's Question Bank page with a table per discipline: question, how often " +
      "it is asked, and when it was last seen. Questions that already have a page are linked " +
      "automatically. Send the whole bank each time -- this replaces the page rather than " +
      "appending to it.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string" },
        entries: { type: "array", items: {
            type: "object",
            properties: {
              question: { type: "string" },
              discipline: { type: "string", enum: ["dsa", "hld", "lld"] },
              frequency: {
                type: "integer",
                minimum: 0,
                maximum: 5,
                description: "How often this company asks it, 1-5. Drives the sort.",
              },
              last_asked: {
                type: "string",
                description: "ISO date (YYYY-MM-DD) it was last known to be asked.",
              },
            },
            required: ["question", "discipline"],
          } },
      },
      required: ["company", "entries"],
      additionalProperties: false,
    },
    run: (env: Env, args: Json) =>
      app(env, "POST", "/api/prep/company", {
        op: "question_bank",
        company: args.company,
        entries: args.entries,
      }),
  },
  {
    name: "company_question_index",
    title: "Write a company's DSA, HLD or LLD index",
    description:
      "Replace one of a company's index pages with a list of questions, each linked to its real " +
      "page in the DSA, HLD or LLD tree. Titles are resolved server-side, so pass names rather " +
      "than URLs. Questions with no page yet are kept under 'Not written yet' and returned in " +
      "`unlinked` -- that list is what to study next.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string" },
        discipline: { type: "string", enum: ["dsa", "hld", "lld"] },
        questions: { type: "array", items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description:
                  "The question's name. Matched against real pages -- close is good enough, " +
                  "'Design a rate limiter' finds a page called 'Rate Limiter'.",
              },
              frequency: { type: "integer", minimum: 0, maximum: 5 },
              last_asked: { type: "string", description: "ISO date (YYYY-MM-DD)." },
            },
            required: ["title"],
          } },
      },
      required: ["company", "discipline", "questions"],
      additionalProperties: false,
    },
    run: (env: Env, args: Json) =>
      app(env, "POST", "/api/prep/company", {
        op: "question_index",
        company: args.company,
        discipline: args.discipline,
        questions: args.questions,
      }),
  },
] as const;

export type Tool = (typeof TOOLS)[number];
