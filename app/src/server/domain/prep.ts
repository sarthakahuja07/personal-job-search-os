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
    hasDifficulty: false,
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
];

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
