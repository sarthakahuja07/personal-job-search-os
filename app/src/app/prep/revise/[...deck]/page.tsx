import { notFound } from "next/navigation";

import { RevisionSession } from "@/components/revision-session";
import { getDb } from "@/db";
import { findDeck } from "@/server/domain/revision";
import { loadDecks, sessionCards } from "@/server/service/revision";

export const dynamic = "force-dynamic";

/**
 * One revision session over a deck.
 *
 * The order is shuffled on the server rather than in the browser: the page is rendered per
 * request, so every visit is a fresh order, and the client hydrates with exactly the order the
 * server drew -- no flash of an unshuffled list, no hydration mismatch.
 */
export default async function ReviseDeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ deck: string[] }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { deck: id } = await params;
  const { mode: rawMode } = await searchParams;
  const mode = rawMode === "due" ? "due" : "all";
  const db = getDb();
  const deck = findDeck(await loadDecks(db), id);
  if (!deck) notFound();

  return (
    <RevisionSession
      deckId={deck.id}
      deckTitle={deck.title}
      mode={mode}
      cards={await sessionCards(db, deck, mode)}
    />
  );
}
