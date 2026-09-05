import Link from "next/link";

import { JobCard, type JobRow } from "@/components/job-card";
import { Badge, Card, EmptyState, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { getDb } from "@/db";
import { jobStats, listCompanyHealth, listJobs } from "@/server/repository/jobs-repo";

export const dynamic = "force-dynamic";

const HEALTH_TONE = {
  healthy: "fresh",
  degraded: "warn",
  suspicious: "warn",
  failing: "danger",
  unknown: "neutral",
} as const;

function ago(date: Date | null): string {
  if (!date) return "never";
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function DashboardPage() {
  const db = getDb();
  const [stats, top, health] = await Promise.all([
    jobStats(db),
    listJobs(db, { sort: "best", limit: 6 }),
    listCompanyHealth(db),
  ]);

  const automated = health.filter((c) => c.active && c.sourceType !== "manual");
  const needsAttention = automated.filter(
    (c) => c.healthStatus !== "healthy" && c.healthStatus !== "unknown",
  );
  const manual = health.filter((c) => c.active && c.sourceType === "manual");
  const lastCrawl = automated
    .map((c) => c.lastSuccessAt)
    .filter(Boolean)
    .sort((a, b) => (b as Date).getTime() - (a as Date).getTime())[0] as Date | undefined;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            What needs attention today. Last successful crawl {ago(lastCrawl ?? null)}.
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Matching roles"
          value={Number(stats.relevant ?? 0)}
          hint="open and relevant"
          tone="fresh"
        />
        <Stat
          label="Found in 3 days"
          value={Number(stats.recent ?? 0)}
          hint="new matches"
        />
        <Stat label="Jobs tracked" value={Number(stats.total ?? 0)} hint="all sources" />
        <Stat
          label="Sources healthy"
          value={`${automated.length - needsAttention.length}/${automated.length}`}
          hint="automated crawlers"
          tone={needsAttention.length ? "warn" : "neutral"}
        />
      </div>

      {needsAttention.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Needs attention</SectionTitle>
          <ul className="space-y-1.5">
            {needsAttention.map((c) => (
              <Card as="li" key={c.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-ink">{c.name}</span>
                  {c.lastError && (
                    <p className="mt-0.5 text-xs text-ink-dim">{c.lastError}</p>
                  )}
                </div>
                <Badge tone={HEALTH_TONE[c.healthStatus]}>{c.healthStatus}</Badge>
              </Card>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <SectionTitle
          action={
            <Link href="/jobs" className="text-[13px] text-ink-dim transition hover:text-ink">
              View all →
            </Link>
          }
        >
          Top matches
        </SectionTitle>
        {top.length === 0 ? (
          <EmptyState
            title="No matching roles yet"
            body="The crawler runs every six hours and will surface SDE-2 roles in Bangalore, Gurgaon, Remote or Hyderabad as they appear."
            hint={<code className="text-ink-dim">python -m crawler.main</code>}
          />
        ) : (
          <ul className="space-y-2">
            {(top as unknown as JobRow[]).map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </ul>
        )}
      </section>

      {manual.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Check by hand · {manual.length}</SectionTitle>
          <Card className="px-4 py-3.5">
            <p className="text-xs text-ink-dim">
              These sources cannot be crawled automatically — they render listings in the
              browser, or decline automated access. Manual is a supported state, not a failure.
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {manual.map((c) =>
                c.careersUrl ? (
                  <li key={c.id}>
                    <a
                      href={c.careersUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[13px] text-ink-dim transition hover:border-line-strong hover:text-ink"
                    >
                      {c.name}
                      <span className="text-ink-faint">↗</span>
                    </a>
                  </li>
                ) : (
                  <li
                    key={c.id}
                    className="rounded-md border border-line px-2.5 py-1 text-[13px] text-ink-faint"
                  >
                    {c.name}
                  </li>
                ),
              )}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
