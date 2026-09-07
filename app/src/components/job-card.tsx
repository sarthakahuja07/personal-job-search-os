import Link from "next/link";

import { Badge, cx } from "./ui";

const LOCATION_LABEL: Record<number, string> = {
  1: "Bangalore",
  2: "Gurgaon",
  3: "Remote",
  4: "Hyderabad",
};

const NEW_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

function daysAgo(date: Date | null): string | null {
  if (!date) return null;
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export type JobRow = {
  id: string;
  title: string;
  location: string | null;
  jobUrl: string;
  postedAt: Date | null;
  discoveredAt: Date;
  matchScore: number;
  matchReason: string | null;
  locationPriority: number | null;
  companyName: string;
  companyId: string;
  applicationStatus: string | null;
};

/** Score bands, not a raw gradient: 130+ is "drop what you are doing", 100+ is a solid level
 *  match, below that is worth a look. Three states are readable at a glance; a continuous
 *  colour ramp is not. */
function scoreTone(score: number): "fresh" | "accent" | "neutral" {
  if (score >= 130) return "fresh";
  if (score >= 100) return "accent";
  return "neutral";
}

export function JobCard({ job }: { job: JobRow }) {
  const isNew = Date.now() - job.discoveredAt.getTime() < NEW_WINDOW_MS;
  const posted = daysAgo(job.postedAt);
  const found = daysAgo(job.discoveredAt);
  const tone = scoreTone(job.matchScore);

  return (
    <li className="group rounded-card border border-line bg-surface transition hover:border-line-strong">
      <div className="flex items-stretch">
        {/* A quiet score rail. Colour carries the ranking so the eye can skip the number. */}
        <div
          className={cx(
            "w-0.5 shrink-0 rounded-l-card",
            tone === "fresh"
              ? "bg-fresh"
              : tone === "accent"
                ? "bg-accent"
                : "bg-line-strong",
          )}
          aria-hidden
        />

        <div className="min-w-0 flex-1 px-4 py-3.5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/jobs/${job.id}`}
                  className="truncate text-[15px] font-medium text-ink underline-offset-4 hover:text-accent-ink hover:underline"
                >
                  {job.title}
                </Link>
                {isNew && <Badge tone="fresh">New</Badge>}
                {job.applicationStatus && (
                  <Badge tone="accent">{job.applicationStatus}</Badge>
                )}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-dim">
                <Link
                  href={`/jobs?company=${job.companyId}`}
                  className="font-medium text-ink-dim transition hover:text-ink"
                >
                  {job.companyName}
                </Link>
                {job.location && (
                  <>
                    <span className="text-ink-faint">·</span>
                    <span className="truncate">{job.location}</span>
                  </>
                )}
                {job.locationPriority && (
                  <Badge>{LOCATION_LABEL[job.locationPriority] ?? "Match"}</Badge>
                )}
              </div>
            </div>

            <div className="shrink-0 text-right">
              <div
                className={cx(
                  "tnum text-[15px] font-semibold",
                  tone === "fresh"
                    ? "text-fresh"
                    : tone === "accent"
                      ? "text-accent-ink"
                      : "text-ink-dim",
                )}
              >
                {job.matchScore}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-ink-faint">
                match
              </div>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
            <a
              href={job.jobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-faint underline-offset-2 transition hover:text-ink-dim hover:underline"
            >
              Original ↗
            </a>
            {posted && <span>Posted {posted}</span>}
            {found && <span>Found {found}</span>}
            {/* Every match explains itself, so filtering is never a black box. */}
            {job.matchReason && (
              <span className="min-w-0 truncate text-ink-faint/80">
                {job.matchReason}
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
