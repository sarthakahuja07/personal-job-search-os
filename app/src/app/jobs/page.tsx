import Link from "next/link";

import { CompanyGroup } from "@/components/company-group";
import { ReadSection } from "@/components/read-section";
import { JobCard, type JobRow } from "@/components/job-card";
import { EmptyState, PageHeader, cx } from "@/components/ui";
import { getDb } from "@/db";
import {
  companiesWithJobs,
  contactsByCompany,
  listJobs,
} from "@/server/repository/jobs-repo";
import { CompanySearch } from "./company-search";

export const dynamic = "force-dynamic";

type Search = {
  company?: string;
  q?: string;
  sort?: string;
  all?: string;
  new?: string;
  flat?: string;
};

const SORTS = [
  { key: "best", label: "Best match" },
  { key: "newest", label: "Recently found" },
  { key: "posted", label: "Recently posted" },
];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const relevantOnly = params.all !== "1";
  const newOnly = params.new === "1";
  const grouped = params.flat !== "1";
  const sort = (params.sort as "best" | "newest" | "posted") ?? "best";
  const db = getDb();

  // Active and reviewed are fetched separately and bounded separately. Fetching one page of
  // "everything" and splitting it in memory meant that once 150 jobs were read, only 50 unread
  // ones were left in the page — the board would quietly shrink as you worked, for the wrong
  // reason.
  const [active, handled, companyOptions, contacts] = await Promise.all([
    listJobs(db, {
      companyId: params.company,
      query: params.q,
      relevantOnly,
      newOnly,
      // Always exclude what has been dealt with. Passing `readOnly: false` here filtered
      // nothing, so a job marked read stayed on the board greyed out *and* appeared in the
      // section below it — dimmed rather than moved, which is not what marking it read means.
      unreadOnly: true,
      sort,
      limit: 150,
    }) as unknown as Promise<JobRow[]>,
    listJobs(db, {
      companyId: params.company,
      query: params.q,
      relevantOnly,
      handledOnly: true,
      sort,
      limit: 60,
    }) as unknown as Promise<JobRow[]>,
    companiesWithJobs(db, relevantOnly),
    contactsByCompany(db),
  ]);

  // Grouped by company, each group ordered by fit. Company order is by its best role, so the
  // company most worth a referral ask today is at the top rather than whichever is alphabetically
  // first.
  const groups = new Map<string, { name: string; jobs: JobRow[] }>();
  for (const job of active) {
    const g = groups.get(job.companyId);
    if (g) g.jobs.push(job);
    else groups.set(job.companyId, { name: job.companyName, jobs: [job] });
  }
  // Ordered by each company's best role overall, not by what is left on the board. Sorting on
  // the remainder meant handling one job re-ranked its company mid-scroll.
  const bestFitByCompany = new Map(companyOptions.map((c) => [c.id, c.bestFit ?? 0]));
  // Within a company, honour the chosen sort. This used to re-sort by fit unconditionally, so
  // picking "Recently posted" changed the SQL order and then threw it away — the dropdown looked
  // broken because, in the grouped view, it was.
  const withinCompany = (a: JobRow, b: JobRow) => {
    if (sort === "posted") {
      // Undated postings sink rather than sorting as epoch zero or as "today".
      const at = a.postedAt?.getTime() ?? -Infinity;
      const bt = b.postedAt?.getTime() ?? -Infinity;
      return bt - at;
    }
    if (sort === "newest") return b.discoveredAt.getTime() - a.discoveredAt.getTime();
    return b.fitScore - a.fitScore;
  };

  const ordered = [...groups.entries()]
    .map(([id, g]) => ({
      id,
      name: g.name,
      jobs: [...g.jobs].sort(withinCompany),
    }))
    .sort(
      (a, b) =>
        (bestFitByCompany.get(b.id) ?? 0) - (bestFitByCompany.get(a.id) ?? 0) ||
        a.name.localeCompare(b.name),
    );

  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(
      Object.entries({ ...params, ...patch }).filter(([, v]) => v) as [string, string][],
    );
    const s = next.toString();
    return s ? `/jobs?${s}` : "/jobs";
  };

  const jobs = active;
  const untouchedTotal = active.filter((j) => !j.applicationStatus).length;
  const companyName = params.company ? jobs[0]?.companyName : undefined;
  const filtered = Boolean(
    params.company || params.q || newOnly || !relevantOnly,
  );

  const chip = (active: boolean) =>
    cx(
      "rounded-md border px-2.5 py-1 text-[13px] transition",
      active
        ? "border-accent bg-accent-soft text-accent-ink"
        : "border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink",
    );

  const outreachFor = (companyId: string) => ({
    contactCount: (contacts.get(companyId) ?? []).length,
  });

  return (
    <div>
      <PageHeader
        title="Jobs"
        subtitle={
          <>
            <span className="tnum text-ink">{untouchedTotal}</span> to review
            {handled.length > 0 && (
              <span className="text-ink-faint"> · {handled.length} handled</span>
            )}
            {companyName ? (
              <> at {companyName}</>
            ) : (
              <>
                {" "}
                across <span className="tnum text-ink">{ordered.length}</span>{" "}
                {ordered.length === 1 ? "company" : "companies"}
              </>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <CompanySearch
          companies={companyOptions}
          initialQuery={params.q ?? ""}
          hidden={Object.fromEntries(
            Object.entries({
              company: params.company,
              new: newOnly ? "1" : undefined,
              all: relevantOnly ? undefined : "1",
              sort: params.sort,
              flat: params.flat,
            }).filter(([, v]) => v) as [string, string][],
          )}
        />
        <form method="get" className="flex items-center gap-2">
          {params.company && <input type="hidden" name="company" value={params.company} />}
          {params.q && <input type="hidden" name="q" value={params.q} />}
          {newOnly && <input type="hidden" name="new" value="1" />}
          {!relevantOnly && <input type="hidden" name="all" value="1" />}
          {!grouped && <input type="hidden" name="flat" value="1" />}
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
          <button
            type="submit"
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink-dim transition hover:border-line-strong hover:text-ink"
          >
            Apply
          </button>
        </form>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={qs({ new: newOnly ? undefined : "1" })} className={chip(newOnly)}>
          New only
        </Link>
        <Link href={qs({ all: relevantOnly ? "1" : undefined })} className={chip(!relevantOnly)}>
          Include non-matching
        </Link>
        <Link href={qs({ flat: grouped ? "1" : undefined })} className={chip(!grouped)}>
          Flat list
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

      {/* Empty means empty *including* what has been handled. Testing only the active list
          claimed "Nothing here yet" for a company whose every role was read or tracked — the
          answer existed, one section further down, and the page said there was none. */}
      {active.length === 0 && handled.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body={
            relevantOnly
              ? "No roles match your rules right now. Try including non-matching roles to see everything that was crawled."
              : "No jobs have been discovered yet. The crawler runs twice a day."
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
      ) : grouped ? (
        <div className="space-y-3">
          {ordered.length === 0 && handled.length > 0 && (
            <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-dim">
              Everything here has been reviewed.
            </p>
          )}
          {ordered.map((g) => (
            <CompanyGroup
              key={g.id}
              companyId={g.id}
              companyName={g.name}
              jobs={g.jobs}
              outreach={outreachFor(g.id)}
              contactNames={(contacts.get(g.id) ?? []).map((c) => c.name)}
              // Already looking at one company? Then show everything it has.
              maxVisible={params.company ? undefined : 6}
            />
          ))}
          <ReadSection jobs={handled} defaultOpen={Boolean(params.company || params.q)} />
        </div>
      ) : (
        <div>
          <ul className="space-y-2">
            {active.map((job) => (
              <JobCard key={job.id} job={job} outreach={outreachFor(job.companyId)} />
            ))}
          </ul>
          <ReadSection jobs={handled} defaultOpen={Boolean(params.company || params.q)} />
        </div>
      )}
    </div>
  );
}
