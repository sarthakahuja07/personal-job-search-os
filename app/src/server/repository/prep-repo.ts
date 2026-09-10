/**
 * Preparation data access.
 *
 * Reads are deliberately coarse: a discipline is a few dozen rows, so one query returning all
 * of them costs less than several filtered ones, and D1 bills queries per invocation rather
 * than rows. Topic and status filtering happens in the service layer over that single result.
 */

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "@/db";
import { prepItems, type PrepKind, type PrepStatus } from "@/db/schema";

/**
 * The top level of a discipline.
 *
 * Top level rather than every row, because prep is a tree now: System Design opens on HLD and
 * LLD, and their pages are reached by walking in. DSA and behavioral are flat, so every row is
 * top level and this is exactly what it always was for them.
 */
export async function listByKind(db: Db, kind: PrepKind) {
  return db
    .select()
    .from(prepItems)
    .where(and(eq(prepItems.kind, kind), isNull(prepItems.parentId)))
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
    // Folders are excluded. A folder is a container, not something you practise, and counting
    // one would report work outstanding that does not exist -- and could never be cleared,
    // since a folder has no progress controls to clear it with.
    .where(sql`NOT EXISTS (SELECT 1 FROM prep_items c WHERE c.parent_id = ${prepItems.id})`)
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

/**
 * Walk a URL path down the tree: ["hld", "caching"] -> the Caching page under HLD.
 *
 * Resolved level by level rather than by matching the last slug alone, so two pages may share a
 * slug under different parents -- which an imported Notion directory will do the moment two
 * folders both contain a "Notes" page.
 */
export async function resolvePath(db: Db, kind: PrepKind, segments: string[]) {
  let parentId: string | null = null;
  let found: typeof prepItems.$inferSelect | undefined;

  for (const segment of segments) {
    const rows: (typeof prepItems.$inferSelect)[] = await db
      .select()
      .from(prepItems)
      .where(
        and(
          eq(prepItems.kind, kind),
          eq(prepItems.slug, segment),
          parentId === null ? isNull(prepItems.parentId) : eq(prepItems.parentId, parentId),
        ),
      )
      .limit(1);

    found = rows[0];
    if (!found) return null;
    parentId = found.id;
  }
  return found ?? null;
}

/** Direct children, in the order they were arranged. */
export async function childrenOf(db: Db, parentId: string) {
  return db
    .select({
      id: prepItems.id,
      slug: prepItems.slug,
      title: prepItems.title,
      status: prepItems.status,
      position: prepItems.position,
      body: prepItems.body,
      childCount: sql<number>`(SELECT COUNT(*) FROM prep_items c WHERE c.parent_id = ${prepItems.id})`,
    })
    .from(prepItems)
    .where(eq(prepItems.parentId, parentId))
    .orderBy(prepItems.position, prepItems.title);
}

/** Top-level pages of a kind -- the folders, for a kind that has any. */
export async function rootsOf(db: Db, kind: PrepKind) {
  return db
    .select({
      id: prepItems.id,
      slug: prepItems.slug,
      title: prepItems.title,
      body: prepItems.body,
      position: prepItems.position,
      childCount: sql<number>`(SELECT COUNT(*) FROM prep_items c WHERE c.parent_id = ${prepItems.id})`,
    })
    .from(prepItems)
    .where(and(eq(prepItems.kind, kind), isNull(prepItems.parentId)))
    .orderBy(prepItems.position, prepItems.title);
}

/** The chain from the root down to this page, for the breadcrumb. */
export async function ancestorsOf(db: Db, id: string) {
  const chain: { id: string; slug: string; title: string }[] = [];
  let cursor: string | null = id;

  // Bounded rather than `while (cursor)`: a parent cycle would otherwise hang the request, and
  // nothing in the schema prevents one being introduced by a bad import.
  for (let depth = 0; depth < 12 && cursor; depth += 1) {
    const rows: { id: string; slug: string; title: string; parentId: string | null }[] = await db
      .select({
        id: prepItems.id,
        slug: prepItems.slug,
        title: prepItems.title,
        parentId: prepItems.parentId,
      })
      .from(prepItems)
      .where(eq(prepItems.id, cursor))
      .limit(1);

    const row = rows[0];
    if (!row) break;
    chain.unshift({ id: row.id, slug: row.slug, title: row.title });
    cursor = row.parentId;
  }
  return chain;
}

/** Save the document body. Separate from progress: editing a page is not practising it. */
export async function updateBody(db: Db, id: string, body: string | null) {
  await db
    .update(prepItems)
    .set({ body, updatedAt: new Date() })
    .where(eq(prepItems.id, id));
}
