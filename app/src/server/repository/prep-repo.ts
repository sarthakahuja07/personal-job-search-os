/**
 * Preparation data access.
 *
 * Reads are deliberately coarse: a discipline is a few dozen rows, so one query returning all
 * of them costs less than several filtered ones, and D1 bills queries per invocation rather
 * than rows. Topic and status filtering happens in the service layer over that single result.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Db } from "@/db";
import {
  prepCodeFiles,
  prepItems,
  prepResources,
  type NewPrepCodeFile,
  type NewPrepItem,
  type NewPrepResource,
  type PrepDifficulty,
  type PrepKind,
  type PrepStatus,
} from "@/db/schema";
import type { QuestionSourceRow } from "@/server/domain/prep-questions";

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

/**
 * Every prep page, flat, for the navigation tree.
 *
 * One query rather than a walk per level: the whole of prep is a few dozen rows, and the
 * sidebar renders on every page load, so the cost that matters is round trips rather than rows.
 * The nesting is rebuilt in memory by the caller.
 */
export async function navTree(db: Db) {
  return db
    .select({
      id: prepItems.id,
      kind: prepItems.kind,
      slug: prepItems.slug,
      title: prepItems.title,
      parentId: prepItems.parentId,
      position: prepItems.position,
      frequency: prepItems.frequency,
      difficulty: prepItems.difficulty,
    })
    .from(prepItems)
    .orderBy(prepItems.position, prepItems.title);
}

/**
 * One discipline's pages, flat and in sidebar order, with just enough to decide which are
 * questions and to list and search them. Bodies and `content` stay behind: a worked DSA page
 * carries its whole solution in `content`, and only whether it is a reader is needed here.
 */
export async function questionRows(db: Db, kind: PrepKind): Promise<QuestionSourceRow[]> {
  const rows = await db
    .select({
      id: prepItems.id,
      parentId: prepItems.parentId,
      kind: prepItems.kind,
      slug: prepItems.slug,
      title: prepItems.title,
      prompt: prepItems.prompt,
      topics: prepItems.topics,
      companies: prepItems.companies,
      difficulty: prepItems.difficulty,
      status: prepItems.status,
      frequency: prepItems.frequency,
      isReader: sql<number>`(json_extract(${prepItems.content}, '$.pdf') IS NOT NULL
        OR json_extract(${prepItems.content}, '$.drive') IS NOT NULL
        OR json_extract(${prepItems.content}, '$.github') IS NOT NULL
        OR json_extract(${prepItems.content}, '$.embed') IS NOT NULL)`,
    })
    .from(prepItems)
    .where(eq(prepItems.kind, kind))
    .orderBy(prepItems.position, prepItems.title);
  return rows.map((r) => ({ ...r, isReader: Boolean(r.isReader) }));
}

export async function resourcesFor(db: Db, prepItemId: string) {
  return db
    .select()
    .from(prepResources)
    .where(eq(prepResources.prepItemId, prepItemId))
    .orderBy(prepResources.position, prepResources.createdAt);
}

