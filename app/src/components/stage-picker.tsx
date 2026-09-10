"use client";

import { useTransition } from "react";

import { addToPipeline, removeCardForJob } from "@/app/applications/actions";
import { STAGES, STAGE_LABEL } from "@/server/domain/applications";
import type { ApplicationStatus } from "@/db/schema";
import { cx } from "./ui";

/**
 * Move a job through the pipeline without leaving the board it was found on.
 *
 * Deciding "I'll ask for a referral" happens while reading the job, not later on a separate
 * screen — and a step that costs a page change is a step that gets skipped, which is how a
 * pipeline stops matching reality. Selecting a stage creates the application if there is none.
 */
export function StagePicker({
  jobId,
  companyId,
  status,
}: {
  jobId: string;
  companyId: string;
  status: ApplicationStatus | null;
}) {
  const [pending, start] = useTransition();

  return (
    <select
      value={status ?? ""}
      disabled={pending}
      aria-label="Application stage"
      onChange={(e) => {
        const next = e.target.value;
        start(async () => {
          // The empty option is "not in the pipeline", so choosing it takes the job back out
          // rather than silently doing nothing.
          if (!next) await removeCardForJob(jobId);
          else await addToPipeline(jobId, companyId, next);
        });
      }}
      className={cx(
        "rounded border px-1.5 py-1 text-[11px] font-medium outline-none transition",
        status
          ? "border-accent/40 bg-accent-soft text-accent-ink"
          : "border-line bg-surface-2 text-ink-faint hover:border-line-strong hover:text-ink-dim",
        pending && "opacity-50",
      )}
    >
      <option value="" className="bg-surface-2">
        {status ? "Remove from pipeline" : "+ Track"}
      </option>
      {STAGES.map((s) => (
        <option key={s} value={s} className="bg-surface-2">
          {STAGE_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
