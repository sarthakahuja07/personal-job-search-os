"use server";

import { getDb } from "@/db";
import { REVIEW_RATINGS, type ReviewRating } from "@/db/schema";
import { cardDetail, rateCard } from "@/server/service/revision";

/**
 * One card's content, fetched when it is about to be shown rather than with the deck.
 *
 * A worked DSA answer with its code is tens of kilobytes; shipping a whole deck's worth up front
 * would make opening a 100-card deck a multi-megabyte page load for the one card you look at.
 */
export async function loadRevisionCard(id: string) {
  return cardDetail(getDb(), id);
}

/**
 * Record a rating. No revalidation: the session holds its own queue, and the deck list is
 * force-dynamic, so it reads fresh counts the next time it is opened.
 */
export async function rateRevisionCard(id: string, rating: string) {
  if (!(REVIEW_RATINGS as readonly string[]).includes(rating)) {
    throw new Error(`Unknown rating: ${rating}`);
  }
  const next = await rateCard(getDb(), id, rating as ReviewRating);
  return { dueAt: next.dueAt.getTime(), intervalDays: next.intervalDays };
}
