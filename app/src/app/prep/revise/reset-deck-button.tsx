"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { resetRevisionProgress } from "./actions";

/**
 * Forgets every card in a deck. A native confirm is enough here: this is a single-user app with
 * one destructive action in the whole revision feature, not worth a modal component for.
 */
export function ResetDeckButton({ deckId, deckTitle }: { deckId: string[]; deckTitle: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    if (!window.confirm(`Forget all progress for "${deckTitle}"? This cannot be undone.`)) return;
    startTransition(async () => {
      try {
        await resetRevisionProgress(deckId);
        router.refresh();
      } catch {
        setError("Could not reset progress.");
      }
    });
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-[11.5px] text-ink-faint transition hover:text-danger disabled:opacity-50"
      >
        {pending ? "Resetting…" : "Reset progress"}
      </button>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
