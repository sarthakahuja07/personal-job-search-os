/**
 * Publishing a page written by an assistant.
 *
 * The cases worth pinning are the destructive ones. A study assistant runs unattended over
 * notes that took weeks to write, so "what happens when the page already exists" is the whole
 * risk surface: silently overwriting loses work, silently duplicating makes the tree unusable,
 * and both look like success from the caller's side.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = {
  resolvePath: vi.fn(),
  allPagePaths: vi.fn(),
  pageBySlug: vi.fn(),
  nextPosition: vi.fn(),
  insertPage: vi.fn(),
  updatePage: vi.fn(),
  addResource: vi.fn(),
};

vi.mock("@/server/repository/prep-repo", () => ({
  resolvePath: (...a: unknown[]) => repo.resolvePath(...a),
  allPagePaths: (...a: unknown[]) => repo.allPagePaths(...a),
  pageBySlug: (...a: unknown[]) => repo.pageBySlug(...a),
  nextPosition: (...a: unknown[]) => repo.nextPosition(...a),
  insertPage: (...a: unknown[]) => repo.insertPage(...a),
  updatePage: (...a: unknown[]) => repo.updatePage(...a),
  addResource: (...a: unknown[]) => repo.addResource(...a),
}));

import {
  PageExistsError,
  ParentNotFoundError,
  publishPrepPage,
  slugify,
  titleIdentity,
} from "./prep-import";
import { prepPageSchema } from "@/server/schemas/prep-import";

const db = {} as never;
const segmentOf = () => "system-design";

/** Run a payload through the real schema, so defaults match what the route would produce. */
const input = (over: Record<string, unknown> = {}) =>
  prepPageSchema.parse({ kind: "system_design", title: "Design a Rate Limiter", ...over });

beforeEach(() => {
  for (const fn of Object.values(repo)) fn.mockReset();
  repo.resolvePath.mockResolvedValue({ id: "parent-1" });
  repo.pageBySlug.mockResolvedValue(null);
  // No other page in the tree, so the near-duplicate check finds nothing to object to.
  repo.allPagePaths.mockResolvedValue([]);
  repo.nextPosition.mockResolvedValue(7);
  repo.insertPage.mockResolvedValue({ id: "new-1" });
});

describe("slugify", () => {
  it("is stable and URL-safe, so a page's address survives a re-publish", () => {
    expect(slugify("Design a Rate Limiter")).toBe("design-a-rate-limiter");
    expect(slugify("  Consistent   Hashing!  ")).toBe("consistent-hashing");
    expect(slugify("Café / Naïve")).toBe("cafe-naive");
  });

  it("still produces an address for a title of pure punctuation", () => {
    expect(slugify("!!!")).toBe("page");
  });
});

