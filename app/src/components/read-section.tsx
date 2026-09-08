import Link from "next/link";

import { Collapsible } from "./collapsible";
import { CopyLink } from "./copy-link";
import { daysSince, type JobRow } from "./job-card";
import { ReadToggle } from "./read-toggle";
import { cx } from "./ui";

/**
 * Jobs already dealt with — read, or tracked in the pipeline — folded away.
 *
 * They are not deleted and not hidden, they are demoted. Leaving them on the main board greyed
 * out meant the list never got shorter however much you worked through it, which is the opposite
 * of what marking something read is for; removing them outright would make a misclick
 * unrecoverable. One compact line each, collapsed until asked for.
 *
 * Tracking counts as dealt with too: putting a job on the kanban is a stronger statement than
 * reading it, so it should leave the "still to decide" list just as firmly.
 */
export function ReadSection({
  jobs,
  defaultOpen = false,
}: {
  jobs: JobRow[];
  /**
   * Open when the view is already filtered.
   *
   * Searching a company whose roles are all handled otherwise returned a page that looked
   * empty — the answer was present but folded, which is indistinguishable from no answer.
   */
  defaultOpen?: boolean;
}) {
  if (jobs.length === 0) return null;
  const tracked = jobs.filter((j) => j.applicationStatus).length;

  return (
    <section className="mt-4 rounded-card border border-line/60 bg-surface-2/20">
      <Collapsible
        label={`${jobs.length} handled jobs`}
        defaultOpen={defaultOpen}
        header={
          <header className="flex flex-wrap items-center gap-2 py-2.5 pr-4">
            <span className="text-[13px] font-medium text-ink-dim">Handled</span>
            <span className="tnum text-[12px] text-ink-faint">{jobs.length}</span>
            <span className="text-[11px] text-ink-faint">
              · read or tracked
              {tracked > 0 && ` · ${tracked} in the pipeline`}
            </span>
          </header>
        }
      >
        <ul className="divide-y divide-line/50 border-t border-line/50">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex items-center gap-3 px-3 py-1.5 text-[12px]"
            >
              <span
                className={cx(
                  "tnum w-8 shrink-0 text-right text-[11px]",
                  job.fitScore >= 80 ? "text-fresh/70" : "text-ink-faint",
                )}
              >
                {job.fitScore}
              </span>
              <Link
                href={`/jobs/${job.id}`}
                className="min-w-0 flex-1 truncate text-ink-dim transition hover:text-ink"
              >
                {job.title}
              </Link>
              <Link
                href={`/jobs?company=${job.companyId}`}
                className="hidden w-32 shrink-0 truncate text-[11px] text-ink-faint transition hover:text-ink-dim sm:block"
              >
                {job.companyName}
              </Link>
              {(() => {
                const d = daysSince(job.postedAt);
                return d === null ? null : (
                  <span className="hidden w-20 shrink-0 text-[11px] text-ink-faint sm:block">
                    {d === 0 ? "today" : `${d}d ago`}
                  </span>
                );
              })()}
              {job.applicationStatus && (
                <span className="shrink-0 rounded border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent-ink">
                  {job.applicationStatus}
                </span>
              )}
              <a
                href={job.jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-[11px] text-ink-faint transition hover:text-ink-dim"
              >
                ↗
              </a>
              <CopyLink url={job.jobUrl} compact />
              <ReadToggle jobId={job.id} read />
            </li>
          ))}
        </ul>
      </Collapsible>
    </section>
  );
}
