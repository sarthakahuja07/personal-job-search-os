import Link from "next/link";

import { JobCard, type JobRow } from "@/components/job-card";
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

  const jobs = (await listJobs(getDb(), {
    companyId: params.company,
    query: params.q,
    relevantOnly,
    newOnly: params.new === "1",
    sort: (params.sort as "best") ?? "best",
    limit: 100,
  })) as unknown as JobRow[];

  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(
      Object.entries({ ...params, ...patch }).filter(([, v]) => v) as [string, string][],
    );
    return `/jobs?${next.toString()}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-sm text-neutral-500">
          {jobs.length} {relevantOnly ? "relevant" : "total"} open role
          {jobs.length === 1 ? "" : "s"}
        </p>
      </div>

      <form method="get" className="mt-4 flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search title or location"
          className="w-64 rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
        />
        <select
          name="sort"
          defaultValue={params.sort ?? "best"}
          className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Apply
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <Link
          href={qs({ new: params.new === "1" ? undefined : "1" })}
          className={`rounded border px-2.5 py-1 ${params.new === "1" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
        >
          New only
        </Link>
        <Link
          href={qs({ all: relevantOnly ? "1" : undefined })}
          className={`rounded border px-2.5 py-1 ${!relevantOnly ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
        >
          Include non-matching
        </Link>
        {(params.company || params.q) && (
          <Link href="/jobs" className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-neutral-700">
            Clear filters
          </Link>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
          <p className="font-medium text-neutral-700">No matching jobs yet.</p>
          <p className="mt-1 text-sm text-neutral-500">
            {relevantOnly
              ? "Try including non-matching roles, or run a crawl: python -m crawler.main"
              : "Add target companies, or run a crawl: python -m crawler.main"}
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </ul>
      )}
    </div>
  );
}
