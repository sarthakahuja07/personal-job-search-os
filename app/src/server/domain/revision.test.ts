import { describe, expect, it } from "vitest";

import { buildPaths } from "./prep";
import {
  NEW_CARD,
  RELEARN_MS,
  buildDecks,
  findDeck,
  formatInterval,
  intervalsFor,
  matchCard,
  questionCards,
  schedule,
  shuffle,
  type TreeRow,
} from "./revision";

const rows: TreeRow[] = [
  // DSA: a pattern folder with a notes page and two questions, plus a top-level question.
  { id: "arr", kind: "dsa", slug: "arrays", title: "Arrays", parentId: null },
  { id: "arr-notes", kind: "dsa", slug: "notes", title: "Notes", parentId: "arr" },
  { id: "two-sum", kind: "dsa", slug: "two-sum", title: "Two Sum", parentId: "arr", difficulty: "easy" },
  { id: "3sum", kind: "dsa", slug: "3sum", title: "3Sum", parentId: "arr" },
  { id: "lru", kind: "dsa", slug: "lru-cache", title: "LRU Cache", parentId: null },
  // HLD: a concept beside the questions folder.
  { id: "hld", kind: "system_design", slug: "hld", title: "HLD", parentId: null },
  { id: "caching", kind: "system_design", slug: "caching", title: "Caching", parentId: "hld" },
  { id: "hld-q", kind: "system_design", slug: "questions", title: "Questions", parentId: "hld" },
  { id: "insta", kind: "system_design", slug: "instagram", title: "Instagram", parentId: "hld-q" },
  { id: "rl", kind: "system_design", slug: "rate-limiter", title: "Rate Limiter", parentId: "hld-q" },
  // LLD
  { id: "lld", kind: "system_design", slug: "lld", title: "LLD", parentId: null },
  { id: "lld-q", kind: "system_design", slug: "questions", title: "Questions", parentId: "lld" },
  { id: "parking", kind: "system_design", slug: "parking-lot", title: "Parking Lot", parentId: "lld-q" },
  { id: "lld-rl", kind: "system_design", slug: "rate-limiter", title: "Rate Limiter", parentId: "lld-q" },
  // Not a question at all.
  { id: "story", kind: "behavioral", slug: "conflict", title: "Conflict", parentId: null },
];

const cards = questionCards(rows, buildPaths(rows));

describe("questionCards", () => {
  it("takes DSA leaves but not folders or notes pages", () => {
    expect(cards.dsa.map((c) => c.id).sort()).toEqual(["3sum", "lru", "two-sum"]);
  });

  it("takes only what is under hld/questions and lld/questions", () => {
    expect(cards.hld.map((c) => c.id).sort()).toEqual(["insta", "rl"]);
    expect(cards.lld.map((c) => c.id).sort()).toEqual(["lld-rl", "parking"]);
  });

  it("links each card to its page", () => {
    expect(cards.dsa.find((c) => c.id === "two-sum")?.href).toBe("dsa/arrays/two-sum");
    expect(cards.hld.find((c) => c.id === "insta")?.href).toBe(
      "system-design/hld/questions/instagram",
    );
  });
});

describe("matchCard", () => {
  it("matches exact titles regardless of case and punctuation", () => {
    expect(matchCard(cards.dsa, "lru cache.")?.id).toBe("lru");
  });

  it("ignores a leading 'Design a'", () => {
    expect(matchCard(cards.hld, "Design a Rate Limiter")?.id).toBe("rl");
  });

  it("prefers an exact title to a containing one", () => {
    expect(matchCard(cards.dsa, "3Sum")?.id).toBe("3sum");
  });

  it("returns nothing for an unknown question", () => {
    expect(matchCard(cards.hld, "Uber")).toBeUndefined();
  });
});

describe("buildDecks", () => {
  const decks = buildDecks(cards, [
    { company: "Confluent", slug: "confluent", discipline: "dsa", titles: ["Two Sum", "LRU Cache", "Unknown"] },
    { company: "Confluent", slug: "confluent", discipline: "hld", titles: ["Design a Rate Limiter"] },
  ]);

  it("has discipline decks and an everything deck", () => {
    expect(findDeck(decks, ["all"])?.cards).toHaveLength(7);
    expect(findDeck(decks, ["lld"])?.cards).toHaveLength(2);
  });

  it("resolves a company's list within the right discipline", () => {
    const hld = findDeck(decks, ["company", "confluent", "hld"]);
    // The HLD rate limiter, not the LLD one of the same name.
    expect(hld?.cards.map((c) => c.id)).toEqual(["rl"]);
  });

  it("reports questions with no page rather than dropping them silently", () => {
    const dsa = findDeck(decks, ["company", "confluent", "dsa"]);
    expect(dsa?.cards.map((c) => c.id)).toEqual(["two-sum", "lru"]);
    expect(dsa?.unresolved).toEqual(["Unknown"]);
  });

  it("adds a company-wide deck and omits disciplines with no list", () => {
    expect(findDeck(decks, ["company", "confluent"])?.cards).toHaveLength(3);
    expect(findDeck(decks, ["company", "confluent", "lld"])).toBeUndefined();
  });
});

describe("scheduling", () => {
  const now = new Date("2026-09-24T10:00:00Z");

  it("gives a new card short first steps", () => {
    expect(intervalsFor(null)).toEqual({ again: 0, hard: 1, good: 2, easy: 4 });
  });

  it("brings 'again' back in minutes, not days", () => {
    const next = schedule(null, "again", now);
    expect(next.intervalDays).toBe(0);
    expect(next.dueAt.getTime() - now.getTime()).toBe(RELEARN_MS);
  });

  it("grows the interval by the ease factor on 'good'", () => {
    const next = schedule({ ...NEW_CARD, intervalDays: 10, reps: 3 }, "good", now);
    expect(next.intervalDays).toBe(25);
    expect(next.ease).toBe(2.5);
    expect(next.dueAt.getTime() - now.getTime()).toBe(25 * 86_400_000);
  });

  it("keeps hard < good < easy on a learned card", () => {
    const i = intervalsFor({ ...NEW_CARD, intervalDays: 3, reps: 2 });
    expect(i.hard).toBeLessThan(i.good);
    expect(i.good).toBeLessThan(i.easy);
    expect(i.hard).toBeGreaterThan(3);
  });

  it("wears ease down but never below the floor", () => {
    let state = { ...NEW_CARD };
    for (let n = 0; n < 20; n++) state = schedule(state, "hard", now);
    expect(state.ease).toBe(1.3);
  });

  it("counts a lapse only for a card that had been learned", () => {
    expect(schedule(null, "again", now).lapses).toBe(0);
    expect(schedule({ ...NEW_CARD, intervalDays: 5, reps: 2 }, "again", now).lapses).toBe(1);
  });
});

describe("formatInterval", () => {
  it("reads like Anki's labels", () => {
    expect(formatInterval(0)).toBe("<10m");
    expect(formatInterval(3)).toBe("3d");
    expect(formatInterval(21)).toBe("3w");
    expect(formatInterval(90)).toBe("3mo");
    expect(formatInterval(547)).toBe("1.5y");
  });
});

describe("shuffle", () => {
  it("keeps every item and does not mutate its input", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input, () => 0.3);
    expect(out.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});
