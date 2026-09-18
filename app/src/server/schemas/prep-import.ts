import { z } from "zod";

import { PREP_DIFFICULTIES, PREP_KINDS, PREP_STATUSES } from "@/db/schema";

/**
 * The AI -> prep contract. See docs/api.md.
 *
 * This is what an assistant hands over after a study session, and it is deliberately shaped so
 * the *page* is the unit rather than the field. A tool that accepted `title` and nothing else
 * would be used that way every time, and the tree would fill up with untagged, undated stubs
 * that are worse than no page at all -- you cannot revise from them and you cannot find them.
 *
 * So the required set is small but the optional set is explicit and named, because a model
 * fills in the fields it can see. `difficulty`, `frequency`, `topics` and `resources` are all
 * things an assistant genuinely knows at the end of a session and a human would never bother
 * to type.
 */

/**
 * Where the page goes, as a slash path *within* its kind: "hld", "hld/questions", "lld".
 *
 * Not an id. An assistant has no way to know a UUID, and asking for one guarantees either a
 * hallucinated id or everything landing at the root. Empty means the top level of the kind.
 */
const parentPath = z
  .string()
  .max(200)
  .regex(/^[a-z0-9/-]*$/i, "parent_path is a slug path like 'hld/questions'")
  .transform((s) => s.replace(/^\/+|\/+$/g, ""));

const resource = z.object({
  url: z.string().url(),
  /**
   * Optional because it is derivable. `parseResource` reads the publisher from the host and a
   * readable title from the path, so a bare YouTube link still files itself correctly as a
   * video with its id extracted.
   */
  title: z.string().max(300).nullish(),
});

/**
 * Discipline-specific fields, all optional.
 *
 * Which ones matter depends on `kind` -- pattern and complexity for DSA, requirements and
 * trade-offs for system design, situation/action/outcome for behavioral -- and that mapping
 * lives in `KINDS`, not here. Validating it twice would mean changing two files to add a
 * discipline, which is exactly what the `kind` discriminator exists to avoid.
 */
const content = z
  .object({
    pattern: z.string().max(4000).nullish(),
    complexity: z.string().max(4000).nullish(),
    approach: z.string().max(20000).nullish(),
    requirements: z.string().max(20000).nullish(),
    architecture: z.string().max(20000).nullish(),
    tradeoffs: z.string().max(20000).nullish(),
    situation: z.string().max(20000).nullish(),
    action: z.string().max(20000).nullish(),
    outcome: z.string().max(20000).nullish(),
  })
  .partial();

/**
 * One source file for the page's code workspace.
 *
 * `path` carries the structure -- "model/spot.go" puts the file in a folder -- because the tree
 * the UI draws is derived from these strings. Sending a folder list as well would be a second
 * structure that can disagree with the files.
 *
 * `language` is optional and normally omitted: it is derived from the extension, and a caller
 * guessing a highlight.js grammar id is more likely to be wrong than the extension is.
 */
const codeFile = z.object({
  path: z.string().min(1).max(300),
  content: z.string().max(200_000),
  language: z.string().max(40).nullish(),
});

/** One row of the design-choices table. Structured, so the table cannot arrive malformed. */
const designChoice = z.object({
  component: z.string().min(1).max(200),
  choice: z.string().min(1).max(2000),
  principle: z.string().max(200).nullish(),
  why: z.string().max(2000).nullish(),
});

/**
 * The sections of a low-level design answer.
 *
 * Named fields rather than a pre-formatted body, so the server decides the headings and their
 * order and every LLD page comes out the same shape. See server/domain/lld.ts.
 */
const lldSolution = z
  .object({
    problem_statement: z.string().max(20_000).nullish(),
    requirements: z.string().max(20_000).nullish(),
    entities: z.string().max(20_000).nullish(),
    relationships: z.string().max(20_000).nullish(),
    interfaces: z.string().max(20_000).nullish(),
    design_choices: z.array(designChoice).max(40).nullish(),
    edge_cases: z.string().max(20_000).nullish(),
  })
  .partial();

export const prepPageSchema = z.object({
  kind: z.enum(PREP_KINDS),
  title: z.string().min(1).max(300),
  /** The question or brief, shown under the title. */
  prompt: z.string().max(4000).nullish(),

  parent_path: parentPath.optional().default(""),

  difficulty: z.enum(PREP_DIFFICULTIES).nullish(),
  /**
   * The "ask score": 1-5, how often this comes up in interviews. Drives the default sort, so a
   * page that arrives without one sorts last and is effectively invisible.
   */
  frequency: z.number().int().min(0).max(5).optional().default(0),

  topics: z.array(z.string().min(1).max(60)).max(20).optional().default([]),
  companies: z.array(z.string().min(1).max(80)).max(20).optional().default([]),

  /** The page body, as Markdown. This is the note itself. */
  body: z.string().max(200_000).nullish(),
  content: content.optional().default({}),

  /** Reference videos and articles. */
  resources: z.array(resource).max(30).optional().default([]),

  /**
   * The worked implementation, as files, for the page's Code section.
   *
   * Replaced wholesale rather than merged when any file is sent: a solution is rewritten as a
   * unit -- renamed files, split packages -- and merging would leave the previous version's
   * orphans sitting in the tree beside the new one, compiling against nothing.
   */
  code_files: z.array(codeFile).max(60).optional().default([]),

  /**
   * Structured LLD sections. When present the server composes the body from them and ignores
   * `body`, so every low-level design page carries the same headings in the same order.
   */
  solution: lldSolution.optional().default({}),

  status: z.enum(PREP_STATUSES).optional().default("not_started"),
  source_url: z.string().url().nullish(),

  /**
   * What to do when a page with this slug already exists under the same parent.
   *
   * Default is to refuse. A study assistant that silently overwrites is how a week of notes
   * disappears, and one that silently duplicates is how the tree becomes unusable -- so the
   * caller has to say which it meant.
   */
  on_conflict: z.enum(["error", "merge", "replace"]).optional().default("error"),
});

export type PrepPageInput = z.infer<typeof prepPageSchema>;
