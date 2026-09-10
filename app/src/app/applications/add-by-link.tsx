"use client";

import { useRef, useState, useTransition } from "react";

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
  const [message, setMessage] = useState<string | null>(null);
  const [newCompany, setNewCompany] = useState(false);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 rounded-control border border-line bg-surface-2 px-2.5 py-1.5 text-body text-ink-dim transition hover:border-line-strong hover:text-ink"
      >
        + Add a job by link
      </button>
    );
  }

  return (
    <Card className="mb-4 px-4 py-3.5">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <p className="text-body font-medium text-ink">Add a job by link</p>
          <p className="mt-0.5 text-label text-ink-faint">
            For roles the crawler did not find. It joins the board, the job list and the
            reminders like any other.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-section leading-none text-ink-faint transition hover:text-ink"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* The form stays open and clears itself after a successful add. Closing it hid the
          result, which made a working add indistinguishable from a silent failure — and
          adding two roles at one company is the normal case, not the exception. */}
      <form
        ref={formRef}
        action={(data) =>
          start(async () => {
            const result = await addJobByLink(data);
            if (result?.error) {
              setError(result.error);
              setMessage(null);
            } else {
              setError(null);
              setMessage(result?.message ?? "Added.");
              formRef.current?.reset();
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
            // Prefilled with the target role and city: nearly every link pasted here is one of
            // these, and typing them again each time is the kind of friction that stops a
            // tracker being used at all. Both stay editable.
            defaultValue="Software Engineer 2"
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
              className="rounded-control border border-line bg-canvas px-2.5 py-1.5 text-body text-ink outline-none focus:border-line-strong"
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
            className="rounded-control px-1.5 text-label text-ink-faint transition hover:text-ink-dim"
          >
            {newCompany ? "pick existing" : "+ new company"}
          </button>

          <input
            name="location"
            defaultValue="Bangalore"
            placeholder="Location"
            className={cx(inputStyles, "w-44")}
          />

          <select
            name="stage"
            defaultValue="saved"
            className="rounded-control border border-line bg-canvas px-2.5 py-1.5 text-body text-ink outline-none focus:border-line-strong"
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

        {error && <p className="text-meta text-danger">{error}</p>}
        {message && !error && (
          <p className="text-meta text-fresh">{message}</p>
        )}
      </form>
    </Card>
  );
}
