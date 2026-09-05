/**
 * Preparation data access.
 *
 * Reads are deliberately coarse: a discipline is a few dozen rows, so one query returning all
 * of them costs less than several filtered ones, and D1 bills queries per invocation rather
 * than rows. Topic and status filtering happens in the service layer over that single result.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { Db } from "@/db";
import { prepItems, type PrepKind, type PrepStatus } from "@/db/schema";

export async function listByKind(db: Db, kind: PrepKind) {
  return db
    .select()
    .from(prepItems)
    .where(eq(prepItems.kind, kind))
    // Frequency first: the questions that actually get asked should be at the top before any
    // filter is applied.
    .orderBy(desc(prepItems.frequency), asc(prepItems.title));
}

export async function getBySlug(db: Db, kind: PrepKind, slug: string) {
  const rows = await db
    .select()
    .from(prepItems)
    .where(and(eq(prepItems.kind, kind), eq(prepItems.slug, slug)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateProgress(
  db: Db,
  id: string,
  patch: { status?: PrepStatus; notes?: string | null; solution?: string | null },
) {
  await db
    .update(prepItems)
    .set({
      ...patch,
      // Touching an item is itself the signal that you practised it; asking the user to also
      // set a date would be admin they would skip.
      ...(patch.status && patch.status !== "not_started"
        ? { lastPracticedAt: new Date() }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(prepItems.id, id));
}

/** Per-discipline counts for the overview and the nav. One grouped query, not one per kind. */
export async function progressByKind(db: Db) {
  const rows = await db
    .select({
      kind: prepItems.kind,
      total: sql<number>`COUNT(*)`,
      done: sql<number>`SUM(CASE WHEN ${prepItems.status} = 'done' THEN 1 ELSE 0 END)`,
      inProgress: sql<number>`SUM(CASE WHEN ${prepItems.status} = 'in_progress' THEN 1 ELSE 0 END)`,
      revisit: sql<number>`SUM(CASE WHEN ${prepItems.status} = 'revisit' THEN 1 ELSE 0 END)`,
    })
    .from(prepItems)
    .groupBy(prepItems.kind);

  return new Map(
    rows.map((r) => [
      r.kind,
      {
        total: Number(r.total ?? 0),
        done: Number(r.done ?? 0),
        inProgress: Number(r.inProgress ?? 0),
        revisit: Number(r.revisit ?? 0),
      },
    ]),
  );
}

/** Recently touched items, for the "pick up where you left off" panel. */
export async function recentlyPractised(db: Db, limit = 5) {
  return db
    .select({
      id: prepItems.id,
      kind: prepItems.kind,
      slug: prepItems.slug,
      title: prepItems.title,
      status: prepItems.status,
      lastPracticedAt: prepItems.lastPracticedAt,
    })
    .from(prepItems)
    .where(sql`${prepItems.lastPracticedAt} IS NOT NULL`)
    .orderBy(desc(prepItems.lastPracticedAt))
    .limit(limit);
}
