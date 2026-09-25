"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { REVIEW_RATINGS, type ReviewRating } from "@/db/schema";
import { findDeck } from "@/server/domain/revision";
import { cardDetail, loadDecks, rateCard, resetDeckProgress } from "@/server/service/revision";

/**
 * One card's content, fetched when it is about to be shown rather than with the deck.
 *
 * A worked DSA answer with its code is tens of kilobytes; shipping a whole deck's worth up front
 * would make opening a 100-card deck a multi-megabyte page load for the one card you look at.
 */
export async function loadRevisionCard(deckId: string[], id: string) {
  return cardDetail(getDb(), deckId, id);
}

/**
 * Record a rating. The session itself needs no revalidation -- it holds its own queue -- but the
 * deck list's counts are a page Next.js can serve from its client-side cache on browser back
 * navigation even though the route is `force-dynamic` (that flag only stops static generation,
 * it doesn't affect the client cache used for back/forward -- see the Client Cache glossary
 * entry). Revalidating here is what makes hitting Back after a session show fresh counts instead
 * of the ones from before the session started.
 */
export async function rateRevisionCard(deckId: string[], id: string, rating: string) {
  if (!(REVIEW_RATINGS as readonly string[]).includes(rating)) {
    throw new Error(`Unknown rating: ${rating}`);
  }
  const next = await rateCard(getDb(), deckId, id, rating as ReviewRating);
  revalidatePath("/prep/revise");
  return { dueAt: next.dueAt.getTime(), intervalDays: next.intervalDays };
}

/** Forget every card in a deck. Every deck's progress is independent -- even "Everything," which
 *  is built from the same cards as every other deck -- so this never affects another deck. Cannot
 *  be undone. */
export async function resetRevisionProgress(deckId: string[]) {
  const db = getDb();
  const deck = findDeck(await loadDecks(db), deckId);
  if (!deck) throw new Error(`Unknown deck: ${deckId.join("/")}`);
  await resetDeckProgress(db, deck);
  revalidatePath("/prep/revise");
}
