import Link from "next/link";

import type { ApplicationStatus } from "@/db/schema";
import type { FitBand, FitSignal } from "@/server/domain/fit";
import { CopyLink } from "./copy-link";
import { JobActions } from "./job-actions";
import { ReadToggle } from "./read-toggle";
import { StagePicker } from "./stage-picker";
import { Badge, cx } from "./ui";

const LOCATION_LABEL: Record<number, string> = {
  1: "Bangalore",
  2: "Gurgaon",
  3: "Remote",
  4: "Hyderabad",
};

const NEW_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** Kept at module scope alongside daysAgo: reading the clock inside a component body is a
 *  render-time side effect, and these cards are rendered per request on the server. */
export function isRecent(date: Date, windowMs: number = NEW_WINDOW_MS): boolean {
  return Date.now() - date.getTime() < windowMs;
}

/** Whole days since a date. Module scope for the same reason as isRecent: reading the clock in
 *  a component body is a render-time side effect. */
export function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

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
  readAt?: Date | null;
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

/**
 * Only how many contacts exist, never the contacts themselves.
 *
 * The modal is a client component, so anything handed to it here is serialised once per card.
 * A count is a number; the contact list and every template body was 1.8 MB across a full board.
 */
export type OutreachProps = { contactCount: number };

export function JobCard({
  job,
  outreach,
}: {
  job: JobRow;
  outreach?: OutreachProps;
}) {
  const isNew = isRecent(job.discoveredAt);
  const found = daysAgo(job.discoveredAt);
  // Days since the *employer* published it, which is not the same as when we found it. This is
  // the number that decides whether a referral is still worth asking for: the whole project
  // exists to reach a posting before it is flooded, and a role published seven weeks ago is a
  // different proposition from one published yesterday at an identical fit score.
  const postedDays = daysSince(job.postedAt);
  const band = bandOf(job);

  // Interacted: either it is in the pipeline, or it was read and consciously passed over. Both
  // mean "already considered", which is the distinction the board needs to make -- otherwise the
  // same fifty roles read as new every morning and the three that arrived overnight do not stand
  // out. Dimmed rather than hidden, and restored on hover, because passing on a job is a
  // judgement that should stay easy to revisit.
  const interacted = Boolean(job.applicationStatus || job.readAt);
  const isRead = Boolean(job.readAt) && !job.applicationStatus;

  // The two or three signals that earned the most points. Showing every signal turns the card
  // into a table; showing none turns the score into an oracle.
  const signals = (job.fitSignals ?? []).filter((s) => s.points > 0).slice(0, 3);

  return (
    <li
      className={cx(
        "group rounded-card border transition",
        interacted
          ? "border-line/60 bg-surface/40 opacity-60 hover:opacity-100 hover:border-line"
          : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <div className="flex items-stretch">
        {/* Fit carries the colour, so the eye can rank the list without reading a number. */}
        <div
          className={cx(
            "w-0.5 shrink-0 rounded-l-card",
            interacted ? "bg-line-strong" : band.rail,
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
                {isNew && !interacted && <Badge tone="fresh">New</Badge>}
                {job.applicationStatus && (
                  <Badge tone="accent">{job.applicationStatus}</Badge>
                )}
                {isRead && <Badge>Read</Badge>}
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
                <span className="text-ink-faint">·</span>
                {postedDays === null ? (
                  // Rippling and DE Shaw publish no date at all. Saying so is better than
                  // implying the job is new, or leaving a gap that reads as one.
                  <span
                    className="text-[12px] text-ink-faint"
                    title="This board does not publish a posting date"
                  >
                    posted date unknown
                  </span>
                ) : (
                  <span
                    className={cx(
                      "text-[12px]",
                      postedDays <= 7
                        ? "text-fresh"
                        : postedDays <= 30
                          ? "text-ink-dim"
                          : "text-ink-faint",
                    )}
                    title={`Published by the employer on ${job.postedAt?.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`}
                  >
                    Posted {postedDays === 0 ? "today" : `${postedDays}d ago`}
                  </span>
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
            {outreach ? (
              <JobActions
                jobTitle={job.title}
                jobUrl={job.jobUrl}
                companyName={job.companyName}
                companyId={job.companyId}
                contactCount={outreach.contactCount}
              />
            ) : (
              <a
                href={job.jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink-faint underline-offset-2 transition hover:text-ink-dim hover:underline"
              >
                Original ↗
              </a>
            )}
            <CopyLink url={job.jobUrl} />
            <StagePicker
              jobId={job.id}
              companyId={job.companyId}
              status={(job.applicationStatus as ApplicationStatus | null) ?? null}
            />
            <ReadToggle jobId={job.id} read={Boolean(job.readAt)} />
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
