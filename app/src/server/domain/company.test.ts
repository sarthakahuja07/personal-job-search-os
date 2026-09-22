/**
 * The generated company pages.
 *
 * These are the pages nobody writes by hand, which means nobody proofreads them either. The
 * cases pinned here are the ones that would produce a page that *looks* right and is not: a
 * question whose title breaks the table it sits in, and a question with no page yet quietly
 * vanishing from a list that then reads as complete.
 */

import { describe, expect, it } from "vitest";

import {
  mergeEntries,
  renderQuestionBank,
  renderQuestionIndex,
  type BankEntry,
} from "./company";

const entry = (over: Partial<BankEntry> = {}): BankEntry => ({
  question: "Design a Rate Limiter",
  discipline: "hld",
  frequency: 3,
  lastAsked: "2026-08-01",
  sourceUrls: [],
  ...over,
});

describe("renderQuestionBank", () => {
  it("groups by discipline and sorts by how often it is asked", () => {
    const md = renderQuestionBank("Amazon", [
      entry({ question: "Two Sum", discipline: "dsa", frequency: 2 }),
      entry({ question: "LRU Cache", discipline: "dsa", frequency: 5 }),
      entry({ question: "Design a Parking Lot", discipline: "lld", frequency: 4 }),
    ]);

    expect(md).toContain("## DSA");
    expect(md).toContain("## LLD");
    // The only question a bank is asked is "what first", and that is the frequency column.
    expect(md.indexOf("LRU Cache")).toBeLessThan(md.indexOf("Two Sum"));
    // A discipline with nothing in it gets no empty heading.
    expect(md).not.toContain("## HLD");
  });

  it("links the source it was found at, not our own page for the question", () => {
    const md = renderQuestionBank("Amazon", [
      entry({ question: "Instagram", sourceUrls: ["https://leetcode.com/discuss/interview/123"] }),
      entry({ question: "Heard in a phone screen", sourceUrls: [] }),
    ]);

    // Named by publisher rather than shown as a raw URL.
    expect(md).toContain("[LeetCode](https://leetcode.com/discuss/interview/123)");
    // The bank never links inward -- that is what the discipline indexes are for.
    expect(md).not.toContain("/prep/");
    expect(md).toContain("| Heard in a phone screen |");
  });

  it("falls back to the host when the publisher is not one it knows", () => {
    const md = renderQuestionBank("Amazon", [
      entry({ sourceUrls: ["https://blog.someone.dev/a/post"] }),
    ]);
    expect(md).toContain("[blog.someone.dev](https://blog.someone.dev/a/post)");
  });

  it("joins every corroborating source rather than keeping only the first", () => {
    const md = renderQuestionBank("Amazon", [
      entry({
        question: "Two Sum",
        sourceUrls: [
          "https://leetcode.com/discuss/interview/1",
          "https://blog.someone.dev/a/post",
        ],
      }),
    ]);
    expect(md).toContain(
      "[LeetCode](https://leetcode.com/discuss/interview/1) · [blog.someone.dev](https://blog.someone.dev/a/post)",
    );
  });

  it("escapes a pipe in a title instead of breaking the table around it", () => {
    const md = renderQuestionBank("Amazon", [entry({ question: "Producer | Consumer" })]);

    expect(md).toContain("Producer \\| Consumer");
    // Three columns means four *unescaped* delimiters. An unescaped pipe in the title would
    // make it five, and the table would silently gain a column.
    const row = md.split("\n").find((l) => l.includes("Producer"))!;
    // Four columns means five unescaped delimiters; an unescaped pipe in the title makes six.
    expect(row.match(/(?<!\\)\|/g)!.length).toBe(5);
  });

  it("says so when there is nothing, rather than emitting an empty table", () => {
    expect(renderQuestionBank("Amazon", [])).toContain("_Nothing recorded yet._");
  });

  it("renders a missing date as a dash, not as 'null'", () => {
    const md = renderQuestionBank("Amazon", [entry({ lastAsked: null })]);
    expect(md).toContain("| —");
    expect(md).not.toContain("null");
  });
});

