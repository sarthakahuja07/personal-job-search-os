import Link from "next/link";

import { Markdown } from "./markdown";
import { Card, SectionTitle } from "./ui";
import { repoFile, repoTree } from "@/server/service/github-notes";

/**
 * Somebody else's notes repository, read here.
 *
 * A chapter list until you pick one, then that chapter's Markdown in this app's typography.
 * Which file is open travels in the URL rather than component state, so a chapter can be
 * linked, bookmarked and reached with the back button like any other page.
 */
export async function GithubNotes({
  repo,
  basePath,
  open,
}: {
  repo: string;
  /** The prep page this is embedded in, so chapter links come back to it. */
  basePath: string;
  open?: string;
}) {
  const tree = await repoTree(repo);

  if (tree.error) {
    return (
      <Card className="px-4 py-3 text-[13px] text-ink-dim">
        <p>{tree.error}</p>
        <a
          href={`https://github.com/${repo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-accent-ink hover:underline"
        >
          Read it on GitHub instead ↗
        </a>
      </Card>
    );
  }

  const file = open ? await repoFile(repo, tree.defaultBranch, open) : null;
  const total = tree.groups.reduce((n, g) => n + g.files.length, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] text-ink-faint">
          {total} pages from{" "}
          <a
            href={`https://github.com/${repo}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-dim hover:text-ink hover:underline"
          >
            {repo}
          </a>
        </p>
        {open && (
          <Link href={basePath} className="text-[12px] text-ink-dim transition hover:text-ink">
            ← All chapters
          </Link>
        )}
      </div>

      {file?.markdown ? (
        <article className="rounded-card border border-line bg-surface px-5 py-4">
          <Markdown>{file.markdown}</Markdown>
        </article>
      ) : file?.error ? (
        <Card className="px-4 py-3 text-[13px] text-warn">{file.error}</Card>
      ) : (
        <div className="space-y-4">
          {tree.groups.map((g) => (
            <section key={g.dir}>
              {g.dir !== "/" && <SectionTitle>{g.dir}</SectionTitle>}
              <ul className="space-y-1">
                {g.files.map((f) => (
                  <li key={f.path}>
                    <Link
                      href={`${basePath}?doc=${encodeURIComponent(f.path)}`}
                      className="block truncate rounded-card border border-line bg-surface px-3.5 py-2 text-[13px] text-ink transition hover:border-line-strong"
                    >
                      {f.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
