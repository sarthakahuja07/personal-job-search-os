"use client";

import { useState, useTransition } from "react";

import { Button, Card, cx, inputStyles } from "@/components/ui";
import { STAGES, STAGE_LABEL } from "@/server/domain/applications";
import { addJobByLink } from "./actions";

export type CompanyChoice = { id: string; name: string };

/**
 * Track a job the crawler never saw — a link from a friend, a recruiter, or a company that is
 * not on the list at all.
 *
 * Collapsed until asked for: this is the exception, and the board should open showing the
 * pipeline rather than a form. Once added, the job is ordinary — it appears on the job board,
 * gets a fit score, and becomes eligible for reminders like any crawled role.
 */
export function AddByLink({ companies }: { companies: CompanyChoice[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCompany, setNewCompany] = useState(false);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink-dim transition hover:border-line-strong hover:text-ink"
      >
        + Add a job by link
      </button>
    );
  }

  return (
    <Card className="mb-4 px-4 py-3.5">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-ink">Add a job by link</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            For roles the crawler did not find. It joins the board, the job list and the
            reminders like any other.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[16px] leading-none text-ink-faint transition hover:text-ink"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <form
        action={(data) =>
          start(async () => {
            const result = await addJobByLink(data);
            if (result?.error) setError(result.error);
            else {
              setError(null);
              setOpen(false);
            }
          })
        }
        className="space-y-2"
      >
        <div className="flex flex-wrap gap-2">
          <input
            name="jobUrl"
            type="url"
            required
            placeholder="https://…  the job posting link"
            className={cx(inputStyles, "min-w-72 flex-1")}
          />
          <input
            name="title"
            required
            placeholder="Role title"
            className={cx(inputStyles, "w-56")}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {newCompany ? (
            <input
              name="companyName"
              required
              placeholder="New company name"
              className={cx(inputStyles, "w-52")}
            />
          ) : (
            <select
              name="companyId"
              required
              defaultValue=""
              className="rounded border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-line-strong"
            >
              <option value="" disabled>
                Company…
              </option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setNewCompany((v) => !v)}
            className="rounded px-1.5 text-[11px] text-ink-faint transition hover:text-ink-dim"
          >
            {newCompany ? "pick existing" : "+ new company"}
          </button>

          <input
            name="location"
            placeholder="Location (optional)"
            className={cx(inputStyles, "w-44")}
          />

          <select
            name="stage"
            defaultValue="saved"
            className="rounded border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-line-strong"
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>

          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Adding…" : "Add to board"}
          </Button>
        </div>

        {error && <p className="text-[12px] text-danger">{error}</p>}
      </form>
    </Card>
  );
}
