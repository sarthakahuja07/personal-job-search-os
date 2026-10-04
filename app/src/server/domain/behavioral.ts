/**
 * Behavioral preparation: projects you can walk through, and questions answered with them.
 *
 * Two shapes of page live under `behavioral`, both ordinary prep rows:
 *
 *   project   `projects/<slug>` -- a 90-second pitch in `content.pitch`, and the deep dive as the
 *             body. The pitch is what you say; the deep dive is what you need to survive the
 *             follow-ups.
 *   question  `questions/<theme>/<slug>` -- the answer either as STAR fields
 *             (situation/task/action/outcome) or as prose in `content.answer`, optionally naming
 *             the project it draws on in `content.story`.
 *
 * Themes are folders rather than a field, so the sidebar, the folder pages and the question
 * search all group by them with no code of their own.
 *
 * Pure and client-safe: the rehearse mode runs these in the browser.
 */

import type { PrepContent, PrepStatus } from "@/db/schema";
import { buildPaths } from "./prep";
import { collectQuestions, type Question, type QuestionSourceRow } from "./prep-questions";

/** A page is a project when it carries a pitch. Nothing else marks it. */
export function isProjectContent(content: PrepContent | null | undefined): boolean {
  return typeof content?.pitch === "string" && content.pitch.trim().length > 0;
}

export type StarPart = { key: "situation" | "task" | "action" | "outcome"; letter: string; label: string; text: string };

export type AnswerShape =
  | { kind: "star"; parts: StarPart[] }
  | { kind: "prose"; text: string }
  | { kind: "empty"; hint: string | null };

const STAR: Omit<StarPart, "text">[] = [
  { key: "situation", letter: "S", label: "Situation" },
  { key: "task", letter: "T", label: "Task" },
  { key: "action", letter: "A", label: "Action" },
  // Stored as `outcome` -- the field the discipline has always had -- but said as "Result",
  // which is the word the interviewer's rubric uses.
  { key: "outcome", letter: "R", label: "Result" },
];

const filled = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * How a question's answer should be laid out.
 *
 * STAR needs a situation or an action to be STAR. The original seeded pages put a one-line
 * *hint* in `outcome` and left the rest empty, and rendering that as a lone "Result" block would
 * present advice about an answer as though it were the answer.
 */
export function answerShape(content: PrepContent | null | undefined): AnswerShape {
  const c = content ?? {};
  if (filled(c.situation) || filled(c.action)) {
    return {
      kind: "star",
      parts: STAR.filter((p) => filled(c[p.key])).map((p) => ({ ...p, text: String(c[p.key]).trim() })),
    };
  }
  if (filled(c.answer)) return { kind: "prose", text: c.answer.trim() };
  const hint = filled(c.hint) ? c.hint : filled(c.outcome) ? c.outcome : null;
  return { kind: "empty", hint: hint?.trim() ?? null };
}

/** The answer as one block of text, for timing it and for a compact preview. */
export function answerText(shape: AnswerShape): string {
  if (shape.kind === "star") return shape.parts.map((p) => p.text).join("\n\n");
  if (shape.kind === "prose") return shape.text;
  return "";
}

// ---------------------------------------------------------------------------
// Timing

/**
 * A rehearsed answer's pace -- an ordinary speaking rate. At this pace the ~250-word project
 * pitches come out at a minute and a half, which is what they were written to be.
 */
const WORDS_PER_MINUTE = 160;

/** Words in a Markdown string, ignoring the syntax around them. */
export function wordCount(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_>#|-]+/g, " ")
    .trim();
  return text ? text.split(/\s+/).length : 0;
}

/** Roughly how long this takes to say out loud, in seconds, rounded to 15. */
export function spokenSeconds(markdown: string): number {
  const seconds = (wordCount(markdown) / WORDS_PER_MINUTE) * 60;
  return Math.max(15, Math.round(seconds / 15) * 15);
}

/** 95 -> "1:30". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Minutes to read a long document silently, which is a lot faster than saying it. */
export function readMinutes(chars: number): number {
  return Math.max(1, Math.round(chars / 5 / 230));
}

// ---------------------------------------------------------------------------
// Table of contents

