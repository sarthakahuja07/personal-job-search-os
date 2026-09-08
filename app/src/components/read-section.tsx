import Link from "next/link";

import { Collapsible } from "./collapsible";
import type { JobRow } from "./job-card";
import { ReadToggle } from "./read-toggle";
import { cx } from "./ui";

/**
 * Jobs already reviewed, folded away.
 *
 * Read jobs are not deleted and not hidden — they are demoted. Keeping them on the main board
 * greyed out meant the list never got shorter however much you worked through it, which is the
 * opposite of what marking something read is for; removing them outright would make a misclick
 * unrecoverable. One compact line each, collapsed until asked for.
 */
export function ReadSection({ jobs }: { jobs: JobRow[] }) {
  if (jobs.length === 0) return null;

  return (
    <section className="mt-4 rounded-card border border-line/60 bg-surface-2/20">
      <Collapsible
        label={`${jobs.length} reviewed jobs`}
        defaultOpen={false}
        header={
          <header className="flex flex-wrap items-center gap-2 py-2.5 pr-4">
            <span className="text-[13px] font-medium text-ink-dim">Reviewed</span>
            <span className="tnum text-[12px] text-ink-faint">{jobs.length}</span>
            <span className="text-[11px] text-ink-faint">
              · seen and passed over
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
              <a
                href={job.jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-[11px] text-ink-faint transition hover:text-ink-dim"
              >
                ↗
              </a>
              <ReadToggle jobId={job.id} read />
            </li>
          ))}
        </ul>
      </Collapsible>
    </section>
  );
}
