"use client";

import { ConfirmButton } from "./confirm-button";
import { resetRevisionProgress } from "./actions";

export function ResetDeckButton({ deckId, deckTitle }: { deckId: string[]; deckTitle: string }) {
  return (
    <ConfirmButton
      title="Reset progress?"
      confirmMessage={`Forget all progress for "${deckTitle}"? This cannot be undone.`}
      action={() => resetRevisionProgress(deckId)}
      label="Reset progress"
      pendingLabel="Resetting…"
      errorMessage="Could not reset progress."
    />
  );
}
