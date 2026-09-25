/**
 * Revision data access: review state per (deck, page), and the company question lists decks are
 * built from.
 *
 * Reads are whole-table (`allReviews`) or scoped to one deck (everything else). `prep_reviews`
 * has at most a few hundred rows per deck, small enough that either shape is a single query with
 * no D1 bound-parameter limit to worry about -- every write and delete here keys on `deckId`
 * (and optionally `prepItemId`), never an `IN (...)` list of card ids.
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import type { Db } from "@/db";
import {
  prepCustomDecks,
  prepItems,
  prepReviews,
  type CustomDeckMode,
  type PrepDifficulty,
  type ReviewRating,
} from "@/db/schema";

export async function allReviews(db: Db) {
  return db.select().from(prepReviews);
}

export async function reviewsForDeck(db: Db, deckId: string) {
  return db.select().from(prepReviews).where(eq(prepReviews.deckId, deckId));
}

export async function reviewFor(db: Db, deckId: string, prepItemId: string) {
  const rows = await db
    .select()
    .from(prepReviews)
    .where(and(eq(prepReviews.deckId, deckId), eq(prepReviews.prepItemId, prepItemId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function saveReview(
  db: Db,
  row: {
    deckId: string;
    prepItemId: string;
    ease: number;
    intervalDays: number;
    reps: number;
    lapses: number;
    lastRating: ReviewRating;
    dueAt: Date;
    lastReviewedAt: Date;
  },
) {
  const { deckId: _d, prepItemId: _id, ...patch } = row;
  await db
    .insert(prepReviews)
    .values(row)
    .onConflictDoUpdate({ target: [prepReviews.deckId, prepReviews.prepItemId], set: patch });
}

/** Wipe one deck's review state -- what "Reset progress" deletes. Never touches other decks,
 *  even ones (like "Everything") built from the same underlying questions. */
export async function deleteDeckReviews(db: Db, deckId: string): Promise<void> {
  await db.delete(prepReviews).where(eq(prepReviews.deckId, deckId));
}

export async function listCustomDecks(db: Db) {
  return db.select().from(prepCustomDecks).orderBy(prepCustomDecks.createdAt);
}

export async function createCustomDeck(
  db: Db,
  input: {
    title: string;
    mode: CustomDeckMode;
    companySlug: string | null;
    discipline: string | null;
    difficulty: PrepDifficulty | null;
    questionIds: string[] | null;
  },
) {
  const [row] = await db.insert(prepCustomDecks).values(input).returning();
  return row;
}

export async function deleteCustomDeck(db: Db, id: string): Promise<void> {
  await db.delete(prepCustomDecks).where(eq(prepCustomDecks.id, id));
}

/**
 * Every company's generated DSA/HLD/LLD index page, with the rows it was published from.
 *
 * Only the child pages: the company folder itself is read separately from the flat tree the
 * caller already has, so this stays one query.
 */
export async function companyIndexPages(db: Db) {
  return db
    .select({
      id: prepItems.id,
      slug: prepItems.slug,
      parentId: prepItems.parentId,
      content: prepItems.content,
    })
    .from(prepItems)
    .where(
      and(
        eq(prepItems.kind, "company"),
        isNotNull(prepItems.parentId),
        inArray(prepItems.slug, ["dsa", "hld", "lld"]),
      ),
    );
}
