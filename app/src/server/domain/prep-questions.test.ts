import { describe, expect, it } from "vitest";

import {
  buildIndex,
  collectQuestions,
  editDistance,
  highlightRanges,
  searchQuestions,
  type QuestionSourceRow,
} from "./prep-questions";

let n = 0;
function row(
  parentId: string | null,
  slug: string,
  title: string,
  extra: Partial<QuestionSourceRow> = {},
): QuestionSourceRow {
  n += 1;
  return {
    id: extra.id ?? `id-${n}`,
    parentId,
    kind: "dsa",
    slug,
    title,
    prompt: null,
    topics: [],
    companies: [],
    difficulty: null,
    status: "not_started",
    frequency: 0,
    isReader: false,
    ...extra,
  };
}

describe("collectQuestions", () => {
  const dsa = [
    row(null, "1-arrays-strings", "1. Arrays & Strings", { id: "arr" }),
    row("arr", "notes", "Notes"),
    row("arr", "sliding-window", "Sliding Window", { id: "sw" }),
    row("sw", "notes", "Notes"),
    row("sw", "longest-substring", "Longest Substring Without Repeating", { difficulty: "medium" }),
    row(null, "12-dp", "12. Dynamic Programming", { id: "dp" }),
    row("dp", "knapsack", "Knapsack", { id: "ks" }),
    // A graded question with a follow-up nested under it is still a question.
    row("ks", "subset-sum", "Subset Sum", { id: "ss", difficulty: "medium" }),
    row("ss", "notes", "Notes"),
    row("dp", "book", "DP Book", { isReader: true }),
  ];

  it("finds questions at any depth, skipping folders, Notes pages and readers", () => {
    const qs = collectQuestions(dsa, "dsa");
    expect(qs.map((q) => q.title)).toEqual([
      "Longest Substring Without Repeating",
      "Subset Sum",
    ]);
    expect(qs[0].url).toBe("/prep/dsa/1-arrays-strings/sliding-window/longest-substring");
    expect(qs[0].folders).toEqual(["1. Arrays & Strings", "Sliding Window"]);
  });

  it("scopes to a folder, with folder titles relative to it", () => {
    const qs = collectQuestions(dsa, "dsa", "12-dp");
    expect(qs.map((q) => q.title)).toEqual(["Subset Sum"]);
    expect(qs[0].folders).toEqual(["Knapsack"]);
  });

  it("keeps system design study material out of the question list", () => {
    const sd = (p: string | null, slug: string, title: string, id?: string) =>
      row(p, slug, title, { kind: "system_design", ...(id ? { id } : {}) });
    const rows = [
      sd(null, "hld", "HLD", "hld"),
      sd("hld", "rdbms", "RDBMS", "rdbms"),
      sd("rdbms", "indexes", "Indexes"),
      sd("hld", "questions", "Questions", "hq"),
      sd("hq", "design-youtube", "Design YouTube"),
      sd(null, "lld", "LLD", "lld"),
      sd("lld", "design-a-parking-lot", "Design a Parking Lot"),
      sd("lld", "resources", "Resources", "res"),
      sd("res", "solid", "SOLID"),
    ];
    expect(collectQuestions(rows, "system-design").map((q) => q.title)).toEqual([
      "Design YouTube",
      "Design a Parking Lot",
    ]);
    expect(collectQuestions(rows, "system-design", "lld").map((q) => q.title)).toEqual([
      "Design a Parking Lot",
    ]);
  });
});

describe("searchQuestions", () => {
  const items = [
    { title: "Implement a Queue From Scratch", prompt: null, folders: ["4. Stack & Queue"], topics: [], companies: [], frequency: 1 },
    { title: "Network Delay Time", prompt: null, folders: ["9. Graphs", "Shortest Path", "Dijkstra"], topics: ["graph"], companies: ["Uber"], frequency: 3 },
    { title: "Design a Rate Limiter", prompt: "Token bucket and friends", folders: [], topics: ["concurrency"], companies: [], frequency: 4 },
    { title: "Coin Change", prompt: null, folders: ["12. Dynamic Programming", "Knapsack"], topics: [], companies: [], frequency: 5 },
    { title: "Linked List Cycle", prompt: null, folders: ["3. Linked Lists"], topics: [], companies: [], frequency: 2 },
  ];
  const index = buildIndex(items);
  const titles = (q: string) => searchQuestions(index, q).map((i) => i.title);

  it("ignores word order", () => {
    expect(titles("queue implement")).toEqual(["Implement a Queue From Scratch"]);
  });

  it("matches folders, topics and companies, not only titles", () => {
    expect(titles("dijkstra")).toEqual(["Network Delay Time"]);
    expect(titles("uber")).toEqual(["Network Delay Time"]);
    expect(titles("token bucket")).toEqual(["Design a Rate Limiter"]);
  });

  it("understands shorthand", () => {
    expect(titles("dp")).toEqual(["Coin Change"]);
    expect(titles("ll cycle")).toEqual(["Linked List Cycle"]);
  });

  it("tolerates typos and missing spaces", () => {
    expect(titles("dijkstar")).toEqual(["Network Delay Time"]);
    expect(titles("ratelimiter")).toEqual(["Design a Rate Limiter"]);
  });

  it("matches prefixes while typing", () => {
    expect(titles("netw")).toEqual(["Network Delay Time"]);
  });

  it("requires every word to match", () => {
    expect(titles("queue dijkstra")).toEqual([]);
  });

  it("returns everything for an empty query", () => {
    expect(titles("  ")).toHaveLength(items.length);
  });
});

describe("helpers", () => {
  it("counts a transposition as one edit", () => {
    expect(editDistance("dijkstar", "dijkstra", 2)).toBe(1);
  });

  it("highlights word starts that match", () => {
    expect(highlightRanges("Linked List Cycle", "ll cyc")).toEqual([
      [0, 6],
      [7, 11],
      [12, 15],
    ]);
  });
});
