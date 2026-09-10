import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { getDb } from "@/db";
import type { PrepStatus } from "@/db/schema";
import {
  DIFFICULTY_ORDER,
  STATUS_LABEL,
  STATUS_ORDER,
  kindBySegment,
  summarise,
  topicCounts,
} from "@/server/domain/prep";
import { listByKind } from "@/server/repository/prep-repo";

export const dynamic = "force-dynamic";

const DIFFICULTY_TONE = {
  easy: "fresh",
  medium: "warn",
  hard: "danger",
} as const;

const STATUS_TONE: Record<PrepStatus, "neutral" | "accent" | "fresh" | "warn"> = {
  not_started: "neutral",
  in_progress: "accent",
  done: "fresh",
  revisit: "warn",
};

export default async function PrepListPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ topic?: string; status?: string; difficulty?: string; q?: string }>;
}) {
  const { kind: segment } = await params;
  const meta = kindBySegment(segment);
  if (!meta) notFound();

  const filters = await searchParams;
  const all = await listByKind(getDb(), meta.kind);

  // Filtering happens here rather than in SQL: topics are a JSON array, and at a few dozen rows
  // per discipline one query plus an in-memory pass beats a query per filter combination.
  const items = all.filter((item) => {
    if (filters.topic && !item.topics.includes(filters.topic)) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.difficulty && item.difficulty !== filters.difficulty) return false;
    if (filters.q) {
      const needle = filters.q.toLowerCase();
      const hay = (item.title + " " + (item.prompt ?? "") + " " + item.topics.join(" ")).toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const progress = summarise(all);
  const topics = topicCounts(all).slice(0, 14);

  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(
      Object.entries({ ...filters, ...patch }).filter(([, v]) => v) as [string, string][],
    );
    const s = next.toString();
    return s ? "/prep/" + segment + "?" + s : "/prep/" + segment;
  };

  const chip = (active: boolean) =>
    cx(
      "rounded-control border px-2 py-0.5 text-meta transition",
      active
        ? "border-line-strong bg-surface-3 text-ink"
        : "border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink",
    );

  const anyFilter = Boolean(filters.topic || filters.status || filters.difficulty || filters.q);

  return (
    <div>
      <PageHeader
        title={meta.title}
        subtitle={
          <>
            {meta.tagline}
            <span className="mt-1 block">
              <span className="tnum text-ink">{progress.done}</span> of{" "}
              <span className="tnum text-ink">{progress.total}</span> done
              {progress.revisit > 0 && (
                <>
                  {" · "}
                  <span className="tnum text-warn">{progress.revisit}</span> to revisit
                </>
              )}
            </span>
          </>
        }
        actions={
          <Link href="/prep" className="text-body text-ink-dim transition hover:text-ink">
            ← All prep
          </Link>
        }
      />

      <div className="mb-5 space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-label uppercase tracking-wide text-ink-faint">Status</span>
          {STATUS_ORDER.map((s) => (
            <Link
              key={s}
              href={qs({ status: filters.status === s ? undefined : s })}
              className={chip(filters.status === s)}
            >
              {STATUS_LABEL[s]}
            </Link>
          ))}
          {meta.hasDifficulty && (
            <>
              <span className="ml-3 mr-1 text-label uppercase tracking-wide text-ink-faint">
                Difficulty
              </span>
              {DIFFICULTY_ORDER.map((d) => (
                <Link
                  key={d}
                  href={qs({ difficulty: filters.difficulty === d ? undefined : d })}
                  className={chip(filters.difficulty === d)}
                >
                  {d}
                </Link>
              ))}
            </>
          )}
          {anyFilter && (
            <Link
              href={"/prep/" + segment}
              className="ml-2 text-meta text-ink-faint transition hover:text-ink-dim"
            >
              Clear
            </Link>
          )}
        </div>

        {topics.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-label uppercase tracking-wide text-ink-faint">Topic</span>
            {topics.map((t) => (
              <Link
                key={t.topic}
                href={qs({ topic: filters.topic === t.topic ? undefined : t.topic })}
                className={chip(filters.topic === t.topic)}
              >
                {t.topic}
                <span className="tnum ml-1 text-ink-faint">{t.count}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing matches those filters"
          body="Clear a filter to see the rest of this section."
        />
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <Card as="li" key={item.id} className="transition hover:border-line-strong">
              <Link
                href={"/prep/" + segment + "/" + item.slug}
                className="flex items-start justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-section font-medium text-ink">{item.title}</span>
                    {item.difficulty && (
                      <Badge tone={DIFFICULTY_TONE[item.difficulty]}>{item.difficulty}</Badge>
                    )}
                    {item.status !== "not_started" && (
                      <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
                    )}
                  </div>
                  {item.prompt && (
                    <p className="mt-1 line-clamp-1 text-body text-ink-dim">{item.prompt}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {item.topics.slice(0, 5).map((t) => (
                      <span key={t} className="text-label text-ink-faint">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {/* Frequency as five dots rather than a number: this is a "how much does this
                      matter" signal, not a measurement worth reading precisely. */}
                  <div className="flex justify-end gap-0.5" title={"Asked frequency " + item.frequency + "/5"}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <span
                        key={i}
                        className={cx(
                          "h-1 w-1 rounded-full",
                          i < item.frequency ? "bg-accent" : "bg-surface-3",
                        )}
                        aria-hidden
                      />
                    ))}
                  </div>
                  {item.companies.length > 0 && (
                    <div className="mt-1.5 max-w-[150px] truncate text-label text-ink-faint">
                      {item.companies.join(", ")}
                    </div>
                  )}
                </div>
              </Link>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
