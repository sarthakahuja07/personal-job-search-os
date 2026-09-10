"use client";

import { useTransition } from "react";

import { dismissReminder } from "@/app/reminders/actions";
import { cx } from "./ui";

/**
 * Close a reminder.
 *
 * "Not now", not "never" — the dismissal is compared against the moment the reminder's clock
 * started, so if the job later moves stage the reminder legitimately returns. That is what makes
 * closing safe: one click can quiet today's nudge but cannot permanently bury a situation that
 * has since changed.
 */
export function DismissReminder({ jobId, kind }: { jobId: string; kind: string }) {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => dismissReminder(jobId, kind))}
      title="Close this reminder — it comes back if the job moves stage"
      aria-label="Close this reminder"
      className={cx(
        "shrink-0 rounded px-1.5 py-0.5 text-[13px] leading-none text-ink-faint transition hover:bg-surface-3 hover:text-ink-dim",
        pending && "opacity-50",
      )}
    >
      ×
    </button>
  );
}
