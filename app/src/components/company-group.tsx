import Link from "next/link";

import { isRecent, JobCard, type JobRow, type OutreachProps } from "./job-card";
import { Badge, cx } from "./ui";

/**
 * One company, its openings, and the people who can refer you into it.
 *
 * Grouping matters because a referral is asked per company, not per job: three Amazon roles are
 * one conversation with one contact, and a flat list scatters them among sixty others. The
 * header carries the contacts for exactly that reason.
 *
 * Jobs are ordered by fit inside each group, so the best role at each company is the one you
 * read first.
 */
export function CompanyGroup({
  companyId,
  companyName,
  jobs,
  outreach,
  contactNames,
}: {
  companyId: string;
  companyName: string;
  jobs: JobRow[];
  outreach?: OutreachProps;
  contactNames: string[];
}) {
  const best = jobs[0]?.fitScore ?? 0;
  const newCount = jobs.filter((j) => isRecent(j.discoveredAt)).length;

  return (
    <section className="rounded-card border border-line bg-surface-2/40">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            href={`/companies/${companyId}`}
            className="text-[14px] font-semibold text-ink transition hover:text-accent-ink"
          >
            {companyName}
          </Link>
          <span className="tnum text-[12px] text-ink-faint">
            {jobs.length} open
          </span>
          {newCount > 0 && <Badge tone="fresh">{newCount} new</Badge>}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-ink-faint">
          {contactNames.length > 0 ? (
            <span className="truncate">
              Referral: <span className="text-ink-dim">{contactNames.join(", ")}</span>
            </span>
          ) : (
            <Link
              href={`/companies/${companyId}`}
              className="underline-offset-2 transition hover:text-ink-dim hover:underline"
            >
              + add a referral contact
            </Link>
          )}
          <span className={cx("tnum", best >= 80 ? "text-fresh" : "text-ink-faint")}>
            best {best}
          </span>
        </div>
      </header>

      <ul className="space-y-1.5 px-1.5 pb-1.5">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} outreach={outreach} />
        ))}
      </ul>
    </section>
  );
}
