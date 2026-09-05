import Link from "next/link";

import { JobCard, type JobRow } from "@/components/job-card";
import { Button, EmptyState, PageHeader, cx, inputStyles } from "@/components/ui";
import { getDb } from "@/db";
import { listJobs } from "@/server/repository/jobs-repo";

export const dynamic = "force-dynamic";

type Search = {
  company?: string;
  q?: string;
  sort?: string;
  all?: string;
  new?: string;
};

const SORTS = [
  { key: "best", label: "Best match" },
  { key: "newest", label: "Recently found" },
  { key: "posted", label: "Recently posted" },
  { key: "company", label: "Company" },
];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const relevantOnly = params.all !== "1";
  const newOnly = params.new === "1";

  const jobs = (await listJobs(getDb(), {
    companyId: params.company,
    query: params.q,
    relevantOnly,
    newOnly,
    sort: (params.sort as "best") ?? "best",
    limit: 100,
  })) as unknown as JobRow[];

  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(
      Object.entries({ ...params, ...patch }).filter(([, v]) => v) as [string, string][],
    );
    const s = next.toString();
    return s ? `/jobs?${s}` : "/jobs";
  };

  const companyName = params.company ? jobs[0]?.companyName : undefined;
  const filtered = Boolean(params.company || params.q || newOnly || !relevantOnly);

  const chip = (active: boolean) =>
    cx(
      "rounded-md border px-2.5 py-1 text-[13px] transition",
      active
        ? "border-accent bg-accent-soft text-accent-ink"
        : "border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink",
    );

  return (
    <div>
      <PageHeader
        title="Jobs"
        subtitle={
          <>
            <span className="tnum text-ink">{jobs.length}</span>{" "}
            {relevantOnly ? "matching" : "total"} open role{jobs.length === 1 ? "" : "s"}
            {companyName && <> at {companyName}</>}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form method="get" className="flex flex-1 flex-wrap items-center gap-2">
          {params.company && (
            <input type="hidden" name="company" value={params.company} />
          )}
          {newOnly && <input type="hidden" name="new" value="1" />}
          {!relevantOnly && <input type="hidden" name="all" value="1" />}
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Search title or location…"
            className={cx(inputStyles, "max-w-xs flex-1")}
          />
          <select
            name="sort"
            defaultValue={params.sort ?? "best"}
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink-dim outline-none focus:border-accent"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key} className="bg-surface-2">
                {s.label}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary">
            Search
          </Button>
        </form>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={qs({ new: newOnly ? undefined : "1" })} className={chip(newOnly)}>
          New only
        </Link>
        <Link href={qs({ all: relevantOnly ? "1" : undefined })} className={chip(!relevantOnly)}>
          Include non-matching
        </Link>
        {filtered && (
          <Link
            href="/jobs"
            className="px-1 text-[13px] text-ink-faint transition hover:text-ink-dim"
          >
            Clear
          </Link>
        )}
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body={
            relevantOnly
              ? "No roles match your rules right now. Try including non-matching roles to see everything that was crawled."
              : "No jobs have been discovered yet. The crawler runs every six hours."
          }
          hint={
            relevantOnly ? (
              <Link href={qs({ all: "1" })} className="text-accent-ink hover:underline">
                Show all crawled roles →
              </Link>
            ) : (
              <code className="text-ink-dim">python -m crawler.main</code>
            )
          }
        />
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </ul>
      )}
    </div>
  );
}
