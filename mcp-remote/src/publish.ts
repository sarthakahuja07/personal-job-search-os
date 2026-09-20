/**
 * One publishing tool per discipline, rather than one tool with a `kind` field.
 *
 * The generic tool asked the model to get two things right at once: `kind`, and a `parent_path`
 * that does not follow from it. Low-level design is the case that exposes it -- there is no
 * `kind: "lld"`, it is `system_design` filed under `lld` -- so the single most common mistake
 * was also the one a description could not prevent, because the model had already chosen the
 * tool before it read about the trap.
 *
 * Splitting moves the routing out of the arguments and into the tool name, where the model is
 * choosing anyway. `publish_lld_design` cannot be filed under HLD; there is no argument for it.
 * Each schema then carries only the fields its discipline actually uses, so the shape of the
 * call is itself a statement about what kind of work it is.
 *
 * The cost is four tools where there was one, and the guard against that is that their names
 * are maximally distinct. Nothing here is a near-synonym of anything else.
 *
 * Every `description:` string below -- on a tool and on each of its fields -- is sent to the
 * model on *every turn* of the conversation, whatever tool that turn actually calls: this is
 * the MCP tools/list payload, not a one-time cost paid when a tool runs. A verbose description
 * is rent, not a purchase, and it was the largest token cost in an otherwise ordinary study
 * session (see docs/mcp-guide.md). So these keep only what changes what the model does if it's
 * missing -- required shapes, format traps, the one-hour rule -- and cut the rationale for why;
 * that rationale lives in this comment (never transmitted) and in docs/, not in the schema.
 */

import type { Env, Json, ToolDef } from "./types";
import { app } from "./types";

/** Fields every page has, whatever discipline it belongs to. */
const common = {
  title: { type: "string", description: "The page name." },
  body: { type: "string", description: "The note, as Markdown." },
  prompt: { type: "string", description: "The question or brief, shown under the title." },
  difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
  frequency: {
    type: "integer",
    minimum: 0,
    maximum: 5,
    description: "Ask score 1-5 (0 sorts to the bottom -- set it).",
  },
  topics: { type: "array", items: { type: "string" }, description: "Tags." },
  companies: { type: "array", items: { type: "string" }, description: "Companies known to ask this." },
  resources: {
    type: "array",
    description: "[{url, title}]. Title videos; an untitled YouTube URL becomes 'Watch'.",
    items: {
      type: "object",
      properties: { url: { type: "string" }, title: { type: "string" } },
      required: ["url"],
    },
  },
  source_url: { type: "string", description: "Where this was studied from." },
  on_conflict: {
    type: "string",
    enum: ["error", "merge", "replace"],
    description: "error (default) refuses an existing page. merge fills gaps. replace overwrites.",
  },
} as const;

/** Which structured fields a discipline's answers are made of. */
const DSA_FIELDS = {
  pattern: { type: "string", description: "The solution's recognisable shape." },
  complexity: { type: "string", description: "Time and space, and why." },
  approach: { type: "string", description: "How the solution is reached." },
} as const;

const DESIGN_FIELDS = {
  requirements: { type: "string", description: "Functional and non-functional." },
  architecture: { type: "string", description: "Components and data flow." },
  tradeoffs: { type: "string", description: "What was given up, and why." },
} as const;

const STORY_FIELDS = {
  situation: { type: "string", description: "Context, briefly." },
  action: { type: "string", description: "What you specifically did." },
  outcome: { type: "string", description: "Result, and what you learned." },
} as const;

/** Every content field, so a value that arrives is passed on whichever tool carried it. */
const CONTENT_KEYS = [
  "pattern",
  "complexity",
  "approach",
  "requirements",
  "architecture",
  "tradeoffs",
  "situation",
  "action",
  "outcome",
] as const;

function publishTool(spec: {
  name: string;
  title: string;
  description: string;
  kind: string;
  /** Fixed section within the kind. The model never supplies this. */
  parentPath: string | ((args: Json) => string);
  fields: Record<string, unknown>;
  extraProperties?: Record<string, unknown>;
}): ToolDef {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: { ...common, ...spec.fields, ...(spec.extraProperties ?? {}) },
      required: ["title"],
      additionalProperties: false,
    },
    run: (env: Env, args: Json) =>
      app(env, "POST", "/api/prep/pages", {
        kind: spec.kind,
        title: args.title,
        prompt: args.prompt ?? null,
        parent_path:
          typeof spec.parentPath === "function" ? spec.parentPath(args) : spec.parentPath,
        difficulty: args.difficulty ?? null,
        frequency: args.frequency ?? 0,
        topics: args.topics ?? [],
        companies: args.companies ?? [],
        body: args.body ?? null,
        resources: args.resources ?? [],
        source_url: args.source_url ?? null,
        on_conflict: args.on_conflict ?? "error",
        content: Object.fromEntries(CONTENT_KEYS.map((k) => [k, args[k] ?? null])),
      }),
  };
}

