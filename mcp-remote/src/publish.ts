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
 */

import type { Env, Json, ToolDef } from "./types";
import { app } from "./types";

/** Fields every page has, whatever discipline it belongs to. */
const common = {
  title: {
    type: "string",
    description: "The page name, e.g. 'Design a Rate Limiter' or 'Sliding Window Maximum'.",
  },
  body: {
    type: "string",
    description: "The note itself, as Markdown. This is the main content of the page.",
  },
  prompt: { type: "string", description: "The question or brief, shown under the title." },
  difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
  frequency: {
    type: "integer",
    minimum: 0,
    maximum: 5,
    description:
      "The ask score, 1-5: how often this comes up in interviews. Drives the default sort, " +
      "so leaving it 0 puts the page at the bottom of every list. Set it.",
  },
  topics: { type: "array", items: { type: "string" }, description: "Tags for filtering." },
  companies: {
    type: "array",
    items: { type: "string" },
    description: "Companies known to ask this.",
  },
  resources: {
    type: "array",
    description:
      "Reference links. YouTube links are stored as videos with the id extracted. Always give " +
      "a video a title -- a YouTube URL has nothing readable in its path, so an omitted one " +
      "derives the literal word 'Watch'.",
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
    description:
      "What to do if the page already exists. 'error' (default) refuses and tells you. " +
      "'merge' fills only empty fields and adds resources. 'replace' overwrites.",
  },
} as const;

