import { describe, expect, it } from "vitest";

import {
  KINDS,
  containsMarkdownTable,
  containsMermaidDiagram,
  isRenderOnlyBody,
  kindBySegment,
  kindOf,
  summarise,
  topicCounts,
} from "./prep";

describe("kind routing", () => {
  it.each([
    ["dsa", "dsa"],
    ["system-design", "system_design"],
    ["behavioral", "behavioral"],
  ])("maps URL segment %s to kind %s", (segment, kind) => {
    expect(kindBySegment(segment)?.kind).toBe(kind);
  });

  it("returns undefined for an unknown segment, so the route can 404", () => {
    expect(kindBySegment("astrology")).toBeUndefined();
  });

  it("round-trips every kind through its segment", () => {
    for (const k of KINDS) {
      expect(kindBySegment(k.segment)?.kind).toBe(k.kind);
      expect(kindOf(k.kind)?.segment).toBe(k.segment);
    }
  });

  /*
    Originally "every kind has at least one field, since the detail page renders them". That
    stopped being true when companies arrived: a company page is a document -- notes, a question
    bank, a list of links -- not an answer with a known shape, and giving it fields would put
    three empty boxes on every page and imply a form nobody fills. The page already guards on
    `fields.some(...)`, so none is a supported shape rather than a broken one.

    What must still hold is that a kind declaring fields declares them properly, and that the
    practised disciplines keep theirs -- losing those silently would empty the detail page.
  */
  it("gives every practised discipline its answer fields", () => {
    for (const kind of ["dsa", "system_design", "behavioral"] as const) {
      expect(kindOf(kind)!.fields.length).toBeGreaterThan(0);
    }
  });

  it("declares every field it does have completely", () => {
    for (const k of KINDS) {
      for (const f of k.fields) {
        expect(f.key).toMatch(/^[a-z][a-zA-Z]*$/);
        expect(f.label.length).toBeGreaterThan(0);
        expect(f.hint.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses hyphenated segments and snake_case kinds", () => {
    for (const k of KINDS) {
      expect(k.segment).not.toContain("_");
      expect(k.segment).toMatch(/^[a-z-]+$/);
    }
  });
});

describe("summarise", () => {
  const items = (statuses: string[]) =>
    statuses.map((status) => ({ status: status as never }));

  it("counts each status", () => {
    const s = summarise(
      items(["done", "done", "in_progress", "revisit", "not_started"]),
    );
    expect(s).toMatchObject({
      total: 5,
      done: 2,
      inProgress: 1,
      revisit: 1,
      notStarted: 1,
    });
  });

  // Marking something for revision is an admission it is not solid. A progress bar that counts
  // it as finished would overstate readiness, which is the one thing this number must not do.
  it("does not count revisit as done", () => {
    const s = summarise(items(["done", "revisit"]));
    expect(s.done).toBe(1);
    expect(s.percent).toBe(50);
  });

  it("reports 0% rather than NaN for an empty set", () => {
    expect(summarise([]).percent).toBe(0);
  });

  it("rounds to a whole percent", () => {
    expect(summarise(items(["done", "not_started", "not_started"])).percent).toBe(33);
  });
});

describe("topicCounts", () => {
  it("counts across items and sorts by frequency", () => {
    const counts = topicCounts([
      { topics: ["dp", "arrays"] },
      { topics: ["dp"] },
      { topics: ["graphs", "dp"] },
      { topics: ["arrays"] },
    ]);
    expect(counts[0]).toEqual({ topic: "dp", count: 3 });
    expect(counts[1]).toEqual({ topic: "arrays", count: 2 });
    expect(counts[2]).toEqual({ topic: "graphs", count: 1 });
  });

  it("breaks ties alphabetically so the filter list does not reshuffle between renders", () => {
    const counts = topicCounts([{ topics: ["zebra"] }, { topics: ["alpha"] }]);
    expect(counts.map((c) => c.topic)).toEqual(["alpha", "zebra"]);
  });

  it("handles items with no topics", () => {
    expect(topicCounts([{ topics: [] }])).toEqual([]);
  });
});

describe("containsMarkdownTable", () => {
  /*
    This decides whether a page is editable. Getting it wrong in one direction makes a page
    needlessly read-only; in the other it hands a table to an editor that flattens it and saves
    the flattened text back on blur, destroying it.
  */
  it("finds a GFM table", () => {
    expect(
      containsMarkdownTable("# Bank\n\n| Question | Asked |\n| --- | --- |\n| Two Sum | 3/5 |"),
    ).toBe(true);
  });

  it("accepts alignment colons and varying dash counts", () => {
    expect(containsMarkdownTable("| A | B |\n|:---|---:|")).toBe(true);
    expect(containsMarkdownTable("| A | B |\n| :-----: | -- |")).toBe(true);
  });

  it("does not mistake prose about pipes for a table", () => {
    expect(containsMarkdownTable("Use `a | b` for a union.")).toBe(false);
    // A row with no delimiter beneath it is not a table.
    expect(containsMarkdownTable("| not | a table |\n| still | not |")).toBe(false);
  });

  it("is false for an empty or missing body", () => {
    expect(containsMarkdownTable("")).toBe(false);
    expect(containsMarkdownTable(null)).toBe(false);
    expect(containsMarkdownTable(undefined)).toBe(false);
  });
});

describe("containsMermaidDiagram", () => {
  it("finds a fenced mermaid block", () => {
    expect(containsMermaidDiagram("intro\n\n```mermaid\nclassDiagram\n  A --> B\n```\n")).toBe(true);
  });

  it("finds one whatever diagram grammar it uses", () => {
    expect(containsMermaidDiagram("```mermaid\nstateDiagram-v2\n  [*] --> a\n```")).toBe(true);
    expect(containsMermaidDiagram("```mermaid\nsequenceDiagram\n  A->>B: hi\n```")).toBe(true);
  });

  it("ignores other fenced languages", () => {
    expect(containsMermaidDiagram("```go\nfunc main() {}\n```")).toBe(false);
    expect(containsMermaidDiagram("```\nmermaid\n```")).toBe(false);
  });

  it("does not match the word in prose", () => {
    expect(containsMermaidDiagram("We render mermaid diagrams on this page.")).toBe(false);
  });

  it("is false for an empty body", () => {
    expect(containsMermaidDiagram(null)).toBe(false);
    expect(containsMermaidDiagram("")).toBe(false);
  });
});

describe("isRenderOnlyBody", () => {
  it("is true for either a table or a diagram", () => {
    expect(isRenderOnlyBody("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(true);
    expect(isRenderOnlyBody("```mermaid\nclassDiagram\n```")).toBe(true);
  });

  it("is false for ordinary prose, which stays editable", () => {
    expect(isRenderOnlyBody("# Notes\n\nSome prose and a `code` span.")).toBe(false);
  });
});
