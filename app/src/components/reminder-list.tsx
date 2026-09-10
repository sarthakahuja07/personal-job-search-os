import Link from "next/link";

import { KIND_LABEL, type Reminder } from "@/server/domain/reminders";
import { DismissReminder } from "./dismiss-reminder";
import { Badge, cx } from "./ui";

function whenever(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;
  return `${Math.floor(days / 30)}mo`;
}

/**
 * Reminders as a list of things to do, not a list of things that are wrong.
 *
 * Each row states the action first and the evidence second, because the point is to be acted on
 * in a few seconds. The waiting time is always shown: a nudge that cannot say how long something
 * has been sitting is indistinguishable from nagging, and gets ignored at the same rate.
 */
export function ReminderList({
  reminders,
  limit,
}: {
  reminders: Reminder[];
  limit?: number;
}) {
  const shown = limit ? reminders.slice(0, limit) : reminders;

  return (
    <ul className="space-y-1.5">
      {shown.map((r) => (
        <li
          key={`${r.jobId}-${r.kind}`}
          className={cx(
            "flex items-start gap-3 rounded-card border bg-surface px-3.5 py-2.5",
            r.severity === "overdue" ? "border-warn/40" : "border-line",
          )}
        >
          <div
            className={cx(
              "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
              r.severity === "overdue" ? "bg-warn" : "bg-accent",
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body font-medium text-ink">{r.action}</span>
              <Badge tone={r.severity === "overdue" ? "warn" : "neutral"}>
                {KIND_LABEL[r.kind]}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-meta text-ink-dim">
              <Link
                href={`/jobs/${r.jobId}`}
                className="underline-offset-2 transition hover:text-ink hover:underline"
              >
                {r.jobTitle}
              </Link>
              <span className="text-ink-faint"> · </span>
              <Link
                href={`/companies/${r.companyId}`}
                className="underline-offset-2 transition hover:text-ink hover:underline"
              >
                {r.companyName}
              </Link>
            </p>
            <p className="mt-0.5 text-label text-ink-faint">{r.detail}</p>
          </div>
          <DismissReminder jobId={r.jobId} kind={r.kind} />
          <div className="shrink-0 text-right">
            <div
              className={cx(
                "tnum text-body font-semibold",
                r.severity === "overdue" ? "text-warn" : "text-ink-dim",
              )}
            >
              {whenever(r.daysWaiting)}
            </div>
            <div className="text-label uppercase tracking-wide text-ink-faint">waiting</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
