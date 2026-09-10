import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";

import { Markdown } from "@/components/markdown";
import { Badge, Button, Card, PageHeader, SectionTitle, cx, inputStyles } from "@/components/ui";
import { getDb } from "@/db";
import type { PrepStatus } from "@/db/schema";
import { PREP_STATUSES } from "@/db/schema";
import { STATUS_LABEL, STATUS_ORDER, kindBySegment } from "@/server/domain/prep";
import {
  ancestorsOf,
  childrenOf,
  resolvePath,
  updateBody,
  updateProgress,
} from "@/server/repository/prep-repo";

export const dynamic = "force-dynamic";

const DIFFICULTY_TONE = { easy: "fresh", medium: "warn", hard: "danger" } as const;

const STATUS_TONE: Record<PrepStatus, "neutral" | "accent" | "fresh" | "warn"> = {
  not_started: "neutral",
  in_progress: "accent",
  done: "fresh",
  revisit: "warn",
};

function revalidateTree(segment: string, path: string[]) {
  revalidatePath("/prep/" + segment + "/" + path.join("/"));
  revalidatePath("/prep/" + segment);
  revalidatePath("/prep");
}

async function save(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const segment = String(formData.get("segment"));
  const path = String(formData.get("path") ?? "").split("/").filter(Boolean);
  const rawStatus = String(formData.get("status") ?? "");

  await updateProgress(getDb(), id, {
    // Validate against the known set rather than trusting the form: a status the UI does not
    // understand would render as a blank badge forever.
    status: (PREP_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as PrepStatus)
      : undefined,
    notes: String(formData.get("notes") ?? "").trim() || null,
    solution: String(formData.get("solution") ?? "").trim() || null,
  });

  revalidateTree(segment, path);
}

async function saveBody(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const segment = String(formData.get("segment"));
  const path = String(formData.get("path") ?? "").split("/").filter(Boolean);

  await updateBody(getDb(), id, String(formData.get("body") ?? "").trim() || null);
  revalidateTree(segment, path);
}

/**
 * One page of the prep tree.
 *
 * A catch-all rather than a single `[slug]`, because a prep tree nests: `/prep/system-design/hld`
 * is a folder and `/prep/system-design/hld/caching` is a page inside it. Resolving level by
 * level also means two pages may share a slug under different parents, which an imported Notion
 * directory does the moment two folders each contain a page called "Notes".
 *
 * Folders and pages are the same row, so this renders whichever parts a row actually has: its
 * document body, its children, and — only when it is a leaf — the progress and answer fields,
 * since marking a folder "done" would be meaningless and would corrupt the progress counts.
 */
