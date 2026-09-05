/**
 * Re-apply the current match rules to jobs already in the database.
 *
 * Needed because tightening a rule does not otherwise reach stored jobs: the crawler's title
 * pre-filter drops newly-excluded titles *before* ingest, so their existing rows keep whatever
 * verdict they were given under the old rules. Adding "security" to the exclusions would hide
 * such roles from future crawls while leaving yesterday's on the board forever.
 *
 * Only rows whose verdict actually changed are written, which keeps this well inside D1's
 * 50-queries-per-invocation limit in the normal case, and `maxUpdates` bounds the pathological one.
 */

import { eq, inArray } from "drizzle-orm";

import type { Db } from "@/db";
import { jobs, settings } from "@/db/schema";
import { matchJob, DEFAULT_MATCH_RULES } from "../domain/matching";

export type RematchResult = {
  scanned: number;
  changed: number;
  nowRelevant: number;
  noLongerRelevant: number;
  truncated: boolean;
};

export async function rematchJobs(db: Db, maxUpdates = 40): Promise<RematchResult> {
  const settingsRows = await db
    .select({ matchRules: settings.matchRules })
    .from(settings)
    .limit(1);
  const rules = settingsRows[0]?.matchRules ?? DEFAULT_MATCH_RULES;

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      location: jobs.location,
      description: jobs.description,
      isRelevant: jobs.isRelevant,
      matchScore: jobs.matchScore,
    })
    .from(jobs);

  type Change = {
    id: string;
    isRelevant: boolean;
    matchScore: number;
    matchReason: string;
    locationPriority: number | null;
  };

  const changes: Change[] = [];
  let nowRelevant = 0;
  let noLongerRelevant = 0;

  for (const row of rows) {
    const m = matchJob(
      { title: row.title, location: row.location, description: row.description },
      rules,
    );
    if (m.isRelevant === row.isRelevant && m.score === row.matchScore) continue;
    if (m.isRelevant && !row.isRelevant) nowRelevant++;
    if (!m.isRelevant && row.isRelevant) noLongerRelevant++;
    changes.push({
      id: row.id,
      isRelevant: m.isRelevant,
      matchScore: m.score,
      matchReason: m.reason,
      locationPriority: m.locationPriority,
    });
  }

  const batch = changes.slice(0, maxUpdates);

  // Group by identical verdict so a whole set of newly-excluded jobs costs one query rather
  // than one each -- typical when a single exclusion rule is added.
  const byVerdict = new Map<string, Change[]>();
  for (const c of batch) {
    const key = `${c.isRelevant}|${c.matchScore}|${c.locationPriority}|${c.matchReason}`;
    const list = byVerdict.get(key);
    if (list) list.push(c);
    else byVerdict.set(key, [c]);
  }

  for (const group of byVerdict.values()) {
    const ids = group.map((c) => c.id);
    const first = group[0];
    await db
      .update(jobs)
      .set({
        isRelevant: first.isRelevant,
        matchScore: first.matchScore,
        matchReason: first.matchReason,
        locationPriority: first.locationPriority,
        updatedAt: new Date(),
      })
      .where(ids.length === 1 ? eq(jobs.id, ids[0]) : inArray(jobs.id, ids.slice(0, 90)));
  }

  return {
    scanned: rows.length,
    changed: batch.length,
    nowRelevant,
    noLongerRelevant,
    truncated: changes.length > batch.length,
  };
}
