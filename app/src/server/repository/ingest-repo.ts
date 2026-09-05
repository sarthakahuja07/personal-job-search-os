/**
 * Data access for ingest. The only module that issues SQL for this path.
 *
 * Two D1 limits shape everything here and are not negotiable:
 *   - 100 bound parameters per query
 *   - 50 queries per Worker invocation (free plan)
 *
 * So writes are chunked multi-row statements, sized by column count, and the whole path is
 * budgeted: roughly 6 fixed queries plus ceil(jobs/5) upserts. The crawler chunks its POSTs so
 * a single request never exceeds that. A naive per-job loop over NVIDIA's 2000 postings would
 * exceed the invocation limit forty times over.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Db } from "@/db";
import {
  companies,
  crawlRuns,
  jobs,
  notifications,
  settings,
  type CrawlStatus,
  type HealthStatus,
} from "@/db/schema";
import type { ExistingJob, PlannedJob, PlannedNotification } from "../domain/ingest-plan";
import { DEFAULT_MATCH_RULES, type MatchRules } from "../domain/matching";

/** jobs has 18 bound columns per row; 100 / 18 -> 5. */
const JOB_CHUNK = 5;
/** notifications has 6 bound columns per row. */
const NOTIFICATION_CHUNK = 16;
/** Single-column id lists. Kept below 100 with headroom. */
const ID_CHUNK = 90;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function loadCompany(db: Db, companyId: string) {
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      sourceType: companies.sourceType,
      active: companies.active,
      allowZeroResults: companies.allowZeroResults,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return rows[0] ?? null;
}

export async function loadSettings(
  db: Db,
): Promise<{ rules: MatchRules; closeAfterMissingRuns: number }> {
  const rows = await db
    .select({
      matchRules: settings.matchRules,
      closeAfterMissingRuns: settings.closeAfterMissingRuns,
    })
    .from(settings)
    .limit(1);
  const row = rows[0];
  return {
    rules: row?.matchRules ?? DEFAULT_MATCH_RULES,
    closeAfterMissingRuns: row?.closeAfterMissingRuns ?? 3,
  };
}

export async function loadExistingJobs(
  db: Db,
  companyId: string,
): Promise<ExistingJob[]> {
  const rows = await db
    .select({
      id: jobs.id,
      externalJobId: jobs.externalJobId,
      isRelevant: jobs.isRelevant,
      missingRunCount: jobs.missingRunCount,
      closedAt: jobs.closedAt,
    })
    .from(jobs)
    .where(eq(jobs.companyId, companyId));
  return rows;
}

/**
 * Median job count of recent successful runs, for drift detection.
 * Returns null when there is not enough history to judge.
 */
export async function recentMedianJobCount(
  db: Db,
  companyId: string,
  sampleSize = 5,
): Promise<number | null> {
  const rows = await db
    .select({ jobsFound: crawlRuns.jobsFound })
    .from(crawlRuns)
    .where(and(eq(crawlRuns.companyId, companyId), eq(crawlRuns.status, "success")))
    .orderBy(sql`${crawlRuns.startedAt} DESC`)
    .limit(sampleSize);
  if (rows.length < 3) return null;
  const counts = rows.map((r) => r.jobsFound).sort((a, b) => a - b);
  return counts[Math.floor(counts.length / 2)];
}

export async function upsertJobs(
  db: Db,
  companyId: string,
  sourceType: string,
  planned: PlannedJob[],
): Promise<void> {
  for (const group of chunk(planned, JOB_CHUNK)) {
    const values = group.map((j) => ({
      id: crypto.randomUUID(),
      companyId,
      externalJobId: j.externalJobId,
      title: j.title,
      location: j.location ?? null,
      department: j.department ?? null,
      description: j.description ?? null,
      jobUrl: j.jobUrl,
      normalizedJobUrl: j.normalizedJobUrl,
      postedAt: j.postedAt ?? null,
      source: sourceType as never,
      employmentType: j.employmentType ?? null,
      rawMetadata: j.rawMetadata ?? null,
      isRelevant: j.isRelevant,
      matchScore: j.matchScore,
      matchReason: j.matchReason,
      locationPriority: j.locationPriority,
      missingRunCount: 0,
    }));

    await db
      .insert(jobs)
      .values(values)
      .onConflictDoUpdate({
        target: [jobs.companyId, jobs.externalJobId],
        set: {
          // Refresh everything that can legitimately change upstream, plus the match result so
          // a rules change takes effect on the next crawl without a backfill.
          title: sql`excluded.title`,
          location: sql`excluded.location`,
          department: sql`excluded.department`,
          description: sql`excluded.description`,
          jobUrl: sql`excluded.job_url`,
          postedAt: sql`excluded.posted_at`,
          employmentType: sql`excluded.employment_type`,
          rawMetadata: sql`excluded.raw_metadata`,
          isRelevant: sql`excluded.is_relevant`,
          matchScore: sql`excluded.match_score`,
          matchReason: sql`excluded.match_reason`,
          locationPriority: sql`excluded.location_priority`,
          // Seeing a job again clears any absence and reopens it.
          missingRunCount: sql`0`,
          closedAt: sql`NULL`,
          updatedAt: sql`(unixepoch() * 1000)`,
        },
      });
  }
}

