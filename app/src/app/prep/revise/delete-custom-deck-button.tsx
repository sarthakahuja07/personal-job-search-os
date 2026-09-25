"use client";

import { ConfirmButton } from "./confirm-button";
import { deleteCustomDeckAction } from "./actions";

export function DeleteCustomDeckButton({ id, deckTitle }: { id: string; deckTitle: string }) {
  return (
    <ConfirmButton
      confirmMessage={`Delete the deck "${deckTitle}"? Its progress is deleted with it. This cannot be undone.`}
      action={() => deleteCustomDeckAction(id)}
      label="Delete deck"
      pendingLabel="Deleting…"
      errorMessage="Could not delete deck."
    />
  );
}