describe("renderQuestionIndex", () => {
  it("lists linked questions first and keeps the unwritten ones in their own section", () => {
    const md = renderQuestionIndex("Amazon", "hld", [
      { title: "Instagram", path: "system-design/hld/questions/instagram", frequency: 4 },
      { title: "Design a Doorbell", path: null, frequency: 2 },
    ]);

    expect(md).toContain("- [ ] [Instagram](/prep/system-design/hld/questions/instagram) — asked 4/5");
    expect(md).toContain("## Not written yet");
    // Dropping it would make the list read as complete when it is the opposite: this is the
    // list of what to study next.
    expect(md).toContain("- Design a Doorbell — asked 2/5");
  });

  it("renders a resolved page's done status as a checked task, and counts done/total", () => {
    const md = renderQuestionIndex("Amazon", "hld", [
      { title: "Instagram", path: "system-design/hld/questions/instagram", frequency: 4, done: true },
      { title: "Rate Limiter", path: "system-design/hld/rate-limiter", frequency: 3, done: false },
    ]);

    expect(md).toContain("- [x] [Instagram](/prep/system-design/hld/questions/instagram)");
    expect(md).toContain("- [ ] [Rate Limiter](/prep/system-design/hld/rate-limiter)");
    expect(md).toContain("1 / 2 done");
  });

  it("does not show a done count for the unwritten section, which has nothing to be done", () => {
    const md = renderQuestionIndex("Amazon", "hld", [
      { title: "Design a Doorbell", path: null, frequency: 2 },
    ]);
    expect(md).not.toContain("done");
  });

  it("omits the unwritten section entirely when everything resolved", () => {
    const md = renderQuestionIndex("Amazon", "dsa", [
      { title: "Two Sum", path: "dsa/two-sum", frequency: 5 },
    ]);
    expect(md).not.toContain("Not written yet");
  });

  it("carries the last-seen date through when there is one", () => {
    const md = renderQuestionIndex("Amazon", "lld", [
      { title: "Parking Lot", path: "system-design/lld/parking-lot", lastAsked: "2026-09-01" },
    ]);
    expect(md).toContain("last seen 2026-09-01");
  });

  it("says so when there are no questions", () => {
    expect(renderQuestionIndex("Amazon", "dsa", [])).toContain("_No questions recorded yet._");
  });
});

describe("mergeEntries", () => {
  /*
    This is the function that makes a page appendable, and the one that would lose work if it
    were wrong. Recording a company's HLD questions today and its LLD questions next week is the
    normal way this gets used, and the later session has no copy of the earlier list -- so
    anything that drops the first half fails silently and looks like it worked.
  */
  it("keeps what is already there when a later call adds a different discipline", () => {
    const existing = [entry({ question: "Instagram", discipline: "hld" })];
    const incoming = [entry({ question: "Parking Lot", discipline: "lld" })];

    const merged = mergeEntries(existing, incoming);

    expect(merged.map((e) => e.question).sort()).toEqual(["Instagram", "Parking Lot"]);
  });

  it("treats the same question written differently as one row", () => {
    const merged = mergeEntries(
      [entry({ question: "LRU Cache", discipline: "dsa" })],
      [entry({ question: "lru cache.", discipline: "dsa", frequency: 5 })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].frequency).toBe(5);
    // The tidy original spelling survives the careless re-report.
    expect(merged[0].question).toBe("LRU Cache");
  });

  it("keeps the later sighting regardless of which call it arrived in", () => {
    const older = [entry({ question: "Two Sum", lastAsked: "2026-09-01" })];
    const newer = [entry({ question: "Two Sum", lastAsked: "2026-01-05" })];

    // "Last asked" means the most recent one known, not the most recently mentioned.
    expect(mergeEntries(older, newer)[0].lastAsked).toBe("2026-09-01");
    expect(mergeEntries(newer, older)[0].lastAsked).toBe("2026-09-01");
  });

  it("does not blank a recorded rating when a later report omits one", () => {
    const merged = mergeEntries(
      [entry({ question: "Two Sum", frequency: 4 })],
      // 0 is the schema default for frequency, so an unrated re-report arrives as 0.
      [entry({ question: "Two Sum", frequency: 0, lastAsked: null })],
    );

    expect(merged[0].frequency).toBe(4);
  });

  it("keeps a date already recorded when the new report has none", () => {
    const merged = mergeEntries(
      [entry({ question: "Two Sum", lastAsked: "2026-07-15" })],
      [entry({ question: "Two Sum", lastAsked: null })],
    );

    expect(merged[0].lastAsked).toBe("2026-07-15");
  });

  it("is a no-op against an empty page", () => {
    const incoming = [entry({ question: "Instagram" })];
    expect(mergeEntries([], incoming)).toEqual(incoming);
  });
});
