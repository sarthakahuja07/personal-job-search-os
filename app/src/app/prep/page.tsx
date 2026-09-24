import Link from "next/link";

import { Badge, Card, PageHeader, SectionTitle } from "@/components/ui";
import { getDb } from "@/db";
import { KINDS, STATUS_LABEL } from "@/server/domain/prep";
import { progressByKind, recentlyPractised } from "@/server/repository/prep-repo";

export const dynamic = "force-dynamic";

function Bar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-faint">
        <span className="tnum">
          {done} of {total} done
        </span>
        <span className="tnum">{pct}%</span>
      </div>
    </div>
  );
}

function ago(date: Date | null): string {
  if (!date) return "";
  const hours = Math.floor((Date.now() - date.getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function PrepOverviewPage() {
  const db = getDb();
  const [progress, recent] = await Promise.all([
    progressByKind(db),
    recentlyPractised(db, 5),
  ]);

  const totals = [...progress.values()].reduce(
    (acc, p) => ({ total: acc.total + p.total, done: acc.done + p.done }),
    { total: 0, done: 0 },
  );

  return (
    <div>
      <PageHeader
        title="Preparation"
        subtitle={
          totals.total > 0 ? (
            <>
              <span className="tnum text-ink">{totals.done}</span> of{" "}
              <span className="tnum text-ink">{totals.total}</span> complete across three
              disciplines.
            </>
          ) : (
            "Interview preparation, tracked alongside the roles it is for."
          )
        }
        actions={
          <Link
            href="/prep/revise"
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-canvas transition hover:brightness-110"
          >
            Revise with flashcards
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {KINDS.map((k) => {
          const p = progress.get(k.kind) ?? {
            total: 0,
            done: 0,
            inProgress: 0,
            revisit: 0,
          };
          return (
            <Link key={k.kind} href={`/prep/${k.segment}`} className="group">
              <Card className="h-full px-4 py-4 transition group-hover:border-line-strong">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-[15px] font-medium text-ink">{k.title}</h2>
                  <span className="tnum text-[13px] text-ink-faint">{p.total}</span>
                </div>
                <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-dim">{k.tagline}</p>
                <Bar done={p.done} total={p.total} />
                {(p.inProgress > 0 || p.revisit > 0) && (
                  <div className="mt-2.5 flex gap-1.5">
                    {p.inProgress > 0 && <Badge tone="accent">{p.inProgress} in progress</Badge>}
                    {p.revisit > 0 && <Badge tone="warn">{p.revisit} to revisit</Badge>}
                  </div>
                )}
              </Card>
            </Link>
          );
        })}
      </div>

      {recent.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Pick up where you left off</SectionTitle>
          <ul className="space-y-1.5">
            {recent.map((r) => {
              const meta = KINDS.find((k) => k.kind === r.kind);
              return (
                <Card as="li" key={r.id} className="px-4 py-2.5">
                  <Link
                    href={`/prep/${meta?.segment}/${r.slug}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0">
                      <span className="text-sm text-ink">{r.title}</span>
                      <span className="ml-2 text-xs text-ink-faint">{meta?.title}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={r.status === "done" ? "fresh" : "accent"}>
                        {STATUS_LABEL[r.status]}
                      </Badge>
                      <span className="text-[11px] text-ink-faint">
                        {ago(r.lastPracticedAt)}
                      </span>
                    </span>
                  </Link>
                </Card>
              );
            })}
          </ul>
        </section>
      )}

      <Card className="mt-8 border-dashed px-4 py-3.5">
        <p className="text-xs leading-relaxed text-ink-faint">
          <span className="font-medium text-ink-dim">Starter content.</span> These are questions
          that genuinely get asked, tagged with the companies on your target list that ask them.
          Your own Notion material will extend or replace them — the schema keeps
          discipline-specific fields in a JSON column precisely so importing it means mapping
          fields rather than reshaping tables (PRD §39).
        </p>
      </Card>
    </div>
  );
}