describe("publishPrepPage", () => {
  it("creates the page at the resolved parent, at the end of its siblings", async () => {
    const result = await publishPrepPage(
      db,
      input({ parent_path: "hld", frequency: 4, difficulty: "medium", topics: ["caching"] }),
      segmentOf,
    );

    expect(repo.resolvePath).toHaveBeenCalledWith(db, "system_design", ["hld"]);
    const row = repo.insertPage.mock.calls[0][1];
    expect(row).toMatchObject({
      kind: "system_design",
      slug: "design-a-rate-limiter",
      parentId: "parent-1",
      position: 7,
      frequency: 4,
      difficulty: "medium",
      topics: ["caching"],
    });
    expect(result).toMatchObject({
      created: true,
      path: "hld/design-a-rate-limiter",
      url: "/prep/system-design/hld/design-a-rate-limiter",
    });
  });

  it("refuses a path that does not exist instead of publishing to the root", async () => {
    repo.resolvePath.mockResolvedValue(null);

    await expect(
      publishPrepPage(db, input({ parent_path: "hld/nope" }), segmentOf),
    ).rejects.toBeInstanceOf(ParentNotFoundError);
    expect(repo.insertPage).not.toHaveBeenCalled();
  });

  it("publishes to the top level without consulting the tree", async () => {
    await publishPrepPage(db, input(), segmentOf);

    expect(repo.resolvePath).not.toHaveBeenCalled();
    expect(repo.insertPage.mock.calls[0][1]).toMatchObject({ parentId: null });
  });

  it("refuses a duplicate by default rather than overwriting or duplicating", async () => {
    repo.pageBySlug.mockResolvedValue({ id: "old-1", title: "Design a Rate Limiter" });

    await expect(publishPrepPage(db, input(), segmentOf)).rejects.toBeInstanceOf(
      PageExistsError,
    );
    expect(repo.insertPage).not.toHaveBeenCalled();
    expect(repo.updatePage).not.toHaveBeenCalled();
  });

  it("merge fills gaps and never replaces a body that already exists", async () => {
    repo.pageBySlug.mockResolvedValue({
      id: "old-1",
      body: "notes I wrote by hand",
      prompt: null,
      difficulty: null,
      frequency: 0,
      topics: ["caching"],
      companies: [],
      sourceUrl: null,
      content: { requirements: "mine" },
    });

    await publishPrepPage(
      db,
      input({
        on_conflict: "merge",
        body: "the model's version",
        difficulty: "hard",
        frequency: 5,
        topics: ["rate-limiting", "caching"],
        content: { architecture: "token bucket" },
      }),
      segmentOf,
    );

    const patch = repo.updatePage.mock.calls[0][2];
    expect(patch.body).toBe("notes I wrote by hand");
    // Empty fields are the ones merge is for.
    expect(patch.difficulty).toBe("hard");
    expect(patch.frequency).toBe(5);
    expect(patch.topics.sort()).toEqual(["caching", "rate-limiting"]);
    expect(patch.content).toEqual({ requirements: "mine", architecture: "token bucket" });
  });

  it("replace overwrites, because that is what it was asked to do", async () => {
    repo.pageBySlug.mockResolvedValue({ id: "old-1", body: "old", content: {} });

    await publishPrepPage(
      db,
      input({ on_conflict: "replace", body: "new" }),
      segmentOf,
    );

    expect(repo.updatePage.mock.calls[0][2]).toMatchObject({ body: "new" });
  });

  it("classifies a YouTube link as a video with its id, like a pasted one", async () => {
    await publishPrepPage(
      db,
      input({
        resources: [
          { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
          { url: "https://www.hellointerview.com/learn/rate-limiter", title: "Rate limiter" },
        ],
      }),
      segmentOf,
    );

    const [video, article] = repo.addResource.mock.calls.map((c) => c[1]);
    expect(video).toMatchObject({
      kind: "video",
      videoId: "dQw4w9WgXcQ",
      source: "YouTube",
      position: 0,
    });
    expect(article).toMatchObject({
      kind: "article",
      source: "Hello Interview",
      title: "Rate limiter",
      position: 1,
    });
  });

  it("drops nulls from content so an unfilled field cannot erase a real one", async () => {
    await publishPrepPage(
      db,
      input({ content: { architecture: "token bucket", tradeoffs: null, pattern: "" } }),
      segmentOf,
    );

    expect(repo.insertPage.mock.calls[0][1].content).toEqual({ architecture: "token bucket" });
  });
});

describe("titleIdentity", () => {
  /*
    An assistant phrases a question the way its source did, so the same problem arrives at
    different lengths across sessions. Without this, "Design a URL Shortener" and "Design a URL
    Shortener (TinyURL-style; hashing/uniqueness/high scalability)" become two pages, and the
    notes that should have accumulated on one are split across both.
  */
  it("sees through a parenthetical qualifier", () => {
    expect(titleIdentity("Design a URL Shortener (TinyURL-style; high scalability)")).toBe(
      titleIdentity("Design a URL Shortener"),
    );
  });

  it("sees through a trailing clause after a colon or dash", () => {
    expect(titleIdentity("Design Kafka: partitions, ISR, retention")).toBe(
      titleIdentity("Design Kafka"),
    );
    expect(titleIdentity("Design Kafka — a deep dive")).toBe(titleIdentity("Design Kafka"));
  });

  it("ignores case and punctuation", () => {
    expect(titleIdentity("LRU Cache")).toBe(titleIdentity("  lru   cache!  "));
  });

  it("keeps genuinely different problems apart", () => {
    // The reason this is exact-match-after-stripping rather than a containment rule.
    expect(titleIdentity("Two Sum")).not.toBe(titleIdentity("Two Sum II"));
    expect(titleIdentity("Design a Rate Limiter")).not.toBe(
      titleIdentity("Design a Distributed Rate Limiter"),
    );
  });
});

describe("publishPrepPage — near duplicates", () => {
  const tree = [
    {
      id: "existing-1",
      kind: "system_design",
      slug: "design-a-url-shortener",
      title: "Design a URL Shortener",
      parentId: null,
    },
  ];

  it("refuses a longer phrasing of a question that already exists, and says where", async () => {
    repo.allPagePaths.mockResolvedValue(tree);

    const attempt = publishPrepPage(
      db,
      input({ title: "Design a URL Shortener (TinyURL-style; hashing/uniqueness)" }),
      segmentOf,
    );

    await expect(attempt).rejects.toBeInstanceOf(PageExistsError);
    await expect(attempt).rejects.toThrow(/already covers this/);
    // Names the page and the route out, because the caller is a model that has to act on it.
    await expect(attempt).rejects.toThrow(/design-a-url-shortener/);
    await expect(attempt).rejects.toThrow(/prep_append/);
    expect(repo.insertPage).not.toHaveBeenCalled();
  });

  it("does not look across disciplines, where the same name is a different question", async () => {
    repo.allPagePaths.mockResolvedValue([{ ...tree[0], kind: "dsa" }]);

    await publishPrepPage(db, input({ title: "Design a URL Shortener (short)" }), segmentOf);

    expect(repo.insertPage).toHaveBeenCalled();
  });

  it("lets an explicit merge through without arguing about the title", async () => {
    repo.allPagePaths.mockResolvedValue(tree);

    await publishPrepPage(
      db,
      input({ title: "Design a URL Shortener (TinyURL-style)", on_conflict: "merge" }),
      segmentOf,
    );

    expect(repo.insertPage).toHaveBeenCalled();
  });
});
