"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { cx } from "@/components/ui";

/**
 * A destructive text action behind an in-app confirm dialog.
 *
 * `window.confirm` used to gate this instead: it silently does nothing in an iOS home-screen
 * (standalone) PWA -- Safari drops native JS dialogs in that mode -- so tapping "Reset progress"
 * on an iPhone with this app added to the home screen did nothing at all. A real modal has no
 * such gap, and matches the dialog already used for the outreach modal (`job-actions.tsx`).
 */
export function ConfirmButton({
  title,
  confirmMessage,
  action,
  label,
  pendingLabel,
  errorMessage,
  className,
}: {
  title: string;
  confirmMessage: string;
  action: () => Promise<void>;
  label: string;
  pendingLabel: string;
  errorMessage: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pending && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending]);

  const confirm = () => {
    startTransition(async () => {
      try {
        await action();
        setOpen(false);
        router.refresh();
      } catch {
        setError(errorMessage);
      }
    });
  };

  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className={
            className ?? "text-[11.5px] text-ink-faint transition hover:text-danger"
          }
        >
          {label}
        </button>
        {error && <span className="text-[11px] text-danger">{error}</span>}
      </span>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.target === e.currentTarget && !pending && setOpen(false)}
        >
          <div className="w-full max-w-sm rounded-card border border-line bg-surface p-4 shadow-xl">
            <p className="text-[14px] font-medium text-ink">{title}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">{confirmMessage}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] text-ink-dim transition hover:border-line-strong hover:text-ink disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className={cx(
                  "rounded-md bg-danger px-3 py-1.5 text-[13px] font-medium text-canvas transition hover:brightness-110",
                  pending && "opacity-70",
                )}
              >
                {pending ? pendingLabel : label}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
