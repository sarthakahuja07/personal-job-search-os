import Link from "next/link";

import { JobCard, type JobRow } from "@/components/job-card";
import { getDb } from "@/db";
import { jobStats, listCompanyHealth, listJobs } from "@/server/repository/jobs-repo";

export const dynamic = "force-dynamic";

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="mt-0.5 text-sm text-neutral-600">{label}</div>
      {hint && <div className="mt-1 text-xs text-neutral-400">{hint}</div>}
    </div>
  );
}

const HEALTH_STYLE: Record<string, string> = {
  healthy: "bg-emerald-100 text-emerald-800",
  degraded: "bg-amber-100 text-amber-800",
  suspicious: "bg-amber-100 text-amber-900",
  failing: "bg-red-100 text-red-800",
  unknown: "bg-neutral-100 text-neutral-600",
};

export default async function DashboardPage() {
  const db = getDb();
  const [stats, recent, health] = await Promise.all([
    jobStats(db),
    listJobs(db, { sort: "best", limit: 8 }),
    listCompanyHealth(db),
  ]);

  const crawlable = health.filter((c) => c.active && c.sourceType !== "manual");
  const needsAttention = crawlable.filter(
    (c) => c.healthStatus !== "healthy" && c.healthStatus !== "unknown",
  );
  const manual = health.filter((c) => c.active && c.sourceType === "manual");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-500">What needs attention today.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Relevant open roles" value={Number(stats.relevant ?? 0)} />
        <Stat label="Found in last 3 days" value={Number(stats.recent ?? 0)} hint="new matches" />
        <Stat label="Jobs tracked" value={Number(stats.total ?? 0)} hint="all companies" />
        <Stat
          label="Sources healthy"
          value={`${crawlable.length - needsAttention.length}/${crawlable.length}`}
          hint="automated crawlers"
        />
      </div>

      {needsAttention.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Crawlers needing attention
          </h2>
          <ul className="mt-2 space-y-1.5">
            {needsAttention.map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between gap-3 rounded border border-neutral-200 bg-white px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{c.name}</span>
                  {c.lastError && (
                    <p className="mt-0.5 text-xs text-neutral-500">{c.lastError}</p>
                  )}
                </div>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${HEALTH_STYLE[c.healthStatus]}`}>
                  {c.healthStatus}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Top matches
          </h2>
          <Link href="/jobs" className="text-sm text-neutral-600 hover:underline">
            View all
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
            <p className="font-medium text-neutral-700">No relevant jobs discovered yet.</p>
            <p className="mt-1 text-sm text-neutral-500">
              Run a crawl with <code>python -m crawler.main</code>.
            </p>
          </div>
        ) : (
          <ul className="mt-2 space-y-2">
            {(recent as unknown as JobRow[]).map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </ul>
        )}
      </section>

      {manual.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Check these by hand ({manual.length})
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            These sources cannot be crawled automatically. Manual is a supported state, not a
            failure &mdash; see docs/crawlers.md.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {manual.map((c) => (
              <li key={c.id}>
                {c.careersUrl ? (
                  <a
                    href={c.careersUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-sm text-neutral-700 hover:border-neutral-400"
                  >
                    {c.name} &rarr;
                  </a>
                ) : (
                  <span className="rounded border border-neutral-200 bg-white px-2.5 py-1 text-sm text-neutral-400">
                    {c.name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
