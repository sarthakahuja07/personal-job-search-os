/**
 * The generated company pages.
 *
 * These are the pages nobody writes by hand, which means nobody proofreads them either. The
 * cases pinned here are the ones that would produce a page that *looks* right and is not: a
 * question whose title breaks the table it sits in, and a question with no page yet quietly
 * vanishing from a list that then reads as complete.
 */

import { describe, expect, it } from "vitest";

import { renderQuestionBank, renderQuestionIndex, type BankEntry } from "./company";

const entry = (over: Partial<BankEntry> = {}): BankEntry => ({
  question: "Design a Rate Limiter",
  discipline: "hld",
  frequency: 3,
  lastAsked: "2026-08-01",
  path: null,
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

  it("links a question that has a page and leaves one that does not as text", () => {
    const md = renderQuestionBank("Amazon", [
      entry({ question: "Instagram", path: "system-design/hld/questions/instagram" }),
      entry({ question: "Nothing written yet", path: null }),
    ]);

    expect(md).toContain("[Instagram](/prep/system-design/hld/questions/instagram)");
    expect(md).toContain("| Nothing written yet |");
    expect(md).not.toContain("[Nothing written yet]");
  });

  it("escapes a pipe in a title instead of breaking the table around it", () => {
    const md = renderQuestionBank("Amazon", [entry({ question: "Producer | Consumer" })]);

    expect(md).toContain("Producer \\| Consumer");
    // Three columns means four *unescaped* delimiters. An unescaped pipe in the title would
    // make it five, and the table would silently gain a column.
    const row = md.split("\n").find((l) => l.includes("Producer"))!;
    expect(row.match(/(?<!\\)\|/g)!.length).toBe(4);
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

    expect(md).toContain("- [Instagram](/prep/system-design/hld/questions/instagram) — asked 4/5");
    expect(md).toContain("## Not written yet");
    // Dropping it would make the list read as complete when it is the opposite: this is the
    // list of what to study next.
    expect(md).toContain("- Design a Doorbell — asked 2/5");
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
