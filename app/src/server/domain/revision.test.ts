import { describe, expect, it } from "vitest";

import { buildPaths } from "./prep";
import {
  NEW_CARD,
  RELEARN_MS,
  buildCustomDeck,
  buildDecks,
  customDeckCandidates,
  findDeck,
  formatInterval,
  intervalsFor,
  matchCard,
  questionCards,
  schedule,
  shuffle,
  type CustomDeckDef,
  type TreeRow,
} from "./revision";

const rows: TreeRow[] = [
  // DSA: a pattern folder with a notes page and two questions, plus a top-level question.
  { id: "arr", kind: "dsa", slug: "arrays", title: "Arrays", parentId: null },
  { id: "arr-notes", kind: "dsa", slug: "notes", title: "Notes", parentId: "arr" },
  { id: "two-sum", kind: "dsa", slug: "two-sum", title: "Two Sum", parentId: "arr", difficulty: "easy" },
  { id: "3sum", kind: "dsa", slug: "3sum", title: "3Sum", parentId: "arr" },
  { id: "lru", kind: "dsa", slug: "lru-cache", title: "LRU Cache", parentId: null, difficulty: "hard" },
  // HLD: a concept beside the questions folder.
  { id: "hld", kind: "system_design", slug: "hld", title: "HLD", parentId: null },
  { id: "caching", kind: "system_design", slug: "caching", title: "Caching", parentId: "hld" },
  { id: "hld-q", kind: "system_design", slug: "questions", title: "Questions", parentId: "hld" },
  { id: "insta", kind: "system_design", slug: "instagram", title: "Instagram", parentId: "hld-q" },
  { id: "rl", kind: "system_design", slug: "rate-limiter", title: "Rate Limiter", parentId: "hld-q" },
  // LLD: questions sit directly under the root, beside a "resources" folder of study notes --
  // there is no "lld/questions" subfolder the way HLD has one.
  { id: "lld", kind: "system_design", slug: "lld", title: "LLD", parentId: null },
  { id: "parking", kind: "system_design", slug: "parking-lot", title: "Parking Lot", parentId: "lld" },
  { id: "lld-rl", kind: "system_design", slug: "rate-limiter", title: "Rate Limiter", parentId: "lld" },
  { id: "lld-resources", kind: "system_design", slug: "resources", title: "Resources", parentId: "lld" },
  { id: "solid", kind: "system_design", slug: "solid", title: "SOLID", parentId: "lld-resources" },
  // Not a question at all.
  { id: "story", kind: "behavioral", slug: "conflict", title: "Conflict", parentId: null },
];

const cards = questionCards(rows, buildPaths(rows));

describe("questionCards", () => {
  it("takes DSA leaves but not folders or notes pages", () => {
    expect(cards.dsa.map((c) => c.id).sort()).toEqual(["3sum", "lru", "two-sum"]);
  });

  it("takes only what is under hld/questions", () => {
    expect(cards.hld.map((c) => c.id).sort()).toEqual(["insta", "rl"]);
  });

  it("takes LLD questions beside resources, but not inside resources", () => {
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

describe("customDeckCandidates", () => {
  const companies = [
    { company: "Confluent", slug: "confluent", discipline: "dsa" as const, titles: ["Two Sum", "LRU Cache"] },
    { company: "Confluent", slug: "confluent", discipline: "hld" as const, titles: ["Design a Rate Limiter"] },
    { company: "Uber", slug: "uber", discipline: "dsa" as const, titles: ["Two Sum"] },
  ];
  const candidates = customDeckCandidates(cards, companies);

  it("tags a candidate with every company whose list includes it", () => {
    expect(candidates.find((c) => c.id === "two-sum")?.companySlugs.sort()).toEqual([
      "confluent",
      "uber",
    ]);
    expect(candidates.find((c) => c.id === "rl")?.companySlugs).toEqual(["confluent"]);
  });

  it("leaves a question no company lists with an empty tag set", () => {
    expect(candidates.find((c) => c.id === "3sum")?.companySlugs).toEqual([]);
  });

  it("covers every discipline's questions, not just dsa", () => {
    expect(candidates.map((c) => c.id).sort()).toEqual(
      ["3sum", "insta", "lld-rl", "lru", "parking", "rl", "two-sum"].sort(),
    );
  });
});

describe("buildCustomDeck", () => {
  const companies = [
    { company: "Confluent", slug: "confluent", discipline: "dsa" as const, titles: ["Two Sum", "LRU Cache"] },
    { company: "Confluent", slug: "confluent", discipline: "hld" as const, titles: ["Design a Rate Limiter"] },
  ];
  const builtIn = buildDecks(cards, companies);
  const candidates = customDeckCandidates(cards, companies);

  const def = (patch: Partial<CustomDeckDef>): CustomDeckDef => ({
    id: "custom-1",
    title: "My deck",
    mode: "filter",
    companySlug: null,
    discipline: null,
    difficulty: null,
    questionIds: null,
    ...patch,
  });

  it("filter mode with no filters matches the Everything deck", () => {
    const deck = buildCustomDeck(builtIn, candidates, def({}));
    expect(deck.cards).toHaveLength(findDeck(builtIn, ["all"])!.cards.length);
  });

  it("filter mode narrows by company and discipline together, same as the company deck", () => {
    const deck = buildCustomDeck(builtIn, candidates, def({ companySlug: "confluent", discipline: "dsa" }));
    expect(deck.cards.map((c) => c.id).sort()).toEqual(["lru", "two-sum"]);
  });

  it("filter mode with only a company spans every discipline that company lists", () => {
    const deck = buildCustomDeck(builtIn, candidates, def({ companySlug: "confluent" }));
    expect(deck.cards.map((c) => c.id).sort()).toEqual(["lru", "rl", "two-sum"]);
  });

  it("filter mode layers difficulty on top of company/discipline", () => {
    const deck = buildCustomDeck(
      builtIn,
      candidates,
      def({ companySlug: "confluent", difficulty: "hard" }),
    );
    expect(deck.cards.map((c) => c.id)).toEqual(["lru"]);
  });

  it("fixed mode uses exactly the given ids and drops ones that no longer resolve", () => {
    const deck = buildCustomDeck(
      builtIn,
      candidates,
      def({ mode: "fixed", questionIds: ["two-sum", "lru", "deleted-question"] }),
    );
    expect(deck.cards.map((c) => c.id).sort()).toEqual(["lru", "two-sum"]);
  });

  it("fixed mode ignores filter columns entirely", () => {
    const deck = buildCustomDeck(
      builtIn,
      candidates,
      def({ mode: "fixed", questionIds: ["3sum"], companySlug: "confluent", difficulty: "hard" }),
    );
    expect(deck.cards.map((c) => c.id)).toEqual(["3sum"]);
  });

  it("gives the deck a custom/<id> deck id", () => {
    const deck = buildCustomDeck(builtIn, candidates, def({ id: "abc123" }));
    expect(deck.id).toEqual(["custom", "abc123"]);
    expect(deck.group).toBe("Custom");
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
