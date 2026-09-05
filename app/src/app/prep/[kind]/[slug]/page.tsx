import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";

import { Badge, Button, Card, PageHeader, SectionTitle, cx, inputStyles } from "@/components/ui";
import { getDb } from "@/db";
import type { PrepStatus } from "@/db/schema";
import { PREP_STATUSES } from "@/db/schema";
import { STATUS_LABEL, STATUS_ORDER, kindBySegment } from "@/server/domain/prep";
import { getBySlug, updateProgress } from "@/server/repository/prep-repo";

export const dynamic = "force-dynamic";

const DIFFICULTY_TONE = { easy: "fresh", medium: "warn", hard: "danger" } as const;

const STATUS_TONE: Record<PrepStatus, "neutral" | "accent" | "fresh" | "warn"> = {
  not_started: "neutral",
  in_progress: "accent",
  done: "fresh",
  revisit: "warn",
};

async function save(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const segment = String(formData.get("segment"));
  const slug = String(formData.get("slug"));
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

  revalidatePath("/prep/" + segment + "/" + slug);
  revalidatePath("/prep/" + segment);
  revalidatePath("/prep");
}

export default async function PrepDetailPage({
  params,
}: {
  params: Promise<{ kind: string; slug: string }>;
}) {
  const { kind: segment, slug } = await params;
  const meta = kindBySegment(segment);
  if (!meta) notFound();

  const item = await getBySlug(getDb(), meta.kind, slug);
  if (!item) notFound();

  const content = item.content ?? {};

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={item.title}
        subtitle={item.prompt ?? undefined}
        actions={
          <Link
            href={"/prep/" + segment}
            className="text-[13px] text-ink-dim transition hover:text-ink"
          >
            ← {meta.title}
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
        {item.difficulty && (
          <Badge tone={DIFFICULTY_TONE[item.difficulty]}>{item.difficulty}</Badge>
        )}
        <span className="text-[11px] text-ink-faint">asked {item.frequency}/5</span>
        {item.topics.map((t) => (
          <span key={t} className="text-[11px] text-ink-faint">
            #{t}
          </span>
        ))}
      </div>

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
      {meta.fields.some((f) => content[f.key]) && (
        <>
          <SectionTitle>Starting points</SectionTitle>
          <div className="mb-6 space-y-2">
            {meta.fields.map((f) =>
              content[f.key] ? (
                <Card key={f.key} className="px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-ink-faint">
                    {f.label}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
                    {String(content[f.key])}
                  </p>
                </Card>
              ) : null,
            )}
          </div>
        </>
      )}

      <form action={save} className="space-y-5">
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="segment" value={segment} />
        <input type="hidden" name="slug" value={item.slug} />

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
