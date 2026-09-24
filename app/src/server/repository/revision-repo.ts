/**
 * Revision data access: review state per prep page, and the company question lists decks are
 * built from.
 *
 * Reads are whole-table. `prep_reviews` has at most one row per question -- a few hundred -- and
 * D1 caps bound parameters at 100, so an `IN (...)` over a large deck would fail where a full
 * scan of a tiny table cannot.
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import type { Db } from "@/db";
import { prepItems, prepReviews, type ReviewRating } from "@/db/schema";

export async function allReviews(db: Db) {
  return db.select().from(prepReviews);
}

export async function reviewFor(db: Db, prepItemId: string) {
  const rows = await db
    .select()
    .from(prepReviews)
    .where(eq(prepReviews.prepItemId, prepItemId))
    .limit(1);
  return rows[0] ?? null;
}

export async function saveReview(
  db: Db,
  row: {
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
  const { prepItemId: _id, ...patch } = row;
  await db
    .insert(prepReviews)
    .values(row)
    .onConflictDoUpdate({ target: prepReviews.prepItemId, set: patch });
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