/**
 * Queue notifications. `onConflictDoNothing` on the unique dedup_key is what makes duplicate
 * emails structurally impossible rather than merely unlikely -- even if this ran twice.
 */
export async function queueNotifications(
  db: Db,
  companyId: string,
  planned: PlannedNotification[],
  jobIdByExternalId: Map<string, string>,
): Promise<number> {
  let queued = 0;
  for (const group of chunk(planned, NOTIFICATION_CHUNK)) {
    const values = group.map((n) => ({
      id: crypto.randomUUID(),
      dedupKey: n.dedupKey,
      notificationType: "new_job" as const,
      entityType: "job",
      entityId: jobIdByExternalId.get(n.externalJobId) ?? null,
      channel: "email",
      status: "pending" as const,
      payload: {
        title: n.title,
        matchReason: n.matchReason,
        companyId,
        externalJobId: n.externalJobId,
      },
    }));
    await db.insert(notifications).values(values).onConflictDoNothing({
      target: notifications.dedupKey,
    });
    queued += values.length;
  }
  return queued;
}

export async function incrementMissing(db: Db, jobIds: string[]): Promise<void> {
  for (const group of chunk(jobIds, ID_CHUNK)) {
    await db
      .update(jobs)
      .set({ missingRunCount: sql`${jobs.missingRunCount} + 1` })
      .where(inArray(jobs.id, group));
  }
}

export async function resetMissing(db: Db, jobIds: string[]): Promise<void> {
  for (const group of chunk(jobIds, ID_CHUNK)) {
    await db
      .update(jobs)
      .set({ missingRunCount: 0 })
      .where(inArray(jobs.id, group));
  }
}

export async function closeJobs(db: Db, jobIds: string[]): Promise<void> {
  for (const group of chunk(jobIds, ID_CHUNK)) {
    await db
      .update(jobs)
      .set({ closedAt: sql`(unixepoch() * 1000)` })
      .where(and(inArray(jobs.id, group), isNull(jobs.closedAt)));
  }
}

export async function jobIdsByExternalId(
  db: Db,
  companyId: string,
  externalIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const group of chunk(externalIds, ID_CHUNK)) {
    const rows = await db
      .select({ id: jobs.id, externalJobId: jobs.externalJobId })
      .from(jobs)
      .where(and(eq(jobs.companyId, companyId), inArray(jobs.externalJobId, group)));
    for (const r of rows) map.set(r.externalJobId, r.id);
  }
  return map;
}

export async function recordCrawlRun(
  db: Db,
  row: {
    runId: string;
    companyId: string;
    status: CrawlStatus;
    tier: number | null;
    jobsFound: number;
    newJobs: number;
    durationMs: number | null;
    skipReason: string | null;
    error: string | null;
    startedAt: Date;
  },
): Promise<void> {
  await db.insert(crawlRuns).values({
    id: crypto.randomUUID(),
    ...row,
    finishedAt: new Date(),
  });
}

export async function updateCompanyHealth(
  db: Db,
  companyId: string,
  patch: {
    healthStatus: HealthStatus;
    lastError: string | null;
    etag?: string | null;
    lastModified?: string | null;
    lastContentHash?: string | null;
    succeeded: boolean;
  },
): Promise<void> {
  await db
    .update(companies)
    .set({
      healthStatus: patch.healthStatus,
      lastError: patch.lastError,
      lastCrawledAt: new Date(),
      ...(patch.succeeded ? { lastSuccessAt: new Date() } : {}),
      ...(patch.etag !== undefined ? { etag: patch.etag } : {}),
      ...(patch.lastModified !== undefined ? { lastModified: patch.lastModified } : {}),
      ...(patch.lastContentHash !== undefined
        ? { lastContentHash: patch.lastContentHash }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(companies.id, companyId));
}
