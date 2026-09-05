import { describe, expect, it } from "vitest";

import { KINDS, kindBySegment, kindOf, summarise, topicCounts } from "./prep";

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

  it("gives every kind at least one answer field, since the detail page renders them", () => {
    for (const k of KINDS) expect(k.fields.length).toBeGreaterThan(0);
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
