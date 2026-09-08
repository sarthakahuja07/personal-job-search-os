/**
 * Read queries for the job board and dashboard.
 *
 * D1 permits 50 queries per Worker invocation, so these join rather than looking up a company
 * per row. A list endpoint returning 50 jobs must never issue 50 company queries.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";

import type { Db } from "@/db";
import { applications, companies, contacts, jobs } from "@/db/schema";

export type JobFilters = {
  companyId?: string;
  relevantOnly?: boolean;
  newOnly?: boolean;
  /** Hide anything already read or already in the pipeline. */
  unreadOnly?: boolean;
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
    unreadOnly = false,
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
    // "Untouched" means neither read nor in the pipeline: an application is itself the
    // strongest possible form of having looked at something.
    unreadOnly ? isNull(jobs.readAt) : undefined,
    unreadOnly ? isNull(applications.status) : undefined,
    query
      ? or(like(jobs.title, `%${query}%`), like(jobs.location, `%${query}%`))
      : undefined,
  ].filter(Boolean);

  // "best" ranks by fit against Sarthak's resume, which already folds in location preference,
  // level precision, skill overlap and recency (domain/fit.ts). Before fit existed this had to
  // hand-roll that ordering out of location_priority and match_score; now the one number carries
  // it, and the card shows the signals behind it so the order can be argued with.
  const orderBy =
    sort === "newest"
      ? [desc(jobs.discoveredAt)]
      : sort === "posted"
        ? [sql`${jobs.postedAt} IS NULL`, desc(jobs.postedAt)]
        : sort === "company"
          ? [asc(companies.name), desc(jobs.matchScore)]
          : [desc(jobs.fitScore), desc(jobs.matchScore), desc(jobs.discoveredAt)];

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
      fitScore: jobs.fitScore,
      fitBand: jobs.fitBand,
      fitSignals: jobs.fitSignals,
      fitTitleOnly: jobs.fitTitleOnly,
      readAt: jobs.readAt,
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
      linkedinUrl: contacts.linkedinUrl,
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
    dsa_remaining: number;
    pipeline: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*) FROM jobs WHERE is_relevant = 1 AND closed_at IS NULL) AS relevant_jobs,
      (SELECT COUNT(*) FROM notifications WHERE status = 'pending') AS pending_notifications,
      (SELECT COUNT(*) FROM companies
        WHERE active = 1 AND source_type != 'manual'
          AND health_status IN ('failing','suspicious','degraded')) AS unhealthy_sources,
      (SELECT COUNT(*) FROM prep_items WHERE kind = 'dsa' AND status != 'done') AS dsa_remaining,
      (SELECT COUNT(*) FROM applications WHERE status != 'interviews') AS pipeline
  `);
  const r = rows[0];
  return {
    relevantJobs: Number(r?.relevant_jobs ?? 0),
    pendingNotifications: Number(r?.pending_notifications ?? 0),
    unhealthySources: Number(r?.unhealthy_sources ?? 0),
    dsaRemaining: Number(r?.dsa_remaining ?? 0),
    pipeline: Number(r?.pipeline ?? 0),
  };
}

/** Every contact with its company name, for the template composer's contact picker. */
export async function listAllContacts(db: Db) {
  return db
    .select({
      id: contacts.id,
      name: contacts.name,
      phone: contacts.phone,
      email: contacts.email,
      companyId: companies.id,
      companyName: companies.name,
    })
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .orderBy(asc(companies.name), asc(contacts.name));
}

/** A single job with its company, for the detail page. */
export async function getJob(db: Db, id: string) {
  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      location: jobs.location,
      department: jobs.department,
      description: jobs.description,
      jobUrl: jobs.jobUrl,
      postedAt: jobs.postedAt,
      discoveredAt: jobs.discoveredAt,
      closedAt: jobs.closedAt,
      matchScore: jobs.matchScore,
      matchReason: jobs.matchReason,
      locationPriority: jobs.locationPriority,
      fitScore: jobs.fitScore,
      fitBand: jobs.fitBand,
      fitSignals: jobs.fitSignals,
      fitTitleOnly: jobs.fitTitleOnly,
      readAt: jobs.readAt,
      isRelevant: jobs.isRelevant,
      employmentType: jobs.employmentType,
      externalJobId: jobs.externalJobId,
      source: jobs.source,
      companyId: companies.id,
      companyName: companies.name,
      careersUrl: companies.careersUrl,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Grouped board, recents, reminders
// ---------------------------------------------------------------------------

/**
 * Every contact, keyed by company.
 *
 * One query for the whole board rather than one per company: the grouped view renders up to
 * thirty companies, and thirty lookups would spend most of D1's 50-query budget on names.
 */
export async function contactsByCompany(db: Db) {
  const rows = await db
    .select({
      companyId: contacts.companyId,
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      phone: contacts.phone,
      linkedinUrl: contacts.linkedinUrl,
    })
    .from(contacts)
    .orderBy(asc(contacts.name));

  const byCompany = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCompany.get(row.companyId);
    if (list) list.push(row);
    else byCompany.set(row.companyId, [row]);
  }
  return byCompany;
}

/** Companies that currently have at least one job on the board, for the search picker. */
export async function companiesWithJobs(db: Db, relevantOnly = true) {
  return db
    .select({
      id: companies.id,
      name: companies.name,
      jobCount: count(jobs.id),
    })
    .from(companies)
    .innerJoin(jobs, eq(jobs.companyId, companies.id))
    .where(
      and(
        isNull(jobs.closedAt),
        relevantOnly ? eq(jobs.isRelevant, true) : undefined,
      ),
    )
    .groupBy(companies.id)
    .orderBy(asc(companies.name));
}

/**
 * Jobs discovered in the last `days`, best fit first.
 *
 * The dashboard's reason to exist: what appeared since you last looked, while a referral is
 * still worth asking for. Ordered by fit rather than time because three days of Amazon output
 * is longer than anyone reads top-to-bottom.
 */
export async function listRecentlyDiscovered(db: Db, days = 3, limit = 12) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
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
      fitScore: jobs.fitScore,
      fitBand: jobs.fitBand,
      fitSignals: jobs.fitSignals,
      fitTitleOnly: jobs.fitTitleOnly,
      readAt: jobs.readAt,
      closedAt: jobs.closedAt,
      companyId: companies.id,
      companyName: companies.name,
      applicationStatus: applications.status,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .leftJoin(applications, eq(applications.jobId, jobs.id))
    .where(
      and(
        isNull(jobs.closedAt),
        eq(jobs.isRelevant, true),
        gte(jobs.discoveredAt, since),
        // Marking a job read removes it from here. The dashboard answers "what needs me now",
        // so a role you have already looked at and passed on is finished business — leaving it
        // would mean the list never shrinks no matter how much you work through.
        isNull(jobs.readAt),
      ),
    )
    .orderBy(desc(jobs.fitScore), desc(jobs.discoveredAt))
    .limit(limit);
}

/**
 * Everything the reminder rules need, in one query.
 *
 * Relevant, open jobs only: a reminder about a job the matcher rejected would be noise, and a
 * closed job is not actionable. `hasContact` is resolved here rather than per reminder so the
 * domain stays pure and the query count stays at one.
 */
export async function listReminderCandidates(db: Db, limit = 200) {
  return db
    .select({
      jobId: jobs.id,
      jobTitle: jobs.title,
      companyId: companies.id,
      companyName: companies.name,
      status: applications.status,
      requestedAt: applications.requestedAt,
      referredAt: applications.referredAt,
      appliedAt: applications.appliedAt,
      savedAt: applications.createdAt,
      discoveredAt: jobs.discoveredAt,
      fitBand: jobs.fitBand,
      readAt: jobs.readAt,
      hasContact: sql<number>`EXISTS (SELECT 1 FROM contacts WHERE contacts.company_id = ${companies.id})`,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .leftJoin(applications, eq(applications.jobId, jobs.id))
    .where(
      and(
        isNull(jobs.closedAt),
        eq(jobs.isRelevant, true),
        // Only rows that could conceivably produce a reminder. This runs on every page load to
        // draw the nav badge, so scanning every relevant job was the floor under every tab
        // switch. It filters by *shape* -- in the pipeline, or an untouched strong match --
        // never by threshold, so the rules stay the domain's business and cannot drift here.
        or(
          isNotNull(applications.status),
          and(
            isNull(jobs.readAt),
            inArray(jobs.fitBand, ["excellent", "strong"]),
          ),
        ),
      ),
    )
    .orderBy(desc(jobs.fitScore))
    .limit(limit);
}
