/**
 * What a company's pages are made of.
 *
 * A company folder holds five pages, and three of them are generated rather than written:
 * a question bank, and one linked index per discipline. Generating them is the point -- a
 * question bank typed by hand drifts out of date the first week, and a list of links typed by
 * hand contains URLs that were correct when they were typed.
 *
 * Everything here is pure: rows in, Markdown out. The resolving of a question title to a real
 * page happens in the service, because only the database knows what exists.
 */

/** The three rounds a company is prepared for. Notes and the bank are the other two pages. */
export const DISCIPLINES = ["dsa", "hld", "lld"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const DISCIPLINE_TITLE: Record<Discipline, string> = {
  dsa: "DSA",
  hld: "HLD",
  lld: "LLD",
};

/** The five pages every company gets, in the order they should read. */
export const COMPANY_PAGES = [
  { slug: "notes", title: "Notes" },
  { slug: "question-bank", title: "Question Bank" },
  { slug: "dsa", title: "DSA" },
  { slug: "hld", title: "HLD" },
  { slug: "lld", title: "LLD" },
] as const;

export type BankEntry = {
  question: string;
  discipline: Discipline;
  /** How often it is asked, 1-5. Same scale as a prep page's own ask score. */
  frequency: number;
  /** ISO date (YYYY-MM-DD) it was last known to be asked, if known. */
  lastAsked?: string | null;
  /** Where the answer lives, when there is one. */
  path?: string | null;
};

/** Markdown table cells cannot contain a raw pipe without ending the cell. */
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();

const byFrequencyThenName = (a: BankEntry, b: BankEntry) =>
  b.frequency - a.frequency || a.question.localeCompare(b.question);

/**
 * The question bank: one table per discipline, sorted by how often it is asked.
 *
 * Sorted rather than left in the order it arrived, because the only question a bank is ever
 * asked is "what should I do first", and that is the frequency column.
 */
export function renderQuestionBank(company: string, entries: BankEntry[]): string {
  const lines: string[] = [`# ${company} — question bank`, ""];

  if (entries.length === 0) {
    lines.push("_Nothing recorded yet._");
    return lines.join("\n");
  }

  for (const discipline of DISCIPLINES) {
    const rows = entries.filter((e) => e.discipline === discipline).sort(byFrequencyThenName);
    if (rows.length === 0) continue;

    lines.push(`## ${DISCIPLINE_TITLE[discipline]}`, "");
    lines.push("| Question | Asked | Last seen |");
    lines.push("| --- | --- | --- |");
    for (const row of rows) {
      // Linked where the answer exists, plain text where it does not. A bank entry with no
      // page yet is still worth recording -- it is the list of what to write next.
      const name = row.path
        ? `[${cell(row.question)}](/prep/${row.path})`
        : cell(row.question);
      lines.push(`| ${name} | ${row.frequency}/5 | ${row.lastAsked ?? "—"} |`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export type QuestionLink = {
  title: string;
  /** Resolved page path, e.g. "system-design/hld/questions/instagram". Null when not found. */
  path: string | null;
  frequency?: number;
  lastAsked?: string | null;
};

/**
 * One discipline's index for a company: a list of questions, linked to the real pages.
 *
 * Unresolved titles are kept and marked rather than dropped. A question this company asks that
 * has no page yet is the most useful line on the page -- it is the next thing to study -- and
 * silently omitting it would make the list look complete when it is exactly the opposite.
 */
export function renderQuestionIndex(
  company: string,
  discipline: Discipline,
  questions: QuestionLink[],
): string {
  const title = DISCIPLINE_TITLE[discipline];
  const lines: string[] = [`# ${company} — ${title}`, ""];

  if (questions.length === 0) {
    lines.push("_No questions recorded yet._");
    return lines.join("\n");
  }

  const sorted = [...questions].sort(
    (a, b) => (b.frequency ?? 0) - (a.frequency ?? 0) || a.title.localeCompare(b.title),
  );

  const linked = sorted.filter((q) => q.path);
  const missing = sorted.filter((q) => !q.path);

  for (const q of linked) {
    const meta = [
      q.frequency ? `asked ${q.frequency}/5` : null,
      q.lastAsked ? `last seen ${q.lastAsked}` : null,
    ].filter(Boolean);
    lines.push(`- [${q.title}](/prep/${q.path})${meta.length ? ` — ${meta.join(", ")}` : ""}`);
  }

  if (missing.length > 0) {
    lines.push("", "## Not written yet", "");
    for (const q of missing) {
      const meta = [
        q.frequency ? `asked ${q.frequency}/5` : null,
        q.lastAsked ? `last seen ${q.lastAsked}` : null,
      ].filter(Boolean);
      lines.push(`- ${q.title}${meta.length ? ` — ${meta.join(", ")}` : ""}`);
    }
  }

  return lines.join("\n").trimEnd();
}

/**
 * Which tree a discipline's questions live in.
 *
 * HLD and LLD are both `system_design`; they are sections of it, not kinds. Encoding that here
 * keeps the caller from having to know it, and keeps the one place it could be got wrong down
 * to a single table.
 */
export const DISCIPLINE_SOURCE: Record<
  Discipline,
  { kind: "dsa" | "system_design"; parentPath: string }
> = {
  dsa: { kind: "dsa", parentPath: "" },
  hld: { kind: "system_design", parentPath: "hld" },
  lld: { kind: "system_design", parentPath: "lld" },
};
