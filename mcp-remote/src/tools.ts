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
      "Where a page can go, and which fields each discipline uses. Call once per session, " +
      "before the first publish -- it returns every existing folder's `parent_path`; don't " +
      "guess one.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (env: Env) => app(env, "GET", "/api/prep/tree"),
  },
  {
    name: "prep_search",
    title: "Search existing prep pages",
    description:
      "Find existing pages by title or prompt. Call before publishing, to avoid a duplicate -- " +
      "a close match means prep_append, not a second page.",
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
      "Add to a page that already exists, without overwriting it. Use once prep_search finds " +
      "the topic covered -- take `kind`/`parent_path` from that result (`path` minus its last " +
      "segment). Resources always add; every other field fills only if currently empty.",
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
      "Create a company's prep folder + its five pages (Notes, Question Bank, DSA, HLD, LLD). " +
      "Safe to call again -- existing pages are untouched. Call before any other company tool.",
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
      "Add rows to a company's Question Bank: what it asks, how often, and where you found " +
      "that. Adds by default. A question reported again keeps the newer date and rating.",
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
              source_url: {
                type: "string",
                description: "Where FOUND (LeetCode, an interview post) -- not a link to our own page.",
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
      "Add questions to a company's DSA/HLD/LLD index, linked to the real pages. Pass names, " +
      "not URLs -- titles resolve against the tree server-side. Unmatched questions come back " +
      "in `unlinked` (what to write next); never silently dropped.",
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
                description: "Matched against real pages -- close is good enough.",
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