export default async function PrepPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; path: string[] }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { kind: segment, path } = await params;
  const { edit } = await searchParams;
  const meta = kindBySegment(segment);
  if (!meta) notFound();

  const db = getDb();
  const item = await resolvePath(db, meta.kind, path);
  if (!item) notFound();

  const [kids, chain] = await Promise.all([
    childrenOf(db, item.id),
    ancestorsOf(db, item.id),
  ]);

  const content = item.content ?? {};
  const isFolder = kids.length > 0;
  const editing = edit === "1";
  const here = path.join("/");
  const hrefFor = (slug: string) => `/prep/${segment}/${[...path, slug].join("/")}`;

  return (
    <div className="max-w-3xl">
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-faint">
        <Link href={"/prep/" + segment} className="transition hover:text-ink">
          {meta.title}
        </Link>
        {chain.slice(0, -1).map((a, i) => (
          <span key={a.id} className="flex items-center gap-1.5">
            <span>/</span>
            <Link
              href={`/prep/${segment}/${chain.slice(0, i + 1).map((x) => x.slug).join("/")}`}
              className="transition hover:text-ink"
            >
              {a.title}
            </Link>
          </span>
        ))}
      </nav>

      <PageHeader
        title={item.title}
        subtitle={item.prompt ?? undefined}
        actions={
          <Link
            href={editing ? `/prep/${segment}/${here}` : `/prep/${segment}/${here}?edit=1`}
            className="text-[13px] text-ink-dim transition hover:text-ink"
          >
            {editing ? "Done editing" : "Edit page"}
          </Link>
        }
      />

      {!isFolder && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
          {item.difficulty && (
            <Badge tone={DIFFICULTY_TONE[item.difficulty]}>{item.difficulty}</Badge>
          )}
          {item.topics.map((t) => (
            <span key={t} className="text-[11px] text-ink-faint">
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* The document. Rendered by default and edited on request, because these pages are read
          far more often than they are written. */}
      {editing ? (
        <form action={saveBody} className="mb-6">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="segment" value={segment} />
          <input type="hidden" name="path" value={here} />
          <Card className="space-y-3 px-5 py-5">
            <SectionTitle>Page</SectionTitle>
            <p className="-mt-2 text-xs text-ink-faint">
              Markdown. Headings, lists, tables and code fences all render.
            </p>
            <textarea
              name="body"
              rows={24}
              defaultValue={item.body ?? ""}
              placeholder="# Heading&#10;&#10;Write the page here."
              className={cx(inputStyles, "resize-y font-mono text-[12.5px] leading-relaxed")}
            />
            <Button type="submit" variant="primary">
              Save page
            </Button>
          </Card>
        </form>
      ) : item.body ? (
        <div className="mb-6">
          <Markdown>{item.body}</Markdown>
        </div>
      ) : (
        <Card className="mb-6 px-5 py-6 text-center">
          <p className="text-[13px] text-ink-faint">This page is empty.</p>
          <Link
            href={`/prep/${segment}/${here}?edit=1`}
            className="mt-1 inline-block text-[13px] text-accent-ink hover:underline"
          >
            Write something
          </Link>
        </Card>
      )}

      {isFolder && (
        <section className="mb-6">
          <SectionTitle>
            {kids.length} page{kids.length === 1 ? "" : "s"}
          </SectionTitle>
          <ul className="space-y-1.5">
            {kids.map((k) => (
              <li key={k.id}>
                <Link
                  href={hrefFor(k.slug)}
                  className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-3.5 py-2.5 transition hover:border-line-strong"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink">{k.title}</span>
                    {k.childCount > 0 && (
                      <span className="text-[11px] text-ink-faint">
                        {k.childCount} inside
                      </span>
                    )}
                  </span>
                  <Badge tone={STATUS_TONE[k.status]}>{STATUS_LABEL[k.status]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {item.companies.length > 0 && (
        <Card className="mb-6 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-ink-faint">Asked at</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.companies.map((c) => (
              <Link
                key={c}
                href={"/jobs?q=" + encodeURIComponent(c)}
                className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[12px] text-ink-dim transition hover:border-line-strong hover:text-ink"
              >
                {c}
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* The seeded starting points for this discipline. Read-only: they are a prompt for your
          own answer below, not a substitute for it. */}
      {!isFolder && meta.fields.some((f) => content[f.key]) && (
        <>
          <SectionTitle>Starting points</SectionTitle>
          <div className="mb-6 space-y-2">
            {meta.fields.map((f) =>
              content[f.key] ? (
                <Card key={f.key} className="px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-ink-faint">{f.label}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
                    {String(content[f.key])}
                  </p>
                </Card>
              ) : null,
            )}
          </div>
        </>
      )}

      {/* Progress belongs to things you practise. A folder is not one of them, and letting it
          carry a status would put it in the progress counts as work you had not done. */}
      {!isFolder && (
        <form action={save} className="space-y-5">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="segment" value={segment} />
          <input type="hidden" name="path" value={here} />

          <Card className="px-5 py-5">
            <SectionTitle>Your progress</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {STATUS_ORDER.map((s) => (
                <label
                  key={s}
                  className={cx(
                    "cursor-pointer rounded-md border px-3 py-1.5 text-[13px] transition",
                    item.status === s
                      ? "border-accent bg-accent-soft text-accent-ink"
                      : "border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink",
                  )}
                >
                  <input
                    type="radio"
                    name="status"
                    value={s}
                    defaultChecked={item.status === s}
                    className="sr-only"
                  />
                  {STATUS_LABEL[s]}
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">
              Revisit is not counted as done — marking something for revision is an admission it
              is not solid yet, and a progress bar that says otherwise is lying to you.
            </p>
          </Card>

          <Card className="space-y-4 px-5 py-5">
            <SectionTitle>Your answer</SectionTitle>
            <div>
              <label htmlFor="notes" className="block text-[13px] font-medium text-ink">
                Notes
              </label>
              <p className="mb-1.5 mt-0.5 text-xs text-ink-faint">
                In your own words. This is the version you will actually recall in the room.
              </p>
              <textarea
                id="notes"
                name="notes"
                rows={8}
                defaultValue={item.notes ?? ""}
                placeholder={meta.fields.map((f) => f.hint).join(" · ")}
                className={cx(inputStyles, "resize-y font-normal leading-relaxed")}
              />
            </div>

            {meta.kind === "dsa" && (
              <div>
                <label htmlFor="solution" className="block text-[13px] font-medium text-ink">
                  Solution
                </label>
                <p className="mb-1.5 mt-0.5 text-xs text-ink-faint">
                  Code, or the outline you would write on a whiteboard.
                </p>
                <textarea
                  id="solution"
                  name="solution"
                  rows={12}
                  defaultValue={item.solution ?? ""}
                  className={cx(inputStyles, "resize-y font-mono text-[12.5px] leading-relaxed")}
                />
              </div>
            )}

            <Button type="submit" variant="primary">
              Save
            </Button>
          </Card>
        </form>
      )}

      {item.sourceUrl && (
        <p className="mt-6 text-xs text-ink-faint">
          Source:{" "}
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-ink hover:underline"
          >
            {item.sourceUrl}
          </a>
        </p>
      )}
    </div>
  );
}
