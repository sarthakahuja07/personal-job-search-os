/**
 * Read queries for the job board and dashboard.
 *
 * D1 permits 50 queries per Worker invocation, so these join rather than looking up a company
 * per row. A list endpoint returning 50 jobs must never issue 50 company queries.
 */

import { and, asc, count, desc, eq, gte, isNull, like, or, sql } from "drizzle-orm";

import type { Db } from "@/db";
import { applications, companies, contacts, jobs } from "@/db/schema";

export type JobFilters = {
  companyId?: string;
  relevantOnly?: boolean;
  newOnly?: boolean;
  includeClosed?: boolean;
  query?: string;
  sort?: "best" | "newest" | "posted" | "company";
  limit?: number;
  offset?: number;
};

const NEW_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export async function listJobs(db: Db, filters: JobFilters = {}) {
  const {
    companyId,
    relevantOnly = true,
    newOnly = false,
    includeClosed = false,
    query,
    sort = "best",
    limit = 50,
    offset = 0,
  } = filters;

  const where = [
    companyId ? eq(jobs.companyId, companyId) : undefined,
    relevantOnly ? eq(jobs.isRelevant, true) : undefined,
    includeClosed ? undefined : isNull(jobs.closedAt),
    newOnly ? gte(jobs.discoveredAt, new Date(Date.now() - NEW_WINDOW_MS)) : undefined,
    query
      ? or(like(jobs.title, `%${query}%`), like(jobs.location, `%${query}%`))
      : undefined,
  ].filter(Boolean);

  // "best" ranks by Sarthak's location preference first, then match quality, then recency.
  // location_priority is stored precisely so this ordering does not have to infer it.
  const orderBy =
    sort === "newest"
      ? [desc(jobs.discoveredAt)]
      : sort === "posted"
        ? [sql`${jobs.postedAt} IS NULL`, desc(jobs.postedAt)]
        : sort === "company"
          ? [asc(companies.name), desc(jobs.matchScore)]
          : [
              sql`${jobs.locationPriority} IS NULL`,
              asc(jobs.locationPriority),
              desc(jobs.matchScore),
              desc(jobs.discoveredAt),
            ];

  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      location: jobs.location,
      jobUrl: jobs.jobUrl,
      postedAt: jobs.postedAt,
      discoveredAt: jobs.discoveredAt,
      matchScore: jobs.matchScore,
      matchReason: jobs.matchReason,
      locationPriority: jobs.locationPriority,
      closedAt: jobs.closedAt,
      companyId: companies.id,
      companyName: companies.name,
      applicationStatus: applications.status,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .leftJoin(applications, eq(applications.jobId, jobs.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);
}

export async function countJobs(db: Db, filters: JobFilters = {}) {
  const { relevantOnly = true, includeClosed = false } = filters;
  const where = [
    relevantOnly ? eq(jobs.isRelevant, true) : undefined,
    includeClosed ? undefined : isNull(jobs.closedAt),
  ].filter(Boolean);
  const rows = await db
    .select({ n: count() })
    .from(jobs)
    .where(where.length ? and(...where) : undefined);
  return rows[0]?.n ?? 0;
}

/** Company health for the crawler status panel. One query, no per-company lookups. */
export async function listCompanyHealth(db: Db) {
  return db
    .select({
      id: companies.id,
      name: companies.name,
      sourceType: companies.sourceType,
      sourceTier: companies.sourceTier,
      active: companies.active,
      healthStatus: companies.healthStatus,
      lastSuccessAt: companies.lastSuccessAt,
      lastCrawledAt: companies.lastCrawledAt,
      lastError: companies.lastError,
      careersUrl: companies.careersUrl,
    })
    .from(companies)
    .orderBy(asc(companies.sourceTier), asc(companies.name));
}

export async function contactsForCompany(db: Db, companyId: string) {
  return db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      phone: contacts.phone,
      notes: contacts.notes,
    })
    .from(contacts)
    .where(eq(contacts.companyId, companyId))
    .orderBy(asc(contacts.name));
}

/** Dashboard counters. Deliberately a single grouped query rather than one per status. */
export async function jobStats(db: Db) {
  const rows = await db
    .select({
      total: count(),
      relevant: sql<number>`SUM(CASE WHEN ${jobs.isRelevant} THEN 1 ELSE 0 END)`,
      open: sql<number>`SUM(CASE WHEN ${jobs.closedAt} IS NULL THEN 1 ELSE 0 END)`,
      recent: sql<number>`SUM(CASE WHEN ${jobs.discoveredAt} >= ${Date.now() - NEW_WINDOW_MS} AND ${jobs.isRelevant} THEN 1 ELSE 0 END)`,
    })
    .from(jobs);
  return rows[0] ?? { total: 0, relevant: 0, open: 0, recent: 0 };
}

/**
 * Counts shown as nav badges. One query per figure would be four round trips on every page
 * render, so this is a single scalar-subquery statement.
 */
export async function navCounts(db: Db) {
  const rows = await db.all<{
    relevant_jobs: number;
    pending_notifications: number;
    unhealthy_sources: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*) FROM jobs WHERE is_relevant = 1 AND closed_at IS NULL) AS relevant_jobs,
      (SELECT COUNT(*) FROM notifications WHERE status = 'pending') AS pending_notifications,
      (SELECT COUNT(*) FROM companies
        WHERE active = 1 AND source_type != 'manual'
          AND health_status IN ('failing','suspicious','degraded')) AS unhealthy_sources
  `);
  const r = rows[0];
  return {
    relevantJobs: Number(r?.relevant_jobs ?? 0),
    pendingNotifications: Number(r?.pending_notifications ?? 0),
    unhealthySources: Number(r?.unhealthy_sources ?? 0),
  };
}
