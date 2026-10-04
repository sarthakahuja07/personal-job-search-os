import { describe, expect, it } from "vitest";

import {
  assembleBehavioral,
  type BehavioralRow,
  answerShape,
  answerText,
  formatClock,
  headingSlug,
  isProjectContent,
  readMinutes,
  slugger,
  spokenSeconds,
  tableOfContents,
  wordCount,
} from "./behavioral";

describe("isProjectContent", () => {
  it("is a project only when it carries a pitch", () => {
    expect(isProjectContent({ pitch: "I redesigned..." })).toBe(true);
    expect(isProjectContent({ pitch: "  " })).toBe(false);
    expect(isProjectContent({ situation: "..." })).toBe(false);
    expect(isProjectContent(null)).toBe(false);
  });
});

describe("answerShape", () => {
  it("lays out STAR fields in order, labelling outcome as Result", () => {
    const shape = answerShape({
      outcome: "Queries 30% faster.",
      situation: "MySQL at 12 TB.",
      action: "Sharded on out_node.",
      task: "Stabilise, then scale.",
    });
    expect(shape.kind).toBe("star");
    if (shape.kind !== "star") return;
    expect(shape.parts.map((p) => p.letter)).toEqual(["S", "T", "A", "R"]);
    expect(shape.parts[3]).toMatchObject({ label: "Result", text: "Queries 30% faster." });
  });

  it("drops a STAR part that was left empty rather than rendering a blank block", () => {
    const shape = answerShape({ situation: "Context.", task: "", action: "Did it." });
    expect(shape.kind === "star" && shape.parts.map((p) => p.key)).toEqual(["situation", "action"]);
  });

  it("uses prose when there is no situation or action", () => {
    expect(answerShape({ answer: "  Because streaming.  " })).toEqual({
      kind: "prose",
      text: "Because streaming.",
    });
  });

  /*
    The seeded starter pages put advice in `outcome` with empty situation/action. Rendered as a
    STAR answer it would show a lone "Result" that is really a tip about how to answer.
  */
  it("treats a seeded hint in outcome as a hint, not an answer", () => {
    expect(answerShape({ situation: "", action: "", outcome: "Two minutes, forward-looking." })).toEqual({
      kind: "empty",
      hint: "Two minutes, forward-looking.",
    });
    expect(answerShape({ hint: "Avoid blame." })).toEqual({ kind: "empty", hint: "Avoid blame." });
    expect(answerShape({})).toEqual({ kind: "empty", hint: null });
  });

  it("joins an answer into one text for timing", () => {
    expect(answerText(answerShape({ situation: "a b", action: "c" }))).toBe("a b\n\nc");
    expect(answerText(answerShape({}))).toBe("");
  });
});

describe("timing", () => {
  it("counts words without Markdown syntax or fenced diagrams", () => {
    expect(wordCount("**Situation:** we had `MySQL`\n\n```\nA -> B -> C\n```\n- one")).toBe(5);
    expect(wordCount("")).toBe(0);
  });

  it("estimates speaking time at interview pace, rounded to 15 seconds", () => {
    const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    expect(spokenSeconds(words(240))).toBe(90);
    expect(spokenSeconds(words(3))).toBe(15);
  });

  it("formats a clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(95)).toBe("1:35");
    expect(formatClock(-3)).toBe("0:00");
  });

  it("never reports a zero-minute read", () => {
    expect(readMinutes(10)).toBe(1);
    expect(readMinutes(5 * 230 * 12)).toBe(12);
  });
});

describe("table of contents", () => {
  it("slugs heading text", () => {
    expect(headingSlug("12. Why S3?")).toBe("12-why-s3");
    expect(headingSlug("Why `out_node` Was Important")).toBe("why-out-node-was-important");
    expect(headingSlug("???")).toBe("section");
  });

  it("numbers repeated headings the way the renderer will", () => {
    const next = slugger();
    expect([next("Trade-offs"), next("Trade-offs"), next("Other")]).toEqual([
      "trade-offs",
      "trade-offs-2",
      "other",
    ]);
  });

  it("lists h2s with ids, ignoring headings inside fenced code", () => {
    const md = [
      "## 1. Overall Story",
      "text",
      "```",
      "## not a heading",
      "```",
      "### Functional",
      "## 2. **Why** [S3](https://aws.amazon.com)",
    ].join("\n");
    expect(tableOfContents(md)).toEqual([
      { id: "1-overall-story", title: "1. Overall Story", level: 2 },
      { id: "2-why-s3", title: "2. Why S3", level: 2 },
    ]);
  });

  /*
    Ids are handed out across every level, as the renderer does. If only h2s fed the counter, an
    h3 named like an earlier h2 would shift every later duplicate's id and break those links.
  */
  it("keeps duplicate ids in step with the renderer across heading levels", () => {
    const md = "## Risks\n### Risks\n## Risks";
    expect(tableOfContents(md).map((e) => e.id)).toEqual(["risks", "risks-3"]);
  });
});

describe("assembleBehavioral", () => {
  const row = (over: Partial<BehavioralRow> & Pick<BehavioralRow, "id" | "slug" | "title">): BehavioralRow => ({
    parentId: null,
    kind: "behavioral",
    prompt: null,
    topics: [],
    companies: [],
    difficulty: null,
    status: "not_started",
    frequency: 0,
    isReader: false,
    content: {},
    bodyLength: 0,
    sections: 0,
    ...over,
  });

  const rows: BehavioralRow[] = [
    row({ id: "p", slug: "projects", title: "Projects" }),
    row({
      id: "lin",
      slug: "lineage",
      title: "Lineage Storage Redesign",
      parentId: "p",
      content: { pitch: "word ".repeat(240), org: "Uber", summary: "Sharded 12 TB." },
      bodyLength: 5 * 230 * 20,
      sections: 64,
    }),
    row({ id: "q", slug: "questions", title: "Questions" }),
    row({ id: "own", slug: "ownership", title: "Ownership & initiative", parentId: "q" }),
    row({
      id: "q1",
      slug: "took-ownership",
      title: "A time you took ownership",
      parentId: "own",
      content: { situation: "Slow queries.", action: "Sharded.", story: "lineage" },
    }),
    row({
      id: "q2",
      slug: "why-confluent",
      title: "Why Confluent?",
      parentId: "own",
      content: { answer: "Streaming.", story: "no-such-project" },
    }),
  ];

  const { projects, questions } = assembleBehavioral(rows);

  it("lists only pages under questions/, themed by their folder", () => {
    expect(questions.map((q) => [q.title, q.theme])).toEqual([
      ["A time you took ownership", "Ownership & initiative"],
      ["Why Confluent?", "Ownership & initiative"],
    ]);
    expect(questions[0].url).toBe("/prep/behavioral/questions/ownership/took-ownership");
  });

  it("links a question to its project, and drops a link to a project that does not exist", () => {
    expect(questions[0].story).toEqual({
      slug: "lineage",
      title: "Lineage Storage Redesign",
      org: "Uber",
      url: "/prep/behavioral/projects/lineage",
    });
    expect(questions[1].story).toBeNull();
  });

  it("summarises a project with its timings and the answers that use it", () => {
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      title: "Lineage Storage Redesign",
      summary: "Sharded 12 TB.",
      pitchSeconds: 90,
      readMinutes: 20,
      sections: 64,
      answers: [{ title: "A time you took ownership", url: questions[0].url }],
    });
  });
});