/** Which structured fields a discipline's answers are made of. */
const DSA_FIELDS = {
  pattern: { type: "string", description: "The recognisable shape of the solution." },
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

/**
 * The ambiguity rule, repeated on every tool.
 *
 * It has to be on the tools rather than only in the server instructions, because a model
 * choosing between them is reading these descriptions and not much else. Guessing between HLD
 * and LLD is the failure worth preventing: the page lands in the wrong tree, where the company
 * index that should have linked it will never find it.
 */
const ASK_IF_UNSURE =
  " If the conversation has not clearly been about this one discipline -- or it has covered " +
  "more than one -- ask which to publish to rather than guessing.";

/**
 * The worked-answer fields.
 *
 * Structured rows rather than Markdown, for entities, interfaces and design choices. A
 * hand-written table is the one thing that fails silently -- a stray `|` in a cell shifts every
 * column after it and the table still renders -- so the server builds and escapes them, and the
 * model is spared a formatting rule it cannot verify.
 */
const SOLUTION_FIELDS = {
  problem_statement: {
    type: "string",
    description: "What is being asked, as an interviewer would put it.",
  },
  requirements: {
    type: "string",
    description:
      "Functional and non-functional, as a list. State what is OUT of scope too -- that is how " +
      "the answer stays inside an hour.",
  },
  entities: {
    type: "array",
    description:
      "The types, as rows. `fields` must list the actual fields with types -- this is the " +
      "table a reader checks when they cannot remember the model.",
    items: {
      type: "object",
      properties: {
        name: { type: "string", description: "The type name, e.g. 'Spot'." },
        fields: {
          type: "string",
          description: "Its fields with types, e.g. 'id string, size Size, occupant *Vehicle'.",
        },
        responsibility: { type: "string", description: "The one thing it is responsible for." },
      },
      required: ["name"],
    },
  },
  interfaces: {
    type: "array",
    description:
      "The seams, as rows. An interface with no answer for `purpose` probably should not exist.",
    items: {
      type: "object",
      properties: {
        name: { type: "string", description: "e.g. 'PricingStrategy'." },
        signature: {
          type: "string",
          description: "The method set, e.g. 'Price(units int) (float64, error)'.",
        },
        purpose: { type: "string", description: "What it exists to let vary." },
      },
      required: ["name", "signature"],
    },
  },
  relationships: {
    type: "string",
    description:
      "How they relate. Prefer a ```mermaid fence -- it renders as a real diagram, so a " +
      "classDiagram is usually best, or stateDiagram-v2 for a lifecycle.",
  },
  design_choices: {
    type: "array",
    description:
      "The table that carries the reasoning. One row per decision that was genuinely a " +
      "decision; 'used a class' is noise.",
    items: {
      type: "object",
      properties: {
        component: { type: "string", description: "Which part of the design, e.g. 'Pricing'." },
        choice: { type: "string", description: "What was decided." },
        principle: {
          type: "string",
          description: "The SOLID principle or pattern it follows, e.g. 'Strategy', 'OCP'.",
        },
        why: { type: "string", description: "Why it was decided that way." },
      },
      required: ["component", "choice"],
    },
  },
  edge_cases: {
    type: "string",
    description:
      "What breaks at the edges, what is handled and what is deliberately not: concurrency, " +
      "double submits, empty and full, failure part-way through.",
  },
  talking_points: {
    type: "string",
    description:
      "What you would actually say in the room -- the sentences you open with, the trade-off " +
      "you volunteer before being asked, the extension you name for 'how would you add X', " +
      "and what you left out on purpose. A short list.",
  },
  code_files: {
    type: "array",
    description:
      "The implementation, as files. Lands in the page's Code panel, which renders a folder " +
      "tree and a syntax-highlighted pane -- NOT in the body. `path` carries the folder " +
      "structure. Include go.mod, the tests and cmd/demo/main.go. Publishing any file REPLACES " +
      "the whole workspace, so always send the complete set; sending none leaves the existing " +
      "files untouched.",
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
    "Publish a WORKED low-level design answer: the reasoning as sections, the solution as " +
    "files. Use this after actually solving an LLD question -- you have the design AND the " +
    "code. Use publish_lld_design instead when you only have prose notes.\n\n" +
    "SCOPE IT TO ONE HOUR. The answer must be designable, explainable and codeable in a " +
    "60-minute interview, not a production system. Check the question against how it is solved " +
    "on LeetCode discuss, github.com/ashishps1/awesome-low-level-design and Hello Interview, " +
    "and cut what they do not carry. Six to ten types is normal; twenty is over-scoped. Two or " +
    "three interfaces, each with a real reason to vary. Persistence, auth, retries and metrics " +
    "are almost always out of scope, and saying so in requirements beats building them.\n\n" +
    "You do not write the page layout. Send the sections and the server composes the Markdown, " +
    "always in this order: Problem statement, Requirements, Entities and interfaces, " +
    "Relationships and diagrams, Design choices and principles, Cases handled and edge cases, " +
    "Talking points. Empty sections are skipped.\n\n" +
    "Write the code in Go, as a module that runs: the library package, its tests, a go.mod and " +
    "a cmd/demo/main.go that exercises the design. Verify with gofmt -l . / go vet ./... / " +
    "go test -race ./... / go run ./cmd/demo before publishing. If you cannot execute Go, say " +
    "so and hand the module over to be run rather than publishing it unchecked.\n\n" +
    "Call prep_search first. If the question already has a page, publish to it with " +
    "on_conflict 'replace' rather than creating a near-duplicate.",
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
      "Publish a data structures and algorithms question. Use this when the conversation has " +
      "been about a coding problem: arrays, strings, trees, graphs, dynamic programming, " +
      "two pointers, sliding window, heaps, tries, complexity analysis, or anything you would " +
      "solve on LeetCode." + ASK_IF_UNSURE,
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
        description:
          "'question' (default) for a 'design X' problem such as Instagram or a rate limiter. " +
          "'concept' for a building block studied on its own -- caching, CDNs, consistent " +
          "hashing, load balancing, CAP.",
      },
    },
    description:
      "Publish a HIGH-level system design page (HLD). Use this when the conversation has been " +
      "about designing a whole distributed system or the concepts behind one: scale, " +
      "throughput, sharding, replication, caching, queues, load balancing, CAP, consistency, " +
      "or designing a named product end to end. This is architecture between services, not " +
      "classes within one." + ASK_IF_UNSURE,
  }),
  publishTool({
    name: "publish_lld_design",
    title: "Publish a low-level design",
    kind: "system_design",
    parentPath: "lld",
    fields: DESIGN_FIELDS,
    description:
      "Publish a LOW-level design page (LLD). Use this when the conversation has been about " +
      "object-oriented design inside a single service: classes, interfaces, inheritance, " +
      "design patterns, SOLID, state machines, concurrency within a process, or modelling " +
      "something like a parking lot, elevator, vending machine, chess game or card deck. " +
      "This is classes and their relationships, not services and their traffic." + ASK_IF_UNSURE,
  }),
  publishTool({
    name: "publish_behavioral_story",
    title: "Publish a behavioural story",
    kind: "behavioral",
    parentPath: "",
    fields: STORY_FIELDS,
    description:
      "Publish a behavioural interview answer. Use this when the conversation has been about " +
      "your own experience rather than a technical problem: conflict with a colleague, a " +
      "failure, a project you led, leadership principles, 'tell me about a time when'." +
      ASK_IF_UNSURE,
  }),
  {
    name: "publish_page",
    title: "Publish a page anywhere (advanced)",
    description:
      "Publish to an explicit kind and section. PREFER the discipline-specific tools -- " +
      "publish_dsa_question, publish_hld_design, publish_lld_design, " +
      "publish_behavioral_story -- which file a page correctly without being told where. Use " +
      "this only for something none of them covers, such as a company's Notes page " +
      "(kind 'company', parent_path the company slug). Call prep_tree first for valid sections.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["dsa", "system_design", "behavioral", "concept", "company"],
          description: "There is no 'lld' kind: low-level design is system_design under 'lld'.",
        },
        parent_path: {
          type: "string",
          description: "Section path within the kind, e.g. 'hld/questions'. From prep_tree.",
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
