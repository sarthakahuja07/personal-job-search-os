/**
 * Reading a public GitHub repository of notes.
 *
 * Rendered natively rather than framed, because GitHub sends `X-Frame-Options: deny` and an
 * iframe of it is a permanently blank box. Rendering the Markdown ourselves is better anyway:
 * it inherits this app's typography and stays readable on a phone, which github.com does not.
 *
 * Two endpoints, chosen to stay off the rate limit. The whole file list comes from one call to
 * the git trees API -- recursive, so a repository of any depth costs a single request -- and
 * file bodies come from raw.githubusercontent.com, which is a CDN and not rate limited at all.
 * Listing each directory through the contents API would have cost one request per folder and
 * exhausted the unauthenticated 60-per-hour budget on a single page load.
 *
 * That was still not enough, and the page spent most of its life rate limited.
 *
 * Anonymous GitHub allows 60 API calls an hour *per egress IP*, and a Worker does not have its
 * own -- it shares Cloudflare's with everything else running there, so the real budget is some
 * unknowable fraction of 60 and is usually already spent. `next: { revalidate: 3600 }` looked
 * like the answer but did nothing at all: this deployment configures no incremental cache (see
 * `open-next.config.ts`), so there was nowhere to put the response and every render went back
 * out to the network.
 *
 * So the cache is ours now, in D1. GitHub is consulted when a row is missing or older than the
 * TTL, and -- this is the part that matters -- a *stale row is served when the refresh fails*.
 * Notes that are a day old are worth far more than an apology about rate limiting.
 */

import type { Db } from "@/db";
import {
  getCached as readRow,
  putCached as writeRow,
} from "@/server/repository/notes-cache-repo";

const UA = "job-search-os (personal study notes)";

/** How long a cached tree or file body is used without asking GitHub again. */
const TTL_MS = 6 * 60 * 60 * 1000;

export type RepoEntry = { path: string; name: string; dir: string };

export type RepoTree = {
  /** Markdown files, grouped by their immediate directory, in repository order. */
  groups: { dir: string; files: RepoEntry[] }[];
  defaultBranch: string;
  error: string | null;
  /** True when GitHub could not be reached and this came off a stale row. */
  stale?: boolean;
};

const fresh = (at: Date | null | undefined) =>
  at instanceof Date && Date.now() - at.getTime() < TTL_MS;

/**
 * The cache must never be the reason a page fails.
 *
 * It is an optimisation over a source that still works without it, so a missing table -- the
 * window between deploying this code and applying its migration -- or a D1 hiccup should cost
 * a slower render, not a broken chapter. Both directions swallow their errors deliberately.
 */
async function getCached(db: Db, key: string) {
  try {
    return await readRow(db, key);
  } catch {
    return null;
  }
}

async function putCached(db: Db, key: string, payload: string, branch: string | null) {
  try {
    await writeRow(db, key, payload, branch);
  } catch {
    // Nothing to do: the caller already has the bytes it needs.
  }
}

/**
 * The default branch, cached with the tree rather than fetched beside it.
 *
 * This was a second API call on every page view, doubling the cost of the thing most likely to
 * be rate limited, to answer a question whose answer changes approximately never.
 */
async function defaultBranch(repo: string): Promise<string> {
  const r = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) return "main";
  const j = (await r.json()) as { default_branch?: string };
  return j.default_branch ?? "main";
}

/**
 * The chapter list, derived from GitHub's raw tree response.
 *
 * What gets stored is this result, not the response it came from. GitHub's recursive tree lists
 * every blob in the repository -- images, code, everything -- and for the notes repo that is
 * 128 KB, comfortably past D1's 100 KB limit on a single statement. The 29 Markdown paths
 * actually rendered are 3.8 KB. Caching the upstream body would therefore have failed to write
 * at all, and because the cache is deliberately fail-soft, it would have failed *silently* and
 * left the page exactly as rate limited as before.
 */
