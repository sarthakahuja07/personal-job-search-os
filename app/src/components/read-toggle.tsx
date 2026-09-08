"use client";

import { useTransition } from "react";

import { markCompanyRead, setJobRead } from "@/app/jobs/actions";
import { cx } from "./ui";

/**
 * Mark a job as read, or put it back.
 *
 * Always reversible and never destructive — the whole point is to let you clear a board you have
 * genuinely reviewed, which only works if getting it wrong costs one click. Hidden behind the
 * card's hover state so the row stays quiet until you are actually working through it.
 */
export function ReadToggle({ jobId, read }: { jobId: string; read: boolean }) {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => setJobRead(jobId, !read))}
      title={read ? "Mark as unread" : "Mark as read — seen and passed over"}
      className={cx(
        "rounded px-1.5 py-0.5 text-[11px] transition",
        read
          ? "text-ink-faint hover:text-ink-dim"
          : "text-ink-faint/70 hover:bg-surface-3 hover:text-ink-dim",
        pending && "opacity-50",
      )}
    >
      {read ? "Unread" : "Mark read"}
    </button>
  );
}

/**
 * Clear a whole company in one click.
 *
 * Reviewing happens per company — you scan Amazon's fourteen roles in one pass — so marking them
 * off one at a time is busywork the group header can absorb.
 */
export function MarkCompanyRead({
  companyId,
  unreadCount,
}: {
  companyId: string;
  unreadCount: number;
}) {
  const [pending, start] = useTransition();
  if (unreadCount === 0) return null;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => markCompanyRead(companyId))}
      title={`Mark all ${unreadCount} open roles here as read`}
      className={cx(
        "rounded px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-surface-3 hover:text-ink-dim",
        pending && "opacity-50",
      )}
    >
      Mark {unreadCount} read
    </button>
  );
}
