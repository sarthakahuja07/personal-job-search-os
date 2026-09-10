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
 */

const UA = "job-search-os (personal study notes)";

export type RepoEntry = { path: string; name: string; dir: string };

export type RepoTree = {
  /** Markdown files, grouped by their immediate directory, in repository order. */
  groups: { dir: string; files: RepoEntry[] }[];
  defaultBranch: string;
  error: string | null;
};

async function defaultBranch(repo: string): Promise<string> {
  const r = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
    // A repository's default branch effectively never changes; a day is plenty.
    next: { revalidate: 86_400 },
  });
  if (!r.ok) return "main";
  const j = (await r.json()) as { default_branch?: string };
  return j.default_branch ?? "main";
}

export async function repoTree(repo: string): Promise<RepoTree> {
  try {
    const branch = await defaultBranch(repo);
    const r = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`,
      {
        headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
        next: { revalidate: 3600 },
      },
    );
    if (!r.ok) {
      return {
        groups: [],
        defaultBranch: branch,
        error:
          r.status === 403
            ? "GitHub is rate limiting anonymous requests right now. It clears within the hour."
            : `GitHub returned ${r.status}.`,
      };
    }
    const j = (await r.json()) as { tree?: { path: string; type: string }[] };
    const files = (j.tree ?? [])
      .filter((t) => t.type === "blob" && /\.md$/i.test(t.path))
      .map((t) => {
        const parts = t.path.split("/");
        const name = parts.pop() ?? t.path;
        return { path: t.path, name: name.replace(/\.md$/i, ""), dir: parts.join("/") || "/" };
      });

    const byDir = new Map<string, RepoEntry[]>();
    for (const f of files) byDir.set(f.dir, [...(byDir.get(f.dir) ?? []), f]);

    return {
      groups: [...byDir.entries()]
        .map(([dir, fs]) => ({ dir, files: fs }))
        .sort((a, b) => a.dir.localeCompare(b.dir, undefined, { numeric: true })),
      defaultBranch: branch,
      error: null,
    };
  } catch {
    return { groups: [], defaultBranch: "main", error: "Could not reach GitHub." };
  }
}

export async function repoFile(
  repo: string,
  branch: string,
  path: string,
): Promise<{ markdown: string | null; error: string | null }> {
  // Only ever a path the tree listing produced; refuse anything trying to climb out of it.
  if (path.includes("..")) return { markdown: null, error: "Bad path." };
  try {
    const url = `https://raw.githubusercontent.com/${repo}/${branch}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const r = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate: 3600 } });
    if (!r.ok) return { markdown: null, error: `GitHub returned ${r.status} for that file.` };
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
    return { markdown: fixed, error: null };
  } catch {
    return { markdown: null, error: "Could not reach GitHub." };
  }
}