/** Resources for many pages at once, so a folder listing costs one query rather than N. */
export async function resourceCounts(db: Db, itemIds: string[]) {
  if (itemIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ id: prepResources.prepItemId, n: sql<number>`count(*)` })
    .from(prepResources)
    .where(inArray(prepResources.prepItemId, itemIds.slice(0, 90)))
    .groupBy(prepResources.prepItemId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

export async function addResource(db: Db, row: NewPrepResource) {
  await db.insert(prepResources).values(row).onConflictDoNothing({
    target: [prepResources.prepItemId, prepResources.url],
  });
}

export async function removeResource(db: Db, id: string) {
  await db.delete(prepResources).where(eq(prepResources.id, id));
}

// ---------------------------------------------------------------------------
// Code workspace
// ---------------------------------------------------------------------------

/**
 * Every source file attached to a question, ordered the way the explorer draws them.
 *
 * Ordered by path rather than by `position` so the list arrives already grouped by folder --
 * the tree is built from these strings, and feeding it siblings out of order would make the
 * folders appear in insertion order instead of alphabetically.
 */
export async function codeFilesFor(db: Db, prepItemId: string) {
  return db
    .select()
    .from(prepCodeFiles)
    .where(eq(prepCodeFiles.prepItemId, prepItemId))
    .orderBy(prepCodeFiles.path);
}

/**
 * Add a file, or replace the one already at that path.
 *
 * Replace rather than ignore: re-adding a path is how you correct a file you pasted wrongly,
 * and silently keeping the old content would look like the save simply failed.
 */
export async function addCodeFile(db: Db, row: NewPrepCodeFile) {
  await db
    .insert(prepCodeFiles)
    .values(row)
    .onConflictDoUpdate({
      target: [prepCodeFiles.prepItemId, prepCodeFiles.path],
      set: {
        content: row.content,
        language: row.language ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function removeCodeFile(db: Db, id: string) {
  await db.delete(prepCodeFiles).where(eq(prepCodeFiles.id, id));
}

/**
 * Swap a page's whole code workspace for a new set of files.
 *
 * Delete-then-insert rather than a per-file upsert, because a republished solution is a new
 * tree, not an edit: files get renamed and packages split, and an upsert would leave the old
 * names behind as orphans that look like part of the answer.
 *
 * Inserted in chunks rather than one statement. D1 caps how large a single query may be, and a
 * dozen source files pasted into one INSERT is exactly the payload that finds the cap -- in
 * production, on the largest and most valuable page.
 */
export async function replaceCodeFiles(
  db: Db,
  prepItemId: string,
  rows: NewPrepCodeFile[],
): Promise<number> {
  await db.delete(prepCodeFiles).where(eq(prepCodeFiles.prepItemId, prepItemId));
  if (rows.length === 0) return 0;

  // Two files at one path would break the unique index and fail the whole publish. The later
  // one wins, which is what a caller who listed a path twice almost certainly meant.
  const byPath = new Map<string, NewPrepCodeFile>();
  for (const row of rows) {
    if (row.path) byPath.set(row.path, row);
  }
  const unique = [...byPath.values()];

  const CHUNK = 8;
  for (let i = 0; i < unique.length; i += CHUNK) {
    await db.insert(prepCodeFiles).values(unique.slice(i, i + CHUNK));
  }
  return unique.length;
}

/** Difficulty and asked-frequency. Written independently of progress and of the document. */
export async function setPrepGrading(
  db: Db,
  id: string,
  fields: { difficulty?: PrepDifficulty | null; frequency?: number },
) {
  await db
    .update(prepItems)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(prepItems.id, id));
}

/**
 * Move a page: to a new parent, to a new place among its siblings, or both.
 *
 * Positions are rewritten for the whole destination list rather than nudged, because gaps and
 * ties accumulate otherwise and the order starts depending on the tie-break in the query. A
 * few dozen siblings is nothing to renumber.
 */
export async function movePage(
  db: Db,
  id: string,
  newParentId: string | null,
  newIndex: number,
) {
  const [moving] = await db.select().from(prepItems).where(eq(prepItems.id, id)).limit(1);
  if (!moving) return { ok: false as const, reason: "not_found" };

  // A page cannot be moved inside itself or anything beneath it. Without this the subtree
  // detaches from the root and becomes unreachable -- a cycle that no query would ever return.
  let cursor = newParentId;
  for (let depth = 0; depth < 24 && cursor; depth += 1) {
    if (cursor === id) return { ok: false as const, reason: "would_cycle" };
    const [row]: { parentId: string | null }[] = await db
      .select({ parentId: prepItems.parentId })
      .from(prepItems)
      .where(eq(prepItems.id, cursor))
      .limit(1);
    cursor = row?.parentId ?? null;
  }

  const siblings = await db
    .select({ id: prepItems.id })
    .from(prepItems)
    .where(
      and(
        eq(prepItems.kind, moving.kind),
        newParentId === null
          ? isNull(prepItems.parentId)
          : eq(prepItems.parentId, newParentId),
      ),
    )
    .orderBy(prepItems.position, prepItems.title);

  const order = siblings.map((s) => s.id).filter((s) => s !== id);
  const at = Math.max(0, Math.min(order.length, newIndex));
  order.splice(at, 0, id);

  await db
    .update(prepItems)
    .set({ parentId: newParentId, updatedAt: new Date() })
    .where(eq(prepItems.id, id));

  // Renumber in one pass. At this size the query count is comfortably inside D1's budget.
  for (let i = 0; i < order.length; i += 1) {
    await db.update(prepItems).set({ position: i }).where(eq(prepItems.id, order[i]));
  }
  return { ok: true as const };
}

/**
 * One page by its id.
 *
 * The book proxy needs the Drive reference held in `content`, and it is reached by id from a
 * URL rather than by walking a path, so `resolvePath` cannot serve it.
 */
export async function getById(db: Db, id: string) {
  const rows = await db.select().from(prepItems).where(eq(prepItems.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * A page with this slug already under this parent, if there is one.
 *
 * The unique index is (kind, coalesce(parent_id,''), slug), so this is the exact question the
 * database would answer with a constraint violation -- asked first, so the caller can merge or
 * refuse deliberately rather than catching an error and guessing what it meant.
 */
export async function pageBySlug(
  db: Db,
  kind: PrepKind,
  parentId: string | null,
  slug: string,
) {
  const rows = await db
    .select()
    .from(prepItems)
    .where(
      and(
        eq(prepItems.kind, kind),
        eq(prepItems.slug, slug),
        parentId === null ? isNull(prepItems.parentId) : eq(prepItems.parentId, parentId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Next free position among a parent's children, so an imported page lands at the end. */
export async function nextPosition(db: Db, parentId: string | null): Promise<number> {
  const rows = await db
    .select({ max: sql<number | null>`MAX(${prepItems.position})` })
    .from(prepItems)
    .where(parentId === null ? isNull(prepItems.parentId) : eq(prepItems.parentId, parentId));
  return (rows[0]?.max ?? -1) + 1;
}

export async function insertPage(db: Db, row: NewPrepItem) {
  const created = await db.insert(prepItems).values(row).returning();
  return created[0];
}

export async function updatePage(
  db: Db,
  id: string,
  patch: Partial<NewPrepItem>,
): Promise<void> {
  await db
    .update(prepItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(prepItems.id, id));
}

/**
 * Pages matching free text, for answering "do I already have this?" before writing a new one.
 *
 * Title and prompt only. Searching bodies would match every page that merely *mentions*
 * consistent hashing, which is the opposite of what a duplicate check wants.
 */
/**
 * Tokenized rather than a single substring: "queue implement" should find "Implement a Queue
 * From Scratch with Random" even though the words appear in the opposite order and are split by
 * others. Every token must appear *somewhere* in the title or prompt (AND across tokens, OR
 * across the two fields per token) -- order and adjacency don't matter, all the words do.
 *
 * Ranked so a title match outranks a prompt-only match: a page whose title contains a searched
 * word is what "search" means to someone skimming a sidebar, even before frequency is considered.
 */
export async function searchPages(db: Db, query: string, kind?: PrepKind, limit = 20) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const titleHits = tokens.map(
    (t) => sql`(CASE WHEN lower(${prepItems.title}) LIKE ${`%${t}%`} THEN 1 ELSE 0 END)`,
  );
  const titleScore = sql.join(titleHits, sql` + `);

  return db
    .select({
      id: prepItems.id,
      kind: prepItems.kind,
      slug: prepItems.slug,
      title: prepItems.title,
      parentId: prepItems.parentId,
      difficulty: prepItems.difficulty,
      frequency: prepItems.frequency,
      status: prepItems.status,
      topics: prepItems.topics,
    })
    .from(prepItems)
    .where(
      and(
        kind ? eq(prepItems.kind, kind) : undefined,
        ...tokens.map((t) => {
          const like = `%${t}%`;
          return sql`(lower(${prepItems.title}) LIKE ${like} OR lower(coalesce(${prepItems.prompt}, '')) LIKE ${like})`;
        }),
      ),
    )
    .orderBy(desc(titleScore), desc(prepItems.frequency), asc(prepItems.title))
    .limit(limit);
}

/** Every page, flat, for building slash paths without a query per level. Carries `status` too,
 *  so a company index can show a resolved question as done without a second query per row. */
export async function allPagePaths(db: Db) {
  return db
    .select({
      id: prepItems.id,
      kind: prepItems.kind,
      slug: prepItems.slug,
      title: prepItems.title,
      parentId: prepItems.parentId,
      status: prepItems.status,
      difficulty: prepItems.difficulty,
    })
    .from(prepItems)
    .orderBy(asc(prepItems.kind), asc(prepItems.position), asc(prepItems.title));
}