/**
 * A heading's anchor id.
 *
 * Shared by the renderer, which puts it on the heading, and the contents list, which links to
 * it -- computed twice from the same text, so the two cannot drift apart.
 */
export function headingSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "section"
  );
}

/**
 * Hands out unique anchor ids in document order: a second "Trade-offs" becomes `trade-offs-2`.
 * One per render, used identically by the renderer and `tableOfContents`.
 */
export function slugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = headingSlug(text);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

export type TocEntry = { id: string; title: string; level: number };

/**
 * Strip the inline Markdown a heading can carry, leaving the words the renderer will show.
 * Underscores stay: `out_node` is an identifier in these documents, not emphasis.
 */
function headingText(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .trim();
}

/**
 * Every heading at `levels`, in order, with the id the renderer gives it.
 *
 * Ids are allocated for *every* heading level, in order, because that is what the renderer
 * does -- skipping the levels not listed would desynchronise the duplicate counter the moment
 * an h3 shares a name with an h2. Fenced code is skipped: the deep dives draw diagrams in fences
 * and a line starting with `#` inside one is a comment, not a section.
 */
export function tableOfContents(markdown: string, levels: number[] = [2]): TocEntry[] {
  const next = slugger();
  const out: TocEntry[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    // h1-h4 only: those are the levels `Markdown` gives ids to.
    const m = /^(#{1,4})\s+(.+)$/.exec(line);
    if (!m) continue;
    const title = headingText(m[2]);
    if (!title) continue;
    const id = next(title);
    if (levels.includes(m[1].length)) out.push({ id, title, level: m[1].length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assembly

export type BehavioralRow = QuestionSourceRow & {
  content: PrepContent;
  bodyLength: number;
  sections: number;
};

export type StoryLink = { slug: string; title: string; org: string | null; url: string };

export type ProjectSummary = StoryLink & {
  id: string;
  summary: string | null;
  pitch: string;
  pitchSeconds: number;
  readMinutes: number;
  sections: number;
  status: PrepStatus;
  /** Questions whose answer draws on this project. */
  answers: { title: string; url: string }[];
};

export type BehavioralQuestion = Question & {
  /** The theme folder it is filed under, e.g. "Ownership & initiative". */
  theme: string;
  story: StoryLink | null;
  shape: AnswerShape;
  /** Speaking time of the written answer; 0 when there is none. */
  seconds: number;
};

export type Behavioral = {
  projects: ProjectSummary[];
  questions: BehavioralQuestion[];
};

/**
 * Projects and questions, cross-linked.
 *
 * Questions are everything under `questions/`, by the shared `isQuestion` rule, in sidebar
 * order. A question's `story` is resolved to the project page with that slug; one naming a
 * project that does not exist simply has no link, rather than a link that 404s.
 */
export function assembleBehavioral(rows: BehavioralRow[]): Behavioral {
  const paths = buildPaths(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const url = (id: string) => `/prep/behavioral/${paths.get(id)}`;

  const projectRows = rows.filter((r) => isProjectContent(r.content));
  const links = new Map<string, StoryLink>(
    projectRows.map((r) => [
      r.slug,
      { slug: r.slug, title: r.title, org: (r.content.org as string | undefined) ?? null, url: url(r.id) },
    ]),
  );

  const questions: BehavioralQuestion[] = collectQuestions(rows, "behavioral", "questions").map((q) => {
    const content = byId.get(q.id)?.content ?? {};
    const shape = answerShape(content);
    const text = answerText(shape);
    return {
      ...q,
      theme: q.folders[0] ?? "",
      story: (typeof content.story === "string" && links.get(content.story)) || null,
      shape,
      seconds: text ? spokenSeconds(text) : 0,
    };
  });

  const projects: ProjectSummary[] = projectRows.map((r) => ({
    ...links.get(r.slug)!,
    id: r.id,
    summary: (r.content.summary as string | undefined) ?? r.prompt ?? null,
    pitch: String(r.content.pitch),
    pitchSeconds: spokenSeconds(String(r.content.pitch)),
    readMinutes: readMinutes(r.bodyLength),
    sections: r.sections,
    status: r.status,
    answers: questions
      .filter((q) => q.story?.slug === r.slug)
      .map((q) => ({ title: q.title, url: q.url })),
  }));

  return { projects, questions };
}
