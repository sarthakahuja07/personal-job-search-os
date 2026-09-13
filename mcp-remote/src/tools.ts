/**
 * The tools that are not publishing: looking before you write, and company preparation.
 *
 * Publishing lives in `publish.ts`, split one tool per discipline. See the note there.
 */

import { PUBLISH_TOOLS } from "./publish";
import { app, type Env, type Json, type ToolDef } from "./types";

export type { Env } from "./types";

const LOOKUP_AND_COMPANY: ToolDef[] = [
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
    name: "prep_append",
    title: "Add to an existing prep page",
    description:
      "Add to a page that already exists, without overwriting it. Use this when prep_search " +
      "finds the topic already covered. Take `kind` and `parent_path` from that search result " +
      "rather than working them out -- its `path` is the page's full section path, and the part " +
      "before the last segment is `parent_path`. Resources are always added; every other field " +
      "is filled only where the page is currently empty, so a note written by hand is never " +
      "replaced.",
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
      "Add questions to a company's Question Bank: a table per discipline of question, how " +
      "often it is asked, and when it was last seen. Questions that already have a page are " +
      "linked automatically -- pass names, not URLs. Adds by default, so you can record HLD " +
      "questions now and LLD ones later without resending the first lot; a question reported " +
      "again updates its rating and keeps the later date.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string" },
        mode: {
          type: "string",
          enum: ["merge", "replace"],
          description:
            "merge (default) adds to what is there. replace discards every question already " +
            "recorded, so only use it to rebuild a bank from scratch.",
        },
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
        mode: args.mode ?? "merge",
      }),
  },
  {
    name: "company_question_index",
    title: "Write a company's DSA, HLD or LLD index",
    description:
      "Add questions to one of a company's index pages -- DSA, HLD or LLD -- each linked to its " +
      "real page in that tree. Titles are resolved server-side, so pass names rather than URLs. " +
      "Adds by default, so a later session need not resend what is already there. Questions " +
      "with no page yet are kept under 'Not written yet' and returned in `unlinked`; that list " +
      "is what to study next.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string" },
        discipline: { type: "string", enum: ["dsa", "hld", "lld"] },
        mode: {
          type: "string",
          enum: ["merge", "replace"],
          description: "merge (default) adds to what is there. replace discards it.",
        },
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
        mode: args.mode ?? "merge",
      }),
  },
];

/**
 * Order matters a little: the two read-only tools first, then publishing, then company work.
 * A model scanning the list meets "look before you write" before it meets a way to write.
 */
export const TOOLS: ToolDef[] = [...LOOKUP_AND_COMPANY.slice(0, 2), ...PUBLISH_TOOLS, ...LOOKUP_AND_COMPANY.slice(2)];