function deriveGroups(rawTreeJson: string): RepoTree["groups"] {
  const j = JSON.parse(rawTreeJson) as { tree?: { path: string; type: string }[] };
  const files = (j.tree ?? [])
    .filter((t) => t.type === "blob" && /\.md$/i.test(t.path))
    .map((t) => {
      const parts = t.path.split("/");
      const name = parts.pop() ?? t.path;
      return { path: t.path, name: name.replace(/\.md$/i, ""), dir: parts.join("/") || "/" };
    });

  const byDir = new Map<string, RepoEntry[]>();
  for (const f of files) byDir.set(f.dir, [...(byDir.get(f.dir) ?? []), f]);

  return [...byDir.entries()]
    .map(([dir, fs]) => ({ dir, files: fs }))
    .sort((a, b) => a.dir.localeCompare(b.dir, undefined, { numeric: true }));
}

/** A cached payload is already the derived list. */
const storedGroups = (payload: string) => JSON.parse(payload) as RepoTree["groups"];

export async function repoTree(db: Db, repo: string): Promise<RepoTree> {
  const key = repo;
  const row = await getCached(db, key);

  if (row && fresh(row.fetchedAt)) {
    return { groups: storedGroups(row.payload), defaultBranch: row.branch ?? "main", error: null };
  }

  // A stale row is the fallback for everything below, so read it before risking the network.
  const stale = row
    ? {
        groups: storedGroups(row.payload),
        defaultBranch: row.branch ?? "main",
        error: null,
        stale: true,
      }
    : null;

  try {
    const branch = row?.branch ?? (await defaultBranch(repo));
    const r = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`,
      { headers: { "User-Agent": UA, Accept: "application/vnd.github+json" } },
    );

    if (!r.ok) {
      if (stale) return stale;
      return {
        groups: [],
        defaultBranch: branch,
        error:
          r.status === 403 || r.status === 429
            ? "GitHub is rate limiting anonymous requests right now, and nothing is cached yet. It clears within the hour."
            : `GitHub returned ${r.status}.`,
      };
    }

    const groups = deriveGroups(await r.text());
    await putCached(db, key, JSON.stringify(groups), branch);
    return { groups, defaultBranch: branch, error: null };
  } catch {
    if (stale) return stale;
    return { groups: [], defaultBranch: "main", error: "Could not reach GitHub." };
  }
}

export async function repoFile(
  db: Db,
  repo: string,
  branch: string,
  path: string,
): Promise<{ markdown: string | null; error: string | null; stale?: boolean }> {
  // Only ever a path the tree listing produced; refuse anything trying to climb out of it.
  if (path.includes("..")) return { markdown: null, error: "Bad path." };

  const key = `${repo}:${path}`;
  const row = await getCached(db, key);
  if (row && fresh(row.fetchedAt)) return { markdown: row.payload, error: null };

  try {
    const url = `https://raw.githubusercontent.com/${repo}/${branch}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) {
      if (row) return { markdown: row.payload, error: null, stale: true };
      return { markdown: null, error: `GitHub returned ${r.status} for that file.` };
    }
    const text = await r.text();

    // Images and links in these files are relative to the file's own directory in the repo,
    // and would 404 against this app. Point them back at GitHub.
    const dir = path.split("/").slice(0, -1).join("/");
    const rawBase = `https://raw.githubusercontent.com/${repo}/${branch}/${dir}`;
    const fixed = text.replace(
      /!\[([^\]]*)\]\((?!https?:|\/)([^)]+)\)/g,
      (_m, alt: string, src: string) =>
        `![${alt}](${rawBase}/${src.split("/").map(encodeURIComponent).join("/")})`,
    );

    // The rewritten body is what gets rendered, so it is what gets stored -- caching the raw
    // text would make every cache hit redo the rewrite and, worse, differ from a cache miss.
    await putCached(db, key, fixed, branch);
    return { markdown: fixed, error: null };
  } catch {
    if (row) return { markdown: row.payload, error: null, stale: true };
    return { markdown: null, error: "Could not reach GitHub." };
  }
}
