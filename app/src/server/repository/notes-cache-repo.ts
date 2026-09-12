/**
 * The notes cache.
 *
 * Small on purpose: get a row, put a row. The freshness decision lives in the service, because
 * "how old is too old" is a policy question and this layer only knows how to store things.
 */

import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import { githubNotesCache, type GithubNotesCacheRow } from "@/db/schema";

export async function getCached(db: Db, key: string): Promise<GithubNotesCacheRow | null> {
  const rows = await db
    .select()
    .from(githubNotesCache)
    .where(eq(githubNotesCache.key, key))
    .limit(1);
  return rows[0] ?? null;
}

export async function putCached(
  db: Db,
  key: string,
  payload: string,
  branch: string | null,
): Promise<void> {
  const fetchedAt = new Date();
  await db
    .insert(githubNotesCache)
    .values({ key, payload, branch, fetchedAt })
    // Re-fetching an existing key is the normal path, not a conflict -- a refresh replaces the
    // body and restarts the clock.
    .onConflictDoUpdate({
      target: githubNotesCache.key,
      set: { payload, branch, fetchedAt },
    });
}