/** Appended only to the tools whose domain genuinely overlaps another (HLD/LLD, DSA vs both). */
const ASK_IF_UNSURE = " Wrong discipline? Ask, don't guess.";

/**
 * The worked-answer fields: structured rows, not Markdown, for entities/interfaces/design
 * choices -- a hand-written table is the one thing that fails silently (a stray `|` shifts
 * every later column and still renders), so the server builds and escapes these instead.
 */
const SOLUTION_FIELDS = {
  problem_statement: { type: "string", description: "What is being asked." },
  requirements: {
    type: "string",
    description: "Functional and non-functional. Name what's OUT of scope too.",
  },
  entities: {
    type: "array",
    description: "Rows, not a hand-written table.",
    items: {
      type: "object",
      properties: {
        name: { type: "string", description: "e.g. 'Spot'." },
        fields: { type: "string", description: "e.g. 'id string, size Size, occupant *Vehicle'." },
        responsibility: { type: "string", description: "The one thing it's responsible for." },
      },
      required: ["name"],
    },
  },
  interfaces: {
    type: "array",
    description: "Rows. No answer for `purpose` usually means it shouldn't exist.",
    items: {
      type: "object",
      properties: {
        name: { type: "string", description: "e.g. 'PricingStrategy'." },
        signature: { type: "string", description: "e.g. 'Price(units int) (float64, error)'." },
        purpose: { type: "string", description: "What it exists to let vary." },
      },
      required: ["name", "signature"],
    },
  },
  relationships: {
    type: "string",
    description: "A ```mermaid fence (classDiagram, or stateDiagram-v2 for a lifecycle) renders as a real diagram.",
  },
  design_choices: {
    type: "array",
    description: "One row per genuine decision; 'used a class' is noise.",
    items: {
      type: "object",
      properties: {
        component: { type: "string", description: "e.g. 'Pricing'." },
        choice: { type: "string", description: "What was decided." },
        principle: { type: "string", description: "SOLID principle or pattern, e.g. 'Strategy', 'OCP'." },
        why: { type: "string", description: "Why." },
      },
      required: ["component", "choice"],
    },
  },
  edge_cases: {
    type: "string",
    description: "What's handled at the edges, and what's deliberately not.",
  },
  talking_points: {
    type: "string",
    description: "What you'd say in the room -- opener, a trade-off, an extension. A short list.",
  },
  code_files: {
    type: "array",
    description:
      "Lands in the page's Code panel, NOT the body. Publishing any file REPLACES the whole " +
      "workspace -- always send the complete set.",
    items: {
      type: "object",
      properties: {
        path: { type: "string", description: "e.g. 'model/spot.go', 'cmd/demo/main.go'." },
        content: { type: "string", description: "The file's full contents." },
      },
      required: ["path", "content"],
    },
  },
} as const;

