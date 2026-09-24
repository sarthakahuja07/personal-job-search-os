import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";

import { RichEditor } from "@/components/rich-editor";
import { GithubNotes } from "@/components/github-notes";
import { PageGrading } from "@/components/page-grading";
import { BookReader, SiteEmbed } from "@/components/page-readers";
import { CodeWorkspace } from "@/components/code-workspace";
import { DsaSolution } from "@/components/dsa-solution";
import { PageResources } from "@/components/page-resources";
import { Badge, Button, Card, PageHeader, SectionTitle, cx, inputStyles } from "@/components/ui";
import { getDb } from "@/db";
import type { PrepStatus } from "@/db/schema";
import { PREP_STATUSES } from "@/db/schema";
import { Markdown } from "@/components/markdown";
import { DISCIPLINES, type Discipline } from "@/server/domain/company";
import {
  STATUS_LABEL,
  STATUS_ORDER,
  isRenderOnlyBody,
  kindBySegment,
} from "@/server/domain/prep";
import {
  ancestorsOf,
  childrenOf,
  codeFilesFor,
  questionRows,
  resolvePath,
  resourcesFor,
  updateProgress,
} from "@/server/repository/prep-repo";
import { liveIndexBody } from "@/server/service/company";
import { collectQuestions } from "@/server/domain/prep-questions";
import { QuestionBrowser } from "@/components/question-browser";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<PrepStatus, "neutral" | "accent" | "fresh" | "warn"> = {
  not_started: "neutral",
  in_progress: "accent",
  done: "fresh",
  revisit: "warn",
};

/** Whether a DSA page's source link is the canonical LeetCode problem, for the header button's label. */
function isLeetCodeUrl(url: string): boolean {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === "leetcode.com";
  } catch {
    return false;
  }
}

function revalidateTree(segment: string, path: string[]) {
  revalidatePath("/prep/" + segment + "/" + path.join("/"));
  revalidatePath("/prep/" + segment);
  revalidatePath("/prep");
}

/**
 * Status is its own action because it now lives at the top of the page, away from the answer
 * fields. One combined form would have meant a click on "Done" also rewriting whatever was in
 * the notes box at the time -- including an empty one.
 */
async function saveStatus(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const segment = String(formData.get("segment"));
  const path = String(formData.get("path") ?? "").split("/").filter(Boolean);
  const rawStatus = String(formData.get("status") ?? "");

  // Validate against the known set rather than trusting the form: a status the UI does not
  // understand would render as a blank badge forever.
  if (!(PREP_STATUSES as readonly string[]).includes(rawStatus)) return;
  await updateProgress(getDb(), id, { status: rawStatus as PrepStatus });
  revalidateTree(segment, path);
}

