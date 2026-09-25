"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * A destructive text action behind a native confirm. Shared by "Reset progress" and "Delete
 * deck" -- this is a single-user app with a couple of destructive actions in the revision
 * feature, not worth a modal component for either.
 */
export function ConfirmButton({
  confirmMessage,
  action,
  label,
  pendingLabel,
  errorMessage,
  className,
}: {
  confirmMessage: string;
  action: () => Promise<void>;
  label: string;
  pendingLabel: string;
  errorMessage: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    if (!window.confirm(confirmMessage)) return;
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch {
        setError(errorMessage);
      }
    });
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={
          className ?? "text-[11.5px] text-ink-faint transition hover:text-danger disabled:opacity-50"
        }
      >
        {pending ? pendingLabel : label}
      </button>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