const LLD_SOLUTION_TOOL: ToolDef = {
  name: "publish_lld_solution",
  title: "Publish a worked LLD solution",
  description:
    "Publish a WORKED LLD answer: design + working code. (Notes only, no code? publish_lld_design.)\n\n" +
    "Scope to a 60-minute interview, not a production system: 6-10 types is normal, 20 is " +
    "over-scoped. Check the question against how it's actually solved (LeetCode discuss, " +
    "awesome-low-level-design, Hello Interview) and cut what those don't carry. State " +
    "persistence/auth/retries as out of scope rather than building them.\n\n" +
    "The server composes the page from your sections (fixed order: problem, requirements, " +
    "entities/interfaces, relationships, design choices, edge cases, talking points) -- send " +
    "fields, not a formatted body.\n\n" +
    "Code is Go, a runnable module (go.mod + tests + cmd/demo/main.go), in `code_files` ONLY -- " +
    "never in a text field. Run gofmt/vet/test -race/the demo before publishing; don't publish " +
    "code you haven't run.\n\n" +
    "Call prep_search first; if the page exists, use on_conflict 'replace'.",
  annotations: { readOnlyHint: false, destructiveHint: false },
  inputSchema: {
    type: "object",
    properties: { ...common, ...SOLUTION_FIELDS },
    required: ["title"],
    additionalProperties: false,
  },
  run: (env: Env, args: Json) =>
    app(env, "POST", "/api/prep/pages", {
      kind: "system_design",
      parent_path: "lld",
      title: args.title,
      prompt: args.prompt ?? null,
      difficulty: args.difficulty ?? null,
      frequency: args.frequency ?? 0,
      topics: args.topics ?? [],
      companies: args.companies ?? [],
      resources: args.resources ?? [],
      source_url: args.source_url ?? null,
      on_conflict: args.on_conflict ?? "error",
      solution: {
        problem_statement: args.problem_statement ?? null,
        requirements: args.requirements ?? null,
        entities: args.entities ?? [],
        interfaces: args.interfaces ?? [],
        relationships: args.relationships ?? null,
        design_choices: args.design_choices ?? [],
        edge_cases: args.edge_cases ?? null,
        talking_points: args.talking_points ?? null,
      },
      code_files: args.code_files ?? [],
      // The prose sections also fill the discipline fields the page UI shows as
      // "Starting points", so the page is useful in both places without asking twice.
      content: {
        requirements: args.requirements ?? null,
        architecture: args.relationships ?? null,
        tradeoffs: args.edge_cases ?? null,
      },
    }),
};

export const PUBLISH_TOOLS: ToolDef[] = [
  LLD_SOLUTION_TOOL,
  publishTool({
    name: "publish_dsa_question",
    title: "Publish a DSA question",
    kind: "dsa",
    parentPath: "",
    fields: DSA_FIELDS,
    description:
      "Publish a DSA question: arrays, trees, graphs, DP, two pointers, sliding window, " +
      "complexity." + ASK_IF_UNSURE,
  }),
  publishTool({
    name: "publish_hld_design",
    title: "Publish a high-level system design",
    kind: "system_design",
    // "Design X" questions live under hld/questions; the concepts they draw on sit directly
    // under hld. Both are HLD, so this is a section rather than a separate tool.
    parentPath: (args) => (args.section === "concept" ? "hld" : "hld/questions"),
    fields: DESIGN_FIELDS,
    extraProperties: {
      section: {
        type: "string",
        enum: ["question", "concept"],
        description: "'question' (default) for 'design X'. 'concept' for a building block studied alone.",
      },
    },
    description:
      "Publish a HIGH-level design page: architecture *between* services -- scale, sharding, " +
      "replication, caching, queues, CAP, or a named product end to end. Not classes within " +
      "one service; that's publish_lld_design." + ASK_IF_UNSURE,
  }),
  publishTool({
    name: "publish_lld_design",
    title: "Publish a low-level design",
    kind: "system_design",
    parentPath: "lld",
    fields: DESIGN_FIELDS,
    description:
      "Publish a LOW-level design page from PROSE NOTES ONLY (no code yet): classes, " +
      "interfaces, design patterns, SOLID, state machines -- a parking lot, elevator, vending " +
      "machine, chess. If you have working code too, use publish_lld_solution instead." +
      ASK_IF_UNSURE,
  }),
  publishTool({
    name: "publish_behavioral_story",
    title: "Publish a behavioural story",
    kind: "behavioral",
    parentPath: "",
    fields: STORY_FIELDS,
    description:
      "Publish a behavioural answer: your own experience, not a technical problem -- conflict, " +
      "a failure, a project you led, 'tell me about a time when'." + ASK_IF_UNSURE,
  }),
  {
    name: "publish_page",
    title: "Publish a page anywhere (advanced)",
    description:
      "Escape hatch: publish to an explicit kind + section. Prefer the discipline-specific " +
      "tools; use this only for what none of them covers (e.g. a company's Notes page, kind " +
      "'company'). There is no 'lld' kind -- it's 'system_design' under parent_path 'lld'.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["dsa", "system_design", "behavioral", "concept", "company"],
          description: "Which tree the page belongs to.",
        },
        parent_path: {
          type: "string",
          description: "Section within the kind, e.g. 'hld/questions'. prep_tree lists valid ones.",
        },
        ...common,
        ...DSA_FIELDS,
        ...DESIGN_FIELDS,
        ...STORY_FIELDS,
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
        content: Object.fromEntries(CONTENT_KEYS.map((k) => [k, args[k] ?? null])),
      }),
  },
];
