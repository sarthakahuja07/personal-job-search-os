import Link from "next/link";

import type { FitBand, FitSignal } from "@/server/domain/fit";
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
  fitScore: number;
  fitBand: FitBand | null;
  fitSignals: FitSignal[] | null;
  fitTitleOnly?: boolean;
  companyName: string;
  companyId: string;
  applicationStatus: string | null;
};

/**
 * Five bands, each with its own colour. Fit is the number the eye should land on, so it gets the
 * rail, the meter and the headline figure; the gate score (matchScore) moves to the footer where
 * it belongs — it decides whether a job is shown at all, which is not a ranking question.
 */
const BAND: Record<
  FitBand,
  { label: string; text: string; rail: string; meter: string; chip: string }
> = {
  excellent: {
    label: "Excellent",
    text: "text-fresh",
    rail: "bg-fresh",
    meter: "bg-fresh",
    chip: "bg-fresh-soft text-fresh",
  },
  strong: {
    label: "Strong",
    text: "text-accent-ink",
    rail: "bg-accent",
    meter: "bg-accent",
    chip: "bg-accent-soft text-accent-ink",
  },
  good: {
    label: "Good",
    text: "text-accent-ink",
    rail: "bg-accent/60",
    meter: "bg-accent/70",
    chip: "bg-accent-soft/70 text-accent-ink",
  },
  fair: {
    label: "Fair",
    text: "text-ink-dim",
    rail: "bg-line-strong",
    meter: "bg-line-strong",
    chip: "bg-surface-3 text-ink-dim",
  },
  weak: {
    label: "Weak",
    text: "text-ink-faint",
    rail: "bg-line",
    meter: "bg-line",
    chip: "bg-surface-3 text-ink-faint",
  },
};

/** Older rows scored before fit existed have no band; treat them as unranked rather than weak. */
function bandOf(job: JobRow) {
  return job.fitBand ? BAND[job.fitBand] : BAND.fair;
}

export function JobCard({ job }: { job: JobRow }) {
  const isNew = Date.now() - job.discoveredAt.getTime() < NEW_WINDOW_MS;
  const posted = daysAgo(job.postedAt);
  const found = daysAgo(job.discoveredAt);
  const band = bandOf(job);

  // The two or three signals that earned the most points. Showing every signal turns the card
  // into a table; showing none turns the score into an oracle.
  const signals = (job.fitSignals ?? []).filter((s) => s.points > 0).slice(0, 3);

  return (
    <li className="group rounded-card border border-line bg-surface transition hover:border-line-strong">
      <div className="flex items-stretch">
        {/* Fit carries the colour, so the eye can rank the list without reading a number. */}
        <div className={cx("w-0.5 shrink-0 rounded-l-card", band.rail)} aria-hidden />

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

              {/* Why this scored what it did. Each chip is one signal, so the number is never
                  something the reader has to take on faith. */}
              {signals.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {signals.map((s) => (
                    <span
                      key={`${s.dimension}-${s.label}`}
                      title={`${s.detail} (+${s.points})`}
                      className={cx(
                        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-4",
                        band.chip,
                      )}
                    >
                      {s.label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* The fit read-out: figure, band, and a meter so the number has a scale. */}
            <div className="shrink-0 text-right">
              <div className={cx("tnum text-[19px] font-semibold leading-6", band.text)}>
                {job.fitScore}
              </div>
              <div
                className={cx(
                  "text-[10px] font-medium uppercase tracking-wide",
                  band.text,
                )}
              >
                {band.label}
              </div>
              <div
                className="mt-1.5 h-1 w-14 overflow-hidden rounded-full bg-surface-3"
                role="img"
                aria-label={`Fit ${job.fitScore} out of 100 — ${band.label} match`}
              >
                <div
                  className={cx("h-full rounded-full", band.meter)}
                  style={{ width: `${Math.max(3, Math.min(100, job.fitScore))}%` }}
                />
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
            {/* "We could not assess this" and "this is a poor match" are different statements,
                and a score alone cannot tell them apart. Apple, Microsoft and Rippling publish
                no description on their list endpoints, so their scores rest on the title. */}
            {job.fitTitleOnly && (
              <span
                className="text-ink-faint/70"
                title="This source publishes no description on its listing, so the score is based on the title, location and date alone."
              >
                title only
              </span>
            )}
            {job.matchReason && (
              <span className="min-w-0 truncate text-ink-faint/80">{job.matchReason}</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
