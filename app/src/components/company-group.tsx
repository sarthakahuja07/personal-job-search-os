import Link from "next/link";

import { Collapsible } from "./collapsible";
import { isRecent, JobCard, type JobRow, type OutreachProps } from "./job-card";
import { MarkCompanyRead } from "./read-toggle";
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
  defaultOpen,
  maxVisible,
}: {
  companyId: string;
  companyName: string;
  jobs: JobRow[];
  outreach?: OutreachProps;
  contactNames: string[];
  /** Overrides the default, which collapses a company you have already worked through. */
  defaultOpen?: boolean;
  /**
   * Cards to render before linking out to the company's own view.
   *
   * Amazon alone accounts for 163 of ~200 open matches, and every rendered card is markup React
   * has to serialise into the page — 200 of them was 875 KB of flight payload and the reason
   * changing tabs felt slow. Showing the best few and linking to the rest keeps the board a
   * summary, which is what it is for.
   */
  maxVisible?: number;
}) {
  const best = jobs[0]?.fitScore ?? 0;
  const newCount = jobs.filter((j) => isRecent(j.discoveredAt)).length;
  // Untouched: neither read nor in the pipeline. This is the number that says whether the
  // company still needs your attention, so it leads and the total follows.
  const untouched = jobs.filter((j) => !j.readAt && !j.applicationStatus).length;
  const shown = maxVisible ? jobs.slice(0, maxVisible) : jobs;
  const hidden = jobs.length - shown.length;

  return (
    <section
      className={cx(
        "rounded-card border transition",
        untouched === 0 ? "border-line/50 bg-surface-2/20" : "border-line bg-surface-2/40",
      )}
    >
      <Collapsible
        label={companyName}
        // A company with nothing left to review folds away by default. That is the whole point
        // of tracking read state: the board should shrink as you work through it, not stay the
        // same size while going grey.
        defaultOpen={defaultOpen ?? untouched > 0}
        header={
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2.5 pr-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            href={`/companies/${companyId}`}
            className="text-[14px] font-semibold text-ink transition hover:text-accent-ink"
          >
            {companyName}
          </Link>
          <span className="tnum text-[12px] text-ink-faint">
            {untouched > 0 ? (
              <>
                <span className="text-ink-dim">{untouched}</span> to review
                {untouched !== jobs.length && ` · ${jobs.length} open`}
              </>
            ) : (
              <>{jobs.length} open · all reviewed</>
            )}
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
          <MarkCompanyRead companyId={companyId} unreadCount={untouched} />
        </div>
          </header>
        }
      >
        <ul className="space-y-1.5 px-1.5 pb-1.5">
          {shown.map((job) => (
            <JobCard key={job.id} job={job} outreach={outreach} />
          ))}
          {hidden > 0 && (
            <li>
              <Link
                href={`/jobs?company=${companyId}`}
                className="block rounded-md border border-dashed border-line px-3 py-2 text-center text-[12px] text-ink-dim transition hover:border-line-strong hover:text-ink"
              >
                View all {jobs.length} at {companyName} →
              </Link>
            </li>
          )}
        </ul>
      </Collapsible>
    </section>
  );
}