async function saveAnswer(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const segment = String(formData.get("segment"));
  const path = String(formData.get("path") ?? "").split("/").filter(Boolean);

  await updateProgress(getDb(), id, {
    notes: String(formData.get("notes") ?? "").trim() || null,
    solution: String(formData.get("solution") ?? "").trim() || null,
  });
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
  searchParams: Promise<{ doc?: string; q?: string }>;
}) {
  const { kind: segment, path } = await params;
  const { doc, q } = await searchParams;
  const meta = kindBySegment(segment);
  if (!meta) notFound();

  const db = getDb();
  const item = await resolvePath(db, meta.kind, path);
  if (!item) notFound();

  const [kids, chain, resources, codeFiles] = await Promise.all([
    childrenOf(db, item.id),
    ancestorsOf(db, item.id),
    resourcesFor(db, item.id),
    codeFilesFor(db, item.id),
  ]);

  const content = item.content ?? {};
  const isReader = Boolean(content.pdf || content.drive || content.github || content.embed);
  const hasChildren = kids.length > 0;
  // Two different questions that used to share one flag. `hasChildren` decides whether to list
  // pages inside; `isPractisable` decides whether progress and answer fields belong. A reader
  // is not practised and a folder is not either, but only a folder has a list -- conflating
  // them rendered an empty "0 pages" section on every book.
  const isPractisable = !hasChildren && !isReader;

  /*
    A folder lists every question inside it at any depth, searchable -- HLD's questions sit a
    level down in `hld/questions`, DSA's under sub-pattern folders. The direct-children list
    below then shows only what is *not* a question (sub-folders, Notes, resources), so nothing
    is listed twice. Company folders keep their plain listing: their contents are documents.
  */
  const folderQuestions =
    hasChildren && meta.kind !== "company"
      ? collectQuestions(await questionRows(db, meta.kind), segment, path.join("/"))
      : [];
  const questionIds = new Set(folderQuestions.map((fq) => fq.id));
  const otherKids = kids.filter((k) => !questionIds.has(k.id));
  /*
    A fully worked DSA answer -- problem, brute force, optimized -- gets its own template
    instead of the generic editor, because its code has to sit *between* a section's steps and
    its complexity, not below everything in one shared panel. `problemSummary` is what marks a
    page as this shape rather than a hand-written note.
  */
  const isDsaSolution = meta.kind === "dsa" && Boolean(content.problemSummary);
  /*
    Code belongs on a question you answer *in code*.

    Gated on the kind rather than on the LLD folder's path: LLD is one folder among several that
    want a worked implementation -- a DSA question does too -- and keying a feature to a
    particular path would make it a thing about that folder rather than about the kind of
    question, which is exactly what the `kind` discriminator exists to avoid. A behavioural
    story has no code, and a folder or a book is not answered at all.

    A worked DSA answer is the one exception: its code renders inline, once per section, via
    `SolutionCode` below -- the shared top-of-page workspace would just show the same two files
    a second time.
  */
  const showsCode = isPractisable && meta.kind !== "behavioral" && !isDsaSolution;

  /*
    Some pages are rendered, not edited.

    A generated page -- a company question bank or discipline index -- carries the rows it was
    built from in `content.rows`, and the next publish re-renders it from those. Editing it by
    hand would look like it worked and be discarded on the next call.

    A page containing a Markdown table is read-only for a harder reason: the editor is built on
    StarterKit, which has no table node, so it flattens a table into text *and saves that back
    on blur*. One click into the page would destroy the table. Read-only is a limitation;
    shredding the content is a bug.
  */
  const isGenerated = Array.isArray(content.rows);
  const isRendered = !isReader && (isGenerated || isRenderOnlyBody(item.body));
  const here = path.join("/");
  const hrefFor = (slug: string) => `/prep/${segment}/${[...path, slug].join("/")}`;

  /*
    A company's DSA/HLD/LLD index is generated like the question bank, but "done" is not a fact
    that a publish call learns about -- it changes on the linked page itself, any time, with no
    publish involved. Its stored body would show whatever was done the day it was last published;
    re-resolving live on every view is what keeps the checklist actually a checklist.
  */
  const isCompanyDisciplineIndex =
    isGenerated && meta.kind === "company" && (DISCIPLINES as readonly string[]).includes(item.slug);
  const displayBody = isCompanyDisciplineIndex
    ? await liveIndexBody(
        db,
        chain[0]?.title ?? item.title,
        item.slug as Discipline,
        (content.rows as { title: string; frequency?: number; lastAsked?: string | null }[]) ?? [],
      )
    : item.body;

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
          <>
            {meta.kind === "dsa" && item.sourceUrl && (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] text-ink-dim transition hover:border-line-strong hover:text-ink"
              >
                {isLeetCodeUrl(item.sourceUrl) ? "View on LeetCode" : "Source"} ↗
              </a>
            )}
            <Link
              href={"/prep/" + segment}
              className="text-[13px] text-ink-dim transition hover:text-ink"
            >
              ← {meta.title}
            </Link>
          </>
        }
      />

      {/* A folder's questions come before its own notes: they are what the folder is for. */}
      {folderQuestions.length > 0 && (
        <QuestionBrowser
          questions={folderQuestions}
          initialQuery={q ?? ""}
          hasDifficulty={meta.hasDifficulty}
        />
      )}

      {/* Progress first. It is the question you answer on arriving at a page and again on
          leaving it, and it used to sit below the notes where you had to scroll past your own
          answer to reach it. Each status is a submit button, so setting one is a single click
          rather than a radio plus a Save. */}
      {isPractisable && (
        <form action={saveStatus} className="mb-5 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="segment" value={segment} />
          <input type="hidden" name="path" value={here} />
          {STATUS_ORDER.map((st) => (
            <button
              key={st}
              type="submit"
              name="status"
              value={st}
              className={cx(
                "rounded-md border px-3 py-1.5 text-[13px] transition",
                item.status === st
                  ? "border-accent bg-accent-soft font-medium text-accent-ink"
                  : "border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink",
              )}
            >
              {STATUS_LABEL[st]}
            </button>
          ))}
          {item.topics.map((t) => (
            <span key={t} className="text-[11px] text-ink-faint">
              #{t}
            </span>
          ))}
        </form>
      )}

      {isPractisable && (
        <div className="mb-5">
          <PageGrading
            id={item.id}
            path={`/prep/${segment}/${here}`}
            difficulty={item.difficulty}
            frequency={item.frequency}
          />
        </div>
      )}

      <PageResources
        prepItemId={item.id}
        path={`/prep/${segment}/${here}`}
        resources={resources}
      />

      {showsCode && (
        <CodeWorkspace
          prepItemId={item.id}
          path={`/prep/${segment}/${here}`}
          files={codeFiles}
          defaultOpen={meta.kind === "dsa"}
        />
      )}

      {/* A worked DSA answer: problem, a complexity comparison, then brute force (wherever
          applicable) and optimized, each self-contained with its own code sitting right after
          its steps -- not bundled into one panel a scroll away from the explanation it belongs
          to. See DsaSolution for the actual template. */}
      {isDsaSolution && <DsaSolution content={content} codeFiles={codeFiles} />}

      {/* A page is a document unless its content says otherwise. Readers replace the editor
          rather than sitting beside it: there is nothing to write on a book. */}
      {!isDsaSolution && (
      <div className="mb-6">
        {content.drive ? (
          <BookReader file={`/api/books/${item.id}`} title={item.title} hosted="drive" />
        ) : content.pdf ? (
          <BookReader file={String(content.pdf)} title={item.title} />
        ) : content.github ? (
          <GithubNotes
            repo={String(content.github)}
            basePath={`/prep/${segment}/${here}`}
            open={doc}
          />
        ) : content.embed ? (
          <SiteEmbed url={String(content.embed)} title={item.title} />
        ) : isRendered ? (
          <div>
            <article className="rounded-card border border-line bg-surface px-5 py-4">
              <Markdown>{displayBody ?? ""}</Markdown>
            </article>
            <p className="mt-2 text-[11.5px] text-ink-faint">
              {isCompanyDisciplineIndex
                ? "Generated live from what was published to it -- each question's done status always reflects its own page, not the day this was last published."
                : isGenerated
                  ? "Generated from what was published to it. Publishing again updates it; edits made here would be replaced."
                  : "Shown as written. Pages containing a table or a diagram are not editable here, because the editor cannot represent either."}
            </p>
          </div>
        ) : (
          <RichEditor
            id={item.id}
            path={`/prep/${segment}/${here}`}
            initialBody={item.body ?? ""}
          />
        )}
      </div>
      )}

      {otherKids.length > 0 && (
        <section className="mb-6">
          <SectionTitle>
            {folderQuestions.length > 0
              ? "Also in this folder"
              : `${otherKids.length} page${otherKids.length === 1 ? "" : "s"}`}
          </SectionTitle>
          <ul className="space-y-1.5">
            {otherKids.map((k) => (
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
      {isPractisable && meta.fields.some((f) => content[f.key]) && (
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

      {isPractisable && (
        <form action={saveAnswer} className="space-y-5">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="segment" value={segment} />
          <input type="hidden" name="path" value={here} />

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
                // A document kind declares no answer fields, so it has no hints to join.
                placeholder={
                  meta.fields.map((f) => f.hint).join(" · ") || "In your own words."
                }
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
