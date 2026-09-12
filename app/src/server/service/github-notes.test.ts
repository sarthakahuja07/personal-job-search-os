/**
 * Notes must survive GitHub saying no.
 *
 * Anonymous GitHub allows 60 API calls an hour per egress IP, and a Worker shares Cloudflare's
 * with everything else running there, so the page spent most of its life rate limited. The
 * cache is the fix; the part worth pinning is what happens when the refresh *fails* with a
 * cached copy already in hand. Serving a day-old chapter beats serving an apology, and the
 * only way that stays true is if nobody later "simplifies" the stale path away.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCached = vi.fn();
const putCached = vi.fn();

vi.mock("@/server/repository/notes-cache-repo", () => ({
  getCached: (...a: unknown[]) => getCached(...a),
  putCached: (...a: unknown[]) => putCached(...a),
}));

import { repoFile, repoTree } from "./github-notes";

// The service only ever hands `db` to the repository, which is mocked above.
const db = {} as never;

/** What GitHub returns: every blob in the repository. */
const RAW_TREE = JSON.stringify({
  tree: [
    { path: "hld/caching.md", type: "blob" },
    { path: "hld/sharding.md", type: "blob" },
    { path: "README.md", type: "blob" },
    { path: "img/x.png", type: "blob" },
  ],
});

/** What gets stored: only the chapters, which is what keeps the row under D1's 100 KB cap. */
const STORED = JSON.stringify([
  { dir: "/", files: [{ path: "README.md", name: "README", dir: "/" }] },
  {
    dir: "hld",
    files: [
      { path: "hld/caching.md", name: "caching", dir: "hld" },
      { path: "hld/sharding.md", name: "sharding", dir: "hld" },
    ],
  },
]);

beforeEach(() => {
  getCached.mockReset();
  putCached.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("repoTree", () => {
  it("serves a fresh cache row without touching the network at all", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    getCached.mockResolvedValue({ payload: STORED, branch: "main", fetchedAt: new Date() });

    const tree = await repoTree(db, "someone/notes");

    expect(spy).not.toHaveBeenCalled();
    expect(tree.error).toBeNull();
    expect(tree.stale).toBeFalsy();
    // Markdown only, grouped by directory; the PNG is not a chapter.
    expect(tree.groups.map((g) => g.dir).sort()).toEqual(["/", "hld"]);
  });

  it("falls back to a stale row when GitHub rate limits the refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response),
    );
    const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    getCached.mockResolvedValue({ payload: STORED, branch: "main", fetchedAt: old });

    const tree = await repoTree(db, "someone/notes");

    expect(tree.error).toBeNull();
    expect(tree.stale).toBe(true);
    expect(tree.groups.length).toBeGreaterThan(0);
  });

  it("reports the rate limit only when there is nothing cached to fall back on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response),
    );
    getCached.mockResolvedValue(null);

    const tree = await repoTree(db, "someone/notes");

    expect(tree.groups).toEqual([]);
    expect(tree.error).toMatch(/rate limiting/i);
  });

  it("stores what it fetched, and skips the branch lookup when the row already knows it", async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => RAW_TREE,
    } as unknown as Response);
    vi.stubGlobal("fetch", spy);
    getCached.mockResolvedValue({
      payload: STORED,
      branch: "trunk",
      fetchedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    const tree = await repoTree(db, "someone/notes");

    // One call: the tree. The default-branch call used to double the cost of the request most
    // likely to be rate limited, to re-answer a question that never changes.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("/git/trees/trunk");
    // The derived list, not the 128 KB upstream body that would not fit in a D1 statement.
    expect(putCached).toHaveBeenCalledWith(db, "someone/notes", STORED, "trunk");
    expect(tree.defaultBranch).toBe("trunk");
  });
});

describe("repoFile", () => {
  it("refuses a path trying to climb out of the repository", async () => {
    const res = await repoFile(db, "someone/notes", "main", "../../etc/passwd");
    expect(res.markdown).toBeNull();
    expect(res.error).toBe("Bad path.");
  });

  it("caches the rewritten body, so a hit and a miss render the same thing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "![d](diagram.png)",
      } as unknown as Response),
    );
    getCached.mockResolvedValue(null);

    const res = await repoFile(db, "someone/notes", "main", "hld/caching.md");

    const expected =
      "![d](https://raw.githubusercontent.com/someone/notes/main/hld/diagram.png)";
    expect(res.markdown).toBe(expected);
    expect(putCached).toHaveBeenCalledWith(db, "someone/notes:hld/caching.md", expected, "main");
  });

  it("serves the stale body when the CDN fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    getCached.mockResolvedValue({
      payload: "# cached chapter",
      branch: "main",
      fetchedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    const res = await repoFile(db, "someone/notes", "main", "hld/caching.md");

    expect(res.markdown).toBe("# cached chapter");
    expect(res.stale).toBe(true);
    expect(res.error).toBeNull();
  });
});
