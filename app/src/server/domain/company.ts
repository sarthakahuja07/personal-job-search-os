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
  /**
   * Where this was reported -- the LeetCode problem, the interview-experience post, the blog.
   *
   * Deliberately *not* a link to our own page for the question. The bank is a record of what
   * this company asks and where that was learned; the discipline indexes are the place that
   * links into our answers. Keeping the two apart means the bank stays useful as evidence even
   * for questions we have written nothing about.
   */
  sourceUrl?: string | null;
};

/** A readable label for an external link: the publisher, not the whole URL. */
function sourceLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const named: [RegExp, string][] = [
      [/^leetcode\.com$/, "LeetCode"],
      [/^(www\.)?geeksforgeeks\.org$/, "GeeksforGeeks"],
      [/^teamblind\.com$/, "Blind"],
      [/^glassdoor\./, "Glassdoor"],
      [/^interviewbit\.com$/, "InterviewBit"],
      [/^hellointerview\.com$/, "Hello Interview"],
      [/^bytebytego\.com$/, "ByteByteGo"],
      [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
      [/(^|\.)reddit\.com$/, "Reddit"],
      [/(^|\.)linkedin\.com$/, "LinkedIn"],
    ];
    for (const [pattern, name] of named) if (pattern.test(host)) return name;
    return host;
  } catch {
    return "source";
  }
}

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
    lines.push("| Question | Asked | Last seen | Source |");
    lines.push("| --- | --- | --- | --- |");
    for (const row of rows) {
      // The question itself is plain text here. Where the answer lives is the discipline
      // index's job; this column records where the *question* was found.
      const source = row.sourceUrl
        ? `[${cell(sourceLabel(row.sourceUrl))}](${row.sourceUrl})`
        : "—";
      lines.push(
        `| ${cell(row.question)} | ${row.frequency}/5 | ${row.lastAsked ?? "—"} | ${source} |`,
      );
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
 * What a question is called, for the purpose of deciding it is the same question.
 *
 * Case and surrounding punctuation vary between sessions -- "LRU Cache", "lru cache", "LRU
 * cache." are one question -- and treating them as three is how a bank accumulates the same
 * row three times.
 */
const identity = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Merge newly reported questions into what a page already holds.
 *
 * This is what makes a page appendable. Asking for a company's HLD questions today and its LLD
 * questions next week has to add to the page rather than replace it, because the next session
 * will not have the first one's list to resend -- and a tool that silently dropped the earlier
 * half would look like it worked.
 *
 * When the same question is reported twice, the new report wins on anything it states and the
 * old value survives anything it omits. Two exceptions:
 *
 *   the date     the *later* sighting wins regardless of which call it arrived in, because
 *                "last asked" means the most recent one known, not the most recently mentioned.
 *   the name     the first spelling wins. A re-report is often typed more carelessly than the
 *                original -- "lru cache" for "LRU Cache" -- and letting it through would mean
 *                the page's titles slowly degrade every time a question is mentioned again.
 */
export function mergeEntries<T extends { question: string; lastAsked?: string | null }>(
  existing: T[],
  incoming: T[],
): T[] {
  const merged = new Map<string, T>();
  for (const entry of existing) merged.set(identity(entry.question), entry);

  for (const entry of incoming) {
    const key = identity(entry.question);
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, entry);
      continue;
    }

    const dates = [previous.lastAsked, entry.lastAsked].filter(Boolean) as string[];
    merged.set(key, {
      ...previous,
      ...Object.fromEntries(
        // A field the caller left out must not blank one that is already recorded. Zero counts
        // as "not stated" here: it is the schema default for frequency, so a caller reporting a
        // new sighting without a rating would otherwise wipe the rating already on the row.
        Object.entries(entry).filter(
          ([, v]) => v !== undefined && v !== null && !(typeof v === "number" && v === 0),
        ),
      ),
      // ISO dates sort lexicographically, so max is the latest.
      lastAsked: dates.length ? dates.sort().at(-1)! : null,
      // Identity fields keep the spelling they were first recorded with.
      question: previous.question,
      ...("title" in previous ? { title: (previous as { title: unknown }).title } : {}),
    } as T);
  }

  return [...merged.values()];
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
