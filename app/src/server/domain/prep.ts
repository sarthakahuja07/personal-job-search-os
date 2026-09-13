/**
 * Preparation domain: the mapping between URL segments and storage kinds, and the vocabulary
 * each discipline uses.
 *
 * Pure and separate from the repository so the URL contract is testable without a database,
 * and so adding a discipline (low-level design, Golang, a company-specific round) is a single
 * entry here rather than a new set of pages.
 */

import type { PrepDifficulty, PrepKind, PrepStatus } from "@/db/schema";

export type KindMeta = {
  kind: PrepKind;
  /** URL segment. Hyphenated for readability; storage uses snake_case. */
  segment: string;
  title: string;
  tagline: string;
  /** What the answer to this kind of question is made of. Drives the detail layout. */
  fields: { key: string; label: string; hint: string }[];
  hasDifficulty: boolean;
};

export const KINDS: KindMeta[] = [
  {
    kind: "dsa",
    segment: "dsa",
    title: "DSA",
    tagline: "Patterns worth recognising, not problems worth memorising.",
    fields: [
      { key: "pattern", label: "Pattern", hint: "The recognisable shape of the solution" },
      { key: "complexity", label: "Complexity", hint: "Time and space, and why" },
    ],
    hasDifficulty: true,
  },
  {
    kind: "system_design",
    segment: "system-design",
    title: "System Design",
    tagline: "The round that decides the level you are offered.",
    fields: [
      { key: "requirements", label: "Requirements", hint: "Functional and non-functional" },
      { key: "architecture", label: "Architecture", hint: "Components and data flow" },
      { key: "tradeoffs", label: "Trade-offs", hint: "What you gave up, and why" },
    ],
    hasDifficulty: true,
  },
  {
    kind: "behavioral",
    segment: "behavioral",
    title: "Behavioral",
    tagline: "Your stories, written once so they are recalled rather than invented.",
    fields: [
      { key: "situation", label: "Situation", hint: "Context, briefly" },
      { key: "action", label: "Action", hint: "What you specifically did" },
      { key: "outcome", label: "Outcome", hint: "Result, and what you learned" },
    ],
    hasDifficulty: false,
  },
  {
    kind: "company",
    segment: "company",
    title: "Companies",
    tagline: "What this company actually asks, and where the answers already live.",
    /*
      No structured fields. A company page is a document -- notes, a question bank, a list of
      links -- not an answer with a known shape. Giving it fields would put three empty boxes
      on every page and imply a form nobody fills.
    */
    fields: [],
    hasDifficulty: false,
  },
];

/**
 * Full slash paths for every page, by id.
 *
 * A page's address is its chain of slugs, not its own -- "instagram" lives at
 * `hld/questions/instagram`. Search returned the bare slug for a while, which produced links
 * that 404'd for every page that was not top level, and that is precisely the set of pages a
 * company page wants to link to.
 *
 * Depth-bounded rather than trusting the data: a cycle here would hang a request, and the tree
 * is only ever a few levels deep.
 */
export function buildPaths(
  rows: { id: string; slug: string; parentId: string | null }[],
): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const paths = new Map<string, string>();

  for (const row of rows) {
    const parts: string[] = [];
    let cur: { id: string; slug: string; parentId: string | null } | undefined = row;
    for (let depth = 0; cur && depth < 20; depth++) {
      parts.unshift(cur.slug);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    paths.set(row.id, parts.join("/"));
  }
  return paths;
}

/**
 * Does this page contain a Markdown table?
 *
 * The rich editor is built on StarterKit, which has no table node. `tiptap-markdown` therefore
 * parses a GFM table into loose text and the page renders as "QuestionAskedLast seen" run
 * together -- and, far worse, the editor saves that flattened text back on blur, so a single
 * click into the page destroys the table permanently.
 *
 * A page with a table is shown read-only for that reason. Not being able to hand-edit one is a
 * real limitation; silently shredding it is a bug.
 *
 * Looks for a header row followed by the `| --- |` delimiter, which is what makes a table a
 * table in GFM. A line of pipes on its own is prose about pipes.
 */
export function containsMarkdownTable(body: string | null | undefined): boolean {
  if (!body) return false;
  const lines = body.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i].trim();
    const delimiter = lines[i + 1].trim();
    if (!header.startsWith("|") || !delimiter.startsWith("|")) continue;
    if (/^\|(\s*:?-{2,}:?\s*\|)+$/.test(delimiter)) return true;
  }
  return false;
}

export function kindBySegment(segment: string): KindMeta | undefined {
  return KINDS.find((k) => k.segment === segment);
}

export function kindOf(kind: PrepKind): KindMeta | undefined {
  return KINDS.find((k) => k.kind === kind);
}

// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<PrepStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
  revisit: "Revisit",
};

/** Ordered as a workflow, which is also the order the filter chips appear in. */
export const STATUS_ORDER: PrepStatus[] = ["not_started", "in_progress", "revisit", "done"];

export const DIFFICULTY_ORDER: PrepDifficulty[] = ["easy", "medium", "hard"];

// ---------------------------------------------------------------------------

export type ProgressSummary = {
  total: number;
  done: number;
  inProgress: number;
  revisit: number;
  notStarted: number;
  percent: number;
};

export function summarise(
  items: { status: PrepStatus }[],
): ProgressSummary {
  const count = (s: PrepStatus) => items.filter((i) => i.status === s).length;
  const total = items.length;
  const done = count("done");
  return {
    total,
    done,
    inProgress: count("in_progress"),
    revisit: count("revisit"),
    notStarted: count("not_started"),
    // "Revisit" deliberately does not count as done: marking something for revision is an
    // admission it is not solid yet, and a progress bar that says otherwise is lying to you.
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

/**
 * Distinct topics with counts, most frequent first. Computed in memory rather than in SQL
 * because topics are a JSON array -- at a few hundred rows this is far cheaper than the join
 * table it would otherwise need, and D1 counts queries, not milliseconds.
 */
export function topicCounts(
  items: { topics: string[] }[],
): { topic: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const topic of item.topics) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
}
