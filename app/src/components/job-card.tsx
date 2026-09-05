import Link from "next/link";

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
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
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

export function JobCard({ job }: { job: JobRow }) {
  const isNew = Date.now() - job.discoveredAt.getTime() < NEW_WINDOW_MS;
  const posted = daysAgo(job.postedAt);
  const found = daysAgo(job.discoveredAt);

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-4 transition hover:border-neutral-300">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {isNew && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                New
              </span>
            )}
            <a
              href={job.jobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate font-medium text-neutral-900 underline-offset-2 hover:underline"
            >
              {job.title}
            </a>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-600">
            <Link
              href={`/jobs?company=${job.companyId}`}
              className="font-medium text-neutral-700 hover:underline"
            >
              {job.companyName}
            </Link>
            {job.location && <span>· {job.location}</span>}
            {job.locationPriority && (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-700">
                {LOCATION_LABEL[job.locationPriority] ?? "Match"}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums text-neutral-800">
            {job.matchScore}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-400">score</div>
        </div>
      </div>

      {/* Every match explains itself, so filtering is never a black box. */}
      {job.matchReason && (
        <p className="mt-2 text-xs text-neutral-500">{job.matchReason}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-neutral-400">
        {posted && <span>Posted {posted}</span>}
        {found && <span>Found {found}</span>}
        {job.applicationStatus && (
          <span className="font-medium text-neutral-600">
            In pipeline: {job.applicationStatus}
          </span>
        )}
      </div>
    </li>
  );
}
